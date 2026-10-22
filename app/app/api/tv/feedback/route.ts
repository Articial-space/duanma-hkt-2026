import { readJson, str } from '@/app/lib/http'
import { withSim } from '@/app/lib/simAuth'

export const dynamic = 'force-dynamic'

export function POST(req: Request) {
  return withSim(req, 'feedback.submit', async ({ svc }) => {
    const body = await readJson(req)
    // Only courseCode and comment are forwarded: no student identifier is ever passed on.
    return svc.submitFeedback({ courseCode: str(body, 'courseCode'), comment: str(body, 'comment') })
  })
}
