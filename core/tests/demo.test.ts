import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { SYNTHETIC_FEEDBACK } from "../src/fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const coreDir = join(here, "..");
const tsxCli = join(coreDir, "node_modules", "tsx", "dist", "cli.mjs");

const WHO = [
  "University IT admin (database + server)",
  "Lecturer",
  "IT admin with forged lease",
  "AI summariser, no lease",
  "AI summariser with lease",
  "AI summariser, lease on another course",
];

let status: number | null = null;
let stdout = "";
let lines: string[] = [];

function step(n: number): string[] {
  return lines.filter((l) => l.startsWith(`[${n}]`));
}

/** Matrix rows of a step: lines carrying one of the six `who` strings and the ' | ' separators. */
function matrixRows(n: number): Array<{ who: string; line: string }> {
  const rows: Array<{ who: string; line: string }> = [];
  for (const who of WHO) {
    const hits = step(n).filter((l) => l.includes(who) && l.includes(" | "));
    expect(hits.length, `step [${n}] matrix row for "${who}"`).toBe(1);
    rows.push({ who, line: hits[0] });
  }
  return rows;
}

function resultOf(line: string): string {
  const m = /\|\s*(READ|BLOCKED)\s*$/.exec(line);
  expect(m, `line should end with a result: ${line}`).not.toBeNull();
  return (m as RegExpExecArray)[1];
}

beforeAll(() => {
  expect(existsSync(tsxCli), "local tsx must be installed").toBe(true);
  const r = spawnSync(process.execPath, [tsxCli, "src/demo.ts"], {
    cwd: coreDir,
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  status = r.status;
  stdout = (r.stdout ?? "") + "";
  lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (r.status !== 0) {
    // surface stderr in the failing assertion below
    stdout += `\n[stderr] ${r.stderr ?? ""}\n[error] ${r.error ?? ""}`;
  }
}, 120_000);

describe("AC-3 demo (src/demo.ts via tsx)", () => {
  it("exits with code 0", () => {
    expect(status, stdout.slice(-2000)).toBe(0);
  });

  it("prints steps [1] to [6], in order, and every output line is step-prefixed", () => {
    let last = -1;
    for (let n = 1; n <= 6; n++) {
      const idx = lines.findIndex((l) => l.startsWith(`[${n}]`));
      expect(idx, `step [${n}] present`).toBeGreaterThan(last);
      last = idx;
    }
    for (const l of lines) {
      expect(l).toMatch(/^\[[1-6]\]/);
    }
    // step lines are contiguous and non-decreasing
    const nums = lines.map((l) => Number(l[1]));
    expect([...nums].sort((a, b) => a - b)).toEqual(nums);
  });

  it("step 1: batches are encrypted and a ciphertext preview is shown; no feedback text leaks", () => {
    expect(step(1).join("\n")).toContain("tide-mock:v1:");
    for (const b of SYNTHETIC_FEEDBACK) {
      expect(stdout).not.toContain(b.text);
      for (const l of b.text.split(/\r?\n/).filter((x) => x.startsWith("Comment:"))) {
        expect(stdout, `comment line leaked: ${l}`).not.toContain(l.slice("Comment:".length).trim());
      }
    }
  });

  it("step 2: the AI summariser is BLOCKED on fb-001 and the probe matrix has no READ row", () => {
    const s2 = step(2).join("\n");
    expect(s2).toContain("BLOCKED");
    expect(s2).toContain("fb-001");
    for (const { line } of matrixRows(2)) expect(resultOf(line)).toBe("BLOCKED");
  });

  it("step 3: lecturer-demo requests, PENDING with one approval, signing refused, AI still BLOCKED", () => {
    const s3 = step(3).join("\n");
    expect(s3).toContain("lecturer-demo");
    expect(s3).toContain("PENDING");
    expect(s3).toContain("student-rep");
    expect(s3).toContain("BLOCKED");
    expect(s3).not.toContain("SUMMARY:");
  });

  it("step 4: ACTIVE lease, DEMO1001 theme summary for fb-001, BLOCKED for fb-002", () => {
    const s4 = step(4);
    const joined = s4.join("\n");
    expect(joined).toContain("ACTIVE");
    expect(joined).toContain("dean");
    expect(joined).toContain("fb-001");
    const summaryLines = s4.filter((l) => l.includes("SUMMARY:"));
    expect(summaryLines.length).toBe(1);
    expect(summaryLines[0]).toContain("DEMO1001");
    expect(summaryLines[0]).toContain("themes: assessment (");
    expect(summaryLines[0]).not.toContain("BLOCKED");
    expect(summaryLines[0]).not.toContain(" | ");
    expect(joined).not.toContain("DEMO2002");
    const fb2 = s4.filter((l) => l.includes("fb-002") && l.includes("BLOCKED") && !l.includes(" | "));
    expect(fb2.length).toBeGreaterThanOrEqual(1);
    for (const l of s4.filter((x) => x.includes("fb-002"))) expect(l).not.toContain("SUMMARY:");
  });

  it("step 4: the probe matrix has exactly one READ row, 'AI summariser with lease'", () => {
    const rows = matrixRows(4);
    const reads = rows.filter(({ line }) => resultOf(line) === "READ").map((r) => r.who);
    expect(reads).toEqual(["AI summariser with lease"]);
    for (const { who, line } of rows) {
      if (who !== "AI summariser with lease") expect(resultOf(line)).toBe("BLOCKED");
    }
  });

  it("step 5: clock +16 minutes, EXPIRED, AI summariser BLOCKED, matrix has no READ row", () => {
    const s5 = step(5).join("\n");
    expect(s5).toContain("EXPIRED");
    expect(s5).toContain("BLOCKED");
    expect(s5).not.toContain("SUMMARY:");
    for (const { line } of matrixRows(5)) expect(resultOf(line)).toBe("BLOCKED");
  });

  it("step 6: audit verify ok, then a tampered entry reports a broken seq", () => {
    const s6 = step(6).join("\n");
    const okIdx = s6.search(/\bok\b/i);
    const brokenIdx = s6.search(/broken/i);
    expect(okIdx).toBeGreaterThanOrEqual(0);
    expect(brokenIdx).toBeGreaterThan(okIdx);
    expect(s6).toMatch(/broken[^\n]*\d/i);
  });
});
