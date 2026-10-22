// S12b signed RelationshipAttestation policies. Verified token + DPoP on both methods.
// GET ?recordId=&access=read|write -> only a policy whose subject is the caller (their tideuserkey, one of
//   their realm roles or groups), and only while unexpired; `{ policy: null }` otherwise.
// POST (realm admins only, checked from the verified token):
//   { kind: "write", courseCode, policyB64 }  course write policy for Role _tide_encryptor
//   { kind: "read",  leaseId,    policyB64 }  lease = read policy for the AI operator, after the quorum
import { readJson } from '@/app/lib/http'
import { requireRealmAdmin, withTide } from '@/app/lib/tideAuth'
import { policyForCaller, storeLeasePolicy, storeWritePolicy } from '@/app/lib/tideState'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  return withTide(req, (caller) => {
    const params = new URL(req.url).searchParams
    const recordId = params.get('recordId') ?? ''
    const access = params.get('access') ?? 'read'
    if (!recordId) throw new Error('recordId is required')
    if (access !== 'read' && access !== 'write') throw new Error('access must be read or write')
    return { policy: policyForCaller(caller, recordId, access) }
  })
}

export function POST(req: Request) {
  return withTide(req, async (caller) => {
    requireRealmAdmin(caller)
    const body = await readJson(req)
    if (body['kind'] === 'write') return storeWritePolicy(caller, body)
    if (body['kind'] === 'read') return storeLeasePolicy(caller, body)
    throw new Error('kind must be "write" or "read"')
  })
}
