// S3 - access-request state machine (A-05, A-06, A-07, A-21).
// "Agent cannot approve" and "no self-approval" are application-level controls (C8).
import { approvalThreshold } from "./threshold.js";

export type LeaseStatus = "PENDING" | "ACTIVE" | "REJECTED" | "REVOKED";
export type EffectiveStatus = LeaseStatus | "EXPIRED";

export interface Approver {
  id: string;
  isAgent?: boolean;
}

export interface LeaseRequest {
  id: string;
  agentId: string;
  recordId: string;
  purpose: string;
  requestedBy: string;
  createdAt: number;
  ttlSeconds: number;
  adminCount: number;
  approvals: string[];
  status: LeaseStatus;
  grantedAt?: number;
  expiresAt?: number;
  revokedAt?: number;
  rejectedBy?: string;
}

export interface CreateLeaseInput {
  id: string;
  agentId: string;
  recordId: string;
  purpose: string;
  requestedBy: string;
  now: number;
  ttlSeconds: number;
  adminCount: number;
}

export class LeaseError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "LeaseError";
  }
}

const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 604800;

export function createLeaseRequest(input: CreateLeaseInput): LeaseRequest {
  const ttl = input.ttlSeconds;
  if (!Number.isInteger(ttl) || ttl < MIN_TTL_SECONDS || ttl > MAX_TTL_SECONDS) {
    throw new LeaseError(`ttlSeconds must be an integer in ${MIN_TTL_SECONDS}..${MAX_TTL_SECONDS}`);
  }
  if (typeof input.purpose !== "string" || input.purpose.trim().length === 0) {
    throw new LeaseError("purpose must be non-empty");
  }
  return {
    id: input.id,
    agentId: input.agentId,
    recordId: input.recordId,
    purpose: input.purpose,
    requestedBy: input.requestedBy,
    createdAt: input.now,
    ttlSeconds: ttl,
    adminCount: input.adminCount,
    approvals: [],
    status: "PENDING",
  };
}

function assertNotAgent(req: LeaseRequest, who: Approver, verb: string): void {
  if (who.isAgent === true) throw new LeaseError(`an AI agent cannot ${verb} a lease`);
  if (who.id === req.agentId) throw new LeaseError(`the requesting agent cannot ${verb} its own lease`);
}

function assertNotRequester(req: LeaseRequest, who: Approver, verb: string): void {
  if (who.id === req.requestedBy) throw new LeaseError(`the requester cannot ${verb} their own request`);
}

export function approve(req: LeaseRequest, approver: Approver, now: number): LeaseRequest {
  if (req.status !== "PENDING") throw new LeaseError(`cannot approve a ${req.status} request`);
  assertNotAgent(req, approver, "approve");
  assertNotRequester(req, approver, "approve");

  if (req.approvals.includes(approver.id)) return { ...req, approvals: [...req.approvals] };

  const approvals = [...req.approvals, approver.id];
  const next: LeaseRequest = { ...req, approvals };
  if (approvals.length >= approvalThreshold(req.adminCount)) {
    next.status = "ACTIVE";
    next.grantedAt = now;
    next.expiresAt = now + req.ttlSeconds * 1000;
  }
  return next;
}

export function reject(req: LeaseRequest, approver: Approver, _now: number): LeaseRequest {
  if (req.status !== "PENDING") throw new LeaseError(`cannot reject a ${req.status} request`);
  assertNotAgent(req, approver, "reject");
  assertNotRequester(req, approver, "reject");
  return { ...req, approvals: [...req.approvals], status: "REJECTED", rejectedBy: approver.id };
}

export function revoke(req: LeaseRequest, approver: Approver, now: number): LeaseRequest {
  if (req.status !== "ACTIVE") throw new LeaseError(`cannot revoke a ${req.status} request`);
  assertNotAgent(req, approver, "revoke");
  return { ...req, approvals: [...req.approvals], status: "REVOKED", revokedAt: now };
}

export function effectiveStatus(req: LeaseRequest, now: number): EffectiveStatus {
  if (req.status === "ACTIVE" && req.expiresAt !== undefined && now >= req.expiresAt) return "EXPIRED";
  return req.status;
}

export function canAgentRead(req: LeaseRequest, agentId: string, recordId: string, now: number): boolean {
  return effectiveStatus(req, now) === "ACTIVE" && req.agentId === agentId && req.recordId === recordId;
}

export function remainingMs(req: LeaseRequest, now: number): number {
  if (effectiveStatus(req, now) !== "ACTIVE" || req.expiresAt === undefined) return 0;
  return Math.max(0, req.expiresAt - now);
}
