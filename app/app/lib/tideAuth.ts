// S12 server-side authentication for the Tide-mode API routes (app/api/tv/tide/**).
// Every request must carry `Authorization: DPoP <access token>` plus a `DPoP` proof (what the SDK's
// `secureFetch` sends when DPoP is on). The token is verified with the template's verifier
// (`verifyTideCloakToken` from @tidecloak/nextjs/server, as app/api/protected does); the proof is
// verified in ./dpop and must be signed by the key the token is bound to (`cnf.jkt`).
// Anything else -> 401. Demo-mode routes (app/api/tv/*) do not use this module and are unchanged.
import 'server-only'
import { NextResponse } from 'next/server'
import { verifyTideCloakToken } from '@tidecloak/nextjs/server'
import { DEFAULT_AI_OPERATOR_USERNAME, TIDE_MODE, tcConfig } from './tideConfig'
import { DpopError, createJtiCache, verifyDpopProof } from './dpop'

/** Realm admin role: a client role of the `realm-management` client (granted by init/tcinit.sh). */
export const REALM_ADMIN_ROLE = 'tide-realm-admin'
export const REALM_MANAGEMENT_CLIENT = 'realm-management'

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export interface TideCaller {
  username: string
  tideUserKey: string
  realmRoles: string[]
  groups: string[]
  isRealmAdmin: boolean
  isAiOperator: boolean
  /** The verified access token, only for forwarding to TideCloak's own admin API. */
  accessToken: string
}

export function aiOperatorUsername(): string {
  return process.env.TV_AI_OPERATOR_USERNAME || DEFAULT_AI_OPERATOR_USERNAME
}

const jtiKey = Symbol.for('truthvoice.tide.dpop-jti')
type GlobalWithJti = typeof globalThis & { [jtiKey]?: ReturnType<typeof createJtiCache> }
function jtiCache() {
  const g = globalThis as GlobalWithJti
  if (!g[jtiKey]) g[jtiKey] = createJtiCache()
  return g[jtiKey]!
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export async function authenticate(req: Request): Promise<TideCaller> {
  if (!TIDE_MODE) throw new HttpError(401, 'Unauthorized: Tide mode is not configured (tidecloak.json has no realm)')

  const auth = req.headers.get('authorization') ?? ''
  const m = /^DPoP\s+([A-Za-z0-9._~+/=-]+)$/.exec(auth)
  if (!m) throw new HttpError(401, 'Unauthorized: Tide-mode routes need Authorization: DPoP <token> and a DPoP proof')
  const accessToken = m[1]

  const claims = (await verifyTideCloakToken(tcConfig, accessToken)) as Record<string, unknown> | null
  if (!claims) throw new HttpError(401, 'Unauthorized: invalid or expired access token')

  const cnf = claims['cnf'] as { jkt?: unknown } | undefined
  try {
    await verifyDpopProof({
      proof: req.headers.get('dpop'),
      method: req.method,
      url: req.url,
      accessToken,
      expectedJkt: cnf?.jkt,
      now: Date.now(),
      rememberJti: jtiCache(),
    })
  } catch (err) {
    if (err instanceof DpopError) throw new HttpError(401, `Unauthorized: ${err.message}`)
    throw err
  }

  const realmRoles = stringList((claims['realm_access'] as { roles?: unknown } | undefined)?.roles)
  const resourceAccess = (claims['resource_access'] ?? {}) as Record<string, { roles?: unknown } | undefined>
  const realmMgmtRoles = stringList(resourceAccess[REALM_MANAGEMENT_CLIENT]?.roles)
  const username = typeof claims['preferred_username'] === 'string' ? (claims['preferred_username'] as string) : ''
  const tideUserKey = typeof claims['tideuserkey'] === 'string' ? (claims['tideuserkey'] as string) : ''

  return {
    username,
    tideUserKey,
    realmRoles,
    groups: stringList(claims['groups']),
    isRealmAdmin: realmMgmtRoles.includes(REALM_ADMIN_ROLE),
    isAiOperator: username !== '' && username === aiOperatorUsername(),
    accessToken,
  }
}

/** Runs `fn` for an authenticated caller. 401/403 from HttpError; any other error -> 400 { error }. */
export async function withTide(req: Request, fn: (caller: TideCaller) => unknown): Promise<NextResponse> {
  try {
    const caller = await authenticate(req)
    return NextResponse.json(await fn(caller))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof HttpError) {
      const headers: Record<string, string> = {}
      if (err.status === 401) headers['WWW-Authenticate'] = 'DPoP algs="ES256 ES384 ES512 EdDSA"'
      return NextResponse.json({ error: message }, { status: err.status, headers })
    }
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export function requireRealmAdmin(caller: TideCaller): void {
  if (!caller.isRealmAdmin) throw new HttpError(403, `Forbidden: only a realm admin (${REALM_ADMIN_ROLE}) can do this`)
}
