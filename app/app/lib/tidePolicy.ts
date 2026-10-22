// S12b server-side reading of a signed RelationshipAttestation policy, so a posted policy can be checked
// against the subject, record and access the server expects before it is stored (the vendored README's
// "parse the policy and confirm it names the expected user and record"). Mirrors
// `describeRelationshipPolicy` in lib/tide/relationship.ts, which is browser-only (it imports the
// IAMService singleton) and so is not imported here. Reading is not verifying: the Tide network
// checks the signature, subject, record and expiry when the policy is used.
import 'server-only'
import { Models } from '@tideorg/js'

export const RELATIONSHIP_CONTRACT_ID = 'RelationshipAttestation:1'
const MAX_POLICY_B64 = 64 * 1024

export interface ParsedPolicy {
  contractId: string
  subjectType: string
  subjectId: string
  clientId: string
  recordId: string
  roles: string[]
  /** Absolute expiry in epoch seconds, or null when the policy has none. */
  expirySeconds: number | null
  signed: boolean
}

export function parseSignedPolicy(policyB64: string): ParsedPolicy {
  if (typeof policyB64 !== 'string' || policyB64.length === 0 || policyB64.length > MAX_POLICY_B64) {
    throw new Error('policyB64 must be a non-empty base64 string')
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(policyB64)) throw new Error('policyB64 is not base64')
  let p: InstanceType<typeof Models.Policy>
  try {
    p = Models.Policy.from(new Uint8Array(Buffer.from(policyB64, 'base64')))
  } catch (err) {
    throw new Error(`policy could not be read: ${err instanceof Error ? err.message : String(err)}`)
  }
  const param = (k: string): string => {
    const v = p.params.entries.get(k)
    return v === undefined || v === null ? '' : String(v)
  }
  let roles: string[] = []
  try {
    const r: unknown = JSON.parse(param('roles'))
    if (Array.isArray(r)) roles = r.map(String)
  } catch {
    roles = []
  }
  return {
    contractId: p.contractId,
    subjectType: param('subjectType'),
    subjectId: param('subjectId'),
    clientId: param('clientId'),
    recordId: param('assignmentId'),
    roles,
    expirySeconds: p.expiry === undefined || p.expiry === null ? null : Number(p.expiry),
    signed: !!p.signature && p.signature.length > 0,
  }
}
