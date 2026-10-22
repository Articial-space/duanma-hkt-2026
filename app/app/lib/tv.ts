// S11 server singleton: one in-memory TruthVoice service per server process (demo mode, mock Tide gateway).
import 'server-only'
import { randomBytes } from 'node:crypto'
import { MockTideGateway } from '../../../core/src/gateway.js'
import { createTruthVoiceService, type TruthVoiceService } from '../../../core/src/service.js'
import {
  AGENT_ID,
  APPROVERS,
  OPERATOR_ID,
  SYNTHETIC_FEEDBACK,
  VENDOR_ID,
} from '../../../core/src/fixtures.js'

export interface DemoClock {
  now(): number
  advance(ms: number): void
  offsetMs(): number
}

export interface TvContext {
  svc: TruthVoiceService
  clock: DemoClock
}

function createDemoClock(): DemoClock {
  let offset = 0
  return {
    now: () => Date.now() + offset,
    advance: (ms: number) => {
      offset += ms
    },
    offsetMs: () => offset,
  }
}

async function createContext(): Promise<TvContext> {
  const clock = createDemoClock()
  const gateway = new MockTideGateway({
    secret: process.env.TV_MOCK_SECRET || randomBytes(32).toString('hex'),
    approvers: APPROVERS.map((a) => a.id),
  })
  const svc = createTruthVoiceService({
    gateway,
    approvers: APPROVERS,
    agentId: AGENT_ID,
    vendorId: VENDOR_ID,
    operatorId: OPERATOR_ID,
    clock: () => clock.now(),
  })
  await svc.seed(SYNTHETIC_FEEDBACK)
  return { svc, clock }
}

// Kept on globalThis so dev-mode module reloads and separate route bundles share one instance.
const globalKey = Symbol.for('truthvoice.demo.context')
type GlobalWithTv = typeof globalThis & { [globalKey]?: Promise<TvContext> }

export function getTv(): Promise<TvContext> {
  const g = globalThis as GlobalWithTv
  if (!g[globalKey]) {
    g[globalKey] = createContext().catch((err) => {
      delete g[globalKey]
      throw err
    })
  }
  return g[globalKey]!
}
