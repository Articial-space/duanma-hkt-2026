// S7 - synthetic data only (BR-03). Course codes, titles and comments are fictional; no real person data.
import type { Approver } from "./lease.js";

export interface FeedbackBatch {
  recordId: string;
  ownerId: string;
  courseCode: string;
  text: string;
}

function batchText(courseCode: string, title: string, comments: string[]): string {
  return [`Course: ${courseCode} ${title}`, "Semester: 2026 S2", ...comments.map((c) => `Comment: ${c}`)].join("\n");
}

export const SYNTHETIC_FEEDBACK: FeedbackBatch[] = [
  {
    recordId: "fb-001",
    ownerId: "student-cohort-001",
    courseCode: "DEMO1001",
    text: batchText("DEMO1001", "Foundations of Placeholder Systems", [
      "The final exam covered topics we never practised",
      "Assignment marking took over four weeks",
      "The rubric for the group project was vague",
      "Lecture slides were clear and well organised",
      "Weekly quizzes kept me on track",
    ]),
  },
  {
    recordId: "fb-002",
    ownerId: "student-cohort-002",
    courseCode: "DEMO2002",
    text: batchText("DEMO2002", "Applied Mock Analytics", [
      "Tutorials were the most useful part of the week",
      "Office hours clashed with my other classes",
      "The weekly readings were far too long",
      "Lectures moved too fast in the second half",
      "Tutors gave quick written feedback on drafts",
    ]),
  },
  {
    recordId: "fb-003",
    ownerId: "student-cohort-003",
    courseCode: "DEMO3003",
    text: batchText("DEMO3003", "Studio in Fictional Design", [
      "Studio sessions felt rushed near the deadline",
      "More consultation slots would really help",
      "Peer review responses were slow to arrive",
      "Lab equipment was often unavailable",
      "The design brief was inspiring",
    ]),
  },
];

/** Independent human approvers: 3 -> threshold 2 (student representative, dean, quality-assurance officer). */
export const APPROVERS: Approver[] = [{ id: "student-rep" }, { id: "dean" }, { id: "qa-officer" }];

export const AGENT_ID = "ai-summariser-01";
/** The lecturer who requests a summary; NOT an approver. */
export const REQUESTER_ID = "lecturer-demo";
export const VENDOR_ID = "vendor-demo";
/** University IT admin with full database and app-server access; NOT an approver. */
export const OPERATOR_ID = "it-admin";
