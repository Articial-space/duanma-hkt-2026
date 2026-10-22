// S12b: records the caller's tideuserkey from the VERIFIED token (never from the body), so a realm admin
// can later sign a lease naming the AI operator account. Verified token + DPoP.
import { withTide } from '@/app/lib/tideAuth'
import { recordWhoAmI } from '@/app/lib/tideState'

export const dynamic = 'force-dynamic'

export function POST(req: Request) {
  return withTide(req, (caller) => recordWhoAmI(caller))
}
