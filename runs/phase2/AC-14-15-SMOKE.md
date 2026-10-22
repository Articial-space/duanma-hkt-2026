# AC-14 regression + AC-15 401 checks (orchestrator, 2026-10-22 ~15:05 UTC+7, HEAD after 8f786b0)

Fresh `npm run dev` (webpack), `tidecloak.json` = `{}` (demo mode).

AC-14 regression: `/truthvoice` 200; feedback DEMO2002 → ciphertext row; summarise without lease → NO_ACTIVE_LEASE; request + approve student-rep + dean → `SUMMARY: DEMO2002 — 6 comments; themes: labs (2), pace (2), feedback (1)`. PASS.

AC-15 Tide-mode routes with no token: GET state, POST whoami, GET rows, GET leases, POST leases/approve, GET policies, GET admin-policy, POST summary → all 401; forged `Authorization: Bearer abc.def.ghi` + `DPoP: x.y.z` → 401. PASS.
