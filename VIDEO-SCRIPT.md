# TruthVoice — 2-minute demo video script (demo mode)

Screen recording of http://localhost:3000/truthvoice in **demo mode** (badge: "Demo mode — Tide network simulated"). Target length 1:55 at most. Section numbers match the headings on the page.

| Time | What to click on screen | Voice-over |
|---|---|---|
| 0:00–0:10 | Page top: the "TruthVoice" header and the badge "Demo mode — Tide network simulated". | "Course surveys say they're anonymous. But whoever runs the system can read every comment, so students hold back." |
| 0:10–0:22 | **2. Student**: course "DEMO1001", paste: *The marking rubric for assignment 2 was never explained before the exam*. Click **"Submit encrypted feedback"** (toast: "Encrypted and stored as row-16"). | "TruthVoice changes that. A student writes honest feedback. It's encrypted on submit, and no student ID is stored." |
| 0:22–0:32 | Scroll to **3. University database (IT admin view)**. Point at the ciphertext column of the newest row. | "This is all the IT admin, the database and the server can see: ciphertext. No sentences, no names." |
| 0:32–0:46 | **4. Lecturer**: course "DEMO1001", click **"Request AI summary"**. Scroll to **6. AI summariser**, click **"Run summariser"** → red "BLOCKED — no active lease". | "The lecturer asks for an AI summary. The AI tries to read the feedback, and it's blocked. There's no lease yet." |
| 0:46–0:56 | **5. Approvals**: click **"Approve as Student rep"** (status PENDING, "1 of 2"). Click **"Run summariser"** again → still BLOCKED. | "The student rep approves. One approval isn't enough. Still blocked." |
| 0:56–1:10 | Click **"Approve as Dean"** (status ACTIVE, "2 of 2", remaining time counting down from about 15:00). Click **"Run summariser"** → green "READ — SUMMARY: DEMO1001 — 6 comments; themes: assessment (4), materials (1)". | "The dean approves. Two of three: a fifteen-minute lease opens for this course only. The AI returns themes and counts, never a sentence." |
| 1:10–1:22 | Scroll to **7. Who can read this feedback right now?** Only "AI summariser with lease" is green READ; IT admin, Lecturer, forged lease, no lease and another course are red BLOCKED. | "Who can read this right now? Only the AI, only this course. The IT admin, the lecturer, even a forged lease: blocked. Every row is a real decrypt attempt." |
| 1:22–1:32 | **9. Demo clock**: click **"Fast-forward 16 minutes"**. Click **"Run summariser"** → BLOCKED. Matrix is all red. | "Sixteen minutes later the lease has expired. The AI is locked out again, automatically." |
| 1:32–1:42 | **8. Audit trail**: click **"Verify"** → "CHAIN OK". Click **"Tamper test"** → "BROKEN AT SEQ 1". | "Every step is in a hash-chained audit log. Change one entry and the chain breaks, so tampering is caught." |
| 1:42–1:55 | Scroll back to the top; hold on the header and badge. | "Here the Tide network is simulated. With TideCloak, the keys never sit on our server, so no IT admin, lecturer or AI can widen access alone. In Tide mode, the Tide network itself is designed to enforce the lease: who, which course, until when." |

The numbers in the green summary assume a fresh seed plus the one comment above. If they differ, read the screen and don't re-shoot.

## Recording checklist

1. Restart `npm run dev` just before recording, for a fresh seed: 15 comments, no leases, clean audit, demo clock at 0.
2. Set the browser window to 1280×720 at 100% zoom; hide bookmarks, extensions and notifications.
3. Check that the badge reads "Demo mode — Tide network simulated" (`app/tidecloak.json` is `{}`).
4. Keep the student comment ready to paste; don't type it live.
5. The page refreshes every 3 s and toasts vanish after 4 s, so pause on each result before scrolling.
6. Do one dry run, then restart the server again before the real take; trim the final cut to 1:55 or less.

## Optional 15-second Tide-mode insert

Only if a live "Sign in with Tide" works on the recording machine (app restarted with a real `tidecloak.json`). To stay within 1:55, shorten the audit row to 1:32–1:40 and use this insert in place of the closing row.

| Time | What to click on screen | Voice-over |
|---|---|---|
| 1:40–1:55 | Tide-mode page: badge "Tide mode — live TideCloak (DPoP)". Click **"Sign in with Tide"**, finish the Tide login, show the signed-in username. Pan to the Approvals line "2-of-3 approvals: enforced by this app. Subject, course and expiry: enforced by the Tide network." | "The same app on live TideCloak. Students sign in with Tide, comments are encrypted in their browser, and the lease is a policy the Tide network checks, not our server." |
