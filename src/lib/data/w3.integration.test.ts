import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KO_BACKEND, NOT_A_JD } from "@/server/ai/__fixtures__/AI-01/jds";
import type { CareerDescriptionContext } from "@/server/ai/pipelines/AI-03";
import type { CoverLetterContext } from "@/server/ai/pipelines/AI-04";
import type { RankingContext } from "@/server/ai/pipelines/AI-11";
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
  ctx: {} as { cd?: unknown; cl?: unknown; rank?: unknown },
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
vi.mock("@/server/jobs/drafts", async (orig) => {
  const actual = await orig<typeof import("@/server/jobs/drafts")>();
  const p = actual.productionDraftPipelines;
  const pipelines = {
    ranking: { ...p.ranking, buildContext: (i: never) => (h.ctx.rank = p.ranking.buildContext(i)) },
    careerDescription: { ...p.careerDescription, buildContext: (i: never) => (h.ctx.cd = p.careerDescription.buildContext(i)) },
    coverLetter: { ...p.coverLetter, buildContext: (i: never) => (h.ctx.cl = p.coverLetter.buildContext(i)) },
  };
  return { ...actual, productionDraftPipelines: pipelines, createDraftAiDeps: (u: never, id: string) => ({ ...actual.createDraftAiDeps(u, id), pipelines, sleep: async () => {} }) };
});

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "drafts")) : false;

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

  let noKeyProject = "";

  it("S-14 without a key: saved, default name, pending with no job; the JD is readable; AI starts are refused", async () => {
    const { createApplicationProject, getJobDescription, getApplicationProject, listApplicationProjects, startInsight } = await apps();
    const { retryJdExtraction, rankDraftSources, MockAiError } = await drafts();
    const ap = await createApplicationProject({ raw_text: KO_BACKEND.raw, deadline: "2026-12-31" });
    noKeyProject = ap.id;
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
    await expect(rankDraftSources(ap.id)).rejects.toBeInstanceOf(MockAiError);
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
    // DM A.5: with a key the name waits for the extraction (the mock names it right away, spec-gaps W3)
    expect(ap).toMatchObject({ name: null, name_source: null });
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

  const careerOutput = (blockText = "결제 승인 API 병목 쿼리 인덱스 재설계로 p95 응답 시간 800ms → 200ms 단축"): ScriptedResponse => {
    const a = (h.ctx.cd as CareerDescriptionContext).aliases;
    const exp = a.aliasOf("experience", ids.experience)!;
    const prj = a.aliasOf("project", ids.project)!;
    return {
      json: {
        schema_version: 1,
        draft_type: "career_description",
        sections: [
          {
            experience_ref: exp,
            summary: null,
            projects: [
              {
                project_ref: prj,
                role_line: { block_id: "p1-r", text: "결제 승인 개선 리드", evidence: [{ source_type: "project", ref: prj, field: "task", quote: "결제 승인 개선 리드" }], placeholders: [] },
                bullets: [{ block_id: "p1-b1", text: blockText, evidence: [{ source_type: "project", ref: prj, field: "action", quote: ACTION }], requirement_refs: [], placeholders: [] }],
              },
            ],
          },
        ],
        education_sections: [],
        standalone_projects: [],
        omitted: [],
        notes_for_user: ["확인해 주세요"],
      },
    };
  };

  const coverOutput = (): ScriptedResponse => {
    const c = h.ctx.cl as CoverLetterContext;
    const prj = c.aliases.aliasOf("project", ids.project)!;
    const exp = c.aliases.aliasOf("experience", ids.experience)!;
    return {
      json: {
        schema_version: 2,
        question_ref: "CLQ-1",
        question_class: "job_competency",
        selection_mode: c.mode,
        sources: [{ project_ref: prj, experience_ref: exp, education_ref: null, role: "primary", rationale: "직무 역량을 보여 줍니다.", requirement_refs: [], reuse_reason: null, evidence: [{ source_type: "project", ref: prj, field: "action", quote: ACTION }] }],
        paragraphs: [{ block_id: "q-p1", text: "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했고 응답 시간을 크게 줄였습니다.", evidence: [{ source_type: "project", ref: prj, field: "action", quote: ACTION }], requirement_refs: [], placeholders: [] }],
        notes_for_user: [],
      },
    };
  };

  /** What the screen's `stream.start({ endpoint, body })` runs: the client SSE reader over the real route handler. */
  async function runStream(request: { endpoint: string; body: unknown }, signal: AbortSignal = new AbortController().signal) {
    const realFetch = globalThis.fetch;
    const { POST: careerPost } = await import("@/app/api/application-projects/[id]/career-descriptions/route");
    const { POST: sectionPost } = await import("@/app/api/draft-sections/[id]/generate/route");
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (!path.startsWith("/api/")) return realFetch(url, init);
      const req = new Request(`http://local.test${path}`, { method: "POST", body: init?.body as string, headers: init?.headers });
      const id = path.split("/")[3]!;
      return path.includes("career-descriptions") ? careerPost(req, { params: Promise.resolve({ id }) } as never) : sectionPost(req, { params: Promise.resolve({ id }) } as never);
    });
    try {
      const { realBlockStream } = await import("./ai-stream-client");
      const events = [];
      for await (const e of realBlockStream(request, signal)) events.push(e);
      return events;
    } finally {
      vi.stubGlobal("fetch", realFetch);
    }
  }

  let careerDraftId = "";

  it("S-17 / S-19 career description: AI-11, stand-in row, SSE through the route, `validated` blocks, stored rows, evidence", async () => {
    const { rankDraftSources, getCareerSourceTree, createCareerDescriptionDraft, prepareCareerDescription, prepareCareerDescriptionStream, finalizeCareerDescription } = await drafts();
    const { getDraft, listDrafts, getApplicationProject } = await apps();
    const tree = await getCareerSourceTree();
    expect(tree.affiliations[0]).toMatchObject({ kind: "experience", id: ids.experience, name: "알파" });
    expect(tree.affiliations[0]!.projects[0]).toMatchObject({ id: ids.project, name: "결제 개선" });
    expect(tree.project_labels[ids.project]).toBe("알파 › 결제 개선");

    h.queue.push(() => ({ json: { schema_version: 1, rankings: [{ project_ref: (h.ctx.rank as RankingContext).projectRefs[0]!, relevance: "high", include: true, requirement_refs: [], reason: "결제 API" }] } }));
    const ranked = await rankDraftSources(project);
    expect(ranked.project_ids).toEqual([ids.project]);
    expect(ranked.ranking[0]).toMatchObject({ project_id: ids.project, relevance: "high", include: true });

    const created = await createCareerDescriptionDraft(project, { included_experience_ids: [ids.experience], included_education_ids: [], included_project_ids: [ids.project], project_order: [ids.project], selection_origin: "ai_ranking", tone: "concise" });
    careerDraftId = created.id;
    expect(created.status).toBe("generating");
    const standIn = await getDraft(project, created.id);
    expect(standIn).toMatchObject({ id: created.id, status: "generating", sections: [], draft_type: "career_description" });
    expect(await getDraft(noKeyProject, created.id)).toBeNull();
    expect(await listDrafts(project)).toEqual([]);

    // QA-W5-02: the pending cookie names its user and the project must be the user's own
    const { PENDING_CAREER_DESCRIPTION_COOKIE, decodePendingCookie } = await import("@/server/services/drafts/pending-cookie")
    const rawPending = h.jar.get(PENDING_CAREER_DESCRIPTION_COOKIE)
    const me = (await (h.user as Client).auth.getUser()).data.user!.id
    expect(decodePendingCookie(rawPending, me, created.id)).toMatchObject({ user_id: me, application_project_id: project })
    expect(decodePendingCookie(rawPending, crypto.randomUUID(), created.id)).toBeNull()
    await expect(createCareerDescriptionDraft(crypto.randomUUID(), {})).rejects.toMatchObject({ code: "not_found" })
    expect(h.jar.get(PENDING_CAREER_DESCRIPTION_COOKIE)).toBe(rawPending) // a refused create leaves the cookie alone
    // QA-W5-07: an unknown project is not_found, not a provider failure
    await expect(rankDraftSources(crypto.randomUUID())).rejects.toMatchObject({ code: "not_found" })
    await expect(rankDraftSources("not-a-uuid")).rejects.toMatchObject({ code: "not_found" })

    // an unmoved screen is refused, never given a fake draft
    expect(await prepareCareerDescription(created.id)).toBeNull();
    const plan = await prepareCareerDescriptionStream(created.id);
    expect(plan?.request.endpoint).toBe(`/api/application-projects/${project}/career-descriptions`);

    h.queue.push(() => careerOutput());
    const events = await runStream(plan!.request);
    await settle();
    const types = events.map((e) => e.type);
    expect(types).toContain("block_started");
    expect(types.at(-1)).toBe("done");
    const validated = events.find((e) => e.type === "validated");
    expect(validated).toBeDefined();
    if (validated?.type !== "validated") throw new Error("unreachable");
    // QA of W1's walker over a real AI-03 result
    expect(validated.blocks.map((b) => b.text)).toEqual(expect.arrayContaining(["결제 승인 개선 리드", expect.stringContaining("800ms")]));
    expect(validated.blocks.every((b) => typeof b.block_id === "string")).toBe(true);
    expect(validated.notes?.notes_for_user).toEqual(["확인해 주세요"]);

    expect(await finalizeCareerDescription(created.id, plan!.generation_id, { ok: true, completed_block_ids: [] })).toBeNull();
    const draft = await getDraft(project, created.id);
    expect(draft).toMatchObject({ id: created.id, status: "ready", provider: "anthropic" });
    expect(draft?.title).toContain("경력기술서");
    expect(draft?.options).toMatchObject({ included_project_ids: [ids.project], selection_origin: "ai_ranking", tone: "concise" });
    const section = draft!.sections[0]!;
    expect(section).toMatchObject({ section_kind: "experience", experience_id: ids.experience, status: "ready" });
    expect(section.ai_content?.blocks.length).toBeGreaterThan(1);
    const bullet = section.ai_content!.blocks.find((b) => b.text.includes("800ms"))!;
    expect(bullet).toMatchObject({ block_kind: "bullet", project_id: ids.project, user_modified: false, flags: [], placeholders: [] });
    expect(section.heading).toContain("알파");
    const list = await listDrafts(project);
    expect(list.map((d) => [d.id, d.status])).toEqual([[created.id, "ready"]]);
    expect(list[0]!.options).toMatchObject({ tone: "concise" });
    expect((await getApplicationProject(project))?.draft_count).toBe(1);

    const chips = await (await evidence()).getEvidenceForOwners("draft_section", [section.id]);
    const chip = chips[section.id]![bullet.block_id]![0]!;
    expect(chip).toMatchObject({ source_type: "project", status: "ok", kind_label: "프로젝트 · 행동", quote: ACTION, current_value: ACTION, to_career: true });
    expect(chip.path).toEqual(expect.arrayContaining(["알파", "결제 개선"]));
    expect(chip.href).toContain(ids.project);
    expect(await (await evidence()).getEvidence("draft_section", section.id)).toHaveProperty(bullet.block_id);
    // DM 2.8 v4.4: a STAR edit moves content_updated_at → 변경됨.
    await admin.from("projects").update({ situation: "수정" }).eq("id", ids.project);
    expect((await (await evidence()).getEvidence("draft_section", section.id))[bullet.block_id]![0]!.status).toBe("changed");
  });

  it("Q53-7 stop: a regeneration disappears and points back; a first generation goes to `composing` with its options", async () => {
    const { createCareerDescriptionDraft, prepareCareerDescriptionStream, finalizeCareerDescription } = await drafts();
    const { getDraft, listDrafts } = await apps();
    const options = { included_experience_ids: [ids.experience], included_education_ids: [], included_project_ids: [ids.project], project_order: [ids.project], selection_origin: "user" as const, tone: "detailed" as const };

    const stopRun = async (fromId: string | null) => {
      const created = await createCareerDescriptionDraft(project, options, fromId);
      const plan = (await prepareCareerDescriptionStream(created.id))!;
      h.queue.push({ hang: true });
      const ac = new AbortController();
      const streaming = runStream(plan.request, ac.signal).catch((e: Error) => e.name);
      for (let i = 0; i < 80; i++) {
        const row = await admin.from("drafts").select("id").eq("id", created.id).maybeSingle();
        if (row.data) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      // The screen's abort only closes its connection (the stubbed fetch ignores it): the stop is finalize's call.
      ac.abort();
      const stopped = await finalizeCareerDescription(created.id, plan.generation_id, { ok: false, canceled: true, completed_block_ids: [] });
      await streaming;
      await settle();
      return { created, stopped };
    };

    const regen = await stopRun(careerDraftId);
    expect(regen.stopped).toEqual({ stopped: "regeneration", back_to_draft_id: careerDraftId });
    expect(await getDraft(project, regen.created.id)).toBeNull();
    expect((await listDrafts(project)).map((d) => d.id)).toEqual([careerDraftId]);
    expect((await getDraft(project, careerDraftId))?.status).toBe("ready");

    const first = await stopRun(null);
    expect(first.stopped).toEqual({ stopped: "first_generation" });
    const composing = await getDraft(project, first.created.id);
    expect(composing).toMatchObject({ status: "composing", sections: [] });
    expect(composing?.options).toMatchObject({ tone: "detailed", included_project_ids: [ids.project] });
    expect((await listDrafts(project)).find((d) => d.status === "composing")?.id).toBe(first.created.id);
    expect((await (await deletion()).getApplicationDeletionImpact(project)).drafts).toBe(1);

    // a failed first run before a row: stand-in reads failed; 다시 시도 is a plain first generation
    const created = await createCareerDescriptionDraft(project, options);
    await finalizeCareerDescription(created.id, "x:1", { ok: false, completed_block_ids: [], error_code: "provider_unavailable" });
    expect((await getDraft(project, created.id))?.status).toBe("failed");
    const retry = await createCareerDescriptionDraft(project, options, created.id);
    const retryPlan = await prepareCareerDescriptionStream(retry.id);
    expect((retryPlan!.request.body as Record<string, unknown>).regeneratedFromId).toBeUndefined();
    h.jar.clear();
  });

  it("S-18 / S-19 cover letter: questions, sources, AI-04 through the route, edit, copy, stop leaves the body", async () => {
    const { createCoverLetterDraft, addCoverLetterQuestion, deleteDraftSection, setSectionSources, markDraftCopied, prepareCoverLetterStream, finalizeCoverLetterSection, prepareCoverLetterSection } = await drafts();
    const { getDraft, saveDraftSection, listDrafts } = await apps();
    const del = await deletion();
    const created = await createCoverLetterDraft(project);
    expect(created).toMatchObject({ draft_type: "cover_letter", status: "composing" });
    let draft = (await getDraft(project, created.id))!;
    expect(draft.sections.map((s) => s.section_kind)).toEqual(["cover_letter_question", "cover_letter_question", "cover_letter_question"]);
    expect(await del.getDraftDeletionImpact(created.id)).toEqual({ sections: 3 });

    const added = await addCoverLetterQuestion(created.id);
    expect(added).toMatchObject({ question_text: "새 문항", char_limit: 1000, count_basis: "with_spaces" });
    expect(await deleteDraftSection(created.id, added!.id)).toBe(true);
    const target = draft.sections[1]!;
    expect(await saveDraftSection(target.id, { question_text: "직무 역량", char_limit: 800, user_note: "메모" })).toMatchObject({ question_text: "직무 역량", char_limit: 800, user_note: "메모" });
    expect(await saveDraftSection(crypto.randomUUID(), { user_note: "x" })).toBeNull();

    const sources = await setSectionSources(target.id, [{ project_id: ids.project, project_detail_ids: [] }]);
    expect(sources?.[0]).toMatchObject({ project_id: ids.project, experience_id: ids.experience, origin: "user", role: "primary" });
    draft = (await getDraft(project, created.id))!;
    expect(draft.sections[1]!.source_selection_mode).toBe("user");
    expect(draft.sections[1]!.sources[0]).toMatchObject({ project_id: ids.project, project_detail_ids: [] });

    expect(await prepareCoverLetterSection(target.id)).toBeNull();
    const plan = (await prepareCoverLetterStream(target.id))!;
    h.queue.push(() => coverOutput());
    const events = await runStream(plan.request);
    await settle();
    expect(events.find((e) => e.type === "sources_selected")).toMatchObject({ sources: [expect.objectContaining({ origin: "user", role: "primary" })] });
    const validated = events.find((e) => e.type === "validated");
    if (validated?.type !== "validated") throw new Error("no validated");
    expect(validated.section_id).toBe(target.id);
    expect(validated.blocks[0]?.text).toContain("결제 승인 API");
    expect(events.at(-1)?.type).toBe("done");
    await finalizeCoverLetterSection(target.id, plan.generation_id, { ok: true, completed_block_ids: [] });

    draft = (await getDraft(project, created.id))!;
    const generated = draft.sections[1]!;
    expect(generated.status).toBe("ready");
    expect(generated.ai_content?.blocks.length).toBe(1);
    expect(generated).toMatchObject({ provider: "anthropic", generation_no: 1 });
    const edited = await saveDraftSection(target.id, { edited_content: { blocks: [{ ...generated.ai_content!.blocks[0]!, text: "고친 문장", user_modified: true }] } });
    expect(edited?.edited_content?.blocks[0]).toMatchObject({ text: "고친 문장", user_modified: true });
    expect((await getDraft(project, created.id))?.edited_at).not.toBeNull();
    await markDraftCopied(created.id);
    expect((await getDraft(project, created.id))?.first_copied_at).not.toBeNull();

    // stop a regeneration: previous body and edit stay
    const again = (await prepareCoverLetterStream(target.id))!;
    h.queue.push({ hang: true });
    const ac = new AbortController();
    const streaming = runStream(again.request, ac.signal).catch((e: Error) => e.name);
    for (let i = 0; i < 80; i++) {
      const job = await admin.from("ai_jobs").select("id").eq("target_id", target.id).in("status", ["queued", "running"]).maybeSingle();
      if (job.data) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    ac.abort();
    await finalizeCoverLetterSection(target.id, again.generation_id, { ok: false, canceled: true, completed_block_ids: [] });
    await streaming;
    await settle();
    const after = (await getDraft(project, created.id))!.sections[1]!;
    expect(await admin.from("ai_jobs").select("status").eq("target_id", target.id).order("created_at", { ascending: false }).limit(1).single().then((r) => r.data?.status)).toBe("canceled");
    // spec-gaps W3: a stopped question goes back to what it was (the DB row says `failed`, like the service read).
    expect(after.status).toBe("ready");
    expect(after.ai_content?.blocks.length).toBe(1);
    expect(after.edited_content?.blocks[0]?.text).toBe("고친 문장");

    await del.deleteDraft(created.id);
    expect((await listDrafts(project)).map((d) => d.id)).not.toContain(created.id);
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
    expect(impact).toMatchObject({ insights: 1, stage_events: 1 });
    expect(impact).not.toHaveProperty("interview_sessions");
    await (await deletion()).deleteApplicationProject(project);
    expect(await getApplicationProject(project)).toBeNull();
  });

  it("Q53-11: succeeded with no requirements and something built from it → jd_has_results", async () => {
    const { createApplicationProject, getJobDescription, updateFailedJdRawText } = await apps();
    const { createCoverLetterDraft, prepareCoverLetterStream } = await drafts();
    // AI-01 refuses an empty list itself (retry → schema_invalid), so the state is set up by removing the rows.
    h.queue.push({ json: KO_BACKEND.output });
    const ap = await createApplicationProject({ raw_text: KO_BACKEND.raw });
    await settle();
    const extracted = await getJobDescription(ap.id);
    const removed = await admin.from("jd_requirements").delete().eq("job_description_id", extracted!.id);
    expect(removed.error).toBeNull();
    expect(await getJobDescription(ap.id)).toMatchObject({ extraction_status: "succeeded", requirements: [], raw_text_editable: true, raw_text_lock: null });
    const cover = await createCoverLetterDraft(ap.id);
    const draft = (await (await apps()).getDraft(ap.id, cover.id))!;
    const plan = (await prepareCoverLetterStream(draft.sections[0]!.id))!;
    h.queue.push(() => coverOutput());
    const events = await runStream(plan.request);
    await settle();
    expect(events.at(-1)?.type).toBe("done");
    expect(await getJobDescription(ap.id)).toMatchObject({ raw_text_editable: false, raw_text_lock: "jd_has_results" });
    expect(await updateFailedJdRawText(ap.id, "다른 공고")).toEqual({ refused: "jd_has_results" });
  });
});
