import { withSim } from '@/app/lib/simAuth'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  return withSim(req, 'audit.read', ({ svc }) => svc.audit())
}
