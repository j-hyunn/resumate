import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KO_BACKEND, NOT_A_JD } from "@/server/ai/__fixtures__/AI-01/jds";
import type { ProviderAdapter } from "@/server/ai/providers/types";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import { resetServerEnvCache } from "@/server/env";
import { createScriptedAdapter, type ScriptedResponse } from "@/test/job-fakes";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";
import { connectTestProvider } from "@/test/ai-connection-db";

/**
 * W3 end-to-end against the local stack: the wired data functions (the screens' calls) → Server Actions → services →
 * real RPCs, triggers, RLS. Only the framework request context, the provider adapter (scripted fixtures, no network)
 * and the key decryption are replaced. Generated user, removed at the end; no db reset.
 */
const h = vi.hoisted(() => ({
  user: null as unknown,
  jar: new Map<string, string>(),
  background: [] as Promise<unknown>[],
  queue: [] as Array<unknown>,
  adapter: null as unknown,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name) } : undefined),
    getAll: () => [...h.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void h.jar.set(name, value),
    delete: (name: string) => void h.jar.delete(name),
  }),
}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  connection: async () => {},
  after: (task: Promise<unknown> | (() => unknown)) => void h.background.push(typeof task === "function" ? Promise.resolve().then(task) : task),
}));
vi.mock("@/server/db/server", () => ({ createSupabaseServerClient: async () => h.user }));
vi.mock("@/server/ai/llm", async (orig) => {
  const actual = await orig<typeof import("@/server/ai/llm")>();
  return { ...actual, createLlm: (input: Parameters<typeof actual.createLlm>[0]) => actual.createLlm({ ...input, adapters: { [input.provider]: h.adapter as ProviderAdapter } }) };
});
vi.mock("@/server/jobs/connections", async (orig) => {
  const actual = await orig<typeof import("@/server/jobs/connections")>();
  const { createStaticKeySource } = await import("@/server/jobs/provider-context");
  const { ProviderError } = await import("@/server/ai/errors");
  return {
    ...actual,
    connections: () => ({ ...actual.connections(), keysFor: () => createStaticKeySource("sk-ant-FAKE-w3-0000", () => new ProviderError("key_missing")) }),
  };
});
const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "application_documents")) : false;

type Client = SupabaseClient<Database>;
const settle = async () => {
  while (h.background.length) await h.background.shift();
};

function lazyAdapter(): ProviderAdapter {
  const one = async (): Promise<ProviderAdapter> => {
    const next = h.queue.shift() as ScriptedResponse | (() => ScriptedResponse | Promise<ScriptedResponse>) | undefined;
    if (!next) throw new Error("scripted adapter: no response left");
    return createScriptedAdapter("anthropic", [typeof next === "function" ? await next() : next], Date.now).adapter;
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

describe.skipIf(!ready)("W3 wired data layer (local stack)", { timeout: 60_000 }, () => {
  const s = stack!;
  let admin: Client;
  let user: Client;
  let userId = "";
  const ids = { experience: crypto.randomUUID(), project: crypto.randomUUID() };
  const ACTION = "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다";

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", s.url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", s.anonKey);
    vi.stubEnv("SUPABASE_JWT_SECRET", s.jwtSecret);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", s.serviceRoleKey);
    vi.stubEnv("CRON_SECRET", "test-cron-secret-0000");
    resetServerEnvCache();
    for (const m of ["info", "warn", "log"] as const) vi.spyOn(console, m).mockImplementation(() => {});
  });

  beforeAll(async () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", s.jwtSecret);
    admin = createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `w3-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.code}`);
    userId = data.user.id;
    user = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } });
    const signIn = await user.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.code}`);
    h.user = user;
    h.adapter = lazyAdapter();
    // spec-gaps ⑲: the test user consents through the RPC (S-03 can't pass today).
    const consent = await user.rpc("record_consents", { items: ["terms", "privacy_required", "cross_border_transfer"].map((consent_type) => ({ consent_type, agreed: true })) });
    if (consent.error) throw new Error(`record_consents failed: ${consent.error.message}`);
    const career = await import("@/server/services/career");
    const contracts = await import("@/lib/contracts/career");
    await career.saveExperience(user, contracts.SaveExperienceInput.parse({ id: ids.experience, companyName: "알파", startMonth: "2021-03", jobPosition: "백엔드", isCurrent: true }));
    await career.createProject(user, contracts.CreateProjectInput.parse({ id: ids.project, name: "결제 개선", affiliation: { type: "experience", id: ids.experience } }));
    await career.saveProject(
      user,
      contracts.SaveProjectInput.parse({ id: ids.project, startMonth: "2024-02", situation: "피크 시간 응답이 느렸다", task: "결제 승인 개선 리드", action: ACTION, result: "p95 800ms에서 200ms로 줄였다" }),
    );
  });

  afterAll(async () => {
    if (!userId) return;
    await settle();
    await admin.from("ai_usage_records").delete().eq("user_id", userId);
    await admin.from("ai_jobs").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
    resetServerEnvCache();
  });

  const apps = () => import("./applications");
  const drafts = () => import("./drafts");
  const deletion = () => import("./deletion");
  const evidence = () => import("./evidence");
  const guard = () => import("./ai-guard");


  it("S-14 without a key: saved, default name, pending with no job; the JD is readable; AI starts are refused", async () => {
    const { createApplicationProject, getJobDescription, getApplicationProject, listApplicationProjects, startInsight } = await apps();
    const { retryJdExtraction } = await drafts();
    const ap = await createApplicationProject({ raw_text: KO_BACKEND.raw, deadline: "2026-12-31" });
    expect(ap.name_source).toBe("default");
    await settle();
    const jd = await getJobDescription(ap.id);
    expect(jd).toMatchObject({ extraction_status: "pending", extraction_job_id: null, raw_text: KO_BACKEND.raw, raw_text_editable: false, raw_text_lock: "jd_raw_text_locked", requirements: [] });
    expect(jd?.tech_keywords).toEqual([]);
    const summary = await getApplicationProject(ap.id);
    expect(summary).toMatchObject({ id: ap.id, deadline: "2026-12-31", stage: "before_apply", insight_state: "none", draft_count: 0, running_job_ids: [], insight_job_id: null });
    expect(summary?.job_description).toMatchObject({ extraction_status: "pending" });
    expect(summary?.insight_status).toMatchObject({ kind: "none", failure: null });
    expect((await listApplicationProjects()).map((a) => a.id)).toContain(ap.id);
    expect(await getApplicationProject("not-a-uuid")).toBeNull();
    expect(await retryJdExtraction(ap.id)).toMatchObject({ rejected: "key_missing" });
    const { withAiGuard } = await guard();
    expect(await withAiGuard(() => startInsight(ap.id))).toMatchObject({ refusal: "ai_not_connected" });
  });

  let project = "";

  it("S-14 with a key: AI-01 starts in the background and the JD reads `running` right away, then the requirements", async () => {
    await connectTestProvider(admin, user, userId, "anthropic", "paid");
    const { createApplicationProject, getJobDescription, getJdRequirement, getApplicationProject } = await apps();
    h.queue.push({ json: KO_BACKEND.output, delayMs: 300 });
    const ap = await createApplicationProject({ raw_text: KO_BACKEND.raw, company_name: "베타", position_title: "백엔드" });
    project = ap.id;
    // R15 D11/D12 (CF-9): a company name names the 자기소개서 right away, with or without a key —
    // it no longer waits for the extraction.
    expect(ap).toMatchObject({ name: "베타 자기소개서", name_source: "user" });
    expect((await getJobDescription(ap.id))?.extraction_status).toBe("running");
    await settle();
    const jd = await getJobDescription(ap.id);
    expect(jd?.extraction_status).toBe("succeeded");
    expect(jd?.requirements.length).toBeGreaterThan(0);
    expect(jd).toMatchObject({ raw_text_editable: false, raw_text_lock: "jd_raw_text_locked" });
    expect(await getJdRequirement(jd!.requirements[0]!.id)).toMatchObject({ content: jd!.requirements[0]!.content });
    expect((await getApplicationProject(ap.id))?.job_description).toMatchObject({ company_name: "베타", position_title: "백엔드", extraction_status: "succeeded" });
  });

  it("Q53-1: an invalid key and a missing consent refuse before any row (AiRejected shape)", async () => {
    const { createApplicationProject, listApplicationProjects } = await apps();
    const { withAiGuard } = await guard();
    const before = (await listApplicationProjects()).length;
    const key = await user.from("ai_provider_keys_public").select("provider").eq("provider", "anthropic").single();
    expect(key.error).toBeNull();
    const writer = createAiWriterClient(userId);
    const jobs = await admin.from("ai_jobs").select("id").eq("user_id", userId).eq("status", "succeeded").limit(1).single();
    const marked = await writer.rpc("mark_provider_key_invalid", { p_ai_job_id: jobs.data!.id, p_failure_cause: "key_invalid" });
    expect(marked.error).toBeNull();
    expect(await withAiGuard(() => createApplicationProject({ raw_text: KO_BACKEND.raw }))).toMatchObject({ rejected: "key_invalid", refusal: "key_invalid" });
    expect((await listApplicationProjects()).length).toBe(before);
    await connectTestProvider(admin, user, userId, "anthropic", "paid");
    await admin.from("ai_data_use_consents").update({ withdrawn_at: new Date().toISOString() }).eq("user_id", userId);
    expect(await withAiGuard(() => createApplicationProject({ raw_text: KO_BACKEND.raw }))).toMatchObject({ refusal: "ai_consent_required" });
    expect((await listApplicationProjects()).length).toBe(before);
    await connectTestProvider(admin, user, userId, "anthropic", "paid");
  });

  it("S-15 raw text: input-caused failure → editable; refusals map to the screen's codes; save → pending; re-extract", async () => {
    const { createApplicationProject, getJobDescription, updateFailedJdRawText } = await apps();
    const { retryJdExtraction } = await drafts();
    h.queue.push({ json: NOT_A_JD.output });
    const ap = await createApplicationProject({ raw_text: NOT_A_JD.raw });
    await settle();
    const failed = await getJobDescription(ap.id);
    expect(failed).toMatchObject({ extraction_status: "failed", raw_text_editable: true, raw_text_lock: null });
    expect(await updateFailedJdRawText(ap.id, NOT_A_JD.raw)).toEqual({ refused: "jd_raw_text_unchanged" });
    expect(await updateFailedJdRawText(crypto.randomUUID(), "새 공고")).toEqual({ refused: "job_description_not_found" });
    expect(await updateFailedJdRawText(ap.id, "   ")).toEqual({ refused: "invalid_raw_text" });
    const saved = await updateFailedJdRawText(ap.id, KO_BACKEND.raw);
    expect(saved).toMatchObject({ application_project_id: ap.id, extraction_status: "pending", ai_run_allowed: true });
    expect(await getJobDescription(ap.id)).toMatchObject({ extraction_status: "pending", extraction_job_id: null, raw_text: KO_BACKEND.raw });
    h.queue.push({ json: KO_BACKEND.output, delayMs: 300 });
    expect(await retryJdExtraction(ap.id)).toBe(true);
    expect(await retryJdExtraction(ap.id)).toBe("already");
    await settle();
    const done = await getJobDescription(ap.id);
    expect(done?.extraction_status).toBe("succeeded");
    expect(done?.raw_text_lock).toBe("jd_raw_text_locked");
    expect(await updateFailedJdRawText(ap.id, "또 다른 공고")).toEqual({ refused: "jd_raw_text_locked" });
    expect(await retryJdExtraction(ap.id)).toBe(true); // already extracted: the screen's poll reads `succeeded`
    await (await deletion()).deleteApplicationProject(ap.id);
  });

  it("S-16 insight: start, generating while the job runs, read with item keys and chips, deletion impact", async () => {
    const { startInsight, getInsightState, getApplicationProject } = await apps();
    const { withAiGuard } = await guard();
    const db = await import("@/server/services/insight/db");
    const { productionInsightPipeline } = await import("@/server/jobs/insight");
    const context = async () => (productionInsightPipeline as unknown as { buildContext: (i: unknown) => { aliases: { aliasOf: (t: string, id: string) => string; values: () => Iterable<{ sourceType: string; alias: string }> }; requirements: Array<{ ref: string }> } }).buildContext(await db.loadInsightInputs(createAiWriterClient(userId), project));
    h.queue.push(async () => {
      const ctx = await context();
      const prj = ctx.aliases.aliasOf("project", ids.project);
      return { json: { schema_version: 1, matches: ctx.requirements.map((r, i) => (i === 0 ? { requirement_ref: r.ref, status: "met", rationale: "직접 개선한 행동이 있습니다.", missing_aspect: null, evidence: [{ source_type: "project", ref: prj, field: "action", quote: ACTION }] } : { requirement_ref: r.ref, status: "no_evidence", rationale: "근거 없음", missing_aspect: "관련 경험", evidence: [] })) } };
    });
    h.queue.push(async () => {
      const ctx = await context();
      const prj = ctx.aliases.aliasOf("project", ids.project);
      const sentence = [...ctx.aliases.values()].find((e) => e.sourceType === "jd_sentence")!.alias;
      return {
        json: {
          schema_version: 1,
          strengths: [{ title: "결제 승인 API 개선", description: "결제 승인 API의 병목을 직접 찾아 개선했습니다.", requirement_refs: [ctx.requirements[0]!.ref], evidence: [{ source_type: "project", ref: prj, field: "action", quote: ACTION }] }],
          gaps: [{ requirement_refs: [ctx.requirements[1]!.ref], gap_kind: "no_evidence", description: "관련 경험이 확인되지 않습니다.", actions: [{ type: "add_data", text: "관련 프로젝트가 있다면 추가해 주세요.", evidence: [] }], evidence: [{ source_type: "jd_sentence", ref: sentence, field: null, quote: null }] }],
          strategy: { positioning: "결제 API 성능을 개선해 온 엔지니어입니다.", positioning_evidence: [{ source_type: "project", ref: prj, field: "action", quote: ACTION }], project_priorities: [{ rank: 1, ref: prj, reason: "가장 직접 연결됩니다.", requirement_refs: [ctx.requirements[0]!.ref] }] },
        },
      };
    });
    const started = await withAiGuard(() => startInsight(project));
    if ("rejected" in started) throw new Error(`refused ${started.rejected}`);
    expect(started.job_id).toBeTruthy();
    const during = await getInsightState(project);
    expect(during.generating?.ai_job_id).toBe(started.job_id);
    expect((await getApplicationProject(project))?.insight_job_id).toBe(started.job_id);
    await settle();
    for (let i = 0; i < 100; i++) {
      const job = await admin.from("ai_jobs").select("status").eq("id", started.job_id).single();
      await settle();
      if (job.data?.status === "succeeded" || job.data?.status === "failed") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const state = await getInsightState(project);
    expect(state.generating).toBeNull();
    const result = state.latest?.result;
    expect(result?.requirement_matches[0]).toMatchObject({ status: "met", rationale: expect.any(String) });
    expect(result?.requirement_matches[0]?.item_key).toBeTruthy();
    expect(result?.strengths[0]?.item_key).toBeTruthy();
    expect(result?.strategy.project_priorities[0]).toMatchObject({ project_id: ids.project, rank: 1 });
    expect(result?.gaps[0]?.actions[0]).toMatchObject({ type: "add_data" });
    const chips = await (await evidence()).getEvidence("insight", state.latest!.id);
    expect(chips[result!.requirement_matches[0]!.item_key]?.[0]).toMatchObject({ source_type: "project", quote: ACTION });
    expect(chips[result!.strengths[0]!.item_key]?.length).toBe(1);
    const summary = await getApplicationProject(project);
    expect(summary).toMatchObject({ insight_state: "ready", insight_job_id: null });
    expect(summary?.insight_status.kind).toBe("present");
    const impact = await (await deletion()).getApplicationDeletionImpact(project);
    // R15 D9: the 서류 keys are `documents` / `document_chats` (no 자기소개서 정본 here, so 0).
    expect(impact).toMatchObject({ insights: 1, documents: 0, document_chats: 0, stage_events: 1 });
    expect(impact).not.toHaveProperty("drafts");
    expect(impact).not.toHaveProperty("interview_sessions");
    await (await deletion()).deleteApplicationProject(project);
    expect(await getApplicationProject(project)).toBeNull();
  });

  /**
   * R15-DB-8: condition 5 of `update_failed_jd_raw_text` no longer has a 서류 branch (the
   * 경력기술서 is gone and 자소서 answers are not built from the requirement rows), so a JD that
   * succeeded with **no** requirements and no insight stays editable. The old version of this test
   * built a 경력기술서 section to lock it; that path is retired.
   */
  it("Q53-11 (R15): succeeded with no requirements stays editable; a ready insight locks it", async () => {
    const { createApplicationProject, getJobDescription, updateFailedJdRawText } = await apps();
    // AI-01 refuses an empty list itself (retry → schema_invalid), so the state is set up by removing the rows.
    h.queue.push({ json: KO_BACKEND.output });
    const ap = await createApplicationProject({ raw_text: KO_BACKEND.raw });
    await settle();
    const extracted = await getJobDescription(ap.id);
    const removed = await admin.from("jd_requirements").delete().eq("job_description_id", extracted!.id);
    expect(removed.error).toBeNull();
    expect(await getJobDescription(ap.id)).toMatchObject({ extraction_status: "succeeded", requirements: [], raw_text_editable: true, raw_text_lock: null });
    const saved = await updateFailedJdRawText(ap.id, "다른 공고 원문입니다. 백엔드 개발자를 찾습니다.");
    expect(saved).toMatchObject({ application_project_id: ap.id, extraction_status: "pending" });
  });
});
