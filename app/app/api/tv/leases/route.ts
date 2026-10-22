import { readJson, str } from '@/app/lib/http'
import { withSim } from '@/app/lib/simAuth'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  return withSim(req, 'leases.read', ({ svc }) => svc.listLeases())
}

export function POST(req: Request) {
  return withSim(req, 'lease.request', async ({ svc }, caller) => {
    const body = await readJson(req)
    // Identity comes from the verified token, never from the body.
    return svc.requestSummary({ courseCode: str(body, 'courseCode'), requestedBy: caller.username })
  })
}
