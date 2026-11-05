import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { previewMarkerValue } from "@/server/auth/preview-marker"
import { CreateApplicationProjectInput } from "@/lib/contracts/application"
import { REQUIRED_CONSENT_TYPES } from "@/lib/contracts/enums"
import { KO_BACKEND } from "@/server/ai/__fixtures__/AI-01/jds"
import { ProviderError } from "@/server/ai/errors"
import type { Llm } from "@/server/ai/llm"
import { loadCareerRows } from "@/server/ai/context-pack/career-rows"
import type { ProviderAdapter } from "@/server/ai/providers/types"
import { createAiWriterClient } from "@/server/db/ai-writer"
import type { Database } from "@/server/db/database.types"
import { resetServerEnvCache } from "@/server/env"
import { productionInterviewPipelines } from "@/server/jobs/interview"
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext, type ProviderContext } from "@/server/jobs/provider-context"
import { createJobRunner, type JobRunner } from "@/server/jobs/runner"
import { createSupabaseJobStore } from "@/server/jobs/supabase-store"
import { createSupabaseUsageStore } from "@/server/jobs/supabase-usage"
import { createJdExtractionDb } from "@/server/services/application/db"
import { ensureJdExtracted } from "@/server/services/application/extraction"
import { createApplicationProject } from "@/server/services/application/write"
import { submitConsents } from "@/server/services/consent"
import { createInterviewStore } from "@/server/services/interview/db"
import { createInterviewEvaluationJobDefinition, createInterviewQuestionsJobDefinition, type InterviewJobDeps } from "@/server/services/interview/job"
import type { InterviewStartDeps } from "@/server/services/interview/start"
import { connectTestProvider } from "@/test/ai-connection-db"
import { productionJdExtractorForTests } from "@/test/jd-extraction-fakes"
import { createScriptedAdapter, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes"
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase"

/**
 * W4 against the local stack: the data functions the S-20 / S-33 / S-22 / S-37 / S-39 screens call,
 * on their real branch with real rows. Only the session (no cookies in Vitest) and the provider
 * (scripted) are replaced; AI-01 / 05 / 06 / 07 pipelines, job runner and RPCs are the real ones.
 * Covers every row of the DM 2.7.1 판정표 as the screens read it. Skips without the stack.
 */

const ctx = vi.hoisted(() => ({
  client: null as unknown,
  userId: "",
  startDeps: null as unknown,
  runner: null as unknown,
  preview: false,
}))
vi.mock("next/headers", () => ({ headers: async () => new Headers(ctx.preview ? { "x-resumate-preview": previewMarkerValue() } : {}), cookies: async () => ({ getAll: () => [] }) }))
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }))
vi.mock("@/server/auth/site-url", () => ({ getSiteOrigin: async () => "http://localhost:3000" }))
vi.mock("@/server/auth/session", () => {
  const auth = async () => ({ supabase: ctx.client, user: { id: ctx.userId } })
  return { requireUser: auth, requireConsentedUser: auth, requireConsentedUserOrRedirect: auth }
})
vi.mock("@/server/interview-routes", () => ({ interviewStartDeps: async () => ctx.startDeps }))
vi.mock("@/server/jobs/app-runner", () => ({ createAppJobRunner: () => ctx.runner }))

const stack = readLocalSupabase()
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "interview_sessions")) : false

type Client = SupabaseClient<Database>
const FAKE_KEY = "sk-ant-FAKE-w4-interview-0000"
const ANSWER = "저는 의견이 다르면 먼저 상대 이야기를 듣는 편입니다."

const q = (over: Record<string, unknown>) => ({ order: 1, source_kind: "values", anchor: "general", text: "질문", intent: "의도", focus_criteria: ["specificity"], target_requirement_refs: [], target_gap_requirement_refs: [], evidence: [], good_answer_signals: ["본인 역할 구분"], ...over })
const AI05 = {
  schema_version: 2,
  interview_type: "culture_fit",
  weak_requirement_refs: [],
  questions: [
    q({ order: 1, source_kind: "values", text: "일의 우선순위를 정할 때 가장 중요하게 보는 것은 무엇인가요?", intent: "가치 기준 확인" }),
    q({ order: 2, source_kind: "failure_growth", text: "실수한 뒤 바꾼 일하는 방식이 있나요?", intent: "실패 후 성장 확인" }),
    q({ order: 3, source_kind: "conflict", text: "동료와 의견이 부딪쳤을 때 어떻게 하시나요?", intent: "갈등 해결 방식 확인" }),
  ],
  data_sufficiency: { level: "none", hints: [] },
}
const AI06 = {
  schema_version: 2,
  question_ref: "Q-1",
  answer_ref: "ANS-1",
  criteria: [
    { key: "specificity", grade: "poor", reason: "이유", answer_quotes: [], missing: "구체 사례" },
    { key: "intent_fit", grade: "fair", reason: "이유", answer_quotes: ["먼저 상대 이야기를 듣는 편입니다"], missing: null },
    { key: "structure", grade: "fair", reason: "이유", answer_quotes: ["먼저 상대 이야기를 듣는 편입니다"], missing: null },
    { key: "job_relevance", grade: "not_applicable", reason: "이유", answer_quotes: [], missing: null },
  ],
  strengths: [{ text: "경청하는 태도를 밝혔습니다.", answer_quotes: ["먼저 상대 이야기를 듣는 편입니다"] }],
  improvements: [{ text: "구체 사례를 넣으세요.", how: "언제, 누구와, 무엇을 순서로.", related_criteria: ["specificity"], evidence: [] }],
  intent_reveal: "갈등을 다루는 방식을 보려는 질문이었습니다.",
  model_answer: {
    text: "저는 의견이 다르면 먼저 상대 이야기를 듣습니다. [사례 입력 필요]",
    evidence: [{ source_type: "interview_answer", ref: "ANS-1", field: null, quote: "의견이 다르면 먼저 상대 이야기를 듣는 편입니다" }],
    placeholders: [{ token: "[사례 입력 필요]", hint: "의견이 갈렸던 실제 상황" }],
    suggestions_if_true: [],
  },
  consistency_notes: [{ text: "등록한 경력과 다릅니다.", answer_quotes: ["먼저 상대 이야기를 듣는 편입니다"], evidence: [] }],
  score: { status: "pending_method", value: null, max: null, method_version: null, rationale: null },
}
const AI07 = {
  schema_version: 2,
  headline: "경청하는 태도는 좋지만 구체 사례가 필요합니다.",
  overall_strengths: [],
  overall_weaknesses: [],
  unanswered_note: null,
  next_practice: [],
  session_score: { status: "pending_method", value: null, max: null, method_version: null, rationale: null, counted_questions: 2, unanswered_count: 1 },
}

describe.skipIf(!ready)("W4 interview + board data functions (local stack)", async () => {
  const s = stack!
  const data = await import("./interviews")
  const applications = await import("./applications")
  const deletion = await import("./deletion")
  const jobs = await import("./ai-jobs")
  const { clearsNewResultOnView } = await import("./interview-grading")
  const shell = await import("./shell")
  let admin: Client
  let user: Client
  let userId = ""
  const queue: ScriptedResponse[] = []
  let scheduled: (() => Promise<void>)[] = []
  const projects: string[] = []

  function lazyAdapter(): ProviderAdapter {
    const one = async (): Promise<ProviderAdapter> => {
      const next = queue.shift()
      if (!next) throw new Error("lazy adapter: no response left")
      return createScriptedAdapter("anthropic", [next], Date.now).adapter
    }
    return {
      id: "anthropic",
      async *stream(call) {
        yield* (await one()).stream(call)
      },
      async complete(call) {
        return (await one()).complete(call)
      },
      verify: async () => ({ ok: true, usage: { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: null, usageSource: "provider_reported" } }),
    }
  }

  function wire(active: ProviderContext | null = { provider: "anthropic", connectionTier: "paid", keyStatus: "valid" }) {
    const adapter = lazyAdapter()
    const createLlm = (input: Parameters<ReturnType<typeof scriptedLlmFactory>>[0]): Llm => scriptedLlmFactory(adapter, Date.now)(input)
    const keySource = createStaticKeySource(FAKE_KEY, () => new ProviderError("key_missing"))
    const providerContext = createStaticProviderContext(active)
    const log = () => {}
    const deps: InterviewJobDeps<unknown, unknown> = {
      pipelines: productionInterviewPipelines as InterviewJobDeps<unknown, unknown>["pipelines"],
      storeFor: createInterviewStore,
      loadCareerRows,
      ensureJd: (c, id) =>
        ensureJdExtracted(
          {
            userId: c.userId,
            jds: createJdExtractionDb(c.db, c.db),
            store: createSupabaseJobStore(c.db),
            usage: createSupabaseUsageStore(c.db),
            providerContext: createStaticProviderContext({ provider: c.provider, connectionTier: c.connectionTier, keyStatus: "valid" }),
            keySource,
            keyStatus: createRecordingKeyStatusReporter(),
            runGate: null,
            createLlm,
            extract: productionJdExtractorForTests,
            log,
          },
          id,
          { signal: c.signal },
        ),
      log,
    }
    const definitions = { interview_questions: createInterviewQuestionsJobDefinition(deps), interview_evaluation: createInterviewEvaluationJobDefinition(deps) }
    const runner: JobRunner = createJobRunner<Llm>({
      forUser: (id) => {
        const db = createAiWriterClient(id)
        return { db, store: createSupabaseJobStore(db), usage: createSupabaseUsageStore(db), keySource, keyStatus: createRecordingKeyStatusReporter() }
      },
      providerContext,
      createLlm,
      settleLlm: (llm, ms) => llm.settle(ms),
      getDefinition: (t) => (definitions as Record<string, (typeof definitions)["interview_questions"]>)[t],
      schedule: (task) => void scheduled.push(task),
      continueJob: async () => {},
      log,
    })
    const startDeps: InterviewStartDeps = { userId, user, providerContext, runner, promptVersions: { questions: "q", evaluation: "e" } }
    ctx.client = user
    ctx.userId = userId
    ctx.startDeps = startDeps
    ctx.runner = runner
  }

  async function drain() {
    while (scheduled.length) await scheduled.shift()!()
    expect(queue).toHaveLength(0)
  }

  async function newProject(): Promise<string> {
    const id = crypto.randomUUID()
    projects.push(id)
    await createApplicationProject(user, CreateApplicationProjectInput.parse({ id, rawText: KO_BACKEND.raw }))
    return id
  }

  /** Questions ready, two of three answers written through the data function. */
  async function answered(): Promise<{ project: string; sessionId: string }> {
    const project = await newProject()
    queue.push({ json: KO_BACKEND.output }, { json: AI05 })
    const { session_id: sessionId } = await data.startInterviewSession({ application_project_id: project, interview_type: "culture_fit", question_count: 3 })
    await drain()
    const detail = (await data.getInterviewSession(project, sessionId))!
    for (const item of detail.questions.slice(0, 2)) await data.saveInterviewAnswer(item.answer!.id, ANSWER)
    return { project, sessionId }
  }

  async function submitted(script: ScriptedResponse[]) {
    const ids = await answered()
    queue.push(...script)
    await data.submitInterviewSession(ids.sessionId)
    await drain()
    return ids
  }

  /** What S-22 and S-37 both read. They must agree, the list being the same decision (Q53-6). */
  async function read(project: string, sessionId: string) {
    const detail = (await data.getInterviewSession(project, sessionId))!
    const [row] = await data.listInterviewSessions({ application_project_id: project })
    expect(row!.id).toBe(sessionId)
    expect(row!.grading).toEqual(detail.grading)
    expect(row!.failed_answer_count).toBe(detail.failed_answer_count)
    expect(row!.has_new_result).toBe(detail.has_new_result)
    return detail
  }

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", s.url)
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", s.anonKey)
    vi.stubEnv("SUPABASE_JWT_SECRET", s.jwtSecret)
    vi.stubEnv("CRON_SECRET", "test-cron-secret-0000")
    resetServerEnvCache()
    scheduled = []
    queue.length = 0
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    wire()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeAll(async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", s.url)
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", s.anonKey)
    vi.stubEnv("SUPABASE_JWT_SECRET", s.jwtSecret)
    vi.stubEnv("CRON_SECRET", "test-cron-secret-0000")
    resetServerEnvCache()
    admin = createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const email = `w4-${crypto.randomUUID()}@example.test`
    const password = `pw-${crypto.randomUUID()}`
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.code}`)
    userId = created.data.user.id
    user = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } })
    const signIn = await user.auth.signInWithPassword({ email, password })
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.code}`)
    // spec-gaps ⑲: the test user consents through the RPC, the S-03 form can't pass yet.
    await submitConsents(user, REQUIRED_CONSENT_TYPES.map((consentType) => ({ consentType, agreed: true })), "vitest")
    await connectTestProvider(admin, user, userId, "anthropic", "paid")
  })

  afterAll(async () => {
    if (!userId) return
    await admin.from("ai_usage_records").delete().eq("user_id", userId)
    await admin.from("ai_jobs").delete().eq("user_id", userId)
    await admin.auth.admin.deleteUser(userId)
    resetServerEnvCache()
  })

  it("start → sheet → autosave → submit → result: the shapes S-20, S-33, S-22, S-37 read", async () => {
    const project = await newProject()
    queue.push({ json: KO_BACKEND.output }, { json: AI05 })
    const started = await data.startInterviewSession({ application_project_id: project, interview_type: "culture_fit", question_count: 3 })

    // Before the job ran: generating, its job is the running one, no questions, no key material.
    const before = (await data.getInterviewSession(project, started.session_id))!
    expect(before).toMatchObject({ status: "in_progress", generation_status: "generating", running_job_id: started.job_id, saved_question_count: 0, questions: [], feedback: null, grading: { kind: "none" } })
    await drain()

    const sheet = (await data.getInterviewSession(project, started.session_id))!
    expect(sheet).toMatchObject({ generation_status: "ready", running_job_id: null, saved_question_count: 3, question_provider: "anthropic", question_model_tier: expect.any(String), evaluation_model_tier: null, data_sufficiency: "none" })
    expect(sheet.application_name).not.toBe("")
    expect(sheet.questions.map((x) => x.sequence)).toEqual([1, 2, 3])
    // A.13: nothing revealed before submission.
    expect(sheet.questions.every((x) => x.intent === null && x.good_answer_signals === null)).toBe(true)
    expect(JSON.stringify(sheet)).not.toContain("가치 기준 확인")
    expect(JSON.stringify(sheet)).not.toContain("본인 역할 구분")
    expect(sheet.questions.every((x) => x.answer?.status === "draft" && x.answer.answer_text === "")).toBe(true)
    await expect(jobs.getLatestJobFor("interview_session", started.session_id)).resolves.toMatchObject({ id: started.job_id, job_type: "interview_questions", status: "succeeded" })
    await expect(applications.moveApplicationStage(project, "job_interview")).resolves.toMatchObject({ interview_prompt: { in_progress_session: { session_id: started.session_id, answered_count: 0 } } })

    // S-33 autosave: returns the row, keeps the count.
    const saved = await data.saveInterviewAnswer(sheet.questions[0]!.answer!.id, ANSWER)
    expect(saved).toMatchObject({ answer_text: ANSWER, status: "draft", session_id: started.session_id })
    await data.saveInterviewAnswer(sheet.questions[1]!.answer!.id, ANSWER)
    expect((await data.getInterviewSession(project, started.session_id))!.answered_count).toBe(2)
    await expect(data.saveInterviewAnswer(sheet.questions[0]!.answer!.id, "x".repeat(5001))).rejects.toMatchObject({ code: "invalid_input" })

    queue.push({ json: AI06 }, { json: AI06 }, { json: AI07 })
    const { job_id } = await data.submitInterviewSession(started.session_id)
    expect(job_id).toEqual(expect.any(String))
    const running = (await data.getInterviewSession(project, started.session_id))!
    expect(running).toMatchObject({ status: "evaluating", running_job_id: job_id, grading: { kind: "none" }, has_new_result: false, answered_count: 2, unanswered_count: 1 })
    await drain()

    await expect(data.saveInterviewAnswer(sheet.questions[0]!.answer!.id, "late")).rejects.toMatchObject({ code: "interview_already_submitted" })

    const result = await read(project, started.session_id)
    // R11 최소 수정 (OD-I1): the DB writes the d14.v1 score at completion.
    expect(result).toMatchObject({ status: "completed", score_status: "scored", score_method_version: "d14.v1", evaluation_provider: "anthropic", has_new_result: true, grading: { kind: "none" }, failed_answer_count: 0 })
    expect(result.questions.map((x) => x.intent)).toEqual(["가치 기준 확인", "실패 후 성장 확인", "갈등 해결 방식 확인"])
    expect(JSON.stringify(result)).not.toContain("본인 역할 구분")
    expect(result.questions.map((x) => x.answer?.status)).toEqual(["submitted", "submitted", "unanswered"])
    expect(result.questions[2]!.evaluation).toBeNull()
    expect(result.questions[2]!.evaluation_error).toBeNull()
    const first = result.questions[0]!.evaluation!
    expect(first.status).toBe("succeeded")
    // S-22 reads the stored result directly: these are the paths result-view.tsx dereferences.
    expect(first.result!.criteria).toHaveLength(4)
    expect(first.result!.improvements[0]!.how).toEqual(expect.any(String))
    expect(first.result!.model_answer.placeholders[0]).toMatchObject({ token: expect.any(String), hint: expect.any(String) })
    // This scripted note has no career evidence, so AI-06 drops it (AI-06.test). The stored form's read: toUiEvaluationResult below.
    expect(first.result!.consistency_notes).toEqual([])
    expect(result.feedback).toMatchObject({ status: "succeeded", result: { headline: AI07.headline, overall_strengths: [], next_practice: [] } })
    expect(result.feedback!.result!.criteria_summary).toHaveLength(4)

    // First open: S-22's effect. Second call does nothing; the L-01 badge counts the same rows.
    expect(clearsNewResultOnView(result.status, result.grading)).toBe(true)
    const badgeBefore = (await shell.getShellBadges()).interviews_new_results
    await expect(data.markResultViewed(started.session_id)).resolves.toEqual({ changed: true })
    expect((await shell.getShellBadges()).interviews_new_results).toBe(badgeBefore - 1)
    await expect(data.markResultViewed(started.session_id)).resolves.toEqual({ changed: false })
    expect((await read(project, started.session_id)).has_new_result).toBe(false)
    await expect(data.markResultViewed(crypto.randomUUID())).resolves.toEqual({ changed: false })

    // Other screens' filters.
    await expect(data.listInterviewSessions({ application_project_id: project, status: "in_progress" })).resolves.toEqual([])
    await expect(data.listInterviewSessions({ application_project_id: project, status: "completed" })).resolves.toHaveLength(1)
    await expect(data.listInterviewSessions({ application_project_id: project, interview_type: "job" })).resolves.toEqual([])
    await expect(data.getInterviewSession(crypto.randomUUID(), started.session_id)).resolves.toBeNull()
    await expect(data.getInterviewSession("not-a-uuid", started.session_id)).resolves.toBeNull()
  })

  it("판정표 evaluation_failed + 대상 ≥ 1 → regrade: S-22 keeps the mark; 다시 채점 grades only the rest and completes", async () => {
    const { project, sessionId } = await submitted([{ json: AI06 }, { error: "billing_required" }])
    const r = await read(project, sessionId)
    expect(r).toMatchObject({ status: "evaluation_failed", grading: { kind: "regrade", count: 1 }, failed_answer_count: 1, has_new_result: true })
    const failed = r.questions.find((x) => x.answer?.status === "submitted" && x.evaluation?.status !== "succeeded")!
    expect(failed.evaluation_error).toMatchObject({ error_code: "billing_required", provider: "anthropic" })
    expect(clearsNewResultOnView(r.status, r.grading)).toBe(false)
    await expect(data.markResultViewed(sessionId)).resolves.toEqual({ changed: false })

    queue.push({ json: AI06 }, { json: AI07 })
    const job = await data.regradeFailedAnswers(sessionId)
    expect(job).toMatchObject({ job_type: "interview_evaluation", target_id: sessionId })
    await drain()
    const after = await read(project, sessionId)
    expect(after).toMatchObject({ status: "completed", grading: { kind: "none" }, failed_answer_count: 0 })
    expect(after.questions.every((x) => x.answer?.status !== "submitted" || x.evaluation_error === null)).toBe(true)
  })

  it("판정표 evaluation_failed + 대상 0 + 성공 ≥ 1 + 종합 실패 → resummarize; then completed + input_only (답변 카드에만 원인)", async () => {
    const { project, sessionId } = await submitted([{ json: AI06 }, { error: "safety_blocked" }, { error: "billing_required" }])
    const r = await read(project, sessionId)
    expect(r).toMatchObject({ status: "evaluation_failed", grading: { kind: "resummarize" }, failed_answer_count: 0, has_new_result: true })
    expect(r.feedback?.status === "succeeded").toBe(false)
    expect(r.questions.flatMap((x) => (x.evaluation?.error_code ? [x.evaluation.error_code] : []))).toEqual(["safety_blocked"])
    await expect(data.markResultViewed(sessionId)).resolves.toEqual({ changed: false })

    // The resummarize path: one AI-07 call, no AI-06.
    queue.push({ json: AI07 })
    const job = await data.regradeFailedAnswers(sessionId)
    expect(job).toMatchObject({ job_type: "interview_evaluation" })
    await drain()
    if ("refused" in job) throw new Error("refused")
    expect((await admin.from("ai_usage_records").select("id").eq("ai_job_id", job.id)).data).toHaveLength(1)

    const done = await read(project, sessionId)
    expect(done).toMatchObject({ status: "completed", grading: { kind: "input_only", cause: "safety_blocked" }, has_new_result: true })
    expect(done.feedback?.status).toBe("succeeded")
    expect(clearsNewResultOnView(done.status, done.grading)).toBe(true)
    await expect(data.regradeFailedAnswers(sessionId)).resolves.toEqual({ refused: "interview_evaluation_input_only", cause: "safety_blocked" })
    await expect(data.markResultViewed(sessionId)).resolves.toEqual({ changed: true })
  })

  it("판정표 evaluation_failed + 대상 0 + 성공 ≥ 1 + 종합 입력 원인 → input_only (cause = 종합), mark clears", async () => {
    const { project, sessionId } = await submitted([{ json: AI06 }, { json: AI06 }, { error: "safety_blocked" }])
    const r = await read(project, sessionId)
    expect(r).toMatchObject({ status: "evaluation_failed", grading: { kind: "input_only", cause: "safety_blocked" }, failed_answer_count: 0 })
    expect(clearsNewResultOnView(r.status, r.grading)).toBe(true)
    await expect(data.regradeFailedAnswers(sessionId)).resolves.toEqual({ refused: "interview_evaluation_input_only", cause: "safety_blocked" })
    await expect(data.markResultViewed(sessionId)).resolves.toEqual({ changed: true })
    expect((await read(project, sessionId)).has_new_result).toBe(false)
  })

  it("판정표 evaluation_failed + 대상 0 + 성공 0 → input_only (cause = 답변)", async () => {
    const { project, sessionId } = await submitted([{ error: "input_too_long" }, { error: "input_too_long" }])
    const r = await read(project, sessionId)
    expect(r).toMatchObject({ status: "evaluation_failed", grading: { kind: "input_only", cause: "input_too_long" }, failed_answer_count: 0 })
    await expect(data.regradeFailedAnswers(sessionId)).resolves.toEqual({ refused: "interview_evaluation_input_only", cause: "input_too_long" })
    await expect(data.markResultViewed(sessionId)).resolves.toEqual({ changed: true })
  })

  it("판정표 completed + 대상 ≥ 1 → regrade (not input-caused answer failure); the S-37 row says the same", async () => {
    const { project, sessionId } = await submitted([{ json: AI06 }, { error: "insufficient_data" }, { json: AI07 }])
    const r = await read(project, sessionId)
    expect(r).toMatchObject({ status: "completed", grading: { kind: "regrade", count: 1 }, failed_answer_count: 1 })
    expect(r.questions.find((x) => x.evaluation?.status === "failed")?.evaluation_error).toMatchObject({ error_code: "insufficient_data" })
    // Q53-10: a completed session clears the mark even with a re-gradable answer.
    await expect(data.markResultViewed(sessionId)).resolves.toEqual({ changed: true })
  })

  it("판정표 그 밖 → none: all blank goes straight to completed/scored 0 (d14.v1) with no job; in-progress stays none", async () => {
    const project = await newProject()
    queue.push({ json: KO_BACKEND.output }, { json: AI05 })
    const { session_id } = await data.startInterviewSession({ application_project_id: project, interview_type: "culture_fit", question_count: 3 })
    await drain()
    expect((await read(project, session_id)).grading).toEqual({ kind: "none" })
    await expect(data.submitInterviewSession(session_id)).resolves.toEqual({ job_id: null })
    const r = await read(project, session_id)
    // R11 최소 수정 (OD-I1 / R-OD-1): all unanswered = session scored 0 (was not_scored).
    expect(r).toMatchObject({ status: "completed", score_status: "scored", score_value: 0, grading: { kind: "none" }, unanswered_count: 3, has_new_result: true })
    await expect(data.regradeFailedAnswers(session_id)).resolves.toEqual({ refused: "interview_evaluation_not_retryable", cause: null })
  })

  it("㉖ S-33: 남은 질문 다시 만들기 is accepted exactly where the screen shows it", async () => {
    const project = await newProject()
    const text = JSON.stringify(AI05)
    queue.push({ json: KO_BACKEND.output }, { errorAfterChunks: "billing_required", json: AI05, chunks: text.indexOf('{"order":3') })
    const { session_id, job_id } = await data.startInterviewSession({ application_project_id: project, interview_type: "culture_fit", question_count: 3 })
    await drain()

    // answer-sheet.tsx: failedCategory (job failed / session failed) + 0 < saved < total → "remaining".
    const failed = (await data.getInterviewSession(project, session_id))!
    expect(failed).toMatchObject({ generation_status: "failed", saved_question_count: 2 })
    await expect(jobs.getLatestJobFor("interview_session", session_id)).resolves.toMatchObject({ id: job_id, status: "failed", error_code: "billing_required" })

    queue.push({ json: AI05 })
    const next = await jobs.startRemainingQuestions(session_id)
    expect(next).toMatchObject({ job_type: "interview_questions", target_id: session_id })
    expect(next!.id).not.toBe(job_id)
    await expect(data.getInterviewSession(project, session_id)).resolves.toMatchObject({ running_job_id: next!.id })
    await drain()
    await expect(data.getInterviewSession(project, session_id)).resolves.toMatchObject({ generation_status: "ready", saved_question_count: 3, running_job_id: null })

    // Hidden there (generation ready): the real path answers null, the mock's "남은 질문" semantics don't apply.
    await expect(jobs.startRemainingQuestions(session_id)).resolves.toBeNull()
  })

  it("leftover rule: a `generating` session whose job was canceled reads failed; same-row retry on it is refused", async () => {
    const project = await newProject()
    queue.push({ hang: true })
    const { session_id, job_id } = await data.startInterviewSession({ application_project_id: project, interview_type: "culture_fit", question_count: 3 })
    await jobs.cancelAiJob(job_id)
    queue.length = 0
    scheduled = []
    const r = (await data.getInterviewSession(project, session_id))!
    expect(r).toMatchObject({ generation_status: "failed", running_job_id: null, saved_question_count: 0 })
    await expect(jobs.getLatestJobFor("interview_session", session_id)).resolves.toMatchObject({ status: "canceled" })
    await expect(jobs.retryAiJob(job_id)).rejects.toMatchObject({ code: "ai_job_not_retryable" })
    // Whole failure on a canceled row: only 남은 질문 / 새 면접 can continue it.
    queue.push({ json: KO_BACKEND.output }, { json: AI05 })
    await expect(jobs.startRemainingQuestions(session_id)).resolves.toMatchObject({ job_type: "interview_questions" })
    await drain()
    await expect(data.getInterviewSession(project, session_id)).resolves.toMatchObject({ generation_status: "ready" })
  })

  it("restart: refused gates leave the session; then abandon → new session. Abandon is quiet on a finished session", async () => {
    const project = await newProject()
    const text = JSON.stringify(AI05)
    queue.push({ json: KO_BACKEND.output }, { errorAfterChunks: "billing_required", json: AI05, chunks: text.indexOf('{"order":1') })
    const { session_id } = await data.startInterviewSession({ application_project_id: project, interview_type: "culture_fit", question_count: 3 })
    await drain()
    await expect(data.getInterviewSession(project, session_id)).resolves.toMatchObject({ status: "in_progress", generation_status: "failed", saved_question_count: 0 })

    // S-20 C-09: job interview with no career data.
    await expect(data.restartInterviewSession(session_id, { application_project_id: project, interview_type: "job", question_count: 3 })).resolves.toEqual({ insufficient: true })
    // C-18 (no connection) and C-20 (invalid key): thrown for withAiGuard, session untouched.
    wire(null)
    await expect(data.restartInterviewSession(session_id, { application_project_id: project, interview_type: "culture_fit", question_count: 3 })).rejects.toMatchObject({ code: "ai_not_connected" })
    wire({ provider: "anthropic", connectionTier: "paid", keyStatus: "invalid" })
    await expect(data.restartInterviewSession(session_id, { application_project_id: project, interview_type: "culture_fit", question_count: 3 })).rejects.toMatchObject({ code: "key_invalid" })
    wire()
    await expect(data.getInterviewSession(project, session_id)).resolves.toMatchObject({ status: "in_progress" })
    await expect(data.restartInterviewSession(session_id, { application_project_id: crypto.randomUUID(), interview_type: "culture_fit", question_count: 3 })).rejects.toMatchObject({ code: "not_found" })

    queue.push({ json: AI05 })
    const next = await data.restartInterviewSession(session_id, { application_project_id: project, interview_type: "culture_fit", question_count: 3 })
    if ("insufficient" in next) throw new Error("insufficient")
    await drain()
    await expect(data.getInterviewSession(project, session_id)).resolves.toMatchObject({ status: "abandoned", abandoned_at: expect.any(String) })
    await expect(data.getInterviewSession(project, next.session_id)).resolves.toMatchObject({ status: "in_progress", generation_status: "ready" })

    // One in progress per project: the second start is refused with the conflict code, not silently.
    await expect(data.startInterviewSession({ application_project_id: project, interview_type: "culture_fit", question_count: 3 })).rejects.toMatchObject({ code: "interview_in_progress" })
    await expect(data.startInterviewSession({ application_project_id: project, interview_type: "job", question_count: 3 })).rejects.toMatchObject({ code: "insufficient_data" })

    await data.abandonInterviewSession(next.session_id)
    await data.abandonInterviewSession(next.session_id) // no error, as the mock
    await data.abandonInterviewSession(crypto.randomUUID())
    const rows = await data.listInterviewSessions({ application_project_id: project })
    expect(rows.map((r) => [r.status, r.saved_question_count])).toEqual([["abandoned", 3], ["abandoned", 0]])
    await expect(deletion.getInterviewSessionDeletionImpact(next.session_id)).resolves.toEqual({ questions: 3, answers: 0 })
    await deletion.deleteInterviewSession(next.session_id)
    await expect(data.getInterviewSession(project, next.session_id)).resolves.toBeNull()
    await expect(deletion.deleteInterviewSession(next.session_id)).rejects.toMatchObject({ code: "not_found" })
  })

  it("S-39 / C-12 / C-13: move, interview-column prompt, closed + outcome, leaving closed, deadline", async () => {
    const { project, sessionId } = await answered()

    // Interview column with an in-progress session: C-14 data in the screen's snake_case.
    const moved = await applications.moveApplicationStage(project, "job_interview")
    expect(moved.application_project).toMatchObject({ id: project, stage: "job_interview", stage_outcome: null })
    expect(moved.interview_prompt).toEqual({
      interview_type: "job",
      in_progress_session_id: sessionId,
      in_progress_session: { session_id: sessionId, interview_type: "culture_fit", answered_count: 2, question_count: 3, generation_status: "ready", last_activity_at: expect.any(String) },
    })
    // Same stage: no change, no prompt, no event.
    await expect(applications.moveApplicationStage(project, "job_interview")).resolves.toMatchObject({ interview_prompt: null })
    // Non-interview column: no prompt.
    await expect(applications.moveApplicationStage(project, "document")).resolves.toMatchObject({ interview_prompt: null })

    await data.abandonInterviewSession(sessionId)
    await expect(applications.moveApplicationStage(project, "culture_fit_interview")).resolves.toMatchObject({
      interview_prompt: { interview_type: "culture_fit", in_progress_session_id: null, in_progress_session: null },
    })

    await expect(applications.setApplicationOutcome(project, "passed")).resolves.toBeNull() // not closed yet
    await expect(applications.moveApplicationStage(project, "closed")).resolves.toMatchObject({ application_project: { stage: "closed", stage_outcome: null }, interview_prompt: null })
    await expect(applications.setApplicationOutcome(project, "passed")).resolves.toMatchObject({ stage: "closed", stage_outcome: "passed" })
    await expect(applications.setApplicationOutcome(project, null)).resolves.toMatchObject({ stage_outcome: null })
    await expect(applications.moveApplicationStage(project, "closed", "failed")).resolves.toMatchObject({ interview_prompt: null })
    await applications.setApplicationOutcome(project, "failed")
    await expect(applications.moveApplicationStage(project, "document")).resolves.toMatchObject({ application_project: { stage: "document", stage_outcome: null } }) // D-UX-12
    await expect(applications.moveApplicationStage(project, "before_apply", "passed")).rejects.toMatchObject({ code: "invalid_outcome" })

    const events = await admin.from("application_stage_events").select("event_type, to_stage, to_outcome").eq("application_project_id", project).order("created_at")
    expect(events.data?.filter((e) => e.event_type === "stage_changed").map((e) => e.to_stage)).toEqual(["job_interview", "document", "culture_fit_interview", "closed", "document"])

    // Deadline (the card's D-day, S-31 edit).
    await expect(applications.updateApplicationProject(project, { deadline: "2026-12-31" })).resolves.toMatchObject({ id: project, deadline: "2026-12-31" })
    const board = await applications.getBoard()
    expect(board.document.find((c) => c.id === project)).toMatchObject({ deadline: "2026-12-31", stage: "document" })
    expect(board.closed.find((c) => c.id === project)).toBeUndefined()
    await expect(applications.updateApplicationProject(project, { deadline: null })).resolves.toMatchObject({ deadline: null })
    await expect(applications.updateApplicationProject(crypto.randomUUID(), { deadline: "2026-12-31" })).resolves.toBeNull()
    await expect(applications.moveApplicationStage(crypto.randomUUID(), "document")).rejects.toMatchObject({ code: "not_found" })
  })

  it("a ?state= preview stays on the mock store, reads and writes alike", async () => {
    const { project, sessionId } = await answered()
    ctx.preview = true
    try {
      const rows = await data.listInterviewSessions()
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.some((r) => r.id === sessionId)).toBe(false)
      await expect(data.getInterviewSession(project, sessionId)).resolves.toBeNull()
      await data.abandonInterviewSession(sessionId)
      await expect(applications.moveApplicationStage(project, "document")).rejects.toThrow("move failed (mock)")
    } finally {
      ctx.preview = false
    }
    await expect(data.getInterviewSession(project, sessionId)).resolves.toMatchObject({ status: "in_progress" })
    expect((await admin.from("application_projects").select("stage").eq("id", project).single()).data?.stage).toBe("before_apply")
  })

  it("another user sees none of it", async () => {
    const { project, sessionId } = await answered()
    const otherEmail = `w4-other-${crypto.randomUUID()}@example.test`
    const password = `pw-${crypto.randomUUID()}`
    const created = await admin.auth.admin.createUser({ email: otherEmail, password, email_confirm: true })
    const other = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } })
    await other.auth.signInWithPassword({ email: otherEmail, password })
    const prev = ctx.client
    ctx.client = other
    ctx.userId = created.data.user!.id
    try {
      await expect(data.listInterviewSessions()).resolves.toEqual([])
      await expect(data.getInterviewSession(project, sessionId)).resolves.toBeNull()
      await data.abandonInterviewSession(sessionId)
      await expect(deletion.deleteInterviewSession(sessionId)).rejects.toMatchObject({ code: "not_found" })
      await expect(applications.moveApplicationStage(project, "document")).rejects.toMatchObject({ code: "not_found" })
    } finally {
      ctx.client = prev
      ctx.userId = userId
      await admin.auth.admin.deleteUser(created.data.user!.id)
    }
    await expect(data.getInterviewSession(project, sessionId)).resolves.toMatchObject({ status: "in_progress" })
  })
})

describe("toUiEvaluationResult", async () => {
  const { toUiEvaluationResult } = await import("./interview-rows")

  it("normalizes the stored consistency notes to what S-22 renders (text + quotes), keeps the rest", () => {
    const stored = { schema_version: 2, intent_reveal: "x", consistency_notes: [{ text: "다릅니다", answer_quotes: ["a"] }, "그대로", { text: "" }, null] }
    expect(toUiEvaluationResult(stored)).toEqual({
      schema_version: 2,
      intent_reveal: "x",
      consistency_notes: [
        { text: "다릅니다", answer_quotes: ["a"] },
        { text: "그대로", answer_quotes: [] },
      ],
    })
    expect(toUiEvaluationResult({ schema_version: 2 })).toEqual({ schema_version: 2, consistency_notes: [] })
    expect(toUiEvaluationResult(null)).toBeNull()
  })
})
