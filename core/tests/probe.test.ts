import { describe, expect, it } from "vitest";
import { AGENT_ID, OPERATOR_ID, REQUESTER_ID } from "../src/fixtures.js";
import { MockTideGateway, NotAuthorizedError, type LeaseToken, type TideGateway } from "../src/gateway.js";
import { buildRelationshipPolicy } from "../src/policy.js";
import { formatProbe, probeAccess } from "../src/probe.js";
import { APPROVERS, GRANT_AT, PLAINTEXT_1, PLAINTEXT_2, activeRequest } from "./helpers.js";

const WHO = [
  "University IT admin (database + server)",
  "Lecturer",
  "IT admin with forged lease",
  "AI summariser, no lease",
  "AI summariser with lease",
  "AI summariser, lease on another course",
];

function policyFor(recordId: string) {
  return buildRelationshipPolicy({
    subjectType: "User",
    subjectId: AGENT_ID,
    recordId,
    roles: ["_tide_decryptor"],
    vendorId: "vendor-demo",
    expirySeconds: 900,
  });
}

async function setup() {
  const gateway = new MockTideGateway({ secret: "probe-secret", approvers: APPROVERS });
  const ct1 = await gateway.encryptRecord("fb-001", PLAINTEXT_1, policyFor("fb-001"));
  const ct2 = await gateway.encryptRecord("fb-002", PLAINTEXT_2, policyFor("fb-002"));
  const token = await gateway.signLease(activeRequest({ agentId: AGENT_ID }), GRANT_AT + 1);
  return { gateway, ct1, ct2, token };
}

const Denied = NotAuthorizedError as unknown as new (m?: string) => Error;

type Call = { recordId: string; ciphertext: string; caller: { id: string }; now: number; token?: LeaseToken };

function spyGateway(inner: TideGateway, calls: Call[]): TideGateway {
  return {
    encryptRecord: (...a: Parameters<TideGateway["encryptRecord"]>) => inner.encryptRecord(...a),
    signLease: (...a: Parameters<TideGateway["signLease"]>) => inner.signLease(...a),
    decryptRecord: (recordId, ciphertext, caller, now, token) => {
      calls.push({ recordId, ciphertext, caller, now, token });
      return inner.decryptRecord(recordId, ciphertext, caller, now, token);
    },
  };
}

describe("S9 probeAccess against the real mock gateway", () => {
  it("returns six rows with exact who strings in the specified order", async () => {
    const { gateway, ct1, ct2, token } = await setup();
    const rows = await probeAccess({ gateway, recordId: "fb-001", ciphertext: ct1, otherRecordCiphertext: ct2, now: GRANT_AT + 5, token });
    expect(rows.map((r) => r.who)).toEqual(WHO);
    for (const r of rows) {
      expect(typeof r.attempt).toBe("string");
      expect(r.attempt.length).toBeGreaterThan(0);
      expect(["READ", "BLOCKED"]).toContain(r.result);
    }
    expect(new Set(rows.map((r) => r.attempt)).size).toBe(6);
  });

  it("with a valid token before expiry: only 'AI summariser with lease' is READ", async () => {
    const { gateway, ct1, ct2, token } = await setup();
    const rows = await probeAccess({ gateway, recordId: "fb-001", ciphertext: ct1, otherRecordCiphertext: ct2, now: GRANT_AT + 5, token });
    expect(rows.map((r) => r.result)).toEqual(["BLOCKED", "BLOCKED", "BLOCKED", "BLOCKED", "READ", "BLOCKED"]);
    expect(rows.filter((r) => r.result === "READ").map((r) => r.who)).toEqual(["AI summariser with lease"]);
  });

  it("without a token: every row is BLOCKED", async () => {
    const { gateway, ct1, ct2 } = await setup();
    const rows = await probeAccess({ gateway, recordId: "fb-001", ciphertext: ct1, otherRecordCiphertext: ct2, now: GRANT_AT + 5 });
    expect(rows.map((r) => r.who)).toEqual(WHO);
    expect(rows.map((r) => r.result)).toEqual(Array(6).fill("BLOCKED"));
  });

  it("at the token's expiry instant and after: every row is BLOCKED", async () => {
    const { gateway, ct1, ct2, token } = await setup();
    for (const now of [token.expiresAt, token.expiresAt + 1, token.expiresAt + 16 * 60_000]) {
      const rows = await probeAccess({ gateway, recordId: "fb-001", ciphertext: ct1, otherRecordCiphertext: ct2, now, token });
      expect(rows.map((r) => r.result)).toEqual(Array(6).fill("BLOCKED"));
    }
  });

  it("the instant before expiry the lease row is still READ", async () => {
    const { gateway, ct1, ct2, token } = await setup();
    const rows = await probeAccess({ gateway, recordId: "fb-001", ciphertext: ct1, otherRecordCiphertext: ct2, now: token.expiresAt - 1, token });
    expect(rows[4].result).toBe("READ");
    expect(rows[1].who).toBe("Lecturer");
    expect(rows[1].result).toBe("BLOCKED");
  });

  it("a tampered token makes the lease row BLOCKED too", async () => {
    const { gateway, ct1, ct2, token } = await setup();
    const bad = { ...token, expiresAt: token.expiresAt + 1_000_000 };
    const rows = await probeAccess({ gateway, recordId: "fb-001", ciphertext: ct1, otherRecordCiphertext: ct2, now: GRANT_AT + 5, token: bad });
    expect(rows.map((r) => r.result)).toEqual(Array(6).fill("BLOCKED"));
  });
});

describe("S9 probeAccess performs real decrypt attempts", () => {
  it("makes exactly six decryptRecord calls with the specified callers and tokens", async () => {
    const { gateway, ct1, ct2, token } = await setup();
    const calls: Call[] = [];
    const now = GRANT_AT + 5;
    await probeAccess({ gateway: spyGateway(gateway, calls), recordId: "fb-001", ciphertext: ct1, otherRecordCiphertext: ct2, now, token });
    expect(calls.length).toBe(6);
    expect(calls.every((c) => c.now === now)).toBe(true);

    // 1 university IT admin, no token
    expect(calls[0].caller).toEqual({ id: OPERATOR_ID });
    expect(calls[0].token).toBeUndefined();
    expect(calls[0].recordId).toBe("fb-001");
    expect(calls[0].ciphertext).toBe(ct1);

    // 2 lecturer (the requester), no token
    expect(calls[1].caller).toEqual({ id: REQUESTER_ID });
    expect(calls[1].token).toBeUndefined();
    expect(calls[1].recordId).toBe("fb-001");
    expect(calls[1].ciphertext).toBe(ct1);

    // 3 forged: agent id, token copy with expiresAt = now + 365 days, same signature
    expect(calls[2].caller).toEqual({ id: AGENT_ID });
    expect(calls[2].token).toBeDefined();
    expect(calls[2].token!.expiresAt).toBe(now + 365 * 24 * 3600 * 1000);
    expect(calls[2].token!.signature).toBe(token.signature);
    expect(calls[2].token!.recordId).toBe(token.recordId);
    expect(calls[2].token!.agentId).toBe(token.agentId);
    expect(calls[2].ciphertext).toBe(ct1);

    // 4 AI summariser, no token
    expect(calls[3].caller).toEqual({ id: AGENT_ID });
    expect(calls[3].token).toBeUndefined();
    expect(calls[3].ciphertext).toBe(ct1);

    // 5 AI summariser with the genuine token
    expect(calls[4].caller).toEqual({ id: AGENT_ID });
    expect(calls[4].token).toEqual(token);
    expect(calls[4].ciphertext).toBe(ct1);

    // 6 AI summariser with the token, other course's ciphertext passed with recordId
    expect(calls[5].caller).toEqual({ id: AGENT_ID });
    expect(calls[5].token).toEqual(token);
    expect(calls[5].recordId).toBe("fb-001");
    expect(calls[5].ciphertext).toBe(ct2);
  });

  it("does not mutate the supplied token", async () => {
    const { gateway, ct1, ct2, token } = await setup();
    const before = structuredClone(token);
    await probeAccess({ gateway, recordId: "fb-001", ciphertext: ct1, otherRecordCiphertext: ct2, now: GRANT_AT + 5, token });
    expect(token).toEqual(before);
  });

  it("with no token the forged row still sends a fabricated token (expiresAt now + 365 days)", async () => {
    const { gateway, ct1, ct2 } = await setup();
    const calls: Call[] = [];
    const now = GRANT_AT + 5;
    await probeAccess({ gateway: spyGateway(gateway, calls), recordId: "fb-001", ciphertext: ct1, otherRecordCiphertext: ct2, now });
    expect(calls[2].token).toBeDefined();
    expect(calls[2].token!.expiresAt).toBe(now + 365 * 24 * 3600 * 1000);
    expect(calls[3].token).toBeUndefined();
    expect(calls[1].token).toBeUndefined();
  });

  it("results are not hard-coded: a gateway that allows everything yields all READ", async () => {
    const open = {
      encryptRecord: async () => "ct",
      signLease: async () => {
        throw new Error("unused");
      },
      decryptRecord: async () => "plaintext",
    } as unknown as TideGateway;
    const rows = await probeAccess({ gateway: open, recordId: "fb-001", ciphertext: "a", otherRecordCiphertext: "b", now: 1 });
    expect(rows.map((r) => r.who)).toEqual(WHO);
    expect(rows.map((r) => r.result)).toEqual(Array(6).fill("READ"));
  });

  it("a gateway that denies everything yields all BLOCKED", async () => {
    const shut = {
      encryptRecord: async () => "ct",
      signLease: async () => {
        throw new Error("unused");
      },
      decryptRecord: async () => {
        throw new Denied("no");
      },
    } as unknown as TideGateway;
    const rows = await probeAccess({ gateway: shut, recordId: "fb-001", ciphertext: "a", otherRecordCiphertext: "b", now: 1 });
    expect(rows.map((r) => r.result)).toEqual(Array(6).fill("BLOCKED"));
  });

  function onlyCaller(id: string): TideGateway {
    return {
      encryptRecord: async () => "ct",
      signLease: async () => {
        throw new Error("unused");
      },
      decryptRecord: async (_r: string, _c: string, caller: { id: string }) => {
        if (caller.id === id) return "ok";
        throw new Denied("no");
      },
    } as unknown as TideGateway;
  }

  it("per-row result follows each attempt (gateway that allows only the AI summariser)", async () => {
    const rows = await probeAccess({ gateway: onlyCaller(AGENT_ID), recordId: "fb-001", ciphertext: "a", otherRecordCiphertext: "b", now: 1 });
    expect(rows.map((r) => r.result)).toEqual(["BLOCKED", "BLOCKED", "READ", "READ", "READ", "READ"]);
  });

  it("the Lecturer row is a real attempt as the lecturer (gateway that allows only the lecturer)", async () => {
    const rows = await probeAccess({ gateway: onlyCaller(REQUESTER_ID), recordId: "fb-001", ciphertext: "a", otherRecordCiphertext: "b", now: 1 });
    expect(rows.map((r) => r.result)).toEqual(["BLOCKED", "READ", "BLOCKED", "BLOCKED", "BLOCKED", "BLOCKED"]);
  });

  it("the university IT admin row is a real attempt as the operator (gateway that allows only it-admin)", async () => {
    const rows = await probeAccess({ gateway: onlyCaller(OPERATOR_ID), recordId: "fb-001", ciphertext: "a", otherRecordCiphertext: "b", now: 1 });
    expect(rows.map((r) => r.result)).toEqual(["READ", "BLOCKED", "BLOCKED", "BLOCKED", "BLOCKED", "BLOCKED"]);
  });

  it("IT admin and Lecturer stay BLOCKED with a valid token before expiry (real gateway)", async () => {
    const { gateway, ct1, ct2, token } = await setup();
    const rows = await probeAccess({ gateway, recordId: "fb-001", ciphertext: ct1, otherRecordCiphertext: ct2, now: token.expiresAt - 1, token });
    expect(rows[0].who).toBe("University IT admin (database + server)");
    expect(rows[0].result).toBe("BLOCKED");
    expect(rows[1].who).toBe("Lecturer");
    expect(rows[1].result).toBe("BLOCKED");
  });
});

describe("S9 formatProbe", () => {
  it("renders one line per row as 'who | attempt | result'", () => {
    const rows = [
      { who: "A who", attempt: "tries X", result: "READ" as const },
      { who: "B who", attempt: "tries Y", result: "BLOCKED" as const },
    ];
    const out = formatProbe(rows);
    const lines = out.replace(/\s+$/, "").split("\n");
    expect(lines).toEqual(["A who | tries X | READ", "B who | tries Y | BLOCKED"]);
  });

  it("renders probe output of the real gateway with all six who strings", async () => {
    const { gateway, ct1, ct2, token } = await setup();
    const rows = await probeAccess({ gateway, recordId: "fb-001", ciphertext: ct1, otherRecordCiphertext: ct2, now: GRANT_AT + 5, token });
    const lines = formatProbe(rows).replace(/\s+$/, "").split("\n");
    expect(lines.length).toBe(6);
    lines.forEach((l, i) => {
      expect(l).toBe(`${rows[i].who} | ${rows[i].attempt} | ${rows[i].result}`);
    });
    expect(lines.filter((l) => l.endsWith("| READ")).length).toBe(1);
    expect(lines.find((l) => l.endsWith("| READ"))!.startsWith("AI summariser with lease | ")).toBe(true);
  });
});
