import type { NextRequest } from 'next/server'
import { respond } from '@/app/lib/http'

export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  return respond(({ svc }) => {
    const course = req.nextUrl.searchParams.get('course')
    if (!course) throw new Error('course query parameter is required')
    return svc.probe({ courseCode: course })
  })
}
