"use server"

/**
 * A3 server actions (자기소개서 관리). Thin wrappers over src/lib/data/* and the area shim
 * (src/lib/data/drafts.ts). Screens refresh with router.refresh() after a write.
 */
import type { AiErrorCode, AiProviderName, ApplicationProject, DraftOptions, DraftSection, JobDescription } from "@/types/db"
import { createApplicationProject, getJobDescription, saveDraftSection, startInsight, updateApplicationProject, updateFailedJdRawText } from "@/lib/data/applications"
import { getAiJob } from "@/lib/data/ai-jobs"
import type { AiRejected } from "@/lib/data/ai-errors"
import { deleteApplicationProject, deleteDraft } from "@/lib/data/deletion"
import { withAiGuard } from "@/lib/data/ai-guard"
import { getDataReadiness } from "@/lib/data/readiness"
import {
  addCoverLetterQuestion,
  createCareerDescriptionDraft,
  createCoverLetterDraft,
  deleteDraftSection,
  finalizeCareerDescription,
  finalizeCoverLetterSection,
  markDraftCopied,
  markDraftEdited,
  prepareCareerDescription,
  prepareCareerDescriptionStream,
  prepareCoverLetterSection,
  prepareCoverLetterStream,
  MockAiError,
  rankDraftSources,
  retryJdExtraction,
  setSectionSources,
  type GenerationResult,
  type SourceSelection,
} from "@/lib/data/drafts"

// --- S-14 / S-31 -------------------------------------------------------------------------

export async function createApplicationAction(input: {
  raw_text: string
  name: string | null
  deadline: string | null
  /** S-14 회사명·포지션명 입력란 → JD company_name / position_title (source 'user') */
  company_name?: string | null
  position_title?: string | null
  fail?: boolean
}): Promise<{ id: string } | AiRejected> {
  if (input.fail) throw new Error("save failed (mock)")
  const raw = input.raw_text.trim()
  if (!raw) throw new Error("raw_text required")
  // v5.3 S-14 이름 규칙은 data layer(createApplicationProject)가 정한다
  // Q53-1: key_invalid / ai_consent_required come back as `{ rejected, refusal }` with no row (경로 ⑥)
  return withAiGuard(async () => {
    const ap = await createApplicationProject({
      raw_text: raw,
      name: input.name?.trim() || null,
      deadline: input.deadline || null,
      company_name: input.company_name,
      position_title: input.position_title,
    })
    return { id: ap.id }
  })
}

/** S-15 공고 원문 저장 (Q53-2, RPC update_failed_jd_raw_text): `{ refused }` = nothing changed */
export async function updateFailedJdRawTextAction(applicationProjectId: string, rawText: string) {
  return updateFailedJdRawText(applicationProjectId, rawText)
}

export async function updateApplicationAction(
  id: string,
  patch: Partial<Pick<ApplicationProject, "name" | "deadline">>,
  opts?: { fail?: boolean },
) {
  if (opts?.fail) throw new Error("save failed (mock)")
  return updateApplicationProject(id, patch)
}

export async function deleteApplicationAction(id: string) {
  await deleteApplicationProject(id)
}

/**
 * S-15 "요건 정리하기" / 다시 시도, S-17·S-18 요건 선행 추출 (A13). v5.3: path ⑤ refusal comes back as
 * `AiRejected` (nothing changed). `{ already: true }` = another path was already extracting
 * ("이미 정리하고 있어요"). `true` = started.
 */
export async function retryJdExtractionAction(applicationProjectId: string): Promise<boolean | AiRejected | { already: true }> {
  const r = await retryJdExtraction(applicationProjectId)
  return r === "already" ? { already: true } : r
}

/** Requirement-extraction state for client polling (S-15 / S-17 / S-18 요건 선행 추출) */
export interface JdExtractionState {
  status: JobDescription["extraction_status"] | null
  requirement_count: number
  error_code: AiErrorCode | null
  provider: AiProviderName | null
  retry_after: string | null
  quota_resets_at: string | null
}

export async function getJdExtractionStateAction(applicationProjectId: string): Promise<JdExtractionState> {
  const jd = await getJobDescription(applicationProjectId)
  const job = jd?.extraction_job_id && jd.extraction_status === "failed" ? await getAiJob(jd.extraction_job_id) : null
  return {
    status: jd?.extraction_status ?? null,
    requirement_count: jd?.requirements.length ?? 0,
    error_code: jd?.extraction_status === "failed" ? (job?.error_code ?? "provider_unavailable") : null,
    provider: job?.provider ?? null,
    retry_after: job?.retry_after ?? null,
    quota_resets_at: job?.quota_resets_at ?? null,
  }
}

// --- S-16 ----------------------------------------------------------------------------------

/**
 * v4: key checked first on the server (`{ rejected }` → nothing changed); D-30: startInsight runs
 * AI-01 first when the JD has no requirements (UQ-232). No service limit (D-34).
 */
export async function startInsightAction(applicationProjectId: string, fail?: AiErrorCode, opts?: { rate_wait?: boolean }) {
  return withAiGuard(() => startInsight(applicationProjectId, { fail: fail ?? null, rate_wait: opts?.rate_wait }))
}

// --- S-17 ----------------------------------------------------------------------------------

export type RankDraftSourcesResult =
  | { ok: true; project_ids: string[] }
  | { ok: false; error_code: AiErrorCode; provider: AiProviderName | null; retry_after: string | null; quota_resets_at: string | null }
  | AiRejected

/**
 * AI-11 경력기술서 기본 선택 (path ⑤). v5.3 A23: a failure is **not** replaced by a fallback selection —
 * the screen opens an unchecked tree + "AI가 포함할 항목을 고르지 못했어요" + C-20 cause line.
 * Key / consent refusal → `AiRejected` (AiRunButton re-reads readiness → C-18 / C-21).
 */
export async function rankDraftSourcesAction(applicationProjectId: string, fail?: boolean): Promise<RankDraftSourcesResult> {
  try {
    const r = await rankDraftSources(applicationProjectId, { fail })
    return { ok: true, project_ids: r.project_ids }
  } catch (e) {
    if (e instanceof MockAiError) {
      if (e.error_code === "key_missing" || e.error_code === "key_invalid") return { rejected: e.error_code, refusal: e.refusal }
      return { ok: false, error_code: e.error_code, provider: null, retry_after: null, quota_resets_at: null }
    }
    return { ok: false, error_code: "provider_unavailable", provider: null, retry_after: null, quota_resets_at: null }
  }
}

export async function createCareerDescriptionAction(applicationProjectId: string, options: DraftOptions, regeneratedFromId?: string | null) {
  const draft = await createCareerDescriptionDraft(applicationProjectId, options, regeneratedFromId ?? null)
  return { id: draft.id }
}

export async function createCoverLetterAction(applicationProjectId: string) {
  const draft = await createCoverLetterDraft(applicationProjectId)
  return { id: draft.id }
}

export async function deleteDraftAction(draftId: string) {
  await deleteDraft(draftId)
}

// --- S-18 ----------------------------------------------------------------------------------

export async function saveQuestionAction(
  sectionId: string,
  patch: Partial<Pick<DraftSection, "question_text" | "char_limit" | "count_basis" | "user_note">>,
  fail?: boolean,
) {
  return saveDraftSection(sectionId, patch, { fail })
}

export async function addQuestionAction(draftId: string) {
  return addCoverLetterQuestion(draftId)
}

export async function deleteQuestionAction(draftId: string, sectionId: string) {
  return deleteDraftSection(draftId, sectionId)
}

// --- S-19 ----------------------------------------------------------------------------------

/** Why the server refused to start a generation (A3 UQ-86): the AI connection first, then readiness (FL-08) */
async function refusal(): Promise<{ refused: "insufficient" | "locked" | "key_invalid" | "unavailable" }> {
  // A3 UQ-238: FL-08 order — key first, then data readiness
  const readiness = await getDataReadiness()
  if (!readiness.ai_connection.active_provider) return { refused: "locked" }
  if (readiness.ai_connection.key_status === "invalid") return { refused: "key_invalid" }
  if (!readiness.features.draft.ready) return { refused: "insufficient" }
  return { refused: "unavailable" }
}

export async function prepareCareerDescriptionAction(draftId: string) {
  // real: `{ generation_id, request }` for the SSE route; `?state=`: the mock plan
  return (await prepareCareerDescriptionStream(draftId)) ?? (await prepareCareerDescription(draftId)) ?? refusal()
}

export async function finalizeCareerDescriptionAction(draftId: string, generationId: string, result: GenerationResult) {
  return finalizeCareerDescription(draftId, generationId, result)
}

export async function prepareCoverLetterSectionAction(sectionId: string) {
  return (await prepareCoverLetterStream(sectionId)) ?? (await prepareCoverLetterSection(sectionId)) ?? refusal()
}

export async function finalizeCoverLetterSectionAction(sectionId: string, generationId: string, result: GenerationResult) {
  return finalizeCoverLetterSection(sectionId, generationId, result)
}

export async function saveEditedContentAction(
  draftId: string,
  sectionId: string,
  edited: NonNullable<DraftSection["edited_content"]>,
  fail?: boolean,
) {
  const saved = await saveDraftSection(sectionId, { edited_content: edited }, { fail })
  await markDraftEdited(draftId)
  return saved
}

export async function setSectionSourcesAction(sectionId: string, selections: SourceSelection[]) {
  return setSectionSources(sectionId, selections)
}

export async function markDraftCopiedAction(draftId: string) {
  return markDraftCopied(draftId)
}

