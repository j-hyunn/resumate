import { z } from "zod";
import type { AiJobStatus, AiProvider, ConnectionTier, ModelTier } from "./enums";
import type { AiFailure } from "./application";
import type { ReadinessFeature } from "./career";
import type { EvidenceChip } from "./evidence";

/**
 * S6 insight contracts (AI-02; F-P2-04/05/07/09, F-AP-06; DM A.8, §6;
 * UX S-16, C-01/C-02/C-03/C-20).
 *
 * R17 (DM v4.16 2.7.0, decisions 4.24 #13·#18): the JD is used as raw text. AI-02 stage 1 reads
 * the requirements from the JD sentences itself, so a schema-2 result carries its own requirement
 * list: `requirement_matches[] = { match_key: "MT-n", requirement_text, sids, … }`, and stage 2
 * points at them with `match_keys`. A schema-1 insight (before R17, made from the dropped
 * `jd_requirements` rows) is never shown: `schemaVersion: 1` → "다시 만들어야 해요" + 다시 생성.
 */

/** The only result shape the screens render (DM 2.7.0). */
export const INSIGHT_SCHEMA_VERSION = 2;

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
 *   JD raw text, prompt version) already has a ready insight: show it, no
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
 * `AiJobStatusResponse.partial` for an insight job (S-16 부분 결과, C-03): the stage-1 verdicts
 * once the single match call finished (step output `match`, ai `MatchStageResult.items`) — before
 * the insight is saved, so no evidence chips yet.
 */
export type InsightJobPartial = {
  kind: "insight_matches";
  requirementMatches: Array<{
    /** `MT-n` (per insight). */
    matchKey: string;
    requirementText: string;
    /** JD sentences (`S{n}`) the requirement was read from — "공고 원문" link. */
    sentenceIds: string[];
    status: MatchStatus;
    rationale: string;
    missingAspect: string | null;
  }>;
};

// ---------- read: getInsight (S-16) ----------

export type InsightRequirementMatch = {
  /** `requirement_matches.MT-n` */
  itemKey: string;
  /** `MT-n` — strengths / gaps / priorities point here with `matchKeys`. */
  matchKey: string;
  requirementText: string;
  /** JD sentences (`S{n}`) — "공고 원문" link highlights all of them (UX S-16). */
  sentenceIds: string[];
  status: MatchStatus;
  rationale: string;
  missingAspect: string | null;
  /** Career evidence only (DM 2.8: the JD link of a requirement row is `sentenceIds`). */
  evidence: EvidenceChip[];
};

export type InsightStrength = {
  itemKey: string;
  title: string;
  description: string;
  matchKeys: string[];
  evidence: EvidenceChip[];
};

export type InsightGapAction = {
  itemKey: string;
  type: GapActionType;
  text: string;
  evidence: EvidenceChip[];
  /**
   * F-P2-09: for `add_data`, the gap's requirements ("관련 요건: …"). The chat start passes
   * `returnTarget = { applicationProjectId, feature: 'insight', params: { insight_id, insight_item_key } }`
   * (DM 2.7.0 AI-12 게이트 진입, 4.24 #14).
   */
  relatedMatchKeys: string[];
};

export type InsightGap = {
  /** `gaps.{n}` — the `insight_item_key` of a gate chat started from this gap. */
  itemKey: string;
  matchKeys: string[];
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
  matchKeys: string[];
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
   * `insights.schema_version`. 2 = the shape below. 1 = an insight made from the dropped
   * requirement list (JR-Q3 (b)): the body fields are empty and the screen shows
   * "공고 처리 방식이 바뀌어 다시 만들어야 해요" + [다시 생성] (UX DM-12).
   */
  schemaVersion: number;
  /**
   * F-P2-07 MVP "데이터 변경됨": the current career snapshot or the JD raw text differs from what
   * this insight was made from. Show it with "다시 생성".
   */
  stale: boolean;
  /**
   * `career` = `career_snapshot_hash` ≠ now; `rawText` = `insights.raw_text_hash` ≠
   * `job_descriptions.raw_text_hash` ("공고가 바뀌었어요 — 다시 생성", DM 2.6.1 / 2.7.0). The
   * insight's `jd_sentence` chips read the same `rawText` value (no highlight when true).
   */
  staleReasons: { career: boolean; rawText: boolean };
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
  /** Last JD raw-text edit (DM 2.6.1; failures before it are not shown). */
  rawTextEditedAt: string | null;
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
