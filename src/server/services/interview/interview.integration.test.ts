import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateApplicationProjectInput, MoveApplicationStageInput } from "@/lib/contracts/application";
import { AppError } from "@/lib/contracts/errors";
import { KO_BACKEND } from "@/server/ai/__fixtures__/AI-01/jds";
import { ProviderError } from "@/server/ai/errors";
import type { Llm } from "@/server/ai/llm";
import type { ProviderAdapter } from "@/server/ai/providers/types";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import { resetServerEnvCache } from "@/server/env";
import { productionInterviewPipelines } from "@/server/jobs/interview";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext } from "@/server/jobs/provider-context";
import { createJobRunner } from "@/server/jobs/runner";
import { createSupabaseJobStore } from "@/server/jobs/supabase-store";
import { createSupabaseUsageStore } from "@/server/jobs/supabase-usage";
import { loadCareerRows } from "@/server/ai/context-pack/career-rows";
import { createJdExtractionDb } from "@/server/services/application/db";
import { ensureJdExtracted } from "@/server/services/application/extraction";
import { loadProgress } from "@/server/services/application/read";
import { createApplicationProject, deleteApplicationProject, moveApplicationStage } from "@/server/services/application/write";
import { productionJdExtractorForTests } from "@/test/jd-extraction-fakes";
import { createScriptedAdapter, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";
import { createInterviewStore } from "./db";
import { createInterviewEvaluationJobDefinition, createInterviewQuestionsJobDefinition, type InterviewJobDeps } from "./job";
import { getAnswerSheet, getInterviewPrep, getInterviewResult, listInterviewSessions } from "./read";
import { retryInterviewEvaluation, retryInterviewQuestions, startInterviewSession, submitInterviewSession, type InterviewStartDeps } from "./start";
import { abandonInterviewSession, deleteInterviewSession, saveInterviewAnswer } from "./write";

/**
 * S8 end-to-end against the local stack (plan API 6 "로컬 DB 통합"): readiness
 * 422 → culture-fit start (D-30 extraction + AI-05 job, questions + empty
 * answers) → 409 in progress → board popup session id → answer sheet without
 * hidden columns → auto-save + RLS edit guard → submit (one blank =
 * unanswered) → AI-06 ×2 + AI-07 job → result with revealed intent, chips,
 * pending scores, first-view mark → lists / progress → other user → delete
 * session, project cascade. Real AI-01 / 05 / 06 / 07 pipelines, scripted
 * provider. Skips without the stack or the S8 tables.
 */

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "interview_sessions")) : false;

type Client = SupabaseClient<Database>;
const FAKE_KEY = "sk-ant-FAKE-interview-integration-0000";
const ANSWER = "저는 의견이 다르면 먼저 상대 이야기를 듣는 편입니다.";

function lazyAdapter(queue: ScriptedResponse[]): ProviderAdapter {
  const one = async (): Promise<ProviderAdapter> => {
    const next = queue.shift();
    if (!next) throw new Error("lazy adapter: no response left");
    return createScriptedAdapter("anthropic", [next], Date.now).adapter;
  };
  return {
    id: "anthropic",
    async *stream(call) {
      yield* (await one()).stream(call);
    },
    async complete(call) {
      return (await one()).complete(call);
    },
    verify: async () => ({ ok: true, usage: { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: null, usageSource: "provider_reported" } }),
  };
}

function q(over: Record<string, unknown>) {
  return { order: 1, source_kind: "values", anchor: "general", text: "질문", intent: "의도", focus_criteria: ["specificity"], target_requirement_refs: [], target_gap_requirement_refs: [], evidence: [], good_answer_signals: ["본인 역할 구분"], ...over };
}

const AI05_OUTPUT = {
  schema_version: 2,
  interview_type: "culture_fit",
  weak_requirement_refs: [],
  questions: [
    q({ order: 1, source_kind: "values", text: "일의 우선순위를 정할 때 가장 중요하게 보는 것은 무엇인가요?", intent: "가치 기준 확인" }),
    q({ order: 2, source_kind: "failure_growth", text: "실수한 뒤 바꾼 일하는 방식이 있나요?", intent: "실패 후 성장 확인" }),
    q({ order: 3, source_kind: "conflict", text: "동료와 의견이 부딪쳤을 때 어떻게 하시나요?", intent: "갈등 해결 방식 확인" }),
  ],
  data_sufficiency: { level: "none", hints: [] },
};

function criteria() {
  return [
    { key: "specificity", grade: "poor", reason: "이유", answer_quotes: [], missing: "구체 사례" },
    { key: "intent_fit", grade: "fair", reason: "이유", answer_quotes: ["먼저 상대 이야기를 듣는 편입니다"], missing: null },
    { key: "structure", grade: "fair", reason: "이유", answer_quotes: ["먼저 상대 이야기를 듣는 편입니다"], missing: null },
    { key: "job_relevance", grade: "not_applicable", reason: "이유", answer_quotes: [], missing: null },
  ];
}

const AI06_OUTPUT = {
  schema_version: 2,
  question_ref: "Q-1",
  answer_ref: "ANS-1",
  criteria: criteria(),
  strengths: [{ text: "경청하는 태도를 밝혔습니다.", answer_quotes: ["먼저 상대 이야기를 듣는 편입니다"] }],
  improvements: [{ text: "구체 사례를 넣으세요.", how: "언제, 누구와, 무엇을 순서로.", related_criteria: ["specificity"], evidence: [] }],
  intent_reveal: "갈등을 다루는 방식을 보려는 질문이었습니다.",
  model_answer: {
    text: "저는 의견이 다르면 먼저 상대 이야기를 듣습니다. [사례 입력 필요]",
    evidence: [{ source_type: "interview_answer", ref: "ANS-1", field: null, quote: "의견이 다르면 먼저 상대 이야기를 듣는 편입니다" }],
    placeholders: [{ token: "[사례 입력 필요]", hint: "의견이 갈렸던 실제 상황" }],
    suggestions_if_true: [],
  },
  consistency_notes: [],
  score: { status: "pending_method", value: null, max: null, method_version: null, rationale: null },
};

const AI07_OUTPUT = {
  schema_version: 2,
  headline: "경청하는 태도는 좋지만 구체 사례가 필요합니다.",
  overall_strengths: [],
  overall_weaknesses: [],
  unanswered_note: null,
  next_practice: [],
  session_score: { status: "pending_method", value: null, max: null, method_version: null, rationale: null, counted_questions: 2, unanswered_count: 1 },
};

describe.skipIf(!ready)("interviews (local stack)", () => {
  const s = stack!;
  let admin: Client;
  let user: Client;
  let other: Client;
  let userId = "";
  let otherId = "";
  const logs: string[] = [];
  const queue: ScriptedResponse[] = [];
  const project = crypto.randomUUID();
  let sessionId = "";

  async function newUser(prefix: string): Promise<{ id: string; client: Client }> {
    const email = `${prefix}-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.code}`);
    const client = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.code}`);
    return { id: data.user.id, client };
  }

  function harness(uid = userId, client = user) {
    const scheduled: (() => Promise<void>)[] = [];
    const adapter = lazyAdapter(queue);
    const createLlm = (input: Parameters<ReturnType<typeof scriptedLlmFactory>>[0]): Llm => scriptedLlmFactory(adapter, Date.now)(input);
    const keySource = createStaticKeySource(FAKE_KEY, () => new ProviderError("key_missing"));
    const providerContext = createStaticProviderContext({ provider: "anthropic", connectionTier: "paid", keyStatus: "valid" });
    const log = (event: string, fields: Record<string, unknown>) => void logs.push(JSON.stringify({ event, ...fields }));
    const deps: InterviewJobDeps<unknown, unknown> = {
      pipelines: productionInterviewPipelines as InterviewJobDeps<unknown, unknown>["pipelines"],
      storeFor: createInterviewStore,
      loadCareerRows,
      ensureJd: (ctx, id) =>
        ensureJdExtracted(
          {
            userId: ctx.userId,
            jds: createJdExtractionDb(ctx.db, ctx.db),
            store: createSupabaseJobStore(ctx.db),
            usage: createSupabaseUsageStore(ctx.db),
            providerContext: createStaticProviderContext({ provider: ctx.provider, connectionTier: ctx.connectionTier, keyStatus: "valid" }),
            keySource,
            keyStatus: createRecordingKeyStatusReporter(),
            runGate: null,
            createLlm,
            extract: productionJdExtractorForTests,
            log,
          },
          id,
          { signal: ctx.signal },
        ),
      log,
    };
    const definitions = { interview_questions: createInterviewQuestionsJobDefinition(deps), interview_evaluation: createInterviewEvaluationJobDefinition(deps) };
    const runner = createJobRunner<Llm>({
      forUser: (id) => {
        const db = createAiWriterClient(id);
        return { db, store: createSupabaseJobStore(db), usage: createSupabaseUsageStore(db), keySource, keyStatus: createRecordingKeyStatusReporter() };
      },
      providerContext,
      createLlm,
      settleLlm: (llm, ms) => llm.settle(ms),
      getDefinition: (t) => (definitions as Record<string, (typeof definitions)["interview_questions"]>)[t],
      schedule: (task) => void scheduled.push(task),
      continueJob: async () => {},
      log,
    });
    const startDeps: InterviewStartDeps = { userId: uid, user: client, providerContext, runner, promptVersions: { questions: "q", evaluation: "e" } };
    async function drain() {
      while (scheduled.length) await scheduled.shift()!();
    }
    return { startDeps, drain };
  }

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", s.url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", s.anonKey);
    vi.stubEnv("SUPABASE_JWT_SECRET", s.jwtSecret);
    vi.stubEnv("CRON_SECRET", "test-cron-secret-0000");
    resetServerEnvCache();
    for (const m of ["info", "warn", "error", "log"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeAll(async () => {
    admin = createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    ({ id: userId, client: user } = await newUser("interview"));
    ({ id: otherId, client: other } = await newUser("interview-other"));
    await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: project, rawText: KO_BACKEND.raw }));
  });

  afterAll(async () => {
    for (const id of [userId, otherId]) {
      if (!id) continue;
      await admin.from("ai_usage_records").delete().eq("user_id", id);
      await admin.from("ai_jobs").delete().eq("user_id", id);
      await admin.auth.admin.deleteUser(id);
    }
    resetServerEnvCache();
  });

  it("job interview without complete career → 422 readiness, no session, no job", async () => {
    const h = harness();
    const out = await startInterviewSession(h.startDeps, project, { interviewType: "job", questionCount: 5 });
    expect(out.kind).toBe("insufficient_data");
    expect((await admin.from("interview_sessions").select("id").eq("user_id", userId)).data).toEqual([]);
    expect((await admin.from("ai_jobs").select("id").eq("user_id", userId)).data).toEqual([]);
  });

  it("culture fit start: D-30 extraction + AI-05 → 3 questions with empty answers, provider recorded", async () => {
    queue.push({ json: KO_BACKEND.output }, { json: AI05_OUTPUT });
    const h = harness();
    const out = await startInterviewSession(h.startDeps, project, { interviewType: "culture_fit", questionCount: 3 });
    if (out.kind !== "started") throw new Error("not started");
    expect(out.data.dataSufficiency).toBe("none");
    sessionId = out.data.sessionId;
    await h.drain();
    expect(queue).toHaveLength(0);
    const job = await admin.from("ai_jobs").select("status, job_type, target_type, target_id, error_code").eq("id", out.data.jobId).single();
    expect(job.data).toMatchObject({ status: "succeeded", job_type: "interview_questions", target_type: "interview_session", target_id: sessionId });
    const session = await admin
      .from("interview_sessions")
      .select("generation_status, question_provider, status, question_validation_report, question_usage")
      .eq("id", sessionId)
      .single();
    expect(session.data).toMatchObject({ generation_status: "ready", question_provider: "anthropic", status: "in_progress" });
    // R1 A22: the set-level validation report and usage are stored on the session (counts only).
    expect(session.data!.question_validation_report).toMatchObject({ attempts: 1 });
    expect(session.data!.question_usage).toEqual(expect.objectContaining({ inputTokens: expect.any(Number) }));
    expect((await admin.from("interview_answers").select("id").eq("session_id", sessionId)).data).toHaveLength(3);
  });

  it("second start → 409 interview_in_progress with the session id; board popup carries it", async () => {
    const h = harness();
    const err = await startInterviewSession(h.startDeps, project, { interviewType: "job", questionCount: 5 }).catch((e: unknown) => e);
    // Job readiness is checked first for 직무; culture fit reaches the in-progress check.
    void err;
    const err2 = await startInterviewSession(h.startDeps, project, { interviewType: "culture_fit", questionCount: 3 }).catch((e: unknown) => e);
    expect(err2).toBeInstanceOf(AppError);
    expect(err2).toMatchObject({ code: "interview_in_progress", status: 409, details: { sessionId } });

    const moved = await moveApplicationStage(user, MoveApplicationStageInput.parse({ id: project, toStage: "culture_fit_interview" }));
    expect(moved.interviewPrompt).toMatchObject({ interviewType: "culture_fit", inProgressSessionId: sessionId, inProgressSession: { sessionId, questionCount: 3, answeredCount: 0 } });
  });

  it("answer sheet: no hidden columns; the user session cannot select intent / good_answer_signals", async () => {
    const sheet = await getAnswerSheet(user, { sessionId });
    expect(sheet.items).toHaveLength(3);
    expect(sheet.editable).toBe(true);
    expect(sheet.canSubmit).toBe(true);
    expect(JSON.stringify(sheet)).not.toContain("가치 기준 확인");
    expect(JSON.stringify(sheet)).not.toContain("본인 역할 구분");
    const hidden = await user.from("interview_questions").select("intent").eq("session_id", sessionId);
    expect(hidden.error).not.toBeNull();
    const signals = await user.from("interview_questions").select("good_answer_signals").eq("session_id", sessionId);
    expect(signals.error).not.toBeNull();
    // Reveals refuse before submission.
    const reveals = await user.rpc("get_interview_question_reveals", { p_session_id: sessionId });
    expect(reveals.error?.message).toBe("interview_not_submitted");
  });

  it("auto-save two answers (third blank) → answered_count; other user can't read or write", async () => {
    const sheet = await getAnswerSheet(user, { sessionId });
    const [a1, a2] = sheet.items.map((i) => i.answer!.id);
    const r1 = await saveInterviewAnswer(user, { answerId: a1!, answerText: ANSWER });
    await saveInterviewAnswer(user, { answerId: a2!, answerText: ANSWER });
    expect(r1.sessionId).toBe(sessionId);
    const after = await getAnswerSheet(user, { sessionId });
    expect(after.session.answeredCount).toBe(2);
    await expect(getAnswerSheet(other, { sessionId })).rejects.toMatchObject({ code: "not_found" });
    await expect(saveInterviewAnswer(other, { answerId: a1!, answerText: "hack" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("submit → unanswered blank, AI-06 ×2 + AI-07 → completed; result reveals intent with pending scores", async () => {
    queue.push({ json: AI06_OUTPUT }, { json: AI06_OUTPUT }, { json: AI07_OUTPUT });
    const h = harness();
    const submitted = await submitInterviewSession(h.startDeps, sessionId);
    expect(submitted).toMatchObject({ status: "evaluating", answeredCount: 2, unansweredCount: 1 });
    expect(submitted.jobId).not.toBeNull();
    await h.drain();
    expect(queue).toHaveLength(0);
    const job = await admin.from("ai_jobs").select("status, error_code").eq("id", submitted.jobId!).single();
    expect(job.data).toMatchObject({ status: "succeeded" });

    // Answers are locked now (RLS → 409).
    const sheet = await getAnswerSheet(user, { sessionId });
    expect(sheet.editable).toBe(false);
    await expect(saveInterviewAnswer(user, { answerId: sheet.items[0]!.answer!.id, answerText: "late" })).rejects.toMatchObject({ code: "interview_already_submitted" });

    const result = await getInterviewResult(user, { sessionId });
    expect(result.firstView).toBe(true);
    expect(result.session).toMatchObject({ status: "completed", unansweredCount: 1, evaluationProvider: { provider: "anthropic" } });
    expect(result.score).toMatchObject({ status: "pending_method", countedCount: 2, noAnswers: false });
    expect(result.items.map((i) => i.question.intent)).toEqual(["가치 기준 확인", "실패 후 성장 확인", "갈등 해결 방식 확인"]);
    expect(result.items.map((i) => i.answer?.score.status)).toEqual(["pending_method", "pending_method", "unanswered"]);
    expect(result.items[0]!.evaluation).toMatchObject({ status: "succeeded", intentReveal: expect.any(String) });
    expect(result.items[0]!.evaluation!.criteria).toHaveLength(4);
    expect(result.items[0]!.evaluation!.modelAnswer!.evidence[0]).toMatchObject({ sourceType: "interview_answer" });
    expect(result.items[2]!.evaluation).toBeNull();
    expect(result.feedback).toMatchObject({ status: "succeeded", headline: AI07_OUTPUT.headline });
    expect(result.feedback!.criteriaSummary).toHaveLength(4);
    expect(result.canRetryEvaluation).toBe(false);
    expect(JSON.stringify(result)).not.toContain("본인 역할 구분"); // good_answer_signals never
    expect((await getInterviewResult(user, { sessionId })).firstView).toBe(false);
    await expect(retryInterviewEvaluation(h.startDeps, sessionId)).rejects.toMatchObject({ code: "interview_evaluation_not_retryable" });
    await expect(retryInterviewQuestions(h.startDeps, sessionId)).rejects.toMatchObject({ code: "interview_generation_not_failed" });

    // C-7: no answer text and no key in logs.
    const all = logs.join("\n");
    expect(all).not.toContain(ANSWER);
    expect(all).not.toContain(FAKE_KEY);
  });

  it("lists, prep and progress; abandoned sessions group at the bottom", async () => {
    const list = await listInterviewSessions(user, {});
    expect(list.inProgress).toEqual([]);
    expect(list.sessions.map((x) => x.id)).toEqual([sessionId]);
    expect(list.sessions[0]).toMatchObject({ status: "completed", isNewResult: false, executionProvider: { kind: "single", role: "evaluation", provider: "anthropic" } });
    expect(list.hasApplicationProjects).toBe(true);
    expect((await listInterviewSessions(user, { provider: "openai" })).sessions).toEqual([]);

    // A session with no questions made yet can still be abandoned (generation canceled).
    queue.push({ hang: true });
    const h = harness();
    const second = await startInterviewSession(h.startDeps, project, { interviewType: "culture_fit", questionCount: 3 });
    if (second.kind !== "started") throw new Error("not started");
    const abandoned = await abandonInterviewSession(user, { sessionId: second.data.sessionId });
    expect(abandoned.status).toBe("abandoned");
    queue.length = 0;

    const prep = await getInterviewPrep(user, { applicationProjectId: project });
    expect(prep.readiness.jobInterview.ready).toBe(false);
    expect(prep.readiness.cultureFit.dataSufficiency).toBe("none");
    expect(prep.inProgressSession).toBeNull();
    expect(prep.sessions.map((x) => x.status)).toEqual(["completed", "abandoned"]);
    const grouped = await listInterviewSessions(user, { applicationProjectId: project });
    expect(grouped.abandoned.map((x) => x.id)).toEqual([second.data.sessionId]);

    const progress = await loadProgress(user, [project]);
    expect(progress.get(project)).toMatchObject({ interviewCount: 2, interviewInProgress: false });

    expect((await listInterviewSessions(other, {})).sessions).toEqual([]);
    await deleteInterviewSession(user, { sessionId: second.data.sessionId });
    expect((await loadProgress(user, [project])).get(project)?.interviewCount).toBe(1);
  });

  it("project delete cascades the sessions", async () => {
    await deleteApplicationProject(user, project);
    expect((await admin.from("interview_sessions").select("id").eq("application_project_id", project)).data).toEqual([]);
    expect((await admin.from("interview_answers").select("id").eq("session_id", sessionId)).data).toEqual([]);
  });
});
