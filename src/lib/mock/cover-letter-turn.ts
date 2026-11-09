/**
 * MOCK 서류 초안 턴 (AI-04 개정분, UX v5.20 S-46 "응답 방식"). **클라이언트 안전** — 패널이 바로 쓴다.
 *
 * 이벤트 **이름과 칸은 계약(`DocumentTurnEvent`) 그대로**다. 새 이벤트를 만들지 않았고, 기존
 * `sources_selected`·`draft_started`·`draft_block`·`adjusting_length`·`draft_done`에 `slot`·`questionNo`가
 * 붙은 모양이다. 대소문자 규칙도 계약과 같다:
 * - `sources_selected.sources[]`는 **camelCase**
 * - `draft_block.block`은 저장 모양이라 **snake_case**
 *
 * 초안 상한은 **턴 6회**(문항당이 아니다, DM 2.9.4) — 한 턴이 문항 3개를 써도 `draftCount`는 1만 는다.
 */
import type { AiErrorCode } from "@/types/db"
import { computeBodyHash } from "@/lib/body-hash"
import {
  COVER_LETTER_DRAFT_SLOTS_PER_TURN,
  type CoverLetterProposalBlock,
  type CoverLetterStructuredDraft,
  type CoverLetterTurnEvent,
} from "@/lib/data/cover-letter-chat-types"

export interface MockCoverLetterTurnOptions {
  /** 지금 폼의 문항들 (초안을 쓸 대상 고르기) */
  questions: Array<{ slot: string; question_text: string; char_limit: number; body: string }>
  /** 이 턴이 초안 턴인가 (false = 질문 턴) */
  draftTurn: boolean
  /** 이 턴 시작 전의 `draft_count` (턴 기준) */
  draftCount: number
  /** 이미 저장된 제안 (교체되지 않는 문항은 그대로 둔다) */
  draft: CoverLetterStructuredDraft
  /** `?state=` 미리 보기: 이 코드로 실패시킨다 */
  fail?: AiErrorCode | null
  /** 한 조각 사이 간격 (ms) */
  stepMs?: number
  signal?: AbortSignal
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      clearTimeout(t)
      reject(new DOMException("aborted", "AbortError"))
    })
  })

function mockBlocks(slot: string, questionText: string, limit: number): CoverLetterProposalBlock[] {
  const head = questionText.includes("지원 동기")
    ? "결제 도메인에서 장애를 줄여 온 경험이 이 포지션의 과제와 맞닿아 있다고 생각해 지원했습니다."
    : questionText.includes("역량")
      ? "결제 승인 API의 병목을 측정해 인덱스와 캐시를 다시 설계했고, p95 응답 시간을 1.2초에서 0.7초로 줄였습니다."
      : "입사 후에는 결제 신뢰성 지표를 맡아 장애 대응 시간을 더 줄이고 싶습니다."
  const tail = `정산 배치를 이벤트 기반으로 바꿔 마감 시간을 앞당긴 경험도 같은 방향의 일이었습니다. (제한 ${limit}자)`
  return [
    {
      block_id: `${slot}-b1`,
      type: "paragraph",
      text: head,
      basis: "new",
      source_fact_ids: [],
      source_body_quotes: [],
      requirement_ids: ["req-1"],
      placeholders: [],
      flags: [],
      review: "ok",
      review_reason: null,
      evidence: [{ source_type: "project", source_id: "prj-1", source_field: "result", source_locator: null, quote: null, label: "결제 승인 API 성능 개선" }],
    },
    {
      block_id: `${slot}-b2`,
      type: "paragraph",
      text: tail,
      basis: "new",
      source_fact_ids: [],
      source_body_quotes: [],
      requirement_ids: [],
      placeholders: [{ token: "[수치 확인 필요]", hint: "마감 시간을 얼마나 앞당겼는지 확인해 주세요" }],
      flags: ["number_unverified"],
      // 검토가 필요한 블록 — [수락] / [빼기] (수락하지 않으면 반영에서 빠진다)
      review: slot === "q_2" ? "needs_review" : "ok",
      review_reason: slot === "q_2" ? "no_evidence" : null,
      evidence: [],
    },
  ]
}

/**
 * 한 턴을 흘려 준다. 질문 턴: `turn_started` → `reply_delta`* → `reply_done` → `draft_patch` →
 * `draft_flags` → `turn_done`. 초안 턴: `turn_started` → `draft_patch` → `draft_flags` →
 * (문항마다) `sources_selected` → `draft_started` → `draft_block`* → [`adjusting_length`] →
 * `draft_done` → `reply_done` → `turn_done`. 끝은 `turn_done` 또는 `error` 하나다.
 */
export async function* mockCoverLetterTurn(opts: MockCoverLetterTurnOptions): AsyncGenerator<CoverLetterTurnEvent> {
  const step = opts.stepMs ?? 320
  yield { type: "turn_started", provider: "gemini", modelTier: "default", connectionTier: "free" }
  await sleep(step, opts.signal)

  if (!opts.draftTurn) {
    const reply = "어떤 경험을 가장 앞에 두고 싶은지 알려 주시면 그 흐름으로 초안을 만들어 드릴게요."
    for (const piece of reply.match(/.{1,12}/g) ?? []) {
      yield { type: "reply_delta", text: piece }
      await sleep(90, opts.signal)
    }
    yield { type: "reply_done", text: reply }
    yield { type: "draft_patch", structuredDraft: opts.draft, added: [] }
    yield { type: "draft_flags", needsReview: [], sensitiveAdded: 0, sensitiveFlagsCount: opts.draft.sensitive_flags_count }
    yield {
      type: "turn_done",
      messageCount: 2,
      remainingMessages: 38,
      limitReached: false,
      draftStatus: "unchanged",
      draftCount: opts.draftCount,
    }
    return
  }

  // 초안 턴 — 한 턴 최대 3문항 (CL-10). 아직 비어 있는 문항부터
  const targets = opts.questions.filter((q) => !q.body.trim()).slice(0, COVER_LETTER_DRAFT_SLOTS_PER_TURN)
  const slots = (targets.length > 0 ? targets : opts.questions.slice(0, COVER_LETTER_DRAFT_SLOTS_PER_TURN)).map((q) => q.slot)
  const working: CoverLetterStructuredDraft = { ...opts.draft, document: { ...opts.draft.document, questions: [...opts.draft.document.questions] } }
  yield { type: "draft_patch", structuredDraft: working, added: [] }
  yield { type: "draft_flags", needsReview: [], sensitiveAdded: 0, sensitiveFlagsCount: working.sensitive_flags_count }
  await sleep(step, opts.signal)
  yield { type: "draft_started", attempt: 1, reason: "initial", slots }

  for (const [i, slot] of slots.entries()) {
    if (opts.fail && i === 0) {
      await sleep(step * 2, opts.signal)
      // 초안 실패: 임시 블록을 버리고 지금 본문·이전 제안을 그대로 둔다. 횟수도 줄지 않는다
      yield { type: "error", errorCode: opts.fail, provider: "gemini", retryAfter: null, quotaResetsAt: null }
      return
    }
    const q = opts.questions.find((x) => x.slot === slot)
    if (!q) continue
    const no = opts.questions.indexOf(q) + 1
    yield {
      type: "sources_selected",
      slot,
      questionNo: no,
      questionClass: "job_competency",
      // camelCase (계약 그대로) — 여기만 저장 모양과 다르다
      sources: [
        {
          sortOrder: 0,
          role: "primary",
          experienceId: null,
          educationId: null,
          projectId: "prj-1",
          label: "그린페이먼츠 › 결제 승인 API 성능 개선",
          rationale: "공고의 '대규모 결제 승인 API 설계·운영' 요건과 가장 가까운 프로젝트예요",
          reuseReason: null,
          requirementIds: ["req-1"],
        },
        {
          sortOrder: 1,
          role: "supporting",
          experienceId: "exp-1",
          educationId: null,
          projectId: null,
          label: "그린페이먼츠",
          rationale: "결제·정산 플랫폼을 맡은 경력이 전체 흐름을 뒷받침해요",
          reuseReason: "앞 문항에서도 쓴 근거예요",
          requirementIds: [],
        },
      ],
    }
    await sleep(step, opts.signal)
    const blocks = mockBlocks(slot, q.question_text, q.char_limit)
    for (const block of blocks) {
      yield { type: "draft_block", slot, questionNo: no, attempt: 1, block }
      await sleep(step, opts.signal)
    }
    const charCount = blocks.map((b) => b.text).join("\n\n").length
    if (charCount > q.char_limit) {
      yield { type: "adjusting_length", questions: [{ slot, questionNo: no, charCount, charLimit: q.char_limit }] }
      await sleep(step, opts.signal)
    }
    const entry = {
      slot,
      question_id: `qid-${slot}`,
      draft: {
        answer_title: slot === "q_1" ? "결제 장애를 줄인 경험" : null,
        value: blocks.map((b) => b.text).join("\n\n"),
        blocks,
        // (CF-S1) 이 제안이 고른 문항 근거 — 저장 때 `{slot}.sources.{n}` 행이 된다 (주 근거 먼저)
        sources: [
          { source_type: "project", source_id: "prj-1", role: "primary" as const },
          { source_type: "experience", source_id: "exp-1", role: "supporting" as const },
        ],
        char_count: charCount,
        char_limit_at_generation: q.char_limit,
        char_adjust_needed: charCount > q.char_limit,
        correction_applied: charCount > q.char_limit,
        rev: 1,
        generated_at: new Date().toISOString(),
        base_body_hash: null,
        replace_allowed: true,
        missing_slots: slot === "q_3" ? ["구체적인 성과 수치"] : [],
        dropped_block_count: slot === "q_2" ? 1 : 0,
        applied_at: null,
        applied_rev: null,
      },
    }
    working.document.questions = [...working.document.questions.filter((x) => x.slot !== slot), entry]
    yield {
      type: "draft_done",
      slot,
      questionNo: no,
      answerTitle: entry.draft.answer_title,
      charCount,
      charLimit: q.char_limit,
      charAdjustNeeded: entry.draft.char_adjust_needed,
      correctionApplied: entry.draft.correction_applied,
      needsReviewBlockIds: blocks.filter((b) => b.review === "needs_review").map((b) => b.block_id),
      droppedBlockCount: entry.draft.dropped_block_count,
      rev: 1,
      // 한 턴 = 1회 (문항 수와 무관)
      draftCount: opts.draftCount + 1,
      // R15 후속 3: 저장된 제안 그대로 — `base_body_hash`는 **서버 값**(이 턴이 본 본문의 해시)이다
      draft: { ...entry.draft, base_body_hash: await computeBodyHash(q.body) },
    }
  }

  yield { type: "reply_done", text: `${slots.length}개 문항 초안을 만들었어요. 문항마다 반영할까요?` }
  yield {
    type: "turn_done",
    messageCount: 2,
    remainingMessages: 38,
    limitReached: false,
    draftStatus: "updated",
    draftCount: opts.draftCount + 1,
  }
}
