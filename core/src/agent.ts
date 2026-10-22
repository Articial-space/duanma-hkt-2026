// S6 - mocked AI summariser (BR-03: mocked systems). Deterministic, no network.
// The summary names the course code, the comment count and the top themes only; it never
// contains comment text, so a lecturer who receives it cannot recognise any student's wording.
import type { AuditLog } from "./audit.js";
import { NotAuthorizedError, type LeaseToken, type TideGateway } from "./gateway.js";
import { mockSummarize } from "./summarize.js";

export { THEME_KEYWORDS, mockSummarize, type ThemeName } from "./summarize.js";

export type SummarizeResult = { ok: true; summary: string } | { ok: false; reason: "NO_ACTIVE_LEASE" };

export class SummaryAgent {
  private readonly id: string;
  private readonly gateway: TideGateway;
  private readonly audit: AuditLog;

  constructor(opts: { id: string; gateway: TideGateway; audit: AuditLog }) {
    this.id = opts.id;
    this.gateway = opts.gateway;
    this.audit = opts.audit;
  }

  async summarizeRecord(
    recordId: string,
    ciphertext: string,
    now: number,
    token?: LeaseToken,
  ): Promise<SummarizeResult> {
    let plaintext: string;
    try {
      plaintext = await this.gateway.decryptRecord(recordId, ciphertext, { id: this.id }, now, token);
    } catch (err) {
      if (err instanceof NotAuthorizedError) {
        this.audit.append({ at: now, actor: this.id, action: "AGENT_BLOCKED", recordId });
        return { ok: false, reason: "NO_ACTIVE_LEASE" };
      }
      throw err;
    }
    this.audit.append({ at: now, actor: this.id, action: "AGENT_READ", recordId });
    return { ok: true, summary: mockSummarize(plaintext) };
  }
}
