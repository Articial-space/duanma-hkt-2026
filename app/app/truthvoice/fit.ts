// S13b: "Where TideCloak fits" table, shown on the demo page and mirrored in impl/TIDECLOAK-FIT.md.
export const SIM_NOTE =
  "Sign-in, roles and access checks: simulated TideCloak (organisers' workaround while the Tide network is unavailable)"

export interface FitRow {
  simulated: string
  real: string
  tideMode: string
}

export const FIT_ROWS: FitRow[] = [
  {
    simulated: 'Simulated sign-in token (sim.<claims>.<HMAC>, core/src/simAuth.ts)',
    real: 'TideCloak access token, checked with verifyTideCloakToken plus the DPoP proof',
    tideMode: 'Yes — real login and token + DPoP check (S12a)',
  },
  {
    simulated: 'withSim (app/lib/simAuth.ts): token check, then role rule per action',
    real: 'Server-side checks in app/lib/tideAuth.ts (withTide, requireRealmAdmin)',
    tideMode: 'Yes — every /api/tv/tide route (S12a)',
  },
  {
    simulated: 'Realm roles _tide_encryptor and _tide_decryptor on the sim accounts',
    real: 'The fixed Tide realm roles of the same names',
    tideMode: 'Yes — encryptor writes under the course policy, decryptor is the AI operator (S12b)',
  },
  {
    simulated: '2-of-3 approver quorum (core service)',
    real: 'Not a Tide feature here: the app enforces it in both modes',
    tideMode: 'Yes — same app rule in both modes',
  },
  {
    simulated: 'MockTideGateway lease token (HMAC)',
    real: 'RelationshipAttestation:1 policy signed by a tide-realm-admin in the Tide enclave',
    tideMode: 'Yes — "Sign lease in Tide" (S12b); live check not yet recorded',
  },
  {
    simulated: 'Mock decrypt checks (subject, course, expiry) in the gateway',
    real: 'The Tide network refuses decryption outside the signed policy',
    tideMode: 'Yes — decrypt happens in the AI operator browser (S12b); live check not yet recorded',
  },
]
