import { z } from "zod";
import { AiProviderSchema, ErrorEvent } from "./ai";
import { JD_SOURCE_URL_MAX } from "./jd-fetch";
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
/** DM 11.10 #1 `[가정]`: `job_descriptions.source_url` ≤ 2,048 (one source — see ./jd-fetch). */
export { JD_SOURCE_URL_MAX };

/** UQ-759: lowercase the `http` / `https` scheme only (`HTTPS://Example.com/A` → `https://Example.com/A`). */
export function normalizeSourceUrlScheme(url: string): string {
  return url.replace(/^https?:/i, (scheme) => scheme.toLowerCase());
}

/** `job_descriptions_source_url_check`: `http(s)://` (any case) and ≤ 2,048 chars. */
export function isValidSourceUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && url.length <= JD_SOURCE_URL_MAX;
}

/**
 * Refusals the S-14 create path shows under their own code. `invalid_source_url` (400) drives
 * "주소 없이 만들기": the RPC builds no row, so the screen resends the same `id` without the URL.
 */
export const CREATE_APPLICATION_ERROR_CODES = ["invalid_source_url", "key_invalid", "ai_consent_required", "application_project_id_conflict"] as const;
export type CreateApplicationErrorCode = (typeof CREATE_APPLICATION_ERROR_CODES)[number];
/** db notes [가정]: company_name / position_title ≤ 200. */
export const JD_TITLE_MAX = 200;
/** F-P2-01 [가정]: a JD shorter than this gets a warning flag only. */
export const JD_SHORT_WARNING_CHARS = 200;
/** C-2 8k-token cap [가정]: ≈ 24,000 characters → `long_jd` warning. */
export const JD_LONG_WARNING_CHARS = 24_000;
/** Card name while extraction is pending (name null, no company / position, S-14). */
/** R4 CR-23 [가정]: the screens call an application project "자기소개서" (DB default "새 자기소개서 (날짜)"). */
export const PENDING_DISPLAY_NAME = "새 자기소개서";

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
  /**
   * R15 (CF-10, D11): the posting URL the user pasted in S-14 단계 1, stored on
   * `job_descriptions.source_url`. The RPC re-checks it (`invalid_source_url`, 400) and
   * builds no row when it fails, so the screen may resend the same `id` without it.
   */
  sourceUrl: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .trim()
      // UQ-759: only the scheme is lowercased (`HTTPS://` → `https://`). `new URL().href` would also
      // rewrite the trailing slash, percent-encoding and host spelling — the URL is stored as typed.
      // The scheme / length rule is NOT a zod check on purpose: a zod failure becomes the generic
      // `invalid_input`, and S-14's "주소 없이 만들기" needs `invalid_source_url` (400). The service
      // checks it (`assertSourceUrl`) and the RPC checks it again (`~* '^https?://'`, ≤ 2,048).
      .transform(normalizeSourceUrlScheme)
      .optional(),
  ),
  /**
   * R15 (CF-A17, D11): the `ai_jobs` row of the 요건 미리 보기 run. The RPC reads the
   * **server's** `output` (never requirements sent by the screen) after recomputing the
   * hash from `p_raw_text`, and always links the job even when it drops the result.
   */
  previewJobId: uuid.optional(),
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

// ---------- raw text edit (S-15, Q53-2 / Q53-11, DM 2.6.1) ----------

export const UpdateFailedJdRawTextInput = z.object({
  /** application_projects.id */
  id: uuid,
  /** Same rules as S-14. Stored as sent: sentence offsets index this exact text. */
  rawText: z
    .string()
    .max(JD_RAW_TEXT_MAX)
    .refine((v) => v.trim().length > 0, { message: "empty_raw_text" }),
});
export type UpdateFailedJdRawTextInput = z.input<typeof UpdateFailedJdRawTextInput>;

/**
 * `update_failed_jd_raw_text` refusals the screen handles (HTTP 409, in check order;
 * condition 6 last). `jd_has_results` on a succeeded JD → "새 기업 JD 추가" (S-15).
 */
export const JD_RAW_TEXT_REFUSAL_CODES = ["jd_job_in_progress", "jd_raw_text_locked", "jd_failure_not_input", "jd_has_results", "jd_raw_text_unchanged"] as const;
export type JdRawTextRefusalCode = (typeof JD_RAW_TEXT_REFUSAL_CODES)[number];

/** Why `getJdView` says the text can't be edited: conditions 1~5 (6 needs the new text). */
export type JdRawTextLock = Exclude<JdRawTextRefusalCode, "jd_raw_text_unchanged">;

export type UpdateFailedJdRawTextResult = {
  applicationProjectId: string;
  jobDescriptionId: string;
  extractionStatus: "pending";
  rawTextEditedAt: string;
  /** Same rule as check_ai_run_allowed. Saving never starts AI (D-30): the user presses "요건 정리하기". */
  aiRunAllowed: boolean;
  warnings: JdInputWarning[];
};

/**
 * DM 2.6.1 "지난 실패 표시": a job failure that ended before the raw text was edited belongs
 * to the old text and isn't shown. A missing `finished_at` can't be compared: it isn't past.
 */
export function isFailureBeforeRawTextEdit(finishedAt: string | null | undefined, rawTextEditedAt: string | null | undefined): boolean {
  if (!finishedAt || !rawTextEditedAt) return false;
  return Date.parse(finishedAt) < Date.parse(rawTextEditedAt);
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
  /** R15 D11: the preview's requirements were written into this JD (no AI-01 call needed). */
  previewApplied: boolean;
  /** Why the preview was not applied; null when it was, or when no `previewJobId` was sent. */
  previewSkipReason: PreviewSkipReason | null;
  warnings: JdInputWarning[];
};

// ---------- 요건 미리 보기 (A2, CF-A17 / DM 2.6.2) ----------

/**
 * `create_application_project` return `preview_skip_reason` (R15 D11, db notes ②-3).
 * The job row is linked to the new project in every case, including these.
 */
export const PREVIEW_SKIP_REASONS = ["preview_not_found", "preview_expired", "preview_mismatch"] as const;
export type PreviewSkipReason = (typeof PREVIEW_SKIP_REASONS)[number];

/** `ai_jobs.finished_at` + this window — after it the result is `preview_expired` and the cron empties it. */
export const PREVIEW_TTL_HOURS = 24;

export const ExtractJdPreviewInput = z.object({
  rawText: z
    .string()
    .max(JD_RAW_TEXT_MAX)
    .refine((v) => v.trim().length > 0, { message: "empty_raw_text" }),
});
export type ExtractJdPreviewInput = z.input<typeof ExtractJdPreviewInput>;

/**
 * `POST /api/job-descriptions/extract-preview` 200 body. The requirement text itself is
 * **not** here — it stays in `ai_jobs.output` on the server (CF-A17: the screen can never
 * send requirements back as `origin = 'ai'`).
 */
export type ExtractJdPreviewResult = {
  previewJobId: string;
  companyName: string | null;
  positionTitle: string | null;
  /** `YYYY-MM-DD`, only when AI-01's 검사 1~4 all passed; the create RPC checks it again. */
  deadline: string | null;
  requirementCount: number;
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

export type StageChangeResult = {
  applicationProjectId: string;
  stage: ApplicationStage;
  stageOutcome: (typeof STAGE_OUTCOMES)[number] | null;
  stageChangedAt: string;
  changed: boolean;
};

/** RPC move_application_stage result (R14 RM-2: stage fields only). */
export type MoveApplicationStageResult = StageChangeResult;

// ---------- reads (S-13 / S-39 / S-31 / S-15) ----------

export const LIST_SORTS = ["recent", "deadline"] as const;
export const ListApplicationProjectsInput = z.object({
  sort: z.enum(LIST_SORTS).default("recent"),
  stage: ApplicationStageSchema.optional(),
});
export type ListApplicationProjectsInput = z.input<typeof ListApplicationProjectsInput>;

export const INSIGHT_PROGRESS = ["none", "generating", "ready"] as const;

/**
 * Feature progress per project (S-13 기능 진행, S-39 카드), filled by
 * `loadProgress` in services/application/read.ts.
 */
export type ApplicationProgress = {
  insight: (typeof INSIGHT_PROGRESS)[number];
  draftCount: number;
};

type NameFields = {
  name: string | null;
  nameSource: (typeof NAME_SOURCES)[number] | null;
  /** name → "회사명 – 포지션명" → "새 자기소개서" (추출 대기). */
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
  /** Last raw text edit (null = never edited, DM 2.6.1). */
  rawTextEditedAt: string | null;
  /** "공고 원문 고치기" shows: conditions 1~5 of update_failed_jd_raw_text. The RPC decides finally. */
  rawTextEditable: boolean;
  /** Why not, null when editable. `jd_has_results` → S-15 "새 기업 JD 추가" (Q53-11). */
  rawTextLock: JdRawTextLock | null;
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

/**
 * "{회사명} 자기소개서" — the R15 name rule (CF-9·CF-A7, DM 11.10 #3 /
 * `private.application_compose_name`). Replaces v4.14's "회사명 – 포지션명";
 * the position title is no longer part of the name.
 */
export function composeApplicationName(companyName: string | null): string | null {
  const c = companyName?.trim();
  return c ? `${c} 자기소개서` : null;
}

/** @deprecated R15 (CF-9): the name no longer joins the position title. Use `composeApplicationName`. */
export function joinCompanyPosition(companyName: string | null, positionTitle: string | null): string | null {
  void positionTitle;
  return composeApplicationName(companyName);
}

/** Card / row label: name → "{회사명} 자기소개서" → "새 자기소개서". */
export function applicationDisplayName(name: string | null, companyName: string | null, positionTitle: string | null): string {
  if (name && name.trim()) return name;
  void positionTitle;
  return composeApplicationName(companyName) ?? PENDING_DISPLAY_NAME;
}
