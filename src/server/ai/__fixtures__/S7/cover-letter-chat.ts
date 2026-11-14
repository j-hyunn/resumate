import type { CountBasis } from "@/lib/contracts/enums";
import {
  buildCoverLetterChatContext,
  type CoverLetterChatContext,
  type CoverLetterChatTurnInput,
  type CoverLetterQuestionRow,
} from "../../context-pack/cover-letter-chat";
import { AS_OF, careerRowsFixture, JD_ID, JD_UPDATED_AT, jdParts } from "./drafts";

/**
 * Synthetic AI-04 자소서 대화 fixtures (R15). Fictional person and company —
 * no real personal data. Question slots follow DM 2.5.0b (`q_{n}`).
 */

export const QUESTION_IDS = [
  "92000000-0000-4000-8000-000000000001",
  "92000000-0000-4000-8000-000000000002",
  "92000000-0000-4000-8000-000000000003",
  "92000000-0000-4000-8000-000000000004",
  "92000000-0000-4000-8000-000000000005",
] as const;

export function questionRow(n: number, over: Partial<CoverLetterQuestionRow> = {}): CoverLetterQuestionRow {
  const templates = ["motivation", "job_competency", "future_plan", null, null] as const;
  return {
    slot: `q_${n}`,
    question_id: QUESTION_IDS[n - 1] ?? `92000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    question_text: `문항 ${n}`,
    template_key: templates[n - 1] ?? null,
    char_limit: 800,
    count_basis: "with_spaces" as CountBasis,
    user_note: null,
    user_note_updated_at: null,
    answer_title: null,
    body: "",
    ...over,
  };
}

export function coverLetterContext(over: Partial<CoverLetterChatTurnInput> = {}, questionCount = 3): CoverLetterChatContext {
  const jd = jdParts();
  return buildCoverLetterChatContext({
    messages: [],
    structuredDraft: {},
    lastExtractedSequence: 0,
    questions: Array.from({ length: questionCount }, (_, i) => questionRow(i + 1)),
    careerRows: careerRowsFixture(),
    asOf: AS_OF,
    jd: {
      jobDescriptionId: JD_ID,
      jobDescriptionUpdatedAt: JD_UPDATED_AT,
      sentences: jd.sentences,
      positionTitle: jd.positionTitle,
      rawTextHash: jd.rawTextHash,
    },
    ...over,
  });
}
