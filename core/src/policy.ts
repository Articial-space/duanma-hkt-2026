// S2 - RelationshipAttestation policy parameters (A-09, A-20, A-21).
import { createHash } from "node:crypto";

export type SubjectType = "User" | "Group" | "Role";
export type PolicyRole = "_tide_encryptor" | "_tide_decryptor";

export interface PolicyInput {
  subjectType: SubjectType;
  subjectId: string;
  recordId: string;
  roles: Array<PolicyRole>;
  vendorId: string;
  clientId?: string;
  expirySeconds: number;
}

// A type alias (not an interface) so policies are comparable to plain JSON-like records.
export type RelationshipPolicy = {
  modelIds: string[];
  contractId: string;
  executionType: string;
  approvalType: string;
  keyId: string;
  expirySeconds: number;
  params: Record<string, string>;
  tags: string[];
};

export class PolicyError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "PolicyError";
  }
}

const SUBJECT_TYPES: readonly string[] = ["User", "Group", "Role"];
const ROLES: readonly string[] = ["_tide_encryptor", "_tide_decryptor"];
const MIN_EXPIRY_SECONDS = 60;
const MAX_EXPIRY_SECONDS = 604800; // one week; a SPEC choice, not a Tide limit (AU-02)

function requireNonBlank(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PolicyError(`${name} must be a non-empty string`);
  }
  return value;
}

export function buildRelationshipPolicy(input: PolicyInput): RelationshipPolicy {
  const subjectId = requireNonBlank("subjectId", input.subjectId);
  const recordId = requireNonBlank("recordId", input.recordId);
  const vendorId = requireNonBlank("vendorId", input.vendorId);

  if (!SUBJECT_TYPES.includes(input.subjectType)) {
    throw new PolicyError(`unknown subjectType: ${String(input.subjectType)}`);
  }
  if (!Array.isArray(input.roles) || input.roles.length === 0) {
    throw new PolicyError("roles must be a non-empty array");
  }
  for (const r of input.roles) {
    if (!ROLES.includes(r)) throw new PolicyError(`unknown role: ${String(r)}`);
  }
  if (new Set(input.roles).size !== input.roles.length) {
    throw new PolicyError("roles must not contain duplicates");
  }
  const exp = input.expirySeconds;
  if (!Number.isInteger(exp) || exp < MIN_EXPIRY_SECONDS || exp > MAX_EXPIRY_SECONDS) {
    throw new PolicyError(
      `expirySeconds must be an integer in ${MIN_EXPIRY_SECONDS}..${MAX_EXPIRY_SECONDS}`,
    );
  }
  if (input.clientId !== undefined && input.subjectType !== "Role") {
    throw new PolicyError("clientId is only allowed when subjectType is Role");
  }

  const params: Record<string, string> = {
    subjectType: input.subjectType,
    subjectId,
    assignmentId: recordId,
    roles: JSON.stringify(input.roles),
  };
  if (input.clientId !== undefined) params.clientId = String(input.clientId);

  return {
    modelIds: ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"],
    contractId: "RelationshipAttestation:1",
    executionType: "PRIVATE",
    approvalType: "IMPLICIT",
    keyId: vendorId,
    expirySeconds: exp,
    params,
    tags: [recordId],
  };
}

/** JSON with object keys sorted recursively (arrays keep their order). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, sortKeys(o[k])]),
    );
  }
  return v;
}

/** sha256 hex of the canonical JSON of the policy; independent of key insertion order. */
export function policyFingerprint(policy: RelationshipPolicy): string {
  return createHash("sha256").update(canonicalJson(policy)).digest("hex");
}
