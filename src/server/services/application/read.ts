import type { z } from "zod";
import {
  applicationDisplayName,
  type ApplicationBoard,
  type ApplicationHub,
  type ApplicationProgress,
  type ApplicationProjectListItem,
  type JdRawTextLock,
  type JdView,
  type ListApplicationProjectsInput,
} from "@/lib/contracts/application";
import { APPLICATION_STAGES, type ApplicationStage, type JdFieldSource, type NameSource, type StageOutcome } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { loadDocumentCounts } from "@/server/services/application-document/progress";
import { loadInsightProgress } from "@/server/services/insight/progress";
import { parseSentences } from "./db";

/**
 * S5 reads through the user session (RLS = ownership): S-13 list, S-39 board,
 * S-31 hub, S-15 JD view. Server Components call these at wiring time.
 * R17: no extraction state — the JD is the raw text (and its deterministic sentence split).
 */

const notFound = () => new AppError("not_found", "자기소개서를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });

const PROJECT_COLUMNS =
  "id, name, name_source, deadline, memo, stage, stage_outcome, stage_changed_at, last_activity_at, created_at, " +
  "job_descriptions(id, company_name, company_name_source, position_title, position_title_source)";

type JdEmbed = {
  id: string;
  company_name: string | null;
  company_name_source: string | null;
  position_title: string | null;
  position_title_source: string | null;
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
 * (services/insight/read.ts). R15: `draftCount` is the 자기소개서 정본 count (0 or 1, CF-A14).
 */
export async function loadProgress(supabase: UserSupabaseClient, ids: readonly string[]): Promise<Map<string, ApplicationProgress>> {
  const out = new Map<string, ApplicationProgress>();
  if (ids.length === 0) return out;
  const [insight, drafts] = await Promise.all([loadInsightProgress(supabase, ids), loadDocumentCounts(supabase, ids)]);
  for (const id of ids) {
    out.set(id, {
      insight: insight.get(id) ?? "none",
      draftCount: drafts.get(id) ?? 0,
    });
  }
  return out;
}

const EMPTY_PROGRESS: ApplicationProgress = { insight: "none", draftCount: 0 };

export function toListItem(row: ProjectRow, progress: ApplicationProgress = EMPTY_PROGRESS): ApplicationProjectListItem {
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
  const progress = await loadProgress(supabase, rows.map((r) => r.id));
  return rows.map((r) => toListItem(r, progress.get(r.id)));
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
  const progress = await loadProgress(supabase, [row.id]);
  return {
    ...toListItem(row, progress.get(row.id)),
    memo: row.memo,
    companyNameSource: jd.company_name_source as JdFieldSource | null,
    positionTitleSource: jd.position_title_source as JdFieldSource | null,
    jd: { jobDescriptionId: jd.id },
  };
}

// ---------------- S-15 JD view ----------------

/**
 * R17-6: `update_failed_jd_raw_text` is unchanged (the DB keeps its extraction-based conditions),
 * so this mirror still reads the legacy `extraction_status` / `extraction_job_id` columns and the
 * legacy `jd_requirements` count. A JD created after R17 stays `pending` → `jd_raw_text_locked`.
 * The edit rule without extraction is a planning question (spec gap); this mirrors the RPC only.
 */

/** DM 2.6.1 condition 4: failures the user can fix by editing the text (legacy AI-01 causes). */
const INPUT_CAUSED_JD_FAILURES: ReadonlySet<string> = new Set(["not_a_jd", "input_too_long", "safety_blocked"]);

export type JdRawTextFacts = {
  /** Condition 1: a queued / running ai_jobs row on this project (any type). */
  jobInProgress: boolean;
  extractionStatus: string;
  /** `extraction_job_id`'s row; null when pruned or never run. */
  extractionJob: { job_type: string; status: string; error_code: string | null } | null;
  /** Legacy `jd_requirements` rows (pre-R17). */
  requirementCount: number;
  /** Condition 5, read only when conditions 1~4 pass. */
  hasResults: () => Promise<boolean>;
};

/** Conditions 1~5 of update_failed_jd_raw_text, same order and same rules (the RPC decides finally). */
export async function jdRawTextLockOf(f: JdRawTextFacts): Promise<JdRawTextLock | null> {
  if (f.jobInProgress) return "jd_job_in_progress";
  const failed = f.extractionStatus === "failed" || (f.extractionStatus === "running" && f.extractionJob?.status === "failed");
  if (!failed && f.extractionStatus !== "succeeded") return "jd_raw_text_locked";
  if (f.requirementCount > 0) return "jd_raw_text_locked";
  if (failed) {
    const job = f.extractionJob;
    if (!job || job.job_type !== "jd_extraction" || job.status !== "failed" || !INPUT_CAUSED_JD_FAILURES.has(job.error_code ?? "")) return "jd_failure_not_input";
  }
  return (await f.hasResults()) ? "jd_has_results" : null;
}

async function hasRowsFromThisText(supabase: UserSupabaseClient, applicationProjectId: string): Promise<boolean> {
  const count = async (q: PromiseLike<{ count: number | null; error: { code?: string | null; message?: string | null } | null }>) => {
    const { count: n, error } = await q;
    if (error) throw mapDbError(error);
    return n ?? 0;
  };
  const head = { count: "exact", head: true } as const;
  /**
   * Condition 5 (R15 `update_failed_jd_raw_text`): ready insights or JD evidence.
   * The 서류 branch is gone (spec-gaps R15-DB-8) — a JD used only for a 자기소개서 may have its
   * raw text edited, because the 자소서 answers are not derived from the requirement rows the way
   * a 경력기술서 was. Keep this mirror in step with the RPC.
   */
  const [insights, evidence] = await Promise.all([
    count(supabase.from("insights").select("id", head).eq("application_project_id", applicationProjectId).eq("status", "ready")),
    count(supabase.from("evidence_links").select("id", head).eq("application_project_id", applicationProjectId).in("source_type", ["jd_requirement", "jd_sentence"])),
  ]);
  return insights > 0 || evidence > 0;
}

async function loadJdRawTextLock(
  supabase: UserSupabaseClient,
  jd: { application_project_id: string; extraction_status: string; extraction_job_id: string | null },
  requirementCount: number,
): Promise<JdRawTextLock | null> {
  const [active, job] = await Promise.all([
    supabase.from("ai_jobs").select("id", { count: "exact", head: true }).eq("application_project_id", jd.application_project_id).in("status", ["queued", "running"]),
    jd.extraction_job_id ? supabase.from("ai_jobs").select("job_type, status, error_code").eq("id", jd.extraction_job_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (active.error) throw mapDbError(active.error);
  if (job.error) throw mapDbError(job.error);
  return jdRawTextLockOf({
    jobInProgress: (active.count ?? 0) > 0,
    extractionStatus: jd.extraction_status,
    extractionJob: job.data,
    requirementCount,
    hasResults: () => hasRowsFromThisText(supabase, jd.application_project_id),
  });
}

export async function getJdView(supabase: UserSupabaseClient, applicationProjectId: string): Promise<JdView> {
  const { data: jd, error } = await supabase
    .from("job_descriptions")
    .select("id, application_project_id, raw_text, raw_text_edited_at, sentences, company_name, company_name_source, position_title, position_title_source, extraction_status, extraction_job_id")
    .eq("application_project_id", applicationProjectId)
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!jd) throw notFound();

  // Legacy rows only feed the raw-text lock mirror (R17-6); the view itself shows no requirements.
  const reqs = await supabase.from("jd_requirements").select("id", { count: "exact", head: true }).eq("job_description_id", jd.id);
  if (reqs.error) throw mapDbError(reqs.error);
  const rawTextLock = await loadJdRawTextLock(supabase, jd, reqs.count ?? 0);
  return {
    applicationProjectId,
    jobDescriptionId: jd.id,
    rawText: jd.raw_text,
    rawTextEditedAt: jd.raw_text_edited_at,
    rawTextEditable: rawTextLock === null,
    rawTextLock,
    sentences: parseSentences(jd.sentences),
    companyName: jd.company_name,
    companyNameSource: jd.company_name_source as JdFieldSource | null,
    positionTitle: jd.position_title,
    positionTitleSource: jd.position_title_source as JdFieldSource | null,
  };
}
