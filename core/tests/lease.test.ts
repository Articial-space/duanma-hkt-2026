import { describe, expect, it } from "vitest";
import {
  LeaseError,
  approve,
  canAgentRead,
  createLeaseRequest,
  effectiveStatus,
  reject,
  remainingMs,
  revoke,
} from "../src/lease.js";
import { AGENT, GRANT_AT, REQUESTER, T0, TTL_MS, TTL_SECONDS, activeRequest, deepFreeze, newRequest } from "./helpers.js";

describe("S3 createLeaseRequest", () => {
  it("creates a PENDING request with empty approvals and copies all inputs", () => {
    const r = newRequest();
    expect(r.status).toBe("PENDING");
    expect(r.approvals).toEqual([]);
    expect(r.id).toBe("lease-1");
    expect(r.agentId).toBe(AGENT);
    expect(r.recordId).toBe("fb-001");
    expect(r.purpose).toBe("Summarise course feedback after grades are published");
    expect(r.requestedBy).toBe(REQUESTER);
    expect(r.createdAt).toBe(T0);
    expect(r.ttlSeconds).toBe(TTL_SECONDS);
    expect(r.adminCount).toBe(3);
    expect(r.grantedAt).toBeUndefined();
    expect(r.expiresAt).toBeUndefined();
    expect(r.revokedAt).toBeUndefined();
    expect(r.rejectedBy).toBeUndefined();
  });

  it("LeaseError extends Error", () => {
    expect(new LeaseError("x")).toBeInstanceOf(Error);
  });

  it.each([0, 59, 604801, 60.5, -900, NaN, Infinity])("rejects ttlSeconds %s", (ttl) => {
    expect(() => newRequest({ ttlSeconds: ttl })).toThrow(LeaseError);
  });

  it.each([60, 900, 604800])("accepts ttlSeconds %i", (ttl) => {
    expect(newRequest({ ttlSeconds: ttl }).ttlSeconds).toBe(ttl);
  });

  it("rejects an empty purpose", () => {
    expect(() => newRequest({ purpose: "" })).toThrow(LeaseError);
  });
});

describe("S3 approve", () => {
  it("one approval of two needed stays PENDING and records the approver", () => {
    const r = approve(newRequest(), { id: "student-rep" }, T0 + 1000);
    expect(r.status).toBe("PENDING");
    expect(r.approvals).toEqual(["student-rep"]);
    expect(r.grantedAt).toBeUndefined();
    expect(r.expiresAt).toBeUndefined();
  });

  it("becomes ACTIVE exactly when approvals reach the threshold (2 of 3)", () => {
    const r1 = approve(newRequest(), { id: "student-rep" }, T0 + 1000);
    const r2 = approve(r1, { id: "dean" }, GRANT_AT);
    expect(r2.status).toBe("ACTIVE");
    expect(r2.approvals).toEqual(["student-rep", "dean"]);
    expect(r2.grantedAt).toBe(GRANT_AT);
    expect(r2.expiresAt).toBe(GRANT_AT + TTL_MS);
  });

  it("expiresAt is based on the quorum-reaching approval time, not creation", () => {
    const r = activeRequest();
    expect(r.expiresAt).toBe(GRANT_AT + TTL_SECONDS * 1000);
    expect(r.expiresAt).not.toBe(T0 + TTL_MS);
  });

  it("keeps insertion order of approvals", () => {
    const base = newRequest({ adminCount: 10 });
    const r = approve(approve(approve(base, { id: "z-doc" }, T0 + 1), { id: "a-doc" }, T0 + 2), { id: "m-doc" }, T0 + 3);
    expect(r.approvals).toEqual(["z-doc", "a-doc", "m-doc"]);
  });

  it.each([
    [1, 1],
    [2, 1],
    [3, 2],
    [5, 3],
    [10, 7],
  ])("adminCount %i needs exactly %i approvals", (adminCount, needed) => {
    let r = newRequest({ adminCount });
    for (let i = 0; i < needed; i++) {
      expect(r.status).toBe("PENDING");
      r = approve(r, { id: `doc-${i}` }, T0 + 10 + i);
    }
    expect(r.status).toBe("ACTIVE");
    expect(r.approvals.length).toBe(needed);
    expect(r.grantedAt).toBe(T0 + 10 + needed - 1);
  });

  it("a single approver activates a 1-admin faculty", () => {
    const r = approve(newRequest({ adminCount: 1 }), { id: "sole-approver" }, T0 + 5);
    expect(r.status).toBe("ACTIVE");
  });

  it("repeat approval by the same id is a no-op and does not count twice", () => {
    const r1 = approve(newRequest(), { id: "student-rep" }, T0 + 1000);
    const r2 = approve(r1, { id: "student-rep" }, T0 + 2000);
    expect(r2.status).toBe("PENDING");
    expect(r2.approvals).toEqual(["student-rep"]);
    expect(r2).toEqual(r1);
  });

  it("does not mutate its input (frozen request does not throw, original unchanged)", () => {
    const frozen = deepFreeze(newRequest());
    const snapshot = structuredClone(frozen);
    const out = approve(frozen, { id: "student-rep" }, T0 + 1000);
    expect(out).not.toBe(frozen);
    expect(frozen).toEqual(snapshot);
    expect(frozen.approvals).toEqual([]);
  });

  it("does not mutate the approver object or the previous request when reaching quorum", () => {
    const r1 = deepFreeze(approve(newRequest(), { id: "student-rep" }, T0 + 1000));
    const approver = deepFreeze({ id: "dean" });
    const before = structuredClone(r1);
    const r2 = approve(r1, approver, GRANT_AT);
    expect(r1).toEqual(before);
    expect(r2.status).toBe("ACTIVE");
  });

  it("refuses an approver flagged isAgent", () => {
    expect(() => approve(newRequest(), { id: "ai-helper", isAgent: true }, T0 + 1)).toThrow(LeaseError);
  });

  it("refuses the requesting agent's own id", () => {
    expect(() => approve(newRequest(), { id: AGENT }, T0 + 1)).toThrow(LeaseError);
  });

  it("refuses self-approval by the requester", () => {
    expect(() => approve(newRequest(), { id: REQUESTER }, T0 + 1)).toThrow(LeaseError);
  });

  it("refused approvals leave a request that still needs the full quorum", () => {
    let r = newRequest();
    for (const bad of [{ id: AGENT }, { id: REQUESTER }, { id: "x", isAgent: true }]) {
      expect(() => approve(r, bad, T0 + 1)).toThrow(LeaseError);
    }
    r = approve(r, { id: "student-rep" }, T0 + 2);
    expect(r.status).toBe("PENDING");
  });

  it.each(["ACTIVE", "REJECTED", "REVOKED"] as const)("refuses approval when status is %s", (status) => {
    let r = newRequest();
    if (status === "ACTIVE") r = activeRequest();
    if (status === "REJECTED") r = reject(r, { id: "student-rep" }, T0 + 1);
    if (status === "REVOKED") r = revoke(activeRequest(), { id: "qa-officer" }, GRANT_AT + 1);
    expect(r.status).toBe(status);
    expect(() => approve(r, { id: "new-approver" }, T0 + 5000)).toThrow(LeaseError);
  });
});

describe("S3 reject", () => {
  it("PENDING -> REJECTED with rejectedBy set", () => {
    const r = reject(newRequest(), { id: "student-rep" }, T0 + 10);
    expect(r.status).toBe("REJECTED");
    expect(r.rejectedBy).toBe("student-rep");
  });

  it("works after a partial approval", () => {
    const r = reject(approve(newRequest(), { id: "student-rep" }, T0 + 1), { id: "dean" }, T0 + 2);
    expect(r.status).toBe("REJECTED");
    expect(r.rejectedBy).toBe("dean");
  });

  it("is refused outside PENDING", () => {
    expect(() => reject(activeRequest(), { id: "qa-officer" }, GRANT_AT + 1)).toThrow(LeaseError);
    const rejected = reject(newRequest(), { id: "student-rep" }, T0 + 1);
    expect(() => reject(rejected, { id: "dean" }, T0 + 2)).toThrow(LeaseError);
  });

  it("applies the same identity rules as approve", () => {
    expect(() => reject(newRequest(), { id: AGENT }, T0 + 1)).toThrow(LeaseError);
    expect(() => reject(newRequest(), { id: REQUESTER }, T0 + 1)).toThrow(LeaseError);
    expect(() => reject(newRequest(), { id: "ai", isAgent: true }, T0 + 1)).toThrow(LeaseError);
  });

  it("does not mutate its input", () => {
    const frozen = deepFreeze(newRequest());
    const out = reject(frozen, { id: "student-rep" }, T0 + 1);
    expect(frozen.status).toBe("PENDING");
    expect(out).not.toBe(frozen);
  });

  it("a rejected request cannot be read by the agent", () => {
    const r = reject(newRequest(), { id: "student-rep" }, T0 + 1);
    expect(canAgentRead(r, AGENT, "fb-001", T0 + 2)).toBe(false);
  });
});

describe("S3 revoke", () => {
  it("ACTIVE -> REVOKED with revokedAt = now", () => {
    const r = revoke(activeRequest(), { id: "qa-officer" }, GRANT_AT + 5000);
    expect(r.status).toBe("REVOKED");
    expect(r.revokedAt).toBe(GRANT_AT + 5000);
  });

  it("is refused from PENDING and REJECTED and REVOKED", () => {
    expect(() => revoke(newRequest(), { id: "student-rep" }, T0 + 1)).toThrow(LeaseError);
    const rejected = reject(newRequest(), { id: "student-rep" }, T0 + 1);
    expect(() => revoke(rejected, { id: "dean" }, T0 + 2)).toThrow(LeaseError);
    const revoked = revoke(activeRequest(), { id: "qa-officer" }, GRANT_AT + 1);
    expect(() => revoke(revoked, { id: "student-rep" }, GRANT_AT + 2)).toThrow(LeaseError);
  });

  it("the agent cannot revoke", () => {
    expect(() => revoke(activeRequest(), { id: AGENT }, GRANT_AT + 1)).toThrow(LeaseError);
    expect(() => revoke(activeRequest(), { id: "ai", isAgent: true }, GRANT_AT + 1)).toThrow(LeaseError);
  });

  it("revoked request cannot be read and has no remaining time", () => {
    const r = revoke(activeRequest(), { id: "qa-officer" }, GRANT_AT + 1);
    expect(canAgentRead(r, AGENT, "fb-001", GRANT_AT + 2)).toBe(false);
    expect(effectiveStatus(r, GRANT_AT + 2)).toBe("REVOKED");
    expect(remainingMs(r, GRANT_AT + 2)).toBe(0);
  });

  it("does not mutate its input", () => {
    const frozen = deepFreeze(activeRequest());
    const out = revoke(frozen, { id: "qa-officer" }, GRANT_AT + 1);
    expect(frozen.status).toBe("ACTIVE");
    expect(out).not.toBe(frozen);
  });
});

describe("S3 effectiveStatus (expiry boundary)", () => {
  const r = activeRequest();
  const exp = r.expiresAt as number;

  it("is ACTIVE just before expiresAt", () => {
    expect(effectiveStatus(r, exp - 1)).toBe("ACTIVE");
    expect(effectiveStatus(r, GRANT_AT)).toBe("ACTIVE");
  });
  it("is EXPIRED exactly at expiresAt", () => {
    expect(effectiveStatus(r, exp)).toBe("EXPIRED");
  });
  it("is EXPIRED after expiresAt", () => {
    expect(effectiveStatus(r, exp + 1)).toBe("EXPIRED");
    expect(effectiveStatus(r, exp + 16 * 60_000)).toBe("EXPIRED");
  });
  it("does not change the stored status", () => {
    expect(r.status).toBe("ACTIVE");
  });
  it("passes PENDING and REJECTED through unchanged at any time", () => {
    const p = newRequest();
    expect(effectiveStatus(p, T0 + 10 * TTL_MS)).toBe("PENDING");
    const rej = reject(p, { id: "student-rep" }, T0 + 1);
    expect(effectiveStatus(rej, T0 + 10 * TTL_MS)).toBe("REJECTED");
  });
});

describe("S3 canAgentRead", () => {
  const r = activeRequest();
  const exp = r.expiresAt as number;

  it("true for the matching agent and record while active", () => {
    expect(canAgentRead(r, AGENT, "fb-001", GRANT_AT)).toBe(true);
    expect(canAgentRead(r, AGENT, "fb-001", exp - 1)).toBe(true);
  });
  it("false at and after expiry", () => {
    expect(canAgentRead(r, AGENT, "fb-001", exp)).toBe(false);
    expect(canAgentRead(r, AGENT, "fb-001", exp + 1)).toBe(false);
  });
  it("false for another record", () => {
    expect(canAgentRead(r, AGENT, "fb-002", GRANT_AT)).toBe(false);
  });
  it("false for another agent", () => {
    expect(canAgentRead(r, "agent-other", "fb-001", GRANT_AT)).toBe(false);
  });
  it("false while PENDING, even one approval short", () => {
    const p = approve(newRequest(), { id: "student-rep" }, T0 + 1);
    expect(canAgentRead(p, AGENT, "fb-001", T0 + 2)).toBe(false);
  });
});

describe("S3 remainingMs", () => {
  const r = activeRequest();
  const exp = r.expiresAt as number;

  it("is the full ttl at grant time", () => {
    expect(remainingMs(r, GRANT_AT)).toBe(TTL_MS);
  });
  it("counts down", () => {
    expect(remainingMs(r, GRANT_AT + 300_000)).toBe(TTL_MS - 300_000);
    expect(remainingMs(r, exp - 1)).toBe(1);
  });
  it("is 0 at expiry and never negative afterwards", () => {
    expect(remainingMs(r, exp)).toBe(0);
    expect(remainingMs(r, exp + 5000)).toBe(0);
  });
  it("is 0 for PENDING and REJECTED requests", () => {
    expect(remainingMs(newRequest(), T0)).toBe(0);
    expect(remainingMs(reject(newRequest(), { id: "student-rep" }, T0 + 1), T0 + 2)).toBe(0);
  });
});
