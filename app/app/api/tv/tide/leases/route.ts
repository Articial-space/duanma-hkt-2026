// S12b: lecturer requests an AI summary lease (app-level 2-of-3 quorum, as S10). Verified token + DPoP.
import { readJson } from '@/app/lib/http'
import { withTide } from '@/app/lib/tideAuth'
import { requestLease, stateView } from '@/app/lib/tideState'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  return withTide(req, (caller) => stateView(caller).leases)
}

export function POST(req: Request) {
  return withTide(req, async (caller) => requestLease(caller, await readJson(req)))
}
