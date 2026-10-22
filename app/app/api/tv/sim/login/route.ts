import { NextResponse } from 'next/server'
import { SIM_COOKIE, simSecret } from '@/app/lib/simAuth'
import { readJson, str } from '@/app/lib/http'
import { SimAuthError, callerFromClaims, issueSimToken, verifySimToken } from '../../../../../../core/src/simAuth.js'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await readJson(req)
    const now = Date.now()
    const token = issueSimToken({ username: str(body, 'username'), secret: simSecret(), now })
    const caller = callerFromClaims(verifySimToken(token, simSecret(), now))
    const res = NextResponse.json({ caller, token })
    res.cookies.set(SIM_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 3600 })
    return res
  } catch (err) {
    const status = err instanceof SimAuthError ? err.status : 400
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status })
  }
}
