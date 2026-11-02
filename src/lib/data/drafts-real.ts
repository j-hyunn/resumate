import "server-only"
/**
 * W3: the real branch of the S-17 ~ S-19 data functions. Reads run the services' effective-status rules and return
 * the table rows the screens use. Generation goes through the SSE routes (AI-03, AI-04): `*StreamPlan` gives the
 * screen `{ endpoint, body }` for `stream.start`.
 *
 * The screens open S-19 before the stream starts, but AI-03 writes its row inside the route. Between the two the
 * settings wait in a short-lived cookie, the page reads a stand-in row under the id the route will use (`draftId`),
 * and the row replaces it as soon as it exists.
 */
import { cookies } from "next/headers"
import type { DraftView } from "@/lib/contracts/draft"
import { AI_ERROR_CODES } from "@/lib/contracts/enums"
import { AppError } from "@/lib/contracts/errors"
import { randomUUID } from "node:crypto"
import { MockAiError } from "@/lib/mock/ai"
import type { MockDb } from "@/lib/mock/fixtures"
import * as draftActions from "@/server/actions/draft"
import { requireConsentedUser } from "@/server/auth/session"
import { mapDbError } from "@/server/db/errors"
import type { UserSupabaseClient } from "@/server/db/types"
import { createDraftAiDeps } from "@/server/jobs/drafts"
import { PENDING_CAREER_DESCRIPTION_COOKIE, PENDING_MAX_AGE_S, decodePendingCookie, encodePendingCookie, type PendingCareerDescription } from "@/server/services/drafts/pending-cookie"
import { rankDraftSourcesForProject } from "@/server/services/drafts/ranking"
import { coverLetterStatus } from "@/server/services/drafts/read"
import type { AiErrorCode, Draft, DraftBlock, DraftOptions, DraftSection, DraftSectionSource } from "@/types/db"
import { cancelAiJob } from "./ai-jobs"
import type { DraftSectionPatch, DraftWithSections } from "./applications"
import { isUuid } from "./applications-real"
import { buildSourceTree, type CareerDescriptionStopped, type GenerationResult, type SourceSelection, type SourceTree } from "./drafts"
import { unwrap } from "./source"

const uniqueIds = (ids: Array<string | null | undefined>) => [...new Set(ids.filter((x): x is string => Boolean(x)))]

function rowsOf<T>(res: { data: T[] | null; error: Parameters<typeof mapDbError>[0] | null }): T[] {
  if (res.error) throw mapDbError(res.error)
  return res.data ?? []
}

// ---------------- response shape (QA-W5-10) ----------------

/**
 * Hashes, usage, prompt / schema versions and validation reports are server-side bookkeeping; no screen reads
 * them, so they don't go into the RSC payload. The one exception: S-19 shows a section's stored
 * `validation_report.char_adjust_needed` (A21) again on re-open.
 */
const DRAFT_INTERNALS = { input_hash: null, career_snapshot_hash: null, requirements_hash: null, usage: null, prompt_version: null, schema_version: null, validation_report: null } as const

function publicDraft<T extends object>(row: T): T {
  return { ...row, ...pickPresent(row, DRAFT_INTERNALS) }
}

function publicSection<T extends object>(row: T): T {
  const report = (row as { validation_report?: unknown }).validation_report
  const charAdjust = report && typeof report === "object" && (report as Record<string, unknown>).char_adjust_needed === true
  return { ...row, ...pickPresent(row, DRAFT_INTERNALS), ...("validation_report" in row ? { validation_report: charAdjust ? { char_adjust_needed: true } : null } : {}) }
}

/** Only the internal keys the row actually has (a `select` list may not include them all). */
function pickPresent(row: object, internals: Record<string, null>): Record<string, null> {
  return Object.fromEntries(Object.keys(internals).filter((k) => k in row).map((k) => [k, null]))
}

// ---------------- pending first generation (career description) ----------------

async function readPending(userId: string, id?: string): Promise<PendingCareerDescription | null> {
  return decodePendingCookie((await cookies()).get(PENDING_CAREER_DESCRIPTION_COOKIE)?.value, userId, id)
}

async function writePending(pending: PendingCareerDescription | null): Promise<void> {
  const jar = await cookies()
  if (!pending) {
    jar.delete(PENDING_CAREER_DESCRIPTION_COOKIE)
    return
  }
  jar.set(PENDING_CAREER_DESCRIPTION_COOKIE, encodePendingCookie(pending), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PENDING_MAX_AGE_S,
  })
}

function standInDraft(p: PendingCareerDescription, userId: string): DraftWithSections {
  const at = new Date().toISOString()
  return {
    id: p.id,
    user_id: userId,
    application_project_id: p.application_project_id,
    draft_type: "career_description",
    title: "경력기술서",
    status: p.ended ? "failed" : "generating",
    options: p.options,
    insight_id: null,
    regenerated_from_id: p.regenerated_from_id,
    edited_at: null,
    first_copied_at: null,
    completed_at: null,
    ai_job_id: null,
    provider: null,
    model: null,
    model_tier: null,
    connection_tier: null,
    prompt_version: null,
    schema_version: null,
    validation_report: null,
    usage: null,
    input_hash: null,
    created_at: at,
    updated_at: at,
    sections: [],
  } as unknown as DraftWithSections
}

/** S-17 / "다시 생성": no row yet (AI-03 creates it in the route), so nothing to refuse here. */
export async function realCreateCareerDescriptionDraft(applicationProjectId: string, options: DraftOptions, regeneratedFromId: string | null): Promise<Draft> {
  const { supabase, user } = await requireConsentedUser()
  // QA-W5-02: the project must be the user's own (RLS read) before its id goes into the cookie.
  if (!isUuid(applicationProjectId)) throw new AppError("not_found", "지원 프로젝트를 찾을 수 없어요.", { status: 404 })
  const { data: project, error } = await supabase.from("application_projects").select("id").eq("id", applicationProjectId).maybeSingle()
  if (error) throw mapDbError(error)
  if (!project) throw new AppError("not_found", "지원 프로젝트를 찾을 수 없어요.", { status: 404 })
  const previous = await readPending(user.id)
  // "다시 시도" from a stand-in (the failed run never made a row): a plain first generation
  const fromRow = regeneratedFromId && isUuid(regeneratedFromId) && regeneratedFromId !== previous?.id ? regeneratedFromId : null
  const pending: PendingCareerDescription = { id: randomUUID(), user_id: user.id, application_project_id: applicationProjectId, options, regenerated_from_id: fromRow, ended: false }
  await writePending(pending)
  return standInDraft(pending, user.id)
}

// ---------------- stream plans ----------------

export interface RealStreamPlan {
  generation_id: string
  request: { endpoint: string; body: unknown }
}

/** `generation_id`: `{target}:{start ms}`. finalize* uses the time to tell this run's job from an older one. */
const generationId = (target: string) => `${target}:${Date.now()}`

export async function realCareerDescriptionStreamPlan(draftId: string): Promise<RealStreamPlan | null> {
  const { user } = await requireConsentedUser()
  const pending = await readPending(user.id, draftId)
  if (!pending) return null
  const o = pending.options
  return {
    generation_id: generationId(draftId),
    request: {
      endpoint: `/api/application-projects/${pending.application_project_id}/career-descriptions`,
      body: {
        draftId,
        includedExperienceIds: o.included_experience_ids ?? [],
        includedEducationIds: o.included_education_ids ?? [],
        includedProjectIds: o.included_project_ids ?? [],
        projectOrder: o.project_order ?? o.included_project_ids ?? [],
        selectionOrigin: o.selection_origin ?? "user",
        ...(o.tone ? { tone: o.tone } : {}),
        ...(pending.regenerated_from_id ? { regeneratedFromId: pending.regenerated_from_id } : {}),
      },
    },
  }
}

export function realCoverLetterStreamPlan(sectionId: string): RealStreamPlan {
  return { generation_id: generationId(sectionId), request: { endpoint: `/api/draft-sections/${sectionId}/generate`, body: {} } }
}

// ---------------- stop (Q53-7) ----------------

const JOB_APPEAR_WAIT_MS = 3_000
/** The run sees the stop at its next heartbeat (HEARTBEAT_INTERVAL_MS, 10 s). */
const JOB_END_WAIT_MS = 12_000
const POLL_MS = 250

type StopOutcome = "canceled" | "succeeded" | "ended" | "none"

/**
 * The stream's abort only closes the connection; the run goes on until told to stop (route docs). Asks the job to
 * stop and waits briefly so the screen's next read already sees the closed row. Its job may not be open yet when the
 * stop came right after the start.
 */
async function stopRun(supabase: UserSupabaseClient, targetId: string, jobType: "career_description" | "cover_letter", startedMs: number): Promise<StopOutcome> {
  const since = new Date(startedMs - 2_000).toISOString()
  const latest = async () => {
    const { data, error } = await supabase.from("ai_jobs").select("id, status").eq("target_id", targetId).eq("job_type", jobType).gte("created_at", since).order("created_at", { ascending: false }).limit(1).maybeSingle()
    if (error) throw mapDbError(error)
    return data
  }
  const sleep = () => new Promise((r) => setTimeout(r, POLL_MS))
  let job = await latest()
  for (const end = Date.now() + JOB_APPEAR_WAIT_MS; !job && Date.now() < end; job = await latest()) await sleep()
  if (!job) return "none"
  if (job.status === "queued" || job.status === "running") await cancelAiJob(job.id)
  for (const end = Date.now() + JOB_END_WAIT_MS; (job?.status === "queued" || job?.status === "running") && Date.now() < end; job = await latest()) await sleep()
  return job?.status === "canceled" ? "canceled" : job?.status === "succeeded" ? "succeeded" : "ended"
}

const startedAtOf = (generation: string) => Number(generation.split(":")[1]) || Date.now()

/**
 * The route saved everything (done / error), so only the stop has work to do. Q53-7: a stopped regeneration
 * disappears and the screen goes back to the draft it came from; a stopped first generation goes back to S-17.
 * `validated` before the stop counts as complete: the job ends `succeeded` and nothing is reported as stopped.
 */
export async function realFinalizeCareerDescription(draftId: string, generation: string, result: GenerationResult): Promise<CareerDescriptionStopped | null> {
  const { supabase, user } = await requireConsentedUser()
  const pending = await readPending(user.id, draftId)
  if (!(result.canceled && !result.ok)) {
    if (result.ok) await writePending(null)
    else if (pending) await writePending({ ...pending, ended: true })
    return null
  }
  const { data: row } = await supabase.from("drafts").select("regenerated_from_id").eq("id", draftId).maybeSingle()
  const regeneratedFrom = row?.regenerated_from_id ?? pending?.regenerated_from_id ?? null
  const outcome = await stopRun(supabase, draftId, "career_description", startedAtOf(generation))
  if (outcome === "succeeded") {
    await writePending(null)
    return null
  }
  await writePending(null)
  return regeneratedFrom ? { stopped: "regeneration", back_to_draft_id: regeneratedFrom } : { stopped: "first_generation" }
}

export async function realFinalizeCoverLetterSection(sectionId: string, generation: string, result: GenerationResult): Promise<void> {
  if (!result.canceled || result.ok) return
  const { supabase } = await requireConsentedUser()
  await stopRun(supabase, sectionId, "cover_letter", startedAtOf(generation))
}

// ---------------- reads ----------------

export async function realGetCareerSourceTree(): Promise<SourceTree> {
  const { supabase } = await requireConsentedUser()
  // R4 shim (DM v4.4): no project_details any more — the tree's project rows carry no detail children.
  const [experiences, educations, projects] = await Promise.all([
    supabase.from("experiences").select("*"),
    supabase.from("educations").select("*"),
    supabase.from("projects").select("*"),
  ])
  return buildSourceTree({
    experiences: rowsOf(experiences),
    educations: rowsOf(educations),
    projects: rowsOf(projects),
    project_details: [],
  } as unknown as Pick<MockDb, "experiences" | "educations" | "projects" | "project_details">)
}

export async function realListDrafts(applicationProjectId: string): Promise<Draft[]> {
  if (!isUuid(applicationProjectId)) return []
  const { supabase } = await requireConsentedUser()
  const list = unwrap(await draftActions.listDrafts({ applicationProjectId }))
  if (list.drafts.length === 0) return []
  const rows = rowsOf(await supabase.from("drafts").select("*").in("id", list.drafts.map((d) => d.id))) as unknown as Draft[]
  // Same reading as S-19 for a question that was stopped.
  const coverStatus = new Map<string, Draft["status"]>()
  for (const item of list.drafts) {
    if (item.draftType !== "cover_letter" || (item.status !== "failed" && item.status !== "partially_failed")) continue
    const full = await realGetDraft(applicationProjectId, item.id)
    if (full) coverStatus.set(item.id, full.status)
  }
  return list.drafts.flatMap((item) => {
    const row = rows.find((r) => r.id === item.id)
    return row ? [{ ...publicDraft(row), options: (row.options ?? {}) as DraftOptions, status: coverStatus.get(item.id) ?? item.status, provider: item.badge.provider, model: item.badge.model, model_tier: item.badge.modelTier, connection_tier: item.badge.connectionTier }] : []
  })
}

/** DB: the block array itself (DM A.10). Screens: `{ blocks }`. spec-gaps W3 */
function blocksOf(content: unknown): { blocks: DraftBlock[] } | null {
  const blocks = Array.isArray(content) ? content : (content as { blocks?: unknown } | null)?.blocks
  if (!Array.isArray(blocks)) return null
  return {
    blocks: (blocks as Array<Partial<DraftBlock>>).map((b) => ({
      block_id: b.block_id ?? "",
      block_kind: b.block_kind ?? "paragraph",
      project_id: b.project_id ?? null,
      text: b.text ?? "",
      requirement_ids: b.requirement_ids ?? [],
      placeholders: b.placeholders ?? [],
      flags: b.flags ?? [],
      generated_by: b.generated_by ?? null,
      user_modified: b.user_modified === true,
    })),
  }
}

async function loadSectionRows(supabase: UserSupabaseClient, view: DraftView): Promise<DraftWithSections["sections"]> {
  const [sections, sources] = await Promise.all([
    supabase.from("draft_sections").select("*").eq("draft_id", view.id).order("sort_order"),
    view.sections.length ? supabase.from("draft_section_sources").select("*").in("draft_section_id", view.sections.map((s) => s.id)).order("sort_order") : Promise.resolve({ data: [], error: null }),
  ])
  const rows = rowsOf(sections) as unknown as DraftSection[]
  const sourceRows = rowsOf(sources as { data: unknown[] | null; error: null }) as unknown as DraftSectionSource[]
  const failedJobIds = uniqueIds(view.sections.filter((s) => s.status === "failed").map((s) => rows.find((r) => r.id === s.id)?.ai_job_id))
  const canceled = new Set(failedJobIds.length ? rowsOf(await supabase.from("ai_jobs").select("id").in("id", failedJobIds).eq("status", "canceled")).map((j) => j.id) : [])
  return view.sections.flatMap((s) => {
    const row = rows.find((r) => r.id === s.id)
    if (!row) return []
    // A stopped question isn't a failed one (S-19): back to what it was, its body and edit untouched. spec-gaps W3
    const stopped = s.status === "failed" && !!row.ai_job_id && canceled.has(row.ai_job_id)
    const status: DraftSection["status"] = stopped ? (blocksOf(row.ai_content)?.blocks.length ? "ready" : "pending") : s.status
    return [{ ...publicSection(row), status, ai_content: blocksOf(row.ai_content), edited_content: blocksOf(row.edited_content), sources: sourceRows.filter((x) => x.draft_section_id === s.id).map((x) => ({ ...x, project_detail_ids: [], requirement_ids: x.requirement_ids ?? [] })) }]
  })
}

export async function realGetDraft(applicationProjectId: string, draftId: string): Promise<DraftWithSections | null> {
  if (!isUuid(draftId)) return null
  const { supabase, user } = await requireConsentedUser()
  const result = await draftActions.getDraft({ draftId })
  if ("error" in result && result.error.code === "not_found") {
    const pending = await readPending(user.id, draftId)
    return pending?.application_project_id === applicationProjectId ? standInDraft(pending, user.id) : null
  }
  const view = unwrap(result)
  if (view.applicationProjectId !== applicationProjectId) return null
  const { data, error } = await supabase.from("drafts").select("*").eq("id", draftId).single()
  if (error) throw mapDbError(error)
  const row = data as unknown as Draft
  const sections = await loadSectionRows(supabase, view)
  return {
    ...publicDraft(row),
    options: (row.options ?? {}) as DraftOptions,
    status: view.draftType === "cover_letter" ? coverLetterStatus(sections.map((s) => s.status)) : view.status,
    provider: view.badge.provider,
    model: view.badge.model,
    model_tier: view.badge.modelTier,
    connection_tier: view.badge.connectionTier,
    sections,
  }
}

// ---------------- writes ----------------

async function sectionRow(supabase: UserSupabaseClient, sectionId: string): Promise<DraftSection | null> {
  const { data, error } = await supabase.from("draft_sections").select("*").eq("id", sectionId).maybeSingle()
  if (error) throw mapDbError(error)
  return data ? ({ ...publicSection(data), ai_content: blocksOf(data.ai_content), edited_content: blocksOf(data.edited_content) } as unknown as DraftSection) : null
}

/** Null when the section is gone, like the mock. Question fields and edited text have their own services. */
export async function realSaveDraftSection(sectionId: string, patch: DraftSectionPatch): Promise<DraftSection | null> {
  if (!isUuid(sectionId)) return null
  const goneIsNull = <T,>(r: { data: T } | { error: { code: string; message: string } }) => "error" in r && r.error.code === "not_found" ? null : unwrap(r)
  const question = {
    ...(patch.question_text !== undefined ? { questionText: patch.question_text ?? "" } : {}),
    ...(patch.char_limit !== undefined ? { charLimit: patch.char_limit } : {}),
    ...(patch.count_basis !== undefined && patch.count_basis !== null ? { countBasis: patch.count_basis } : {}),
    ...(patch.user_note !== undefined ? { userNote: patch.user_note } : {}),
  }
  if (Object.keys(question).length > 0 && goneIsNull(await draftActions.updateCoverLetterQuestion({ sectionId, ...question })) === null) return null
  if (patch.edited_content) {
    const blocks = patch.edited_content.blocks.map((b) => ({ blockId: b.block_id, text: b.text }))
    if (goneIsNull(await draftActions.saveSectionEdit({ sectionId, blocks })) === null) return null
  }
  const { supabase } = await requireConsentedUser()
  return sectionRow(supabase, sectionId)
}

async function draftRow(supabase: UserSupabaseClient, draftId: string): Promise<Draft> {
  const { data, error } = await supabase.from("drafts").select("*").eq("id", draftId).single()
  if (error) throw mapDbError(error)
  return { ...publicDraft(data as unknown as Draft), options: (data.options ?? {}) as DraftOptions }
}

export async function realCreateCoverLetterDraft(applicationProjectId: string): Promise<Draft> {
  const view = unwrap(await draftActions.createCoverLetterDraft({ applicationProjectId }))
  const { supabase } = await requireConsentedUser()
  return draftRow(supabase, view.id)
}

/** S-18 adds an empty row in the mock; the DM needs question text (1~1,000), so a new one starts with this. [가정] spec-gaps W3 */
const NEW_QUESTION_TEXT = "새 문항"
const NEW_QUESTION_CHAR_LIMIT = 1_000

export async function realAddCoverLetterQuestion(draftId: string): Promise<DraftSection | null> {
  const result = await draftActions.addCoverLetterQuestion({ draftId, questionText: NEW_QUESTION_TEXT, charLimit: NEW_QUESTION_CHAR_LIMIT, countBasis: "with_spaces" })
  if ("error" in result && result.error.code === "not_found") return null
  const { section } = unwrap(result)
  const { supabase } = await requireConsentedUser()
  return sectionRow(supabase, section.id)
}

/** False = refused (last question, generating question, gone), like the mock. */
export async function realDeleteDraftSection(sectionId: string): Promise<boolean> {
  const result = await draftActions.deleteCoverLetterQuestion({ sectionId })
  if ("error" in result && ["last_question", "section_generating", "not_found"].includes(result.error.code)) return false
  unwrap(result)
  return true
}

export async function realSetSectionSources(sectionId: string, selections: SourceSelection[]): Promise<DraftSectionSource[] | null> {
  const result = await draftActions.setSectionSources({ sectionId, sources: selections.map((s) => ({ projectId: s.project_id })) })
  if ("error" in result && result.error.code === "not_found") return null
  unwrap(result)
  const { supabase } = await requireConsentedUser()
  return rowsOf(await supabase.from("draft_section_sources").select("*").eq("draft_section_id", sectionId).order("sort_order")) as unknown as DraftSectionSource[]
}

export async function realMarkDraftCopied(draftId: string): Promise<void> {
  unwrap(await draftActions.markDraftCopied({ draftId }))
}

// ---------------- AI-11 ----------------

const RANKING_GATE_CODES: readonly string[] = ["key_missing", "key_invalid"]

/**
 * A23: the route answers every failure with `failed` and an empty selection. The screen tells them apart by what
 * rankDraftSources throws (a refusal → C-18 / C-21, anything else → C-20 + an unchecked tree). Reasons that aren't
 * C-11 codes have no C-20 copy of their own, so they read as the closest cause.
 */
export async function realRankDraftSources(applicationProjectId: string): Promise<{ project_ids: string[]; ranking: Array<{ project_id: string; relevance: "high" | "medium" | "low"; include: boolean }> }> {
  const { supabase, user } = await requireConsentedUser()
  // QA-W5-07: an unknown / foreign / malformed project is AppError `not_found` (never a provider failure).
  if (!isUuid(applicationProjectId)) throw new AppError("not_found", "자기소개서를 찾을 수 없어요.", { status: 404 })
  const outcome = await rankDraftSourcesForProject(createDraftAiDeps(supabase, user.id), applicationProjectId, { refresh: false })
  if (outcome.kind === "insufficient_data") throw new MockAiError("insufficient_data")
  const data = outcome.data
  if (data.failed) {
    const reason = data.reason ?? ""
    if (RANKING_GATE_CODES.includes(reason)) throw new MockAiError(reason as AiErrorCode)
    if (reason === "no_rankable_projects") throw new MockAiError("insufficient_data")
    throw new MockAiError((AI_ERROR_CODES as readonly string[]).includes(reason) ? (reason as AiErrorCode) : "provider_unavailable")
  }
  return {
    project_ids: data.includedProjectIds,
    ranking: (data.ranking ?? []).map((r) => ({ project_id: r.projectId, relevance: r.relevance, include: r.include })),
  }
}

