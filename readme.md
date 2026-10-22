<!-- SUBMISSION FILE FOR RMIT UNLOCKED HACKATHON - CHALLENGE 2 (TIDE) -->
# TruthVoice: Zero-Knowledge RMIT Course & Lecturer Evaluation Vault

> A privacy-preserving course and lecturer evaluation platform for RMIT students where sensitive feedback is client-encrypted via TideCloak, ensuring no university administrator, IT staff, or faculty member can trace or de-anonymize responses.

---

## Overview & Submission Criteria

### 1. Vision and Distinctiveness
TruthVoice transforms university course and lecturer feedback by guaranteeing cryptographic anonymity. Unlike conventional end-of-semester surveys where university servers retain full access to logs, TruthVoice eliminates the need to trust institutional promises, empowering students to submit unfiltered academic critiques with mathematically guaranteed protection from academic retaliation.

### 2. The Trust Constraint
Students routinely self-censor critical feedback regarding unfair grading, outdated pedagogy, or faculty misconduct out of fear of academic retribution. Traditional evaluation portals rely on organizational trust: university IT administrators and Canvas engineers hold root database credentials (`SELECT * FROM evaluations;`), allowing them to correlate submission timestamps, IP addresses, and session IDs back to specific students. Eliminating administrative access unlocks genuine, constructive educational feedback.

### 3. Value and Impact
TruthVoice restores academic integrity and psychological safety for students. For instance, a student reporting biased grading practices by a senior faculty member can submit concrete evidence without jeopardizing graduation references or GPA. Lecturers receive actionable, candid insights to improve teaching methodologies rather than sanitized, polite platitudes.

### 4. Why TideCloak Matters
Traditional authentication (Canvas SSO, OAuth2) verifies student enrolment but leaves stored records exposed to backend database administrators. Replacing TideCloak with standard authentication would leave raw feedback readable by server admins. TideCloak enforces **Self-Encryption** and **Emergent Authority**: cryptographic keys are sharded across an Oblivious Routing Key (ORK) network and DPoP device-bound tokens. No single university admin, cloud provider, or database owner holds the master key to decrypt individual submissions.

### 5. The Prototype and Storytelling
The demo showcases:
1. An RMIT student authenticates via TideCloak and submits a candid lecturer critique.
2. The payload is client-encrypted before transmission.
3. The University Administrator/Database dashboard displays unreadable ciphertext, confirming zero administrative visibility into student feedback.
4. The student re-authenticates to access or supplement their feedback vault, demonstrating decryption authority emerges strictly with verified user consent.

*(Total submission text: 282 words)*

---

## Demo Video
- File: `demo.mp4` (Root directory, < 100 MB, 2 minutes maximum runtime).
- Demonstrates: TideCloak student login, client-side encryption of course evaluation, database ciphertext inspection, and verified user retrieval.

---

## Technical Architecture & Setup

### Prerequisites
- Docker & Docker Compose
- Node.js (v18+)
- Git

### Running Locally

1. **Start TideCloak Engine:**
   ```bash
   docker run -d --name tidecloak -p 8080:8080 tidefoundation/tidecloak:latest
   ```

2. **Clone & Install Dependencies:**
   ```bash
   git clone <repo-url>
   cd truthvoice-rmit
   npm install
   ```

3. **Start Application:**
   ```bash
   npm run dev
   ```
   Access client at `http://localhost:3000`.