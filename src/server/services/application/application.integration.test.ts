import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateApplicationProjectInput, ListApplicationProjectsInput, MoveApplicationStageInput } from "@/lib/contracts/application";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import { resetServerEnvCache } from "@/server/env";
import type { NewJob as JobInsert } from "@/server/jobs/types";
import { createSupabaseJobStore } from "@/server/jobs/supabase-store";
import { createSupabaseUsageStore } from "@/server/jobs/supabase-usage";
import { createProject, saveExperience as createExperience, getApplicationProjectDeletionImpact } from "@/server/services/career";
import { startWritingChat } from "@/server/services/writing-chat/chat";
import { KO_BACKEND } from "@/test/jd-fixtures";
import { hasPsql, hasTable, isStackReady, readLocalSupabase, runPsql } from "@/test/local-supabase";
import { getApplicationHub, getBoard, getJdView, listApplicationProjects } from "./read";
import { createApplicationProject, deleteApplicationProject, moveApplicationStage, setApplicationOutcome, updateApplicationProject, updateFailedJdRawText } from "./write";

/**
 * S5 end-to-end against the local stack, R17 (the JD is used as raw text): create (no AI gate,
 * default / user names, raw text + sentences, no extraction fields) → JD view (raw text only) →
 * stage moves + history → board / list / hub → gate chat start ownership → raw-text edit rule
 * (R17-6: the RPC is unchanged) → delete (cascade, usage kept with null project, late usage insert
 * of the deleted project kept). Skips when the stack isn't running or S5 isn't migrated.
 */

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "application_projects")) : false;

type Client = SupabaseClient<Database>;

describe.skipIf(!ready)("application projects & JD (local stack)", () => {
  const s = stack!;
  let admin: Client;
  let user: Client;
  let otherUser: Client;
  let userId = "";
  let otherId = "";
  const logs: string[] = [];

  /** A queued ai_jobs row of this user (job type / target as given). */
  function jobRow(over: Partial<JobInsert> & Pick<JobInsert, "jobType">): JobInsert {
    return {
      id: crypto.randomUUID(),
      userId,
      applicationProjectId: null,
      targetType: null,
      targetId: null,
      provider: "anthropic",
      modelTier: "default",
      connectionTier: "paid",
      params: {},
      inputHash: null,
      promptVersion: null,
      model: null,
      progress: { stage: "prepare", done: 0, total: 1 },
      meta: { runBase: 1, waitBase: 0, retries: {} },
      ...over,
    };
  }

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
    ({ id: userId, client: user } = await newUser("app"));
    ({ id: otherId, client: otherUser } = await newUser("app-other"));
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

  const projectA = crypto.randomUUID();
  const projectB = crypto.randomUUID();

  it("create without a key: default name, raw text + sentences stored, no extraction; idempotent retry", async () => {
    const created = await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: projectA, rawText: KO_BACKEND.raw }));
    expect(created).toMatchObject({ applicationProjectId: projectA, nameSource: "default", aiRunAllowed: false, created: true });
    // R17: the create result has no extraction / preview fields.
    expect(Object.keys(created).sort()).toEqual(["aiRunAllowed", "applicationProjectId", "created", "displayName", "jobDescriptionId", "name", "nameSource", "warnings"]);
    // R4 (CR-23 [가정]): the default name reads "새 자기소개서 (날짜)".
    expect(created.name).toMatch(/^새 자기소개서 \(\d{4}-\d{2}-\d{2}\)$/);
    expect(created.warnings).toEqual([]);

    const again = await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: projectA, rawText: "다른 원문" }));
    expect(again).toMatchObject({ applicationProjectId: projectA, created: false });

    const view = await getJdView(user, projectA);
    expect(view.rawText).toBe(KO_BACKEND.raw);
    expect(view.sentences).toHaveLength(13);
    for (const sentence of view.sentences) expect(view.rawText.slice(sentence.start, sentence.end)).toBe(sentence.text);
    // R17: the view is the raw text — no requirements, keywords, extraction status or failure.
    expect(view).not.toHaveProperty("requirements");
    expect(view).not.toHaveProperty("extractionStatus");
    // No ai_jobs row was created (nothing is extracted after creation).
    expect((await admin.from("ai_jobs").select("id").eq("application_project_id", projectA)).data).toEqual([]);
  });

  it("create with company + position and no key: '회사명 – 포지션명' (user); short JD warning", async () => {
    const created = await createApplicationProject(
      user,
      CreateApplicationProjectInput.parse({ id: projectB, rawText: "짧은 공고", companyName: "가나다랩", positionTitle: "데이터 엔지니어", deadline: "2026-12-01" }),
    );
    // R15 D12 (CF-9): the name rule is "{회사명} 자기소개서" — the position title is not in it.
    expect(created).toMatchObject({ name: "가나다랩 자기소개서", nameSource: "user", warnings: ["short_jd"] });
  });

  it("deletion impact of an application project (R14 cascade keys only); others → not_found", async () => {
    await expect(getApplicationProjectDeletionImpact(user, projectA)).resolves.toEqual({
      // R15 D9: `drafts` → `documents` + `document_chats`.
      cascade: { insights: 0, documents: 0, document_chats: 0, stage_events: expect.any(Number) },
    });
    await expect(getApplicationProjectDeletionImpact(otherUser, projectA)).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("other users cannot read or touch the project (RLS)", async () => {
    await expect(getJdView(otherUser, projectA)).rejects.toMatchObject({ code: "not_found" });
    await expect(moveApplicationStage(otherUser, { id: projectA, toStage: "document" })).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteApplicationProject(otherUser, projectA)).rejects.toMatchObject({ code: "not_found" });
    // A gate chat needs the other user's own project, but the application project is checked first.
    await expect(startWritingChat(otherUser, { projectId: crypto.randomUUID(), returnTarget: { applicationProjectId: projectA, feature: "insight", params: {} } })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("stage moves: 4 stages, closed + outcome, leaving closed clears it, history kept", async () => {
    const toAssignment = await moveApplicationStage(user, { id: projectA, toStage: "assignment" });
    expect(toAssignment).toEqual({ applicationProjectId: projectA, stage: "assignment", stageOutcome: null, stageChangedAt: expect.any(String), changed: true });
    const same = await moveApplicationStage(user, { id: projectA, toStage: "assignment" });
    expect(same).toMatchObject({ changed: false });
    // R14 (RM-2): the removed interview stages are rejected by the input schema.
    expect(MoveApplicationStageInput.safeParse({ id: projectA, toStage: "job_interview" }).success).toBe(false);

    await expect(moveApplicationStage(user, { id: projectA, toStage: "document", outcome: "passed" })).rejects.toMatchObject({ code: "invalid_outcome" });
    await expect(setApplicationOutcome(user, { id: projectA, outcome: "passed" })).rejects.toMatchObject({ code: "not_closed", status: 409 });

    const closed = await moveApplicationStage(user, { id: projectA, toStage: "closed", outcome: "passed" });
    expect(closed).toMatchObject({ stage: "closed", stageOutcome: "passed" });
    const cleared = await setApplicationOutcome(user, { id: projectA, outcome: null });
    expect(cleared).toMatchObject({ stageOutcome: null, changed: true });
    await setApplicationOutcome(user, { id: projectA, outcome: "failed" });
    const back = await moveApplicationStage(user, { id: projectA, toStage: "document" });
    expect(back).toMatchObject({ stage: "document", stageOutcome: null });

    const events = await user.from("application_stage_events").select("event_type, from_stage, to_stage, from_outcome, to_outcome").eq("application_project_id", projectA).order("created_at");
    expect(events.data?.map((e) => e.event_type)).toEqual(["created", "stage_changed", "stage_changed", "outcome_changed", "outcome_changed", "stage_changed"]);
    expect(events.data?.at(-1)).toMatchObject({ from_stage: "closed", to_stage: "document", from_outcome: "failed", to_outcome: null });
  });

  it("board / list / update: four columns, counts, sort, inline edit", async () => {
    const board = await getBoard(user);
    expect(board.columns.map((c) => c.stage)).toEqual(["before_apply", "document", "assignment", "closed"]);
    expect(board.total).toBe(2);
    expect(board.columns.find((c) => c.stage === "document")!.cards.map((c) => c.id)).toEqual([projectA]);
    expect(board.columns[0]!.cards[0]!.progress).toEqual({ insight: "none", draftCount: 0 });

    const byDeadline = await listApplicationProjects(user, ListApplicationProjectsInput.parse({ sort: "deadline" }));
    expect(byDeadline.map((p) => p.id)).toEqual([projectB, projectA]);
    const filtered = await listApplicationProjects(user, ListApplicationProjectsInput.parse({ stage: "document" }));
    expect(filtered.map((p) => p.id)).toEqual([projectA]);

    const updated = await updateApplicationProject(user, { id: projectA, name: "내가 붙인 이름", memo: "메모" });
    expect(updated).toMatchObject({ name: "내가 붙인 이름", nameSource: "user", memo: "메모" });
  });

  it("hub: the JD card is the raw text only (R17); a gate chat opens on an affiliated project", async () => {
    const hub = await getApplicationHub(user, projectA);
    expect(hub.jd).toEqual({ jobDescriptionId: expect.any(String) });
    expect(hub).not.toHaveProperty("lastExtractionFailure");
    // R17 [가정 R17-4]: the gate chat has no JD requirement block — starting one only needs ownership.
    const exp = await createExperience(user, { id: crypto.randomUUID(), companyName: "가나다", startMonth: "2022-01", jobPosition: "백엔드" });
    const prj = await createProject(user, { name: "결제", affiliation: { type: "experience", id: exp.id } });
    const { writingChatId } = await startWritingChat(user, { projectId: prj.id, returnTarget: { applicationProjectId: projectA, feature: "insight", params: {} } });
    expect(writingChatId).toBeTruthy();
  });

  it("QA-S5-01: symbol-only raw text is saved (0 sentences)", async () => {
    const id = crypto.randomUUID();
    const created = await createApplicationProject(user, CreateApplicationProjectInput.parse({ id, rawText: "----\n• • •" }));
    expect(created).toMatchObject({ applicationProjectId: id, created: true });
    expect((await getJdView(user, id)).sentences).toEqual([]);
    await deleteApplicationProject(user, id);
  });

  it("R17-6: the raw-text edit RPC is unchanged — a new (pending) JD is locked; a legacy input-caused failure is editable", async () => {
    const id = crypto.randomUUID();
    await createApplicationProject(user, CreateApplicationProjectInput.parse({ id, rawText: "----\n• • •" }));
    await expect(getJdView(user, id)).resolves.toMatchObject({ rawTextEditable: false, rawTextLock: "jd_raw_text_locked", rawTextEditedAt: null });
    await expect(updateFailedJdRawText(user, { id, rawText: KO_BACKEND.raw })).rejects.toMatchObject({ code: "jd_raw_text_locked", status: 409 });

    // A pre-R17 JD whose AI-01 run failed for an input cause (legacy rows, written as the local superuser).
    if (!s.dbUrl || !hasPsql()) return await deleteApplicationProject(user, id);
    const legacyJob = crypto.randomUUID();
    // psql -c doesn't interpolate :'vars' — go through a file
    const sqlFile = join(tmpdir(), `r17-legacy-${legacyJob}.sql`);
    writeFileSync(
      sqlFile,
      `insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, provider, model_tier, connection_tier, error_code, finished_at)
                select :'job'::uuid, :'uid'::uuid, 'jd_extraction', :'ap'::uuid, 'job_description', jd.id, 'failed', 'anthropic', 'light', 'paid', 'not_a_jd', now()
                  from public.job_descriptions jd where jd.application_project_id = :'ap'::uuid
                on conflict (id) do nothing;
                update public.job_descriptions set extraction_status = 'failed', extraction_job_id = :'job'::uuid where application_project_id = :'ap'::uuid;`,
    );
    const markLegacyFailure = () => runPsql(s.dbUrl!, { file: sqlFile }, { job: legacyJob, uid: userId, ap: id });
    markLegacyFailure();
    await expect(getJdView(user, id)).resolves.toMatchObject({ rawTextEditable: true, rawTextLock: null });

    await expect(updateFailedJdRawText(user, { id, rawText: "  ----\n• • •\n" })).rejects.toMatchObject({ code: "jd_raw_text_unchanged", status: 409 });
    await expect(updateFailedJdRawText(otherUser, { id, rawText: KO_BACKEND.raw })).rejects.toMatchObject({ code: "not_found", status: 404 });
    const saved = await updateFailedJdRawText(user, { id, rawText: KO_BACKEND.raw });
    expect(saved).toMatchObject({ applicationProjectId: id, aiRunAllowed: false, warnings: [] });
    const after = await getJdView(user, id);
    expect(after).toMatchObject({ rawText: KO_BACKEND.raw, rawTextEditable: false, rawTextLock: "jd_raw_text_locked" });
    expect(Date.parse(after.rawTextEditedAt!)).toBe(Date.parse(saved.rawTextEditedAt));
    expect(after.sentences).toHaveLength(13);

    // Condition 1: any job type in flight on the project locks it.
    markLegacyFailure();
    await createSupabaseJobStore(createAiWriterClient(userId)).insert(jobRow({ jobType: "insight", applicationProjectId: id }));
    await expect(getJdView(user, id)).resolves.toMatchObject({ rawTextEditable: false, rawTextLock: "jd_job_in_progress" });
    await deleteApplicationProject(user, id);
  });

  it("delete: in-flight job cancel requested, cascade, usage kept with null project; late usage insert kept", async () => {
    const writer = createAiWriterClient(userId);
    const store = createSupabaseJobStore(writer);
    const usage = createSupabaseUsageStore(writer);
    const inflight = crypto.randomUUID();
    await store.insert(jobRow({ id: inflight, jobType: "insight", applicationProjectId: projectB, targetType: "application_project", targetId: projectB }));
    const usageRow = (outcome: "succeeded" | "failed", errorCode: "canceled" | null) => ({
      occurredAt: new Date().toISOString(),
      feature: "insight" as const,
      jobType: "insight" as const,
      aiJobId: inflight,
      callKey: "insight.match",
      applicationProjectId: projectB,
      provider: "anthropic" as const,
      model: "claude-sonnet-5-5",
      modelTier: "default" as const,
      connectionTier: "paid" as const,
      usage: { inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5, reasoningTokens: null, usageSource: "provider_reported" as const },
      outcome,
      errorCode,
      priceTableVersion: "unpriced",
      inputCostUsd: 0,
      outputCostUsd: 0,
      estimatedCostUsd: 0,
    });
    await usage.insert(usageRow("succeeded", null));
    const usageBefore = await admin.from("ai_usage_records").select("id").eq("application_project_id", projectB);
    expect(usageBefore.data!.length).toBeGreaterThan(0);

    const res = await deleteApplicationProject(user, projectB);
    expect(res).toEqual({ applicationProjectId: projectB, canceledJobs: 1 });

    expect((await admin.from("ai_jobs").select("id").eq("application_project_id", projectB)).data).toEqual([]);
    expect((await admin.from("job_descriptions").select("id").eq("application_project_id", projectB)).data).toEqual([]);
    expect((await admin.from("application_stage_events").select("id").eq("application_project_id", projectB)).data).toEqual([]);
    const kept = await admin.from("ai_usage_records").select("id, application_project_id").in("id", usageBefore.data!.map((u) => u.id));
    expect(kept.data!.every((u) => u.application_project_id === null)).toBe(true);

    // A runner that finishes its call after the delete still records the call (FK → null project).
    await usage.insert(usageRow("failed", "canceled"));
    const late = await admin.from("ai_usage_records").select("application_project_id").eq("ai_job_id", inflight);
    expect(late.data).toEqual([{ application_project_id: null }, { application_project_id: null }]);

    await expect(deleteApplicationProject(user, projectB)).rejects.toMatchObject({ code: "not_found" });
  });
});
