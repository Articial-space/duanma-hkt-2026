// S12 Tide-mode server state (in memory, one per server process). The server never decrypts and never
// holds plaintext: rows are ciphertext made in the student's browser, policies are signed in the admin's
// browser, and summaries are made in the AI operator's browser. App-level rules (2-of-3 approvals, who
// may store or fetch which policy) live here; subject, record and expiry are enforced by the Tide network.
import 'server-only'
import { AuditLog, type AuditEntry, type VerifyResult } from '../../../core/src/audit.js'
import { APPROVERS, SYNTHETIC_FEEDBACK } from '../../../core/src/fixtures.js'
import {
  LeaseError,
  approve,
  createLeaseRequest,
  effectiveStatus,
  remainingMs,
  type EffectiveStatus,
  type LeaseRequest,
} from '../../../core/src/lease.js'
import { createPolicyStore, type PolicyAccess, type PolicyStore, type PolicySubjectType } from '../../../core/src/policyStore.js'
import { recordIdFor } from '../../../core/src/service.js'
import { approvalThreshold } from '../../../core/src/threshold.js'
import { HttpError, aiOperatorUsername, type TideCaller } from './tideAuth'
import { RELATIONSHIP_CONTRACT_ID, parseSignedPolicy, type ParsedPolicy } from './tidePolicy'

export const ENCRYPT_ROLE = '_tide_encryptor'
export const DECRYPT_ROLE = '_tide_decryptor'
export const LEASE_TTL_SECONDS = 900
const MAX_CIPHERTEXT = 64 * 1024
const MAX_SUMMARY = 280
/** Allowed gap between "now + ttl" and the signed expiry (admin clock vs server clock). */
const EXPIRY_SLACK_SECONDS = 120

export type TideRow = {
  rowId: string
  recordId: string
  courseCode: string
  ciphertext: string
  at: number
  tide: true
  /** "record": Tide RelationshipAttestation write policy; "self": S12a self-encryption (only the author can read). */
  encryption: 'record' | 'self'
}
export type TideCourse = { courseCode: string; recordId: string; comments: number; writePolicy: boolean }
export type TideSummary = { courseCode: string; recordId: string; summary: string; comments: number; at: number }
export type TideLeaseView = LeaseRequest & {
  effectiveStatus: EffectiveStatus
  remainingMs: number
  threshold: number
  /** The Tide read policy stored for this lease's record and the AI operator, if any. */
  tidePolicy: { expiresAt: number | null; grantedBy: string; createdAt: number } | null
}
export type WhoAmI = {
  username: string
  tideUserKey: string
  isRealmAdmin: boolean
  isAiOperator: boolean
  aiOperatorUsername: string
  canEncrypt: boolean
  canDecrypt: boolean
}
export type TideStateView = {
  me: WhoAmI
  rows: TideRow[]
  courses: TideCourse[]
  leases: TideLeaseView[]
  summaries: TideSummary[]
  /** The AI operator's tideuserkey (a public key) once that account has signed in: what a lease policy names. */
  aiOperator: { username: string; tideUserKey: string | null }
  audit: { entries: AuditEntry[]; verify: VerifyResult }
  serverNow: number
}
export type PolicyForCaller = {
  subjectType: PolicySubjectType
  recordId: string
  access: PolicyAccess
  policyB64: string
  expiresAt: number | null
}

interface State {
  rows: TideRow[]
  users: Map<string, { username: string; tideUserKey: string; at: number }>
  policies: PolicyStore
  leases: LeaseRequest[]
  summaries: Map<string, TideSummary>
  audit: AuditLog
  nextRow: number
  nextLease: number
}

const stateKey = Symbol.for('truthvoice.tide.state')
type GlobalWithState = typeof globalThis & { [stateKey]?: State }

function state(): State {
  const g = globalThis as GlobalWithState
  if (!g[stateKey]) {
    g[stateKey] = {
      rows: [],
      users: new Map(),
      policies: createPolicyStore(),
      leases: [],
      summaries: new Map(),
      audit: new AuditLog(),
      nextRow: 1,
      nextLease: 1,
    }
  }
  return g[stateKey]!
}

const now = () => Date.now()

function courseCodeOf(v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '') throw new Error('courseCode must be a non-empty string')
  const c = v.trim()
  if (c.length > 40) throw new Error('courseCode is too long')
  return c
}

function whoAmI(c: TideCaller): WhoAmI {
  return {
    username: c.username,
    tideUserKey: c.tideUserKey,
    isRealmAdmin: c.isRealmAdmin,
    isAiOperator: c.isAiOperator,
    aiOperatorUsername: aiOperatorUsername(),
    canEncrypt: c.realmRoles.includes(ENCRYPT_ROLE),
    canDecrypt: c.realmRoles.includes(DECRYPT_ROLE),
  }
}

// ---- who is signed in -----------------------------------------------------------------------

/** Records the caller's tideuserkey (from the VERIFIED token) so an admin can later name them in a policy. */
export function recordWhoAmI(c: TideCaller): WhoAmI {
  const s = state()
  if (c.username && c.tideUserKey) {
    const known = s.users.get(c.username)
    if (!known || known.tideUserKey !== c.tideUserKey) {
      s.users.set(c.username, { username: c.username, tideUserKey: c.tideUserKey, at: now() })
      s.audit.append({ at: now(), actor: c.username, action: 'TIDE_KEY_RECORDED', detail: c.isAiOperator ? 'AI operator' : undefined })
    }
  }
  return whoAmI(c)
}

// ---- rows (ciphertext only) ------------------------------------------------------------------

export function submitRow(_c: TideCaller, body: Record<string, unknown>): TideRow {
  const courseCode = courseCodeOf(body['courseCode'])
  const ciphertext = body['ciphertext']
  if (typeof ciphertext !== 'string' || ciphertext.length === 0) throw new Error('ciphertext must be a non-empty string')
  if (ciphertext.length > MAX_CIPHERTEXT) throw new Error('ciphertext is too large')
  if (/^\s*Comment:/i.test(ciphertext)) throw new Error('refusing what looks like plaintext: encrypt in the browser first')
  const encryption = body['encryption']
  if (encryption !== 'record' && encryption !== 'self') throw new Error('encryption must be "record" or "self"')
  const s = state()
  const row: TideRow = {
    rowId: `row-${s.nextRow++}`,
    recordId: recordIdFor(courseCode),
    courseCode,
    ciphertext,
    at: now(),
    tide: true,
    encryption,
  }
  s.rows.push(row)
  // Never the student's identity: actor is the role, as in demo mode.
  s.audit.append({
    at: row.at,
    actor: 'student',
    action: 'FEEDBACK_SUBMITTED',
    recordId: row.recordId,
    detail: encryption === 'record' ? 'Tide record encryption (write policy)' : 'Tide self-encryption',
  })
  return { ...row }
}

function listCourses(): TideCourse[] {
  const s = state()
  const codes: string[] = SYNTHETIC_FEEDBACK.map((b) => b.courseCode)
  for (const r of s.rows) if (!codes.includes(r.courseCode)) codes.push(r.courseCode)
  return codes.map((courseCode) => {
    const recordId = recordIdFor(courseCode)
    return {
      courseCode,
      recordId,
      comments: s.rows.filter((r) => r.courseCode === courseCode).length,
      writePolicy:
        s.policies.getFor({ subjectType: 'Role', subjectId: ENCRYPT_ROLE, recordId, access: 'write', now: now() }) !== null,
    }
  })
}

// ---- leases (app-level 2-of-3 quorum, S10/S3 rules) ------------------------------------------

function aiOperatorKey(): string | null {
  return state().users.get(aiOperatorUsername())?.tideUserKey ?? null
}

function leaseView(req: LeaseRequest, t: number): TideLeaseView {
  const key = aiOperatorKey()
  const entry = key
    ? state().policies.list().find(
        (e) => e.subjectType === 'User' && e.subjectId === key && e.recordId === req.recordId && e.access === 'read' && e.createdAt >= (req.grantedAt ?? Infinity),
      ) ?? null
    : null
  return {
    ...req,
    approvals: [...req.approvals],
    effectiveStatus: effectiveStatus(req, t),
    remainingMs: remainingMs(req, t),
    threshold: approvalThreshold(req.adminCount),
    tidePolicy: entry ? { expiresAt: entry.expiresAt, grantedBy: entry.grantedBy, createdAt: entry.createdAt } : null,
  }
}

export function requestLease(c: TideCaller, body: Record<string, unknown>): TideLeaseView {
  const courseCode = courseCodeOf(body['courseCode'])
  const s = state()
  const t = now()
  const req = createLeaseRequest({
    id: `lease-${s.nextLease++}`,
    agentId: aiOperatorUsername(),
    recordId: recordIdFor(courseCode),
    purpose: 'AI theme summary for ' + courseCode,
    requestedBy: c.username || 'unknown-user',
    now: t,
    ttlSeconds: LEASE_TTL_SECONDS,
    adminCount: APPROVERS.length,
  })
  s.leases.push(req)
  s.audit.append({ at: t, actor: req.requestedBy, action: 'LEASE_REQUESTED', recordId: req.recordId, detail: req.id })
  return leaseView(req, t)
}

export function approveLease(c: TideCaller, body: Record<string, unknown>): TideLeaseView {
  const leaseId = body['leaseId']
  const approverId = body['approverId']
  if (typeof leaseId !== 'string' || typeof approverId !== 'string') throw new Error('leaseId and approverId must be strings')
  const s = state()
  const i = s.leases.findIndex((l) => l.id === leaseId)
  if (i < 0) throw new Error(`unknown lease ${leaseId}`)
  const req = s.leases[i]
  if (!APPROVERS.some((a) => a.id === approverId)) throw new LeaseError(`${approverId} is not an approver`)
  if (c.isAiOperator) throw new LeaseError('the AI operator account cannot approve')
  if (c.username !== '' && c.username === req.requestedBy) throw new LeaseError('the requester cannot approve their own request')
  const t = now()
  const next = approve(req, { id: approverId, isAgent: approverId === req.agentId }, t)
  s.leases[i] = next
  if (next.approvals.length !== req.approvals.length) {
    s.audit.append({
      at: t,
      actor: approverId,
      action: 'LEASE_APPROVED',
      recordId: next.recordId,
      detail: `${next.approvals.length} of ${approvalThreshold(next.adminCount)} (signed in as ${c.username || 'unknown'})`,
    })
  }
  return leaseView(next, t)
}

// ---- policies (signed in the admin's browser, stored here, enforced by the network) -----------

function sameRoles(p: ParsedPolicy, expected: string[]): boolean {
  return p.roles.length === expected.length && expected.every((r) => p.roles.includes(r))
}

function checkCommon(p: ParsedPolicy, recordId: string): void {
  if (p.contractId !== RELATIONSHIP_CONTRACT_ID) throw new Error(`policy contract is ${p.contractId}, expected ${RELATIONSHIP_CONTRACT_ID}`)
  if (!p.signed) throw new Error('policy is not signed')
  if (p.recordId !== recordId) throw new Error(`policy is for record ${p.recordId}, expected ${recordId}`)
}

/** Course write policy: Role `_tide_encryptor` may encrypt to this course's record. Realm admins only (route checks). */
export function storeWritePolicy(c: TideCaller, body: Record<string, unknown>): PolicyForCaller {
  const courseCode = courseCodeOf(body['courseCode'])
  const recordId = recordIdFor(courseCode)
  const policyB64 = String(body['policyB64'] ?? '')
  const p = parseSignedPolicy(policyB64)
  checkCommon(p, recordId)
  if (p.subjectType !== 'Role' || p.subjectId !== ENCRYPT_ROLE || p.clientId !== '') {
    throw new Error(`write policy must name the realm role ${ENCRYPT_ROLE}`)
  }
  if (!sameRoles(p, [ENCRYPT_ROLE])) throw new Error('write policy must grant write only')
  const t = now()
  const expiresAt = p.expirySeconds === null ? null : p.expirySeconds * 1000
  const entry = state().policies.put({
    subjectType: 'Role',
    subjectId: ENCRYPT_ROLE,
    recordId,
    access: 'write',
    policyB64,
    expiresAt,
    grantedBy: c.username,
    createdAt: t,
  })
  state().audit.append({ at: t, actor: c.username, action: 'WRITE_POLICY_SIGNED', recordId, detail: `Role ${ENCRYPT_ROLE}` })
  return { subjectType: entry.subjectType, recordId, access: entry.access, policyB64: entry.policyB64, expiresAt: entry.expiresAt }
}

/** Lease = read policy for the AI operator, only after the app-level quorum made the lease ACTIVE. */
export function storeLeasePolicy(c: TideCaller, body: Record<string, unknown>): TideLeaseView {
  const leaseId = body['leaseId']
  if (typeof leaseId !== 'string') throw new Error('leaseId must be a string')
  const s = state()
  const req = s.leases.find((l) => l.id === leaseId)
  if (!req) throw new Error(`unknown lease ${leaseId}`)
  const t = now()
  if (effectiveStatus(req, t) !== 'ACTIVE') {
    throw new Error(`lease ${leaseId} is ${effectiveStatus(req, t)}: the 2-of-3 approvals must make it ACTIVE first`)
  }
  const key = aiOperatorKey()
  if (!key) throw new Error(`the AI operator (${aiOperatorUsername()}) has not signed in yet, so its tideuserkey is unknown`)
  const policyB64 = String(body['policyB64'] ?? '')
  const p = parseSignedPolicy(policyB64)
  checkCommon(p, req.recordId)
  if (p.subjectType !== 'User' || p.subjectId !== key) throw new Error('lease policy must name the AI operator (its tideuserkey)')
  if (!sameRoles(p, [DECRYPT_ROLE])) throw new Error('lease policy must grant read only')
  if (p.expirySeconds === null) throw new Error('lease policy must have an expiry')
  const nowS = Math.floor(t / 1000)
  if (p.expirySeconds <= nowS) throw new Error('lease policy has already expired')
  if (p.expirySeconds > nowS + req.ttlSeconds + EXPIRY_SLACK_SECONDS) {
    throw new Error(`lease policy expiry is longer than the lease TTL (${req.ttlSeconds} s)`)
  }
  s.policies.put({
    subjectType: 'User',
    subjectId: key,
    recordId: req.recordId,
    access: 'read',
    policyB64,
    expiresAt: p.expirySeconds * 1000,
    grantedBy: c.username,
    createdAt: t,
  })
  s.audit.append({
    at: t,
    actor: c.username,
    action: 'LEASE_SIGNED_IN_TIDE',
    recordId: req.recordId,
    detail: `${req.id}; expires ${new Date(p.expirySeconds * 1000).toISOString()}`,
  })
  return leaseView(req, t)
}

/** Only a policy whose subject is the caller: their User key, one of their realm roles, or one of their groups. */
export function policyForCaller(c: TideCaller, recordId: string, access: PolicyAccess): PolicyForCaller | null {
  const subjects: Array<{ subjectType: PolicySubjectType; subjectId: string }> = []
  if (c.tideUserKey) subjects.push({ subjectType: 'User', subjectId: c.tideUserKey })
  for (const r of c.realmRoles) subjects.push({ subjectType: 'Role', subjectId: r })
  for (const g of c.groups) subjects.push({ subjectType: 'Group', subjectId: g })
  const t = now()
  for (const sub of subjects) {
    const e = state().policies.getFor({ ...sub, recordId, access, now: t })
    if (e) return { subjectType: e.subjectType, recordId: e.recordId, access: e.access, policyB64: e.policyB64, expiresAt: e.expiresAt }
  }
  return null
}

// ---- AI summary (made in the AI operator's browser) -------------------------------------------

export function storeSummary(c: TideCaller, body: Record<string, unknown>): TideSummary {
  if (!c.isAiOperator) throw new HttpError(403, `Forbidden: only the AI operator account (${aiOperatorUsername()}) posts summaries`)
  const courseCode = courseCodeOf(body['courseCode'])
  const summary = body['summary']
  const comments = body['comments']
  if (typeof summary !== 'string' || !summary.startsWith('SUMMARY:') || summary.length > MAX_SUMMARY) {
    throw new Error(`summary must start with "SUMMARY:" and be at most ${MAX_SUMMARY} characters`)
  }
  if (typeof comments !== 'number' || !Number.isInteger(comments) || comments < 0) throw new Error('comments must be a non-negative integer')
  const t = now()
  const s: TideSummary = { courseCode, recordId: recordIdFor(courseCode), summary, comments, at: t }
  state().summaries.set(courseCode, s)
  state().audit.append({
    at: t,
    actor: c.username,
    action: 'AGENT_READ',
    recordId: s.recordId,
    detail: `${comments} comments decrypted and summarised in the AI operator's browser`,
  })
  return { ...s }
}

// ---- everything the page shows ------------------------------------------------------------------

export function stateView(c: TideCaller): TideStateView {
  const s = state()
  const t = now()
  const entries = s.audit.entries()
  return {
    me: whoAmI(c),
    rows: s.rows.map((r) => ({ ...r })),
    courses: listCourses(),
    leases: s.leases.map((l) => leaseView(l, t)),
    summaries: [...s.summaries.values()].map((x) => ({ ...x })),
    aiOperator: { username: aiOperatorUsername(), tideUserKey: aiOperatorKey() },
    audit: { entries, verify: s.audit.verify() },
    serverNow: t,
  }
}
