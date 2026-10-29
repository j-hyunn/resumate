import type { AiErrorCode } from "@/lib/contracts/errors";
import type { CountBasis, DraftSourceRole, QuestionClass } from "@/lib/contracts/enums";
import type { ValidationReport } from "../validation/report";

/**
 * Streaming-mode events (AI spec C-6): what a streaming pipeline yields and
 * the SSE route serializes 1:1 (`event: <type>`, `data: <JSON of the rest>`).
 * The public zod/TS mirror lives in `src/lib/contracts/ai.ts` (api-engineer).
 *
 * Rules:
 * - `block_delta.text` is provisional and unvalidated. Screens may render it
 *   but must replace it with `block_completed.block`.
 * - `block_completed.block` passed block-level checks (V-1..V-3, V-7, V-8,
 *   V-4, C-5). Numbers may still change: V-5 runs on the whole output.
 * - `validated.result` is the authoritative final content (storage form:
 *   no `evidence` arrays, aliases resolved) — same payload that is stored.
 * - Exactly one terminal event: `done` (after `validated`) or `error`.
 */
export type AiStreamEvent =
  | { type: "block_started"; blockId: string; path: string }
  | { type: "block_delta"; blockId: string; text: string }
  | { type: "block_completed"; blockId: string; block: unknown }
  | {
      /** S7 AI-04: the question's sources, validated, once the model's `sources` array closes (before paragraphs). */
      type: "sources_selected";
      selectionMode: "ai" | "user";
      questionClass: QuestionClass | null;
      sources: SelectedSourceView[];
    }
  | {
      /** S7 AI-04: the draft is outside ±10% of the limit (or has unsupported numbers); one correction call runs. */
      type: "adjusting_length";
      charCount: number;
      charLimit: number;
      countBasis: CountBasis;
      reasons: Array<"length" | "numbers">;
    }
  | { type: "validated"; result: unknown; validationReport: ValidationReport }
  | { type: "done"; meta: AiStreamDoneMeta }
  | {
      type: "error";
      code: AiErrorCode | "internal_error";
      message: string;
      retryable: boolean;
      /** ProviderError.retryAfter as ISO (rate_limited / provider_unavailable), else null (QA-S3a-01). */
      retryAfter: string | null;
      /** ProviderError.quotaResetsAt as ISO (daily_quota_exhausted), else null. */
      quotaResetsAt: string | null;
    };

export type AiStreamDoneMeta = {
  promptVersion: string;
  model: string;
  /** Id of the stored result row when the pipeline persisted one (e.g. draft id). */
  resultId: string | null;
};

export const AI_STREAM_EVENT_TYPES = [
  "block_started",
  "block_delta",
  "block_completed",
  "sources_selected",
  "adjusting_length",
  "validated",
  "done",
  "error",
] as const;

/** One AI-04 source as screens show it (C-11 "사용한 경력·프로젝트"); ids are UUIDs. */
export type SelectedSourceView = {
  sort_order: number;
  role: DraftSourceRole;
  experience_id: string | null;
  education_id: string | null;
  project_id: string | null;
  project_detail_ids: string[];
  /** "회사명 › 프로젝트명" (server-built from the rows). */
  label: string;
  rationale: string;
  reuse_reason: string | null;
  requirement_ids: string[];
};

/** S7 name used in the notes: the stream events of AI-03 / AI-04 (= AiStreamEvent incl. sources_selected, adjusting_length). */
export type S7StreamEvent = AiStreamEvent;
