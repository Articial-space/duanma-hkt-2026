# AC-14 smoke — demo-mode web app (run by orchestrator, 2026-10-22 ~14:20 UTC+7)

Code: core 9418114, app 89a9e18. `npm run dev` (webpack) in impl/app, fresh process, curl against localhost:3000.

| Step | Result |
|---|---|
| GET /truthvoice | 200 |
| POST feedback DEMO1001 | row-16, `tide-mock:v1:…` ciphertext |
| GET rows | 16 rows, no plaintext (`Smoke`/`Comment` absent) |
| summarise before lease | `{"ok":false,"reason":"NO_ACTIVE_LEASE"}` |
| request lease → approve student-rep → summarise | still NO_ACTIVE_LEASE (1 of 2) |
| approve dean → summarise | `{"ok":true,"summary":"SUMMARY: DEMO1001 — 6 comments; themes: assessment (4), materials (1)","comments":6}` |
| clock/advance 16 → summarise | NO_ACTIVE_LEASE |
| probe after expiry | all 6 rows BLOCKED |
| audit | 23 entries, verify ok; tamper-demo `{"ok":false,"brokenAt":1}` |
| empty comment | 400 `{"error":"comment must be non-empty"}` |
| Browser render | page shows seeded courses and ciphertext table (screenshot check) |

Verdict: AC-14 PASS.
