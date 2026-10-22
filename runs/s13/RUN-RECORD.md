# RUN-RECORD — main-1 / s13 (AC-17 verification, plus AC-1/AC-2/AC-14 regressions)

## Change vs baseline

Baseline: S1-S12. Under test: S13 (simulated TideCloak sign-in, roles, server-side access checks), repo HEAD `ec85022f6665673102ce92416f7feaf675fa972c` (builder commits af1cc42, eca53e1, d10dbc3, ec85022). Handoff SPEC v6; `handoff/MANIFEST.sha256` sha256 = `5262ecfee42164819c8ade1813a6f151bbb4da6f05c8e3d1a871e0e804a9ec50` (verified, matches). No production code was modified by the evaluator.

## Command

1. `cd impl/core && npm test` ; `npm run typecheck`
2. `cd impl/app && npm run build` (log: `app-build.log`)
3. `cd impl/app && npx --no-install next start -p 3100` (log: `server.log`), then `node impl/runs/s13/qa-smoke.mjs 3100` (output: `smoke-output.txt`). Server stopped afterwards; port 3100 verified free (netstat shows 0 entries).

## Environment

Windows 11 (10.0.26200), Node v22.23.2, Next.js 16.4.2 (webpack), vitest 3.2.7. Seed: none (no randomness in the checks; sim secret is a per-process random value, TV_SIM_SECRET unset). No TideCloak running. Network: none used (offline commands only).

## Results

Evaluation split: not applicable (deterministic acceptance checks, no train/test split).

| Check | Result | Measured |
|---|---|---|
| AC-1 `npm test` (core) | PASS | exit 0; 13 test files passed (13), 424 tests passed (424); simAuth.test.ts 35 tests |
| AC-2 `npm run typecheck` (core) | PASS | exit 0 (`tsc --noEmit`, no output) |
| AC-14 `npm run build` (app, webpack) | PASS | BUILD_EXIT=0; "Compiled successfully in 4.8s" |
| AC-14 GET /truthvoice on `next start` | PASS | 200 (note: production server, not `npm run dev`; dev not run) |
| AC-17 anon, 12 demo routes (rows, courses, leases, audit, probe GET; tamper-demo, clock/advance, feedback, leases, leases/approve, leases/reject, summarise POST) | PASS | 12 of 12 -> 401 |
| student-demo submit feedback | PASS | 200; ciphertext `tide-mock:v1:...`, rowId row-16; GET rows body (3474 chars) does not contain the submitted plaintext |
| lecturer-demo submit feedback | PASS | 403 "requires realm role student and _tide_encryptor" |
| lecturer-demo requests lease DEMO1001 | PASS | 200, lease-1, PENDING, approvals [] |
| student-rep approves with body approverId "qa-officer" | PASS | 200; approvals ["student-rep"], PENDING (qa-officer not recorded) |
| dean approves | PASS | 200; approvals ["student-rep","dean"], status ACTIVE |
| it-admin summarise | PASS | 403 "requires realm role ai-operator and _tide_decryptor" |
| ai-summariser-01 summarise | PASS | 200 ok:true, "SUMMARY: DEMO1001 - 6 comments; themes: ...", comments 6 |
| clock advance 16 min (as ai-summariser-01) | PASS | 200, offsetMs 960000 |
| summarise after +16 min | PASS | 200 `{"ok":false,"reason":"NO_ACTIVE_LEASE"}` (this is the BLOCKED result per SPEC) |
| token with edited payload (preferred_username->dean, roles->approver, signature kept) | PASS | 401 on GET rows and on POST leases/approve |
| tide/** routes without session: GET state, rows, policies, leases, admin-policy; POST whoami, summary, leases/approve | PASS | 8 of 8 -> 401 |

Final smoke run: 35 checks, 0 failed (`smoke-output.txt`, exit 0).

Note on a first smoke run (`smoke-output-run1-assertion-errors.txt`, 32 checks, 3 failed): all three failures were mistakes in my own script, not product defects. (a) I asserted the literal string "BLOCKED" in the summarise body, but the API returns `{ok:false, reason:"NO_ACTIVE_LEASE"}` as SPEC defines; (b) and (c) I used GET on `tide/whoami` and `tide/summary`, which are POST-only (405). I corrected the script, restarted the server for fresh state and reran; the product behaviour was identical. Test user flows used a Bearer token from `/api/tv/sim/login`.

Not measured (UNKNOWN): `npm run dev` serving /truthvoice; UI behaviour in a browser; cookie-based session path (smoke used Bearer tokens only); AC-3..AC-13, AC-15, AC-16 and the mutation suite.

## Cost

Runtime: roughly 3 s for core tests, 5 s webpack compile, smoke < 5 s. Peak memory: UNKNOWN. Quota: none.

## Decision

AC-17: PASS. AC-1, AC-2, AC-14 (build + /truthvoice 200 + API flow): PASS. No defects found in S13.

Artifacts: `app-build.log`, `server.log`, `qa-smoke.mjs`, `smoke-output.txt`, `smoke-output-run1-assertion-errors.txt`.
