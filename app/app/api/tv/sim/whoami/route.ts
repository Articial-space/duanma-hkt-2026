import { NextResponse } from 'next/server'
import { simCaller } from '@/app/lib/simAuth'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  try {
    return NextResponse.json({ caller: simCaller(req) })
  } catch {
    // an invalid or expired token counts as signed out
    return NextResponse.json({ caller: null })
  }
}
