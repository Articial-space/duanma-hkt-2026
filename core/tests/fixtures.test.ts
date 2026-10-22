import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_ID,
  APPROVERS,
  OPERATOR_ID,
  REQUESTER_ID,
  SYNTHETIC_FEEDBACK,
  VENDOR_ID,
} from "../src/fixtures.js";
import { approvalThreshold, isRealQuorum } from "../src/threshold.js";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

describe("S7 SYNTHETIC_FEEDBACK", () => {
  it("has exactly three course batches with the specified ids, owners and course codes", () => {
    expect(SYNTHETIC_FEEDBACK.length).toBe(3);
    expect(SYNTHETIC_FEEDBACK.map((b) => b.recordId)).toEqual(["fb-001", "fb-002", "fb-003"]);
    expect(SYNTHETIC_FEEDBACK.map((b) => b.ownerId)).toEqual([
      "student-cohort-001",
      "student-cohort-002",
      "student-cohort-003",
    ]);
    expect(SYNTHETIC_FEEDBACK.map((b) => b.courseCode)).toEqual(["DEMO1001", "DEMO2002", "DEMO3003"]);
  });

  it("each text is 'Course:' line, 'Semester: 2026 S2' line, then 4 to 6 'Comment:' lines", () => {
    for (const b of SYNTHETIC_FEEDBACK) {
      const lines = b.text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      expect(lines.length, b.recordId).toBeGreaterThanOrEqual(6);
      expect(lines.length, b.recordId).toBeLessThanOrEqual(8);
      expect(lines[0].startsWith(`Course: ${b.courseCode} `)).toBe(true);
      expect(lines[0].slice(`Course: ${b.courseCode} `.length).trim().length).toBeGreaterThan(0);
      expect(lines[1]).toBe("Semester: 2026 S2");
      const comments = lines.slice(2);
      expect(comments.length).toBeGreaterThanOrEqual(4);
      expect(comments.length).toBeLessThanOrEqual(6);
      for (const c of comments) expect(c).toMatch(/^Comment: \S.*$/);
    }
  });

  it("batches are distinct and carry no contact-style identifiers", () => {
    expect(new Set(SYNTHETIC_FEEDBACK.map((b) => b.text)).size).toBe(3);
    expect(new Set(SYNTHETIC_FEEDBACK.map((b) => b.text.split("\n")[0])).size).toBe(3);
    for (const b of SYNTHETIC_FEEDBACK) {
      expect(b.text).not.toMatch(/@/);
      expect(b.text).not.toMatch(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/);
      expect(b.text).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/);
      expect(b.text).not.toMatch(/https?:\/\//);
      expect(b.text).not.toMatch(/\b[sS]?\d{7}\b/); // no student-number-like ids
    }
  });

  it("fb-001 comments make 'assessment' the top theme (assessment strictly leads every other theme)", () => {
    const fb1 = SYNTHETIC_FEEDBACK.find((b) => b.recordId === "fb-001");
    expect(fb1).toBeDefined();
    const comments = fb1!.text.split(/\r?\n/).filter((l) => l.startsWith("Comment:"));
    const table: Record<string, string[]> = {
      assessment: ["assessment", "exam", "assignment", "marking", "grading", "rubric"],
      feedback: ["feedback", "response", "reply"],
      pace: ["pace", "fast", "rushed", "slow"],
      materials: ["slides", "materials", "readings", "notes"],
      labs: ["lab", "labs", "tutorial", "tutorials"],
      support: ["support", "help", "consultation", "office hours"],
    };
    const count = (t: string) => comments.filter((c) => table[t].some((k) => c.toLowerCase().includes(k))).length;
    const assessment = count("assessment");
    expect(assessment).toBeGreaterThanOrEqual(2);
    for (const t of Object.keys(table)) {
      if (t !== "assessment") expect(assessment, `assessment vs ${t}`).toBeGreaterThan(count(t));
    }
  });
});

describe("S7 APPROVERS and ids", () => {
  it("APPROVERS is the three specified approvers", () => {
    expect(Array.isArray(APPROVERS)).toBe(true);
    expect(APPROVERS.map((c) => c.id)).toEqual(["student-rep", "dean", "qa-officer"]);
  });

  it("no approver is flagged as an agent", () => {
    for (const c of APPROVERS) {
      expect((c as { isAgent?: boolean }).isAgent).not.toBe(true);
    }
  });

  it("3 approvers give a real quorum of 2", () => {
    expect(approvalThreshold(APPROVERS.length)).toBe(2);
    expect(isRealQuorum(APPROVERS.length)).toBe(true);
  });

  it("AGENT_ID, REQUESTER_ID, VENDOR_ID and OPERATOR_ID have the specified values", () => {
    expect(AGENT_ID).toBe("ai-summariser-01");
    expect(REQUESTER_ID).toBe("lecturer-demo");
    expect(VENDOR_ID).toBe("vendor-demo");
    expect(OPERATOR_ID).toBe("it-admin");
  });

  it("agent, lecturer and IT admin are not approvers", () => {
    const ids = APPROVERS.map((c) => c.id);
    expect(ids).not.toContain(AGENT_ID);
    expect(ids).not.toContain(REQUESTER_ID);
    expect(ids).not.toContain(OPERATOR_ID);
  });
});

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTs(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("AC-11 no network code in src", () => {
  it("all phase-1 modules exist", () => {
    for (const m of ["threshold", "policy", "lease", "audit", "gateway", "agent", "fixtures", "probe", "demo"]) {
      expect(existsSync(join(srcDir, `${m}.ts`)), `src/${m}.ts`).toBe(true);
    }
  });

  const forbidden: Array<[string, RegExp]> = [
    ["fetch(", /\bfetch\s*\(/],
    ['from "http"', /from\s+["']http["']/],
    ['from "https"', /from\s+["']https["']/],
    ["node:http", /node:http/],
    ["node:https", /node:https/],
    ['require("http")', /require\(\s*["']https?["']\s*\)/],
    ["XMLHttpRequest", /XMLHttpRequest/],
    ["WebSocket", /\bnew\s+WebSocket\b/],
    ["node:net", /node:(net|dgram|tls)\b/],
  ];

  it("src contains at least the nine module files to scan", () => {
    expect(listTs(srcDir).length).toBeGreaterThanOrEqual(9);
  });

  it.each(forbidden)("no src file contains %s", (_label, re) => {
    const offenders = listTs(srcDir)
      .filter((f) => re.test(readFileSync(f, "utf8")))
      .map((f) => relative(srcDir, f));
    expect(offenders).toEqual([]);
  });
});
