// S10 - TruthVoice service (in-memory, testable). All state lives in memory; time comes from `clock()`.
// The service never returns or logs plaintext comments and never stores a student id.
import { mockSummarize } from "./agent.js";
import { AuditLog, type AuditEntry, type VerifyResult } from "./audit.js";
import type { FeedbackBatch } from "./fixtures.js";
import { NotAuthorizedError, type LeaseToken, type TideGateway } from "./gateway.js";
import {
  approve as approveLease,
  createLeaseRequest,
  effectiveStatus,
  LeaseError,
  reject as rejectLease,
  remainingMs,
  type Approver,
  type EffectiveStatus,
  type LeaseRequest,
} from "./lease.js";
import { buildRelationshipPolicy } from "./policy.js";
import { probeAccess, type ProbeRow } from "./probe.js";
import { approvalThreshold } from "./threshold.js";

export interface TruthVoiceServiceOptions {
  gateway: TideGateway;
  approvers: Approver[];
  agentId: string;
  vendorId: string;
  operatorId: string;
  clock: () => number;
}

export type FeedbackRow = { rowId: string; recordId: string; courseCode: string; ciphertext: string; at: number };
export type CourseInfo = { courseCode: string; recordId: string; comments: number };
export type LeaseView = LeaseRequest & { effectiveStatus: EffectiveStatus; remainingMs: number };
export type SummariserResult =
  | { ok: true; summary: string; comments: number }
  | { ok: false; reason: "NO_ACTIVE_LEASE" };

const MAX_COMMENT_LENGTH = 1000;
const POLICY_EXPIRY_SECONDS = 900;
const DEFAULT_TTL_SECONDS = 900;
const SEMESTER_LINE = "Semester: 2026 S2";
const BLOCKED: SummariserResult = { ok: false, reason: "NO_ACTIVE_LEASE" };

export function recordIdFor(courseCode: string): string {
  return "fb-" + courseCode.toLowerCase();
}

function commentBodies(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.startsWith("Comment:"))
    .map((l) => l.slice("Comment:".length).trim());
}

export function createTruthVoiceService(opts: TruthVoiceServiceOptions) {
  const { gateway, agentId, vendorId, clock } = opts;
  const approverIds = new Set(opts.approvers.map((a) => a.id));
  const adminCount = opts.approvers.length;
  const log = new AuditLog();
  const rows: FeedbackRow[] = [];
  const leases: LeaseRequest[] = [];
  let leaseCounter = 0;

  const copyLease = (req: LeaseRequest): LeaseRequest => ({ ...req, approvals: [...req.approvals] });

  function findLease(leaseId: string): number {
    const i = leases.findIndex((l) => l.id === leaseId);
    if (i < 0) throw new LeaseError(`unknown lease ${leaseId}`);
    return i;
  }

  function assertApprover(approverId: string): void {
    if (!approverIds.has(approverId)) throw new LeaseError(`${approverId} is not an enrolled approver`);
  }

  function latestLease(recordId: string): LeaseRequest | undefined {
    for (let i = leases.length - 1; i >= 0; i--) if (leases[i].recordId === recordId) return leases[i];
    return undefined;
  }

  /** Signed token for the latest lease of the record when it is ACTIVE and the gateway signs it. */
  async function currentToken(recordId: string, now: number): Promise<LeaseToken | undefined> {
    const req = latestLease(recordId);
    if (!req || effectiveStatus(req, now) !== "ACTIVE") return undefined;
    try {
      return await gateway.signLease(copyLease(req), now);
    } catch (err) {
      if (err instanceof NotAuthorizedError) return undefined;
      throw err;
    }
  }

  async function submitFeedback(input: { courseCode: string; comment: string }): Promise<FeedbackRow> {
    const courseCode = typeof input.courseCode === "string" ? input.courseCode.trim() : "";
    const comment = typeof input.comment === "string" ? input.comment.trim() : "";
    if (courseCode.length === 0) throw new Error("courseCode must be non-empty");
    if (comment.length === 0) throw new Error("comment must be non-empty");
    if (comment.length > MAX_COMMENT_LENGTH) throw new Error(`comment must be at most ${MAX_COMMENT_LENGTH} characters`);

    const at = clock();
    const recordId = recordIdFor(courseCode);
    const policy = buildRelationshipPolicy({
      subjectType: "User",
      subjectId: agentId,
      recordId,
      roles: ["_tide_decryptor"],
      vendorId,
      expirySeconds: POLICY_EXPIRY_SECONDS,
    });
    const ciphertext = await gateway.encryptRecord(recordId, "Comment: " + comment, policy);
    // Row number is assigned only after a successful encryption: rejected submissions consume none.
    const row: FeedbackRow = { rowId: `row-${rows.length + 1}`, recordId, courseCode, ciphertext, at };
    rows.push(row);
    log.append({ at, actor: "student", action: "FEEDBACK_SUBMITTED", recordId });
    return { ...row };
  }

  async function seed(batches: FeedbackBatch[]): Promise<void> {
    for (const b of batches) {
      for (const comment of commentBodies(b.text)) await submitFeedback({ courseCode: b.courseCode, comment });
    }
  }

  function listRows(): FeedbackRow[] {
    return rows.map((r) => ({ ...r }));
  }

  function listCourses(): CourseInfo[] {
    const byCode = new Map<string, CourseInfo>();
    for (const r of rows) {
      const c = byCode.get(r.courseCode);
      if (c) c.comments++;
      else byCode.set(r.courseCode, { courseCode: r.courseCode, recordId: r.recordId, comments: 1 });
    }
    return [...byCode.values()].map((c) => ({ ...c }));
  }

  function requestSummary(input: { courseCode: string; requestedBy: string; ttlSeconds?: number }): LeaseRequest {
    const now = clock();
    const recordId = recordIdFor(input.courseCode);
    const req = createLeaseRequest({
      id: `lease-${leaseCounter + 1}`,
      agentId,
      recordId,
      purpose: "AI theme summary for " + input.courseCode,
      requestedBy: input.requestedBy,
      now,
      ttlSeconds: input.ttlSeconds ?? DEFAULT_TTL_SECONDS,
      adminCount,
    });
    leaseCounter++;
    leases.push(req);
    log.append({ at: now, actor: input.requestedBy, action: "LEASE_REQUESTED", recordId });
    return copyLease(req);
  }

  function approve(input: { leaseId: string; approverId: string }): LeaseRequest {
    const i = findLease(input.leaseId);
    assertApprover(input.approverId);
    const now = clock();
    const before = leases[i];
    const next = approveLease(before, { id: input.approverId, isAgent: input.approverId === agentId }, now);
    leases[i] = next;
    if (next.approvals.length !== before.approvals.length) {
      log.append({
        at: now,
        actor: input.approverId,
        action: "LEASE_APPROVED",
        recordId: next.recordId,
        detail: `${next.approvals.length} of ${approvalThreshold(next.adminCount)}`,
      });
    }
    return copyLease(next);
  }

  function reject(input: { leaseId: string; approverId: string }): LeaseRequest {
    const i = findLease(input.leaseId);
    assertApprover(input.approverId);
    const now = clock();
    const next = rejectLease(leases[i], { id: input.approverId, isAgent: input.approverId === agentId }, now);
    leases[i] = next;
    log.append({ at: now, actor: input.approverId, action: "LEASE_REJECTED", recordId: next.recordId });
    return copyLease(next);
  }

  function listLeases(): LeaseView[] {
    const now = clock();
    return leases.map((req) => ({
      ...copyLease(req),
      effectiveStatus: effectiveStatus(req, now),
      remainingMs: remainingMs(req, now),
    }));
  }

  async function runSummariser(input: { courseCode: string }): Promise<SummariserResult> {
    const now = clock();
    const recordId = recordIdFor(input.courseCode);
    const blocked = (): SummariserResult => {
      log.append({ at: now, actor: agentId, action: "AGENT_BLOCKED", recordId });
      return { ...BLOCKED };
    };

    const token = await currentToken(recordId, now);
    if (!token) return blocked();

    const lines: string[] = [];
    for (const row of rows) {
      if (row.recordId !== recordId) continue;
      try {
        lines.push(await gateway.decryptRecord(recordId, row.ciphertext, { id: agentId }, now, token));
      } catch (err) {
        if (err instanceof NotAuthorizedError) return blocked();
        throw err;
      }
    }
    const text = [`Course: ${input.courseCode}`, SEMESTER_LINE, ...lines].join("\n");
    const summary = mockSummarize(text);
    log.append({ at: now, actor: agentId, action: "AGENT_READ", recordId });
    return { ok: true, summary, comments: lines.length };
  }

  async function probe(input: { courseCode: string }): Promise<ProbeRow[]> {
    const now = clock();
    const recordId = recordIdFor(input.courseCode);
    const first = rows.find((r) => r.recordId === recordId);
    if (!first) throw new Error(`no feedback stored for course ${input.courseCode}`);
    const other = rows.find((r) => r.recordId !== recordId) ?? first;
    const token = await currentToken(recordId, now);
    return probeAccess({
      gateway,
      recordId,
      ciphertext: first.ciphertext,
      otherRecordCiphertext: other.ciphertext,
      now,
      token,
    });
  }

  function audit(): { entries: AuditEntry[]; verify: VerifyResult } {
    return { entries: log.entries(), verify: log.verify() };
  }

  function tamperDemo(): VerifyResult {
    const copy = log.entries();
    if (copy.length >= 2) copy[1] = { ...copy[1], actor: "someone-else" };
    return log.verify(copy);
  }

  return {
    recordIdFor,
    submitFeedback,
    seed,
    listRows,
    listCourses,
    requestSummary,
    approve,
    reject,
    listLeases,
    runSummariser,
    probe,
    audit,
    tamperDemo,
  };
}

export type TruthVoiceService = ReturnType<typeof createTruthVoiceService>;
