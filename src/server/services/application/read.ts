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
import { loadInsightProgress } from "@/server/services/insight/progress";
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
 * Feature progress per project (S-13, S-39, S-31). S6: insight state
 * (services/insight/read.ts). S7–S8 fill draft and interview counts.
 */
export async function loadProgress(supabase: UserSupabaseClient, ids: readonly string[]): Promise<Map<string, ApplicationProgress>> {
  const out = new Map<string, ApplicationProgress>();
  if (ids.length === 0) return out;
  const insight = await loadInsightProgress(supabase, ids);
  for (const id of ids) out.set(id, { insight: insight.get(id) ?? "none", draftCount: 0, interviewCount: 0, interviewInProgress: false });
  return out;
}

const EMPTY_PROGRESS: ApplicationProgress = { insight: "none", draftCount: 0, interviewCount: 0, interviewInProgress: false };

export function toListItem(row: ProjectRow, progress: ApplicationProgress = EMPTY_PROGRESS, jobs: ReadonlyMap<string, ExtractionJobRow> = new Map()): ApplicationProjectListItem {
  const jd = jdOf(row);
  const extraction = jd ? resolveExtraction(jd, jobs) : { status: "pending" as JdExtractionStatus, failure: null };
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
    extractionStatus: extraction.status,
    lastExtractionFailure: extraction.status === "failed" ? extraction.failure : null,
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
  const jobIds = rows.flatMap((r) => extractionJobToCheck(jdOf(r)));
  const [progress, jobs] = await Promise.all([loadProgress(supabase, rows.map((r) => r.id)), loadExtractionJobs(supabase, jobIds)]);
  return rows.map((r) => toListItem(r, progress.get(r.id), jobs));
}

const FAILURE_JOB_COLUMNS = "id, status, error_code, retry_after, quota_resets_at, finished_at";

/**
 * QA-S5-02: the failure shown for a `failed` JD is the job that last ran its
 * extraction (`extraction_job_id`) — failed, or canceled (deleted / refused),
 * or closed as stalled by the sweep (the DB trigger then marks the JD failed).
 */
export type ExtractionJobRow = { id: string; status: string; error_code: string | null; retry_after: string | null; quota_resets_at: string | null; finished_at: string | null };

/** Jobs whose state decides a JD's shown extraction status: `failed` (the failure) and `running` (still alive?). */
export function extractionJobToCheck(jd: { extraction_status: string; extraction_job_id: string | null } | null): string[] {
  return jd && (jd.extraction_status === "failed" || jd.extraction_status === "running") && jd.extraction_job_id ? [jd.extraction_job_id] : [];
}

export async function loadExtractionJobs(supabase: UserSupabaseClient, jobIds: readonly string[]): Promise<Map<string, ExtractionJobRow>> {
  const out = new Map<string, ExtractionJobRow>();
  if (jobIds.length === 0) return out;
  const { data, error } = await supabase.from("ai_jobs").select(FAILURE_JOB_COLUMNS).in("id", [...new Set(jobIds)]);
  if (error) throw mapDbError(error);
  for (const row of data ?? []) out.set(row.id, row);
  return out;
}

/**
 * The extraction status to show (S6, QA-S5-06 follow-up): the "job ended →
 * JD failed" trigger skips locked rows, so a JD can rarely stay `running`
 * after its job ended. A `running` JD whose job is terminal and not
 * succeeded — or gone — is shown as `failed` with that job's failure
 * (`stalled` when the job row no longer exists). A `failed` JD shows its
 * job's failure as before (QA-S5-02).
 */
export function resolveExtraction(
  jd: { extraction_status: string; extraction_job_id: string | null },
  jobs: ReadonlyMap<string, ExtractionJobRow>,
): { status: JdExtractionStatus; failure: JdExtractionFailure | null } {
  const status = jd.extraction_status as JdExtractionStatus;
  const job = jd.extraction_job_id ? jobs.get(jd.extraction_job_id) : undefined;
  if (status === "failed") return { status, failure: job ? toFailure(job) : null };
  if (status !== "running") return { status, failure: null };
  if (!job) {
    if (!jd.extraction_job_id) return { status, failure: null };
    const event = toAiFailure(aiErrorEvent("stalled"));
    return { status: "failed", failure: { ...event, jobId: jd.extraction_job_id, failedAt: null } };
  }
  if (job.status === "failed" || job.status === "canceled") return { status: "failed", failure: toFailure(job) };
  return { status, failure: null };
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
  const [progress, jobs, count] = await Promise.all([
    loadProgress(supabase, [row.id]),
    loadExtractionJobs(supabase, extractionJobToCheck(jd)),
    supabase.from("jd_requirements").select("id", { count: "exact", head: true }).eq("job_description_id", jd.id),
  ]);
  if (count.error) throw mapDbError(count.error);
  return {
    ...toListItem(row, progress.get(row.id), jobs),
    memo: row.memo,
    companyNameSource: jd.company_name_source as JdFieldSource | null,
    positionTitleSource: jd.position_title_source as JdFieldSource | null,
    jd: {
      jobDescriptionId: jd.id,
      extractionStatus: resolveExtraction(jd, jobs).status,
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

  const [reqs, jobs] = await Promise.all([
    supabase
      .from("jd_requirements")
      .select("id, category, content, keywords, importance, source_sids, sort_order, origin, is_user_edited")
      .eq("job_description_id", jd.id)
      .order("sort_order"),
    loadExtractionJobs(supabase, extractionJobToCheck(jd)),
  ]);
  const resolved = resolveExtraction(jd, jobs);
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
    extractionStatus: resolved.status,
    requirements,
    techKeywords: parseTechKeywords(jd.tech_keywords),
    seniority: succeeded ? parseSeniority(extraction) : null,
    isLikelyJd: succeeded && typeof extraction.is_likely_jd === "boolean" ? extraction.is_likely_jd : null,
    extractionWarnings: succeeded ? stringArray(extraction.warnings) : [],
    extractedBy: succeeded && jd.extraction_provider && jd.extraction_model ? { provider: jd.extraction_provider as AiProvider, model: jd.extraction_model } : null,
    lastFailure: resolved.status === "failed" ? resolved.failure : null,
  };
}
