// S4 - tamper-evident audit log (hash chain, sha256).
import { createHash } from "node:crypto";
import { canonicalJson } from "./policy.js";

export interface AuditInput {
  at: number;
  actor: string;
  action: string;
  recordId?: string;
  detail?: string;
}

// A type alias (not an interface) so entries are assignable to Record<string, unknown>.
export type AuditEntry = {
  seq: number;
  at: number;
  actor: string;
  action: string;
  recordId?: string;
  detail?: string;
  prevHash: string;
  hash: string;
};

export type VerifyResult = { ok: true } | { ok: false; brokenAt: number };

function computeHash(e: Omit<AuditEntry, "hash">): string {
  const body = {
    seq: e.seq,
    at: e.at,
    actor: e.actor,
    action: e.action,
    recordId: e.recordId ?? null,
    detail: e.detail ?? null,
    prevHash: e.prevHash,
  };
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export class AuditLog {
  private list: AuditEntry[] = [];

  append(input: AuditInput): AuditEntry {
    const seq = this.list.length;
    const prevHash = seq === 0 ? "GENESIS" : this.list[seq - 1].hash;
    const base: Omit<AuditEntry, "hash"> = {
      seq,
      at: input.at,
      actor: input.actor,
      action: input.action,
      prevHash,
    };
    if (input.recordId !== undefined) base.recordId = input.recordId;
    if (input.detail !== undefined) base.detail = input.detail;
    const entry: AuditEntry = { ...base, hash: computeHash(base) };
    this.list.push(entry);
    return { ...entry };
  }

  entries(): AuditEntry[] {
    return this.list.map((e) => ({ ...e }));
  }

  verify(entries: AuditEntry[] = this.list): VerifyResult {
    let prev = "GENESIS";
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.seq !== i || e.prevHash !== prev || e.hash !== computeHash(e)) {
        return { ok: false, brokenAt: i };
      }
      prev = e.hash;
    }
    return { ok: true };
  }

  /** Reconstruct a log from stored entries without re-hashing (tampering stays detectable). */
  static fromEntries(entries: AuditEntry[]): AuditLog {
    const log = new AuditLog();
    log.list = entries.map((e) => ({ ...e }));
    return log;
  }
}
