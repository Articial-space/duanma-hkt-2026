// S12b: the AI operator's browser posts only the theme summary (never comments). Verified token + DPoP.
import { readJson } from '@/app/lib/http'
import { withTide } from '@/app/lib/tideAuth'
import { storeSummary } from '@/app/lib/tideState'

export const dynamic = 'force-dynamic'

export function POST(req: Request) {
  return withTide(req, async (caller) => storeSummary(caller, await readJson(req)))
}
