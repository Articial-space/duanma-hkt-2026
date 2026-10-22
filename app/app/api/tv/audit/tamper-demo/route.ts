import { respond } from '@/app/lib/http'

export const dynamic = 'force-dynamic'

export function POST() {
  return respond(({ svc }) => svc.tamperDemo())
}
