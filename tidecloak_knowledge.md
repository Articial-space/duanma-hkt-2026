# TideCloak Core Knowledge & Architecture Cheat Sheet

Technical summary of core principles, cryptographic concepts, and data flow architecture for TruthVoice RMIT.

---

## 1. What is TideCloak?

**TideCloak** is an open-source Identity and Access Management (IAM) platform developed by **Tide Foundation** (forked and enhanced from Keycloak), implementing an **Emergent Authority** architecture.

* **Core Distinction:** Traditional IAM systems (Firebase Auth, Auth0, AWS Cognito, vanilla Keycloak) store encryption keys centrally or delegate complete trust to the backend. Server and database administrators inevitably possess a "master key."
* **With TideCloak:** Administrative superuser authority is eliminated. No single individual, server, database, or AI possesses a master key capable of arbitrarily decrypting user data.

---

## 2. 4 Core Cryptographic Concepts in Tide

### 1. Emergent Authority
Authority to execute a sensitive operation (such as decrypting evaluation records) is **never pre-assigned** or stored statically on a server. Instead, authority "emerges" dynamically only when three conditions are simultaneously satisfied:
1. Valid user identity.
2. Predetermined access policy.
3. Necessary consensus or multi-party approval.

### 2. ORK Network (Oblivious Routing Key)
Rather than storing an intact private key inside a database or cloud Key Management Service (KMS), Tide shards keys across independent nodes using threshold cryptography:
* Cryptographic keys are **split into distributed fragments (shards)**.
* Each node holds only an isolated fragment and operates oblivious to the underlying data payload.
* Encryption and signing operations occur through threshold consensus computation without ever assembling the full key on your server.

### 3. DPoP (Demonstrating Proof-of-Possession)
* A security mechanism binding access tokens directly to a **private key pair generated on the user's local device**.
* **Significance:** Even if an attacker or backend administrator intercepts an access token over the wire, the token remains **completely unusable on any other machine** without the corresponding hardware-bound private key.

### 4. Zero-Knowledge Self-Encryption
* Data is encrypted directly at the client side (inside the student's browser) before transmission across the network.
* The backend database (PostgreSQL, MongoDB) only stores unreadable `ciphertext`.
* Only the authenticated student holding their device-bound credentials can initiate decryption.

---

## 3. The Three Tide Superpowers & Our Selection

| Superpower | Mechanism | Technical Complexity | TruthVoice Implementation |
| :--- | :--- | :---: | :---: |
| **Self-Encryption** *(Team Choice)* | Only the data creator can decrypt. Nobody (including IT Admins) can peek. | **Lowest (Optimal for Hackathon)** | **Core Demo Flow:** Students submit client-encrypted evaluations; database stores raw ciphertext. |
| **IGA (Multi-Admin Approval)** | Policy and role changes require a threshold of administrators (e.g., 70%) to co-sign. | Moderate - High | *Future Scope:* Unlocking aggregated analytics reports requires joint dean and student council signatures. |
| **Conditional Sharing (Forseti)** | Third parties decrypt data dynamically based on programmable policy rules. | Highest | *Excluded for short hackathon turnaround to eliminate deployment risks.* |

---

## 4. Data Flow Architecture

```text
[ RMIT Student (Browser Client) ]
              │
    1. Authenticate via TideCloak
              ▼
[ TideCloak Engine (:8080) ] <─── Sharded Threshold Consensus ───> [ Tide ORK Network ]
              │
    2. Issues Hardware-Bound DPoP Token
              ▼
[ Student Fills Out Evaluation Form ]
              │
    3. Client-Side Self-Encryption (Encrypted before transit)
              ▼
[ Submit Payload via API (:3000) ]
              │
              ▼
[ Backend Database (PostgreSQL / MongoDB) ]
  Stores only: { "evaluation_id": "...", "ciphertext": "U2FsdGVkX1+vupp..." }
              │
              ▼
[ University IT Admin Dashboard ]
  Inspects Database -> Sees Unreadable Ciphertext -> Zero Decryption Authority!
```