// S12a: stores ciphertext made in the student's browser (row with tide: true and the course code). Verified token + DPoP.
import { readJson } from '@/app/lib/http'
import { withTide } from '@/app/lib/tideAuth'
import { stateView, submitRow } from '@/app/lib/tideState'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  return withTide(req, (caller) => stateView(caller).rows)
}

export function POST(req: Request) {
  return withTide(req, async (caller) => submitRow(caller, await readJson(req)))
}
