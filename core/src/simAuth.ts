// S13a: simulated TideCloak sign-in, roles and access checks (demo mode). Pure, no network.
// Everything here is SIMULATED: tokens mirror the shape of a TideCloak access token but are signed
// with a local HMAC secret, and tideUserKey values are deterministic fakes.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface SimUser {
  readonly username: string;
  readonly displayName: string;
  readonly tideUserKey: string;
  readonly realmRoles: string[];
  readonly clientRoles: Record<string, string[]>;
}

const keyFor = (username: string): string =>
  createHash("sha256").update("sim-tide:" + username).digest("hex").slice(0, 32);

const mk = (
  username: string,
  displayName: string,
  roles: string[],
  clientRoles: Record<string, string[]> = {},
): SimUser => ({
  username,
  displayName,
  tideUserKey: keyFor(username),
  realmRoles: ["_tide_enabled", ...roles],
  clientRoles,
});

export const SIM_USERS: readonly SimUser[] = [
  mk("student-demo", "Student", ["student", "_tide_encryptor"]),
  mk("lecturer-demo", "Lecturer", ["lecturer"]),
  mk("student-rep", "Student representative", ["approver"]),
  mk("dean", "Dean", ["approver"]),
  mk("qa-officer", "QA officer", ["approver"]),
  mk("it-admin", "University IT admin", [], { "realm-management": ["tide-realm-admin"] }),
  mk("ai-summariser-01", "AI summariser (operator account)", ["ai-operator", "_tide_decryptor"]),
];

export class SimAuthError extends Error {
  readonly status: 401 | 403;
  constructor(status: 401 | 403, message: string) {
    super(message);
    this.name = "SimAuthError";
    this.status = status;
  }
}

export interface SimClaims {
  iss: string;
  sub: string;
  preferred_username: string;
  tideuserkey: string;
  realm_access: { roles: string[] };
  resource_access: Record<string, { roles: string[] }>;
  iat: number;
  exp: number;
}

export interface SimCaller {
  username: string;
  displayName: string;
  tideUserKey: string;
  realmRoles: string[];
  isRealmAdmin: boolean;
}

const b64url = (s: string): string => Buffer.from(s, "utf8").toString("base64url");
const hmac = (secret: string, data: string): Buffer => createHmac("sha256", secret).update(data).digest();

export function issueSimToken(opts: { username: string; secret: string; now: number; ttlSeconds?: number }): string {
  const user = SIM_USERS.find((u) => u.username === opts.username);
  if (!user) throw new SimAuthError(401, "Unauthorized: unknown simulated account");
  if (!opts.secret) throw new Error("simAuth: secret must not be empty");
  const iat = Math.floor(opts.now / 1000);
  const resource_access: Record<string, { roles: string[] }> = {};
  for (const [client, roles] of Object.entries(user.clientRoles)) {
    if (roles.length > 0) resource_access[client] = { roles: [...roles] };
  }
  const claims: SimClaims = {
    iss: "simulated-tidecloak",
    sub: user.tideUserKey,
    preferred_username: user.username,
    tideuserkey: user.tideUserKey,
    realm_access: { roles: [...user.realmRoles] },
    resource_access,
    iat,
    exp: iat + (opts.ttlSeconds ?? 3600),
  };
  const head = "sim." + b64url(JSON.stringify(claims));
  return head + "." + hmac(opts.secret, head).toString("base64url");
}

const bad = (why: string): SimAuthError => new SimAuthError(401, "Unauthorized: " + why);

export function verifySimToken(token: string, secret: string, now: number): SimClaims {
  if (typeof token !== "string") throw bad("malformed token");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "sim" || !parts[1] || !parts[2]) throw bad("malformed token");
  if (!secret) throw bad("bad signature");
  const expected = hmac(secret, "sim." + parts[1]);
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw bad("bad signature");
  let claims: SimClaims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as SimClaims;
  } catch {
    throw bad("malformed token");
  }
  if (typeof claims !== "object" || claims === null || typeof claims.exp !== "number") throw bad("malformed token");
  if (Math.floor(now / 1000) >= claims.exp) throw bad("token expired");
  if (!SIM_USERS.some((u) => u.username === claims.preferred_username)) throw bad("unknown account");
  return claims;
}

export function callerFromClaims(claims: SimClaims): SimCaller {
  const user = SIM_USERS.find((u) => u.username === claims.preferred_username);
  const adminRoles = claims.resource_access?.["realm-management"]?.roles ?? [];
  return {
    username: claims.preferred_username,
    displayName: user ? user.displayName : claims.preferred_username,
    tideUserKey: claims.tideuserkey,
    realmRoles: [...(claims.realm_access?.roles ?? [])],
    isRealmAdmin: adminRoles.includes("tide-realm-admin"),
  };
}

export type SimAction =
  | "rows.read"
  | "courses.read"
  | "leases.read"
  | "audit.read"
  | "probe.read"
  | "audit.tamper-demo"
  | "clock.advance"
  | "feedback.submit"
  | "lease.request"
  | "lease.approve"
  | "lease.reject"
  | "summarise.run";

/** Realm roles required (ALL of them) per action; actions not listed need only a signed-in caller. */
export const SIM_ACTION_ROLES: Readonly<Partial<Record<SimAction, readonly string[]>>> = {
  "feedback.submit": ["student", "_tide_encryptor"],
  "lease.request": ["lecturer"],
  "lease.approve": ["approver"],
  "lease.reject": ["approver"],
  "summarise.run": ["ai-operator", "_tide_decryptor"],
};

export function authorize(caller: SimCaller | null, action: SimAction): void {
  if (!caller) throw new SimAuthError(401, "Unauthorized: sign in (simulated TideCloak)");
  const missing = (SIM_ACTION_ROLES[action] ?? []).filter((r) => !caller.realmRoles.includes(r));
  if (missing.length > 0) {
    throw new SimAuthError(403, `Forbidden: ${action} requires realm role ${missing.join(" and ")} (simulated TideCloak)`);
  }
}
