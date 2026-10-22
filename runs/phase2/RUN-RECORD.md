# RUN-RECORD — main-1 / phase2 (core S1–S12 + app build, mutants M4–M7)

Evaluator: task-evaluator (source-blind). Evaluation split: none (deterministic unit tests, scripted demo, production build; no dataset). No file under `impl/core`, `impl/app` (src, tests, config, `tidecloak.json`) was edited. All writes are under `impl/runs/phase2/`.

## Change vs baseline

Baseline: none. Mutant runs apply exactly one edit to a private copy of `core/src` (see Mutants). Compared with phase 1 (HEAD 40bcd01, 9 test files / 262 tests) the suite now has 12 files / 385 tests (adds service, policyStore, mode; agent 14→31, probe 14→17, fixtures 19→20).

## Inputs

- Handoff v5: `python tools/make_manifest.py verify challenges/main-1/handoff` printed `OK`, exit 0; `sha256sum handoff/MANIFEST.sha256` = `0f7eadb9043c443515f23b72a0840762f2d19dcf22e5829a7bdaaf5d159de536` (matches the orchestrator's value).
- Code under test: git HEAD `8f786b01441162d1c270e4b80b75b945ba852599` (working tree had unrelated uncommitted changes outside core/src and app/app per initial git status; not inspected).

## Environment

- Windows 11 10.0.26200, Git Bash, node v22.23.2, npm 11.21.0 (`env.txt`).
- core: vitest 3.2.7, typescript 5.8.3, tsx 4.23.15. app: next 16.4.2 (webpack), react 19.3.1, typescript 5.8.3, @tidecloak/nextjs 0.14.40, @tidecloak/js 0.14.41 (read from node_modules package.json).
- Offline; no installs; no network commands. The live TideCloak container was not touched. Seed: none (fixed fixtures; gateway IVs from `randomBytes`, no result depended on them).
- `app/tidecloak.json` content was `{}`; sha256 identical before and after the build (`tidecloak-json-sha-before.txt`, `tidecloak-json-sha-after.txt`).

## Commands and results (baseline)

| Where | Command | Exit | Result | File |
|---|---|---|---|---|
| impl/core | `npm test` (vitest run) | 0 | 12 files passed, 385 tests passed, 0 failed, 0 skipped; vitest duration 2.78 s | `npm-test.txt` |
| impl/core | `npm run typecheck` (tsc --noEmit) | 0 | no diagnostics | `typecheck.txt` |
| impl/core | `npm run demo` (tsx src/demo.ts) | 0 | steps [1]–[6] printed | `demo.txt` |
| impl/app | `npm run build` (next build --webpack) | 0 | compiled successfully; 27 routes (incl. `/truthvoice`, `/api/tv/*`, `/api/tv/tide/*`, `/tide_dpop/[...path]`) + proxy middleware; no lines matching warn/error; wall 39 s | `app-build.txt` |

Exit codes collected in `exit-codes.txt`.

Per-file test counts: mode 23, threshold 24, policyStore 21, policy 50, audit 30, fixtures 20, probe 17, lease 58, gateway 44, agent 31, service 58, demo 9.
Skip/only check: Grep of `core/tests` for `.skip(`, `.only(`, `.todo(`, `xit(`, `xdescribe(` found no matches.
Build log note: three lines "useTideCloakContext called outside TideCloakContextProvider - returning defaults" during static generation (informational from the Tide library; exit 0).

### AC-3 demo check (`demo.txt`)

- Steps [1]–[6] present; exit 0: PASS.
- Step 2: summariser BLOCKED (NO_ACTIVE_LEASE); probe matrix 6 rows, no READ: PASS.
- Step 3: 1 of 2 approvals, gateway refuses "quorum not reached", summariser BLOCKED: PASS.
- Step 4: "SUMMARY: DEMO1001 — 5 comments; themes: assessment (3), materials (1)" for fb-001; fb-002 BLOCKED (NO_ACTIVE_LEASE); matrix has exactly one READ row, "AI summariser with lease": PASS.
- Step 5: +16 min, lease EXPIRED, BLOCKED; matrix has no READ row: PASS.
- Step 6: "audit log: 12 entries, verify: ok" then "verify reports broken at seq 1": PASS.

Observation: the probe matrix now has 6 rows (adds "AI summariser, lease on another course"); AC-3 constrains only READ rows, so this is not a failure.

## Mutants (AC-10 style)

Directory: `runs/phase2/mutants/` (kept separate from phase-1 `runs/mutants/` so the phase-1 control record is not overwritten). Script `mutants/run-mutant.sh` (same method as phase 1): copy `core/src`, `core/tests`, `package.json`, `tsconfig.json`, `vitest.config.ts` into `mutants/<name>/`, junction `node_modules` → `core/node_modules` with `MSYS2_ARG_CONV_EXCL="*" cmd /c mklink /J`, apply one exact-match edit (Python, line endings preserved, asserts exactly one match), run `node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=results.json`. Each mutant dir keeps `mutation.diff` (vs core/src, CR-insensitive), `results.json`, `vitest-output.txt`, `exit-code.txt`, `edit-exit.txt`, `_mklink.txt`. Analysis output: `mutants/analysis.txt`.

Support for `tests/mode.test.ts`: it imports `../../app/app/lib/mode.js`, which does not resolve from a copied tests dir. A byte-identical copy of `app/app/lib/mode.ts` (no imports; sha256 `2f7c12e2…b78b5b`, `mutants/mode-ts-copy.sha256`) was placed at `runs/phase2/mutants/app/app/lib/mode.ts` for the runs and deleted afterwards.

Cleanup (`mutants/cleanup.sh`): all six junctions removed with `cmd /c rmdir` (exit 0 each); copied src/tests/config and the mode.ts stand-in deleted; `core/node_modules` intact afterwards (45 entries, `vitest/vitest.mjs` present).

Discarded attempt: the first pass used `cmd //c mklink` as instructed; with `MSYS2_ARG_CONV_EXCL=*` the `//c` reaches cmd verbatim, cmd opened an interactive shell, no junction was created, and every run (control included) exited 1 with MODULE_NOT_FOUND for vitest.mjs. The script was changed to `cmd /c` (as phase 1) plus a guard that refuses to `rm -rf` a dir that still has `node_modules`; only the rerun is recorded.

| Mutant | Single edit | Exit | Failing tests (of 385) | Failing files | Sample failing test | Error type | Detected |
|---|---|---|---|---|---|---|---|
| control | none (empty diff) | 0 | 0 | none | n/a | n/a | n/a (385/385 pass) |
| M4-service-lease-status | `runSummariser`: replace `currentToken()` (ACTIVE-status gate) + `if (!token) return blocked()` with signing the latest lease regardless of status (`signLease(...).catch(() => undefined)`) and decrypting with whatever token results | 0 | 0 | none | n/a | n/a | **NO (survived)** |
| M4b-service-fail-open | `runSummariser`: missing token no longer blocks; `NotAuthorizedError` on decrypt skips the row (`continue`) instead of `return blocked()` | 1 | 7 | service 7 | "S10 runSummariser BLOCKED before quorum (1 of 2 approvals)" | AssertionError 7 | yes |
| M5-service-approver-check | `approve`: `assertApprover(input.approverId)` removed (reject unchanged) | 1 | 2 | service 2 | "refuses a non-approver (university IT admin) with LeaseError and leaves the lease unchanged" | AssertionError 2 ("expected undefined to be an instance of LeaseError") | yes |
| M6-policystore-expiry | `getFor`: `expiresAt` check removed | 1 | 8 | policyStore 8 | "getFor returns null exactly at expiresAt (now === expiresAt)" | AssertionError 8 ("expected {...} to be null") | yes |
| M7-summarize-leak | `mockSummarize`: append `; e.g. <first comment text>` to the summary | 1 | 22 | agent 17, service 4, demo 1 | agent "never contains 4 or more consecutive words of any comment"; service "never returns or logs plaintext comments"; demo "comment line leaked" | AssertionError 22 | yes |

Import/collection errors: none. For every run, `results.json` has no file whose status is failed without a failed named test (checked by script); every failure is an `AssertionError` attached to a named test.

### M4 survival analysis

- Why it survives: every service test uses the real `MockTideGateway` (through a spy), and `signLease` independently refuses REJECTED/REVOKED, expired (`now >= expiresAt`) and below-quorum requests. For every test scenario the gateway refusal reproduces the service's own BLOCKED decision; the "no lease" test only asserts no decrypt *with a token*, and M4's decrypts are tokenless and refused.
- Not an equivalent mutant: `mutants/M4-service-lease-status/m4probe.mjs` (output `m4probe-output.txt`) builds the service with 3 approvers (threshold 2) over a gateway that recognises only `student-rep` (threshold 1), with one approval. Original core: lease PENDING, `{"ok":false,"reason":"NO_ACTIVE_LEASE"}`. M4 copy: lease PENDING, `{"ok":true,"summary":"SUMMARY: DEMO1001 — 1 comments; themes: assessment (1)","comments":1}`. So the service's own status gate is untested whenever the gateway's quorum is weaker than the service's (configuration mismatch).
- Suggested test (for the implementer, not applied): a gateway configured with fewer approvers (or a stub that always signs) plus a PENDING/EXPIRED/REJECTED lease must still give BLOCKED with no decrypt calls.

## AC status (this run)

| AC | Status | Basis |
|---|---|---|
| AC-1 | PASS | `npm test` exit 0, 385/385, 12 files; S1–S9 modules each have a test file (threshold, policy, fixtures, lease, audit, agent, gateway, probe, demo); no skip/only/todo |
| AC-2 | PASS | `tsc --noEmit` exit 0 |
| AC-3 | PASS | demo check above |
| AC-4–AC-9, AC-12 | PASS (by tests) | respective test files pass; not re-audited line by line this phase (phase-1 audit stands) |
| AC-10 | PASS with gap | phase-1 M1–M3 detected; phase-2 M4b, M5, M6, M7 detected with AssertionErrors; control passes; **M4 survived** (test gap above) |
| AC-11 | PASS | Grep of `core/src` for `fetch(`, `node:http(s)`, `http(s)` imports, `XMLHttpRequest`, `WebSocket`, `node:net`: no matches |
| AC-13 | PASS (by tests) | `service.test.ts` 58/58; sensitive to M4b, M5, M7 |
| AC-14 | PARTIAL: build PASS; rest NOT RUN here | `npm run build` exit 0 (webpack). `npm run dev` serving `/truthvoice` 200 and the API smoke were not run by me (orchestrator; see `runs/phase2a/AC-14-SMOKE.md`, not verified by me) |
| AC-15 | PARTIAL | `mode.test.ts` (isTideConfigured) 23/23 and `policyStore.test.ts` 21/21 pass; build with `{}` exit 0. Build with a sample realm config: NOT RUN (would require changing `tidecloak.json`, which I was told not to touch) → UNKNOWN. 401-without-token+DPoP checks: NOT RUN (orchestrator) |
| AC-16 | NOT RUN | live Tide, manual; orchestrator (`runs/tide/`) |

## Gaps

- Offline-uncovered and left to the orchestrator: AC-14 dev server / HTTP smoke, AC-15 401 checks on Tide-mode routes and build with a sample realm config, AC-16 live Tide.
- M4 survived: the service's ACTIVE-status gate in `runSummariser` is not independently tested (only masked by the gateway's checks). Not a production defect under matching approver config; it is a test gap.
- M7 shows the 4-word-leak guard is covered at agent, service and demo level; M6 only by `policyStore.test.ts` (app-level consumers of `getFor` not exercised offline).
- Mutation coverage of other modules (audit, policy, probe, app routes) this phase: UNKNOWN.
- Pre-existing untracked `runs/app-build.log` and `runs/app-dev.log` are not from this run and were not committed by me.

## Cost

`npm test` vitest duration 2.78 s; app build wall 39 s; each mutant run a few seconds (not individually timed: UNKNOWN). Peak memory: UNKNOWN. Quota: UNKNOWN.

## Decision

Phase-2 offline checks pass: AC-1 to AC-13 pass, with one AC-10 gap (M4 survives, test gap). For AC-14 and AC-15 the build and unit-test parts pass; the HTTP/401/realm-config parts and AC-16 are for the orchestrator. No src defects found.
