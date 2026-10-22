// S12b: app-level approval (2 of 3). Enforced by this app, not by the Tide network. Verified token + DPoP.
import { readJson } from '@/app/lib/http'
import { withTide } from '@/app/lib/tideAuth'
import { approveLease } from '@/app/lib/tideState'

export const dynamic = 'force-dynamic'

export function POST(req: Request) {
  return withTide(req, async (caller) => approveLease(caller, await readJson(req)))
}
