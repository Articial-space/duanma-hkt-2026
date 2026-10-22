// S12b — in-memory store of signed RelationshipAttestation policies (Tide mode).
// Pure and in memory. One entry per (subjectType, subjectId, recordId, access); `put` replaces.
// Times are epoch milliseconds, like every `now` in core. A policy's own expiry is in epoch
// SECONDS; callers convert (`expiresAt = expirySeconds * 1000`). `null` = no expiry.
//
// This store is an app-level convenience (which policy to hand to whom). It is not the
// authority: the Tide network checks subject, record and expiry inside the signed policy.

export type PolicySubjectType = "User" | "Group" | "Role";
export type PolicyAccess = "read" | "write" | "read-write";

// A type alias (not an interface) so it is assignable to Record<string, unknown>.
export type PolicyEntry = {
  subjectType: PolicySubjectType;
  subjectId: string;
  recordId: string;
  access: PolicyAccess;
  /** The signed policy, base64 (as returned by `signRelationshipPolicy`). */
  policyB64: string;
  /** Epoch ms after which the entry is no longer handed out, or null for no expiry. */
  expiresAt: number | null;
  grantedBy: string;
  createdAt: number;
};

export type PolicyQuery = {
  subjectType: PolicySubjectType;
  subjectId: string;
  recordId: string;
  access: PolicyAccess;
  now: number;
};

export interface PolicyStore {
  put(entry: PolicyEntry): PolicyEntry;
  getFor(query: PolicyQuery): PolicyEntry | null;
  list(): PolicyEntry[];
}

function keyOf(e: { subjectType: string; subjectId: string; recordId: string; access: string }): string {
  return JSON.stringify([e.subjectType, e.subjectId, e.recordId, e.access]);
}

function copy(e: PolicyEntry): PolicyEntry {
  return {
    subjectType: e.subjectType,
    subjectId: e.subjectId,
    recordId: e.recordId,
    access: e.access,
    policyB64: e.policyB64,
    expiresAt: e.expiresAt,
    grantedBy: e.grantedBy,
    createdAt: e.createdAt,
  };
}

export function createPolicyStore(): PolicyStore {
  const entries = new Map<string, PolicyEntry>();

  return {
    put(entry: PolicyEntry): PolicyEntry {
      const stored = copy(entry);
      const key = keyOf(stored);
      // Delete first so a replaced entry moves to the end (most recent last).
      entries.delete(key);
      entries.set(key, stored);
      return copy(stored);
    },

    getFor(query: PolicyQuery): PolicyEntry | null {
      const found = entries.get(keyOf(query));
      if (!found) return null;
      if (found.expiresAt !== null && query.now >= found.expiresAt) return null;
      return copy(found);
    },

    list(): PolicyEntry[] {
      return [...entries.values()].map(copy);
    },
  };
}
