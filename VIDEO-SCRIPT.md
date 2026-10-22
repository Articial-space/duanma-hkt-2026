# TruthVoice — 2-minute demo video script (demo mode, simulated TideCloak sign-in)

Screen recording of http://localhost:3000/truthvoice in **demo mode** (badge: "Demo mode — Tide network simulated"). Target length 1:55 at most. Section numbers match the headings on the page.

Each step is played by a different simulated account. Switch accounts by clicking its card in **"Sign in (simulated TideCloak)"** at the top of the page (cards: **Student**, **Lecturer**, **Student representative**, **Dean**, **QA officer**, **University IT admin**, **AI summariser (operator account)**). The "Signed in as ..." line and role chips update at once, so keep the sign-in panel in view for a beat after each switch. Sign-in, roles and access checks are simulated per the organisers' instruction while the Tide network is unavailable; the server still re-checks the role on every request (401 if not signed in, 403 "Requires role ..." if the role is missing).

| Time | What to click on screen | Voice-over |
|---|---|---|
| 0:00–0:07 | Page top: the "TruthVoice" header, the badge "Demo mode — Tide network simulated" and the small note under it (sign-in, roles and access checks are simulated). | "Course surveys say they're anonymous. But whoever runs the system can read every comment, so students hold back." |
| 0:07–0:16 | Click the **Student** account card. In **2. Student**: course "DEMO1001", paste: *The marking rubric for assignment 2 was never explained before the exam*. Click **"Submit encrypted feedback"** (toast: "Encrypted and stored as row-16"). | "Signed in as the student, I write honest feedback. It's encrypted on submit, and no student ID is stored." |
| 0:16–0:24 | Click the **University IT admin** card. Scroll to **3. University database (IT admin view)**. Point at the ciphertext column of the newest row. | "Now the university IT admin. The database holds ciphertext only. No sentences, no names." |
| 0:24–0:28 | **Short shot, 3–5 s:** scroll to **6. AI summariser**. Hold on the red line "Needs realm roles: ai-operator + _tide_decryptor — Requires role ai-operator + _tide_decryptor" and the greyed-out **"Run summariser"** button. | "The IT admin is refused the summariser: wrong role." |
| 0:28–0:36 | Click the **Lecturer** account card. In **4. Lecturer**: course "DEMO1001", click **"Request AI summary"** (a PENDING lease appears in **5. Approvals**). | "The lecturer asks for an AI summary. That opens a lease request, and nothing is readable yet." |
| 0:36–0:45 | Click the **Student representative** card. In **5. Approvals**, click **"Approve as Student representative"** (status PENDING, "1 of 2"). Click the **AI summariser (operator account)** card, then **"Run summariser"** → red "BLOCKED — no active lease". | "The student representative approves. One approval isn't enough: the AI account is still blocked." |
| 0:45–0:56 | Click the **Dean** card, then **"Approve as Dean"** (status ACTIVE, "2 of 2", remaining time counting down from about 15:00). Click the **AI summariser (operator account)** card, then **"Run summariser"** → green "READ — SUMMARY: DEMO1001 — 6 comments; themes: assessment (4), materials (1)". | "The dean approves. Two of three: a fifteen-minute lease opens for this course only. Now the AI returns themes and counts, never a sentence." |
| 0:56–1:06 | Scroll to **7. Who can read this feedback right now?** Only "AI summariser with lease" is green READ; IT admin, Lecturer, forged lease, no lease and another course are red BLOCKED. | "Who can read this right now? Only the AI, only this course. The IT admin, the lecturer, even a forged lease: blocked." |
| 1:06–1:14 | **9. Demo clock**: click **"Fast-forward 16 minutes"**. Click **"Run summariser"** (still signed in as the AI account) → BLOCKED. Matrix is all red. | "Sixteen minutes later the lease has expired. The AI is locked out again, automatically." |
| 1:14–1:22 | **8. Audit trail**: click **"Verify"** → "CHAIN OK". Click **"Tamper test"** → "BROKEN AT SEQ 1". | "Every step is in a hash-chained audit log. Change one entry and the chain breaks." |
| 1:22–1:40 | Scroll to the bottom and open the collapsible **"Where TideCloak fits"**. Slowly pan the table: "Simulated here" / "Real TideCloak piece" / "Tide mode". | "One honest note: sign-in, roles and access checks here are simulated, as the organisers instructed, because the Tide network is unavailable. This panel maps each simulated piece to the real TideCloak piece." |
| 1:40–1:55 | Stay on the "Where TideCloak fits" table, then scroll back to the top; hold on the header and badge. | "Tide mode is built for live TideCloak: real sign-in, and the lease enforced by the Tide network, so no admin, lecturer or AI can widen access alone." |

The numbers in the green summary assume a fresh seed plus the one comment above. If they differ, read the screen and don't re-shoot.

## Recording checklist

1. Restart `npm run dev` just before recording, for a fresh seed: 15 comments, no leases, clean audit, demo clock at 0.
2. Set the browser window to 1280×720 at 100% zoom; hide bookmarks, extensions and notifications.
3. Check that the page opens with no account signed in ("Sign in to continue."; clear cookies if not), and that the badge reads "Demo mode — Tide network simulated" (`app/tidecloak.json` is `{}`).
4. Keep the student comment ready to paste; don't type it live. Rehearse the account switches so each card click lands in under a second.
5. The page refreshes every 3 s and toasts vanish after 4 s, so pause on each result before scrolling.
6. Do one dry run, then restart the server again before the real take; trim the final cut to 1:55 or less.

## Optional 15-second Tide-mode insert

Only if a live "Sign in with Tide" works on the recording machine (app restarted with a real `tidecloak.json`). The insert takes the place of the closing row (1:40–1:55), so the total stays within 1:55.

| Time | What to click on screen | Voice-over |
|---|---|---|
| 1:40–1:55 | Tide-mode page: badge "Tide mode — live TideCloak (DPoP)". Click **"Sign in with Tide"**, finish the Tide login, show the signed-in username. Pan to the Approvals line "2-of-3 approvals: enforced by this app. Subject, course and expiry: enforced by the Tide network." | "The same app on live TideCloak. Students sign in with Tide, comments are encrypted in their browser, and the lease is a policy the Tide network checks, not our server." |
