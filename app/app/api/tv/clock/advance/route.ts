import { readJson, respond } from '@/app/lib/http'

export const dynamic = 'force-dynamic'

export function POST(req: Request) {
  return respond(async ({ clock }) => {
    const body = await readJson(req)
    const minutes = body.minutes
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 1 || minutes > 120) {
      throw new Error('minutes must be a number from 1 to 120')
    }
    clock.advance(minutes * 60_000)
    return { offsetMs: clock.offsetMs(), now: clock.now() }
  })
}
