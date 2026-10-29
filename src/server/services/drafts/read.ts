import { aiErrorEvent } from "@/lib/contracts/ai";
import { toAiFailure } from "@/lib/contracts/application";
import type {
  DraftActiveJob,
  DraftFailure,
  DraftList,
  DraftListItem,
  DraftOptionsView,
  DraftProviderBadge,
  DraftSectionSourceView,
  DraftSectionView,
  DraftSourceRankingItem,
  DraftView,
} from "@/lib/contracts/draft";
import { DRAFT_TONES } from "@/lib/contracts/draft";
import {
  AI_ERROR_CODES,
  AI_PROVIDERS,
  CONNECTION_TIERS,
  COUNT_BASES,
  COVER_LETTER_TEMPLATE_KEYS,
  DRAFT_SECTION_KINDS,
  DRAFT_SECTION_STATUSES,
  DRAFT_STATUSES,
  DRAFT_TYPES,
  MODEL_TIERS,
  QUESTION_CLASSES,
  SELECTION_ORIGINS,
  type AiErrorCode,
  type DraftSectionStatus,
  type DraftStatus,
} from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import type { EvidenceChip } from "@/lib/contracts/evidence";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { assertApplicationProjectOwned } from "@/server/services/application/db";
import { loadEvidenceChips } from "@/server/services/evidence";
import { countShownChars, parseBlocks, toBlockViews } from "./blocks";

/**
 * S-17 list / S-19 editor reads (S7 plan "계약 — API" 5; F-DOC-01~04, 08, 09;
 * C-01/C-02/C-03/C-11/C-19/C-20). User session only (RLS = ownership).
 *
 * Generating rows whose job is no longer queued/running are shown as failed
 * (db notes §4: the job-end trigger skips locked projects; the next begin
 * cleans up). The failure comes from that job (failed → its code, canceled →
 * canceled, gone / succeeded without a result → stalled).
 */

const draftNotFound = () => new AppError("not_found", "초안을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });

const DRAFT_COLUMNS =
  "id, application_project_id, draft_type, title, status, options, insight_id, regenerated_from_id, created_at, updated_at, edited_at, first_copied_at, provider, model, model_tier, connection_tier, ai_job_id";

const SECTION_COLUMNS =
  "id, draft_id, sort_order, section_kind, status, experience_id, education_id, heading, question_text, template_key, char_limit, count_basis, user_note, source_selection_mode, sources_modified_at, generation_no, question_class, ai_content, edited_content, ai_char_count, correction_applied, validation_report, provider, model, model_tier, connection_tier, ai_job_id, updated_at";

const SOURCE_COLUMNS =
  "id, draft_section_id, experience_id, education_id, project_id, project_detail_ids, role, origin, rationale, requirement_ids, reuse_reason, sort_order, source_label, source_deleted_at";

type DraftRow = {
  id: string;
  application_project_id: string;
  draft_type: string;
  title: string;
  status: string;
  options: Json | null;
  insight_id: string | null;
  regenerated_from_id: string | null;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  first_copied_at: string | null;
  provider: string | null;
  model: string | null;
  model_tier: string | null;
  connection_tier: string | null;
  ai_job_id: string | null;
};

type SectionRow = {
  id: string;
  draft_id: string;
  sort_order: number;
  section_kind: string;
  status: string;
  experience_id: string | null;
  education_id: string | null;
  heading: string | null;
  question_text: string | null;
  template_key: string | null;
  char_limit: number | null;
  count_basis: string | null;
  user_note: string | null;
  source_selection_mode: string | null;
  sources_modified_at: string | null;
  generation_no: number;
  question_class: string | null;
  ai_content: Json | null;
  edited_content: Json | null;
  ai_char_count: number | null;
  correction_applied: boolean | null;
  validation_report: Json | null;
  provider: string | null;
  model: string | null;
  model_tier: string | null;
  connection_tier: string | null;
  ai_job_id: string | null;
  updated_at: string;
};

type SourceRow = {
  id: string;
  draft_section_id: string;
  experience_id: string | null;
  education_id: string | null;
  project_id: string | null;
  project_detail_ids: string[] | null;
  role: string;
  origin: string;
  rationale: string | null;
  requirement_ids: string[] | null;
  reuse_reason: string | null;
  sort_order: number;
  source_label: string | null;
  source_deleted_at: string | null;
};

type JobRow = {
  id: string;
  job_type: string;
  target_id: string | null;
  status: string;
  provider: string;
  connection_tier: string;
  error_code: string | null;
  retry_after: string | null;
  quota_resets_at: string | null;
  finished_at: string | null;
};

const JOB_COLUMNS = "id, job_type, target_id, status, provider, connection_tier, error_code, retry_after, quota_resets_at, finished_at";

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : null;
}
function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function badgeOf(row: { provider: string | null; model: string | null; model_tier: string | null; connection_tier: string | null }): DraftProviderBadge {
  return {
    provider: oneOf(AI_PROVIDERS, row.provider),
    model: row.model,
    modelTier: oneOf(MODEL_TIERS, row.model_tier),
    connectionTier: oneOf(CONNECTION_TIERS, row.connection_tier),
  };
}

/** Section status as the screen should see it (a generating row whose job ended = failed). */
export function effectiveSectionStatus(status: string, jobId: string | null, activeJobIds: ReadonlySet<string>): DraftSectionStatus {
  const s = oneOf(DRAFT_SECTION_STATUSES, status) ?? "pending";
  if (s === "generating" && !(jobId && activeJobIds.has(jobId))) return "failed";
  return s;
}

/** Cover letter draft status from its (effective) section statuses (db notes 재계산 규칙). */
export function coverLetterStatus(statuses: readonly DraftSectionStatus[]): DraftStatus {
  if (statuses.includes("generating")) return "generating";
  if (statuses.length > 0 && statuses.every((s) => s === "ready")) return "ready";
  const failed = statuses.includes("failed");
  const ready = statuses.includes("ready");
  if (failed && ready) return "partially_failed";
  if (failed) return "failed";
  return "composing";
}

/** Draft status as the screen should see it. */
export function effectiveDraftStatus(draft: Pick<DraftRow, "draft_type" | "status" | "ai_job_id">, sectionStatuses: readonly DraftSectionStatus[], activeJobIds: ReadonlySet<string>): DraftStatus {
  const stored = oneOf(DRAFT_STATUSES, draft.status) ?? "composing";
  if (draft.draft_type === "cover_letter") return coverLetterStatus(sectionStatuses);
  if (stored === "generating" && !(draft.ai_job_id && activeJobIds.has(draft.ai_job_id))) return "failed";
  return stored;
}

function failureOf(job: JobRow | undefined, sectionId: string | null, fallbackJobId: string): DraftFailure {
  let code: AiErrorCode = "stalled";
  if (job?.status === "failed") code = oneOf(AI_ERROR_CODES, job.error_code) ?? "stalled";
  else if (job?.status === "canceled") code = "canceled";
  const failure = toAiFailure(aiErrorEvent(code, { retryAfter: job?.retry_after ?? null, quotaResetsAt: job?.quota_resets_at ?? null }));
  return { ...failure, jobId: job?.id ?? fallbackJobId, sectionId, failedAt: job?.finished_at ?? null };
}

async function loadJobs(user: UserSupabaseClient, ids: readonly string[]): Promise<Map<string, JobRow>> {
  const out = new Map<string, JobRow>();
  if (ids.length === 0) return out;
  const { data, error } = await user.from("ai_jobs").select(JOB_COLUMNS).in("id", [...new Set(ids)]);
  if (error) throw mapDbError(error);
  for (const j of (data ?? []) as JobRow[]) out.set(j.id, j);
  return out;
}

async function loadActiveDraftJobs(user: UserSupabaseClient, applicationProjectIds: readonly string[]): Promise<JobRow[]> {
  if (applicationProjectIds.length === 0) return [];
  const { data, error } = await user
    .from("ai_jobs")
    .select(JOB_COLUMNS)
    .in("application_project_id", [...new Set(applicationProjectIds)])
    .in("job_type", ["career_description", "cover_letter"])
    .in("status", ["queued", "running"]);
  if (error) throw mapDbError(error);
  return (data ?? []) as JobRow[];
}

// ---------------- S-17 list ----------------

export async function listDrafts(user: UserSupabaseClient, applicationProjectId: string): Promise<DraftList> {
  await assertApplicationProjectOwned(user, applicationProjectId);
  const { data, error } = await user
    .from("drafts")
    .select(DRAFT_COLUMNS)
    .eq("application_project_id", applicationProjectId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw mapDbError(error);
  const drafts = (data ?? []) as DraftRow[];
  const ids = drafts.map((d) => d.id);
  const [sectionsRes, active] = await Promise.all([
    ids.length ? user.from("draft_sections").select("id, draft_id, status, ai_job_id").in("draft_id", ids) : Promise.resolve({ data: [], error: null }),
    loadActiveDraftJobs(user, [applicationProjectId]),
  ]);
  if (sectionsRes.error) throw mapDbError(sectionsRes.error);
  const sections = (sectionsRes.data ?? []) as Array<{ id: string; draft_id: string; status: string; ai_job_id: string | null }>;
  const activeIds = new Set(active.map((j) => j.id));
  const activeTargets = new Set(active.flatMap((j) => (j.target_id ? [j.target_id] : [])));

  const items: DraftListItem[] = drafts.map((d) => {
    const own = sections.filter((s) => s.draft_id === d.id);
    const statuses = own.map((s) => effectiveSectionStatus(s.status, s.ai_job_id, activeIds));
    const options = obj(d.options);
    return {
      id: d.id,
      draftType: oneOf(DRAFT_TYPES, d.draft_type) ?? "cover_letter",
      title: d.title,
      status: effectiveDraftStatus(d, statuses, activeIds),
      sectionCount: own.length,
      readySectionCount: statuses.filter((s) => s === "ready").length,
      selectionOrigin: oneOf(SELECTION_ORIGINS, options.selection_origin),
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      editedAt: d.edited_at,
      firstCopiedAt: d.first_copied_at,
      regeneratedFromId: d.regenerated_from_id,
      badge: badgeOf(d),
      generating: activeTargets.has(d.id) || own.some((s) => activeTargets.has(s.id)),
    };
  });
  return { applicationProjectId, drafts: items };
}

// ---------------- S-19 editor ----------------

function optionsView(value: Json | null): DraftOptionsView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const ranking: DraftSourceRankingItem[] | null = Array.isArray(o.ranking)
    ? o.ranking.flatMap((raw) => {
        const r = obj(raw);
        if (typeof r.project_id !== "string") return [];
        const relevance = r.relevance === "high" || r.relevance === "medium" || r.relevance === "low" ? r.relevance : "low";
        return [{ projectId: r.project_id, relevance, include: r.include === true, requirementIds: strings(r.requirement_ids), reason: typeof r.reason === "string" ? r.reason : "" }];
      })
    : null;
  return {
    includedExperienceIds: strings(o.included_experience_ids),
    includedEducationIds: strings(o.included_education_ids),
    includedProjectIds: strings(o.included_project_ids),
    projectOrder: strings(o.project_order),
    selectionOrigin: oneOf(SELECTION_ORIGINS, o.selection_origin),
    tone: oneOf(DRAFT_TONES, o.tone),
    ranking,
  };
}

type Names = {
  experiences: Map<string, string>;
  educations: Map<string, string>;
  projects: Map<string, string>;
  details: Map<string, string>;
};

async function loadNames(user: UserSupabaseClient, sources: readonly SourceRow[]): Promise<Names> {
  const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => Boolean(x)))];
  const expIds = uniq(sources.map((s) => s.experience_id));
  const eduIds = uniq(sources.map((s) => s.education_id));
  const prjIds = uniq(sources.map((s) => s.project_id));
  const detIds = uniq(sources.flatMap((s) => s.project_detail_ids ?? []));
  const [exp, edu, prj, det] = await Promise.all([
    expIds.length ? user.from("experiences").select("id, company_name").in("id", expIds) : Promise.resolve({ data: [], error: null }),
    eduIds.length ? user.from("educations").select("id, institution_name").in("id", eduIds) : Promise.resolve({ data: [], error: null }),
    prjIds.length ? user.from("projects").select("id, name").in("id", prjIds) : Promise.resolve({ data: [], error: null }),
    detIds.length ? user.from("project_details").select("id, title").in("id", detIds) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [exp, edu, prj, det]) if (r.error) throw mapDbError(r.error);
  return {
    experiences: new Map(((exp.data ?? []) as Array<{ id: string; company_name: string }>).map((r) => [r.id, r.company_name])),
    educations: new Map(((edu.data ?? []) as Array<{ id: string; institution_name: string }>).map((r) => [r.id, r.institution_name])),
    projects: new Map(((prj.data ?? []) as Array<{ id: string; name: string }>).map((r) => [r.id, r.name])),
    details: new Map(((det.data ?? []) as Array<{ id: string; title: string | null }>).map((r) => [r.id, r.title ?? ""])),
  };
}

function sourceView(s: SourceRow, names: Names, chips: Map<string, EvidenceChip[]> | undefined, index: number): DraftSectionSourceView {
  const detailIds = s.project_detail_ids ?? [];
  return {
    id: s.id,
    experienceId: s.experience_id,
    educationId: s.education_id,
    projectId: s.project_id,
    projectDetailIds: detailIds,
    affiliationName: s.experience_id ? (names.experiences.get(s.experience_id) ?? null) : s.education_id ? (names.educations.get(s.education_id) ?? null) : null,
    projectName: s.project_id ? (names.projects.get(s.project_id) ?? null) : null,
    detailTitles: detailIds.flatMap((id) => (names.details.has(id) ? [names.details.get(id)!] : [])),
    role: s.role === "primary" ? "primary" : "supporting",
    origin: s.origin === "user" ? "user" : "ai",
    rationale: s.rationale,
    requirementIds: s.requirement_ids ?? [],
    reuseReason: s.reuse_reason,
    sortOrder: s.sort_order,
    sourceLabel: s.source_label,
    sourceDeletedAt: s.source_deleted_at,
    // Evidence of a choice is stored under `sources.{n}` (n = the row's sort_order, db notes).
    evidence: chips?.get(`sources.${s.sort_order}`) ?? chips?.get(`sources.${index}`) ?? [],
  };
}

function sectionFlags(report: Json | null): { flags: string[]; notes: string[] } {
  const r = obj(report);
  const flags = strings(r.flags);
  if (r.char_adjust_needed === true && !flags.includes("char_adjust_needed")) flags.push("char_adjust_needed");
  return { flags, notes: strings(r.notes_for_user) };
}

export function toSectionView(row: SectionRow, sources: SourceRow[], names: Names, chips: Map<string, EvidenceChip[]> | undefined, activeJobIds: ReadonlySet<string>): DraftSectionView {
  const ai = parseBlocks(row.ai_content);
  const edited = row.edited_content === null || row.edited_content === undefined ? null : parseBlocks(row.edited_content);
  const blocks = toBlockViews(ai, edited, chips);
  const countBasis = oneOf(COUNT_BASES, row.count_basis);
  const isQuestion = row.section_kind === "cover_letter_question";
  const { flags, notes } = sectionFlags(row.validation_report);
  return {
    id: row.id,
    sortOrder: row.sort_order,
    sectionKind: oneOf(DRAFT_SECTION_KINDS, row.section_kind) ?? "experience",
    status: effectiveSectionStatus(row.status, row.ai_job_id, activeJobIds),
    experienceId: row.experience_id,
    educationId: row.education_id,
    heading: row.heading,
    questionText: row.question_text,
    templateKey: oneOf(COVER_LETTER_TEMPLATE_KEYS, row.template_key),
    charLimit: row.char_limit,
    countBasis,
    userNote: row.user_note,
    sourceSelectionMode: row.source_selection_mode === "user" ? "user" : isQuestion ? "ai" : null,
    sourcesModifiedAt: row.sources_modified_at,
    generationNo: row.generation_no ?? 0,
    questionClass: oneOf(QUESTION_CLASSES, row.question_class),
    aiCharCount: row.ai_char_count,
    currentCharCount: isQuestion && (blocks.length > 0 || edited !== null) ? countShownChars(blocks.map((b) => b.text), countBasis ?? "with_spaces") : null,
    correctionApplied: row.correction_applied === true,
    flags,
    notesForUser: notes,
    blocks,
    sources: sources
      .filter((s) => s.draft_section_id === row.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s, i) => sourceView(s, names, chips, i)),
    edited: edited !== null,
    badge: badgeOf(row),
    updatedAt: row.updated_at,
  };
}

export async function getDraft(user: UserSupabaseClient, draftId: string): Promise<DraftView> {
  const { data, error } = await user.from("drafts").select(DRAFT_COLUMNS).eq("id", draftId).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw draftNotFound();
  const draft = data as DraftRow;

  const { data: secData, error: secError } = await user.from("draft_sections").select(SECTION_COLUMNS).eq("draft_id", draftId).order("sort_order", { ascending: true });
  if (secError) throw mapDbError(secError);
  const sections = (secData ?? []) as SectionRow[];
  const sectionIds = sections.map((s) => s.id);

  const [srcRes, chips, active] = await Promise.all([
    sectionIds.length ? user.from("draft_section_sources").select(SOURCE_COLUMNS).in("draft_section_id", sectionIds) : Promise.resolve({ data: [], error: null }),
    loadEvidenceChips(user, { ownerType: "draft_section", ownerIds: sectionIds }),
    loadActiveDraftJobs(user, [draft.application_project_id]),
  ]);
  if (srcRes.error) throw mapDbError(srcRes.error);
  const sources = (srcRes.data ?? []) as SourceRow[];
  const names = await loadNames(user, sources);
  const activeIds = new Set(active.map((j) => j.id));
  const targets = new Set([draftId, ...sectionIds]);

  const sectionViews = sections.map((s) => toSectionView(s, sources, names, chips.get(s.id), activeIds));
  const status = effectiveDraftStatus(draft, sectionViews.map((s) => s.status), activeIds);

  const activeJobs: DraftActiveJob[] = active
    .filter((j) => j.target_id && targets.has(j.target_id))
    .map((j) => ({
      jobId: j.id,
      jobType: j.job_type === "cover_letter" ? "cover_letter" : "career_description",
      sectionId: j.job_type === "cover_letter" ? j.target_id : null,
      status: j.status === "running" ? "running" : "queued",
      provider: oneOf(AI_PROVIDERS, j.provider) ?? "gemini",
      connectionTier: j.connection_tier === "free" ? "free" : "paid",
    }));

  // C-20: failed targets (effective status) → their job's failure.
  const failedSections = sections.filter((s, i) => sectionViews[i]!.status === "failed" && s.ai_job_id);
  const draftFailed = draft.draft_type === "career_description" && status === "failed" && draft.ai_job_id;
  const jobs = await loadJobs(user, [...failedSections.map((s) => s.ai_job_id!), ...(draftFailed ? [draft.ai_job_id!] : [])]);
  const failures: DraftFailure[] = [
    ...(draftFailed ? [failureOf(jobs.get(draft.ai_job_id!), null, draft.ai_job_id!)] : []),
    ...failedSections.map((s) => failureOf(jobs.get(s.ai_job_id!), s.id, s.ai_job_id!)),
    // A user cancel isn't an error to explain (S6 rule); the row still reads failed → "다시 생성".
  ].filter((f) => f.code !== "canceled");

  return {
    id: draft.id,
    applicationProjectId: draft.application_project_id,
    draftType: oneOf(DRAFT_TYPES, draft.draft_type) ?? "cover_letter",
    title: draft.title,
    status,
    options: optionsView(draft.options),
    insightId: draft.insight_id,
    regeneratedFromId: draft.regenerated_from_id,
    createdAt: draft.created_at,
    updatedAt: draft.updated_at,
    editedAt: draft.edited_at,
    firstCopiedAt: draft.first_copied_at,
    badge: badgeOf(draft),
    sections: sectionViews,
    activeJobs,
    failures,
  };
}

/** Section view after a question action (S-18), read through getDraft for one consistent shape. */
export async function getSectionView(user: UserSupabaseClient, draftId: string, sectionId: string): Promise<DraftSectionView> {
  const view = await getDraft(user, draftId);
  const section = view.sections.find((s) => s.id === sectionId);
  if (!section) throw new AppError("not_found", "문항을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });
  return section;
}
