# RMIT UNLOCKED Hackathon - Challenge 2 (Tide)

Internal team handbook covering competition guidelines, product strategy, technical architecture, and execution timeline.

---

## 1. General Competition Overview
* **Hackathon:** RMIT UNLOCKED Hackathon - Challenge 2 (Hosted by Tide).
* **Core Question:** What would you build if trust was no longer a bottleneck?
* **Mission:** Build a functional working prototype integrated with TideCloak demonstrating a novel capability where no single admin, server, or AI can arbitrarily bypass data protection policies and user decisions.
* **Submission Deadline:** 18:00 (Thursday, Oct 22, Vietnam Time) / 10:00 AM (Friday, Oct 23, Melbourne Time).

---

## 2. Team Product Vision: TruthVoice RMIT

### Project Name: **TruthVoice - Zero-Knowledge RMIT Course & Lecturer Evaluation Vault**

### Context & The Trust Constraint
* **Status Quo:** At the end of every semester, RMIT students complete Course Experience Surveys (CES). The university always promises that evaluations are "strictly anonymous."
* **The Trust Bottleneck:** Students actively practice self-censorship, withholding honest critiques about ineffective teaching or unfair grading out of fear of academic retaliation. This fear is valid: **University IT administrators, portal developers, and database engineers retain root credentials (`SELECT * FROM evaluations;`)**, making it trivial to correlate submission timestamps, session tokens, or IP addresses back to specific students.
* **The Consequence:** Faculty receive sanitized, performative feedback; academic teaching quality stagnates; students carry the burden of silence.

### The Solution with TideCloak: Zero-Knowledge Self-Encryption
* **Core Paradigm Shift:** Instead of asking students to "blindly trust institutional policy," TruthVoice enforces trust mathematically using decentralized cryptography.
* **How It Works:**
  1. The student authenticates their RMIT student identity via TideCloak.
  2. All feedback, critiques, and ratings are **client-encrypted directly inside the browser** before transit.
  3. Encryption keys are sharded across an Oblivious Routing Key (ORK) network and cryptographically bound to the device via DPoP tokens. No master key exists on any server.
  4. University IT staff and lecturers viewing the database only see unreadable ciphertext. Nobody can decrypt or deanonymize student submissions.

---

## 3. Evaluation Criteria & Weight Distribution

| Criterion | Weight | What Judges Look For |
| :--- | :---: | :--- |
| **Vision & Distinctiveness** | **25%** | Fresh, ambitious approach solving an acute academic integrity problem. |
| **Understanding Trust Constraints** | **20%** | Clear identification of how fear of admin retribution bottlenecks honest feedback. |
| **Value & Impact** | **20%** | Measurable value: students speak without fear; universities obtain genuine quality data. |
| **Why TideCloak Matters** | **20%** | TideCloak fundamentally alters system capability (replacing it with conventional OAuth/JWT would break the zero-trust promise). |
| **Prototype & Storytelling** | **15%** | Working prototype demonstrating clear interactions within a 2-minute video. |

> **Strategic Takeaway:** 65% of the score is determined by concept, problem understanding, and real-world value. Code only needs to prove the narrative flow.

---

## 4. Technical Architecture & 6 Critical Traps to Avoid

### Default Port Configuration
* **TideCloak Engine (Docker):** `http://localhost:8080`
* **Client Web App (Next.js / Vite / React):** `http://localhost:3000`

### 6 Fatal Technical Pitfalls
1. **Missing DPoP Binding:** Ensure the client properly attaches TideCloak DPoP proof-of-possession tokens. Omitting DPoP allows the app to compile but strips out hardware-bound key security without warning.
2. **Docker Setup Trap:** If spinning up Docker TideCloak takes longer than 30 minutes due to local environment issues, immediately switch to the pre-configured TideCloak Quickstart template.
3. **Over-Engineering Scope:** Narrow down the prototype strictly to 1 end-to-end interaction: Student Login -> Submit Encrypted Survey -> Inspect Ciphertext in Admin View.
4. **Permission Propagation Delay:** TideCloak policy and permission updates can take up to 2 minutes to reflect in new tokens. Do not alter permissions live while recording the video demo.
5. **Video Constraints:** Strictly under 2 minutes, `.mp4` format, file size under 100 MB (GitHub file limit), committed directly into repository root.
6. **Public Repository Setting:** Double-check that the GitHub repository visibility is set to **Public** before submitting the URL.

---

## 5. Countdown Tactical Plan

```text
[Phase 1] Finalize TideCloak local environment & minimal submission UI
[Phase 2] Complete the primary flow: Tide Login -> Client-side Encrypt -> Store Ciphertext
[Phase 3] Record & edit the 2-minute demo video (.mp4 < 100MB)
[Phase 4] Verify README.md word count (< 300 words) & push code and video to GitHub
[Phase 5] Confirm Public repo access & submit final link via Google Form
```