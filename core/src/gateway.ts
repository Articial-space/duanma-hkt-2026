// S5 - Tide gateway seam.
//
// Design principle (C3): authority lives OUTSIDE app state. The gateway stands in for the Tide
// network: it holds its own secret that the app never sees, it signs a lease only after checking
// the quorum itself, and decryption trusts only a valid signed token - never the app's stored
// lease records.
//
// MockTideGateway is a local stand-in. It makes no claim of cryptographic equivalence to Tide;
// Tide enforces the real rule (phase 2 adds TideCloakGateway behind this same interface).
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { LeaseRequest } from "./lease.js";
import { canonicalJson, type RelationshipPolicy } from "./policy.js";
import { approvalThreshold } from "./threshold.js";

export interface LeaseToken {
  leaseId: string;
  agentId: string;
  recordId: string;
  expiresAt: number;
  approvals: string[];
  signature: string;
}

export interface TideGateway {
  encryptRecord(recordId: string, plaintext: string, policy: RelationshipPolicy): Promise<string>;
  signLease(req: LeaseRequest, now: number): Promise<LeaseToken>;
  decryptRecord(
    recordId: string,
    ciphertext: string,
    caller: { id: string },
    now: number,
    token?: LeaseToken,
  ): Promise<string>;
}

export class NotAuthorizedError extends Error {
  readonly code = "NOT_AUTHORIZED" as const;
  constructor(message?: string) {
    super(message ?? "not authorized");
    this.name = "NotAuthorizedError";
  }
}

const PREFIX = "tide-mock:v1:";
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(label: string, secret: string): Buffer {
  return createHash("sha256").update(`${label}\u0000${secret}`).digest();
}

type TokenBody = Omit<LeaseToken, "signature">;

export class MockTideGateway implements TideGateway {
  private readonly encKey: Buffer;
  private readonly sigKey: Buffer;
  private readonly approvers: ReadonlySet<string>;
  private readonly approverCount: number;
  private readonly owners = new Map<string, string>();

  constructor(opts: { secret: string; approvers: string[] }) {
    this.encKey = deriveKey("enc", opts.secret);
    this.sigKey = deriveKey("sig", opts.secret);
    this.approvers = new Set(opts.approvers);
    this.approverCount = opts.approvers.length;
  }

  /** Mock-only convenience (C4, PROPOSED): NOT a Tide behaviour. The owner decrypts without a token. */
  registerOwner(recordId: string, ownerId: string): void {
    this.owners.set(recordId, ownerId);
  }

  async encryptRecord(recordId: string, plaintext: string, _policy: RelationshipPolicy): Promise<string> {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv("aes-256-gcm", this.encKey, iv);
    cipher.setAAD(Buffer.from(recordId, "utf8"));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, body]).toString("base64url");
  }

  async signLease(req: LeaseRequest, now: number): Promise<LeaseToken> {
    if (req.status === "REJECTED" || req.status === "REVOKED") {
      throw new NotAuthorizedError(`lease request is ${req.status}`);
    }
    if (req.expiresAt !== undefined && !(now < req.expiresAt)) {
      throw new NotAuthorizedError("lease request has expired");
    }
    const valid: string[] = [];
    for (const id of req.approvals) {
      if (valid.includes(id)) continue;
      if (!this.approvers.has(id)) continue;
      if (id === req.agentId || id === req.requestedBy) continue;
      valid.push(id);
    }
    if (valid.length < approvalThreshold(this.approverCount)) {
      throw new NotAuthorizedError("quorum not reached");
    }
    const body: TokenBody = {
      leaseId: req.id,
      agentId: req.agentId,
      recordId: req.recordId,
      expiresAt: req.expiresAt ?? now + req.ttlSeconds * 1000,
      approvals: valid,
    };
    return { ...body, signature: this.sign(body) };
  }

  async decryptRecord(
    recordId: string,
    ciphertext: string,
    caller: { id: string },
    now: number,
    token?: LeaseToken,
  ): Promise<string> {
    const isOwner = this.owners.get(recordId) === caller.id;
    if (!isOwner) this.assertToken(recordId, caller, now, token);
    return this.open(recordId, ciphertext);
  }

  private sign(body: TokenBody): string {
    const canonical = canonicalJson({
      leaseId: body.leaseId,
      agentId: body.agentId,
      recordId: body.recordId,
      expiresAt: body.expiresAt,
      approvals: body.approvals,
    });
    return createHmac("sha256", this.sigKey).update(canonical).digest("hex");
  }

  private assertToken(recordId: string, caller: { id: string }, now: number, token?: LeaseToken): void {
    const t = token as Partial<LeaseToken> | undefined;
    if (
      !t ||
      typeof t.leaseId !== "string" ||
      typeof t.agentId !== "string" ||
      typeof t.recordId !== "string" ||
      typeof t.expiresAt !== "number" ||
      !Array.isArray(t.approvals) ||
      !t.approvals.every((a) => typeof a === "string") ||
      typeof t.signature !== "string"
    ) {
      throw new NotAuthorizedError("a signed lease token is required");
    }
    const expected = Buffer.from(
      this.sign({
        leaseId: t.leaseId,
        agentId: t.agentId,
        recordId: t.recordId,
        expiresAt: t.expiresAt,
        approvals: t.approvals,
      }),
      "utf8",
    );
    const given = Buffer.from(t.signature, "utf8");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new NotAuthorizedError("invalid lease signature");
    }
    if (t.agentId !== caller.id) throw new NotAuthorizedError("lease belongs to another caller");
    if (t.recordId !== recordId) throw new NotAuthorizedError("lease is for another record");
    if (!(now < t.expiresAt)) throw new NotAuthorizedError("lease expired");
  }

  private open(recordId: string, ciphertext: string): string {
    try {
      if (typeof ciphertext !== "string" || !ciphertext.startsWith(PREFIX)) throw new Error("bad prefix");
      const raw = Buffer.from(ciphertext.slice(PREFIX.length), "base64url");
      if (raw.length < IV_LEN + TAG_LEN) throw new Error("too short");
      const iv = raw.subarray(0, IV_LEN);
      const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
      const body = raw.subarray(IV_LEN + TAG_LEN);
      const decipher = createDecipheriv("aes-256-gcm", this.encKey, iv);
      decipher.setAAD(Buffer.from(recordId, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    } catch {
      throw new NotAuthorizedError("ciphertext cannot be opened for this record");
    }
  }
}
