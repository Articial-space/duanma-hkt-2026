# RUN-RECORD — main-1 / phase1 (Leash core)

Evaluator: task-evaluator. Evaluation split: none (deterministic unit tests, scripted demo, no dataset). No src or tests were edited.

## Change vs baseline

None for the baseline run. Mutant runs apply exactly one edit to a private copy of `core/src` (see Mutants).

## Inputs

- Handoff manifest: `python tools/make_manifest.py verify challenges/main-1/handoff` printed `OK`, exit 0 (expected sha256 3a570107280d7b13566b8eda1580c08baf974e60f9fee2427af5851bb005a116 as given by orchestrator; the verify tool does not print the digest, so the digest itself is UNKNOWN beyond the OK).
- Code under test: `challenges/main-1/impl/core`, git HEAD at run time `40bcd013e070fb999f5af026a9b235819c3da634`.

## Environment

- Windows 11 (10.0.26200), Git Bash, node v22.23.2, npm 11.21.0
- vitest 3.2.7, typescript 5.8.3, tsx 4.23.15 (read from node_modules/*/package.json)
- Offline only; no installs. Seed: none (tests use fixed fixtures; the gateway uses `randomBytes` for IVs, and no test result depended on it across runs).

## Commands and results (baseline)

Run from `challenges/main-1/impl/core`. Raw outputs are in this directory.

| Command | Exit | Result | File |
|---|---|---|---|
| `npm test` (vitest run) | 0 | 9 files passed, 262 tests passed, 0 failed, 0 skipped, duration 2.03 s (wall 4.6 s) | `npm-test.txt` |
| `npm run typecheck` (tsc --noEmit) | 0 | no diagnostics | `typecheck.txt` |
| `npm run demo` (tsx src/demo.ts) | 0 | 6 steps printed | `demo.txt` |

Per-file counts: threshold 24, policy 50, fixtures 19, lease 58, audit 30, agent 14, gateway 44, probe 14, demo 9.

Skipped/only check: Grep for `.skip`, `.only`, `.todo`, `xit(`, `xdescribe(` in `tests/` found no matches.

## AC-3 demo check (from `demo.txt`)

- Steps `[1]` to `[6]` all present: PASS.
- Step 2: agent BLOCKED (NO_ACTIVE_LEASE); matrix has 5 rows, all BLOCKED, no READ row: PASS.
- Step 3: gateway refuses to sign, "quorum not reached"; agent BLOCKED: PASS.
- Step 4: summary printed for rec-001; rec-002 BLOCKED (NO_ACTIVE_LEASE); matrix has exactly one READ row, "AI agent with lease": PASS.
- Step 5: lease EXPIRED, agent BLOCKED; matrix has no READ row: PASS.
- Step 6: "audit log: 12 entries, verify: ok" then "entry 1 rewritten ... verify reports broken at seq 1": PASS.
- Exit 0: PASS.

Note: the repo's `tests/demo.test.ts` (9 tests) also asserts these demo properties; all pass.

## Mutants (AC-10)

Procedure: for each mutant, copy `core/src`, `core/tests`, `package.json`, `tsconfig.json`, `vitest.config.ts` into `runs/mutants/<name>/`, junction `node_modules` to `core/node_modules` (`mklink /J`), apply one edit to the copy's src, run `node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=results.json`. Script: `runs/mutants/run-mutant.sh`. Each directory holds `mutation.diff` (diff vs core/src, CR-insensitive), `results.json`, `exit-code.txt`, `vitest-output.txt`. After the runs each junction was removed with `cmd /c rmdir` (rmdir exit 0 for all four; `core/node_modules` intact, 45 entries, vitest.mjs present), and the copied src/tests/config were deleted.

A first attempt failed for all four copies because MSYS rewrote `/J`; the junction was not created and vitest could not be found (exit 1, MODULE_NOT_FOUND). That attempt was discarded and rerun with `MSYS2_ARG_CONV_EXCL=*`; only the rerun is recorded.

| Mutant | Edit | Exit | Failing tests (of 262) | Failing files | Sample failing test | Error type | Detected |
|---|---|---|---|---|---|---|---|
| control | none | 0 | 0 | none | n/a | n/a | n/a (passes, 262/262) |
| M1-threshold | `Math.floor` to `Math.ceil` in `threshold.ts` | 1 | 75 | agent 7, demo 6, fixtures 1, gateway 24, lease 20, probe 10, threshold 7 | `threshold.test.ts` (7 failing) | see below | yes |
| M2-gateway-sig | `decryptRecord` (in `assertToken`) no longer verifies the HMAC signature | 1 | 18 | agent 1, demo 3, gateway 9, probe 5 | gateway: "edited token fields are refused extended expiresAt"; agent: "blocked with a forged token" | AssertionError 9 (agent, demo, probe), vitest `.rejects` matcher failure 9 (gateway; "promise resolved ... instead of rejecting") | yes |
| M3-lease-self-approve | `approve` no longer calls `assertNotRequester` | 1 | 2 | lease 2 | "S3 approve refuses self-approval by the requester" | AssertionError ("expected function to throw an error, but it didn't") 2 | yes |

Error-type breakdown, measured from `results.json`:

- M1: AssertionError 29 (threshold 7, lease 15, demo 6, fixtures 1); NotAuthorizedError "quorum not reached" 38 (setup in agent 7, gateway 21, probe 10 hit the higher threshold before reaching their assertions); LeaseError 6 (lease 5, gateway 1); vitest `.rejects/.resolves` matcher "Error" 2 (gateway). The 7 threshold.test.ts failures are AssertionErrors, so the intended S1 table assertions fail. The 44 non-assertion errors are collateral from the changed threshold (thrown while running test bodies), not import or collection errors.
- M2 and M3: all failures are assertion failures. The gateway "Error: promise resolved ... instead of rejecting" messages come from vitest's `expect(...).rejects` matcher in `@vitest/expect`, a failed assertion, not a runtime fault.
- No mutant produced an import, syntax or collection error: `results.json` has zero file-level failures with an empty assertion list (checked by script); all failures are attached to named tests.

Mutants M2 and M3 copies were rewritten with CRLF line endings by the edit script (Python text mode on Windows); this is a whitespace-only difference with no behavioural effect, and the saved `mutation.diff` files ignore it. The M2 and M3 diffs show the single intended edit.

Limits: M3 is caught only by 2 tests, both in `lease.test.ts`; the gateway's `signLease` separately drops requester approvals, so M3 does not weaken the gateway, which is consistent with the design but means M3 is only detectable at the lease layer.

## AC status

| AC | Status | Basis |
|---|---|---|
| AC-1 | PASS | `npm test` exit 0, 262/262; all nine S1 to S9 modules have a test file; no skip/only/todo found |
| AC-2 | PASS | `tsc --noEmit` exit 0 |
| AC-3 | PASS | see demo check above |
| AC-4 | PASS (by tests) | `threshold.test.ts` 24 tests pass; M1 detected by 7 of them. I did not re-derive the S1 table independently beyond reading `threshold.ts` (`max(1, floor(7n/10))`, giving 1,1,2,2,3,7 for n=1,2,3,4,5,10 by arithmetic) |
| AC-5 | PASS (by tests) | `policy.test.ts` 50 tests pass; individual assertions not audited line by line |
| AC-6 | PASS (by tests) | `lease.test.ts` 58 tests pass; code reading shows `now >= expiresAt` gives EXPIRED and duplicate approvals are a no-op; M3 detected |
| AC-7 | PASS (by tests) | `gateway.test.ts` 44 tests pass; M2 detected by 9 gateway tests covering edited expiresAt, recordId, approvals, agentId, leaseId, blank/fabricated/foreign signatures |
| AC-8 | PASS (by tests) | `audit.test.ts` 30 tests pass; demo step 6 shows broken seq 1 |
| AC-9 | PASS (by tests) | `agent.test.ts` 14 tests pass; `src/agent.ts` shows no approve method (only `decryptRecord` call at line 44 by grep) |
| AC-10 | PASS | 3 mutants, all detected with assertion failures, control passes |
| AC-11 | PASS | Grep of `src` for `fetch`, `http(s)`, `node:net`, `XMLHttp`, `WebSocket` found no matches; the only non-relative imports are `node:crypto` (audit, gateway, policy); fixtures visibly synthetic (e.g. "Testy McFictional"), `fixtures.test.ts` 19 tests pass |
| AC-12 | PASS (by tests and demo) | `probe.test.ts` 14 tests pass; demo matrix shows the five rows in the same order across steps 2, 4, 5; M2 caused 5 probe test failures, showing the rows come from real decrypt attempts |

## Gaps and notes

- No acceptance failures found.
- AC-5, AC-6, AC-8, AC-9, AC-12 were judged from passing tests plus targeted code reading; their test bodies were not audited exhaustively, and only three mutants were run, so mutation coverage of audit, policy and probe modules is UNKNOWN.
- The manifest digest was checked only through the tool's `OK`.
- No defects found in `impl/src`.

## Cost

Baseline wall time about 4.6 s for `npm test`; mutant runs a few seconds each. Peak memory: UNKNOWN. Quota: UNKNOWN.

## Decision

Phase 1 passes ACCEPTANCE AC-1 to AC-12 as measured above.
