import type { ConnectionTier, ModelTier, NormalizedUsage, ProviderId } from "../providers/types";
import type { InterviewAnchor, InterviewSourceKind, ScoreSlot } from "../schemas/interview-common";
import type { PayloadEvidence, PayloadHashes, PayloadMeta } from "./drafts";

/**
 * S8 → app_ai_writer RPC p_payloads (db-engineer S8 notes "Payload 모양").
 * C-3: result jsonb never holds an `evidence` key at any depth; evidence goes
 * in `evidence[]` rows with an `item_key`, aliases already turned into UUIDs.
 */

export type { PayloadEvidence, PayloadHashes, PayloadMeta };

/** Evidence item_key of a question's own evidence (db: free, recommended "question"). */
export const QUESTION_ITEM_KEY = "question";

/** save_interview_question.p_payload. */
export type SaveInterviewQuestionPayload = {
  /** 1..question_count: an empty slot (begin_interview_questions next_sequence rule). */
  sequence: number;
  source_kind: InterviewSourceKind;
  anchor: InterviewAnchor;
  question_text: string;
  intent: string;
  focus_criteria: string[];
  target_requirement_ids: string[];
  target_gap_requirement_ids: string[];
  good_answer_signals: string[];
  hashes: PayloadHashes;
  meta: PayloadMeta;
  evidence: PayloadEvidence[];
};

/** complete_interview_questions.p_payload. */
export type CompleteInterviewQuestionsPayload = {
  weak_requirement_ids: string[];
  insight_id: string | null;
  career_snapshot_hash: string;
  meta: PayloadMeta;
};

// ---------- AI-06 ----------

export type StoredCriterion = {
  key: string;
  grade: string;
  reason: string;
  answer_quotes: string[];
  missing: string | null;
  /** Server: every answer quote failed V-3 and the model gave no `missing` → filled with a fixed note. */
  missing_filled: boolean;
};

export type StoredPlaceholder = { token: string; hint: string };

/** answer_evaluations.result (schema_version 2). No evidence arrays (C-3): evidence_links item_keys point into it. */
export type StoredAnswerEvaluation = {
  schema_version: number;
  criteria: StoredCriterion[];
  strengths: Array<{ text: string; answer_quotes: string[] }>;
  /** item_key `improvements.<n>` (n = index here). */
  improvements: Array<{ text: string; how: string; related_criteria: string[] }>;
  intent_reveal: string;
  /** item_key `model_answer`. */
  model_answer: {
    text: string;
    placeholders: StoredPlaceholder[];
    suggestions_if_true: string[];
    flags: string[];
  };
  /** item_key `consistency_notes.<n>`. */
  consistency_notes: Array<{ text: string; answer_quotes: string[] }>;
  score: ScoreSlot;
};

/** save_answer_evaluation.p_payload. */
export type SaveAnswerEvaluationPayload = {
  result: StoredAnswerEvaluation;
  hashes: PayloadHashes;
  meta: PayloadMeta;
  evidence: PayloadEvidence[];
};

// ---------- AI-07 ----------

export type CriteriaSummaryItem = {
  key: string;
  /** Count per grade over the evaluated answers (server, AI-07 "criteria_summary는 서버가 계산"). */
  distribution: { excellent: number; good: number; fair: number; poor: number; not_applicable: number };
};

export type SessionPoint = {
  text: string;
  /** Question ids (UUID) — the model's Q-n refs resolved (V-1: this session's evaluated questions only). */
  question_ids: string[];
  related_criteria: string[];
};

export type StoredSessionFeedback = {
  schema_version: number;
  headline: string;
  overall_strengths: SessionPoint[];
  overall_weaknesses: SessionPoint[];
  unanswered_note: string | null;
  next_practice: Array<{
    type: "retry_question" | "focus_session" | "add_data";
    text: string;
    requirement_ids: string[];
    interview_type: "job" | "culture_fit" | null;
    question_id: string | null;
  }>;
  criteria_summary: CriteriaSummaryItem[];
  session_score: ScoreSlot & { counted_questions: number; unanswered_count: number };
};

export type SaveSessionFeedbackPayload = {
  result: StoredSessionFeedback;
  hashes: PayloadHashes;
  meta: PayloadMeta;
  evidence: PayloadEvidence[];
};

export function payloadMeta(input: {
  schemaVersion: number;
  promptVersion: string;
  provider: ProviderId;
  model: string;
  modelTier: ModelTier;
  connectionTier: ConnectionTier;
  report: Record<string, number> | null;
  usage: NormalizedUsage | null;
}): PayloadMeta {
  return {
    schema_version: input.schemaVersion,
    prompt_version: input.promptVersion,
    provider: input.provider,
    model: input.model,
    model_tier: input.modelTier,
    connection_tier: input.connectionTier,
    validation_report: input.report ? { ...input.report } : null,
    usage: input.usage,
  };
}

/** C-3 guard for result jsonb: no `evidence` key at any depth (db rejects it too). */
export function hasEvidenceKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasEvidenceKey);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([k, v]) => k === "evidence" || hasEvidenceKey(v));
}
