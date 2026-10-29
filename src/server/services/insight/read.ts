import { aiErrorEvent } from "@/lib/contracts/ai";
import { toAiFailure } from "@/lib/contracts/application";
import { AI_ERROR_CODES, AI_PROVIDERS, CONNECTION_TIERS, MODEL_TIERS, type AiErrorCode, type AiProvider, type ConnectionTier, type ModelTier } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import type { EvidenceChip } from "@/lib/contracts/evidence";
import {
  GAP_ACTION_TYPES,
  GAP_KINDS,
  MATCH_STATUSES,
  type GapActionType,
  type GapKind,
  type InsightActiveJob,
  type InsightLastFailure,
  type InsightRequirement,
  type InsightResultView,
  type InsightView,
  type MatchStatus,
} from "@/lib/contracts/insight";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { extractionJobToCheck, loadExtractionJobs, resolveExtraction } from "@/server/services/application/read";
import { loadEvidenceChips } from "@/server/services/evidence";
import { loadInsightInputs, loadInsightJd, loadInsightRequirements, type InsightInputs } from "./db";
import { INSIGHT_JOB_TYPE, type InsightPipeline } from "./job";

/**
 * S-16 insight read (S6 plan "계약 — API" 3–5; F-P2-04/05/07/09, C-01/C-02,
 * C-03, C-19, C-20). User session only (RLS = ownership).
 *
 * - The latest ready insight (or a requested ready version), its items with
 *   evidence chips (shared evidence service), requirement contents instead of
 *   aliases, project names for priorities, the C-19 provider badge.
 * - F-P2-07 MVP "데이터 변경됨": `stale` when the current career snapshot hash
 *   or requirements hash differs from the stored one (same builders as the job).
 * - The insight job in flight (C-03) and the last failed run after the shown
 *   result (C-20). A `generating` row is never shown; whether something is
 *   generating is decided by the job (db notes: a generating row whose job
 *   ended counts as failed).
 */

export type InsightReadDeps = {
  /** Same context builder as the job, so hashes compare like for like. */
  pipeline: Pick<InsightPipeline, "buildContext" | "hashes">;
  loadInputs?: (db: UserSupabaseClient, applicationProjectId: string) => Promise<InsightInputs | null>;
};

const notFound = () => new AppError("not_found", "기업 JD를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });

const INSIGHT_COLUMNS =
  "id, version_no, status, is_latest, result, requirements_hash, career_snapshot_hash, provider, model, model_tier, connection_tier, prompt_version, created_at, completed_at";

type InsightRow = {
  id: string;
  version_no: number;
  status: string;
  is_latest: boolean;
  result: Json | null;
  requirements_hash: string | null;
  career_snapshot_hash: string | null;
  provider: string | null;
  model: string | null;
  model_tier: string | null;
  connection_tier: string | null;
  prompt_version: string | null;
  created_at: string;
  completed_at: string | null;
};

const JOB_COLUMNS = "id, status, progress, provider, connection_tier, error_code, retry_after, quota_resets_at, finished_at, created_at";
export type JobRow = {
  id: string;
  status: string;
  progress: Json;
  provider: string;
  connection_tier: string;
  error_code: string | null;
  retry_after: string | null;
  quota_resets_at: string | null;
  finished_at: string | null;
  created_at: string;
};

// ---------------- tolerant result parsing (stored form: ai storage/insight.ts InsightResult) ----------------

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
const enumOrNull = <T extends string>(list: readonly T[], v: unknown): T | null => oneOf(list, v);

type ChipsByItem = Map<string, EvidenceChip[]>;

export function toInsightResultView(
  row: InsightRow,
  ctx: {
    chips: ChipsByItem;
    requirements: ReadonlyMap<string, InsightRequirement>;
    projectNames: ReadonlyMap<string, string>;
    stale: { career: boolean; requirements: boolean };
  },
): InsightResultView {
  const r = obj(row.result);
  const chipsOf = (key: string) => ctx.chips.get(key) ?? [];

  const requirementMatches = arr(r.requirement_matches).flatMap((raw) => {
    const m = obj(raw);
    const status = oneOf<MatchStatus>(MATCH_STATUSES, m.status);
    const requirementId = str(m.requirement_id);
    if (!status || !requirementId) return [];
    const itemKey = str(m.item_key) || `requirement_matches.${requirementId}`;
    return [
      {
        itemKey,
        requirementId,
        requirement: ctx.requirements.get(requirementId) ?? null,
        status,
        rationale: str(m.rationale),
        missingAspect: strOrNull(m.missing_aspect),
        evidence: chipsOf(itemKey),
      },
    ];
  });

  const strengths = arr(r.strengths).map((raw, n) => {
    const s = obj(raw);
    const itemKey = str(s.item_key) || `strengths.${n}`;
    return { itemKey, title: str(s.title), description: str(s.description), requirementIds: strs(s.requirement_ids), evidence: chipsOf(itemKey) };
  });

  const gaps = arr(r.gaps).flatMap((raw, n) => {
    const g = obj(raw);
    const gapKind = oneOf<GapKind>(GAP_KINDS, g.gap_kind);
    if (!gapKind) return [];
    const itemKey = str(g.item_key) || `gaps.${n}`;
    const requirementIds = strs(g.requirement_ids);
    const actions = arr(g.actions).flatMap((rawAction, m) => {
      const a = obj(rawAction);
      const type = oneOf<GapActionType>(GAP_ACTION_TYPES, a.type);
      if (!type) return [];
      const actionKey = str(a.item_key) || `gaps.${n}.actions.${m}`;
      // F-P2-09: add_data opens S-36 / S-10 with "관련 요건: …" from the gap's requirements.
      return [{ itemKey: actionKey, type, text: str(a.text), evidence: chipsOf(actionKey), relatedRequirementIds: type === "add_data" ? requirementIds : [] }];
    });
    return [{ itemKey, requirementIds, gapKind, description: str(g.description), evidence: chipsOf(itemKey), actions }];
  });

  const strategy = obj(r.strategy);
  const positioningText = strOrNull(strategy.positioning);
  const positioningKey = str(strategy.positioning_item_key) || "strategy.positioning";
  const projectPriorities = arr(strategy.project_priorities)
    .flatMap((raw, n) => {
      const p = obj(raw);
      const projectId = str(p.project_id);
      if (!projectId) return [];
      const itemKey = str(p.item_key) || `strategy.project_priorities.${n}`;
      return [
        {
          itemKey,
          rank: typeof p.rank === "number" ? p.rank : n + 1,
          projectId,
          projectName: ctx.projectNames.get(projectId) ?? null,
          reason: str(p.reason),
          requirementIds: strs(p.requirement_ids),
          evidence: chipsOf(itemKey),
        },
      ];
    })
    .sort((a, b) => a.rank - b.rank);

  const counts = obj(r.summary_counts);
  const summaryCounts = Object.fromEntries(
    MATCH_STATUSES.map((s) => [s, typeof counts[s] === "number" ? (counts[s] as number) : requirementMatches.filter((m) => m.status === s).length]),
  ) as Record<MatchStatus, number>;
  const sufficiency = obj(r.data_sufficiency);

  return {
    id: row.id,
    versionNo: row.version_no,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? row.created_at,
    provider: enumOrNull<AiProvider>(AI_PROVIDERS, row.provider),
    model: row.model,
    modelTier: enumOrNull<ModelTier>(MODEL_TIERS, row.model_tier),
    connectionTier: enumOrNull<ConnectionTier>(CONNECTION_TIERS, row.connection_tier),
    promptVersion: row.prompt_version,
    stale: ctx.stale.career || ctx.stale.requirements,
    staleReasons: ctx.stale,
    basisNote: str(r.basis_note) || "입력된 경력 데이터 기준 분석입니다",
    dataSufficiency: { level: sufficiency.level === "thin" ? "thin" : "ok", hints: strs(sufficiency.hints) },
    summaryCounts,
    requirementMatches,
    strengths,
    gaps,
    strategy: {
      positioning: positioningText ? { itemKey: positioningKey, text: positioningText, evidence: chipsOf(positioningKey) } : null,
      projectPriorities,
    },
  };
}

/**
 * Run state for S-16 (C-03 / C-20). The DB's "job ended → generating row
 * failed" trigger skips locked rows (QA-S5-06), so a `generating` row can
 * outlive its job; it counts as failed:
 * - the row's job is queued/running → in progress (activeJob)
 * - its job failed → that failure; succeeded without complete_insight or gone → `stalled`;
 *   canceled → no failure (a user cancel isn't an error [가정])
 * Otherwise the newest insight job, when it failed after the shown result, is the failure.
 */
export function resolveInsightRun(
  jobs: readonly JobRow[],
  pendingRow: { status: string; ai_job_id: string | null } | null,
  shownAt: number,
): { activeJob: InsightActiveJob | null; lastFailure: InsightLastFailure | null } {
  const activeJob = jobs.map(toActiveJob).find((j): j is InsightActiveJob => j !== null) ?? null;
  if (activeJob) return { activeJob, lastFailure: null };
  if (pendingRow?.status === "generating" && pendingRow.ai_job_id) {
    const job = jobs.find((j) => j.id === pendingRow.ai_job_id);
    if (!job || job.status === "succeeded") {
      return { activeJob: null, lastFailure: { ...toAiFailure(aiErrorEvent("stalled")), jobId: pendingRow.ai_job_id, failedAt: job?.finished_at ?? null } };
    }
    if (job.status === "failed") return { activeJob: null, lastFailure: toFailure(job) };
  }
  const newest = jobs[0];
  const lastFailure = newest && newest.status === "failed" && Date.parse(newest.finished_at ?? newest.created_at) > shownAt ? toFailure(newest) : null;
  return { activeJob: null, lastFailure };
}

/** C-20 failure of a failed insight job (same shape as the S5 JD failure). */
function toFailure(row: JobRow): InsightLastFailure | null {
  if (row.status !== "failed") return null;
  const code = oneOf<AiErrorCode>(AI_ERROR_CODES, row.error_code) ?? "stalled";
  return { ...toAiFailure(aiErrorEvent(code, { retryAfter: row.retry_after, quotaResetsAt: row.quota_resets_at })), jobId: row.id, failedAt: row.finished_at };
}

function toActiveJob(row: JobRow): InsightActiveJob | null {
  if (row.status !== "queued" && row.status !== "running") return null;
  const p = obj(row.progress);
  return {
    jobId: row.id,
    status: row.status,
    progress: {
      stage: str(p.stage) || "prepare",
      done: typeof p.done === "number" ? p.done : 0,
      total: typeof p.total === "number" ? p.total : 1,
    },
    provider: (enumOrNull<AiProvider>(AI_PROVIDERS, row.provider) ?? "anthropic") as AiProvider,
    connectionTier: (enumOrNull<ConnectionTier>(CONNECTION_TIERS, row.connection_tier) ?? "paid") as ConnectionTier,
  };
}

// ---------------- reads ----------------

/** Project names (current) for strategy priorities → S-10. */
async function loadProjectNames(user: UserSupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data, error } = await user.from("projects").select("id, name").in("id", [...new Set(ids)]);
  if (error) throw mapDbError(error);
  for (const p of data ?? []) if (p.name) out.set(p.id, p.name);
  return out;
}

async function loadLatestInsightJobs(user: UserSupabaseClient, applicationProjectId: string): Promise<JobRow[]> {
  const { data, error } = await user
    .from("ai_jobs")
    .select(JOB_COLUMNS)
    .eq("application_project_id", applicationProjectId)
    .eq("job_type", INSIGHT_JOB_TYPE)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw mapDbError(error);
  return (data ?? []) as JobRow[];
}

export async function getInsight(user: UserSupabaseClient, input: { applicationProjectId: string; version?: number }, deps: InsightReadDeps): Promise<InsightView> {
  const { applicationProjectId } = input;
  const jd = await loadInsightJd(user, applicationProjectId);
  if (!jd) throw notFound();

  let insightQuery = user.from("insights").select(INSIGHT_COLUMNS).eq("application_project_id", applicationProjectId).eq("status", "ready");
  insightQuery = input.version ? insightQuery.eq("version_no", input.version) : insightQuery.eq("is_latest", true);
  const [requirementRows, insightResult, jobs, pendingResult, extractionJobs] = await Promise.all([
    loadInsightRequirements(user, jd.jobDescriptionId),
    insightQuery.limit(1),
    loadLatestInsightJobs(user, applicationProjectId),
    // Newest version that isn't ready: a `generating` row whose job ended counts as failed (db notes).
    user.from("insights").select("status, ai_job_id").eq("application_project_id", applicationProjectId).neq("status", "ready").order("version_no", { ascending: false }).limit(1),
    loadExtractionJobs(user, extractionJobToCheck({ extraction_status: jd.extractionStatus, extraction_job_id: jd.extractionJobId })),
  ]);
  if (pendingResult.error) throw mapDbError(pendingResult.error);
  if (insightResult.error) throw mapDbError(insightResult.error);
  const row = ((insightResult.data ?? [])[0] ?? null) as InsightRow | null;
  if (input.version && !row) throw new AppError("insight_not_found", "인사이트를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });

  const requirements: InsightRequirement[] = requirementRows.map((r) => ({
    id: r.id,
    category: r.category,
    content: r.content,
    importance: r.importance,
    sortOrder: r.sort_order,
  }));
  const requirementMap = new Map(requirements.map((r) => [r.id, r]));

  let insight: InsightResultView | null = null;
  if (row) {
    const priorities = arr(obj(obj(row.result).strategy).project_priorities).map((p) => str(obj(p).project_id)).filter(Boolean);
    const [chips, projectNames, stale] = await Promise.all([
      loadEvidenceChips(user, { ownerType: "insight", ownerIds: [row.id] }),
      loadProjectNames(user, priorities),
      staleness(user, applicationProjectId, row, deps),
    ]);
    insight = toInsightResultView(row, { chips: chips.get(row.id) ?? new Map(), requirements: requirementMap, projectNames, stale });
  }

  const { activeJob: active, lastFailure } = resolveInsightRun(jobs, (pendingResult.data ?? [])[0] ?? null, insight ? Date.parse(insight.completedAt) : -Infinity);

  return {
    applicationProjectId,
    requirements,
    extractionStatus: resolveExtraction({ extraction_status: jd.extractionStatus, extraction_job_id: jd.extractionJobId }, extractionJobs).status,
    insight,
    activeJob: active,
    lastFailure,
  };
}

/** F-P2-07 MVP: current hashes (same builders as the job) vs. the stored ones. */
async function staleness(
  user: UserSupabaseClient,
  applicationProjectId: string,
  row: InsightRow,
  deps: InsightReadDeps,
): Promise<{ career: boolean; requirements: boolean }> {
  const inputs = await (deps.loadInputs ?? loadInsightInputs)(user, applicationProjectId);
  if (!inputs) return { career: false, requirements: false };
  const now = deps.pipeline.hashes(deps.pipeline.buildContext(inputs));
  return {
    career: row.career_snapshot_hash !== null && row.career_snapshot_hash !== now.careerSnapshotHash,
    requirements: row.requirements_hash !== null && row.requirements_hash !== now.requirementsHash,
  };
}
