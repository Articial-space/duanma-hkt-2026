import { readJson, respond, str } from '@/app/lib/http'

export const dynamic = 'force-dynamic'

export function POST(req: Request) {
  return respond(async ({ svc }) => {
    const body = await readJson(req)
    // Only courseCode and comment are forwarded: no student identifier is ever passed on.
    return svc.submitFeedback({ courseCode: str(body, 'courseCode'), comment: str(body, 'comment') })
  })
}
