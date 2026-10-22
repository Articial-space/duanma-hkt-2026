import type { NextRequest } from 'next/server'
import { withSim } from '@/app/lib/simAuth'

export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  return withSim(req, 'probe.read', ({ svc }) => {
    const course = req.nextUrl.searchParams.get('course')
    if (!course) throw new Error('course query parameter is required')
    return svc.probe({ courseCode: course })
  })
}
