// S12b: the realm's admin policy, which authorises signRelationshipPolicy in the admin's browser.
// Fetched server-side from GET {auth-server-url}/admin/realms/{realm}/iga/role-policies/name/tide-realm-admin
// (field `policy`, base64) with the caller's own admin token. Realm admins only (verified token + DPoP).
import { HttpError, REALM_ADMIN_ROLE, requireRealmAdmin, withTide } from '@/app/lib/tideAuth'
import { tcConfig } from '@/app/lib/tideConfig'

export const dynamic = 'force-dynamic'

function adminPolicyUrl(): string {
  const base = String(tcConfig['auth-server-url'] ?? '').replace(/\/+$/, '')
  const realm = encodeURIComponent(String(tcConfig['realm'] ?? ''))
  return `${base}/admin/realms/${realm}/iga/role-policies/name/${REALM_ADMIN_ROLE}`
}

export function GET(req: Request) {
  return withTide(req, async (caller) => {
    requireRealmAdmin(caller)
    let res: Response
    try {
      res = await fetch(adminPolicyUrl(), {
        headers: { Authorization: `Bearer ${caller.accessToken}`, Accept: 'application/json' },
        cache: 'no-store',
      })
    } catch (err) {
      throw new HttpError(502, `TideCloak unreachable: ${err instanceof Error ? err.message : String(err)}`)
    }
    const text = await res.text()
    if (!res.ok) {
      throw new HttpError(502, `TideCloak returned HTTP ${res.status} for the admin policy: ${text.slice(0, 300)}`)
    }
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new HttpError(502, 'TideCloak admin policy response is not JSON')
    }
    const policy = (data as { policy?: unknown } | null)?.policy
    if (typeof policy !== 'string' || policy.length === 0) {
      throw new HttpError(502, 'TideCloak admin policy response has no `policy` field')
    }
    return { policy }
  })
}
