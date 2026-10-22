import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SIM_USERS,
  SimAuthError,
  authorize,
  callerFromClaims,
  issueSimToken,
  verifySimToken,
  type SimAction,
  type SimCaller,
} from "../src/simAuth.js";

const NOW = 1_700_000_000_000;
const IAT = Math.floor(NOW / 1000);
const SECRET = "test-secret";

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const unb64 = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
const sign = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("base64url");
const keyOf = (u: string) => createHash("sha256").update("sim-tide:" + u).digest("hex").slice(0, 32);
const tokenFor = (username: string, now = NOW, ttlSeconds?: number) =>
  issueSimToken({ username, secret: SECRET, now, ...(ttlSeconds === undefined ? {} : { ttlSeconds }) });
const callerFor = (username: string): SimCaller => callerFromClaims(verifySimToken(tokenFor(username), SECRET, NOW));
const forge = (claims: object, secret = SECRET) => {
  const head = "sim." + b64(JSON.stringify(claims));
  return head + "." + sign(secret, head);
};
const status = (fn: () => unknown): number | undefined => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SimAuthError);
    return (e as SimAuthError).status;
  }
  return undefined;
};

describe("S13a SIM_USERS", () => {
  it("has the 7 accounts in order with exact usernames and display names", () => {
    expect(SIM_USERS.map((u) => u.username)).toEqual([
      "student-demo",
      "lecturer-demo",
      "student-rep",
      "dean",
      "qa-officer",
      "it-admin",
      "ai-summariser-01",
    ]);
    expect(SIM_USERS.map((u) => u.displayName)).toEqual([
      "Student",
      "Lecturer",
      "Student representative",
      "Dean",
      "QA officer",
      "University IT admin",
      "AI summariser (operator account)",
    ]);
  });

  it("has exact realm roles with _tide_enabled first on every account", () => {
    expect(SIM_USERS.map((u) => u.realmRoles)).toEqual([
      ["_tide_enabled", "student", "_tide_encryptor"],
      ["_tide_enabled", "lecturer"],
      ["_tide_enabled", "approver"],
      ["_tide_enabled", "approver"],
      ["_tide_enabled", "approver"],
      ["_tide_enabled"],
      ["_tide_enabled", "ai-operator", "_tide_decryptor"],
    ]);
  });

  it("has exact client roles ({} when empty; only it-admin has realm-management)", () => {
    expect(SIM_USERS.map((u) => u.clientRoles)).toEqual([
      {},
      {},
      {},
      {},
      {},
      { "realm-management": ["tide-realm-admin"] },
      {},
    ]);
  });

  it("derives tideUserKey as the first 32 hex of sha256('sim-tide:'+username)", () => {
    for (const u of SIM_USERS) {
      expect(u.tideUserKey).toMatch(/^[0-9a-f]{32}$/);
      expect(u.tideUserKey).toBe(keyOf(u.username));
    }
    expect(new Set(SIM_USERS.map((u) => u.tideUserKey)).size).toBe(7);
  });
});

describe("S13a issueSimToken", () => {
  it("has the format sim.<b64url>.<b64url> with an HMAC-SHA256 signature over 'sim.<payload>'", () => {
    const t = tokenFor("dean");
    expect(t).toMatch(/^sim\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const [, payload, sig] = t.split(".");
    expect(sig).toBe(sign(SECRET, "sim." + payload));
  });

  it("carries the TideCloak-like claims with default ttl 3600", () => {
    const claims = unb64(tokenFor("student-demo").split(".")[1]);
    expect(claims).toEqual({
      iss: "simulated-tidecloak",
      sub: keyOf("student-demo"),
      preferred_username: "student-demo",
      tideuserkey: keyOf("student-demo"),
      realm_access: { roles: ["_tide_enabled", "student", "_tide_encryptor"] },
      resource_access: {},
      iat: IAT,
      exp: IAT + 3600,
    });
  });

  it("puts client roles in resource_access only for clients that have roles", () => {
    const claims = unb64(tokenFor("it-admin").split(".")[1]);
    expect(claims.resource_access).toEqual({ "realm-management": { roles: ["tide-realm-admin"] } });
    expect(claims.realm_access).toEqual({ roles: ["_tide_enabled"] });
  });

  it("honours ttlSeconds and floors iat from milliseconds", () => {
    const claims = unb64(tokenFor("dean", NOW + 999, 60).split(".")[1]);
    expect(claims.iat).toBe(IAT);
    expect(claims.exp).toBe(IAT + 60);
  });

  it("is deterministic for the same inputs", () => {
    expect(tokenFor("dean")).toBe(tokenFor("dean"));
  });

  it("rejects an unknown username with SimAuthError 401", () => {
    expect(status(() => tokenFor("mallory"))).toBe(401);
  });

  it("rejects an empty secret with a plain Error (not SimAuthError)", () => {
    let err: unknown;
    try {
      issueSimToken({ username: "dean", secret: "", now: NOW });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SimAuthError);
  });
});

describe("S13a SimAuthError", () => {
  it("extends Error and carries a numeric status", () => {
    let err: unknown;
    try {
      authorize(null, "rows.read");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SimAuthError);
    expect((err as SimAuthError).status).toBe(401);
  });
});

describe("S13a verifySimToken", () => {
  it("round-trips every account's claims", () => {
    for (const u of SIM_USERS) {
      const c = verifySimToken(tokenFor(u.username), SECRET, NOW);
      expect(c.preferred_username).toBe(u.username);
      expect(c.sub).toBe(u.tideUserKey);
      expect(c.tideuserkey).toBe(u.tideUserKey);
      expect(c.realm_access.roles).toEqual(u.realmRoles);
      expect(c.iss).toBe("simulated-tidecloak");
    }
  });

  it.each([
    ["empty string", ""],
    ["no dots", "garbage"],
    ["wrong prefix", "jwt.aaa.bbb"],
    ["two segments", "sim.aaa"],
    ["four segments", "sim.aaa.bbb.ccc"],
    ["non-JSON payload", (() => { const h = "sim." + b64("not json"); return h + "." + sign(SECRET, h); })()],
  ])("rejects malformed token (%s) with 401", (_n, tok) => {
    expect(status(() => verifySimToken(tok, SECRET, NOW))).toBe(401);
  });

  it("rejects an edited payload that keeps the original signature (added role)", () => {
    const [p, payload, sig] = tokenFor("student-demo").split(".");
    const claims = unb64(payload);
    claims.realm_access.roles.push("approver");
    expect(status(() => verifySimToken(`${p}.${b64(JSON.stringify(claims))}.${sig}`, SECRET, NOW))).toBe(401);
  });

  it("rejects a signature truncated or with the wrong length", () => {
    const t = tokenFor("dean");
    expect(status(() => verifySimToken(t.slice(0, -4), SECRET, NOW))).toBe(401);
    expect(status(() => verifySimToken(t + "AAAA", SECRET, NOW))).toBe(401);
  });

  it("rejects a token verified with a different secret", () => {
    expect(status(() => verifySimToken(tokenFor("dean"), "other-secret", NOW))).toBe(401);
  });

  it("accepts one second before exp and rejects at exp", () => {
    const t = tokenFor("dean", NOW, 60);
    const exp = IAT + 60;
    expect(verifySimToken(t, SECRET, (exp - 1) * 1000 + 999).preferred_username).toBe("dean");
    expect(status(() => verifySimToken(t, SECRET, exp * 1000))).toBe(401);
    expect(status(() => verifySimToken(t, SECRET, exp * 1000 + 5000))).toBe(401);
  });

  it("rejects a correctly signed token whose preferred_username is not in SIM_USERS", () => {
    const tok = forge({
      iss: "simulated-tidecloak",
      sub: keyOf("mallory"),
      preferred_username: "mallory",
      tideuserkey: keyOf("mallory"),
      realm_access: { roles: ["approver"] },
      resource_access: {},
      iat: IAT,
      exp: IAT + 3600,
    });
    expect(status(() => verifySimToken(tok, SECRET, NOW))).toBe(401);
  });
});

describe("S13a callerFromClaims", () => {
  it("builds the caller from verified claims with displayName from SIM_USERS", () => {
    const c = callerFor("lecturer-demo");
    expect(c).toEqual({
      username: "lecturer-demo",
      displayName: "Lecturer",
      tideUserKey: keyOf("lecturer-demo"),
      realmRoles: ["_tide_enabled", "lecturer"],
      isRealmAdmin: false,
    });
  });

  it("sets isRealmAdmin only for it-admin", () => {
    for (const u of SIM_USERS) {
      expect(callerFor(u.username).isRealmAdmin).toBe(u.username === "it-admin");
    }
  });

  it("takes roles only from the claims it is given", () => {
    const c = callerFromClaims(verifySimToken(tokenFor("student-demo"), SECRET, NOW));
    expect(c.realmRoles).toEqual(["_tide_enabled", "student", "_tide_encryptor"]);
    expect(c.isRealmAdmin).toBe(false);
  });
});

describe("S13a authorize", () => {
  const ACTIONS: SimAction[] = [
    "rows.read",
    "courses.read",
    "leases.read",
    "audit.read",
    "probe.read",
    "audit.tamper-demo",
    "clock.advance",
    "feedback.submit",
    "lease.request",
    "lease.approve",
    "lease.reject",
    "summarise.run",
  ];
  const OPEN: SimAction[] = ACTIONS.slice(0, 7);
  // action -> required realm roles (hand-written from the S13a table)
  const NEEDS: Partial<Record<SimAction, string[]>> = {
    "feedback.submit": ["student", "_tide_encryptor"],
    "lease.request": ["lecturer"],
    "lease.approve": ["approver"],
    "lease.reject": ["approver"],
    "summarise.run": ["ai-operator", "_tide_decryptor"],
  };

  it("returns 401 with the exact message for a null caller on every action", () => {
    for (const a of ACTIONS) {
      let err: unknown;
      try {
        authorize(null, a);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SimAuthError);
      expect((err as SimAuthError).status).toBe(401);
      expect((err as SimAuthError).message).toBe("Unauthorized: sign in (simulated TideCloak)");
    }
  });

  it("allows any signed-in caller the open actions", () => {
    for (const u of SIM_USERS) {
      for (const a of OPEN) expect(status(() => authorize(callerFor(u.username), a))).toBeUndefined();
    }
  });

  it("matches the full allow/deny table for all 7 accounts and 12 actions", () => {
    for (const u of SIM_USERS) {
      const caller = callerFor(u.username);
      for (const a of ACTIONS) {
        const needs = NEEDS[a] ?? [];
        const allowed = needs.every((r) => u.realmRoles.includes(r));
        expect(status(() => authorize(caller, a)), `${u.username} ${a}`).toBe(allowed ? undefined : 403);
      }
    }
  });

  it("requires ALL roles for two-role actions (one of two is denied, naming the missing one)", () => {
    const mk = (roles: string[]): SimCaller => ({
      username: "x",
      displayName: "X",
      tideUserKey: "k",
      realmRoles: ["_tide_enabled", ...roles],
      isRealmAdmin: false,
    });
    const onlyStudent = mk(["student"]);
    expect(status(() => authorize(onlyStudent, "feedback.submit"))).toBe(403);
    expect(() => authorize(onlyStudent, "feedback.submit")).toThrow(/_tide_encryptor/);
    const onlyEnc = mk(["_tide_encryptor"]);
    expect(() => authorize(onlyEnc, "feedback.submit")).toThrow(/student/);
    expect(() => authorize(mk(["ai-operator"]), "summarise.run")).toThrow(/_tide_decryptor/);
    expect(() => authorize(mk(["_tide_decryptor"]), "summarise.run")).toThrow(/ai-operator/);
    expect(() => authorize(mk(["student", "_tide_encryptor"]), "feedback.submit")).not.toThrow();
  });

  it("403 message contains each missing role name", () => {
    const nobody = callerFor("it-admin");
    const cases: [SimAction, string[]][] = [
      ["feedback.submit", ["student", "_tide_encryptor"]],
      ["lease.request", ["lecturer"]],
      ["lease.approve", ["approver"]],
      ["lease.reject", ["approver"]],
      ["summarise.run", ["ai-operator", "_tide_decryptor"]],
    ];
    for (const [action, roles] of cases) {
      let err: unknown;
      try {
        authorize(nobody, action);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SimAuthError);
      expect((err as SimAuthError).status).toBe(403);
      for (const r of roles) expect((err as SimAuthError).message).toContain(r);
    }
  });

  it("denies it-admin (realm admin) every role-gated action but allows the open ones", () => {
    const admin = callerFor("it-admin");
    expect(admin.isRealmAdmin).toBe(true);
    for (const a of Object.keys(NEEDS) as SimAction[]) expect(status(() => authorize(admin, a)), a).toBe(403);
    for (const a of OPEN) expect(status(() => authorize(admin, a)), a).toBeUndefined();
  });

  it("allows ai-summariser-01 summarise.run but not lease.approve", () => {
    const agent = callerFor("ai-summariser-01");
    expect(() => authorize(agent, "summarise.run")).not.toThrow();
    expect(status(() => authorize(agent, "lease.approve"))).toBe(403);
    expect(status(() => authorize(agent, "lease.reject"))).toBe(403);
  });

  it("does not let an approver request a lease or a lecturer approve one", () => {
    expect(status(() => authorize(callerFor("dean"), "lease.request"))).toBe(403);
    expect(status(() => authorize(callerFor("lecturer-demo"), "lease.approve"))).toBe(403);
    expect(status(() => authorize(callerFor("student-demo"), "lease.approve"))).toBe(403);
  });
});
