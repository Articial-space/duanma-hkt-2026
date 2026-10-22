// S9 - "Who can read this feedback right now?" Every row is a REAL gateway.decryptRecord attempt.
import { AGENT_ID, OPERATOR_ID, REQUESTER_ID } from "./fixtures.js";
import { NotAuthorizedError, type LeaseToken, type TideGateway } from "./gateway.js";

export interface ProbeRow {
  who: string;
  attempt: string;
  result: "READ" | "BLOCKED";
}

export interface ProbeInput {
  gateway: TideGateway;
  recordId: string;
  ciphertext: string;
  otherRecordCiphertext: string;
  now: number;
  token?: LeaseToken;
}

const YEAR_MS = 365 * 24 * 3600 * 1000;

export async function probeAccess(input: ProbeInput): Promise<ProbeRow[]> {
  const { gateway, recordId, ciphertext, otherRecordCiphertext, now, token } = input;

  async function attempt(
    who: string,
    what: string,
    callerId: string,
    ct: string,
    tok: LeaseToken | undefined,
  ): Promise<ProbeRow> {
    try {
      await gateway.decryptRecord(recordId, ct, { id: callerId }, now, tok);
      return { who, attempt: what, result: "READ" };
    } catch (err) {
      if (err instanceof NotAuthorizedError) return { who, attempt: what, result: "BLOCKED" };
      throw err;
    }
  }

  const forged: LeaseToken = token
    ? { ...token, approvals: [...token.approvals], expiresAt: now + YEAR_MS }
    : {
        leaseId: "forged-lease",
        agentId: AGENT_ID,
        recordId,
        expiresAt: now + YEAR_MS,
        approvals: [],
        signature: "0".repeat(64),
      };

  const rows: ProbeRow[] = [];
  rows.push(
    await attempt(
      "University IT admin (database + server)",
      "reads the stored ciphertext directly, no lease token",
      OPERATOR_ID,
      ciphertext,
      undefined,
    ),
  );
  rows.push(
    await attempt(
      "Lecturer",
      "asks to read the raw feedback directly, no lease token",
      REQUESTER_ID,
      ciphertext,
      undefined,
    ),
  );
  rows.push(
    await attempt(
      "IT admin with forged lease",
      "replays a lease token with its expiry edited to +365 days",
      AGENT_ID,
      ciphertext,
      forged,
    ),
  );
  rows.push(
    await attempt(
      "AI summariser, no lease",
      "asks for the feedback batch without any lease token",
      AGENT_ID,
      ciphertext,
      undefined,
    ),
  );
  rows.push(
    await attempt(
      "AI summariser with lease",
      "presents the signed lease token for this course",
      AGENT_ID,
      ciphertext,
      token,
    ),
  );
  rows.push(
    await attempt(
      "AI summariser, lease on another course",
      "presents the same lease token against another course's ciphertext",
      AGENT_ID,
      otherRecordCiphertext,
      token,
    ),
  );
  return rows;
}

export function formatProbe(rows: ProbeRow[]): string {
  return rows.map((r) => `${r.who} | ${r.attempt} | ${r.result}`).join("\n");
}
