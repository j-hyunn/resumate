import type { ReadinessFeature } from "@/lib/contracts/career";
import type {
  AddCoverLetterQuestionInput,
  DeleteQuestionResult,
  DraftStreamEvent,
  ReorderQuestionsResult,
  SetSectionSourcesInput,
  UpdateCoverLetterQuestionInput,
} from "@/lib/contracts/draft";
import { DEFAULT_CHAR_LIMIT } from "@/lib/contracts/draft";
import type { AiErrorCode } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { resolveModel } from "@/server/ai/providers/models";
import { USAGE_SETTLE_WORST_MS } from "@/server/jobs/constants";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { getDataReadiness } from "@/server/services/career";
import type { z } from "zod";
import { assertNotGenerating } from "./active";
import { AiRun, asCancelIfStopped, isTargetGone, openAiJob, type CallFailure } from "./ai-run";
import { REQUEST_BUDGET_MS, assertJdExtracted } from "./career-description";
import { DraftRpcError, loadDraftJd, loadLatestInsightSignal, loadRequirements, type DraftJd } from "./db";
import type { CoverLetterQuestionInput, DraftAiDeps, PipelineStreamEvent, UserSourceInput } from "./types";

/**
 * S7 cover letter (AI-04; F-DOC-02/03/08/09; S-18 / S-19 / C-11; S7 plan
 * "계약 — API" 3).
 *
 * Question setup (no key, D-36): user-session RPCs `create_cover_letter_draft`
 * (기본 3문항 시드), `add_cover_letter_question`, `delete_cover_letter_question`
 * (최소 1), `reorder_cover_letter_questions`, `set_section_sources`, and the
 * column-granted update of question text / limit / basis / memo.
 *
 * Generation (`POST /api/draft-sections/{id}/generate`, SSE, one question per
 * request — "전체 생성" = the screen calls it per question in order, so one
 * function run stays under 60 s [가정 S7-1]):
 *   prepare: section → readiness (422) → JD requirements (R1 A13: 409
 *   `extraction_in_progress` / `jd_not_extracted`, no provider call — the
 *   screen extracts first) → ai_jobs `cover_letter` (target = the question; one in flight
 *   per question → 409 `section_in_progress`) + run gate (blocked → one SSE
 *   `error`, F-AI-08 lock).
 *   run: begin_cover_letter_section (whole 58 s budget, A13) →
 *   `generation_started` → AI-04 stream (`sources_selected` → paragraph block
 *   events → (`adjusting_length`)) → persist = complete_cover_letter_section
 *   (replaces the AI text, clears the edited text [가정 S7-4]) → `validated`
 *   → complete_ai_job → `done`. Failure → fail_draft_section + job failed + `error`.
 */

export const COVER_LETTER_JOB_TYPE = "cover_letter" as const;

const notFound = () => new AppError("not_found", "문항을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });
const sectionInProgress = () => new AppError("section_in_progress", "이 문항의 초안을 만들고 있어요. 잠시 후 다시 확인해 주세요.", { status: 409 });

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// ---------------- question setup (user session) ----------------

export async function createCoverLetterDraft(user: UserSupabaseClient, applicationProjectId: string): Promise<{ draftId: string; created: boolean }> {
  const { data, error } = await user.rpc("create_cover_letter_draft", { p_application_project_id: applicationProjectId });
  if (error) throw mapDbError(error);
  const r = obj(data);
  const draftId = str(r.draft_id);
  if (!draftId) throw new AppError("internal_error", undefined, { status: 500 });
  return { draftId, created: r.created !== false };
}

export async function addCoverLetterQuestion(user: UserSupabaseClient, input: z.output<typeof AddCoverLetterQuestionInput>): Promise<{ draftId: string; sectionId: string }> {
  const { data, error } = await user.rpc("add_cover_letter_question", {
    p_draft_id: input.draftId,
    p_question_text: input.questionText,
    p_char_limit: input.charLimit ?? DEFAULT_CHAR_LIMIT,
    p_count_basis: input.countBasis ?? "with_spaces",
  });
  if (error) throw mapDbError(error);
  const r = obj(data);
  const sectionId = str(r.section_id);
  if (!sectionId) throw new AppError("internal_error", undefined, { status: 500 });
  if (input.userNote) await updateCoverLetterQuestion(user, { sectionId, userNote: input.userNote });
  return { draftId: input.draftId, sectionId };
}

type SectionRow = {
  id: string;
  draft_id: string;
  section_kind: string;
  status: string;
  question_text: string | null;
  template_key: string | null;
  char_limit: number | null;
  count_basis: string | null;
  user_note: string | null;
  source_selection_mode: string | null;
  updated_at: string;
};

const SECTION_COLUMNS = "id, draft_id, section_kind, status, question_text, template_key, char_limit, count_basis, user_note, source_selection_mode, updated_at";

async function loadQuestion(db: UserSupabaseClient | DraftAiDeps["writer"], sectionId: string): Promise<SectionRow & { application_project_id: string }> {
  const { data, error } = await db.from("draft_sections").select(SECTION_COLUMNS).eq("id", sectionId).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data || data.section_kind !== "cover_letter_question") throw notFound();
  const { data: draft, error: draftError } = await db.from("drafts").select("application_project_id, draft_type").eq("id", data.draft_id).maybeSingle();
  if (draftError) throw mapDbError(draftError);
  if (!draft || draft.draft_type !== "cover_letter") throw notFound();
  return { ...(data as SectionRow), application_project_id: draft.application_project_id };
}

/** S-18 inline edit (column grant; `template_key` is kept — 문구만 수정, A.10). */
export async function updateCoverLetterQuestion(user: UserSupabaseClient, input: z.output<typeof UpdateCoverLetterQuestionInput>): Promise<{ draftId: string; sectionId: string }> {
  const current = await loadQuestion(user, input.sectionId);
  await assertNotGenerating(user, { sectionId: input.sectionId });
  const patch: { question_text?: string; char_limit?: number | null; count_basis?: string; user_note?: string | null } = {};
  if (input.questionText !== undefined) patch.question_text = input.questionText;
  if (input.charLimit !== undefined) patch.char_limit = input.charLimit;
  if (input.countBasis !== undefined) patch.count_basis = input.countBasis;
  if (input.userNote !== undefined) patch.user_note = input.userNote === null || input.userNote.trim() === "" ? null : input.userNote;
  if (Object.keys(patch).length > 0) {
    const { data, error } = await user.from("draft_sections").update(patch).eq("id", input.sectionId).select("id");
    if (error) throw mapDbError(error);
    if (!data || data.length === 0) throw notFound();
  }
  return { draftId: current.draft_id, sectionId: input.sectionId };
}

export async function deleteCoverLetterQuestion(user: UserSupabaseClient, sectionId: string): Promise<DeleteQuestionResult> {
  await assertNotGenerating(user, { sectionId });
  const { data, error } = await user.rpc("delete_cover_letter_question", { p_section_id: sectionId });
  if (error) throw mapDbError(error);
  const r = obj(data);
  return { draftId: str(r.draft_id) ?? "", sectionId, remaining: typeof r.remaining === "number" ? r.remaining : 0 };
}

export async function reorderCoverLetterQuestions(user: UserSupabaseClient, draftId: string, sectionIds: string[]): Promise<ReorderQuestionsResult> {
  const { data, error } = await user.rpc("reorder_cover_letter_questions", { p_draft_id: draftId, p_section_ids: sectionIds });
  if (error) throw mapDbError(error);
  const r = obj(data);
  const saved = Array.isArray(r.section_ids) ? r.section_ids.filter((x): x is string => typeof x === "string") : sectionIds;
  return { draftId, sectionIds: saved };
}

/** C-11 변경 → `origin = 'user'` rows, `source_selection_mode = 'user'`, `sources_modified_at`. */
export async function setSectionSources(user: UserSupabaseClient, input: z.output<typeof SetSectionSourcesInput>): Promise<{ draftId: string; sectionId: string }> {
  const current = await loadQuestion(user, input.sectionId);
  await assertNotGenerating(user, { sectionId: input.sectionId });
  const sources = input.sources.map((s) => ({
    ...(s.projectId ? { project_id: s.projectId } : {}),
    ...(s.experienceId ? { experience_id: s.experienceId } : {}),
    ...(s.educationId ? { education_id: s.educationId } : {}),
    ...(s.projectDetailIds ? { project_detail_ids: s.projectDetailIds } : {}),
    ...(s.role ? { role: s.role } : {}),
    ...(s.requirementIds ? { requirement_ids: s.requirementIds } : {}),
  }));
  const { error } = await user.rpc("set_section_sources", { p_section_id: input.sectionId, p_sources: sources });
  if (error) throw mapDbError(error);
  return { draftId: current.draft_id, sectionId: input.sectionId };
}

// ---------------- generation (AI-04, SSE) ----------------

type Emit = (event: DraftStreamEvent | { type: "error"; code: AiErrorCode | "internal_error"; retryAfter?: string | null; quotaResetsAt?: string | null }) => void;

export type PreparedCoverLetter =
  | {
      kind: "ready";
      startedAt: number;
      section: SectionRow & { application_project_id: string };
      jd: DraftJd;
      run: AiRun;
    }
  | { kind: "blocked"; code: AiErrorCode }
  | { kind: "insufficient_data"; readiness: ReadinessFeature };

function nowMs(deps: DraftAiDeps): number {
  return (deps.now ?? (() => new Date()))().getTime();
}

export async function prepareCoverLetterSection(deps: DraftAiDeps, sectionId: string): Promise<PreparedCoverLetter> {
  const startedAt = nowMs(deps);
  const section = await loadQuestion(deps.user, sectionId);
  const readiness = await (deps.getReadiness ?? getDataReadiness)(deps.user);
  if (!readiness.features.draft.ready) return { kind: "insufficient_data", readiness: readiness.features.draft };

  const jd = await loadDraftJd(deps.user, section.application_project_id);
  if (!jd) throw notFound();
  assertJdExtracted(jd);

  const pipeline = deps.pipelines.coverLetter;
  const opened = await openAiJob(
    deps,
    {
      jobType: COVER_LETTER_JOB_TYPE,
      targetType: "draft_section",
      targetId: sectionId,
      applicationProjectId: section.application_project_id,
      modelTier: pipeline.tier,
      params: { draft_id: section.draft_id },
      inputHash: null,
      promptVersion: pipeline.promptVersion,
      progress: { stage: "generate", done: 0, total: 1 },
    },
    sectionInProgress,
  );
  if (opened.kind === "blocked") return { kind: "blocked", code: opened.code };
  const budgetMs = startedAt + REQUEST_BUDGET_MS - USAGE_SETTLE_WORST_MS - nowMs(deps);
  return { kind: "ready", startedAt, section, jd, run: new AiRun(deps, opened.job, { budgetMs }) };
}

function errorEvent(f: CallFailure | { code: AiErrorCode | "internal_error"; retryAfter?: string | null; quotaResetsAt?: string | null }) {
  return { type: "error" as const, code: f.code, retryAfter: f.retryAfter ?? null, quotaResetsAt: f.quotaResetsAt ?? null };
}

const NO_TIMES = { retryAfter: null, quotaResetsAt: null };

/** The user's source list (mode user) and the other questions' primary projects (F-DOC-08 (3)). */
async function loadSourceInputs(db: DraftAiDeps["writer"], draftId: string, sectionId: string): Promise<{ userSources: UserSourceInput[]; others: Array<{ question_text: string; primary_project_ids: string[] }> }> {
  const { data: sections, error } = await db.from("draft_sections").select("id, question_text, sort_order").eq("draft_id", draftId).order("sort_order", { ascending: true });
  if (error) throw mapDbError(error);
  const ids = (sections ?? []).map((s) => s.id);
  const { data: sources, error: srcError } = ids.length
    ? await db
        .from("draft_section_sources")
        .select("draft_section_id, experience_id, education_id, project_id, project_detail_ids, role, origin, sort_order, source_deleted_at")
        .in("draft_section_id", ids)
        .order("sort_order", { ascending: true })
    : { data: [], error: null };
  if (srcError) throw mapDbError(srcError);
  const live = (sources ?? []).filter((s) => !s.source_deleted_at);
  const userSources: UserSourceInput[] = live
    .filter((s) => s.draft_section_id === sectionId && s.origin === "user")
    .map((s) => ({
      experience_id: s.experience_id,
      education_id: s.education_id,
      project_id: s.project_id,
      project_detail_ids: s.project_detail_ids ?? [],
      role: s.role === "primary" ? "primary" : "supporting",
    }));
  const others = (sections ?? [])
    .filter((s) => s.id !== sectionId)
    .map((s) => ({
      question_text: s.question_text ?? "",
      primary_project_ids: live.filter((x) => x.draft_section_id === s.id && x.role === "primary" && x.project_id).map((x) => x.project_id as string),
    }))
    .filter((s) => s.primary_project_ids.length > 0);
  return { userSources, others };
}

export async function runCoverLetterSection(deps: DraftAiDeps, prepared: Extract<PreparedCoverLetter, { kind: "ready" }>, emit: Emit): Promise<void> {
  const log = deps.log ?? (() => {});
  const pipeline = deps.pipelines.coverLetter;
  const { run, section } = prepared;
  const job = run.job;
  const apId = section.application_project_id;
  const safeEmit: Emit = (e) => {
    try {
      emit(e);
    } catch {
      // client gone: keep running and saving
    }
  };

  try {
    const jd = prepared.jd;

    const mode: "ai" | "user" = section.source_selection_mode === "user" ? "user" : "ai";
    const [requirements, careerRows, sources, insight] = await Promise.all([
      loadRequirements(deps.writer, jd.jobDescriptionId),
      deps.loadCareerRows(deps.writer),
      loadSourceInputs(deps.writer, section.draft_id, section.id),
      loadLatestInsightSignal(deps.writer, apId),
    ]);
    const question: CoverLetterQuestionInput = {
      section_id: section.id,
      question_text: section.question_text ?? "",
      template_key: (section.template_key as CoverLetterQuestionInput["template_key"]) ?? null,
      char_limit: section.char_limit,
      count_basis: section.count_basis === "without_spaces" ? "without_spaces" : "with_spaces",
      user_note: section.user_note,
      user_note_updated_at: section.updated_at,
    };
    const userSources = mode === "user" ? sources.userSources : [];
    const ctx = pipeline.buildContext({
      careerRows,
      jobDescriptionId: jd.jobDescriptionId,
      jobDescriptionUpdatedAt: jd.updatedAt,
      sentences: jd.sentences,
      companySids: jd.otherSids,
      requirements,
      positionTitle: jd.positionTitle,
      question,
      mode,
      userSources,
      otherSections: sources.others,
      insightSignal: insight ? { strengths: insight.strengths, positioning: insight.positioning } : null,
    });
    const model = resolveModel(job.provider, pipeline.tier);
    const { section_id: _sid, user_note_updated_at: _at, ...questionForHash } = question;
    void _sid;
    void _at;
    const inputHash = pipeline.inputHash({ provider: job.provider, model, careerSnapshotHash: ctx.careerSnapshotHash, requirementsHash: ctx.requirementsHash, question: questionForHash, mode, userSources });

    try {
      await deps.drafts.beginCoverLetterSection(section.id, job.id);
    } catch (err) {
      const code: AiErrorCode = err instanceof DraftRpcError && (err.appError.code === "not_found" || err.appError.code === "section_in_progress") ? "canceled" : "stalled";
      log("cover_letter.begin_failed", { jobId: job.id, raise: err instanceof DraftRpcError ? err.raise : "unknown" });
      await run.fail({ code, ...NO_TIMES });
      safeEmit(errorEvent({ code }));
      return;
    }
    safeEmit({
      type: "generation_started",
      jobId: job.id,
      draftId: section.draft_id,
      sectionId: section.id,
      provider: job.provider,
      model,
      modelTier: job.modelTier,
      connectionTier: job.connectionTier,
    });

    let targetGone = false;
    const result = await run.stream<PipelineStreamEvent>({
      tier: pipeline.tier,
      timeoutMs: Math.max(run.remaining(), 1),
      callKey: `${COVER_LETTER_JOB_TYPE}.generate`,
      run: ({ llm, signal, callKey }) =>
        pipeline.stream(
          { context: ctx },
          {
            llm,
            signal,
            callKey,
            adjustCallKey: `${COVER_LETTER_JOB_TYPE}.adjust`,
            jobId: job.id,
            persist: async (payload) => {
              const done = await deps.drafts
                .completeCoverLetterSection({ sectionId: section.id, jobId: job.id, runGeneration: job.runGeneration, payload: withInputHash(payload, inputHash) })
                .catch((err: unknown) => {
                  if (isTargetGone(err)) targetGone = true;
                  throw err;
                });
              if (!done.applied) {
                // QA-S7-09: reset (delete_results) or taken over by a newer run → this run is stopped, not broken.
                targetGone = true;
                throw new Error("stale_run");
              }
              return { resultId: section.id };
            },
          },
        ),
      onEvent: (e) => {
        // sources_selected / adjusting_length carry the question id for the screen ("전체 생성" streams several).
        if (e.type === "sources_selected" || e.type === "adjusting_length") safeEmit({ ...e, sectionId: section.id } as unknown as DraftStreamEvent);
        else safeEmit(e as unknown as DraftStreamEvent);
      },
    });

    if (!result.ok) {
      const failure = await asCancelIfStopped(run, result.failure, targetGone);
      await deps.drafts.failDraftSection(section.id, job.id).catch(() => false);
      await run.fail(failure);
      safeEmit(errorEvent(failure));
      return;
    }
    const validated = result.held.find((e) => e.type === "validated");
    const done = result.held.find((e) => e.type === "done") as (PipelineStreamEvent & { meta?: { promptVersion?: string; model?: string } }) | undefined;
    if (validated) safeEmit(validated as unknown as DraftStreamEvent);
    await run.succeed({ stage: "validate", done: 1, total: 1 }, { model: done?.meta?.model ?? model, promptVersion: done?.meta?.promptVersion ?? pipeline.promptVersion });
    safeEmit({
      type: "done",
      draftId: section.draft_id,
      sectionId: section.id,
      reused: false,
      meta: { promptVersion: done?.meta?.promptVersion ?? pipeline.promptVersion, model: done?.meta?.model ?? model, resultId: section.id },
    });
  } catch (err) {
    log("cover_letter.crashed", { jobId: job.id, code: err instanceof AppError ? String(err.code) : "unknown" });
    await deps.drafts.failDraftSection(section.id, job.id).catch(() => false);
    await run.fail({ code: "stalled", ...NO_TIMES });
    safeEmit(errorEvent({ code: "stalled" }));
  } finally {
    await run.close();
  }
}

function withInputHash(payload: unknown, inputHash: string): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const p = payload as Record<string, unknown>;
  const hashes = (p.hashes && typeof p.hashes === "object" ? p.hashes : {}) as Record<string, unknown>;
  return { ...p, hashes: { ...hashes, input_hash: inputHash } };
}

/** For the route: a prepared run that never streams (e.g. the route failed before opening) must still be closed. */
export async function abandonPrepared(prepared: PreparedCoverLetter): Promise<void> {
  if (prepared.kind !== "ready") return;
  await prepared.run.fail({ code: "canceled", ...NO_TIMES });
  await prepared.run.close();
}
