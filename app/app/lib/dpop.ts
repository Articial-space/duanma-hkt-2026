// S12 — server-side DPoP proof verification (RFC 9449) for the Tide-mode API routes.
//
// The TideCloak SDK verifies the ACCESS TOKEN (`verifyTideCloakToken` from @tidecloak/nextjs/server)
// but ships no verifier for the DPoP PROOF a `secureFetch` call attaches. This module checks the
// proof the way the SDK's browser side builds it (@tidecloak/js lib/tidecloak-dpop.js):
//   header { typ: "dpop+jwt", alg: ES256|ES384|ES512|EdDSA, jwk: public key }
//   claims { jti, htm, htu = origin + pathname, iat (seconds), ath = b64url(sha256(token)), nonce? }
// and binds it to the token: sha256 JWK thumbprint (RFC 7638) of the proof key === token `cnf.jkt`.
//
// Pure apart from Web Crypto (globalThis.crypto.subtle, Node >= 20): no Next imports, no network.

export class DpopError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DpopError'
  }
}

type Jwk = { kty?: unknown; crv?: unknown; x?: unknown; y?: unknown; d?: unknown; [k: string]: unknown }

const ALGS: Record<string, { importParams: EcKeyImportParams | Algorithm; verifyParams: EcdsaParams | Algorithm; kty: string; crv: string }> = {
  ES256: { importParams: { name: 'ECDSA', namedCurve: 'P-256' }, verifyParams: { name: 'ECDSA', hash: 'SHA-256' }, kty: 'EC', crv: 'P-256' },
  ES384: { importParams: { name: 'ECDSA', namedCurve: 'P-384' }, verifyParams: { name: 'ECDSA', hash: 'SHA-384' }, kty: 'EC', crv: 'P-384' },
  ES512: { importParams: { name: 'ECDSA', namedCurve: 'P-521' }, verifyParams: { name: 'ECDSA', hash: 'SHA-512' }, kty: 'EC', crv: 'P-521' },
  EdDSA: { importParams: { name: 'Ed25519' }, verifyParams: { name: 'Ed25519' }, kty: 'OKP', crv: 'Ed25519' },
}

/** Accept proofs issued up to this many seconds ago... */
export const DPOP_MAX_AGE_SECONDS = 120
/** ...or this many seconds in the future (clock skew). */
export const DPOP_MAX_FUTURE_SECONDS = 60

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new DpopError('DPoP proof is not base64url')
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (const b of u8) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function parseJsonPart(part: string, what: string): Record<string, unknown> {
  let v: unknown
  try {
    v = JSON.parse(new TextDecoder().decode(b64urlToBytes(part)))
  } catch {
    throw new DpopError(`DPoP proof ${what} is not valid JSON`)
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new DpopError(`DPoP proof ${what} is not an object`)
  return v as Record<string, unknown>
}

async function sha256B64url(text: string): Promise<string> {
  return bytesToB64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

/** RFC 7638 JWK thumbprint (SHA-256, base64url) over the required public members in lexicographic order. */
export async function jwkThumbprint(jwk: Jwk): Promise<string> {
  let canonical: string
  if (jwk.kty === 'EC') {
    canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })
  } else if (jwk.kty === 'OKP') {
    canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x })
  } else {
    throw new DpopError('DPoP proof key type is not supported')
  }
  return sha256B64url(canonical)
}

/** `origin + pathname` of a URL (no query, no fragment), as the SDK writes `htu`. */
export function htuOf(url: string): string {
  const u = new URL(url)
  return u.origin + u.pathname
}

export interface VerifyDpopInput {
  /** Value of the `DPoP` request header. */
  proof: string | null
  /** HTTP method of the request. */
  method: string
  /** Full URL of the request as the server received it. */
  url: string
  /** The access token from `Authorization: DPoP <token>`. */
  accessToken: string
  /** `cnf.jkt` from the VERIFIED access token. */
  expectedJkt: unknown
  /** Current time, epoch ms. */
  now: number
  /** Replay guard: returns false if this jti was already used (and records it otherwise). */
  rememberJti?: (jti: string, expiresAtMs: number) => boolean
}

/** Throws DpopError unless the proof is valid for this request and bound to this token. */
export async function verifyDpopProof(input: VerifyDpopInput): Promise<{ jti: string; jkt: string }> {
  const { proof, method, url, accessToken, expectedJkt, now } = input
  if (typeof expectedJkt !== 'string' || expectedJkt.length === 0) {
    throw new DpopError('access token is not DPoP-bound (no cnf.jkt): sign in with DPoP enabled')
  }
  if (!proof) throw new DpopError('missing DPoP proof header')
  const parts = proof.split('.')
  if (parts.length !== 3) throw new DpopError('DPoP proof is not a compact JWS')
  const [h, p, s] = parts
  const header = parseJsonPart(h, 'header')
  const claims = parseJsonPart(p, 'payload')

  if (header['typ'] !== 'dpop+jwt') throw new DpopError('DPoP proof typ must be dpop+jwt')
  const alg = typeof header['alg'] === 'string' ? header['alg'] : ''
  const spec = ALGS[alg]
  if (!spec) throw new DpopError('DPoP proof alg is not supported')
  const jwk = header['jwk'] as Jwk | undefined
  if (!jwk || typeof jwk !== 'object') throw new DpopError('DPoP proof has no jwk')
  if ('d' in jwk) throw new DpopError('DPoP proof jwk must be a public key')
  if (jwk.kty !== spec.kty || jwk.crv !== spec.crv) throw new DpopError('DPoP proof jwk does not match alg')

  let key: CryptoKey
  try {
    const publicJwk: JsonWebKey = { kty: String(jwk.kty), crv: String(jwk.crv), x: String(jwk.x) }
    if (jwk.kty === 'EC') publicJwk.y = String(jwk.y)
    key = await crypto.subtle.importKey('jwk', publicJwk, spec.importParams, false, ['verify'])
  } catch {
    throw new DpopError('DPoP proof jwk is not a valid public key')
  }
  const ok = await crypto.subtle.verify(spec.verifyParams, key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`))
  if (!ok) throw new DpopError('DPoP proof signature is invalid')

  if (claims['htm'] !== method.toUpperCase()) throw new DpopError('DPoP proof htm does not match the request method')
  if (typeof claims['htu'] !== 'string') throw new DpopError('DPoP proof has no htu')
  let htu: string
  try {
    htu = htuOf(claims['htu'])
  } catch {
    throw new DpopError('DPoP proof htu is not a URL')
  }
  if (htu !== htuOf(url)) throw new DpopError('DPoP proof htu does not match the request URL')

  const iat = claims['iat']
  if (typeof iat !== 'number' || !Number.isFinite(iat)) throw new DpopError('DPoP proof has no iat')
  const nowS = Math.floor(now / 1000)
  if (iat < nowS - DPOP_MAX_AGE_SECONDS) throw new DpopError('DPoP proof is too old')
  if (iat > nowS + DPOP_MAX_FUTURE_SECONDS) throw new DpopError('DPoP proof iat is in the future')

  const jti = claims['jti']
  if (typeof jti !== 'string' || jti.length === 0 || jti.length > 256) throw new DpopError('DPoP proof has no jti')

  if (claims['ath'] !== (await sha256B64url(accessToken))) throw new DpopError('DPoP proof ath does not match the access token')

  const jkt = await jwkThumbprint(jwk)
  if (jkt !== expectedJkt) throw new DpopError('DPoP proof key is not the key the access token is bound to')

  if (input.rememberJti && !input.rememberJti(jti, (iat + DPOP_MAX_AGE_SECONDS + DPOP_MAX_FUTURE_SECONDS) * 1000)) {
    throw new DpopError('DPoP proof was already used (replay)')
  }
  return { jti, jkt }
}

/** In-memory jti replay cache. */
export function createJtiCache(clock: () => number = () => Date.now()) {
  const seen = new Map<string, number>()
  return (jti: string, expiresAtMs: number): boolean => {
    const now = clock()
    for (const [k, exp] of seen) if (exp <= now) seen.delete(k)
    if (seen.has(jti)) return false
    seen.set(jti, expiresAtMs)
    return true
  }
}
