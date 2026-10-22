// S12 shared TideCloak config (server and client). tidecloak.json is the placeholder `{}` until the realm
// is initialised; then it is the realm's adapter JSON and the app switches to Tide mode.
import rawConfig from '../../tidecloak.json'
import { isTideConfigured } from './mode'

export const tcConfig = rawConfig as Readonly<Record<string, unknown>>

/** True when tidecloak.json names a realm and an auth server (S12 mode detection). */
export const TIDE_MODE: boolean = isTideConfigured(tcConfig)

/**
 * Config handed to TideCloakProvider in Tide mode: the adapter JSON as-is, plus DPoP switched on
 * (the SDK's opt-in `useDPoP`) unless the adapter JSON already sets it. With DPoP on, the access
 * token is bound to a browser key (`cnf.jkt`) and `secureFetch` attaches a DPoP proof that the
 * Tide-mode API routes verify.
 */
export function providerConfig(): Record<string, unknown> {
  return { ...tcConfig, useDPoP: tcConfig['useDPoP'] ?? { mode: 'strict' } }
}

export function vendorIdFromConfig(): string {
  const v = tcConfig['vendorId']
  return typeof v === 'string' ? v : ''
}

/** Username of the AI operator account (the one whose tideuserkey a lease names). */
export const DEFAULT_AI_OPERATOR_USERNAME = 'ai-summariser'
