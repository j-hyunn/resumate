import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateApplicationProjectInput } from "@/lib/contracts/application";
import { SaveAchievementInput, SaveExperienceInput, SaveProjectDetailInput, SaveProjectInput } from "@/lib/contracts/career";
import type { DraftStreamEvent } from "@/lib/contracts/draft";
import { KO_BACKEND } from "@/server/ai/__fixtures__/AI-01/jds";
import { loadCareerRows } from "@/server/ai/context-pack/career-rows";
import { ProviderError } from "@/server/ai/errors";
import type { Llm } from "@/server/ai/llm";
import type { CareerDescriptionContext } from "@/server/ai/pipelines/AI-03";
import type { CoverLetterContext } from "@/server/ai/pipelines/AI-04";
import type { RankingContext } from "@/server/ai/pipelines/AI-11";
import type { ProviderAdapter } from "@/server/ai/providers/types";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import { resetServerEnvCache } from "@/server/env";
import { productionDraftPipelines } from "@/server/jobs/drafts";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext } from "@/server/jobs/provider-context";
import { createSupabaseJobStore } from "@/server/jobs/supabase-store";
import { createSupabaseUsageStore } from "@/server/jobs/supabase-usage";
import { createJdExtractionDb } from "@/server/services/application/db";
import { ensureJdExtracted } from "@/server/services/application/extraction";
import { loadProgress } from "@/server/services/application/read";
import { createApplicationProject, deleteApplicationProject } from "@/server/services/application/write";
import { getDeletionImpact, saveAchievement, saveExperience, saveProject, saveProjectDetail } from "@/server/services/career";
import { normalizeErrorEvent } from "@/server/sse";
import { productionJdExtractorForTests } from "@/test/jd-extraction-fakes";
import { createScriptedAdapter, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";
import { prepareCareerDescription, runCareerDescription } from "./career-description";
import { createCoverLetterDraft, deleteCoverLetterQuestion, setSectionSources } from "./cover-letter";
import { prepareCoverLetterSection, runCoverLetterSection } from "./cover-letter";
import { createDraftStore } from "./db";
import { deleteDraft, markDraftCopied, saveSectionEdit } from "./edit";
import { rankDraftSourcesForProject } from "./ranking";
import { getDraft, listDrafts } from "./read";
import type { DraftAiDeps, DraftPipelines } from "./types";

/**
 * S7 end-to-end against the local stack (S7 plan API 6 "로컬 DB 통합"):
 * ranking (R1 A13: unextracted JD → failed answer without a call; the screen's
 * separate extraction; AI-11 failure → R1 A23 empty answer, selectionOrigin user;
 * then AI-11 → ai_ranking + ai_jobs.output → reuse) → AI-03 career description (real
 * pipeline, scripted model output built from the same context) → evidence →
 * regenerate = a new row → cover letter seed → AI-04 generate → user sources →
 * edit → regenerate clears the edit → copy → progress → deletion impact →
 * project delete cascades. Real RPCs, triggers, RLS. Skips without S7 tables.
 */

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "drafts")) : false;

type Client = SupabaseClient<Database>;
const FAKE_KEY = "sk-ant-FAKE-drafts-integration-0000";
type Lazy = ScriptedResponse | (() => ScriptedResponse);

function lazyAdapter(queue: Lazy[]): ProviderAdapter {
  const one = (): ProviderAdapter => {
    const next = queue.shift();
    if (!next) throw new Error("lazy adapter: no response left");
    return createScriptedAdapter("anthropic", [typeof next === "function" ? next() : next], Date.now).adapter;
  };
  return {
    id: "anthropic",
    async *stream(call) {
      yield* one().stream(call);
    },
    async complete(call) {
      return one().complete(call);
    },
    verify: async () => ({ ok: true, usage: { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: null, usageSource: "provider_reported" } }),
  };
}

describe.skipIf(!ready)("drafts (local stack)", { timeout: 30_000 }, () => {
  const s = stack!;
  let admin: Client;
  let user: Client;
  let otherUser: Client;
  let userId = "";
  let otherId = "";
  const logs: string[] = [];
  const queue: Lazy[] = [];
  const project = crypto.randomUUID();
  const ids = { experience: crypto.randomUUID(), project: crypto.randomUUID(), detail: crypto.randomUUID(), achievement: crypto.randomUUID() };
  const ACTION = "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다";
  const captured: { rank?: RankingContext; cd?: CareerDescriptionContext; cl?: CoverLetterContext } = {};

  const pipelines: DraftPipelines = {
    ranking: { ...productionDraftPipelines.ranking, buildContext: (i) => (captured.rank = productionDraftPipelines.ranking.buildContext(i) as RankingContext) },
    careerDescription: {
      ...productionDraftPipelines.careerDescription,
      buildContext: (i) => (captured.cd = productionDraftPipelines.careerDescription.buildContext(i) as CareerDescriptionContext),
    },
    coverLetter: { ...productionDraftPipelines.coverLetter, buildContext: (i) => (captured.cl = productionDraftPipelines.coverLetter.buildContext(i) as CoverLetterContext) },
  };

  function deps(client: Client, uid: string): DraftAiDeps {
    const writer = createAiWriterClient(uid);
    const adapter = lazyAdapter(queue);
    const createLlm = (input: Parameters<ReturnType<typeof scriptedLlmFactory>>[0]): Llm => scriptedLlmFactory(adapter, Date.now)(input);
    const keySource = createStaticKeySource(FAKE_KEY, () => new ProviderError("key_missing"));
    const providerContext = createStaticProviderContext({ provider: "anthropic", connectionTier: "paid", keyStatus: "valid" });
    const log = (event: string, fields: Record<string, unknown>) => void logs.push(JSON.stringify({ event, ...fields }));
    return {
      userId: uid,
      user: client,
      writer,
      store: createSupabaseJobStore(writer),
      usage: createSupabaseUsageStore(writer),
      providerContext,
      keySource,
      keyStatus: createRecordingKeyStatusReporter(),
      runGate: null,
      createLlm,
      drafts: createDraftStore(writer),
      pipelines,
      loadCareerRows: (db) => loadCareerRows(db as AiWriterSupabaseClient),
      // Retry waits (C-11.3) are not slept in tests.
      sleep: async () => {},
      log,
    };
  }


  /** The separate extraction request the screen sends first (R1 A13: never inside generation / ranking). */
  async function extractJd(client: Client, uid: string, id: string) {
    const writer = createAiWriterClient(uid);
    const providerContext = createStaticProviderContext({ provider: "anthropic", connectionTier: "paid", keyStatus: "valid" });
    const adapter = lazyAdapter(queue);
    const createLlm = (input: Parameters<ReturnType<typeof scriptedLlmFactory>>[0]): Llm => scriptedLlmFactory(adapter, Date.now)(input);
    return ensureJdExtracted(
      {
        userId: uid,
        jds: createJdExtractionDb(client, writer),
        store: createSupabaseJobStore(writer),
        usage: createSupabaseUsageStore(writer),
        providerContext,
        keySource: createStaticKeySource(FAKE_KEY, () => new ProviderError("key_missing")),
        keyStatus: createRecordingKeyStatusReporter(),
        runGate: null,
        createLlm,
        extract: productionJdExtractorForTests,
        log: () => {},
      },
      id,
    );
  }

  const collect = () => {
    const events: DraftStreamEvent[] = [];
    return { events, emit: (e: unknown) => void events.push(normalizeErrorEvent(e as { type: string }) as DraftStreamEvent) };
  };

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

  const careerOutput = (): ScriptedResponse => {
    const a = captured.cd!.aliases;
    const exp = a.aliasOf("experience", ids.experience)!;
    const prj = a.aliasOf("project", ids.project)!;
    const det = a.aliasOf("project_detail", ids.detail)!;
    const ach = a.aliasOf("achievement", ids.achievement)!;
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
                role_line: { block_id: "p1-r", text: "리드", evidence: [{ source_type: "project", ref: prj, field: "role", quote: null }], placeholders: [] },
                bullets: [
                  {
                    block_id: "p1-b1",
                    text: "결제 승인 API 병목 쿼리 인덱스 재설계로 p95 응답 시간 800ms → 200ms 단축",
                    evidence: [
                      { source_type: "project_detail", ref: det, field: "action", quote: ACTION },
                      { source_type: "achievement", ref: ach, field: "metric", quote: null },
                    ],
                    requirement_refs: [],
                    placeholders: [],
                  },
                ],
              },
            ],
          },
        ],
        education_sections: [],
        standalone_projects: [],
        omitted: [],
        notes_for_user: [],
      },
    };
  };

  const PARAGRAPH = "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했고 응답 시간을 크게 줄였습니다.";
  const coverOutput = (): ScriptedResponse => {
    const a = captured.cl!.aliases;
    const exp = a.aliasOf("experience", ids.experience)!;
    const prj = a.aliasOf("project", ids.project)!;
    const det = a.aliasOf("project_detail", ids.detail)!;
    return {
      json: {
        schema_version: 2,
        question_ref: "CLQ-1",
        question_class: "job_competency",
        selection_mode: captured.cl!.mode,
        sources: [
          {
            project_ref: prj,
            experience_ref: exp,
            education_ref: null,
            detail_refs: [det],
            role: "primary",
            rationale: "결제 승인 API 개선 경험이 직무 역량을 보여 줍니다.",
            requirement_refs: [],
            reuse_reason: null,
            evidence: [{ source_type: "project_detail", ref: det, field: "action", quote: ACTION }],
          },
        ],
        paragraphs: [{ block_id: "q-p1", text: PARAGRAPH, evidence: [{ source_type: "project_detail", ref: det, field: "action", quote: ACTION }], requirement_refs: [], placeholders: [] }],
        notes_for_user: [],
      },
    };
  };

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
  afterEach(() => vi.restoreAllMocks());

  beforeAll(async () => {
    admin = createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    ({ id: userId, client: user } = await newUser("drafts"));
    ({ id: otherId, client: otherUser } = await newUser("drafts-other"));
    await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: project, rawText: KO_BACKEND.raw }));
    await saveExperience(user, SaveExperienceInput.parse({ id: ids.experience, companyName: "알파", startMonth: "2021-03", jobPosition: "백엔드", isCurrent: true }));
    await saveProject(user, SaveProjectInput.parse({ id: ids.project, affiliation: { type: "experience", id: ids.experience }, name: "결제 개선", role: "리드", startMonth: "2024-02" }));
    await saveProjectDetail(user, SaveProjectDetailInput.parse({ id: ids.detail, projectId: ids.project, title: "응답 속도", situation: "피크 시간 응답이 느렸다", action: ACTION }));
    await saveAchievement(user, SaveAchievementInput.parse({ id: ids.achievement, target: { type: "project_detail", id: ids.detail }, metricName: "p95", valueBefore: 800, valueAfter: 200, unit: "ms" }));
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

  let careerDraftId = "";
  let coverDraftId = "";
  let competencySectionId = "";

  it("ranking: A13 no extraction inside, A23 failure → empty user answer; then AI-11 → ai_ranking + output; then reuse", async () => {
    const empty = { includedExperienceIds: [], includedEducationIds: [], includedProjectIds: [], projectOrder: [] };
    // A13: requirements missing → failed answer, no job, no provider call; generation → 409 jd_not_extracted.
    const before = await rankDraftSourcesForProject(deps(user, userId), project, { refresh: false });
    expect(before).toMatchObject({ kind: "ok", data: { selectionOrigin: "user", failed: true, reason: "jd_not_extracted", jobId: null, ...empty } });
    await expect(
      prepareCareerDescription(deps(user, userId), project, { includedExperienceIds: [ids.experience], includedEducationIds: [], includedProjectIds: [ids.project], projectOrder: [ids.project], selectionOrigin: "user" }),
    ).rejects.toMatchObject({ code: "jd_not_extracted", status: 409 });
    const noJobs = await admin.from("ai_jobs").select("id").eq("user_id", userId);
    expect(noJobs.data).toEqual([]);

    // The screen's separate extraction request (AI-01).
    queue.push({ json: KO_BACKEND.output });
    expect(await extractJd(user, userId, project)).toMatchObject({ status: "succeeded" });

    queue.push({ error: "provider_unavailable" }, { error: "provider_unavailable" }, { error: "provider_unavailable" });
    const first = await rankDraftSourcesForProject(deps(user, userId), project, { refresh: false });
    expect(first).toMatchObject({ kind: "ok", data: { selectionOrigin: "user", failed: true, reason: "provider_unavailable", ranking: null, ...empty } });
    expect(queue).toHaveLength(0);

    queue.push(() => ({ json: { schema_version: 1, rankings: [{ project_ref: captured.rank!.projectRefs[0]!, relevance: "high", include: true, requirement_refs: [], reason: "결제 API" }] } }));
    const second = await rankDraftSourcesForProject(deps(user, userId), project, { refresh: false });
    expect(second).toMatchObject({ kind: "ok", data: { selectionOrigin: "ai_ranking", failed: false, reused: false, includedProjectIds: [ids.project], includedExperienceIds: [ids.experience] } });
    if (second.kind !== "ok") throw new Error("unreachable");
    const job = await admin.from("ai_jobs").select("status, output, target_type").eq("id", second.data.jobId!).single();
    expect(job.data).toMatchObject({ status: "succeeded", target_type: "application_project" });
    expect(job.data!.output).toBeTruthy();

    const third = await rankDraftSourcesForProject(deps(user, userId), project, { refresh: false });
    expect(third).toMatchObject({ data: { selectionOrigin: "ai_ranking", reused: true, jobId: second.data.jobId } });

    const usage = await admin.from("ai_usage_records").select("feature, job_type").eq("user_id", userId).order("occurred_at");
    expect(usage.data!.map((u) => u.feature)).toEqual(["jd_extraction", "career_description", "career_description", "career_description", "career_description"]);
  });

  it("career description: SSE events, stored draft with sections + evidence, options.ranking copied, read view", async () => {
    queue.push(careerOutput);
    const d = deps(user, userId);
    const prepared = await prepareCareerDescription(d, project, {
      includedExperienceIds: [ids.experience],
      includedEducationIds: [],
      includedProjectIds: [ids.project],
      projectOrder: [ids.project],
      selectionOrigin: "ai_ranking",
    });
    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") return;
    const { events, emit } = collect();
    await runCareerDescription(d, prepared, emit);
    expect(events.at(-1)).toMatchObject({ type: "done", reused: false });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["generation_started", "block_completed", "validated"]));
    careerDraftId = (events.at(-1) as { draftId: string }).draftId;

    const view = await getDraft(user, careerDraftId);
    expect(view).toMatchObject({ draftType: "career_description", status: "ready", badge: { provider: "anthropic", modelTier: "default" }, failures: [], activeJobs: [] });
    expect(view.options).toMatchObject({ selectionOrigin: "ai_ranking", includedProjectIds: [ids.project] });
    expect(view.options!.ranking).toHaveLength(1);
    const blocks = view.sections.flatMap((sec) => sec.blocks);
    expect(blocks.map((b) => b.blockKind)).toEqual(expect.arrayContaining(["header", "role_line", "bullet"]));
    const bullet = blocks.find((b) => b.blockKind === "bullet")!;
    expect(bullet.evidence.map((c) => c.kindLabel)).toEqual(expect.arrayContaining(["상세 내용 · 행동"]));

    const all = logs.join("\n");
    expect(all).not.toContain(ACTION);
    expect(all).not.toContain(FAKE_KEY);
  });

  it("QA-S7-01: a second career description on the same project while one runs → 409 with its job id (DB index too)", async () => {
    const d = deps(user, userId);
    const input = { includedExperienceIds: [ids.experience], includedEducationIds: [], includedProjectIds: [ids.project], projectOrder: [ids.project], selectionOrigin: "user" as const, tone: "detailed" as const };
    const first = await prepareCareerDescription(d, project, input);
    if (first.kind !== "ready" || !first.run) throw new Error("not ready");
    const err = await prepareCareerDescription(d, project, input).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "career_description_in_progress", status: 409, details: { jobId: first.run.job.id } });
    // The partial unique index refuses a racing insert (23505 → conflict → 409 above).
    const store = createSupabaseJobStore(createAiWriterClient(userId));
    await expect(
      store.insert({
        id: crypto.randomUUID(),
        userId,
        jobType: "career_description",
        applicationProjectId: project,
        targetType: "draft",
        targetId: crypto.randomUUID(),
        provider: "anthropic",
        modelTier: "default",
        connectionTier: "paid",
        params: {},
        inputHash: null,
        promptVersion: null,
        model: null,
        progress: { stage: "generate", done: 0, total: 1 },
        meta: { runBase: 1, waitBase: 0, retries: {} },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await first.run.fail({ code: "canceled", retryAfter: null, quotaResetsAt: null });
    await first.run.close();
  });

  it("same input → done(reused) without a call; 다시 생성 → a new draft row, the old one kept", async () => {
    const d = deps(user, userId);
    const input = { includedExperienceIds: [ids.experience], includedEducationIds: [], includedProjectIds: [ids.project], projectOrder: [ids.project], selectionOrigin: "ai_ranking" as const };
    const again = await prepareCareerDescription(d, project, input);
    expect(again.kind === "ready" && again.reusedDraftId).toBe(careerDraftId);

    queue.push(careerOutput);
    const regen = await prepareCareerDescription(d, project, { ...input, regeneratedFromId: careerDraftId });
    if (regen.kind !== "ready") throw new Error("not ready");
    const { events, emit } = collect();
    await runCareerDescription(d, regen, emit);
    const newId = (events.at(-1) as { draftId: string }).draftId;
    expect(newId).not.toBe(careerDraftId);
    const list = await listDrafts(user, project);
    expect(list.drafts.map((x) => x.id)).toEqual([newId, careerDraftId]);
    expect(list.drafts[0]).toMatchObject({ regeneratedFromId: careerDraftId, status: "ready" });
  });

  it("cover letter: seed 3 questions (no key), generate one, user sources, edit, regenerate clears the edit", async () => {
    const created = await createCoverLetterDraft(user, project);
    coverDraftId = created.draftId;
    let view = await getDraft(user, coverDraftId);
    expect(view.sections.map((x) => x.templateKey)).toEqual(["motivation", "job_competency", "future_plan"]);
    expect(view.status).toBe("composing");
    competencySectionId = view.sections[1]!.id;
    // Fit the limit so no adjustment call runs (±10%).
    await user.from("draft_sections").update({ char_limit: [...PARAGRAPH].length }).eq("id", competencySectionId);

    queue.push(coverOutput);
    const d = deps(user, userId);
    const prepared = await prepareCoverLetterSection(d, competencySectionId);
    if (prepared.kind !== "ready") throw new Error("not ready");
    const first = collect();
    await runCoverLetterSection(d, prepared, first.emit);
    expect(first.events.map((e) => e.type)).toEqual(expect.arrayContaining(["generation_started", "sources_selected", "block_completed", "validated", "done"]));

    view = await getDraft(user, coverDraftId);
    const q = view.sections[1]!;
    expect(q).toMatchObject({ status: "ready", generationNo: 1, questionClass: "job_competency", sourceSelectionMode: "ai" });
    expect(q.sources[0]).toMatchObject({ projectId: ids.project, origin: "ai", role: "primary", projectName: "결제 개선", affiliationName: "알파" });
    expect(view.status).toBe("composing"); // other questions not generated yet

    // C-11 change → user mode.
    await setSectionSources(user, { sectionId: competencySectionId, sources: [{ projectId: ids.project, projectDetailIds: [ids.detail] }] });
    view = await getDraft(user, coverDraftId);
    expect(view.sections[1]).toMatchObject({ sourceSelectionMode: "user" });
    expect(view.sections[1]!.sourcesModifiedAt).not.toBeNull();

    // Edit, then regenerate in user mode: the edit is cleared (D-DM-06), generation_no + 1.
    const blockId = view.sections[1]!.blocks[0]!.blockId;
    const edited = await saveSectionEdit(user, { sectionId: competencySectionId, blocks: [{ blockId, text: "직접 고친 문단" }] });
    expect(edited.blocks[0]).toMatchObject({ text: "직접 고친 문단", userModified: true });
    expect((await getDraft(user, coverDraftId)).editedAt).not.toBeNull();

    queue.push(coverOutput);
    const again = await prepareCoverLetterSection(d, competencySectionId);
    if (again.kind !== "ready") throw new Error("not ready");
    await runCoverLetterSection(d, again, () => {});
    expect(captured.cl!.mode).toBe("user");
    view = await getDraft(user, coverDraftId);
    expect(view.sections[1]).toMatchObject({ generationNo: 2, edited: false, sourceSelectionMode: "user", sourcesModifiedAt: null });
    expect(view.sections[1]!.sources[0]).toMatchObject({ origin: "user" });

    const copied = await markDraftCopied(user, coverDraftId);
    expect(copied.firstCopiedAt).toBeTruthy();
  });

  it("question delete keeps ≥ 1; other users see nothing; progress counts drafts", async () => {
    const view = await getDraft(user, coverDraftId);
    await deleteCoverLetterQuestion(user, view.sections[0]!.id);
    await deleteCoverLetterQuestion(user, view.sections[2]!.id);
    await expect(deleteCoverLetterQuestion(user, competencySectionId)).rejects.toMatchObject({ code: "last_question" });

    await expect(getDraft(otherUser, coverDraftId)).rejects.toMatchObject({ code: "not_found" });
    await expect(listDrafts(otherUser, project)).rejects.toMatchObject({ code: "not_found" });

    const progress = await loadProgress(user, [project]);
    expect(progress.get(project)?.draftCount).toBe(3);
  });

  it("deletion impact counts drafts and sections; deleteDraft; project delete cascades", async () => {
    const impact = await getDeletionImpact(user, { entityType: "project", entityId: ids.project, affiliationMode: "keep_projects" });
    const row = impact.affected_results.by_application_project.find((r) => r.application_project_id === project)!;
    expect(row.drafts + row.draft_sections).toBeGreaterThan(0);

    await deleteDraft(user, careerDraftId);
    expect((await listDrafts(user, project)).drafts).toHaveLength(2);

    await deleteApplicationProject(user, project);
    const rows = await admin.from("drafts").select("id").eq("application_project_id", project);
    expect(rows.data).toEqual([]);
    const links = await admin.from("evidence_links").select("id").eq("owner_type", "draft_section").eq("user_id", userId);
    expect(links.data).toEqual([]);
  });
});
