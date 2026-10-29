import type { z } from "zod";
import { aiErrorEvent } from "@/lib/contracts/ai";
import {
  applicationDisplayName,
  toAiFailure,
  type ApplicationBoard,
  type ApplicationHub,
  type ApplicationProgress,
  type ApplicationProjectListItem,
  type JdExtractionFailure,
  type JdRequirementDto,
  type JdView,
  type ListApplicationProjectsInput,
} from "@/lib/contracts/application";
import {
  AI_ERROR_CODES,
  APPLICATION_STAGES,
  type AiErrorCode,
  type AiProvider,
  type ApplicationStage,
  type JdExtractionStatus,
  type JdFieldSource,
  type NameSource,
  type RequirementCategory,
  type RequirementImportance,
  type RequirementOrigin,
  type StageOutcome,
} from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { parseSentences } from "./db";

/**
 * S5 reads through the user session (RLS = ownership): S-13 list, S-39 board,
 * S-31 hub, S-15 JD view. Server Components call these at wiring time.
 */

const notFound = () => new AppError("not_found", "기업 JD를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });

const PROJECT_COLUMNS =
  "id, name, name_source, deadline, memo, stage, stage_outcome, stage_changed_at, last_activity_at, created_at, " +
  "job_descriptions(id, company_name, company_name_source, position_title, position_title_source, extraction_status, extraction_job_id, extraction_provider, extraction_model)";

type JdEmbed = {
  id: string;
  company_name: string | null;
  company_name_source: string | null;
  position_title: string | null;
  position_title_source: string | null;
  extraction_status: string;
  extraction_job_id: string | null;
  extraction_provider: string | null;
  extraction_model: string | null;
};

type ProjectRow = {
  id: string;
  name: string | null;
  name_source: string | null;
  deadline: string | null;
  memo: string | null;
  stage: string;
  stage_outcome: string | null;
  stage_changed_at: string;
  last_activity_at: string;
  created_at: string;
  /** One-to-one embed (unique application_project_id); arrays tolerated. */
  job_descriptions: JdEmbed | JdEmbed[] | null;
};

function jdOf(row: ProjectRow): JdEmbed | null {
  const jd = row.job_descriptions;
  return Array.isArray(jd) ? (jd[0] ?? null) : jd;
}

/**
 * Extension point for S6–S8: insight state, draft count, interview sessions.
 * S5 has no result tables, so every project is `none / 0 / 0 / false`.
 */
export async function loadProgress(_supabase: UserSupabaseClient, ids: readonly string[]): Promise<Map<string, ApplicationProgress>> {
  const out = new Map<string, ApplicationProgress>();
  for (const id of ids) out.set(id, { insight: "none", draftCount: 0, interviewCount: 0, interviewInProgress: false });
  return out;
}

const EMPTY_PROGRESS: ApplicationProgress = { insight: "none", draftCount: 0, interviewCount: 0, interviewInProgress: false };

export function toListItem(row: ProjectRow, progress: ApplicationProgress = EMPTY_PROGRESS, failure: JdExtractionFailure | null = null): ApplicationProjectListItem {
  const jd = jdOf(row);
  const companyName = jd?.company_name ?? null;
  const positionTitle = jd?.position_title ?? null;
  return {
    id: row.id,
    name: row.name,
    nameSource: row.name_source as NameSource | null,
    displayName: applicationDisplayName(row.name, companyName, positionTitle),
    companyName,
    positionTitle,
    deadline: row.deadline,
    stage: row.stage as ApplicationStage,
    stageOutcome: row.stage_outcome as StageOutcome | null,
    stageChangedAt: row.stage_changed_at,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    extractionStatus: (jd?.extraction_status ?? "pending") as JdExtractionStatus,
    lastExtractionFailure: jd?.extraction_status === "failed" ? failure : null,
    progress,
  };
}

async function selectProjects(supabase: UserSupabaseClient, build?: (q: ReturnType<typeof base>) => ReturnType<typeof base>) {
  const q = build ? build(base(supabase)) : base(supabase);
  const { data, error } = await q;
  if (error) throw mapDbError(error);
  return (data ?? []) as unknown as ProjectRow[];
}

function base(supabase: UserSupabaseClient) {
  return supabase.from("application_projects").select(PROJECT_COLUMNS);
}

async function withProgress(supabase: UserSupabaseClient, rows: ProjectRow[]): Promise<ApplicationProjectListItem[]> {
  const failedJobIds = rows.flatMap((r) => {
    const jd = jdOf(r);
    return jd?.extraction_status === "failed" && jd.extraction_job_id ? [jd.extraction_job_id] : [];
  });
  const [progress, failures] = await Promise.all([loadProgress(supabase, rows.map((r) => r.id)), loadExtractionFailures(supabase, failedJobIds)]);
  return rows.map((r) => toListItem(r, progress.get(r.id), failures.get(jdOf(r)?.extraction_job_id ?? "") ?? null));
}

const FAILURE_JOB_COLUMNS = "id, status, error_code, retry_after, quota_resets_at, finished_at";

/**
 * QA-S5-02: the failure shown for a `failed` JD is the job that last ran its
 * extraction (`extraction_job_id`) — failed, or canceled (deleted / refused),
 * or closed as stalled by the sweep (the DB trigger then marks the JD failed).
 */
export async function loadExtractionFailures(supabase: UserSupabaseClient, jobIds: readonly string[]): Promise<Map<string, JdExtractionFailure>> {
  const out = new Map<string, JdExtractionFailure>();
  if (jobIds.length === 0) return out;
  const { data, error } = await supabase.from("ai_jobs").select(FAILURE_JOB_COLUMNS).in("id", [...new Set(jobIds)]);
  if (error) throw mapDbError(error);
  for (const row of data ?? []) {
    const failure = toFailure(row);
    if (failure) out.set(row.id, failure);
  }
  return out;
}

/** S-13: 최근 활동순(기본) / 마감일순 (마감일 없는 행은 뒤), optional stage filter [가정]. */
export async function listApplicationProjects(
  supabase: UserSupabaseClient,
  input: z.output<typeof ListApplicationProjectsInput>,
): Promise<ApplicationProjectListItem[]> {
  const rows = await selectProjects(supabase, (q) => {
    let query = q;
    if (input.stage) query = query.eq("stage", input.stage);
    query =
      input.sort === "deadline"
        ? query.order("deadline", { ascending: true, nullsFirst: false }).order("last_activity_at", { ascending: false })
        : query.order("last_activity_at", { ascending: false });
    return query.order("id");
  });
  return withProgress(supabase, rows);
}

/** S-39: six fixed columns, cards by stage_changed_at desc (D-26 (a)), count per column. */
export async function getBoard(supabase: UserSupabaseClient): Promise<ApplicationBoard> {
  const rows = await selectProjects(supabase, (q) => q.order("stage_changed_at", { ascending: false }).order("id"));
  const items = await withProgress(supabase, rows);
  const columns = APPLICATION_STAGES.map((stage) => {
    const cards = items.filter((i) => i.stage === stage);
    return { stage, count: cards.length, cards };
  });
  return { columns, total: items.length };
}

async function loadProject(supabase: UserSupabaseClient, id: string): Promise<ProjectRow> {
  const rows = await selectProjects(supabase, (q) => q.eq("id", id).limit(1));
  const row = rows[0];
  if (!row || !jdOf(row)) throw notFound();
  return row;
}

/** S-31 hub header + JD card. */
export async function getApplicationHub(supabase: UserSupabaseClient, id: string): Promise<ApplicationHub> {
  const row = await loadProject(supabase, id);
  const jd = jdOf(row)!;
  const [progress, failures, count] = await Promise.all([
    loadProgress(supabase, [row.id]),
    loadExtractionFailures(supabase, jd.extraction_status === "failed" && jd.extraction_job_id ? [jd.extraction_job_id] : []),
    supabase.from("jd_requirements").select("id", { count: "exact", head: true }).eq("job_description_id", jd.id),
  ]);
  if (count.error) throw mapDbError(count.error);
  return {
    ...toListItem(row, progress.get(row.id), failures.get(jd.extraction_job_id ?? "") ?? null),
    memo: row.memo,
    companyNameSource: jd.company_name_source as JdFieldSource | null,
    positionTitleSource: jd.position_title_source as JdFieldSource | null,
    jd: {
      jobDescriptionId: jd.id,
      extractionStatus: jd.extraction_status as JdExtractionStatus,
      requirementCount: count.count ?? 0,
      extractionProvider: jd.extraction_provider as AiProvider | null,
      extractionModel: jd.extraction_model,
    },
  };
}

// ---------------- S-15 JD view ----------------

function asObject(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function parseTechKeywords(value: Json | null | undefined): JdView["techKeywords"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const o = asObject(item);
    return typeof o.keyword === "string" ? [{ keyword: o.keyword, sourceSids: stringArray(o.source_sids) }] : [];
  });
}

export function parseSeniority(extraction: Record<string, unknown>): JdView["seniority"] {
  const s = asObject(extraction.seniority as Json);
  if (typeof s.label !== "string") return null;
  return {
    minYears: typeof s.min_years === "number" ? s.min_years : null,
    maxYears: typeof s.max_years === "number" ? s.max_years : null,
    label: s.label,
    sourceSids: stringArray(s.source_sids),
  };
}

function toFailure(row: { id: string; status: string; error_code: string | null; retry_after: string | null; quota_resets_at: string | null; finished_at: string | null }): JdExtractionFailure | null {
  if (row.status !== "failed" && row.status !== "canceled") return null;
  const known = (AI_ERROR_CODES as readonly string[]).includes(row.error_code ?? "") ? (row.error_code as AiErrorCode) : null;
  const code: AiErrorCode | null = known ?? (row.status === "canceled" ? "canceled" : null);
  if (!code) return null;
  const event = toAiFailure(aiErrorEvent(code, { retryAfter: row.retry_after, quotaResetsAt: row.quota_resets_at }));
  return { ...event, jobId: row.id, failedAt: row.finished_at };
}

export async function getJdView(supabase: UserSupabaseClient, applicationProjectId: string): Promise<JdView> {
  const { data: jd, error } = await supabase
    .from("job_descriptions")
    .select(
      "id, application_project_id, raw_text, sentences, detected_language, company_name, company_name_source, position_title, position_title_source, extraction_status, extraction_job_id, extraction, extraction_provider, extraction_model, tech_keywords",
    )
    .eq("application_project_id", applicationProjectId)
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!jd) throw notFound();

  const [reqs, failures] = await Promise.all([
    supabase
      .from("jd_requirements")
      .select("id, category, content, keywords, importance, source_sids, sort_order, origin, is_user_edited")
      .eq("job_description_id", jd.id)
      .order("sort_order"),
    loadExtractionFailures(supabase, jd.extraction_status === "failed" && jd.extraction_job_id ? [jd.extraction_job_id] : []),
  ]);
  if (reqs.error) throw mapDbError(reqs.error);

  const extraction = asObject(jd.extraction);
  const requirements: JdRequirementDto[] = (reqs.data ?? []).map((r) => ({
    id: r.id,
    category: r.category as RequirementCategory,
    content: r.content,
    keywords: r.keywords ?? [],
    importance: r.importance as RequirementImportance,
    sourceSids: r.source_sids ?? [],
    sortOrder: r.sort_order,
    origin: r.origin as RequirementOrigin,
    isUserEdited: r.is_user_edited,
  }));
  const succeeded = jd.extraction_status === "succeeded";
  return {
    applicationProjectId,
    jobDescriptionId: jd.id,
    rawText: jd.raw_text,
    sentences: parseSentences(jd.sentences),
    detectedLanguage: jd.detected_language,
    companyName: jd.company_name,
    companyNameSource: jd.company_name_source as JdFieldSource | null,
    positionTitle: jd.position_title,
    positionTitleSource: jd.position_title_source as JdFieldSource | null,
    extractionStatus: jd.extraction_status as JdExtractionStatus,
    requirements,
    techKeywords: parseTechKeywords(jd.tech_keywords),
    seniority: succeeded ? parseSeniority(extraction) : null,
    isLikelyJd: succeeded && typeof extraction.is_likely_jd === "boolean" ? extraction.is_likely_jd : null,
    extractionWarnings: succeeded ? stringArray(extraction.warnings) : [],
    extractedBy: succeeded && jd.extraction_provider && jd.extraction_model ? { provider: jd.extraction_provider as AiProvider, model: jd.extraction_model } : null,
    lastFailure: jd.extraction_status === "failed" ? (failures.get(jd.extraction_job_id ?? "") ?? null) : null,
  };
}
