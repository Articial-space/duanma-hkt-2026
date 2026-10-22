import { describe, expect, it } from "vitest";
import { MockTideGateway, NotAuthorizedError, type LeaseToken } from "../src/gateway.js";
import { approve, reject, revoke, type LeaseRequest } from "../src/lease.js";
import { buildRelationshipPolicy } from "../src/policy.js";
import { AGENT, APPROVERS, GRANT_AT, PLAINTEXT_1, PLAINTEXT_2, REQUESTER, T0, TTL_MS, activeRequest, newRequest } from "./helpers.js";

const SECRET = "test-secret-alpha";

function makeGateway(over: { secret?: string; approvers?: string[] } = {}): MockTideGateway {
  return new MockTideGateway({ secret: SECRET, approvers: APPROVERS, ...over });
}

function policyFor(recordId: string) {
  return buildRelationshipPolicy({
    subjectType: "User",
    subjectId: AGENT,
    recordId,
    roles: ["_tide_decryptor"],
    vendorId: "vendor-demo",
    expirySeconds: 900,
  });
}

async function setup() {
  const gw = makeGateway();
  const ct1 = await gw.encryptRecord("fb-001", PLAINTEXT_1, policyFor("fb-001"));
  const ct2 = await gw.encryptRecord("fb-002", PLAINTEXT_2, policyFor("fb-002"));
  return { gw, ct1, ct2 };
}

async function denied(p: Promise<unknown>): Promise<void> {
  await expect(p).rejects.toBeInstanceOf(NotAuthorizedError);
}

/** A rejection of any kind, and never a resolved plaintext. */
async function neverPlaintext(p: Promise<string>): Promise<void> {
  let value: string | undefined;
  let threw = false;
  try {
    value = await p;
  } catch {
    threw = true;
  }
  expect(value).toBeUndefined();
  expect(threw).toBe(true);
}

describe("S5 NotAuthorizedError", () => {
  it("extends Error and has code NOT_AUTHORIZED", () => {
    const e = new (NotAuthorizedError as unknown as new (m?: string) => NotAuthorizedError)("denied");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(NotAuthorizedError);
    expect(e.code).toBe("NOT_AUTHORIZED");
  });
});

describe("S5 MockTideGateway.encryptRecord", () => {
  it("returns a tide-mock:v1: ciphertext string", async () => {
    const { ct1 } = await setup();
    expect(typeof ct1).toBe("string");
    expect(ct1.startsWith("tide-mock:v1:")).toBe(true);
    expect(ct1.length).toBeGreaterThan("tide-mock:v1:".length + 16);
  });

  it("never contains the plaintext, its base64, base64url or hex", async () => {
    const { ct1 } = await setup();
    const buf = Buffer.from(PLAINTEXT_1, "utf8");
    expect(ct1).not.toContain(PLAINTEXT_1);
    expect(ct1).not.toContain(buf.toString("base64"));
    expect(ct1).not.toContain(buf.toString("base64url"));
    expect(ct1).not.toContain(buf.toString("hex"));
    for (const word of ["rubric", "Marking", "DEMO1001", "Course:", "Comment:"]) {
      expect(ct1).not.toContain(word);
    }
  });

  it("same plaintext under different record ids gives different ciphertext", async () => {
    const gw = makeGateway();
    const a = await gw.encryptRecord("fb-001", PLAINTEXT_1, policyFor("fb-001"));
    const b = await gw.encryptRecord("fb-002", PLAINTEXT_1, policyFor("fb-002"));
    expect(a).not.toBe(b);
  });
});

describe("S5 MockTideGateway.signLease", () => {
  it("signs a genuine quorum lease and binds token fields to the request", async () => {
    const gw = makeGateway();
    const req = activeRequest();
    const token = await gw.signLease(req, GRANT_AT + 10);
    expect(token.leaseId).toBe(req.id);
    expect(token.agentId).toBe(AGENT);
    expect(token.recordId).toBe("fb-001");
    expect(token.expiresAt).toBe(req.expiresAt);
    expect(token.expiresAt).toBe(GRANT_AT + TTL_MS);
    expect(token.approvals).toEqual(["student-rep", "dean"]);
    expect(token.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not mutate the request", async () => {
    const gw = makeGateway();
    const req = activeRequest();
    const snap = structuredClone(req);
    await gw.signLease(req, GRANT_AT + 10);
    expect(req).toEqual(snap);
  });

  it("refuses a PENDING request below quorum", async () => {
    const gw = makeGateway();
    const req = approve(newRequest(), { id: "student-rep" }, T0 + 1000);
    await denied(gw.signLease(req, T0 + 1500));
  });

  it("refuses a below-quorum request whose status was edited to ACTIVE", async () => {
    const gw = makeGateway();
    const pending = approve(newRequest(), { id: "student-rep" }, T0 + 1000);
    const forged: LeaseRequest = { ...pending, status: "ACTIVE", grantedAt: T0 + 1000, expiresAt: T0 + 1000 + TTL_MS };
    await denied(gw.signLease(forged, T0 + 1500));
    const none: LeaseRequest = { ...newRequest(), status: "ACTIVE", grantedAt: T0, expiresAt: T0 + TTL_MS };
    await denied(gw.signLease(none, T0 + 1));
  });

  it("ignores duplicate approvals when counting the quorum", async () => {
    const gw = makeGateway();
    const forged: LeaseRequest = {
      ...activeRequest(),
      approvals: ["student-rep", "student-rep", "student-rep"],
    };
    await denied(gw.signLease(forged, GRANT_AT + 1));
  });

  it("ignores the agent's own approval", async () => {
    const gw = makeGateway();
    const forged: LeaseRequest = { ...activeRequest(), approvals: ["student-rep", AGENT] };
    await denied(gw.signLease(forged, GRANT_AT + 1));
  });

  it("ignores the requester's approval, even if enrolled", async () => {
    const gw = makeGateway();
    const forged: LeaseRequest = { ...activeRequest({ requestedBy: "qa-officer" }), approvals: ["student-rep", "qa-officer"] };
    await denied(gw.signLease(forged, GRANT_AT + 1));
  });

  it("ignores approvals from ids that are not enrolled approvers", async () => {
    const gw = makeGateway();
    const forged: LeaseRequest = { ...activeRequest(), approvals: ["student-rep", "mallory", "it-admin"] };
    await denied(gw.signLease(forged, GRANT_AT + 1));
  });

  it("accepts exactly the threshold of valid distinct approvers even with junk mixed in", async () => {
    const gw = makeGateway();
    const req: LeaseRequest = { ...activeRequest(), approvals: ["mallory", "student-rep", "student-rep", AGENT, "qa-officer"] };
    const token = await gw.signLease(req, GRANT_AT + 1);
    expect(token.recordId).toBe("fb-001");
  });

  it("derives the threshold from the gateway's own approver list, not the request's adminCount", async () => {
    const gw = makeGateway(); // 3 enrolled -> needs 2
    const forged: LeaseRequest = { ...activeRequest(), adminCount: 1, approvals: ["student-rep"] };
    await denied(gw.signLease(forged, GRANT_AT + 1));
  });

  it("uses approvers.length for the threshold (5 approvers need 3)", async () => {
    const approvers = ["a1", "a2", "a3", "a4", "a5"];
    const gw = makeGateway({ approvers });
    const two: LeaseRequest = { ...activeRequest({ adminCount: 5 }), approvals: ["a1", "a2"] };
    await denied(gw.signLease(two, GRANT_AT + 1));
    const three: LeaseRequest = { ...activeRequest({ adminCount: 5 }), approvals: ["a1", "a2", "a3"] };
    await expect(gw.signLease(three, GRANT_AT + 1)).resolves.toMatchObject({ recordId: "fb-001" });
  });

  it("single enrolled approver: one approval suffices (threshold 1)", async () => {
    const gw = makeGateway({ approvers: ["sole-approver"] });
    const req = approve(newRequest({ adminCount: 1 }), { id: "sole-approver" }, T0 + 10);
    await expect(gw.signLease(req, T0 + 11)).resolves.toMatchObject({ approvals: ["sole-approver"] });
  });

  it("refuses REJECTED and REVOKED requests", async () => {
    const gw = makeGateway();
    const rejected: LeaseRequest = {
      ...reject(newRequest(), { id: "qa-officer" }, T0 + 1),
      approvals: ["student-rep", "dean"],
    };
    await denied(gw.signLease(rejected, T0 + 2));
    const revoked = revoke(activeRequest(), { id: "qa-officer" }, GRANT_AT + 5);
    await denied(gw.signLease(revoked, GRANT_AT + 6));
  });

  it("refuses at or after expiresAt, signs the instant before", async () => {
    const gw = makeGateway();
    const req = activeRequest();
    const exp = req.expiresAt as number;
    await denied(gw.signLease(req, exp));
    await denied(gw.signLease(req, exp + 1));
    await expect(gw.signLease(req, exp - 1)).resolves.toMatchObject({ expiresAt: exp });
  });

  it("when expiresAt is unset, token expiry is now + ttl (quorum met, still PENDING)", async () => {
    const gw = makeGateway();
    const req: LeaseRequest = { ...newRequest(), approvals: ["student-rep", "dean"] };
    const token = await gw.signLease(req, T0 + 5000);
    expect(token.expiresAt).toBe(T0 + 5000 + TTL_MS);
  });

  it("signatures differ between different leases and between gateways with different secrets", async () => {
    const gw = makeGateway();
    const other = makeGateway({ secret: "another-secret" });
    const a = await gw.signLease(activeRequest(), GRANT_AT + 1);
    const b = await gw.signLease(activeRequest({ recordId: "fb-002" }), GRANT_AT + 1);
    const c = await other.signLease(activeRequest(), GRANT_AT + 1);
    expect(a.signature).not.toBe(b.signature);
    expect(a.signature).not.toBe(c.signature);
  });
});

describe("S5 MockTideGateway.decryptRecord (token based)", () => {
  it("decrypts with a valid token for the caller and record before expiry", async () => {
    const { gw, ct1 } = await setup();
    const token = await gw.signLease(activeRequest(), GRANT_AT + 1);
    await expect(gw.decryptRecord("fb-001", ct1, { id: AGENT }, GRANT_AT + 2, token)).resolves.toBe(PLAINTEXT_1);
  });

  it("works up to the last instant before expiresAt and fails at expiresAt", async () => {
    const { gw, ct1 } = await setup();
    const token = await gw.signLease(activeRequest(), GRANT_AT + 1);
    await expect(gw.decryptRecord("fb-001", ct1, { id: AGENT }, token.expiresAt - 1, token)).resolves.toBe(PLAINTEXT_1);
    await denied(gw.decryptRecord("fb-001", ct1, { id: AGENT }, token.expiresAt, token));
    await denied(gw.decryptRecord("fb-001", ct1, { id: AGENT }, token.expiresAt + 60_000, token));
  });

  it("refuses when no token is supplied", async () => {
    const { gw, ct1 } = await setup();
    await denied(gw.decryptRecord("fb-001", ct1, { id: AGENT }, GRANT_AT + 2));
    await denied(gw.decryptRecord("fb-001", ct1, { id: AGENT }, GRANT_AT + 2, undefined));
  });

  it("refuses a caller who is not the token's agent (token theft)", async () => {
    const { gw, ct1 } = await setup();
    const token = await gw.signLease(activeRequest(), GRANT_AT + 1);
    await denied(gw.decryptRecord("fb-001", ct1, { id: "it-admin" }, GRANT_AT + 2, token));
    await denied(gw.decryptRecord("fb-001", ct1, { id: "agent-other" }, GRANT_AT + 2, token));
  });

  it("refuses a token for a different record", async () => {
    const { gw, ct2 } = await setup();
    const token = await gw.signLease(activeRequest(), GRANT_AT + 1); // fb-001
    await denied(gw.decryptRecord("fb-002", ct2, { id: AGENT }, GRANT_AT + 2, token));
  });

  describe("edited token fields are refused", () => {
    async function tokenAndGw() {
      const { gw, ct1, ct2 } = await setup();
      const token = await gw.signLease(activeRequest(), GRANT_AT + 1);
      return { gw, ct1, ct2, token };
    }

    it("extended expiresAt", async () => {
      const { gw, ct1, token } = await tokenAndGw();
      const forged: LeaseToken = { ...token, expiresAt: token.expiresAt + 365 * 24 * 3600 * 1000 };
      await denied(gw.decryptRecord("fb-001", ct1, { id: AGENT }, GRANT_AT + 2, forged));
      // and also when the real token has run out
      await denied(gw.decryptRecord("fb-001", ct1, { id: AGENT }, token.expiresAt + 1, forged));
    });

    it("changed recordId (decrypting the other record with its ciphertext)", async () => {
      const { gw, ct2, token } = await tokenAndGw();
      const forged: LeaseToken = { ...token, recordId: "fb-002" };
      await denied(gw.decryptRecord("fb-002", ct2, { id: AGENT }, GRANT_AT + 2, forged));
    });

    it("added approvals", async () => {
      const { gw, ct1, token } = await tokenAndGw();
      const forged: LeaseToken = { ...token, approvals: [...token.approvals, "qa-officer"] };
      await denied(gw.decryptRecord("fb-001", ct1, { id: AGENT }, GRANT_AT + 2, forged));
    });

    it("removed approvals", async () => {
      const { gw, ct1, token } = await tokenAndGw();
      const forged: LeaseToken = { ...token, approvals: token.approvals.slice(0, 1) };
      await denied(gw.decryptRecord("fb-001", ct1, { id: AGENT }, GRANT_AT + 2, forged));
    });

    it("changed agentId (caller matches the forged id)", async () => {
      const { gw, ct1, token } = await tokenAndGw();
      const forged: LeaseToken = { ...token, agentId: "it-admin" };
      await denied(gw.decryptRecord("fb-001", ct1, { id: "it-admin" }, GRANT_AT + 2, forged));
    });

    it("changed leaseId", async () => {
      const { gw, ct1, token } = await tokenAndGw();
      const forged: LeaseToken = { ...token, leaseId: "lease-other" };
      await denied(gw.decryptRecord("fb-001", ct1, { id: AGENT }, GRANT_AT + 2, forged));
    });

    it("tampered or blank signature", async () => {
      const { gw, ct1, token } = await tokenAndGw();
      const flipped = (token.signature[0] === "0" ? "1" : "0") + token.signature.slice(1);
      for (const signature of [flipped, "", "0".repeat(64)]) {
        await denied(gw.decryptRecord("fb-001", ct1, { id: AGENT }, GRANT_AT + 2, { ...token, signature }));
      }
    });

    it("token minted by another gateway secret", async () => {
      const { gw, ct1 } = await setup();
      const other = makeGateway({ secret: "attacker-secret" });
      const foreign = await other.signLease(activeRequest(), GRANT_AT + 1);
      await denied(gw.decryptRecord("fb-001", ct1, { id: AGENT }, GRANT_AT + 2, foreign));
    });

    it("fabricated token with a made-up signature", async () => {
      const { gw, ct1 } = await setup();
      const fake: LeaseToken = {
        leaseId: "lease-1",
        agentId: AGENT,
        recordId: "fb-001",
        expiresAt: GRANT_AT + 10 * TTL_MS,
        approvals: ["student-rep", "dean"],
        signature: "ab".repeat(32),
      };
      await denied(gw.decryptRecord("fb-001", ct1, { id: AGENT }, GRANT_AT + 2, fake));
    });
  });

  it("the app's stored lease records are not trusted: an ACTIVE request object is not enough", async () => {
    const { gw, ct1 } = await setup();
    const req = activeRequest();
    // pass the request itself where a token is expected
    await denied(gw.decryptRecord("fb-001", ct1, { id: AGENT }, GRANT_AT + 2, req as unknown as LeaseToken));
  });

  it("a swapped ciphertext never yields plaintext, even with a valid token for the requested record", async () => {
    const { gw, ct1, ct2 } = await setup();
    const token2 = await gw.signLease(activeRequest({ recordId: "fb-002" }), GRANT_AT + 1);
    // token is valid for fb-002, but the ciphertext belongs to fb-001
    await denied(gw.decryptRecord("fb-002", ct1, { id: AGENT }, GRANT_AT + 2, token2));
    // sanity: the right pairing works
    await expect(gw.decryptRecord("fb-002", ct2, { id: AGENT }, GRANT_AT + 2, token2)).resolves.toBe(PLAINTEXT_2);
  });

  it("a corrupted or truncated ciphertext never yields plaintext", async () => {
    const { gw, ct1 } = await setup();
    const token = await gw.signLease(activeRequest(), GRANT_AT + 1);
    const i = ct1.length - 10; // well inside the payload, away from base64 padding bits
    const corrupted = ct1.slice(0, i) + (ct1[i] === "A" ? "B" : "A") + ct1.slice(i + 1);
    await neverPlaintext(gw.decryptRecord("fb-001", corrupted, { id: AGENT }, GRANT_AT + 2, token));
    await neverPlaintext(gw.decryptRecord("fb-001", ct1.slice(0, ct1.length - 12), { id: AGENT }, GRANT_AT + 2, token));
    await neverPlaintext(gw.decryptRecord("fb-001", "not-a-ciphertext", { id: AGENT }, GRANT_AT + 2, token));
    await neverPlaintext(gw.decryptRecord("fb-001", ct1.replace("tide-mock:v1:", "tide-mock:v0:"), { id: AGENT }, GRANT_AT + 2, token));
  });

  it("a ciphertext from a gateway with a different secret cannot be decrypted", async () => {
    const { gw } = await setup();
    const other = makeGateway({ secret: "different" });
    const foreignCt = await other.encryptRecord("fb-001", PLAINTEXT_1, policyFor("fb-001"));
    const token = await gw.signLease(activeRequest(), GRANT_AT + 1);
    await neverPlaintext(gw.decryptRecord("fb-001", foreignCt, { id: AGENT }, GRANT_AT + 2, token));
  });

  it("round-trips arbitrary plaintext (unicode, empty-ish, long)", async () => {
    const gw = makeGateway();
    const token = await gw.signLease(activeRequest(), GRANT_AT + 1);
    for (const text of ["x", "Tên: Bệnh nhân giả định ✓", "A".repeat(5000)]) {
      const ct = await gw.encryptRecord("fb-001", text, policyFor("fb-001"));
      await expect(gw.decryptRecord("fb-001", ct, { id: AGENT }, GRANT_AT + 2, token)).resolves.toBe(text);
    }
  });
});

describe("S5 MockTideGateway mock-only owner decrypt", () => {
  it("a registered owner decrypts their record without a token", async () => {
    const { gw, ct1 } = await setup();
    gw.registerOwner("fb-001", "student-cohort-001");
    await expect(gw.decryptRecord("fb-001", ct1, { id: "student-cohort-001" }, T0, undefined)).resolves.toBe(PLAINTEXT_1);
  });

  it("an owner of another record, or an unregistered id, is refused", async () => {
    const { gw, ct1 } = await setup();
    gw.registerOwner("fb-001", "student-cohort-001");
    gw.registerOwner("fb-002", "student-cohort-002");
    await denied(gw.decryptRecord("fb-001", ct1, { id: "student-cohort-002" }, T0));
    await denied(gw.decryptRecord("fb-001", ct1, { id: "it-admin" }, T0));
    await denied(gw.decryptRecord("fb-001", ct1, { id: "student-cohort-003" }, T0));
  });

  it("the owner is refused before registration", async () => {
    const { gw, ct1 } = await setup();
    await denied(gw.decryptRecord("fb-001", ct1, { id: "student-cohort-001" }, T0));
  });

  it("owner access does not extend to a swapped ciphertext", async () => {
    const { gw, ct2 } = await setup();
    gw.registerOwner("fb-001", "student-cohort-001");
    await neverPlaintext(gw.decryptRecord("fb-001", ct2, { id: "student-cohort-001" }, T0));
  });
});

describe("S5 sanity on helpers", () => {
  it("requester and agent are not enrolled approvers in the test setup", () => {
    expect(APPROVERS).not.toContain(AGENT);
    expect(APPROVERS).not.toContain(REQUESTER);
  });
});
