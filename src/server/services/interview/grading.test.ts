import { beforeEach, describe, expect, it } from "vitest";
import type { UserSupabaseClient } from "@/server/db/types";
import type { ProviderContext } from "@/server/jobs/provider-context";
import { fakeSupabase, type FakeDb } from "@/test/fake-supabase";
import { loadGradingDecisions, toGradingDecision } from "./grading";
import { getInterviewResult } from "./read";
import { retryInterviewEvaluation, type InterviewStartDeps } from "./start";

/** DM 2.7.1 판정표 → what the route (Q53-3 · 5) and S-22 (Q53-10) do with it. The table itself is pgTAP's. */

const SESSION = "00000000-0000-4000-8000-0000000000cc";
const PROJECT = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-000000000001";
const PAID: ProviderContext = { provider: "anthropic", connectionTier: "paid", keyStatus: "valid" };

const decisionRow = (over: Record<string, unknown> = {}) => ({
  session_id: SESSION,
  status: "evaluation_failed",
  decision: "none",
  cause: null,
  regrade_target_count: 0,
  succeeded_count: 0,
  answer_input_cause: null,
  summary_error_code: null,
  ...over,
});

describe("toGradingDecision", () => {
  it("maps each decision; unknown → none; cause only from the known codes", () => {
    expect(toGradingDecision({ decision: "regrade", cause: null, regrade_target_count: 2 })).toEqual({ kind: "regrade", count: 2 });
    expect(toGradingDecision({ decision: "resummarize", cause: null, regrade_target_count: 0 })).toEqual({ kind: "resummarize" });
    expect(toGradingDecision({ decision: "input_only", cause: "safety_blocked", regrade_target_count: 0 })).toEqual({ kind: "input_only", cause: "safety_blocked" });
    expect(toGradingDecision({ decision: "input_only", cause: null, regrade_target_count: 0 })).toEqual({ kind: "input_only", cause: null });
    expect(toGradingDecision({ decision: "input_only", cause: "nope", regrade_target_count: 0 })).toEqual({ kind: "input_only", cause: null });
    expect(toGradingDecision({ decision: "none", cause: null, regrade_target_count: 0 })).toEqual({ kind: "none" });
  });
});

describe("loadGradingDecisions", () => {
  it("no ids → no call; ids deduplicated; absent sessions stay absent", async () => {
    const db = fakeSupabase({}, () => [decisionRow({ decision: "regrade", regrade_target_count: 1 })]);
    expect((await loadGradingDecisions(db.client as UserSupabaseClient, [])).size).toBe(0);
    expect(db.rpcCalls).toHaveLength(0);
    const out = await loadGradingDecisions(db.client as UserSupabaseClient, [SESSION, SESSION, PROJECT]);
    expect(db.rpcCalls[0]).toEqual({ name: "get_interview_grading_decisions", args: { p_session_ids: [SESSION, PROJECT] } });
    expect(out.get(SESSION)).toMatchObject({ regradeTargetCount: 1, decision: { kind: "regrade", count: 1 } });
    expect(out.has(PROJECT)).toBe(false);
  });
});

describe("retryInterviewEvaluation", () => {
  let db: FakeDb;
  let jobsStarted: number;
  let connected: boolean;

  function deps(row: Record<string, unknown> | null): InterviewStartDeps {
    db = fakeSupabase(
      {
        interview_sessions: [{ id: SESSION, application_project_id: PROJECT, status: "evaluation_failed", generation_status: "ready", submitted_at: "2026-11-01T00:00:00Z" }],
        ai_jobs: [],
      },
      () => (row ? [row] : []),
    );
    return {
      userId: USER,
      user: db.client as UserSupabaseClient,
      providerContext: { forUser: async () => (connected ? PAID : null), peekActive: async () => (connected ? PAID : null) },
      runner: {
        startJob: async () => {
          jobsStarted++;
          return { jobId: "job-new", reused: false, inProgress: false };
        },
      },
      promptVersions: { questions: "q", evaluation: "e" },
    };
  }

  beforeEach(() => {
    jobsStarted = 0;
    connected = true;
  });

  it.each([
    ["regrade", { decision: "regrade", regrade_target_count: 2 }],
    ["resummarize", { decision: "resummarize", succeeded_count: 1 }],
  ])("%s starts a new job", async (_name, row) => {
    await expect(retryInterviewEvaluation(deps(decisionRow(row)), SESSION)).resolves.toEqual({ sessionId: SESSION, jobId: "job-new", inProgress: false });
    expect(jobsStarted).toBe(1);
  });

  it("input_only → 409 with the cause, no job, even without a key", async () => {
    connected = false;
    await expect(retryInterviewEvaluation(deps(decisionRow({ decision: "input_only", cause: "input_too_long" })), SESSION)).rejects.toMatchObject({
      code: "interview_evaluation_input_only",
      status: 409,
      details: { cause: "input_too_long" },
    });
    expect(jobsStarted).toBe(0);
  });

  it("none → 409 not_retryable, no job", async () => {
    await expect(retryInterviewEvaluation(deps(decisionRow({ decision: "none" })), SESSION)).rejects.toMatchObject({ code: "interview_evaluation_not_retryable", status: 409 });
    expect(jobsStarted).toBe(0);
  });

  it("a retryable decision still needs a connection", async () => {
    connected = false;
    await expect(retryInterviewEvaluation(deps(decisionRow({ decision: "regrade", regrade_target_count: 1 })), SESSION)).rejects.toMatchObject({ code: "ai_not_connected", status: 409 });
    expect(jobsStarted).toBe(0);
  });

  it("an evaluation already running is followed before any decision", async () => {
    const d = deps(decisionRow({ decision: "none" }));
    db.tables.ai_jobs!.push({
      id: "job-live",
      job_type: "interview_evaluation",
      target_type: "interview_session",
      target_id: SESSION,
      status: "running",
      progress: {},
      provider: "anthropic",
      connection_tier: "paid",
      created_at: "2026-11-01T00:00:00Z",
    });
    await expect(retryInterviewEvaluation(d, SESSION)).resolves.toEqual({ sessionId: SESSION, jobId: "job-live", inProgress: true });
    expect(db.rpcCalls).toHaveLength(0);
  });
});

describe("getInterviewResult", () => {
  const ANSWER = "00000000-0000-4000-8000-2000000000a1";
  const QUESTION = "00000000-0000-4000-8000-1000000000a1";

  function setup(status: string, decision: Record<string, unknown>, over: { viewed?: string | null; changed?: boolean } = {}) {
    return fakeSupabase(
      {
        interview_sessions: [
          {
            id: SESSION,
            application_project_id: PROJECT,
            interview_type: "job",
            question_count: 1,
            data_sufficiency: "ok",
            status,
            generation_status: "ready",
            answered_count: 1,
            unanswered_count: 0,
            submitted_at: "2026-11-01T00:00:00Z",
            result_viewed_at: over.viewed ?? null,
            created_at: "2026-11-01T00:00:00Z",
            question_provider: "anthropic",
            evaluation_provider: "anthropic",
          },
        ],
        interview_questions: [{ id: QUESTION, session_id: SESSION, sequence: 1, source_kind: "project_deep_dive", anchor: "general", question_text: "Q" }],
        interview_answers: [{ id: ANSWER, session_id: SESSION, question_id: QUESTION, answer_text: "A", status: "submitted", score_status: "not_scored", updated_at: "2026-11-01T00:00:00Z" }],
        answer_evaluations: [{ id: "e1", session_id: SESSION, answer_id: ANSWER, status: "failed", error_code: "safety_blocked", result: null }],
        session_feedbacks: [],
        ai_jobs: [],
        application_projects: [{ id: PROJECT, name: "n", job_descriptions: null }],
        evidence_links: [],
      },
      (name) => {
        if (name === "mark_interview_result_viewed") return { changed: over.changed === true, result_viewed_at: over.changed ? "2026-11-02T00:00:00Z" : null };
        if (name === "get_interview_grading_decisions") return [decisionRow({ status, ...decision })];
        if (name === "get_interview_question_reveals") return [];
        throw new Error(`unexpected ${name}`);
      },
    );
  }
  const read = (db: FakeDb) => getInterviewResult(db.client as UserSupabaseClient, { sessionId: SESSION });
  const marks = (db: FakeDb) => db.rpcCalls.filter((c) => c.name === "mark_interview_result_viewed").length;

  it("evaluation_failed + input_only: asks the view RPC (Q53-10), no retry button, cause per decision and per answer", async () => {
    const db = setup("evaluation_failed", { decision: "input_only", cause: "safety_blocked" }, { changed: true });
    const view = await read(db);
    expect(marks(db)).toBe(1);
    expect(view.firstView).toBe(true);
    expect(view.grading).toEqual({ kind: "input_only", cause: "safety_blocked" });
    expect(view.canRetryEvaluation).toBe(false);
    expect(view.items[0]).toMatchObject({ evaluationFailed: true, evaluationErrorCode: "safety_blocked" });
  });

  it("evaluation_failed + regrade / resummarize: the RPC keeps the mark (changed false), the button shows", async () => {
    for (const decision of [{ decision: "regrade", regrade_target_count: 1 }, { decision: "resummarize", succeeded_count: 1 }]) {
      const db = setup("evaluation_failed", decision);
      const view = await read(db);
      expect(marks(db)).toBe(1);
      expect(view.firstView).toBe(false);
      expect(view.canRetryEvaluation).toBe(true);
    }
  });

  it("completed with only input-caused failures: no button", async () => {
    const view = await read(setup("completed", { decision: "input_only", cause: "input_too_long" }, { changed: true }));
    expect(view.canRetryEvaluation).toBe(false);
  });

  it("completed with re-grade targets: the button shows", async () => {
    const view = await read(setup("completed", { decision: "regrade", regrade_target_count: 1 }));
    expect(view.grading).toEqual({ kind: "regrade", count: 1 });
    expect(view.canRetryEvaluation).toBe(true);
  });

  it("already viewed or still evaluating: no view RPC", async () => {
    const viewed = setup("completed", { decision: "none" }, { viewed: "2026-11-01T01:00:00Z" });
    await read(viewed);
    expect(marks(viewed)).toBe(0);
    const evaluating = setup("evaluating", { decision: "none" });
    await read(evaluating);
    expect(marks(evaluating)).toBe(0);
  });
});
