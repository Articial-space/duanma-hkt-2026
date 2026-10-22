import { readJson, str } from '@/app/lib/http'
import { withSim } from '@/app/lib/simAuth'

export const dynamic = 'force-dynamic'

export function POST(req: Request) {
  return withSim(req, 'lease.reject', async ({ svc }, caller) => {
    const body = await readJson(req)
    // approverId comes from the verified token; any body approverId is ignored.
    return svc.reject({ leaseId: str(body, 'leaseId'), approverId: caller.username })
  })
}
