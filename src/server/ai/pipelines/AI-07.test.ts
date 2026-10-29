import { describe, expect, it } from "vitest";
import { reqId } from "../__fixtures__/S8/interview";
import { createFakeLlm } from "../fake-llm";
import { toCanonicalJsonSchema } from "../providers/schema";
import { Ai07OutputSchema } from "../schemas/AI-07";
import { hasEvidenceKey, type StoredAnswerEvaluation } from "../storage/interview";
import { AI07_PROMPT_VERSION, computeCriteriaSummary, mentionedSequences, summarizeSession, type SessionQuestionInput } from "./AI-07";

const qid = (n: number) => `94000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function evaluation(grade: string): Pick<StoredAnswerEvaluation, "criteria" | "strengths" | "improvements"> {
  return {
    criteria: ["specificity", "intent_fit", "structure", "job_relevance"].map((key) => ({ key, grade, reason: "이유", answer_quotes: [], missing: null, missing_filled: false })),
    strengths: [{ text: "수치를 말했습니다", answer_quotes: ["0.7초"] }],
    improvements: [{ text: "본인 행동을 주어로", how: "제가 ~했습니다", related_criteria: ["specificity"] }],
  };
}

function question(n: number, status: "submitted" | "unanswered", ev: SessionQuestionInput["evaluation"]): SessionQuestionInput {
  return {
    id: qid(n),
    sequence: n,
    question_text: `질문 ${n}`,
    source_kind: "project_deep_dive",
    anchor: "experience",
    intent: "의도",
    target_requirement_ids: n === 1 ? [reqId(6)] : [],
    answer_status: status,
    evaluation: ev,
  };
}

function output(over: Record<string, unknown> = {}) {
  return {
    schema_version: 2,
    headline: "Q-1에서 수치는 잘 제시했지만 본인 기여 구분이 필요합니다.",
    overall_strengths: [{ text: "수치를 말하는 습관", question_refs: ["Q-1", "Q-3"], related_criteria: ["specificity"] }],
    overall_weaknesses: [
      { text: "팀이 주어인 답변", question_refs: ["Q-2", "Q-9"], related_criteria: ["specificity"] },
      { text: "미응답 질문", question_refs: ["Q-3"], related_criteria: [] },
      { text: "2번 질문과 3번 질문에서 결론이 늦었습니다", question_refs: ["Q-2"], related_criteria: ["structure"] },
    ],
    unanswered_note: "Q-3은 쿠버네티스 질문이라 어려웠을 것입니다.",
    next_practice: [
      { type: "retry_question", text: "Q-3을 다시 연습해 보세요.", requirement_refs: [], interview_type: null, question_ref: "Q-3" },
      { type: "focus_session", text: "REQ-1 중심으로 연습해 보세요.", requirement_refs: ["REQ-1", "REQ-9"], interview_type: "job", question_ref: null },
      { type: "add_data", text: "답변에서 말한 경험을 기록하세요.", requirement_refs: [], interview_type: null, question_ref: "Q-3" },
    ],
    session_score: { status: "scored", value: 70, max: 100, method_version: null, rationale: null, counted_questions: 9, unanswered_count: 0 },
    ...over,
  };
}

const input = (questions: SessionQuestionInput[]) => ({
  interviewType: "job" as const,
  dataSufficiency: "ok" as const,
  questions,
  requirements: [{ id: reqId(6), content: "대용량 트래픽 서비스 성능 개선 경험" }],
  weakRequirementIds: [reqId(6)],
  careerSnapshotHash: "snap-1",
});

describe("AI-07", () => {
  it("canonical schema converts (C-10.2)", () => {
    expect(() => toCanonicalJsonSchema(Ai07OutputSchema)).not.toThrow();
  });

  it("refs: this session's evaluated questions only; unanswered never discussed; server summary, note and score", async () => {
    const questions = [question(1, "submitted", evaluation("good")), question(2, "submitted", evaluation("fair")), question(3, "unanswered", null), question(4, "submitted", null)];
    const llm = createFakeLlm([{ json: output() }]);
    const { payload, report } = await summarizeSession(input(questions), { llm });
    const r = payload.result;
    expect(r.overall_strengths).toEqual([{ text: "수치를 말하는 습관", question_ids: [qid(1)], related_criteria: ["specificity"] }]);
    expect(r.overall_weaknesses.map((w) => w.question_ids)).toEqual([[qid(2)]]);
    expect(r.headline).toBe("1번 질문에서 수치는 잘 제시했지만 본인 기여 구분이 필요합니다.");
    expect(r.unanswered_note).toBe("미응답 1문항(3번 질문)은 답변이 없어 평가하지 않았습니다.");
    expect(r.next_practice).toEqual([
      { type: "retry_question", text: "3번 질문을 다시 연습해 보세요.", requirement_ids: [], interview_type: null, question_id: qid(3) },
      { type: "focus_session", text: "'대용량 트래픽 서비스 성능 개선 경험' 중심으로 연습해 보세요.", requirement_ids: [reqId(6)], interview_type: "job", question_id: null },
      { type: "add_data", text: "답변에서 말한 경험을 기록하세요.", requirement_ids: [], interview_type: null, question_id: null },
    ]);
    expect(r.session_score).toEqual({ status: "pending_method", value: null, max: null, method_version: null, rationale: null, counted_questions: 2, unanswered_count: 1 });
    expect(r.criteria_summary[0]).toEqual({ key: "specificity", distribution: { excellent: 0, good: 1, fair: 1, poor: 0, not_applicable: 0 } });
    expect(report).toMatchObject({
      question_refs_removed_not_evaluated: 3,
      question_refs_removed_unknown: 1,
      weaknesses_dropped_no_refs: 1,
      weaknesses_dropped_unanswered_mention: 1,
      requirement_refs_dropped: 1,
      score_overridden: 1,
    });
    expect(hasEvidenceKey(r)).toBe(false);
    expect(payload.evidence).toEqual([]);
    expect(payload.meta).toMatchObject({ prompt_version: AI07_PROMPT_VERSION, model_tier: "default" });
    expect(payload.hashes.career_snapshot_hash).toBe("snap-1");
    // No career pack in the request; model answers are not sent.
    const text = llm.requests[0].userBlocks.map((b) => b.text).join("\n");
    expect(text).not.toContain("<career_data>");
    expect(text).toContain('status="unanswered"');
    expect(text).toContain('status="evaluation_failed"');
  });

  it("one answered question, no unanswered → note null; zero evaluated → caller error without a call", async () => {
    const llm = createFakeLlm([{ json: output({ overall_weaknesses: [], next_practice: [] }) }]);
    const { payload } = await summarizeSession(input([question(1, "submitted", evaluation("poor"))]), { llm });
    expect(payload.result.unanswered_note).toBeNull();
    expect(payload.result.session_score).toMatchObject({ counted_questions: 1, unanswered_count: 0 });

    const none = createFakeLlm([]);
    await expect(summarizeSession(input([question(1, "unanswered", null)]), { llm: none })).rejects.toThrow("no evaluated answer");
    expect(none.requests).toHaveLength(0);
  });

  it("helpers", () => {
    expect(mentionedSequences("Q-2와 3번 질문, 4 번 문항")).toEqual([2, 3, 4]);
    expect(computeCriteriaSummary([])[3]).toEqual({ key: "job_relevance", distribution: { excellent: 0, good: 0, fair: 0, poor: 0, not_applicable: 0 } });
  });
});
