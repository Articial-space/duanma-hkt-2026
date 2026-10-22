import { NextResponse } from 'next/server'
import { SIM_USERS } from '../../../../../../core/src/simAuth.js'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(SIM_USERS)
}
