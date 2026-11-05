import { describe, expect, it } from "vitest";
import { DETACHED_SESSION_FALLBACK_NAME, detachedSessionName, executionProviderOf, executionProvidersOf, groupSessions, resolveSessionRun, sessionProjectName, sessionScoreOf, toListItem, toSessionHeader, type InterviewJobRow, type SessionRow } from "./view";
import { foldInterviewProgress } from "./progress";

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
  company_name_snapshot: null,
  position_title_snapshot: null,
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

describe("resolveSessionRun — generation failures of the old raw text (DM 2.6.1)", () => {
  const failed = session({ generation_status: "failed" });
  const failedJob = job({ status: "failed", error_code: "not_a_jd", finished_at: "2026-11-01T00:00:00Z" });
  const EDITED = "2026-11-02T00:00:00Z";

  it("a job failed before the edit: no failure, `raw_text_edited`", () => {
    expect(resolveSessionRun(failed, [failedJob], EDITED)).toMatchObject({ generationStatus: "failed", failure: null, failureHidden: "raw_text_edited" });
  });

  it("a job failed after the edit, or never edited: the failure as before", () => {
    expect(resolveSessionRun(failed, [{ ...failedJob, finished_at: "2026-11-03T00:00:00Z" }], EDITED)).toMatchObject({ failure: { code: "not_a_jd" }, failureHidden: null });
    expect(resolveSessionRun(failed, [failedJob])).toMatchObject({ failure: { code: "not_a_jd" }, failureHidden: null });
  });

  it("edited and no job left to compare: `job_gone`; never edited: stalled as before", () => {
    expect(resolveSessionRun(failed, [], EDITED)).toMatchObject({ failure: null, failureHidden: "job_gone" });
    expect(resolveSessionRun(failed, [])).toMatchObject({ failure: { code: "stalled" }, failureHidden: null });
  });

  it("an evaluation failure is never hidden", () => {
    const evaluation = job({ job_type: "interview_evaluation", status: "failed", error_code: "timeout", finished_at: "2026-11-01T00:00:00Z" });
    expect(resolveSessionRun(session({ status: "evaluation_failed" }), [evaluation], EDITED)).toMatchObject({ failure: { code: "timeout" }, failureHidden: null });
  });
});

describe("toListItem grading (Q53-6)", () => {
  it("carries the decision; none by default", () => {
    expect(toListItem(session(), "p", []).grading).toEqual({ kind: "none" });
    expect(toListItem(session(), "p", [], { kind: "resummarize" }).grading).toEqual({ kind: "resummarize" });
  });
});

describe("detached sessions (R11 OD-I6)", () => {
  it("name rule: both snapshots → 회사 – 포지션, one → that, none → 삭제된 자기소개서", () => {
    expect(detachedSessionName({ company_name_snapshot: "토스", position_title_snapshot: "백엔드" })).toBe("토스 – 백엔드");
    expect(detachedSessionName({ company_name_snapshot: " 토스 ", position_title_snapshot: null })).toBe("토스");
    expect(detachedSessionName({ company_name_snapshot: null, position_title_snapshot: "백엔드" })).toBe("백엔드");
    expect(detachedSessionName({ company_name_snapshot: "  ", position_title_snapshot: null })).toBe(DETACHED_SESSION_FALLBACK_NAME);
  });

  it("sessionProjectName uses the project name while attached, the snapshot once detached", () => {
    const names = new Map([["p1", "토스 지원"]]);
    expect(sessionProjectName(session(), names)).toBe("토스 지원");
    expect(sessionProjectName(session({ application_project_id: null, company_name_snapshot: "토스", position_title_snapshot: "백엔드" }), names)).toBe("토스 – 백엔드");
    expect(sessionProjectName(session({ application_project_id: "gone" }), names)).toBe("자기소개서");
  });

  it("list item and header carry readOnly", () => {
    const detached = session({ application_project_id: null, status: "completed", submitted_at: "x", company_name_snapshot: "토스", position_title_snapshot: null });
    expect(toListItem(detached, "토스", [])).toMatchObject({ applicationProjectId: null, readOnly: true });
    expect(toListItem(session(), "P", [])).toMatchObject({ applicationProjectId: "p1", readOnly: false });
    const run = resolveSessionRun(detached, []);
    expect(toSessionHeader(detached, "토스", run)).toMatchObject({ applicationProjectId: null, readOnly: true });
  });

  it("interview progress skips detached sessions", () => {
    const out = foldInterviewProgress(
      [
        { id: "a", application_project_id: "p1", status: "completed" },
        { id: "b", application_project_id: null, status: "completed" },
      ],
      new Map(),
    );
    expect([...out.keys()]).toEqual(["p1"]);
    expect(out.get("p1")).toEqual({ interviewCount: 1, interviewInProgress: false });
  });
});
