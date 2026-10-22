'use client'

// S12 TruthVoice in Tide mode (live TideCloak, DPoP). All encryption, decryption and policy signing happen
// in the signed-in user's browser via the TideCloak SDK and the vendored lib/tide/relationship.ts. The server
// (app/api/tv/tide/*) stores ciphertext, signed policies and summaries; it never decrypts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTideCloak } from '@tidecloak/nextjs'
import {
  decryptForRecord,
  describeRelationshipPolicy,
  encryptForRecord,
  signRelationshipPolicy,
} from '@/lib/tide/relationship'
import { mockSummarize } from '../../../core/src/summarize.js'
import type { VerifyResult } from '../../../core/src/audit.js'
import { TIDE_BADGE } from '../lib/mode'
import { vendorIdFromConfig } from '../lib/tideConfig'
import type { PolicyForCaller, TideLeaseView, TideRow, TideStateView, TideSummary, WhoAmI } from '../lib/tideState'
import './truthvoice.css'

type Toast = { kind: 'info' | 'error'; text: string } | null
type AiResult =
  | { kind: 'ok'; summary: string; comments: number; skippedSelf: number }
  | { kind: 'app-blocked'; text: string }
  | { kind: 'network-blocked'; text: string }
type CheckResult = { ok: boolean; text: string } | null

const APPROVER_BUTTONS: Array<{ id: string; label: string }> = [
  { id: 'student-rep', label: 'Approve as Student rep' },
  { id: 'dean', label: 'Approve as Dean' },
  { id: 'qa-officer', label: 'Approve as QA officer' },
]
const POLL_MS = 3000
const CIPHERTEXT_PREVIEW = 56
const SELF_TAG = 'message' // realm default roles _tide_message.selfencrypt / selfdecrypt
const HONEST_LABEL = '2-of-3 approvals: enforced by this app. Subject, course and expiry: enforced by the Tide network.'

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour12: false })
}

function fmtRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function shortKey(k: string | null | undefined): string {
  if (!k) return '—'
  return k.length > 14 ? `${k.slice(0, 8)}…${k.slice(-4)}` : k
}

function courseOfLease(l: TideLeaseView): string {
  return l.purpose.replace(/^AI theme summary for /, '')
}

/** Message plus the contract's message from `cause` (how the network reports a refusal). */
function errorText(err: unknown): string {
  const e = err as { message?: unknown; cause?: unknown } | null
  const message = e && typeof e.message === 'string' ? e.message : String(err)
  const cause = e?.cause
  let c = ''
  if (cause instanceof Error) c = cause.message
  else if (typeof cause === 'string') c = cause
  else if (cause !== undefined && cause !== null) {
    try {
      c = JSON.stringify(cause)
    } catch {
      c = String(cause)
    }
  }
  return c ? `${message} — ${c}` : message
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
}

function asText(v: unknown): string {
  if (typeof v === 'string') return v
  if (v instanceof Uint8Array) return new TextDecoder().decode(v)
  return String(v)
}

function asCiphertext(v: unknown): string {
  if (typeof v === 'string') return v
  if (v instanceof Uint8Array) return btoa(String.fromCharCode(...v))
  throw new Error('unexpected ciphertext type from doEncrypt')
}

function Chip({ value }: { value: string }) {
  return <span className={`tv-chip tv-chip-${value.toLowerCase()}`}>{value}</span>
}

function VerifyChip({ v }: { v: VerifyResult | undefined }) {
  if (!v) return <span className="tv-empty">not run</span>
  return v.ok ? (
    <span className="tv-chip tv-chip-ok">CHAIN OK</span>
  ) : (
    <span className="tv-chip tv-chip-bad">BROKEN AT SEQ {v.brokenAt}</span>
  )
}

function SummaryBox({ summary }: { summary: TideSummary | undefined }) {
  if (!summary) return <div className="tv-result tv-result-none">No summary yet for this course.</div>
  return (
    <div className="tv-result tv-result-ok">
      READ — {summary.summary}{' '}
      <span style={{ fontWeight: 400 }}>
        ({summary.comments} comments decrypted in the AI operator&apos;s browser, {fmtTime(summary.at)})
      </span>
    </div>
  )
}

function AiResultBox({ result }: { result: AiResult | undefined }) {
  if (!result) return null
  if (result.kind === 'ok') {
    return (
      <div className="tv-result tv-result-ok">
        READ — {result.summary}{' '}
        <span style={{ fontWeight: 400 }}>
          ({result.comments} comments decrypted here{result.skippedSelf > 0 ? `; ${result.skippedSelf} self-encrypted rows skipped` : ''})
        </span>
      </div>
    )
  }
  if (result.kind === 'network-blocked') {
    return <div className="tv-result tv-result-blocked">BLOCKED by Tide network — {result.text}</div>
  }
  return <div className="tv-result tv-result-blocked">BLOCKED — {result.text}</div>
}

export default function TideTruthVoice() {
  const {
    authenticated,
    isInitializing,
    initError,
    login,
    logout,
    token,
    getValueFromIdToken,
    getValueFromToken,
    doEncrypt,
    doDecrypt,
    secureFetch,
    getVendorId,
  } = useTideCloak()

  const [view, setView] = useState<TideStateView | null>(null)
  const [me, setMe] = useState<WhoAmI | null>(null)
  const [course, setCourse] = useState('')
  const [studentCourse, setStudentCourse] = useState('')
  const [comment, setComment] = useState('')
  const [mine, setMine] = useState<string[]>([])
  const [myPlain, setMyPlain] = useState<Array<{ rowId: string; text: string }> | null>(null)
  const [aiResults, setAiResults] = useState<Record<string, AiResult>>({})
  const [heldPolicy, setHeldPolicy] = useState<Record<string, string>>({})
  const [checkPolicy, setCheckPolicy] = useState('')
  const [checkResult, setCheckResult] = useState<CheckResult>(null)
  const [adminPolicyB64, setAdminPolicyB64] = useState<string | null>(null)
  const [adminPolicyErr, setAdminPolicyErr] = useState('')
  const [verifyShown, setVerifyShown] = useState<VerifyResult | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast>(null)
  const whoamiDone = useRef<string | null>(null)

  const username = authenticated ? String(getValueFromIdToken('preferred_username') ?? '') : ''
  const tideUserKey = authenticated ? String(getValueFromToken('tideuserkey') ?? '') : ''
  const mineKey = tideUserKey ? `truthvoice-tide-mine:${tideUserKey}` : ''

  // Tide-mode API: secureFetch attaches `Authorization: DPoP <token>` and a DPoP proof when no
  // Authorization header is set. It needs an absolute URL (it parses the URL for the proof's htu).
  const tideApi = useCallback(
    async <T,>(path: string, body?: unknown): Promise<T> => {
      const res = await secureFetch(`${window.location.origin}/api/tv/tide/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      })
      let data: unknown = null
      try {
        data = await res.json()
      } catch {
        data = null
      }
      if (!res.ok) {
        const msg = (data as { error?: unknown } | null)?.error
        throw new Error(typeof msg === 'string' ? msg : `HTTP ${res.status}`)
      }
      return data as T
    },
    [secureFetch],
  )

  const refresh = useCallback(async () => {
    if (!authenticated) return
    try {
      const v = await tideApi<TideStateView>('state')
      setView(v)
      setMe(v.me)
      if (!course && v.courses[0]) setCourse(v.courses[0].courseCode)
      if (!studentCourse && v.courses[0]) setStudentCourse(v.courses[0].courseCode)
    } catch (err) {
      setToast({ kind: 'error', text: errorText(err) })
    }
  }, [authenticated, tideApi, course, studentCourse])

  // Sign-in once per token: record this account's tideuserkey (server reads it from the verified token).
  useEffect(() => {
    if (!authenticated || !token || whoamiDone.current === token) return
    whoamiDone.current = token
    tideApi<WhoAmI>('whoami', {})
      .then((w) => setMe(w))
      .catch((err) => setToast({ kind: 'error', text: `whoami: ${errorText(err)}` }))
  }, [authenticated, token, tideApi])

  useEffect(() => {
    if (!authenticated) return
    void refresh()
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [authenticated, refresh])

  useEffect(() => {
    if (!mineKey) return
    try {
      setMine(JSON.parse(localStorage.getItem(mineKey) ?? '[]') as string[])
    } catch {
      setMine([])
    }
  }, [mineKey])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  // Realm admins: fetch the admin policy (server-side from TideCloak) ahead of time, so a grant click
  // goes straight to the Tide enclave (pop-up blockers need the call close to the click).
  useEffect(() => {
    if (!me?.isRealmAdmin || adminPolicyB64 !== null) return
    tideApi<{ policy: string }>('admin-policy')
      .then((r) => {
        setAdminPolicyB64(r.policy)
        setAdminPolicyErr('')
      })
      .catch((err) => setAdminPolicyErr(errorText(err)))
  }, [me?.isRealmAdmin, adminPolicyB64, tideApi])

  async function act(fn: () => Promise<string | void>) {
    setBusy(true)
    try {
      const msg = await fn()
      if (msg) setToast({ kind: 'info', text: msg })
    } catch (err) {
      setToast({ kind: 'error', text: errorText(err) })
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const vendorId = () => {
    let v = ''
    try {
      v = getVendorId()
    } catch {
      v = ''
    }
    return v || vendorIdFromConfig()
  }

  async function adminPolicyBytes(): Promise<Uint8Array> {
    let b64 = adminPolicyB64
    if (!b64) {
      b64 = (await tideApi<{ policy: string }>('admin-policy')).policy
      setAdminPolicyB64(b64)
    }
    return b64ToBytes(b64)
  }

  const courses = view?.courses ?? []
  const rows = view?.rows ?? []
  const courseInfo = (code: string) => courses.find((c) => c.courseCode === code)

  // ---- student ------------------------------------------------------------------------------

  const submitFeedback = () =>
    act(async () => {
      const text = comment.trim()
      if (!text) throw new Error('comment is empty')
      if (text.length > 1000) throw new Error('comment is longer than 1000 characters')
      const info = courseInfo(studentCourse)
      if (!info) throw new Error('choose a course')
      const data = 'Comment: ' + text
      let ciphertext: string
      let encryption: 'record' | 'self'
      const write =
        me?.canEncrypt && info.writePolicy
          ? (await tideApi<{ policy: PolicyForCaller | null }>(
              `policies?recordId=${encodeURIComponent(info.recordId)}&access=write`,
            )).policy
          : null
      if (write) {
        ciphertext = await encryptForRecord(data, info.recordId, write.policyB64)
        encryption = 'record'
      } else {
        const [ct] = await doEncrypt([{ data, tags: [SELF_TAG] }])
        ciphertext = asCiphertext(ct)
        encryption = 'self'
      }
      const row = await tideApi<TideRow>('rows', { courseCode: studentCourse, ciphertext, encryption })
      const next = [...mine, row.rowId]
      setMine(next)
      if (mineKey) localStorage.setItem(mineKey, JSON.stringify(next))
      setComment('')
      return encryption === 'record'
        ? `Encrypted in your browser under the ${studentCourse} write policy; stored as ${row.rowId}`
        : `Self-encrypted in your browser (no course write policy); stored as ${row.rowId}`
    })

  const decryptMine = () =>
    act(async () => {
      const own = rows.filter((r) => mine.includes(r.rowId) && r.encryption === 'self')
      if (own.length === 0) {
        setMyPlain([])
        return 'No self-encrypted rows of yours on this server'
      }
      const out = await doDecrypt(own.map((r) => ({ encrypted: r.ciphertext, tags: [SELF_TAG] })))
      const list = Array.isArray(out) ? out : [out]
      setMyPlain(own.map((r, i) => ({ rowId: r.rowId, text: asText(list[i]).replace(/^Comment: /, '') })))
    })

  // ---- lecturer / approvals / admin -----------------------------------------------------------

  const requestSummary = () =>
    act(async () => {
      const lease = await tideApi<TideLeaseView>('leases', { courseCode: course })
      return `${lease.id} requested — waiting for approvals`
    })

  const approveLease = (leaseId: string, approverId: string) =>
    act(async () => {
      const lease = await tideApi<TideLeaseView>('leases/approve', { leaseId, approverId })
      return `${approverId} approved ${leaseId} → ${lease.effectiveStatus}`
    })

  const signLease = (lease: TideLeaseView) =>
    act(async () => {
      const aiKey = view?.aiOperator.tideUserKey
      if (!aiKey) throw new Error(`the AI operator (${view?.aiOperator.username}) must sign in once first`)
      const adminPolicy = await adminPolicyBytes()
      const expiry = Math.floor(Date.now() / 1000) + lease.ttlSeconds
      const policyB64 = await signRelationshipPolicy(
        { vendorId: vendorId(), subject: { type: 'User', id: aiKey }, recordId: lease.recordId, access: 'read', expiry },
        adminPolicy,
      )
      await tideApi('policies', { kind: 'read', leaseId: lease.id, policyB64 })
      return `Lease signed in Tide for ${lease.recordId}; the network refuses it after ${fmtTime(expiry * 1000)}`
    })

  const grantWrite = (courseCode: string, recordId: string) =>
    act(async () => {
      const adminPolicy = await adminPolicyBytes()
      const policyB64 = await signRelationshipPolicy(
        { vendorId: vendorId(), subject: { type: 'Role', id: '_tide_encryptor' }, recordId, access: 'write' },
        adminPolicy,
      )
      await tideApi('policies', { kind: 'write', courseCode, policyB64 })
      return `Course write policy signed for ${courseCode}`
    })

  // ---- AI summariser (runs in the AI operator's browser) -------------------------------------

  const runSummariser = () =>
    act(async () => {
      const info = courseInfo(course)
      if (!info) throw new Error('choose a course')
      const setResult = (r: AiResult) => setAiResults((s) => ({ ...s, [course]: r }))
      const { policy } = await tideApi<{ policy: PolicyForCaller | null }>(
        `policies?recordId=${encodeURIComponent(info.recordId)}&access=read`,
      )
      if (!policy) {
        setResult({ kind: 'app-blocked', text: 'no unexpired lease policy names you for this course' })
        return 'AI summariser BLOCKED (no lease)'
      }
      setHeldPolicy((h) => ({ ...h, [info.recordId]: policy.policyB64 }))
      const courseRows = rows.filter((r) => r.courseCode === course)
      const recordRows = courseRows.filter((r) => r.encryption === 'record')
      const lines: string[] = []
      for (const r of recordRows) {
        try {
          lines.push(await decryptForRecord(r.ciphertext, info.recordId, policy.policyB64))
        } catch (err) {
          // A refusal by the contract: show it, do not retry.
          setResult({ kind: 'network-blocked', text: errorText(err) })
          return 'AI summariser BLOCKED by the Tide network'
        }
      }
      const summary = mockSummarize(['Course: ' + course, 'Semester: 2026 S2', ...lines].join('\n'))
      await tideApi('summary', { courseCode: course, summary, comments: lines.length })
      setResult({ kind: 'ok', summary, comments: lines.length, skippedSelf: courseRows.length - recordRows.length })
      return 'AI summariser read the batch'
    })

  // ---- manual network checks (AC-16 G2/G3) ----------------------------------------------------

  const runNetworkCheck = () =>
    act(async () => {
      const info = courseInfo(course)
      if (!info) throw new Error('choose a course')
      const target = rows.find((r) => r.courseCode === course && r.encryption === 'record')
      if (!target) throw new Error(`no record-encrypted row for ${course} to try`)
      try {
        await decryptForRecord(target.ciphertext, info.recordId, checkPolicy.trim())
        setCheckResult({ ok: true, text: `READ — ${target.rowId} decrypted in this browser (plaintext not shown)` })
      } catch (err) {
        setCheckResult({ ok: false, text: `BLOCKED by Tide network — ${errorText(err)}` })
      }
    })

  const describeCheckPolicy = (): string => {
    if (!checkPolicy.trim()) return ''
    try {
      const d = describeRelationshipPolicy(checkPolicy.trim())
      return `${d.contractId}; subject ${d.subjectType} ${shortKey(d.subjectId)}; record ${d.recordId}; roles ${d.roles}; ${d.signed ? 'signed' : 'UNSIGNED'}`
    } catch (err) {
      return `not a readable policy: ${errorText(err)}`
    }
  }

  const verifyAudit = () =>
    act(async () => {
      const v = await tideApi<TideStateView>('state')
      setVerifyShown(v.audit.verify)
    })

  // ---- render ---------------------------------------------------------------------------------

  const header = (
    <header className="tv-header">
      <div>
        <h1>TruthVoice</h1>
        <p>Honest course feedback that no admin, lecturer or AI can read at will.</p>
      </div>
      <div className="tv-header-right">
        <span className="tv-badge tv-badge-tide">{TIDE_BADGE}</span>
        {authenticated && (
          <div className="tv-user">
            Signed in as <strong>{username || '—'}</strong>{' '}
            <span className="tv-mono-light" title={tideUserKey}>key {shortKey(tideUserKey)}</span>
            {me?.isRealmAdmin && <span className="tv-tag">realm admin</span>}
            {me?.isAiOperator && <span className="tv-tag">AI operator</span>}
            {me?.canEncrypt && <span className="tv-tag">_tide_encryptor</span>}
            {me?.canDecrypt && <span className="tv-tag">_tide_decryptor</span>}
            <button className="tv-btn tv-btn-small" onClick={() => void logout()}>Sign out</button>
          </div>
        )}
      </div>
    </header>
  )

  if (isInitializing || initError || !authenticated) {
    return (
      <div className="tv-root">
        <main className="tv-main">
          {header}
          <section className="tv-section">
            <h2>Sign in</h2>
            {isInitializing ? (
              <p className="tv-hint">Connecting to TideCloak…</p>
            ) : initError ? (
              <div className="tv-result tv-result-blocked">TideCloak could not start: {errorText(initError)}</div>
            ) : (
              <>
                <p className="tv-hint">Everything here runs on the live Tide network. Sign in to encrypt, approve or summarise.</p>
                <button className="tv-btn" onClick={() => void login()}>Sign in with Tide</button>
              </>
            )}
          </section>
        </main>
      </div>
    )
  }

  const leasesNewestFirst = [...(view?.leases ?? [])].reverse()
  const entriesNewestFirst = view ? [...view.audit.entries].reverse() : []
  const summaryFor = (code: string) => view?.summaries.find((s) => s.courseCode === code)
  const studentInfo = courseInfo(studentCourse)
  const willUseRecord = !!(me?.canEncrypt && studentInfo?.writePolicy)
  const aiKey = view?.aiOperator.tideUserKey ?? null
  const serverNow = view?.serverNow ?? Date.now()
  const held = courseInfo(course) ? heldPolicy[courseInfo(course)!.recordId] : undefined

  const courseSelect = (value: string, onChange: (v: string) => void, id: string) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {courses.map((c) => (
        <option key={c.courseCode} value={c.courseCode}>
          {c.courseCode} ({c.comments} comments)
        </option>
      ))}
    </select>
  )

  return (
    <div className="tv-root">
      <main className="tv-main">
        {header}
        <p className="tv-honest">{HONEST_LABEL}</p>

        {/* Student */}
        <section className="tv-section">
          <h2><span className="tv-num">2.</span>Student</h2>
          <p className="tv-hint">
            Your comment is encrypted <strong>in this browser</strong> by the Tide network before it is sent. The server stores
            ciphertext only, with no student id.
          </p>
          <div className="tv-col">
            <div className="tv-row">
              <label htmlFor="tv-student-course">Course</label>
              {courseSelect(studentCourse, setStudentCourse, 'tv-student-course')}
              {willUseRecord ? (
                <span className="tv-tag tv-tag-ok">course write policy — the AI can summarise it under a lease</span>
              ) : (
                <span className="tv-tag tv-tag-warn">
                  fallback: Tide self-encryption — only you can read it back; the AI cannot summarise it
                  {me && !me.canEncrypt ? ' (you lack _tide_encryptor)' : studentInfo && !studentInfo.writePolicy ? ' (no course write policy yet)' : ''}
                </span>
              )}
            </div>
            <textarea
              placeholder="Write your honest feedback (max 1000 characters)"
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="tv-row">
              <button className="tv-btn" disabled={busy || !comment.trim() || !studentCourse} onClick={submitFeedback}>
                Submit encrypted feedback
              </button>
              <button className="tv-btn tv-btn-ghost" disabled={busy} onClick={decryptMine}>
                Decrypt my own
              </button>
              <span className="tv-hint" style={{ margin: 0 }}>
                {mine.length} row(s) submitted from this browser by you
              </span>
            </div>
            {myPlain && (
              <div className="tv-result tv-result-none">
                {myPlain.length === 0 ? (
                  'Nothing of yours to decrypt (rows encrypted under a course write policy are write-only for students).'
                ) : (
                  <ul className="tv-plain-list">
                    {myPlain.map((p) => (
                      <li key={p.rowId}>
                        <strong>{p.rowId}</strong>: {p.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </section>

        {/* University database */}
        <section className="tv-section">
          <h2><span className="tv-num">3.</span>University database (IT admin view)</h2>
          <p className="tv-hint">Everything the IT admin, the database and the app server can see: Tide ciphertext only.</p>
          <div className="tv-table-wrap">
            <table className="tv-table">
              <thead>
                <tr><th>Row</th><th>Course</th><th>Time</th><th>Encryption</th><th>Ciphertext</th></tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="tv-empty">No feedback yet.</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.rowId}>
                    <td>{r.rowId}</td>
                    <td>{r.courseCode}</td>
                    <td>{fmtTime(r.at)}</td>
                    <td>{r.encryption === 'record' ? 'course policy' : 'self'}</td>
                    <td className="tv-mono" title={r.ciphertext}>
                      {r.ciphertext.length > CIPHERTEXT_PREVIEW ? r.ciphertext.slice(0, CIPHERTEXT_PREVIEW) + '…' : r.ciphertext}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Lecturer */}
        <section className="tv-section">
          <h2><span className="tv-num">4.</span>Lecturer</h2>
          <p className="tv-hint">The lecturer can ask for an AI theme summary — never the raw comments.</p>
          <div className="tv-row">
            <label htmlFor="tv-course">Course</label>
            {courseSelect(course, setCourse, 'tv-course')}
            <button className="tv-btn" disabled={busy || !course} onClick={requestSummary}>
              Request AI summary
            </button>
          </div>
          <SummaryBox summary={summaryFor(course)} />
        </section>

        {/* Approvals */}
        <section className="tv-section">
          <h2><span className="tv-num">5.</span>Approvals</h2>
          <p className="tv-hint">
            Any 2 of 3 approvers make the request ACTIVE (this app). A realm admin then signs the lease in Tide: a read
            policy naming the AI operator&apos;s key, this course only, with an expiry the network enforces.
          </p>
          <p className="tv-honest">{HONEST_LABEL}</p>
          {leasesNewestFirst.length === 0 ? (
            <div className="tv-empty">No summary requests yet.</div>
          ) : (
            <div className="tv-table-wrap">
              <table className="tv-table">
                <thead>
                  <tr><th>Lease</th><th>Course</th><th>Status (app)</th><th>Approvals</th><th>Remaining (app)</th><th>Tide lease</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {leasesNewestFirst.map((l) => {
                    const tp = l.tidePolicy
                    const tideLive = tp && (tp.expiresAt === null || tp.expiresAt > serverNow)
                    return (
                      <tr key={l.id}>
                        <td>{l.id}</td>
                        <td>{courseOfLease(l)}</td>
                        <td><Chip value={l.effectiveStatus} /></td>
                        <td>
                          {l.approvals.length} of {l.threshold}
                          {l.approvals.length > 0 && <span className="tv-hint"> ({l.approvals.join(', ')})</span>}
                        </td>
                        <td className="tv-mono">{l.effectiveStatus === 'ACTIVE' ? fmtRemaining(l.remainingMs) : '—'}</td>
                        <td>
                          {tp ? (
                            <>
                              <Chip value={tideLive ? 'SIGNED' : 'EXPIRED'} />{' '}
                              <span className="tv-mono">
                                {tp.expiresAt === null ? 'no expiry' : tideLive ? `${fmtRemaining(tp.expiresAt - serverNow)} left` : `at ${fmtTime(tp.expiresAt)}`}
                              </span>
                            </>
                          ) : (
                            <span className="tv-empty">not signed</span>
                          )}
                        </td>
                        <td>
                          {l.effectiveStatus === 'PENDING' ? (
                            <div className="tv-lease-actions">
                              {APPROVER_BUTTONS.map((a) => (
                                <button
                                  key={a.id}
                                  className="tv-btn tv-btn-ghost"
                                  disabled={busy || l.approvals.includes(a.id)}
                                  onClick={() => approveLease(l.id, a.id)}
                                >
                                  {a.label}
                                </button>
                              ))}
                            </div>
                          ) : l.effectiveStatus === 'ACTIVE' ? (
                            <button
                              className="tv-btn"
                              disabled={busy || !me?.isRealmAdmin || !aiKey}
                              title={!me?.isRealmAdmin ? 'Sign in as a realm admin (tide-realm-admin)' : !aiKey ? 'The AI operator must sign in once first' : ''}
                              onClick={() => signLease(l)}
                            >
                              Sign lease in Tide
                            </button>
                          ) : (
                            <span className="tv-empty">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="tv-hint" style={{ marginTop: 8 }}>
            AI operator account <strong>{view?.aiOperator.username}</strong>:{' '}
            {aiKey ? <>signed in once, key {shortKey(aiKey)}</> : 'has not signed in yet (its key is needed to sign a lease)'}
          </p>
        </section>

        {/* Realm admin */}
        <section className="tv-section">
          <h2><span className="tv-num">6.</span>Realm admin — course write policies</h2>
          <p className="tv-hint">
            Once per course: lets holders of the realm role _tide_encryptor (students) encrypt to that course&apos;s record.
            Signed in the admin&apos;s browser; the Tide enclave asks for approval.
          </p>
          {!me?.isRealmAdmin ? (
            <div className="tv-empty">Sign in as a realm admin (tide-realm-admin) to grant.</div>
          ) : (
            <>
              {adminPolicyErr && <div className="tv-result tv-result-blocked">Admin policy: {adminPolicyErr}</div>}
              <div className="tv-row" style={{ marginTop: 6 }}>
                {courses.map((c) => (
                  <button
                    key={c.courseCode}
                    className={c.writePolicy ? 'tv-btn tv-btn-ghost' : 'tv-btn'}
                    disabled={busy}
                    onClick={() => grantWrite(c.courseCode, c.recordId)}
                  >
                    {c.writePolicy ? `${c.courseCode}: write granted (re-grant)` : `Grant course write — ${c.courseCode}`}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        {/* AI summariser */}
        <section className="tv-section">
          <h2><span className="tv-num">7.</span>AI summariser</h2>
          <p className="tv-hint">
            Runs in the AI operator&apos;s browser: fetches its own lease policy, asks the Tide network to decrypt each
            course-policy row of <strong>{course || 'the course'}</strong>, summarises locally and sends only the summary.
          </p>
          <div className="tv-row">
            <button className="tv-btn" disabled={busy || !course || !me?.isAiOperator} onClick={runSummariser}>
              Run summariser
            </button>
            <span>for <strong>{course || '—'}</strong></span>
            {!me?.isAiOperator && <span className="tv-empty">Sign in as {view?.aiOperator.username} to run it.</span>}
          </div>
          <AiResultBox result={aiResults[course]} />
        </section>

        {/* Manual network checks */}
        <section className="tv-section">
          <h2><span className="tv-num">8.</span>Network checks (manual: expired lease, other user)</h2>
          <p className="tv-hint">
            Ask the Tide network to decrypt one {course || 'course'} row with any lease policy — e.g. the AI&apos;s lease after it
            expired (paste it from the AI operator&apos;s browser), or in another user&apos;s browser. The result comes from the network.
          </p>
          <div className="tv-col">
            <div className="tv-row">
              <button className="tv-btn tv-btn-ghost" disabled={!held} onClick={() => setCheckPolicy(held ?? '')}>
                Use the lease policy this browser last held
              </button>
              <button
                className="tv-btn tv-btn-ghost"
                disabled={!held}
                onClick={() => void navigator.clipboard?.writeText(held ?? '')}
              >
                Copy it
              </button>
            </div>
            <textarea
              className="tv-mono"
              placeholder="Signed lease policy (base64)"
              value={checkPolicy}
              onChange={(e) => setCheckPolicy(e.target.value)}
            />
            {checkPolicy.trim() && <div className="tv-hint" style={{ margin: 0 }}>{describeCheckPolicy()}</div>}
            <div className="tv-row">
              <button className="tv-btn" disabled={busy || !checkPolicy.trim() || !course} onClick={runNetworkCheck}>
                Try to decrypt with this policy
              </button>
            </div>
            {checkResult && (
              <div className={`tv-result ${checkResult.ok ? 'tv-result-ok' : 'tv-result-blocked'}`}>{checkResult.text}</div>
            )}
          </div>
        </section>

        {/* Audit trail */}
        <section className="tv-section">
          <h2><span className="tv-num">9.</span>Audit trail</h2>
          <div className="tv-row" style={{ marginBottom: 10 }}>
            <button className="tv-btn tv-btn-ghost" disabled={busy} onClick={verifyAudit}>Verify</button>
            <VerifyChip v={verifyShown} />
          </div>
          <div className="tv-table-wrap">
            <table className="tv-table">
              <thead>
                <tr><th>Seq</th><th>Time</th><th>Actor</th><th>Action</th><th>Record</th><th>Detail</th></tr>
              </thead>
              <tbody>
                {entriesNewestFirst.map((e) => (
                  <tr key={e.seq}>
                    <td>{e.seq}</td>
                    <td>{fmtTime(e.at)}</td>
                    <td>{e.actor}</td>
                    <td>{e.action}</td>
                    <td>{e.recordId ?? ''}</td>
                    <td>{e.detail ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      {toast && <div className={`tv-toast tv-toast-${toast.kind}`}>{toast.text}</div>}
    </div>
  )
}
