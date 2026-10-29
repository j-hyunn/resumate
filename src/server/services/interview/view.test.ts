import { describe, expect, it } from "vitest";
import { executionProviderOf, executionProvidersOf, groupSessions, resolveSessionRun, sessionScoreOf, toListItem, type InterviewJobRow, type SessionRow } from "./view";

const job = (over: Partial<InterviewJobRow>): InterviewJobRow => ({
  id: "j1",
  job_type: "interview_questions",
  target_id: "s1",
  status: "running",
  progress: { stage: "generate", done: 2, total: 5 },
  provider: "gemini",
  connection_tier: "free",
  error_code: null,
  retry_after: null,
  quota_resets_at: null,
  finished_at: null,
  created_at: "2026-11-03T00:00:00Z",
  ...over,
});

const session = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: "s1",
  application_project_id: "p1",
  interview_type: "job",
  question_count: 5,
  data_sufficiency: "ok",
  weak_requirement_ids: [],
  status: "in_progress",
  generation_status: "ready",
  answered_count: 0,
  unanswered_count: 0,
  submitted_at: null,
  completed_at: null,
  result_viewed_at: null,
  abandoned_at: null,
  last_activity_at: null,
  created_at: "2026-11-03T00:00:00Z",
  score_status: null,
  score_value: null,
  score_max: null,
  score_method_version: null,
  score_rationale: null,
  score_counted_count: null,
  question_provider: null,
  question_model: null,
  evaluation_provider: null,
  evaluation_model: null,
  ...over,
});

describe("execution provider (DM 2.7 v4.1)", () => {
  it("question provider before evaluation; evaluation once started; both when they differ", () => {
    expect(executionProviderOf(session())).toBeNull();
    expect(executionProviderOf(session({ question_provider: "gemini", question_model: "g" }))).toEqual({ kind: "single", role: "question", provider: "gemini", model: "g" });
    expect(executionProviderOf(session({ question_provider: "gemini", evaluation_provider: "gemini", evaluation_model: "g2" }))).toEqual({
      kind: "single",
      role: "evaluation",
      provider: "gemini",
      model: "g2",
    });
    const split = executionProviderOf(session({ question_provider: "gemini", question_model: "g", evaluation_provider: "openai", evaluation_model: "o" }));
    expect(split).toEqual({ kind: "split", question: { provider: "gemini", model: "g" }, evaluation: { provider: "openai", model: "o" } });
    expect(executionProvidersOf(split)).toEqual(["gemini", "openai"]);
  });
});

describe("resolveSessionRun (leftover rule)", () => {
  it("generating with a live job shows progress; with no live job reads failed + that job's failure", () => {
    const live = resolveSessionRun(session({ generation_status: "generating" }), [job({})]);
    expect(live.generationStatus).toBe("generating");
    expect(live.activeJob).toMatchObject({ jobId: "j1", jobType: "interview_questions", progress: { stage: "generate", done: 2, total: 5 } });

    const ended = resolveSessionRun(session({ generation_status: "generating" }), [job({ status: "failed", error_code: "rate_limited", retry_after: "2026-11-03T01:00:00Z" })]);
    expect(ended.generationStatus).toBe("failed");
    expect(ended.failure).toMatchObject({ code: "rate_limited", jobId: "j1", jobType: "interview_questions" });

    const succeededWithoutComplete = resolveSessionRun(session({ generation_status: "generating" }), [job({ status: "succeeded" })]);
    expect(succeededWithoutComplete.failure).toMatchObject({ code: "stalled" });
  });

  it("evaluating with no live evaluation job reads evaluation_failed", () => {
    const run = resolveSessionRun(session({ status: "evaluating", submitted_at: "x" }), [job({ job_type: "interview_evaluation", status: "failed", error_code: "key_invalid" })]);
    expect(run.status).toBe("evaluation_failed");
    expect(run.failure).toMatchObject({ code: "key_invalid", jobType: "interview_evaluation" });
    const live = resolveSessionRun(session({ status: "evaluating" }), [job({ job_type: "interview_evaluation", status: "queued" })]);
    expect(live.status).toBe("evaluating");
    expect(live.activeJob?.jobType).toBe("interview_evaluation");
  });
});

describe("scores and lists", () => {
  it("C-17: null before submission; no-answers flag for not_scored with every question unanswered", () => {
    expect(sessionScoreOf(session()).status).toBeNull();
    expect(sessionScoreOf(session({ score_status: "not_scored", unanswered_count: 5 })).noAnswers).toBe(true);
    expect(sessionScoreOf(session({ score_status: "pending_method", score_counted_count: 3 }))).toMatchObject({ status: "pending_method", countedCount: 3, noAnswers: false });
  });

  it("S-37 grouping: in progress first, abandoned last, newest first; new-result flag", () => {
    const items = [
      toListItem(session({ id: "a", status: "abandoned", created_at: "2026-11-03T03:00:00Z" }), "P", []),
      toListItem(session({ id: "b", status: "completed", submitted_at: "x", created_at: "2026-11-03T01:00:00Z" }), "P", []),
      toListItem(session({ id: "c", status: "in_progress", created_at: "2026-11-02T00:00:00Z" }), "P", []),
      toListItem(session({ id: "d", status: "completed", submitted_at: "x", result_viewed_at: "y", created_at: "2026-11-03T02:00:00Z" }), "P", []),
    ];
    const g = groupSessions(items);
    expect(g.inProgress.map((s) => s.id)).toEqual(["c"]);
    expect(g.sessions.map((s) => s.id)).toEqual(["d", "b"]);
    expect(g.abandoned.map((s) => s.id)).toEqual(["a"]);
    expect(items.find((s) => s.id === "b")!.isNewResult).toBe(true);
    expect(items.find((s) => s.id === "d")!.isNewResult).toBe(false);
  });
});
