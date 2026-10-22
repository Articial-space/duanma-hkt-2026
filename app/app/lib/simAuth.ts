// S13b (server-only): simulated TideCloak sign-in for demo mode. Everything here is SIMULATED.
import 'server-only'
import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  SimAuthError,
  authorize,
  callerFromClaims,
  verifySimToken,
  type SimAction,
  type SimCaller,
} from '../../../core/src/simAuth.js'
import { getTv, type TvContext } from './tv'

export const SIM_COOKIE = 'tv_sim_session'

const secretKey = Symbol.for('truthvoice.sim.secret')
type GlobalWithSecret = typeof globalThis & { [secretKey]?: string }

export function simSecret(): string {
  if (process.env.TV_SIM_SECRET) return process.env.TV_SIM_SECRET
  const g = globalThis as GlobalWithSecret
  if (!g[secretKey]) g[secretKey] = randomBytes(32).toString('hex')
  return g[secretKey]!
}

export function readSimToken(req: Request): string | null {
  const auth = req.headers.get('authorization')
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim()
  const cookies = req.headers.get('cookie')
  if (cookies) {
    for (const part of cookies.split(';')) {
      const i = part.indexOf('=')
      if (i > 0 && part.slice(0, i).trim() === SIM_COOKIE) return part.slice(i + 1).trim()
    }
  }
  return null
}

/** Verified caller from the request, or null when signed out. Throws SimAuthError 401 for a bad/expired token. */
export function simCaller(req: Request): SimCaller | null {
  const token = readSimToken(req)
  if (!token) return null
  return callerFromClaims(verifySimToken(token, simSecret(), Date.now()))
}

function errorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : String(err)
  const status = err instanceof SimAuthError ? err.status : 400
  return NextResponse.json({ error: message }, { status })
}

export async function withSim(
  req: Request,
  action: SimAction,
  fn: (tv: TvContext, caller: SimCaller) => unknown,
): Promise<NextResponse> {
  try {
    const caller = simCaller(req)
    authorize(caller, action)
    const tv = await getTv()
    return NextResponse.json(await fn(tv, caller as SimCaller))
  } catch (err) {
    return errorResponse(err)
  }
}
