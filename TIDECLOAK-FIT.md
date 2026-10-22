# Where TideCloak fits

In demo mode, sign-in, roles and access checks are **simulated**, following the organisers' instruction (HS-01) while the Tide network is unavailable. Nothing in demo mode claims a live Tide check. This table maps each simulated piece to the real TideCloak piece it stands for. It is also shown on the page (collapsible panel "Where TideCloak fits").

| Simulated here (demo mode) | Real TideCloak piece | Tide mode (S12) |
|---|---|---|
| Simulated sign-in token (`sim.<claims>.<HMAC>`, `core/src/simAuth.ts`) | TideCloak access token, checked with `verifyTideCloakToken` plus the DPoP proof | Yes: real login and token + DPoP check (S12a) |
| `withSim` (`app/lib/simAuth.ts`): token check, then the role rule per action | Server-side checks in `app/lib/tideAuth.ts` (`withTide`, `requireRealmAdmin`) | Yes: every `/api/tv/tide` route (S12a) |
| Realm roles `_tide_encryptor` and `_tide_decryptor` on the simulated accounts | The fixed Tide realm roles of the same names | Yes: the encryptor writes under the course policy, the decryptor is the AI operator (S12b) |
| 2-of-3 approver quorum (core service) | Not a Tide feature here: the app enforces it in both modes | Yes: the same app rule in both modes |
| `MockTideGateway` lease token (HMAC) | `RelationshipAttestation:1` policy signed by a `tide-realm-admin` in the Tide enclave | Yes: "Sign lease in Tide" (S12b); the live check is not yet recorded |
| Mock decrypt checks (subject, course, expiry) in the gateway | The Tide network refuses decryption outside the signed policy | Yes: decrypt runs in the AI operator's browser (S12b); the live check is not yet recorded |

Simulated accounts (`student-demo`, `lecturer-demo`, `student-rep`, `dean`, `qa-officer`, `it-admin`, `ai-summariser-01`) carry `_tide_enabled` plus the roles in the page's sign-in panel. Their `tideuserkey` values are deterministic fakes. The `it-admin` account holds `realm-management: tide-realm-admin` and gets no data or approval right from it: a role alone opens nothing. The server re-checks the signed token on every request; the UI only mirrors the result.
