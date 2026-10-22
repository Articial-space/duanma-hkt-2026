import { describe, expect, it } from "vitest";
import { PolicyError, buildRelationshipPolicy, policyFingerprint } from "../src/policy.js";

type Input = Parameters<typeof buildRelationshipPolicy>[0];

function validInput(over: Partial<Input> = {}): Input {
  return {
    subjectType: "User",
    subjectId: "ai-summariser-01",
    recordId: "fb-001",
    roles: ["_tide_decryptor"],
    vendorId: "vendor-demo",
    expirySeconds: 900,
    ...over,
  } as Input;
}

describe("S2 buildRelationshipPolicy shape", () => {
  it("returns the exact structure (no clientId)", () => {
    const p = buildRelationshipPolicy(validInput());
    expect(p).toEqual({
      modelIds: ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"],
      contractId: "RelationshipAttestation:1",
      executionType: "PRIVATE",
      approvalType: "IMPLICIT",
      keyId: "vendor-demo",
      expirySeconds: 900,
      params: {
        subjectType: "User",
        subjectId: "ai-summariser-01",
        assignmentId: "fb-001",
        roles: '["_tide_decryptor"]',
      },
      tags: ["fb-001"],
    });
  });

  it("omits the clientId key entirely when not provided", () => {
    const p = buildRelationshipPolicy(validInput());
    expect("clientId" in p.params).toBe(false);
    expect(Object.keys(p.params).sort()).toEqual(["assignmentId", "roles", "subjectId", "subjectType"]);
  });

  it("includes clientId as a string when subjectType is Role", () => {
    const p = buildRelationshipPolicy(validInput({ subjectType: "Role", clientId: "leash-app" }));
    expect(p.params.clientId).toBe("leash-app");
    expect(p.params.subjectType).toBe("Role");
  });

  it("all params values are strings", () => {
    for (const input of [
      validInput(),
      validInput({ subjectType: "Role", clientId: "c" }),
      validInput({ roles: ["_tide_encryptor", "_tide_decryptor"] }),
    ]) {
      const p = buildRelationshipPolicy(input);
      for (const v of Object.values(p.params)) {
        expect(typeof v).toBe("string");
      }
    }
  });

  it("roles param is JSON.stringify of the roles in the given order", () => {
    const p = buildRelationshipPolicy(validInput({ roles: ["_tide_encryptor", "_tide_decryptor"] }));
    expect(p.params.roles).toBe(JSON.stringify(["_tide_encryptor", "_tide_decryptor"]));
    const q = buildRelationshipPolicy(validInput({ roles: ["_tide_decryptor", "_tide_encryptor"] }));
    expect(q.params.roles).toBe('["_tide_decryptor","_tide_encryptor"]');
  });

  it("record id is the only tag and equals assignmentId", () => {
    const p = buildRelationshipPolicy(validInput({ recordId: "fb-002" }));
    expect(p.tags).toEqual(["fb-002"]);
    expect(p.params.assignmentId).toBe("fb-002");
  });

  it("keyId is the vendorId and expirySeconds is unchanged (number)", () => {
    const p = buildRelationshipPolicy(validInput({ vendorId: "other-vendor", expirySeconds: 3600 }));
    expect(p.keyId).toBe("other-vendor");
    expect(p.expirySeconds).toBe(3600);
    expect(typeof p.expirySeconds).toBe("number");
  });

  it.each(["User", "Group", "Role"] as const)("accepts subjectType %s", (t) => {
    const p = buildRelationshipPolicy(validInput({ subjectType: t }));
    expect(p.params.subjectType).toBe(t);
  });

  it("does not mutate the input roles array", () => {
    const roles: Input["roles"] = ["_tide_encryptor", "_tide_decryptor"];
    buildRelationshipPolicy(validInput({ roles }));
    expect(roles).toEqual(["_tide_encryptor", "_tide_decryptor"]);
  });
});

describe("S2 buildRelationshipPolicy validation", () => {
  it("PolicyError extends Error", () => {
    const e = new PolicyError("x");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(PolicyError);
  });

  it.each(["", "   ", "\t\n"])("rejects blank subjectId %j", (v) => {
    expect(() => buildRelationshipPolicy(validInput({ subjectId: v }))).toThrow(PolicyError);
  });
  it.each(["", "   ", "\t\n"])("rejects blank recordId %j", (v) => {
    expect(() => buildRelationshipPolicy(validInput({ recordId: v }))).toThrow(PolicyError);
  });
  it.each(["", "   ", "\t\n"])("rejects blank vendorId %j", (v) => {
    expect(() => buildRelationshipPolicy(validInput({ vendorId: v }))).toThrow(PolicyError);
  });

  it("rejects unknown subjectType", () => {
    expect(() => buildRelationshipPolicy(validInput({ subjectType: "Admin" as never }))).toThrow(PolicyError);
    expect(() => buildRelationshipPolicy(validInput({ subjectType: "user" as never }))).toThrow(PolicyError);
  });

  it("rejects empty roles", () => {
    expect(() => buildRelationshipPolicy(validInput({ roles: [] }))).toThrow(PolicyError);
  });
  it("rejects unknown role values", () => {
    expect(() => buildRelationshipPolicy(validInput({ roles: ["_tide_admin"] as never }))).toThrow(PolicyError);
    expect(() =>
      buildRelationshipPolicy(validInput({ roles: ["_tide_decryptor", "root"] as never })),
    ).toThrow(PolicyError);
  });
  it("rejects duplicate roles", () => {
    expect(() =>
      buildRelationshipPolicy(validInput({ roles: ["_tide_decryptor", "_tide_decryptor"] })),
    ).toThrow(PolicyError);
  });

  it.each([0, 1, 59, 604801, 1_000_000, -60, 60.5, 900.1, NaN, Infinity])(
    "rejects expirySeconds %s",
    (v) => {
      expect(() => buildRelationshipPolicy(validInput({ expirySeconds: v }))).toThrow(PolicyError);
    },
  );

  it.each([60, 61, 900, 86400, 604799, 604800])("accepts expirySeconds %i", (v) => {
    expect(buildRelationshipPolicy(validInput({ expirySeconds: v })).expirySeconds).toBe(v);
  });

  it.each(["User", "Group"] as const)("rejects clientId when subjectType is %s", (t) => {
    expect(() => buildRelationshipPolicy(validInput({ subjectType: t, clientId: "leash-app" }))).toThrow(
      PolicyError,
    );
  });

  it("accepts clientId only for Role", () => {
    expect(() =>
      buildRelationshipPolicy(validInput({ subjectType: "Role", clientId: "leash-app" })),
    ).not.toThrow();
  });
});

describe("S2 policyFingerprint", () => {
  it("is a 64-char lowercase hex string (sha256)", () => {
    const fp = policyFingerprint(buildRelationshipPolicy(validInput()));
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for structurally equal policies", () => {
    const a = policyFingerprint(buildRelationshipPolicy(validInput()));
    const b = policyFingerprint(buildRelationshipPolicy(validInput()));
    expect(a).toBe(b);
  });

  it("is independent of key insertion order (top level and params)", () => {
    const p = buildRelationshipPolicy(validInput({ subjectType: "Role", clientId: "leash-app" }));
    const reversedParams = Object.fromEntries(Object.entries(p.params).reverse());
    const reversed = Object.fromEntries(
      Object.entries({ ...p, params: reversedParams }).reverse(),
    ) as typeof p;
    expect(Object.keys(reversed)).not.toEqual(Object.keys(p));
    expect(Object.keys(reversed.params)).not.toEqual(Object.keys(p.params));
    expect(policyFingerprint(reversed)).toBe(policyFingerprint(p));
  });

  it("differs when any field differs", () => {
    const base = policyFingerprint(buildRelationshipPolicy(validInput()));
    const variants: Array<Partial<Input>> = [
      { recordId: "fb-002" },
      { subjectId: "agent-other" },
      { subjectType: "Role" },
      { subjectType: "Group" },
      { vendorId: "vendor-2" },
      { expirySeconds: 901 },
      { roles: ["_tide_encryptor"] },
      { roles: ["_tide_encryptor", "_tide_decryptor"] },
    ];
    const seen = new Set<string>([base]);
    for (const v of variants) {
      const fp = policyFingerprint(buildRelationshipPolicy(validInput(v)));
      expect(fp).not.toBe(base);
      seen.add(fp);
    }
    expect(seen.size).toBe(variants.length + 1);
  });

  it("differs when clientId is added or changed (Role)", () => {
    const noClient = policyFingerprint(buildRelationshipPolicy(validInput({ subjectType: "Role" })));
    const a = policyFingerprint(buildRelationshipPolicy(validInput({ subjectType: "Role", clientId: "a" })));
    const b = policyFingerprint(buildRelationshipPolicy(validInput({ subjectType: "Role", clientId: "b" })));
    expect(new Set([noClient, a, b]).size).toBe(3);
  });

  it("differs when a policy object is edited after build", () => {
    const p = buildRelationshipPolicy(validInput());
    const edited = { ...p, tags: ["fb-001", "extra"] };
    expect(policyFingerprint(edited)).not.toBe(policyFingerprint(p));
    const edited2 = { ...p, params: { ...p.params, subjectId: "evil" } };
    expect(policyFingerprint(edited2)).not.toBe(policyFingerprint(p));
  });
});
