import { withSim } from '@/app/lib/simAuth'

export const dynamic = 'force-dynamic'

export function POST(req: Request) {
  return withSim(req, 'audit.tamper-demo', ({ svc }) => svc.tamperDemo())
}
