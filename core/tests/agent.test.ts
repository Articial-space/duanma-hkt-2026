import { describe, expect, it } from "vitest";
import { SummaryAgent, THEME_KEYWORDS, mockSummarize } from "../src/agent.js";
import { AuditLog } from "../src/audit.js";
import { SYNTHETIC_FEEDBACK } from "../src/fixtures.js";
import { MockTideGateway, NotAuthorizedError, type TideGateway } from "../src/gateway.js";
import { buildRelationshipPolicy } from "../src/policy.js";
import {
  AGENT,
  APPROVERS,
  GRANT_AT,
  PLAINTEXT_1,
  PLAINTEXT_2,
  SUMMARY_1,
  SUMMARY_2,
  T0,
  activeRequest,
  commentsOf,
  fourWordLeak,
} from "./helpers.js";

const DASH = "—";

// Independent copy of the S6 table, used by the oracle below (the export is checked against it separately).
const TABLE: Record<string, string[]> = {
  assessment: ["assessment", "exam", "assignment", "marking", "grading", "rubric"],
  feedback: ["feedback", "response", "reply"],
  pace: ["pace", "fast", "rushed", "slow"],
  materials: ["slides", "materials", "readings", "notes"],
  labs: ["lab", "labs", "tutorial", "tutorials"],
  support: ["support", "help", "consultation", "office hours"],
};

/** Reference implementation of the S6 contract (used only on fixture data, where hand-computing is brittle). */
function oracle(text: string): string {
  const lines = text.split(/\r?\n/);
  const code = /^Course:\s+(\S+)/.exec(lines.find((l) => l.startsWith("Course:")) ?? "")?.[1] ?? "";
  const comments = lines.filter((l) => l.startsWith("Comment:"));
  const counts = Object.entries(TABLE).map(([theme, kws]) => ({
    theme,
    n: comments.filter((c) => kws.some((k) => c.toLowerCase().includes(k))).length,
  }));
  const top = counts
    .filter((c) => c.n >= 1)
    .sort((a, b) => b.n - a.n || (a.theme < b.theme ? -1 : 1))
    .slice(0, 3);
  const themes = top.length ? top.map((t) => `${t.theme} (${t.n})`).join(", ") : "none";
  return `SUMMARY: ${code} ${DASH} ${comments.length} comments; themes: ${themes}`;
}

/** Builds a batch in the S7 format with a given course code and comment bodies. */
function batch(code: string, comments: string[], title = "Placeholder Studies"): string {
  return [`Course: ${code} ${title}`, "Semester: 2026 S2", ...comments.map((c) => `Comment: ${c}`)].join("\n");
}

function policyFor(recordId: string) {
  return buildRelationshipPolicy({
    subjectType: "User",
    subjectId: AGENT,
    recordId,
    roles: ["_tide_decryptor"],
    vendorId: "vendor-demo",
    expirySeconds: 900,
  });
}

async function setup() {
  const gateway = new MockTideGateway({ secret: "agent-test-secret", approvers: APPROVERS });
  const audit = new AuditLog();
  const agent = new SummaryAgent({ id: AGENT, gateway, audit });
  const ct1 = await gateway.encryptRecord("fb-001", PLAINTEXT_1, policyFor("fb-001"));
  const ct2 = await gateway.encryptRecord("fb-002", PLAINTEXT_2, policyFor("fb-002"));
  const token = await gateway.signLease(activeRequest(), GRANT_AT + 1);
  return { gateway, audit, agent, ct1, ct2, token };
}

describe("S6 THEME_KEYWORDS", () => {
  it("is exactly the specified theme -> keyword table, all keywords lowercase", () => {
    // Accept a plain object or a Map: the SPEC only says "readonly map".
    const entries: Array<[string, readonly string[]]> =
      THEME_KEYWORDS instanceof Map
        ? [...(THEME_KEYWORDS as Map<string, readonly string[]>).entries()]
        : Object.entries(THEME_KEYWORDS as Record<string, readonly string[]>);
    const actual = Object.fromEntries(entries.map(([k, v]) => [k, [...v]]));
    expect(actual).toEqual(TABLE);
    for (const [, kws] of entries) for (const k of kws) expect(k).toBe(k.toLowerCase());
  });
});

describe("S6 mockSummarize format and counting", () => {
  it("renders the exact summary line for the two helper batches", () => {
    expect(mockSummarize(PLAINTEXT_1)).toBe(SUMMARY_1);
    expect(mockSummarize(PLAINTEXT_2)).toBe(SUMMARY_2);
  });

  it("matches the 'SUMMARY: <code> — <n> comments; themes: ...' shape", () => {
    expect(mockSummarize(PLAINTEXT_1)).toMatch(new RegExp(`^SUMMARY: DEMO1001 ${DASH} 4 comments; themes: .+$`));
    expect(mockSummarize(PLAINTEXT_1)).not.toContain("\n");
  });

  it("uses the course code only, not the course title", () => {
    const s = mockSummarize(batch("DEMO7777", ["The exam was fair"], "Zoology Practicum"));
    expect(s).toContain("DEMO7777");
    expect(s).not.toContain("Zoology");
    expect(s).not.toContain("Practicum");
  });

  it("counts comment LINES per theme, not keyword hits (two assessment keywords in one comment count once)", () => {
    // 'assessment rubric' hits two assessment keywords in the same comment.
    const s = mockSummarize(
      batch("DEMO9999", ["The assessment rubric was unclear", "Marking was fair", "Slides were clear"]),
    );
    expect(s).toBe(`SUMMARY: DEMO9999 ${DASH} 3 comments; themes: assessment (2), materials (1)`);
  });

  it("lists at most the top 3 themes; ties are ordered by theme name ascending", () => {
    const s = mockSummarize(
      batch("DEMO9999", [
        "The assessment rubric was unclear",
        "Marking was fair",
        "Slides were clear",
        "Lab sessions were rushed",
        "Feedback arrived late",
      ]),
    );
    // assessment 2; feedback, labs, materials, pace all 1 -> feedback, labs, materials (pace is 4th and dropped)
    expect(s).toBe(`SUMMARY: DEMO9999 ${DASH} 5 comments; themes: assessment (2), feedback (1), labs (1)`);
  });

  it("orders by count descending before theme name (support 2 beats assessment 1)", () => {
    const s = mockSummarize(
      batch("DEMO9999", ["Office hours were useful", "Consultation was great", "Exam was hard"]),
    );
    expect(s).toBe(`SUMMARY: DEMO9999 ${DASH} 3 comments; themes: support (2), assessment (1)`);
  });

  it("a comment that matches several themes counts for each of them", () => {
    // 'Lab' -> labs, 'rushed' -> pace
    const s = mockSummarize(batch("DEMO9999", ["Lab sessions were rushed"]));
    expect(s).toBe(`SUMMARY: DEMO9999 ${DASH} 1 comments; themes: labs (1), pace (1)`);
  });

  it("keyword matching is case-insensitive", () => {
    const s = mockSummarize(batch("DEMO9999", ["THE ASSESSMENT WAS HARD", "grading was HARSH"]));
    expect(s).toBe(`SUMMARY: DEMO9999 ${DASH} 2 comments; themes: assessment (2)`);
  });

  it("keyword matching is by substring, including multi-word keywords", () => {
    // 'tutorials' -> labs; 'office hours' (two words) -> support; 'helpful' contains 'help' -> support
    const s = mockSummarize(batch("DEMO9999", ["Great tutorials", "Office hours worked", "Very helpful staff"]));
    expect(s).toBe(`SUMMARY: DEMO9999 ${DASH} 3 comments; themes: support (2), labs (1)`);
  });

  it("prints 'themes: none' when no comment matches any keyword", () => {
    const s = mockSummarize(batch("DEMO9999", ["Great course overall", "Enjoyed it"]));
    expect(s).toBe(`SUMMARY: DEMO9999 ${DASH} 2 comments; themes: none`);
  });

  it("prints 'themes: none' for a batch with zero comments", () => {
    const s = mockSummarize(batch("DEMO9999", []));
    expect(s).toBe(`SUMMARY: DEMO9999 ${DASH} 0 comments; themes: none`);
  });

  it("lists fewer than three themes when fewer match", () => {
    const s = mockSummarize(batch("DEMO9999", ["The exam was fair"]));
    expect(s).toBe(`SUMMARY: DEMO9999 ${DASH} 1 comments; themes: assessment (1)`);
  });

  it("only 'Comment:' lines count: keywords in the Course or Semester lines are ignored", () => {
    const s = mockSummarize(batch("DEMO9999", ["Great course overall"], "Lab Assessment Feedback Slides"));
    expect(s).toBe(`SUMMARY: DEMO9999 ${DASH} 1 comments; themes: none`);
  });

  it("is deterministic and tolerates CRLF line endings", () => {
    expect(mockSummarize(PLAINTEXT_1)).toBe(mockSummarize(PLAINTEXT_1));
    expect(mockSummarize(PLAINTEXT_1.replace(/\n/g, "\r\n"))).toBe(SUMMARY_1);
  });
});

describe("S6 mockSummarize limits and privacy", () => {
  it("is at most 280 characters even when the course code is absurdly long", () => {
    const s = mockSummarize(batch("DEMO" + "9".repeat(400), ["The assessment rubric was unclear", "Slides were clear"]));
    expect(s.length).toBeLessThanOrEqual(280);
    expect(s.startsWith("SUMMARY: ")).toBe(true);
  });

  it("stays within 280 characters for a very large batch", () => {
    const many = Array.from({ length: 500 }, (_, i) => `Comment number ${i} on the assessment and the labs and the slides`);
    const s = mockSummarize(batch("DEMO9999", many));
    expect(s.length).toBeLessThanOrEqual(280);
    expect(s).toContain("500 comments");
  });

  it("never contains 4 or more consecutive words of any comment (helper batches)", () => {
    for (const text of [PLAINTEXT_1, PLAINTEXT_2]) {
      expect(fourWordLeak(mockSummarize(text), commentsOf(text))).toBeNull();
    }
  });

  it("never echoes a long comment, whatever its keywords", () => {
    const comments = [
      "The assessment rubric for the final report was never explained to us in lectures",
      "Our tutor gave detailed feedback on every lab submission within two days",
      "Office hours were always packed because consultation times overlapped with classes",
    ];
    const text = batch("DEMO9999", comments);
    const s = mockSummarize(text);
    expect(fourWordLeak(s, comments)).toBeNull();
    for (const c of comments) expect(s).not.toContain(c);
    expect(s).not.toContain("Comment:");
  });
});

describe("S6 mockSummarize on the synthetic fixtures", () => {
  it("fb-001 has assessment as its top theme", () => {
    const fb1 = SYNTHETIC_FEEDBACK.find((b) => b.recordId === "fb-001");
    expect(fb1).toBeDefined();
    const s = mockSummarize(fb1!.text);
    expect(s.startsWith("SUMMARY: DEMO1001 ")).toBe(true);
    expect(s).toContain("themes: assessment (");
  });

  it("every fixture batch summarises to the S6 contract, within 280 characters and without comment text", () => {
    for (const b of SYNTHETIC_FEEDBACK) {
      const s = mockSummarize(b.text);
      expect(s).toBe(oracle(b.text));
      expect(s.length).toBeLessThanOrEqual(280);
      expect(fourWordLeak(s, commentsOf(b.text))).toBeNull();
    }
  });
});

describe("S6 SummaryAgent.summarizeRecord", () => {
  it("with a valid token: returns the theme summary and logs AGENT_READ", async () => {
    const { agent, audit, ct1, token } = await setup();
    const res = await agent.summarizeRecord("fb-001", ct1, GRANT_AT + 5, token);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.summary).toBe(SUMMARY_1);
      expect(res.summary.startsWith("SUMMARY: ")).toBe(true);
      expect(res.summary).toContain("DEMO1001");
      expect(fourWordLeak(res.summary, commentsOf(PLAINTEXT_1))).toBeNull();
    }
    const entries = audit.entries();
    expect(entries.length).toBe(1);
    expect(entries[0].actor).toBe(AGENT);
    expect(entries[0].action).toBe("AGENT_READ");
    expect(entries[0].recordId).toBe("fb-001");
    expect(entries[0].at).toBe(GRANT_AT + 5);
    expect(audit.verify()).toEqual({ ok: true });
  });

  it("without a token: returns NO_ACTIVE_LEASE and logs AGENT_BLOCKED, without throwing", async () => {
    const { agent, audit, ct1 } = await setup();
    const res = await agent.summarizeRecord("fb-001", ct1, T0 + 10);
    expect(res).toEqual({ ok: false, reason: "NO_ACTIVE_LEASE" });
    const entries = audit.entries();
    expect(entries.length).toBe(1);
    expect(entries[0].actor).toBe(AGENT);
    expect(entries[0].action).toBe("AGENT_BLOCKED");
    expect(entries[0].recordId).toBe("fb-001");
    expect(entries[0].at).toBe(T0 + 10);
  });

  it("is blocked at and after token expiry, readable the instant before", async () => {
    const { agent, audit, ct1, token } = await setup();
    const before = await agent.summarizeRecord("fb-001", ct1, token.expiresAt - 1, token);
    expect(before.ok).toBe(true);
    const at = await agent.summarizeRecord("fb-001", ct1, token.expiresAt, token);
    expect(at).toEqual({ ok: false, reason: "NO_ACTIVE_LEASE" });
    const after = await agent.summarizeRecord("fb-001", ct1, token.expiresAt + 16 * 60_000, token);
    expect(after).toEqual({ ok: false, reason: "NO_ACTIVE_LEASE" });
    expect(audit.entries().map((e) => e.action)).toEqual(["AGENT_READ", "AGENT_BLOCKED", "AGENT_BLOCKED"]);
  });

  it("is blocked for another course's batch the lease does not cover", async () => {
    const { agent, audit, ct2, token } = await setup();
    const res = await agent.summarizeRecord("fb-002", ct2, GRANT_AT + 5, token);
    expect(res).toEqual({ ok: false, reason: "NO_ACTIVE_LEASE" });
    const last = audit.entries()[0];
    expect(last.action).toBe("AGENT_BLOCKED");
    expect(last.recordId).toBe("fb-002");
  });

  it("is blocked with a forged token", async () => {
    const { agent, ct1, token } = await setup();
    const forged = { ...token, expiresAt: token.expiresAt + 10_000_000 };
    const res = await agent.summarizeRecord("fb-001", ct1, token.expiresAt + 1, forged);
    expect(res).toEqual({ ok: false, reason: "NO_ACTIVE_LEASE" });
  });

  it("never logs AGENT_READ when blocked, and never writes feedback text to the audit log", async () => {
    const { agent, audit, ct1, token } = await setup();
    await agent.summarizeRecord("fb-001", ct1, T0);
    await agent.summarizeRecord("fb-001", ct1, GRANT_AT + 5, token);
    const json = JSON.stringify(audit.entries());
    for (const c of commentsOf(PLAINTEXT_1)) expect(json).not.toContain(c);
    expect(json).not.toContain("Comment:");
    expect(json).not.toContain(PLAINTEXT_1);
    expect(audit.entries().map((e) => e.action)).toEqual(["AGENT_BLOCKED", "AGENT_READ"]);
  });

  it("passes the agent's own id and the token to the gateway and summarises what it gets back", async () => {
    const calls: unknown[][] = [];
    const gateway: TideGateway = {
      encryptRecord: async () => "x",
      signLease: async () => {
        throw new Error("unused");
      },
      decryptRecord: async (...args: unknown[]) => {
        calls.push(args);
        return PLAINTEXT_1;
      },
    } as unknown as TideGateway;
    const agent = new SummaryAgent({ id: "agent-xyz", gateway, audit: new AuditLog() });
    const token = { leaseId: "l", agentId: "agent-xyz", recordId: "r", expiresAt: 5, approvals: [], signature: "s" };
    const res = await agent.summarizeRecord("fb-009", "CT", 1234, token);
    expect(res).toEqual({ ok: true, summary: SUMMARY_1 });
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe("fb-009");
    expect(calls[0][1]).toBe("CT");
    expect(calls[0][2]).toEqual({ id: "agent-xyz" });
    expect(calls[0][3]).toBe(1234);
    expect(calls[0][4]).toEqual(token);
  });

  it("propagates errors other than NotAuthorizedError", async () => {
    const gateway = {
      encryptRecord: async () => "x",
      signLease: async () => {
        throw new Error("unused");
      },
      decryptRecord: async () => {
        throw new Error("disk on fire");
      },
    } as unknown as TideGateway;
    const audit = new AuditLog();
    const agent = new SummaryAgent({ id: AGENT, gateway, audit });
    await expect(agent.summarizeRecord("fb-001", "CT", 1)).rejects.toThrow("disk on fire");
    expect(audit.entries().map((e) => e.action)).not.toContain("AGENT_READ");
  });

  it("treats a NotAuthorizedError from any gateway as blocked", async () => {
    const Ctor = NotAuthorizedError as unknown as new (m?: string) => Error;
    const gateway = {
      encryptRecord: async () => "x",
      signLease: async () => {
        throw new Error("unused");
      },
      decryptRecord: async () => {
        throw new Ctor("nope");
      },
    } as unknown as TideGateway;
    const agent = new SummaryAgent({ id: AGENT, gateway, audit: new AuditLog() });
    await expect(agent.summarizeRecord("fb-001", "CT", 1)).resolves.toEqual({
      ok: false,
      reason: "NO_ACTIVE_LEASE",
    });
  });

  it("has no method that approves, rejects, revokes, grants or signs leases", async () => {
    const { agent } = await setup();
    const names = new Set<string>(Object.getOwnPropertyNames(agent));
    let proto = Object.getPrototypeOf(agent) as object | null;
    while (proto && proto !== Object.prototype) {
      for (const n of Object.getOwnPropertyNames(proto)) names.add(n);
      proto = Object.getPrototypeOf(proto) as object | null;
    }
    for (const n of names) {
      expect(n).not.toMatch(/approv|reject|revok|grant|sign|lease/i);
    }
    expect((agent as unknown as Record<string, unknown>).approve).toBeUndefined();
    expect((agent as unknown as Record<string, unknown>).reject).toBeUndefined();
    expect((agent as unknown as Record<string, unknown>).revoke).toBeUndefined();
    expect(typeof agent.summarizeRecord).toBe("function");
  });
});
