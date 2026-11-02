import { z } from "zod";
import type { AiJobStatus, AiProvider, ConnectionTier, ModelTier, RequirementCategory, RequirementImportance } from "./enums";
import type { AiFailure } from "./application";
import type { ReadinessFeature } from "./career";
import type { EvidenceChip } from "./evidence";

/**
 * S6 insight contracts (AI-02; F-P2-04/05/07/09, F-AP-06, D-30; DM A.8, §6;
 * UX S-16, C-01/C-02/C-03/C-20).
 */

// ---------- enums (insights.status CHECK, AI-02 output) ----------

/** insights.status CHECK (DM A.8). */
export const INSIGHT_STATUSES = ["generating", "ready", "failed"] as const;
export type InsightStatus = (typeof INSIGHT_STATUSES)[number];

/** AI-02 requirement match status: 충족 / 부분 충족 / 근거 없음. */
export const MATCH_STATUSES = ["met", "partial", "no_evidence"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** AI-02 `gaps[].actions[].type`. */
export const GAP_ACTION_TYPES = ["add_data", "reframe", "prepare_answer"] as const;
export type GapActionType = (typeof GAP_ACTION_TYPES)[number];

/** AI-02 `gaps[].gap_kind` (from the stage-1 statuses it can come from). */
export const GAP_KINDS = ["no_evidence", "partial"] as const;
export type GapKind = (typeof GAP_KINDS)[number];

/** AI-02 `data_sufficiency.level` (server rule). */
export const INSIGHT_DATA_SUFFICIENCY_LEVELS = ["ok", "thin"] as const;

// ---------- start: POST /api/application-projects/{id}/insights ----------

/** Body: `{ regenerate?: boolean }` — "다시 생성" skips input_hash reuse (C-6, F-P2-07). Empty body = `{}`. */
export const StartInsightInput = z.object({ regenerate: z.boolean().optional().default(false) }).strict();
export type StartInsightInput = z.input<typeof StartInsightInput>;

/**
 * 200 `{ data }`:
 * - `reused: true` — the same input (provider, model, career snapshot,
 *   requirements, prompt version) already has a ready insight: show it, no
 *   job, no provider call, no usage record (C-6, NFR-AI-08).
 * - `reused: false` — a job was started (`inProgress: false`) or one is
 *   already running for this project (`inProgress: true`, D-34). Poll
 *   `GET /api/ai-jobs/{jobId}` (`partial` = stage-1 matches); cancel with
 *   `POST /api/ai-jobs/{jobId}/cancel`; retry a failure with `/retry`.
 *
 * Errors: 401, 404 `not_found`, 422 `insufficient_data` (+ `readiness` =
 * `get_data_readiness().features.insight`, C-10), 409 `ai_not_connected` /
 * `key_invalid` / `ai_consent_required` (C-18 / C-20).
 */
export type StartInsightResponse =
  | { reused: true; insightId: string; jobId: null; inProgress: false }
  | { reused: false; insightId: null; jobId: string; inProgress: boolean };

/** 422 body: the error plus the readiness the C-10 banner needs. */
export type InsufficientDataResponse = {
  error: { code: "insufficient_data"; message: string };
  readiness: ReadinessFeature;
};

// ---------- job status partial (GET /api/ai-jobs/{id}, job_type = insight) ----------

/**
 * `AiJobStatusResponse.partial` for an insight job (S-16 부분 결과, C-03):
 * stage-1 verdicts as soon as batches finish — before the insight is saved,
 * so no evidence chips yet. Requirement text comes from `InsightView.requirements`.
 */
export type InsightJobPartial = {
  kind: "insight_matches";
  batchesDone: number;
  /** Null until the match stage knows its batch count. */
  batchesTotal: number | null;
  requirementMatches: Array<{
    requirementId: string;
    status: MatchStatus;
    rationale: string;
    missingAspect: string | null;
  }>;
};

// ---------- read: getInsight (S-16) ----------

export type InsightRequirement = {
  id: string;
  category: RequirementCategory;
  content: string;
  importance: RequirementImportance;
  sortOrder: number;
};

export type InsightRequirementMatch = {
  itemKey: string;
  requirementId: string;
  /** Null when the requirement row no longer exists. */
  requirement: InsightRequirement | null;
  status: MatchStatus;
  rationale: string;
  missingAspect: string | null;
  evidence: EvidenceChip[];
};

export type InsightStrength = {
  itemKey: string;
  title: string;
  description: string;
  requirementIds: string[];
  evidence: EvidenceChip[];
};

export type InsightGapAction = {
  itemKey: string;
  type: GapActionType;
  text: string;
  evidence: EvidenceChip[];
  /**
   * F-P2-09: for `add_data`, the requirements to show as "관련 요건: …" when
   * the user opens S-36 (AI와 대화하며 추가) or S-10 (직접 입력). The chat
   * start uses `returnTarget = { applicationProjectId, feature: 'insight' }` (S4).
   */
  relatedRequirementIds: string[];
};

export type InsightGap = {
  itemKey: string;
  requirementIds: string[];
  gapKind: GapKind;
  description: string;
  evidence: EvidenceChip[];
  actions: InsightGapAction[];
};

export type InsightProjectPriority = {
  itemKey: string;
  rank: number;
  projectId: string;
  /** Current project name (→ S-10); null when the project was deleted. */
  projectName: string | null;
  reason: string;
  requirementIds: string[];
  evidence: EvidenceChip[];
};

export type InsightResultView = {
  id: string;
  versionNo: number;
  createdAt: string;
  completedAt: string;
  /** C-19 result badge: the provider / model that made it (F-AI-09). */
  provider: AiProvider | null;
  model: string | null;
  modelTier: ModelTier | null;
  connectionTier: ConnectionTier | null;
  promptVersion: string | null;
  /**
   * F-P2-07 MVP "데이터 변경됨": the current career snapshot or requirement
   * list differs from what this insight was made from. Show it with "다시 생성".
   */
  stale: boolean;
  staleReasons: { career: boolean; requirements: boolean };
  basisNote: string;
  dataSufficiency: { level: (typeof INSIGHT_DATA_SUFFICIENCY_LEVELS)[number]; hints: string[] };
  summaryCounts: Record<MatchStatus, number>;
  requirementMatches: InsightRequirementMatch[];
  strengths: InsightStrength[];
  gaps: InsightGap[];
  strategy: {
    positioning: { itemKey: string; text: string; evidence: EvidenceChip[] } | null;
    projectPriorities: InsightProjectPriority[];
  };
};

/** The insight job running now for this project (C-03). Poll `GET /api/ai-jobs/{jobId}`. */
export type InsightActiveJob = {
  jobId: string;
  status: Extract<AiJobStatus, "queued" | "running">;
  progress: { stage: string; done: number; total: number };
  provider: AiProvider;
  connectionTier: ConnectionTier;
};

/** The last insight job that failed after the shown result (C-20; "다시 시도" via /api/ai-jobs/{jobId}/retry). */
export type InsightLastFailure = AiFailure & { jobId: string; failedAt: string | null };

export type InsightView = {
  applicationProjectId: string;
  /** JD requirements now (contents instead of REQ-n aliases), sort_order order. */
  requirements: InsightRequirement[];
  extractionStatus: "pending" | "running" | "succeeded" | "failed";
  /** Latest ready insight (or the requested version); null = 아직 없음. */
  insight: InsightResultView | null;
  activeJob: InsightActiveJob | null;
  lastFailure: InsightLastFailure | null;
};

export const GetInsightInput = z.object({
  applicationProjectId: z.guid(),
  /** A ready version (이전 버전 열람 is Could; default = latest). */
  version: z.number().int().positive().optional(),
});
export type GetInsightInput = z.input<typeof GetInsightInput>;
