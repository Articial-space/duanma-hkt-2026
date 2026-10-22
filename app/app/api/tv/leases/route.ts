import { readJson, respond, str } from '@/app/lib/http'
import { REQUESTER_ID } from '../../../../../core/src/fixtures.js'

export const dynamic = 'force-dynamic'

export function GET() {
  return respond(({ svc }) => svc.listLeases())
}

export function POST(req: Request) {
  return respond(async ({ svc }) => {
    const body = await readJson(req)
    return svc.requestSummary({ courseCode: str(body, 'courseCode'), requestedBy: REQUESTER_ID })
  })
}
