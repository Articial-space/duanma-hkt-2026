import { NextResponse } from 'next/server'
import { SIM_COOKIE } from '@/app/lib/simAuth'

export const dynamic = 'force-dynamic'

export function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SIM_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
