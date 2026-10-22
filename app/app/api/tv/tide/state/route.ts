// S12 Tide mode: everything the page shows (ciphertext rows, courses, leases, summaries, audit). Verified token + DPoP.
import { withTide } from '@/app/lib/tideAuth'
import { stateView } from '@/app/lib/tideState'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  return withTide(req, (caller) => stateView(caller))
}
