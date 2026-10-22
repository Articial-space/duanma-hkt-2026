import { readJson, respond, str } from '@/app/lib/http'

export const dynamic = 'force-dynamic'

export function POST(req: Request) {
  return respond(async ({ svc }) => {
    const body = await readJson(req)
    return svc.approve({ leaseId: str(body, 'leaseId'), approverId: str(body, 'approverId') })
  })
}
