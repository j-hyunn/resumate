import { z } from "zod";
import { AiProviderSchema, ErrorEvent } from "./ai";
import {
  APPLICATION_STAGES,
  JD_EXTRACTION_STATUSES,
  JD_FIELD_SOURCES,
  NAME_SOURCES,
  REQUIREMENT_CATEGORIES,
  REQUIREMENT_IMPORTANCES,
  REQUIREMENT_ORIGINS,
  STAGE_OUTCOMES,
  type AiErrorCode,
  type ApplicationStage,
} from "./enums";

/**
 * S5 application projects & JD contracts (F-AP-01·02·03·05, F-P2-01·02,
 * F-ST-01~05, AI-01; DM §2.6 / A.5–A.7 / §7; UX S-13, S-14, S-31, S-15, S-39,
 * C-12~C-14, FL-06).
 *
 * Action inputs and DTOs are camelCase. Sentences keep the DB jsonb shape
 * `{sid, text, start, end}` (DM A.6 storage format, offsets in UTF-16 units).
 */

/** DM A.5: application_projects.name ≤ 100. */
export const APPLICATION_NAME_MAX = 100;
/** DM A.5: memo ≤ 2,000 (Should). */
export const APPLICATION_MEMO_MAX = 2000;
/** DM A.6: raw_text 1~50,000. */
export const JD_RAW_TEXT_MAX = 50_000;
/** db notes [가정]: company_name / position_title ≤ 200. */
export const JD_TITLE_MAX = 200;
/** F-P2-01 [가정]: a JD shorter than this gets a warning flag only. */
export const JD_SHORT_WARNING_CHARS = 200;
/** C-2 8k-token cap [가정]: ≈ 24,000 characters → `long_jd` warning. */
export const JD_LONG_WARNING_CHARS = 24_000;
/** Card name while extraction is pending (name null, no company / position, S-14). */
export const PENDING_DISPLAY_NAME = "새 기업 JD";

const uuid = z.guid();
/** Form fields: "" / whitespace-only → undefined. */
const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().min(1).max(max).optional());
const dateOnly = z.iso.date();

export const ApplicationStageSchema = z.enum(APPLICATION_STAGES);
export const StageOutcomeSchema = z.enum(STAGE_OUTCOMES);
export const NameSourceSchema = z.enum(NAME_SOURCES);
export const JdFieldSourceSchema = z.enum(JD_FIELD_SOURCES);
export const JdExtractionStatusSchema = z.enum(JD_EXTRACTION_STATUSES);
export const RequirementCategorySchema = z.enum(REQUIREMENT_CATEGORIES);

// ---------- create (S-14) ----------

export const JD_INPUT_WARNINGS = ["short_jd", "long_jd"] as const;
export type JdInputWarning = (typeof JD_INPUT_WARNINGS)[number];

export const CreateApplicationProjectInput = z.object({
  /** Client-generated id (idempotent retry, decisions 2026-10-25). */
  id: uuid,
  rawText: z
    .string()
    .max(JD_RAW_TEXT_MAX)
    .refine((v) => v.trim().length > 0, { message: "empty_raw_text" }),
  companyName: optionalText(JD_TITLE_MAX),
  positionTitle: optionalText(JD_TITLE_MAX),
  name: optionalText(APPLICATION_NAME_MAX),
  deadline: z.preprocess((v) => (v === "" ? undefined : v), dateOnly.optional()),
});
export type CreateApplicationProjectInput = z.input<typeof CreateApplicationProjectInput>;

/** F-P2-01 / C-2 warnings (never block saving). */
export function jdInputWarnings(rawText: string): JdInputWarning[] {
  const n = rawText.trim().length;
  const out: JdInputWarning[] = [];
  if (n < JD_SHORT_WARNING_CHARS) out.push("short_jd");
  if (n > JD_LONG_WARNING_CHARS) out.push("long_jd");
  return out;
}

export type CreateApplicationProjectResult = {
  applicationProjectId: string;
  jobDescriptionId: string;
  name: string | null;
  nameSource: (typeof NAME_SOURCES)[number] | null;
  displayName: string;
  extractionStatus: (typeof JD_EXTRACTION_STATUSES)[number];
  /**
   * The AI run gate passed (active provider, key not invalid, current consent):
   * the screen calls `POST /api/application-projects/{id}/jd-extraction` right
   * away ("공고를 분석하고 있어요"). False → no extraction (D-30), C-18 hint.
   */
  shouldExtract: boolean;
  /** False when the same id already existed (idempotent retry; the input was ignored). */
  created: boolean;
  warnings: JdInputWarning[];
};

// ---------- update / delete ----------

export const UpdateApplicationProjectInput = z
  .object({
    id: uuid,
    /** Empty name is refused (`invalid_input`). */
    name: z.string().trim().min(1).max(APPLICATION_NAME_MAX).optional(),
    deadline: dateOnly.nullable().optional(),
    memo: z
      .string()
      .max(APPLICATION_MEMO_MAX)
      .nullable()
      .optional()
      .transform((v) => (typeof v === "string" && v.trim() === "" ? null : v)),
  })
  .refine((v) => v.name !== undefined || v.deadline !== undefined || v.memo !== undefined, { message: "nothing_to_update" });
export type UpdateApplicationProjectInput = z.input<typeof UpdateApplicationProjectInput>;

export const ApplicationProjectIdInput = z.object({ id: uuid });
export type ApplicationProjectIdInput = z.input<typeof ApplicationProjectIdInput>;

export type DeleteApplicationProjectResult = {
  applicationProjectId: string;
  /** In-flight ai_jobs that got cancel_requested_at before the delete (FL-06). */
  canceledJobs: number;
};

// ---------- stage (C-12 / C-13 / C-14) ----------

export const MoveApplicationStageInput = z.object({
  id: uuid,
  toStage: ApplicationStageSchema,
  /** Only with toStage = closed (`invalid_outcome` otherwise). */
  outcome: StageOutcomeSchema.optional(),
});
export type MoveApplicationStageInput = z.input<typeof MoveApplicationStageInput>;

export const SetApplicationOutcomeInput = z.object({
  id: uuid,
  /** null clears the result (C-13 닫기 → "결과 미기록") [가정]. */
  outcome: StageOutcomeSchema.nullable(),
});
export type SetApplicationOutcomeInput = z.input<typeof SetApplicationOutcomeInput>;

export type InterviewPrompt = {
  interviewType: "job" | "culture_fit";
  /** S8 fills it (C-14 "이어서 쓰기"); null until then. */
  inProgressSessionId: string | null;
};

export type StageChangeResult = {
  applicationProjectId: string;
  stage: ApplicationStage;
  stageOutcome: (typeof STAGE_OUTCOMES)[number] | null;
  stageChangedAt: string;
  changed: boolean;
};

export type MoveApplicationStageResult = StageChangeResult & {
  /** C-14 popup data when moved into an interview column; the screen picks the no-key variant itself. */
  interviewPrompt: InterviewPrompt | null;
};

// ---------- reads (S-13 / S-39 / S-31 / S-15) ----------

export const LIST_SORTS = ["recent", "deadline"] as const;
export const ListApplicationProjectsInput = z.object({
  sort: z.enum(LIST_SORTS).default("recent"),
  stage: ApplicationStageSchema.optional(),
});
export type ListApplicationProjectsInput = z.input<typeof ListApplicationProjectsInput>;

export const INSIGHT_PROGRESS = ["none", "generating", "ready"] as const;

/**
 * Feature progress per project (S-13 기능 진행, S-39 카드). S5 has no result
 * tables yet: fixed `none / 0 / 0 / false`; S6–S8 fill it (extension point
 * `loadProgress` in services/application/read.ts).
 */
export type ApplicationProgress = {
  insight: (typeof INSIGHT_PROGRESS)[number];
  draftCount: number;
  interviewCount: number;
  interviewInProgress: boolean;
};

type NameFields = {
  name: string | null;
  nameSource: (typeof NAME_SOURCES)[number] | null;
  /** name → "회사명 – 포지션명" → "새 기업 JD" (추출 대기). */
  displayName: string;
};

export type ApplicationProjectListItem = NameFields & {
  id: string;
  companyName: string | null;
  positionTitle: string | null;
  deadline: string | null;
  stage: ApplicationStage;
  stageOutcome: (typeof STAGE_OUTCOMES)[number] | null;
  stageChangedAt: string;
  lastActivityAt: string;
  createdAt: string;
  extractionStatus: (typeof JD_EXTRACTION_STATUSES)[number];
  /**
   * QA-S5-02: when `extractionStatus = 'failed'`, the failure of the job that
   * last ran the extraction (C-20 copy by category / failureCause; `stalled`
   * after a dead run, `canceled` after a refused one). Null otherwise.
   */
  lastExtractionFailure: JdExtractionFailure | null;
  progress: ApplicationProgress;
};

export type BoardCard = ApplicationProjectListItem;

export type BoardColumn = {
  stage: ApplicationStage;
  count: number;
  /** stage_changed_at desc (D-26 (a)). */
  cards: BoardCard[];
};

export type ApplicationBoard = {
  /** Always 6, in APPLICATION_STAGES order. */
  columns: BoardColumn[];
  total: number;
};

export type ApplicationHub = ApplicationProjectListItem & {
  memo: string | null;
  companyNameSource: (typeof JD_FIELD_SOURCES)[number] | null;
  positionTitleSource: (typeof JD_FIELD_SOURCES)[number] | null;
  jd: {
    jobDescriptionId: string;
    extractionStatus: (typeof JD_EXTRACTION_STATUSES)[number];
    requirementCount: number;
    /** C-19 result badge (kept after ai_jobs cleanup). */
    extractionProvider: z.infer<typeof AiProviderSchema> | null;
    extractionModel: string | null;
  };
};

export type JdSentenceDto = { sid: string; text: string; start: number; end: number };

export type JdRequirementDto = {
  id: string;
  category: (typeof REQUIREMENT_CATEGORIES)[number];
  content: string;
  keywords: string[];
  importance: (typeof REQUIREMENT_IMPORTANCES)[number];
  sourceSids: string[];
  sortOrder: number;
  origin: (typeof REQUIREMENT_ORIGINS)[number];
  isUserEdited: boolean;
};

/** The C-11 error shape of the SSE `error` event, without `type` (same copy rules, C-20). */
export const AiFailureSchema = ErrorEvent.omit({ type: true });
export type AiFailure = z.infer<typeof AiFailureSchema>;

/** The `error` event fields without `type` (one C-11 failure shape for JSON bodies). */
export function toAiFailure(event: z.infer<typeof ErrorEvent>): AiFailure {
  return AiFailureSchema.parse(event);
}

export type JdExtractionFailure = AiFailure & {
  jobId: string | null;
  /** When the failed run ended. */
  failedAt: string | null;
};

export type JdView = {
  applicationProjectId: string;
  jobDescriptionId: string;
  /** "공고 원문" panel (always readable, no key needed). */
  rawText: string;
  sentences: JdSentenceDto[];
  detectedLanguage: string | null;
  companyName: string | null;
  companyNameSource: (typeof JD_FIELD_SOURCES)[number] | null;
  positionTitle: string | null;
  positionTitleSource: (typeof JD_FIELD_SOURCES)[number] | null;
  extractionStatus: (typeof JD_EXTRACTION_STATUSES)[number];
  requirements: JdRequirementDto[];
  techKeywords: { keyword: string; sourceSids: string[] }[];
  /** AI-01 `seniority` (null when absent / not extracted). */
  seniority: { minYears: number | null; maxYears: number | null; label: string; sourceSids: string[] } | null;
  /** `extraction.is_likely_jd` — false → S-15 JD 판별 경고. null before extraction. */
  isLikelyJd: boolean | null;
  /** `extraction.warnings` (e.g. 복수 포지션). */
  extractionWarnings: string[];
  /** C-19 badge: the provider / model that extracted the requirements. */
  extractedBy: { provider: z.infer<typeof AiProviderSchema>; model: string } | null;
  /** Latest failure when extraction_status = failed (C-20; `not_a_jd` → "채용 공고가 아닌 텍스트로 보여요"). */
  lastFailure: JdExtractionFailure | null;
};

// ---------- sync extraction route (AI-01, C-6 동기) ----------

/**
 * `POST /api/application-projects/{id}/jd-extraction` — 200 body `{ data }`:
 * - `succeeded`: requirements stored; `jd` is the refreshed S-15 view.
 * - `failed`: a C-11 failure (connection gate, provider, input). `jd` is the
 *   view after the failure (raw text intact, status failed / pending).
 *   `jobId` null when nothing started (connection gate before the job).
 * Non-AI errors use the plain `{ error: {code, message} }` body:
 * 401, 404, 409 `already_extracted` (D-19: re-extraction = failed retry only),
 * 409 `extraction_in_progress`.
 */
export type JdExtractionResponse =
  | { status: "succeeded"; jobId: string; jd: JdView }
  | { status: "failed"; jobId: string | null; error: AiFailure; jd: JdView };

/** Connection-gate codes a sync AI route answers with (F-AI-08 lock). */
export type GateCode = Extract<AiErrorCode, "key_missing" | "key_invalid">;

// ---------- display helpers ----------

/** "회사명 – 포지션명" (U+2013 with spaces, same as the DB name rule). */
export function joinCompanyPosition(companyName: string | null, positionTitle: string | null): string | null {
  const c = companyName?.trim();
  const p = positionTitle?.trim();
  return c && p ? `${c} – ${p}` : null;
}

/** Card / row label: name → "회사명 – 포지션명" → "새 기업 JD". */
export function applicationDisplayName(name: string | null, companyName: string | null, positionTitle: string | null): string {
  if (name && name.trim()) return name;
  return joinCompanyPosition(companyName, positionTitle) ?? PENDING_DISPLAY_NAME;
}
