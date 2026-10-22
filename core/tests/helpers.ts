// Shared test helpers (not a test file). Deterministic: explicit clock values only.
import { approve, createLeaseRequest, type LeaseRequest } from "../src/lease.js";

export const T0 = 1_700_000_000_000;
export const TTL_SECONDS = 900;
export const TTL_MS = TTL_SECONDS * 1000;
export const APPROVERS = ["student-rep", "dean", "qa-officer"];
export const AGENT = "ai-summariser-01";
export const REQUESTER = "lecturer-demo";

/**
 * Feedback batches in the S7 format. Expected mockSummarize output, hand-computed from the S6 keyword table:
 *  - PLAINTEXT_1: assessment 2 (comments 1 and 2), labs 1 and pace 1 (comment 4), materials 1 (comment 3)
 *  - PLAINTEXT_2: support 2 (comments 1 and 2), materials 1 (comment 3)
 */
export const PLAINTEXT_1 = [
  "Course: DEMO1001 Intro to Testing",
  "Semester: 2026 S2",
  "Comment: The assessment rubric was unclear",
  "Comment: Marking criteria changed twice",
  "Comment: Slides were clear",
  "Comment: Lab sessions were rushed",
].join("\n");
export const SUMMARY_1 = "SUMMARY: DEMO1001 — 4 comments; themes: assessment (2), labs (1), materials (1)";

export const PLAINTEXT_2 = [
  "Course: DEMO2002 Data Studio",
  "Semester: 2026 S2",
  "Comment: Office hours were useful",
  "Comment: Consultation slots filled quickly",
  "Comment: The readings were too long",
].join("\n");
export const SUMMARY_2 = "SUMMARY: DEMO2002 — 3 comments; themes: support (2), materials (1)";

/** Bodies (text after "Comment:") of the Comment lines of a feedback batch. */
export function commentsOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.startsWith("Comment:"))
    .map((l) => l.slice("Comment:".length).trim());
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter((w) => w.length > 0);
}

/** Returns a 4-word run (case and punctuation insensitive) of any single comment found in `out`, else null. */
export function fourWordLeak(out: string, comments: string[]): string | null {
  const hay = " " + words(out).join(" ") + " ";
  for (const c of comments) {
    const w = words(c);
    for (let i = 0; i + 4 <= w.length; i++) {
      const run = w.slice(i, i + 4).join(" ");
      if (hay.includes(" " + run + " ")) return run;
    }
  }
  return null;
}

export function newRequest(over: Record<string, unknown> = {}): LeaseRequest {
  return createLeaseRequest({
    id: "lease-1",
    agentId: AGENT,
    recordId: "fb-001",
    purpose: "Summarise course feedback after grades are published",
    requestedBy: REQUESTER,
    now: T0,
    ttlSeconds: TTL_SECONDS,
    adminCount: 3,
    ...over,
  } as Parameters<typeof createLeaseRequest>[0]);
}

/** Request approved by student-rep at T0+1000 and dean at T0+2000 (quorum 2 of 3) -> ACTIVE, grantedAt T0+2000. */
export const GRANT_AT = T0 + 2000;
export function activeRequest(over: Record<string, unknown> = {}): LeaseRequest {
  let r = newRequest(over);
  r = approve(r, { id: "student-rep" }, T0 + 1000);
  r = approve(r, { id: "dean" }, GRANT_AT);
  return r;
}

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}
