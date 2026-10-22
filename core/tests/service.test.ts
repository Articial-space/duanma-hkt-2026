// S10 TruthVoice service tests (SPEC v4, AC-13). Deterministic: a controllable clock, explicit values only.
import { describe, expect, it } from "vitest";
import { mockSummarize } from "../src/agent.js";
import { AuditLog } from "../src/audit.js";
import {
  AGENT_ID,
  APPROVERS,
  OPERATOR_ID,
  REQUESTER_ID,
  SYNTHETIC_FEEDBACK,
  VENDOR_ID,
} from "../src/fixtures.js";
import { MockTideGateway, type LeaseToken, type TideGateway } from "../src/gateway.js";
import { LeaseError, type LeaseRequest } from "../src/lease.js";
import { buildRelationshipPolicy } from "../src/policy.js";
import * as serviceModule from "../src/service.js";
import { createTruthVoiceService } from "../src/service.js";
import { SUMMARY_1, SUMMARY_2, T0, activeRequest, commentsOf, fourWordLeak } from "./helpers.js";

// ---------------------------------------------------------------------------------------------
// Local, deliberately loose view of the service API (only what SPEC S10 states). Every call is
// awaited so both sync and async implementations satisfy the contract.
type Row = { rowId: string; recordId: string; courseCode: string; ciphertext: string; at: number };
type Course = { courseCode: string; recordId: string; comments: number };
type Lease = Record<string, unknown> & {
  id: string;
  status: string;
  approvals: string[];
  effectiveStatus?: string;
  remainingMs?: number;
  expiresAt?: number;
  grantedAt?: number;
};
type Entry = { seq: number; at: number; actor: string; action: string; recordId?: string | null; detail?: string | null };
type ProbeRow = { who: string; attempt: string; result: "READ" | "BLOCKED" };
type Svc = {
  recordIdFor?: (c: string) => string;
  submitFeedback(i: { courseCode: string; comment: string }): Promise<Row> | Row;
  seed(b: unknown): Promise<unknown> | unknown;
  listRows(): Promise<Row[]> | Row[];
  listCourses(): Promise<Course[]> | Course[];
  requestSummary(i: { courseCode: string; requestedBy: string; ttlSeconds?: number }): Promise<Lease> | Lease;
  approve(i: { leaseId: string; approverId: string }): unknown;
  reject(i: { leaseId: string; approverId: string }): unknown;
  listLeases(): Promise<Lease[]> | Lease[];
  runSummariser(i: { courseCode: string }): Promise<Record<string, unknown>>;
  probe(i: { courseCode: string }): Promise<ProbeRow[]>;
  audit(): Promise<{ entries: Entry[]; verify: unknown }> | { entries: Entry[]; verify: unknown };
  tamperDemo(): unknown;
};

const SECRET = "service-test-secret";
const APPROVER_IDS = APPROVERS.map((a) => a.id);
const TTL_MS = 900 * 1000;
const BLOCKED = { ok: false, reason: "NO_ACTIVE_LEASE" };
const WHO = [
  "University IT admin (database + server)",
  "Lecturer",
  "IT admin with forged lease",
  "AI summariser, no lease",
  "AI summariser with lease",
  "AI summariser, lease on another course",
];

// Comment bodies whose mockSummarize output is hand-computed in helpers.ts (SUMMARY_1 / SUMMARY_2).
const C1 = ["The assessment rubric was unclear", "Marking criteria changed twice", "Slides were clear", "Lab sessions were rushed"];
const C2 = ["Office hours were useful", "Consultation slots filled quickly", "The readings were too long"];

type Call = { recordId: string; ciphertext: string; caller: { id: string }; now: number; token?: LeaseToken };
type Spy = { decrypts: Call[]; encrypts: Array<{ recordId: string; plaintext: string; policy: unknown }>; signs: number };

function spyGateway(inner: TideGateway, spy: Spy): TideGateway {
  return {
    encryptRecord: (recordId, plaintext, policy) => {
      spy.encrypts.push({ recordId, plaintext, policy });
      return inner.encryptRecord(recordId, plaintext, policy);
    },
    signLease: (req, now) => {
      spy.signs++;
      return inner.signLease(req, now);
    },
    decryptRecord: (recordId, ciphertext, caller, now, token) => {
      spy.decrypts.push({ recordId, ciphertext, caller, now, token });
      return inner.decryptRecord(recordId, ciphertext, caller, now, token);
    },
  };
}

async function setup(opts: { gatewayApprovers?: string[] } = {}) {
  const clock = { now: T0 };
  const inner = new MockTideGateway({ secret: SECRET, approvers: opts.gatewayApprovers ?? APPROVER_IDS });
  const spy: Spy = { decrypts: [], encrypts: [], signs: 0 };
  const gateway = spyGateway(inner, spy);
  const svc = (await createTruthVoiceService({
    gateway,
    approvers: APPROVERS,
    agentId: AGENT_ID,
    vendorId: VENDOR_ID,
    operatorId: OPERATOR_ID,
    clock: () => clock.now,
  } as unknown as Parameters<typeof createTruthVoiceService>[0])) as unknown as Svc;
  return { svc, clock, inner, spy };
}

/** Runs fn and returns the thrown/rejected error (sync throw or async rejection), or undefined. */
async function caught(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

async function submitAll(svc: Svc, courseCode: string, comments: string[]) {
  for (const comment of comments) await svc.submitFeedback({ courseCode, comment });
}

async function entries(svc: Svc): Promise<Entry[]> {
  return (await svc.audit()).entries;
}

async function verifyOf(svc: Svc): Promise<unknown> {
  const v = (await svc.audit()).verify;
  // SPEC: "{ entries, verify } from the S4 log" — accept the verify result or a function returning it.
  return typeof v === "function" ? await (v as () => unknown)() : v;
}

async function leaseById(svc: Svc, id: string): Promise<Lease> {
  const l = (await svc.listLeases()).find((x) => x.id === id);
  expect(l, `lease ${id} listed`).toBeDefined();
  return l!;
}

/** DEMO1001 with C1, then lease-1 approved by student-rep (T0+1000) and dean (T0+2000) -> ACTIVE. */
async function activeDemo1001() {
  const ctx = await setup();
  await submitAll(ctx.svc, "DEMO1001", C1);
  const req = await ctx.svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
  ctx.clock.now = T0 + 1000;
  await ctx.svc.approve({ leaseId: req.id, approverId: "student-rep" });
  ctx.clock.now = T0 + 2000;
  await ctx.svc.approve({ leaseId: req.id, approverId: "dean" });
  return { ...ctx, leaseId: req.id, grantAt: T0 + 2000 };
}

function noPlaintext(blob: string, comments: string[]) {
  for (const c of comments) expect(blob, "comment text leaked").not.toContain(c);
  expect(fourWordLeak(blob, comments), "4-word comment run leaked").toBeNull();
}

// ---------------------------------------------------------------------------------------------
describe("S10 recordIdFor", () => {
  it("is 'fb-' + lower-cased course code (exported or on the service)", async () => {
    const { svc } = await setup();
    const fn = (serviceModule as unknown as Record<string, unknown>).recordIdFor ?? svc.recordIdFor;
    expect(typeof fn, "recordIdFor exported from service.ts or exposed on the service").toBe("function");
    const f = fn as (c: string) => string;
    expect(f("DEMO1001")).toBe("fb-demo1001");
    expect(f("AbC12")).toBe("fb-abc12");
  });

  it("rows use recordIdFor(courseCode) as their recordId", async () => {
    const { svc } = await setup();
    const a = await svc.submitFeedback({ courseCode: "DEMO1001", comment: "Slides were clear" });
    const b = await svc.submitFeedback({ courseCode: "Cosc2X", comment: "Labs were useful" });
    expect(a.recordId).toBe("fb-demo1001");
    expect(b.recordId).toBe("fb-cosc2x");
  });
});

describe("S10 submitFeedback stores ciphertext only", () => {
  it("returns and stores a row {rowId, recordId, courseCode, ciphertext, at} with 1-based increasing row ids", async () => {
    const { svc, clock } = await setup();
    clock.now = T0 + 10;
    const r1 = await svc.submitFeedback({ courseCode: "DEMO1001", comment: C1[0] });
    clock.now = T0 + 20;
    const r2 = await svc.submitFeedback({ courseCode: "DEMO2002", comment: C2[0] });
    clock.now = T0 + 30;
    const r3 = await svc.submitFeedback({ courseCode: "DEMO1001", comment: C1[1] });
    for (const r of [r1, r2, r3]) {
      expect(Object.keys(r).sort()).toEqual(["at", "ciphertext", "courseCode", "recordId", "rowId"]);
    }
    expect([r1.rowId, r2.rowId, r3.rowId]).toEqual(["row-1", "row-2", "row-3"]);
    expect([r1.courseCode, r2.courseCode, r3.courseCode]).toEqual(["DEMO1001", "DEMO2002", "DEMO1001"]);
    expect([r1.at, r2.at, r3.at]).toEqual([T0 + 10, T0 + 20, T0 + 30]);
    const rows = await svc.listRows();
    expect(rows).toEqual([r1, r2, r3]);
  });

  it("ciphertext is the gateway's opaque output and never contains the comment (plain or base64)", async () => {
    const { svc } = await setup();
    const comment = "The assessment rubric was unclear";
    const row = await svc.submitFeedback({ courseCode: "DEMO1001", comment });
    expect(row.ciphertext.startsWith("tide-mock:v1:")).toBe(true);
    expect(row.ciphertext).not.toContain(comment);
    expect(row.ciphertext).not.toContain(Buffer.from(comment).toString("base64"));
    expect(row.ciphertext).not.toContain(Buffer.from("Comment: " + comment).toString("base64"));
    noPlaintext(JSON.stringify(await svc.listRows()), [comment]);
  });

  it("encrypts 'Comment: ' + trimmed comment under recordId with the S10 RelationshipAttestation policy", async () => {
    const { svc, spy } = await setup();
    await svc.submitFeedback({ courseCode: "DEMO1001", comment: "   Lab sessions were rushed  \n" });
    expect(spy.encrypts.length).toBe(1);
    const e = spy.encrypts[0];
    expect(e.recordId).toBe("fb-demo1001");
    expect(e.plaintext).toBe("Comment: Lab sessions were rushed");
    expect(e.policy).toEqual(
      buildRelationshipPolicy({
        subjectType: "User",
        subjectId: AGENT_ID,
        recordId: "fb-demo1001",
        roles: ["_tide_decryptor"],
        vendorId: VENDOR_ID,
        expirySeconds: 900,
      }),
    );
  });

  it("the stored ciphertext decrypts (with a valid lease token for that record) to 'Comment: <trimmed>'", async () => {
    const { svc, inner } = await setup();
    const row = await svc.submitFeedback({ courseCode: "DEMO1001", comment: "  Slides were clear " });
    const req = activeRequest({ agentId: AGENT_ID, recordId: "fb-demo1001" });
    const token = await inner.signLease(req, T0 + 2001);
    const plain = await inner.decryptRecord("fb-demo1001", row.ciphertext, { id: AGENT_ID }, T0 + 2002, token);
    expect(plain).toBe("Comment: Slides were clear");
  });

  it("audits FEEDBACK_SUBMITTED as actor 'student' with the recordId, never the comment text", async () => {
    const { svc, clock } = await setup();
    clock.now = T0 + 77;
    await svc.submitFeedback({ courseCode: "DEMO1001", comment: C1[0] });
    const es = await entries(svc);
    const sub = es.filter((e) => e.action === "FEEDBACK_SUBMITTED");
    expect(sub.length).toBe(1);
    expect(sub[0].actor).toBe("student");
    expect(sub[0].recordId).toBe("fb-demo1001");
    expect(sub[0].at).toBe(T0 + 77);
    noPlaintext(JSON.stringify(es), [C1[0]]);
  });

  it("never stores or audits a student id even if the caller passes one", async () => {
    const { svc } = await setup();
    const studentId = "s9876543";
    await svc.submitFeedback({ courseCode: "DEMO1001", comment: C1[1], studentId } as unknown as {
      courseCode: string;
      comment: string;
    });
    const rows = await svc.listRows();
    expect(Object.keys(rows[0]).sort()).toEqual(["at", "ciphertext", "courseCode", "recordId", "rowId"]);
    const blob = JSON.stringify(rows) + JSON.stringify(await entries(svc));
    expect(blob).not.toContain(studentId);
    noPlaintext(blob, [C1[1]]);
  });

  it("listRows returns copies: mutating the result does not change stored rows", async () => {
    const { svc } = await setup();
    await svc.submitFeedback({ courseCode: "DEMO1001", comment: C1[0] });
    const rows = await svc.listRows();
    rows[0].ciphertext = "tampered";
    rows[0].rowId = "row-999";
    rows.push({ ...rows[0] });
    const again = await svc.listRows();
    expect(again.length).toBe(1);
    expect(again[0].rowId).toBe("row-1");
    expect(again[0].ciphertext.startsWith("tide-mock:v1:")).toBe(true);
  });
});

describe("S10 submitFeedback validation", () => {
  async function expectRejected(input: { courseCode: string; comment: string }) {
    const { svc } = await setup();
    const err = await caught(() => svc.submitFeedback(input));
    expect(err, JSON.stringify(input).slice(0, 80)).toBeInstanceOf(Error);
    expect(await svc.listRows()).toEqual([]);
    expect((await entries(svc)).filter((e) => e.action === "FEEDBACK_SUBMITTED")).toEqual([]);
  }

  it("rejects an empty comment", async () => {
    await expectRejected({ courseCode: "DEMO1001", comment: "" });
  });

  it("rejects a whitespace-only comment", async () => {
    await expectRejected({ courseCode: "DEMO1001", comment: "   \t\n " });
  });

  it("rejects a comment longer than 1000 characters", async () => {
    await expectRejected({ courseCode: "DEMO1001", comment: "a".repeat(1001) });
  });

  it("accepts a comment of exactly 1000 characters", async () => {
    const { svc } = await setup();
    const row = await svc.submitFeedback({ courseCode: "DEMO1001", comment: "a".repeat(1000) });
    expect(row.rowId).toBe("row-1");
    expect((await svc.listRows()).length).toBe(1);
  });

  it("rejects an empty course code", async () => {
    await expectRejected({ courseCode: "", comment: "Slides were clear" });
  });

  it("a rejected submission does not consume a row number", async () => {
    const { svc } = await setup();
    await caught(() => svc.submitFeedback({ courseCode: "DEMO1001", comment: "" }));
    const row = await svc.submitFeedback({ courseCode: "DEMO1001", comment: "Slides were clear" });
    expect(row.rowId).toBe("row-1");
  });
});

describe("S10 seed and listCourses", () => {
  it("seed submits one row per Comment: line of each S7 batch, with that batch's course code", async () => {
    const { svc, spy } = await setup();
    await svc.seed(SYNTHETIC_FEEDBACK);
    const rows = await svc.listRows();
    const expected = SYNTHETIC_FEEDBACK.flatMap((b) => commentsOf(b.text).map(() => b.courseCode));
    expect(rows.map((r) => r.courseCode)).toEqual(expected);
    expect(rows.map((r) => r.rowId)).toEqual(expected.map((_, i) => `row-${i + 1}`));
    expect(rows.map((r) => r.recordId)).toEqual(expected.map((c) => "fb-" + c.toLowerCase()));
    // plaintexts handed to the gateway are exactly the batch comment lines, in order
    const lines = SYNTHETIC_FEEDBACK.flatMap((b) => commentsOf(b.text).map((c) => "Comment: " + c));
    expect(spy.encrypts.map((e) => e.plaintext)).toEqual(lines);
    const allComments = SYNTHETIC_FEEDBACK.flatMap((b) => commentsOf(b.text));
    noPlaintext(JSON.stringify(rows) + JSON.stringify(await entries(svc)), allComments);
  });

  it("listCourses after seed: three courses in fixture order with per-course comment counts", async () => {
    const { svc } = await setup();
    await svc.seed(SYNTHETIC_FEEDBACK);
    const courses = await svc.listCourses();
    expect(courses).toEqual(
      SYNTHETIC_FEEDBACK.map((b) => ({
        courseCode: b.courseCode,
        recordId: "fb-" + b.courseCode.toLowerCase(),
        comments: commentsOf(b.text).length,
      })),
    );
    expect(courses.map((c) => c.courseCode)).toEqual(["DEMO1001", "DEMO2002", "DEMO3003"]);
  });

  it("listCourses lists distinct courses in first-seen order", async () => {
    const { svc } = await setup();
    await svc.submitFeedback({ courseCode: "DEMO2002", comment: C2[0] });
    await svc.submitFeedback({ courseCode: "DEMO1001", comment: C1[0] });
    await svc.submitFeedback({ courseCode: "DEMO2002", comment: C2[1] });
    expect(await svc.listCourses()).toEqual([
      { courseCode: "DEMO2002", recordId: "fb-demo2002", comments: 2 },
      { courseCode: "DEMO1001", recordId: "fb-demo1001", comments: 1 },
    ]);
  });

  it("listCourses is empty before any feedback", async () => {
    const { svc } = await setup();
    expect(await svc.listCourses()).toEqual([]);
  });
});

describe("S10 requestSummary", () => {
  it("creates a PENDING lease 'lease-1' with the S10 fields and default ttl 900", async () => {
    const { svc, clock } = await setup();
    clock.now = T0 + 5;
    const req = await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    expect(req.id).toBe("lease-1");
    expect(req.status).toBe("PENDING");
    expect(req.approvals).toEqual([]);
    expect(req).toMatchObject({
      agentId: AGENT_ID,
      recordId: "fb-demo1001",
      purpose: "AI theme summary for DEMO1001",
      requestedBy: REQUESTER_ID,
      createdAt: T0 + 5,
      ttlSeconds: 900,
      adminCount: 3,
    });
    const listed = await leaseById(svc, "lease-1");
    expect(listed).toMatchObject({ id: "lease-1", status: "PENDING", recordId: "fb-demo1001" });
  });

  it("numbers leases lease-1, lease-2, ... and honours an explicit ttlSeconds", async () => {
    const { svc } = await setup();
    const a = await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    const b = await svc.requestSummary({ courseCode: "DEMO2002", requestedBy: REQUESTER_ID, ttlSeconds: 120 });
    expect([a.id, b.id]).toEqual(["lease-1", "lease-2"]);
    expect(b.ttlSeconds).toBe(120);
    expect(b.recordId).toBe("fb-demo2002");
    expect(b.purpose).toBe("AI theme summary for DEMO2002");
    expect((await svc.listLeases()).map((l) => l.id)).toEqual(["lease-1", "lease-2"]);
  });

  it("an invalid ttl (S3 bounds) is refused with LeaseError", async () => {
    const { svc } = await setup();
    const err = await caught(() => svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID, ttlSeconds: 30 }));
    expect(err).toBeInstanceOf(LeaseError);
  });

  it("audits LEASE_REQUESTED for the record", async () => {
    const { svc } = await setup();
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    const es = (await entries(svc)).filter((e) => e.action === "LEASE_REQUESTED");
    expect(es.length).toBe(1);
    expect(es[0].recordId).toBe("fb-demo1001");
  });
});

describe("S10 approve / reject", () => {
  it("one approval leaves the lease PENDING (1 of 2); the second makes it ACTIVE at clock() with expiry +ttl", async () => {
    const { svc, clock } = await setup();
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    clock.now = T0 + 1000;
    await svc.approve({ leaseId: "lease-1", approverId: "student-rep" });
    let l = await leaseById(svc, "lease-1");
    expect(l.status).toBe("PENDING");
    expect(l.approvals).toEqual(["student-rep"]);
    clock.now = T0 + 2000;
    await svc.approve({ leaseId: "lease-1", approverId: "dean" });
    l = await leaseById(svc, "lease-1");
    expect(l.status).toBe("ACTIVE");
    expect(l.approvals).toEqual(["student-rep", "dean"]);
    expect(l.grantedAt).toBe(T0 + 2000);
    expect(l.expiresAt).toBe(T0 + 2000 + TTL_MS);
  });

  it("audits LEASE_APPROVED with detail '<k> of <threshold>'", async () => {
    const { svc } = await activeDemo1001();
    const es = (await entries(svc)).filter((e) => e.action === "LEASE_APPROVED");
    expect(es.map((e) => e.detail)).toEqual(["1 of 2", "2 of 2"]);
    expect(es.map((e) => e.recordId)).toEqual(["fb-demo1001", "fb-demo1001"]);
  });

  it("refuses a non-approver (university IT admin) with LeaseError and leaves the lease unchanged", async () => {
    const { svc } = await setup();
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    const before = await leaseById(svc, "lease-1");
    const err = await caught(() => svc.approve({ leaseId: "lease-1", approverId: OPERATOR_ID }));
    expect(err).toBeInstanceOf(LeaseError);
    expect(await leaseById(svc, "lease-1")).toEqual(before);
    expect((await entries(svc)).filter((e) => e.action === "LEASE_APPROVED")).toEqual([]);
  });

  it("refuses an unknown id that is neither agent nor requester (non-approver rule is the service's own)", async () => {
    const { svc } = await setup();
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    expect(await caught(() => svc.approve({ leaseId: "lease-1", approverId: "random-person" }))).toBeInstanceOf(LeaseError);
    expect(await caught(() => svc.reject({ leaseId: "lease-1", approverId: "random-person" }))).toBeInstanceOf(LeaseError);
    expect((await leaseById(svc, "lease-1")).status).toBe("PENDING");
  });

  it("refuses the AI agent and the requesting lecturer with LeaseError", async () => {
    const { svc } = await setup();
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    expect(await caught(() => svc.approve({ leaseId: "lease-1", approverId: AGENT_ID }))).toBeInstanceOf(LeaseError);
    expect(await caught(() => svc.approve({ leaseId: "lease-1", approverId: REQUESTER_ID }))).toBeInstanceOf(LeaseError);
    expect(await caught(() => svc.reject({ leaseId: "lease-1", approverId: AGENT_ID }))).toBeInstanceOf(LeaseError);
    const l = await leaseById(svc, "lease-1");
    expect(l.status).toBe("PENDING");
    expect(l.approvals).toEqual([]);
  });

  it("an approver cannot approve a lease they requested themselves (S3 self-approval)", async () => {
    const { svc } = await setup();
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: "dean" });
    expect(await caught(() => svc.approve({ leaseId: "lease-1", approverId: "dean" }))).toBeInstanceOf(LeaseError);
    expect((await leaseById(svc, "lease-1")).approvals).toEqual([]);
  });

  it("a repeat approval by the same approver does not reach quorum", async () => {
    const { svc } = await setup();
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    await svc.approve({ leaseId: "lease-1", approverId: "qa-officer" });
    await caught(() => svc.approve({ leaseId: "lease-1", approverId: "qa-officer" }));
    const l = await leaseById(svc, "lease-1");
    expect(l.status).toBe("PENDING");
    expect(l.approvals).toEqual(["qa-officer"]);
  });

  it("reject by an approver makes the lease REJECTED, audits LEASE_REJECTED, and further approval is refused", async () => {
    const { svc, clock } = await setup();
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    clock.now = T0 + 500;
    await svc.reject({ leaseId: "lease-1", approverId: "qa-officer" });
    const l = await leaseById(svc, "lease-1");
    expect(l.status).toBe("REJECTED");
    expect(l.rejectedBy).toBe("qa-officer");
    const es = (await entries(svc)).filter((e) => e.action === "LEASE_REJECTED");
    expect(es.length).toBe(1);
    expect(es[0].recordId).toBe("fb-demo1001");
    expect(await caught(() => svc.approve({ leaseId: "lease-1", approverId: "dean" }))).toBeInstanceOf(LeaseError);
    expect((await leaseById(svc, "lease-1")).status).toBe("REJECTED");
  });
});

describe("S10 listLeases effective status and remaining time", () => {
  it("PENDING lease: effectiveStatus PENDING, remainingMs 0", async () => {
    const { svc } = await setup();
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    const l = await leaseById(svc, "lease-1");
    expect(l.effectiveStatus).toBe("PENDING");
    expect(l.remainingMs).toBe(0);
  });

  it("ACTIVE lease: remainingMs follows the clock; at expiresAt it is EXPIRED with 0 remaining", async () => {
    const { svc, clock, grantAt } = await activeDemo1001();
    let l = await leaseById(svc, "lease-1");
    expect(l.effectiveStatus).toBe("ACTIVE");
    expect(l.remainingMs).toBe(TTL_MS);
    clock.now = grantAt + 60_000;
    l = await leaseById(svc, "lease-1");
    expect(l.effectiveStatus).toBe("ACTIVE");
    expect(l.remainingMs).toBe(TTL_MS - 60_000);
    clock.now = grantAt + TTL_MS - 1;
    expect((await leaseById(svc, "lease-1")).remainingMs).toBe(1);
    clock.now = grantAt + TTL_MS;
    l = await leaseById(svc, "lease-1");
    expect(l.status).toBe("ACTIVE");
    expect(l.effectiveStatus).toBe("EXPIRED");
    expect(l.remainingMs).toBe(0);
    clock.now = grantAt + 16 * 60_000;
    expect((await leaseById(svc, "lease-1")).effectiveStatus).toBe("EXPIRED");
  });

  it("REJECTED lease: effectiveStatus REJECTED", async () => {
    const { svc } = await setup();
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    await svc.reject({ leaseId: "lease-1", approverId: "dean" });
    const l = await leaseById(svc, "lease-1");
    expect(l.effectiveStatus).toBe("REJECTED");
    expect(l.remainingMs).toBe(0);
  });
});

describe("S10 runSummariser", () => {
  async function newAgentEntries(svc: Svc, before: number) {
    return (await entries(svc)).slice(before).filter((e) => e.action === "AGENT_READ" || e.action === "AGENT_BLOCKED");
  }

  it("BLOCKED with no lease at all; audits AGENT_BLOCKED once; nothing decrypted", async () => {
    const { svc, spy } = await setup();
    await submitAll(svc, "DEMO1001", C1);
    const n = (await entries(svc)).length;
    expect(await svc.runSummariser({ courseCode: "DEMO1001" })).toEqual(BLOCKED);
    const ag = await newAgentEntries(svc, n);
    expect(ag.map((e) => e.action)).toEqual(["AGENT_BLOCKED"]);
    expect(ag[0].recordId).toBe("fb-demo1001");
    expect(spy.decrypts.filter((c) => c.caller.id === AGENT_ID && c.token !== undefined)).toEqual([]);
  });

  it("BLOCKED before quorum (1 of 2 approvals)", async () => {
    const { svc, clock } = await setup();
    await submitAll(svc, "DEMO1001", C1);
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    clock.now = T0 + 1000;
    await svc.approve({ leaseId: "lease-1", approverId: "student-rep" });
    const n = (await entries(svc)).length;
    expect(await svc.runSummariser({ courseCode: "DEMO1001" })).toEqual(BLOCKED);
    expect((await newAgentEntries(svc, n)).map((e) => e.action)).toEqual(["AGENT_BLOCKED"]);
  });

  it("after 2 of 3 approvals returns the course summary and its comment count; audits AGENT_READ once", async () => {
    const { svc, clock, grantAt } = await activeDemo1001();
    await submitAll(svc, "DEMO2002", C2); // another course must not leak into the summary
    clock.now = grantAt + 1000;
    const n = (await entries(svc)).length;
    const res = await svc.runSummariser({ courseCode: "DEMO1001" });
    expect(res).toEqual({ ok: true, summary: SUMMARY_1, comments: 4 });
    const ag = await newAgentEntries(svc, n);
    expect(ag.map((e) => e.action)).toEqual(["AGENT_READ"]);
    expect(ag[0].recordId).toBe("fb-demo1001");
  });

  it("decrypts every row of that record (and only those) as the agent, with a signed token, at clock()", async () => {
    const { svc, clock, grantAt, spy } = await activeDemo1001();
    await submitAll(svc, "DEMO2002", C2);
    const rows = (await svc.listRows()).filter((r) => r.recordId === "fb-demo1001");
    clock.now = grantAt + 1234;
    spy.decrypts.length = 0;
    await svc.runSummariser({ courseCode: "DEMO1001" });
    expect(spy.signs).toBeGreaterThanOrEqual(1);
    expect(spy.decrypts.map((c) => c.ciphertext).sort()).toEqual(rows.map((r) => r.ciphertext).sort());
    for (const c of spy.decrypts) {
      expect(c.recordId).toBe("fb-demo1001");
      expect(c.caller).toEqual({ id: AGENT_ID });
      expect(c.now).toBe(grantAt + 1234);
      expect(c.token).toBeDefined();
      expect(c.token!.agentId).toBe(AGENT_ID);
      expect(c.token!.recordId).toBe("fb-demo1001");
    }
  });

  it("never returns or logs plaintext comments", async () => {
    const { svc, clock, grantAt } = await activeDemo1001();
    clock.now = grantAt + 1;
    const res = await svc.runSummariser({ courseCode: "DEMO1001" });
    expect(res.ok).toBe(true);
    noPlaintext(JSON.stringify(res), C1);
    noPlaintext(JSON.stringify(await entries(svc)), C1);
    expect(JSON.stringify(res)).not.toContain("Comment:");
  });

  it("BLOCKED once the clock reaches expiresAt (READ the instant before)", async () => {
    const { svc, clock, grantAt } = await activeDemo1001();
    clock.now = grantAt + TTL_MS - 1;
    expect((await svc.runSummariser({ courseCode: "DEMO1001" })).ok).toBe(true);
    clock.now = grantAt + TTL_MS;
    expect(await svc.runSummariser({ courseCode: "DEMO1001" })).toEqual(BLOCKED);
    clock.now = grantAt + 16 * 60_000;
    const n = (await entries(svc)).length;
    expect(await svc.runSummariser({ courseCode: "DEMO1001" })).toEqual(BLOCKED);
    expect((await newAgentEntries(svc, n)).map((e) => e.action)).toEqual(["AGENT_BLOCKED"]);
  });

  it("an ACTIVE lease for another course does not unlock this course", async () => {
    const { svc, clock, grantAt } = await activeDemo1001();
    await submitAll(svc, "DEMO2002", C2);
    clock.now = grantAt + 1;
    expect(await svc.runSummariser({ courseCode: "DEMO2002" })).toEqual(BLOCKED);
  });

  it("uses the most recent lease for the record: a newer PENDING request blocks", async () => {
    const { svc, clock, grantAt } = await activeDemo1001();
    clock.now = grantAt + 1;
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    expect(await svc.runSummariser({ courseCode: "DEMO1001" })).toEqual(BLOCKED);
  });

  it("a REJECTED lease blocks", async () => {
    const { svc } = await setup();
    await submitAll(svc, "DEMO1001", C1);
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    await svc.reject({ leaseId: "lease-1", approverId: "dean" });
    expect(await svc.runSummariser({ courseCode: "DEMO1001" })).toEqual(BLOCKED);
  });

  it("a NotAuthorizedError from signLease counts as blocked (gateway does not recognise the approvers)", async () => {
    const { svc, clock } = await setup({ gatewayApprovers: ["other-a", "other-b", "other-c"] });
    await submitAll(svc, "DEMO1001", C1);
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    await svc.approve({ leaseId: "lease-1", approverId: "student-rep" });
    await svc.approve({ leaseId: "lease-1", approverId: "dean" });
    expect((await leaseById(svc, "lease-1")).effectiveStatus).toBe("ACTIVE");
    clock.now = T0 + 10;
    const n = (await entries(svc)).length;
    expect(await svc.runSummariser({ courseCode: "DEMO1001" })).toEqual(BLOCKED);
    expect((await newAgentEntries(svc, n)).map((e) => e.action)).toEqual(["AGENT_BLOCKED"]);
  });

  it("summarises a second course from its own rows (hand-computed SUMMARY_2)", async () => {
    const { svc, clock } = await setup();
    await submitAll(svc, "DEMO1001", C1);
    await submitAll(svc, "DEMO2002", C2);
    await svc.requestSummary({ courseCode: "DEMO2002", requestedBy: REQUESTER_ID });
    await svc.approve({ leaseId: "lease-1", approverId: "qa-officer" });
    await svc.approve({ leaseId: "lease-1", approverId: "student-rep" });
    clock.now = T0 + 1;
    expect(await svc.runSummariser({ courseCode: "DEMO2002" })).toEqual({ ok: true, summary: SUMMARY_2, comments: 3 });
  });

  it("on seeded data: summary equals mockSummarize of 'Course: <code>', 'Semester: 2026 S2' and the course's comment lines", async () => {
    const { svc, clock } = await setup();
    await svc.seed(SYNTHETIC_FEEDBACK);
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    await svc.approve({ leaseId: "lease-1", approverId: "student-rep" });
    await svc.approve({ leaseId: "lease-1", approverId: "dean" });
    clock.now = T0 + 60_000;
    const fb1 = SYNTHETIC_FEEDBACK.find((b) => b.courseCode === "DEMO1001")!;
    const comments = commentsOf(fb1.text);
    const text = ["Course: DEMO1001", "Semester: 2026 S2", ...comments.map((c) => "Comment: " + c)].join("\n");
    const res = await svc.runSummariser({ courseCode: "DEMO1001" });
    expect(res).toEqual({ ok: true, summary: mockSummarize(text), comments: comments.length });
    expect(String(res.summary)).toMatch(/^SUMMARY: DEMO1001 .* themes: assessment \(/);
    noPlaintext(JSON.stringify(res), comments);
  });
});

// ---------------------------------------------------------------------------------------------
// Mutant M4 gap: SPEC S10 says runSummariser asks for a token ONLY when the most recent lease's
// effective status is ACTIVE. The real MockTideGateway also refuses non-active leases, so the
// service's own check must be pinned with a gateway that would sign anything: this stub forges a
// quorum-complete, unexpired copy of whatever request it is given before passing it to a real
// MockTideGateway, so the resulting token really decrypts.
describe("S10 runSummariser checks the lease status itself (gateway would sign any lease)", () => {
  type Counts = { signs: number; decrypts: number };

  function forgeActive(req: LeaseRequest, now: number): LeaseRequest {
    const { rejectedBy: _ignored, ...rest } = req as unknown as Record<string, unknown>;
    return {
      ...rest,
      status: "ACTIVE",
      approvals: APPROVER_IDS.filter((id) => id !== req.requestedBy && id !== req.agentId),
      grantedAt: now,
      expiresAt: now + req.ttlSeconds * 1000,
    } as unknown as LeaseRequest;
  }

  function permissiveGateway(inner: MockTideGateway, counts: Counts): TideGateway {
    return {
      encryptRecord: (recordId, plaintext, policy) => inner.encryptRecord(recordId, plaintext, policy),
      signLease: (req, now) => {
        counts.signs++;
        return inner.signLease(forgeActive(req, now), now);
      },
      decryptRecord: (recordId, ciphertext, caller, now, token) => {
        counts.decrypts++;
        return inner.decryptRecord(recordId, ciphertext, caller, now, token);
      },
    };
  }

  async function setupPermissive() {
    const clock = { now: T0 };
    const counts: Counts = { signs: 0, decrypts: 0 };
    const inner = new MockTideGateway({ secret: SECRET, approvers: APPROVER_IDS });
    const gateway = permissiveGateway(inner, counts);
    const svc = (await createTruthVoiceService({
      gateway,
      approvers: APPROVERS,
      agentId: AGENT_ID,
      vendorId: VENDOR_ID,
      operatorId: OPERATOR_ID,
      clock: () => clock.now,
    } as unknown as Parameters<typeof createTruthVoiceService>[0])) as unknown as Svc;
    await submitAll(svc, "DEMO1001", C1);
    const req = await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    return { svc, clock, counts, gateway, leaseId: req.id };
  }
  type Ctx = Awaited<ReturnType<typeof setupPermissive>>;

  /** runSummariser at the current clock: BLOCKED, no signLease/decryptRecord call, exactly one AGENT_BLOCKED added. */
  async function expectBlockedWithoutGateway(ctx: Ctx) {
    const n = (await entries(ctx.svc)).length;
    ctx.counts.signs = 0;
    ctx.counts.decrypts = 0;
    expect(await ctx.svc.runSummariser({ courseCode: "DEMO1001" })).toEqual(BLOCKED);
    expect(ctx.counts.signs, "gateway.signLease must not be called for a non-active lease").toBe(0);
    expect(ctx.counts.decrypts, "gateway.decryptRecord must not be called for a non-active lease").toBe(0);
    const added = (await entries(ctx.svc)).slice(n);
    const blocked = added.filter((e) => e.action === "AGENT_BLOCKED");
    expect(blocked.length).toBe(1);
    expect(blocked[0].recordId).toBe("fb-demo1001");
    expect(added.filter((e) => e.action === "AGENT_READ")).toEqual([]);
  }

  /** Non-vacuity: this stub really signs the stored non-active lease, and the token decrypts a row. */
  async function expectStubWouldHaveRead(ctx: Ctx) {
    const lease = await leaseById(ctx.svc, ctx.leaseId);
    const row = (await ctx.svc.listRows())[0];
    const now = ctx.clock.now;
    const token = await ctx.gateway.signLease(lease as unknown as LeaseRequest, now);
    const plain = await ctx.gateway.decryptRecord(row.recordId, row.ciphertext, { id: AGENT_ID }, now, token);
    expect(plain).toBe("Comment: " + C1[0]);
  }

  it("control: with an ACTIVE lease the stub gateway is used and the summary is read", async () => {
    const ctx = await setupPermissive();
    await ctx.svc.approve({ leaseId: ctx.leaseId, approverId: "student-rep" });
    await ctx.svc.approve({ leaseId: ctx.leaseId, approverId: "dean" });
    ctx.clock.now = T0 + 1;
    expect(await ctx.svc.runSummariser({ courseCode: "DEMO1001" })).toEqual({ ok: true, summary: SUMMARY_1, comments: 4 });
    expect(ctx.counts.signs).toBeGreaterThanOrEqual(1);
    expect(ctx.counts.decrypts).toBe(4);
  });

  it("PENDING (1 of 2 approvals): NO_ACTIVE_LEASE without calling signLease or decryptRecord", async () => {
    const ctx = await setupPermissive();
    ctx.clock.now = T0 + 1000;
    await ctx.svc.approve({ leaseId: ctx.leaseId, approverId: "student-rep" });
    expect((await leaseById(ctx.svc, ctx.leaseId)).effectiveStatus).toBe("PENDING");
    await expectBlockedWithoutGateway(ctx);
    await expectStubWouldHaveRead(ctx);
  });

  it("REJECTED: NO_ACTIVE_LEASE without calling signLease or decryptRecord", async () => {
    const ctx = await setupPermissive();
    ctx.clock.now = T0 + 500;
    await ctx.svc.reject({ leaseId: ctx.leaseId, approverId: "dean" });
    expect((await leaseById(ctx.svc, ctx.leaseId)).effectiveStatus).toBe("REJECTED");
    await expectBlockedWithoutGateway(ctx);
    await expectStubWouldHaveRead(ctx);
  });

  it("EXPIRED (clock at and past expiresAt): NO_ACTIVE_LEASE without calling signLease or decryptRecord", async () => {
    const ctx = await setupPermissive();
    ctx.clock.now = T0 + 1000;
    await ctx.svc.approve({ leaseId: ctx.leaseId, approverId: "student-rep" });
    ctx.clock.now = T0 + 2000;
    await ctx.svc.approve({ leaseId: ctx.leaseId, approverId: "dean" });
    const grantAt = T0 + 2000;
    for (const now of [grantAt + TTL_MS, grantAt + 16 * 60_000]) {
      ctx.clock.now = now;
      expect((await leaseById(ctx.svc, ctx.leaseId)).effectiveStatus).toBe("EXPIRED");
      await expectBlockedWithoutGateway(ctx);
      await expectStubWouldHaveRead(ctx);
    }
  });
});

describe("S10 probe", () => {
  async function twoCourses() {
    const ctx = await activeDemo1001();
    await submitAll(ctx.svc, "DEMO2002", C2);
    return ctx;
  }

  it("before any lease: six rows in S9 order, all BLOCKED", async () => {
    const { svc } = await setup();
    await submitAll(svc, "DEMO1001", C1);
    await submitAll(svc, "DEMO2002", C2);
    const rows = await svc.probe({ courseCode: "DEMO1001" });
    expect(rows.map((r) => r.who)).toEqual(WHO);
    expect(rows.map((r) => r.result)).toEqual(Array(6).fill("BLOCKED"));
  });

  it("with a pending (1 of 2) lease: all BLOCKED", async () => {
    const { svc } = await setup();
    await submitAll(svc, "DEMO1001", C1);
    await submitAll(svc, "DEMO2002", C2);
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    await svc.approve({ leaseId: "lease-1", approverId: "dean" });
    const rows = await svc.probe({ courseCode: "DEMO1001" });
    expect(rows.map((r) => r.result)).toEqual(Array(6).fill("BLOCKED"));
  });

  it("with an ACTIVE lease: only 'AI summariser with lease' is READ", async () => {
    const { svc, clock, grantAt } = await twoCourses();
    clock.now = grantAt + 1;
    const rows = await svc.probe({ courseCode: "DEMO1001" });
    expect(rows.map((r) => r.who)).toEqual(WHO);
    expect(rows.map((r) => r.result)).toEqual(["BLOCKED", "BLOCKED", "BLOCKED", "BLOCKED", "READ", "BLOCKED"]);
  });

  it("after expiry: all BLOCKED again", async () => {
    const { svc, clock, grantAt } = await twoCourses();
    clock.now = grantAt + 16 * 60_000;
    const rows = await svc.probe({ courseCode: "DEMO1001" });
    expect(rows.map((r) => r.result)).toEqual(Array(6).fill("BLOCKED"));
  });

  it("probing the other course with this course's lease: all BLOCKED", async () => {
    const { svc, clock, grantAt } = await twoCourses();
    clock.now = grantAt + 1;
    const rows = await svc.probe({ courseCode: "DEMO2002" });
    expect(rows.map((r) => r.result)).toEqual(Array(6).fill("BLOCKED"));
  });

  it("probes the first row of the course with the current token; 'another course' uses the first row of a different course", async () => {
    const { svc, clock, grantAt, spy } = await twoCourses();
    const rows = await svc.listRows();
    const first1 = rows.find((r) => r.courseCode === "DEMO1001")!;
    const first2 = rows.find((r) => r.courseCode === "DEMO2002")!;
    clock.now = grantAt + 42;
    spy.decrypts.length = 0;
    await svc.probe({ courseCode: "DEMO1001" });
    expect(spy.decrypts.length).toBe(6);
    expect(spy.decrypts.every((c) => c.now === grantAt + 42)).toBe(true);
    expect(spy.decrypts.every((c) => c.recordId === "fb-demo1001")).toBe(true);
    expect(spy.decrypts.slice(0, 5).map((c) => c.ciphertext)).toEqual(Array(5).fill(first1.ciphertext));
    expect(spy.decrypts[5].ciphertext).toBe(first2.ciphertext);
    const lease = spy.decrypts[4];
    expect(lease.caller).toEqual({ id: AGENT_ID });
    expect(lease.token).toBeDefined();
    expect(lease.token!.leaseId).toBe("lease-1");
    expect(lease.token!.recordId).toBe("fb-demo1001");
    expect(lease.token!.expiresAt).toBe(grantAt + TTL_MS);
  });

  it("passes no token when the latest lease is not ACTIVE", async () => {
    const { svc, spy } = await setup();
    await submitAll(svc, "DEMO1001", C1);
    await submitAll(svc, "DEMO2002", C2);
    await svc.requestSummary({ courseCode: "DEMO1001", requestedBy: REQUESTER_ID });
    spy.decrypts.length = 0;
    await svc.probe({ courseCode: "DEMO1001" });
    expect(spy.decrypts.length).toBe(6);
    expect(spy.decrypts[4].token).toBeUndefined();
    expect(spy.decrypts[5].token).toBeUndefined();
  });

  it("with only one course, 'another course' falls back to the same ciphertext", async () => {
    const { svc, clock, grantAt, spy } = await activeDemo1001();
    const first = (await svc.listRows())[0];
    clock.now = grantAt + 1;
    spy.decrypts.length = 0;
    await svc.probe({ courseCode: "DEMO1001" });
    expect(spy.decrypts.length).toBe(6);
    expect(spy.decrypts[5].ciphertext).toBe(first.ciphertext);
  });
});

describe("S10 audit and tamperDemo", () => {
  async function story() {
    const ctx = await activeDemo1001();
    ctx.clock.now = ctx.grantAt + 1;
    await ctx.svc.runSummariser({ courseCode: "DEMO1001" });
    return ctx;
  }

  it("records the story's actions in order", async () => {
    const { svc } = await story();
    expect((await entries(svc)).map((e) => e.action)).toEqual([
      "FEEDBACK_SUBMITTED",
      "FEEDBACK_SUBMITTED",
      "FEEDBACK_SUBMITTED",
      "FEEDBACK_SUBMITTED",
      "LEASE_REQUESTED",
      "LEASE_APPROVED",
      "LEASE_APPROVED",
      "AGENT_READ",
    ]);
  });

  it("audit() verify is ok and the entries form a valid S4 hash chain", async () => {
    const { svc } = await story();
    expect(await verifyOf(svc)).toEqual({ ok: true });
    const es = await entries(svc);
    expect(es.map((e) => e.seq)).toEqual(es.map((_, i) => i));
    expect(new AuditLog().verify(es as never)).toEqual({ ok: true });
  });

  it("audit entries never contain comment text", async () => {
    const { svc } = await story();
    const blob = JSON.stringify(await entries(svc));
    noPlaintext(blob, C1);
    expect(blob).not.toContain("Comment:");
  });

  it("tamperDemo reports {ok:false, brokenAt:1} while the real log stays valid and unchanged", async () => {
    const { svc } = await story();
    const before = structuredClone(await entries(svc));
    expect(await svc.tamperDemo()).toEqual({ ok: false, brokenAt: 1 });
    expect(await verifyOf(svc)).toEqual({ ok: true });
    const after = await entries(svc);
    expect(after).toEqual(before);
    expect(after[1].actor).not.toBe("someone-else");
    // repeatable
    expect(await svc.tamperDemo()).toEqual({ ok: false, brokenAt: 1 });
    expect(await verifyOf(svc)).toEqual({ ok: true });
  });
});
