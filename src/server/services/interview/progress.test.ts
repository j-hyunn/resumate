import { describe, expect, it } from "vitest";
import { countsAsInterview } from "@/lib/data/labels";
import { countsTowardInterviews, foldInterviewProgress } from "./progress";

describe("interview progress (UQ-700, Q53-9)", () => {
  it("excludes abandoned sessions with no saved question, counts the rest", () => {
    const sessions = [
      { id: "s1", application_project_id: "p", status: "completed" },
      { id: "s2", application_project_id: "p", status: "abandoned" }, // 0 questions → excluded
      { id: "s3", application_project_id: "p", status: "abandoned" }, // 2 questions → counted
      { id: "s4", application_project_id: "p", status: "in_progress" }, // 0 questions, still counted
      { id: "s5", application_project_id: "q", status: "abandoned" },
    ];
    const out = foldInterviewProgress(sessions, new Map([["s3", 2]]));
    expect(out.get("p")).toEqual({ interviewCount: 3, interviewInProgress: true });
    expect(out.get("q")).toEqual({ interviewCount: 0, interviewInProgress: false });
  });

  it("agrees with the UI rule countsAsInterview (S-31 and the mock)", () => {
    for (const status of ["in_progress", "completed", "evaluation_failed", "abandoned", "evaluating"]) {
      for (const n of [0, 1, 5]) expect(countsTowardInterviews(status, n)).toBe(countsAsInterview({ status }, n));
    }
  });
});
