'use client'

// S11 TruthVoice demo page (demo mode: the Tide network is simulated by the mock gateway on the server).
// Rendered by ./page.tsx when tidecloak.json has no realm (S12 mode detection).
// The browser only ever receives ciphertext, lease state, theme summaries, probe results and audit entries.
import { useCallback, useEffect, useState } from 'react'
import type { AuditEntry, VerifyResult } from '../../../core/src/audit.js'
import type { ProbeRow } from '../../../core/src/probe.js'
import type { CourseInfo, FeedbackRow, LeaseView, SummariserResult } from '../../../core/src/service.js'
import { approvalThreshold } from '../../../core/src/threshold.js'
import type { SimCaller, SimUser } from '../../../core/src/simAuth.js'
import { DEMO_BADGE } from '../lib/mode'
import { FIT_ROWS, SIM_NOTE } from './fit'
import './truthvoice.css'

type AuditView = { entries: AuditEntry[]; verify: VerifyResult }
type Toast = { kind: 'info' | 'error'; text: string } | null

// Realm roles each section needs (S13). The server checks them again on every request.
const ROLES = {
  student: ['student', '_tide_encryptor'],
  lecturer: ['lecturer'],
  approver: ['approver'],
  summariser: ['ai-operator', '_tide_decryptor'],
}
const missingRoles = (caller: SimCaller | null, needs: string[]): string[] =>
  caller ? needs.filter((r) => !caller.realmRoles.includes(r)) : needs
const shortKey = (k: string) => k.slice(0, 8) + '…'
const POLL_MS = 3000
const CIPHERTEXT_PREVIEW = 56

class SessionError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/tv/${path}`, {
    credentials: 'same-origin',
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  const data = await res.json()
  if (!res.ok) throw new SessionError((data && data.error) || `HTTP ${res.status}`, res.status)
  return data as T
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour12: false })
}

function fmtRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function courseOfLease(l: LeaseView): string {
  return l.purpose.replace(/^AI theme summary for /, '')
}

function Chip({ value }: { value: string }) {
  return <span className={`tv-chip tv-chip-${value.toLowerCase()}`}>{value}</span>
}

function SummaryBox({ result }: { result: SummariserResult | undefined }) {
  if (!result) return <div className="tv-result tv-result-none">No summary yet for this course.</div>
  if (result.ok) {
    return (
      <div className="tv-result tv-result-ok">
        READ — {result.summary} <span style={{ fontWeight: 400 }}>({result.comments} comments decrypted by the AI only)</span>
      </div>
    )
  }
  return <div className="tv-result tv-result-blocked">BLOCKED — no active lease</div>
}

function VerifyChip({ v }: { v: VerifyResult | undefined }) {
  if (!v) return <span className="tv-empty">not run</span>
  return v.ok ? (
    <span className="tv-chip tv-chip-ok">CHAIN OK</span>
  ) : (
    <span className="tv-chip tv-chip-bad">BROKEN AT SEQ {v.brokenAt}</span>
  )
}

export default function DemoTruthVoice() {
  const [courses, setCourses] = useState<CourseInfo[]>([])
  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [leases, setLeases] = useState<LeaseView[]>([])
  const [audit, setAudit] = useState<AuditView | null>(null)
  const [probe, setProbe] = useState<ProbeRow[]>([])
  const [course, setCourse] = useState('')
  const [studentCourse, setStudentCourse] = useState('')
  const [comment, setComment] = useState('')
  const [summaries, setSummaries] = useState<Record<string, SummariserResult>>({})
  const [verifyShown, setVerifyShown] = useState<VerifyResult | undefined>(undefined)
  const [tamper, setTamper] = useState<VerifyResult | undefined>(undefined)
  const [clockOffsetMin, setClockOffsetMin] = useState(0)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast>(null)
  const [caller, setCaller] = useState<SimCaller | null>(null)
  const [users, setUsers] = useState<SimUser[]>([])
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        setUsers(await api<SimUser[]>('sim/users'))
        setCaller((await api<{ caller: SimCaller | null }>('sim/whoami')).caller)
      } catch (err) {
        setToast({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      } finally {
        setAuthReady(true)
      }
    })()
  }, [])

  const refresh = useCallback(async () => {
    if (!caller) return
    try {
      const [c, r, l, a] = await Promise.all([
        api<CourseInfo[]>('courses'),
        api<FeedbackRow[]>('rows'),
        api<LeaseView[]>('leases'),
        api<AuditView>('audit'),
      ])
      setCourses(c)
      setRows(r)
      setLeases(l)
      setAudit(a)
      const selected = course || c[0]?.courseCode || ''
      if (!course && selected) setCourse(selected)
      if (!studentCourse && c[0]) setStudentCourse(c[0].courseCode)
      if (selected) setProbe(await api<ProbeRow[]>(`probe?course=${encodeURIComponent(selected)}`))
    } catch (err) {
      if (err instanceof SessionError && err.status === 401) setCaller(null)
      setToast({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }, [caller, course, studentCourse])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  async function act(fn: () => Promise<string | void>) {
    setBusy(true)
    try {
      const msg = await fn()
      if (msg) setToast({ kind: 'info', text: msg })
    } catch (err) {
      if (err instanceof SessionError && err.status === 401) setCaller(null)
      setToast({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const signIn = (username: string) =>
    act(async () => {
      const res = await api<{ caller: SimCaller }>('sim/login', { username })
      setCaller(res.caller)
      return `Signed in as ${res.caller.displayName} (simulated TideCloak)`
    })

  const signOut = async () => {
    try {
      await api('sim/logout', {})
      setCaller(null)
      setSummaries({})
      setVerifyShown(undefined)
      setTamper(undefined)
      setToast({ kind: 'info', text: 'Signed out' })
    } catch (err) {
      setToast({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  const submitFeedback = () =>
    act(async () => {
      const row = await api<FeedbackRow>('feedback', { courseCode: studentCourse, comment })
      setComment('')
      return `Encrypted and stored as ${row.rowId}`
    })

  const requestSummary = () =>
    act(async () => {
      const lease = await api<LeaseView>('leases', { courseCode: course })
      return `${lease.id} requested — waiting for approvals`
    })

  // Identity comes from the signed token on the server; the body carries only the lease id.
  const approveLease = (leaseId: string) =>
    act(async () => {
      const lease = await api<LeaseView>('leases/approve', { leaseId })
      return `${caller?.displayName} approved ${leaseId} → ${lease.status}`
    })

  const rejectLease = (leaseId: string) =>
    act(async () => {
      const lease = await api<LeaseView>('leases/reject', { leaseId })
      return `${caller?.displayName} rejected ${leaseId} → ${lease.status}`
    })

  const runSummariser = () =>
    act(async () => {
      const res = await api<SummariserResult>('summarise', { courseCode: course })
      setSummaries((s) => ({ ...s, [course]: res }))
      return res.ok ? 'AI summariser read the batch' : 'AI summariser BLOCKED'
    })

  const verifyAudit = () =>
    act(async () => {
      const a = await api<AuditView>('audit')
      setVerifyShown(a.verify)
    })

  const tamperTest = () =>
    act(async () => {
      setTamper(await api<VerifyResult>('audit/tamper-demo', {}))
    })

  const fastForward = () =>
    act(async () => {
      const res = await api<{ offsetMs: number }>('clock/advance', { minutes: 16 })
      setClockOffsetMin(Math.round(res.offsetMs / 60000))
      return 'Demo clock moved forward 16 minutes'
    })

  const courseSelect = (value: string, onChange: (v: string) => void, id: string) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {courses.map((c) => (
        <option key={c.courseCode} value={c.courseCode}>
          {c.courseCode} ({c.comments} comments)
        </option>
      ))}
    </select>
  )

  const roleNote = (needs: string[]) => {
    const missing = missingRoles(caller, needs)
    return (
      <p className={`tv-role ${missing.length ? 'tv-role-missing' : 'tv-role-ok'}`}>
        Needs realm role{needs.length > 1 ? 's' : ''}: <code>{needs.join(' + ')}</code>
        {missing.length > 0 && ` — Requires role ${missing.join(' + ')}`}
      </p>
    )
  }
  const lockedTitle = (needs: string[]) => {
    const missing = missingRoles(caller, needs)
    return missing.length ? `Requires role ${missing.join(' + ')}` : undefined
  }
  const canStudent = missingRoles(caller, ROLES.student).length === 0
  const canLecturer = missingRoles(caller, ROLES.lecturer).length === 0
  const canApprove = missingRoles(caller, ROLES.approver).length === 0
  const canSummarise = missingRoles(caller, ROLES.summariser).length === 0

  const leasesNewestFirst =[...leases].reverse()
  const entriesNewestFirst = audit ? [...audit.entries].reverse() : []

  return (
    <div className="tv-root">
      <main className="tv-main">
        {/* 1. Header */}
        <header className="tv-header">
          <div>
            <h1>TruthVoice</h1>
            <p>Honest course feedback that no admin, lecturer or AI can read at will.</p>
          </div>
          <div className="tv-badge-col">
            <span className="tv-badge">{DEMO_BADGE}</span>
            <span className="tv-sim-note">{SIM_NOTE}</span>
          </div>
        </header>

        {/* Simulated TideCloak sign-in (S13) */}
        <section className="tv-section tv-signin">
          <h2>Sign in (simulated TideCloak)</h2>
          {caller ? (
            <div className="tv-who">
              <div>
                Signed in as <strong>{caller.displayName}</strong> (<span className="tv-mono">{caller.username}</span>)
                {' · '}tideuserkey{' '}
                <span className="tv-mono" title="deterministic fake key (simulated)">{shortKey(caller.tideUserKey)}</span>
                <div className="tv-roles">
                  {caller.realmRoles.map((r) => <span key={r} className="tv-role-chip">{r}</span>)}
                  {caller.isRealmAdmin && <span className="tv-role-chip tv-role-chip-admin">realm-management: tide-realm-admin</span>}
                </div>
              </div>
              <button className="tv-btn tv-btn-ghost" disabled={busy} onClick={signOut}>Sign out</button>
            </div>
          ) : (
            <p className="tv-hint">Pick a simulated account. Roles are issued in a signed token and re-checked by the server on every request.</p>
          )}
          <div className="tv-accounts">
            {users.map((u) => (
              <button
                key={u.username}
                className={`tv-account ${caller?.username === u.username ? 'tv-account-on' : ''}`}
                disabled={busy}
                onClick={() => signIn(u.username)}
              >
                <strong>{u.displayName}</strong>
                <span className="tv-mono">{u.username}</span>
                <span className="tv-account-roles">
                  {[...u.realmRoles.filter((r) => r !== '_tide_enabled'), ...Object.values(u.clientRoles).flat()].join(', ') || 'no data roles'}
                </span>
              </button>
            ))}
          </div>
        </section>

        {!authReady ? null : !caller ? (
          <section className="tv-section"><div className="tv-empty">Sign in to continue.</div></section>
        ) : (
        <>

        {/* 2. Student */}
        <section className="tv-section">
          <h2><span className="tv-num">2.</span>Student</h2>
          <p className="tv-hint">Feedback is encrypted on submit. No student id is stored.</p>
          {roleNote(ROLES.student)}
          <div className="tv-col">
            <div className="tv-row">
              <label htmlFor="tv-student-course">Course</label>
              {courseSelect(studentCourse, setStudentCourse, 'tv-student-course')}
            </div>
            <textarea
              placeholder="Write your honest feedback (max 1000 characters)"
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="tv-row">
              <button className="tv-btn" disabled={busy || !canStudent || !comment.trim() || !studentCourse} title={lockedTitle(ROLES.student)} onClick={submitFeedback}>
                Submit encrypted feedback
              </button>
            </div>
          </div>
        </section>

        {/* 3. University database */}
        <section className="tv-section">
          <h2><span className="tv-num">3.</span>University database (IT admin view)</h2>
          <p className="tv-hint">Everything the IT admin, the database and the app server can see: ciphertext only.</p>
          <div className="tv-table-wrap">
            <table className="tv-table">
              <thead>
                <tr><th>Row</th><th>Course</th><th>Time</th><th>Ciphertext</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowId}>
                    <td>{r.rowId}</td>
                    <td>{r.courseCode}</td>
                    <td>{fmtTime(r.at)}</td>
                    <td className="tv-mono" title={r.ciphertext}>
                      {r.ciphertext.length > CIPHERTEXT_PREVIEW ? r.ciphertext.slice(0, CIPHERTEXT_PREVIEW) + '…' : r.ciphertext}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 4. Lecturer */}
        <section className="tv-section">
          <h2><span className="tv-num">4.</span>Lecturer</h2>
          <p className="tv-hint">The lecturer can ask for an AI theme summary — never the raw comments.</p>
          {roleNote(ROLES.lecturer)}
          <div className="tv-row">
            <label htmlFor="tv-course">Course</label>
            {courseSelect(course, setCourse, 'tv-course')}
            <button className="tv-btn" disabled={busy || !canLecturer || !course} title={lockedTitle(ROLES.lecturer)} onClick={requestSummary}>
              Request AI summary
            </button>
          </div>
          <SummaryBox result={summaries[course]} />
        </section>

        {/* 5. Approvals */}
        <section className="tv-section">
          <h2><span className="tv-num">5.</span>Approvals</h2>
          <p className="tv-hint">Any 2 of 3 independent approvers grant a short lease to the AI. The lecturer and the AI cannot approve.</p>
          {roleNote(ROLES.approver)}
          {leasesNewestFirst.length === 0 ? (
            <div className="tv-empty">No summary requests yet.</div>
          ) : (
            <div className="tv-table-wrap">
              <table className="tv-table">
                <thead>
                  <tr><th>Lease</th><th>Course</th><th>Status</th><th>Approvals</th><th>Remaining</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {leasesNewestFirst.map((l) => (
                    <tr key={l.id}>
                      <td>{l.id}</td>
                      <td>{courseOfLease(l)}</td>
                      <td><Chip value={l.effectiveStatus} /></td>
                      <td>
                        {l.approvals.length} of {approvalThreshold(l.adminCount)}
                        {l.approvals.length > 0 && <span className="tv-hint"> ({l.approvals.join(', ')})</span>}
                      </td>
                      <td className="tv-mono">{l.effectiveStatus === 'ACTIVE' ? fmtRemaining(l.remainingMs) : '—'}</td>
                      <td>
                        {l.effectiveStatus === 'PENDING' ? (
                          <div className="tv-lease-actions">
                            <button
                              className="tv-btn tv-btn-ghost"
                              disabled={busy || !canApprove || (!!caller && l.approvals.includes(caller.username))}
                              title={lockedTitle(ROLES.approver)}
                              onClick={() => approveLease(l.id)}
                            >
                              {canApprove ? `Approve as ${caller?.displayName}` : 'Approve — Requires role approver'}
                            </button>
                            <button
                              className="tv-btn tv-btn-ghost"
                              disabled={busy || !canApprove}
                              title={lockedTitle(ROLES.approver)}
                              onClick={() => rejectLease(l.id)}
                            >
                              {canApprove ? `Reject as ${caller?.displayName}` : 'Reject — Requires role approver'}
                            </button>
                          </div>
                        ) : (
                          <span className="tv-empty">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 6. AI summariser */}
        <section className="tv-section">
          <h2><span className="tv-num">6.</span>AI summariser</h2>
          <p className="tv-hint">The AI can decrypt {course || 'the course'} only while a lease for it is active.</p>
          {roleNote(ROLES.summariser)}
          <div className="tv-row">
            <button className="tv-btn" disabled={busy || !canSummarise || !course} title={lockedTitle(ROLES.summariser)} onClick={runSummariser}>
              Run summariser
            </button>
            <span>for <strong>{course || '—'}</strong></span>
          </div>
          <SummaryBox result={summaries[course]} />
        </section>

        {/* 7. Probe */}
        <section className="tv-section">
          <h2><span className="tv-num">7.</span>Who can read this feedback right now?</h2>
          <p className="tv-hint">Live decrypt attempts against {course || 'the selected course'} — nothing here is hard-coded.</p>
          <table className="tv-table">
            <thead>
              <tr><th>Who</th><th>Attempt</th><th>Result</th></tr>
            </thead>
            <tbody>
              {probe.map((p) => (
                <tr key={p.who}>
                  <td>{p.who}</td>
                  <td>{p.attempt}</td>
                  <td><Chip value={p.result} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* 8. Audit trail */}
        <section className="tv-section">
          <h2><span className="tv-num">8.</span>Audit trail</h2>
          <div className="tv-row" style={{ marginBottom: 10 }}>
            <button className="tv-btn tv-btn-ghost" disabled={busy} onClick={verifyAudit}>Verify</button>
            <VerifyChip v={verifyShown} />
            <button className="tv-btn tv-btn-warn" disabled={busy} onClick={tamperTest}>Tamper test</button>
            <span>{tamper ? <>Copy with seq 1 edited → <VerifyChip v={tamper} /></> : <span className="tv-empty">not run</span>}</span>
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

        {/* 9. Demo clock */}
        <section className="tv-section">
          <h2><span className="tv-num">9.</span>Demo clock</h2>
          <div className="tv-row">
            <button className="tv-btn" disabled={busy} onClick={fastForward}>Fast-forward 16 minutes</button>
            {clockOffsetMin > 0 && <span>Demo clock is {clockOffsetMin} minutes ahead of real time.</span>}
          </div>
        </section>
        </>
        )}

        {/* Where TideCloak fits */}
        <details className="tv-section tv-fit">
          <summary>Where TideCloak fits</summary>
          <p className="tv-hint">Every simulated piece in this demo and the real TideCloak piece it stands for.</p>
          <div className="tv-table-wrap">
            <table className="tv-table">
              <thead>
                <tr><th>Simulated here</th><th>Real TideCloak piece</th><th>Tide mode</th></tr>
              </thead>
              <tbody>
                {FIT_ROWS.map((r) => (
                  <tr key={r.simulated}>
                    <td>{r.simulated}</td>
                    <td>{r.real}</td>
                    <td>{r.tideMode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </main>
      {toast && <div className={`tv-toast tv-toast-${toast.kind}`}>{toast.text}</div>}
    </div>
  )
}
