# TruthVoice

## Project overview

**TruthVoice lets students give honest course feedback that no university admin, lecturer or AI can read at will. An AI may summarise one course's feedback only under a short lease that two of three independent approvers grant.**

### Vision & originality
Course surveys promise anonymity, yet whoever runs the system can read every comment. TruthVoice keeps raw feedback sealed; an AI reads it only through a quorum-granted, expiring, per-course lease. Lecturers receive themes, never identifying sentences.

### Trust constraint insight
Students self-censor because IT admins, developers and database owners can read and correlate comments. Universities therefore either keep feedback away from AI or quietly expose it. Remove the "trust the operator" step and honest feedback can be analysed safely.

### Value & impact
Students can report unfair marking without fear; lecturers get actionable themes after grades are published; quality teams get a tamper-evident audit trail. Example: DEMO1001's summary shows "assessment" as the top concern without revealing who said it.

### Why TideCloak matters
In Tide mode, comments are encrypted in the student's browser and keys stay in Tide's decentralised network; our server never decrypts. The app enforces the 2-of-3 approvals. A realm admin then signs the lease as a RelationshipAttestation:1 policy, and the Tide network is designed to enforce its subject (the AI operator's account), course and expiry. Demo mode simulates sign-in, roles and access checks, per the organisers' instruction. Limits: Tide checks the account, not the AI code behind it; live network checks are not yet recorded.

### Prototype & storytelling
Watch the "Who can read this feedback right now?" table: IT admin, lecturer and the AI are blocked; one approval keeps them blocked; a second opens one course to the AI only; after expiry everything is blocked again, and a tampered audit entry is caught.

## Setup

You need Node 22+ and npm. Tide mode also needs Docker and a bash shell (Git Bash on Windows) with `curl` and `jq`. All feedback data is synthetic.

### 1. Offline engine (no Docker, no TideCloak)

```bash
cd core
npm ci
npm test        # unit tests
npm run demo    # the whole story in the console, steps [1]-[6]
```

### 2. Demo-mode web app (Tide network simulated)

```bash
cd app
npm ci
npm run dev
```

Open http://localhost:3000/truthvoice. The badge reads **"Demo mode — Tide network simulated"**. Per the organisers' instruction, sign-in, roles and access checks are simulated too: pick an account in the "Sign in (simulated TideCloak)" panel (Student, Lecturer, Student representative, Dean, QA officer, University IT admin, AI summariser). The server checks the signed token and the role on every request; the page only mirrors that result. The "Where TideCloak fits" panel (and `TIDECLOAK-FIT.md`) maps each simulated piece to the real TideCloak piece. Set `TV_SIM_SECRET` to keep sessions across restarts. The app stays in demo mode while `app/tidecloak.json` is the placeholder `{}`. All state is in memory and is seeded with 3 courses and 15 synthetic comments. Restart the dev server to reset it.

### 3. Tide mode (live TideCloak)

Tide mode is built and designed to run as below. The live lease checks are not yet recorded.

1. **Admin credentials in an env file**, outside the repo and never on the command line, e.g. `~/tidecloak.env`:
   ```
   KC_BOOTSTRAP_ADMIN_USERNAME=admin
   KC_BOOTSTRAP_ADMIN_PASSWORD=<a strong password>
   ```
2. **Start TideCloak, pinned to 0.14.40.** Do not use `latest` or 0.14.41, which fails free-tier licence activation (see `runs/tide/LICENCE-DIAGNOSIS.md`).
   ```bash
   docker run -d --name tidecloak -p 8080:8080 --env-file ~/tidecloak.env tideorg/tidecloak-dev:0.14.40
   ```
3. **Create the realm.** First read https://tide.org/legal and continue only if you agree to Tide's terms. Then, from `app/`:
   ```bash
   set -a; . ~/tidecloak.env; set +a
   KC_PASSWORD="$KC_BOOTSTRAP_ADMIN_PASSWORD" NEW_REALM_NAME=truthvoice \
     SUBSCRIPTION_EMAIL=<your email> bash init/tcinit.sh
   ```
   If a run fails halfway, start again with a fresh container: re-running on a half-built realm fails.
4. **Enrol the admin.** The script prints an invite link and waits. Open it in a clean Chrome profile and allow local-network access when asked (Comet and extension-heavy browsers fail). Click **"Link Account"**, then create a Tide account. The script then writes `app/tidecloak.json`, which switches the app to Tide mode. Do not commit that file.
5. **Add the other accounts** in the TideCloak admin console (http://localhost:8080/admin, realm `truthvoice`; self-registration is off). IGA is on, so approve the resulting change requests there. Enrol each account through its own invite link, as in step 4. Sign in again after any role change.

   | Account | Role | What it does |
   |---|---|---|
   | `admin` (made by `tcinit.sh`) | `tide-realm-admin` | Grants course write policies; signs the lease in Tide ("Sign lease in Tide"). Allow the Tide enclave pop-up. |
   | a student | realm role `_tide_encryptor` | Submits feedback encrypted in the browser under the course write policy. Without one, it falls back to Tide self-encryption, labelled on screen. |
   | `ai-summariser` (or set `TV_AI_OPERATOR_USERNAME`) | realm role `_tide_decryptor` | Signs in once so its key is recorded; runs the summariser in its own browser and posts only the summary. |
   | a lecturer | none extra | Requests the AI summary; cannot approve their own request. |

   The "Approve as Student rep / Dean / QA officer" buttons can be pressed by any signed-in account except the requester and the AI operator. That 2-of-3 rule is enforced by the app, not by Tide.
6. **Run it.** Restart `npm run dev` and open http://localhost:3000/truthvoice. The badge reads **"Tide mode — live TideCloak (DPoP)"**. Flow: the admin clicks "Grant course write — DEMO1001"; the student submits; the lecturer clicks "Request AI summary"; two approvals; the admin clicks "Sign lease in Tide"; `ai-summariser` clicks "Run summariser". After the 15-minute expiry, section 8 "Network checks" retries with the old lease policy, which the Tide network is designed to refuse.

To go back to demo mode, run `git checkout app/tidecloak.json` (back to `{}`) and restart the dev server.

## Project structure

```
core/                  TypeScript engine, runs offline (vitest)
  src/                 threshold, policy, lease, gateway (mock Tide), agent (mock AI),
                       audit, probe, service, policyStore, simAuth (simulated TideCloak),
                       fixtures, demo
  tests/               unit tests, one file per module
app/                   Next.js 16, from the official TideCloak template
  app/truthvoice/      the page: DemoTruthVoice.tsx (demo) or TideTruthVoice.tsx (Tide)
  app/api/tv/          demo-mode API: in-memory service + mock Tide gateway, every route
                       behind the simulated sign-in (401 signed out, 403 wrong role)
  app/api/tv/sim/      simulated TideCloak: login, logout, whoami, users
  app/api/tv/tide/     Tide-mode API: checks token + DPoP proof (401 otherwise); stores
                       ciphertext, signed policies and summaries only
  app/lib/             mode detection, Tide auth, Tide-mode server state
  lib/tide/            vendored RelationshipAttestation:1 helper (unmodified)
  init/                tcinit.sh and realm.json
runs/                  recorded runs: tests, mutants, app smoke test, licence diagnosis
```

## Tests

| What | How | Result |
|---|---|---|
| Engine unit tests | `cd core && npm test` | 13 files, 424 tests pass (2026-10-22), including `simAuth.test.ts` for the simulated sign-in; `npm run typecheck` clean |
| Scripted story | `cd core && npm run demo` | steps [1]-[6]: blocked → 1 approval still blocked → 2 approvals: themes only, other course blocked → expired: blocked → tamper caught |
| Do the tests catch bugs? | `runs/mutants/` | 3 planted bugs (threshold rounding, skipped lease-signature check, self-approval) each make the suite fail; the unmodified copy passes |
| Demo-mode app | `runs/phase2a/AC-14-SMOKE.md` | API smoke: ciphertext only in rows; 1 approval blocked; 2 approvals → summary; +16 min → blocked; tamper caught |
| Tide mode | `core/tests/mode.test.ts`, `policyStore.test.ts` | Unit-tested. The live checks (lease signs; expired lease refused by the network; another user refused) are designed but not yet recorded. |
