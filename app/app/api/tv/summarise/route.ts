import { readJson, str } from '@/app/lib/http'
import { withSim } from '@/app/lib/simAuth'

export const dynamic = 'force-dynamic'

export function POST(req: Request) {
  return withSim(req, 'summarise.run', async ({ svc }) => {
    const body = await readJson(req)
    return svc.runSummariser({ courseCode: str(body, 'courseCode') })
  })
}
