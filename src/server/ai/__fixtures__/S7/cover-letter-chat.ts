import type { CountBasis } from "@/lib/contracts/enums";
import { buildCareerPack } from "../../context-pack/career-pack";
import {
  buildCoverLetterChatContext,
  type CoverLetterChatContext,
  type CoverLetterChatTurnInput,
  type CoverLetterInsightInput,
  type CoverLetterQuestionRow,
} from "../../context-pack/cover-letter-chat";
import { KO_JD_HASH } from "../AI-02/insight";
import { AS_OF, careerRowsFixture, IDS } from "./drafts";

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

export const INSIGHT_ID = "93000000-0000-4000-8000-000000000001";

/**
 * A stored AI-02 result, schema 2 (DM 2.7.0) — synthetic, the shape
 * complete_insight stores. Numbers: "11년 이상" is a JD fact (V-5 source for
 * AI-04); "1.2초" in a strength is generated text (not a source).
 */
export function insightResultV2() {
  return {
    schema_version: 2,
    basis_note: "입력된 경력 데이터 기준 분석입니다",
    data_sufficiency: { level: "ok", hints: [] },
    requirement_matches: [
      { item_key: "requirement_matches.MT-1", match_key: "MT-1", requirement_text: "결제 승인 API 설계 및 운영", sids: ["S3"], status: "met", rationale: "근거 있음", missing_aspect: null },
      { item_key: "requirement_matches.MT-2", match_key: "MT-2", requirement_text: "백엔드 개발 경력 11년 이상", sids: ["S11"], status: "partial", rationale: "기간 부족", missing_aspect: "경력 기간" },
      { item_key: "requirement_matches.MT-3", match_key: "MT-3", requirement_text: "Kafka 등 메시지 큐 운영 경험", sids: ["S13"], status: "no_evidence", rationale: "근거 없음", missing_aspect: "메시지 큐 운영" },
    ],
    summary_counts: { met: 1, partial: 1, no_evidence: 1 },
    strengths: [{ item_key: "strengths.0", title: "결제 승인 API 성능 개선", description: "응답 시간을 1.2초에서 줄인 경험", match_keys: ["MT-1"] }],
    gaps: [
      { item_key: "gaps.0", match_keys: ["MT-3"], gap_kind: "no_evidence", description: "메시지 큐 운영 경험이 데이터에 없습니다.", actions: [] },
      { item_key: "gaps.1", match_keys: ["MT-2"], gap_kind: "partial", description: "등록된 경력 기간이 요건보다 짧습니다.", actions: [] },
    ],
    strategy: {
      positioning: "결제 도메인 백엔드 엔지니어로 포지셔닝합니다.",
      positioning_item_key: "strategy.positioning",
      project_priorities: [{ item_key: "strategy.project_priorities.0", rank: 1, project_id: IDS.prjPay, reason: "결제 요건과 직접 연결", match_keys: ["MT-1"] }],
    },
  };
}

/** The latest ready schema-2 insight row as the service loads it; current (not stale) by default. */
export function insightInput(over: Partial<CoverLetterInsightInput> = {}): CoverLetterInsightInput {
  return {
    insightId: INSIGHT_ID,
    schemaVersion: 2,
    result: insightResultV2(),
    careerSnapshotHash: buildCareerPack(careerRowsFixture(), { asOf: AS_OF }).careerSnapshotHash,
    rawTextHash: KO_JD_HASH,
    currentRawTextHash: KO_JD_HASH,
    ...over,
  };
}

export function coverLetterContext(over: Partial<CoverLetterChatTurnInput> = {}, questionCount = 3): CoverLetterChatContext {
  return buildCoverLetterChatContext({
    messages: [],
    structuredDraft: {},
    lastExtractedSequence: 0,
    questions: Array.from({ length: questionCount }, (_, i) => questionRow(i + 1)),
    careerRows: careerRowsFixture(),
    asOf: AS_OF,
    application: { companyName: "가상페이", positionTitle: "결제 백엔드 엔지니어" },
    insight: null,
    ...over,
  });
}
