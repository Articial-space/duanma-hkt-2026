// S6 mock summariser, pure part (no imports): usable on the server and in the browser (S12b runs it in
// the AI operator's browser). Re-exported by ./agent.ts, which adds the gateway-backed SummaryAgent.
// The summary names the course code, the comment count and the top themes only; never comment text.

const MAX_SUMMARY = 280;
const TOP_THEMES = 3;

export type ThemeName = "assessment" | "feedback" | "pace" | "materials" | "labs" | "support";

/** Theme name -> lowercase keywords (matched as case-insensitive substrings of Comment lines). */
export const THEME_KEYWORDS: Readonly<Record<ThemeName, readonly string[]>> = Object.freeze({
  assessment: Object.freeze(["assessment", "exam", "assignment", "marking", "grading", "rubric"]),
  feedback: Object.freeze(["feedback", "response", "reply"]),
  pace: Object.freeze(["pace", "fast", "rushed", "slow"]),
  materials: Object.freeze(["slides", "materials", "readings", "notes"]),
  labs: Object.freeze(["lab", "labs", "tutorial", "tutorials"]),
  support: Object.freeze(["support", "help", "consultation", "office hours"]),
});

function courseCodeOf(lines: string[]): string {
  const course = lines.find((l) => l.startsWith("Course:"));
  if (!course) return "";
  const m = /^Course:\s*(\S+)/.exec(course);
  return m ? m[1] : "";
}

export function mockSummarize(plaintext: string): string {
  const lines = plaintext.split(/\r?\n/);
  const code = courseCodeOf(lines);
  const comments = lines.filter((l) => l.startsWith("Comment:")).map((l) => l.toLowerCase());

  const counts = (Object.keys(THEME_KEYWORDS) as ThemeName[]).map((theme) => ({
    theme,
    n: comments.filter((c) => THEME_KEYWORDS[theme].some((k) => c.includes(k))).length,
  }));
  const top = counts
    .filter((c) => c.n >= 1)
    .sort((a, b) => b.n - a.n || (a.theme < b.theme ? -1 : a.theme > b.theme ? 1 : 0))
    .slice(0, TOP_THEMES);
  const themes = top.length > 0 ? top.map((t) => `${t.theme} (${t.n})`).join(", ") : "none";

  return `SUMMARY: ${code} — ${comments.length} comments; themes: ${themes}`.slice(0, MAX_SUMMARY);
}
