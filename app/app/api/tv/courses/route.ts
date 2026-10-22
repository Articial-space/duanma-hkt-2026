import { withSim } from '@/app/lib/simAuth'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  return withSim(req, 'courses.read', ({ svc }) => svc.listCourses())
}
