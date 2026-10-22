// S12 mode detection. Shared by the server, the client and core's unit tests, so it has no imports.
// Tide mode is on only when the TideCloak adapter config (tidecloak.json) names a realm and an
// auth server; the placeholder `{}` (or anything incomplete) keeps the app in demo mode (S11).

export type AdapterConfigLike = Readonly<Record<string, unknown>>

function nonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.length > 0
}

export function isTideConfigured(cfg: AdapterConfigLike): boolean {
  if (typeof cfg !== 'object' || cfg === null) return false
  return nonEmptyString(cfg['realm']) && nonEmptyString(cfg['auth-server-url'])
}

export const DEMO_BADGE = 'Demo mode — Tide network simulated'
export const TIDE_BADGE = 'Tide mode — live TideCloak (DPoP)'
