import { respond } from '@/app/lib/http'

export const dynamic = 'force-dynamic'

export function GET() {
  return respond(({ svc }) => svc.audit())
}
