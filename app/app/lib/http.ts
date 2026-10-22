// Shared JSON helpers for the /api/tv routes. Any error becomes 400 { error: message } (S11).
import 'server-only'
import { NextResponse } from 'next/server'
import { getTv, type TvContext } from './tv'

export async function respond(fn: (tv: TvContext) => unknown): Promise<NextResponse> {
  try {
    const tv = await getTv()
    return NextResponse.json(await fn(tv))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new Error('request body must be JSON')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('request body must be a JSON object')
  }
  return body as Record<string, unknown>
}

export function str(body: Record<string, unknown>, key: string): string {
  const v = body[key]
  if (typeof v !== 'string') throw new Error(`${key} must be a string`)
  return v
}
