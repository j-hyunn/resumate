"use client"

/**
 * S-46 오른쪽 **Resumate AI 패널** (UX v5.20 S-46 "Resumate AI 패널" · design-system 5.10 / 5.12).
 *
 * (58 런) S-10·S-44와 **같은 공통 `AiPanel`**로 그린다 — 머리(Resumate AI · 대화 기록 · 새 대화 · ⋯ · ×),
 * 메시지 스크롤러·말풍선, 빠른 버튼 칩 줄, 입력 알약("Resumate AI에게 물어보세요" · n/40 · C-19 · 보내기/중단),
 * 잠금(C-18)·끝난 대화·실패한 턴(C-20)·대화 삭제 확인까지 공통 그대로다. 서류 대화 컨트롤러
 * (`useCoverLetterPanel`)를 `useCoverLetterAiPanel` 어댑터가 `AiPanelController` 모양으로 맞춘다.
 *
 * 다른 점만 여기서 넣는다: 제안 카드가 **3.26 `QuestionProposalCard`**(스레드 안, 마지막 AI 턴 아래),
 * 서류 대화는 **복귀 대상이 없다**, 초안 상한은 **초안 턴 6회**(문항당 아님), C-18 설명·시작 안내 문구.
 *
 * 키 없음·키 무효는 **패널만 잠긴다**(C-18) — 왼쪽 본문 입력·문항 편집·저장하기·복사는 그대로 된다(CL-8).
 * 동의 필요는 보낼 때 C-21을 띄운다.
 */
import * as React from "react"
import { AiPanel } from "@/components/career/ai-panel"
import { AI_LOCK_ENTRIES } from "@/components/common/ai-lock"
import type { DocPanelPlacement } from "@/components/common/shell/doc-body"
import { PANEL_COPY, PANEL_FIXED_NOTE } from "@/lib/data/cover-letter-chat-types"
import { QuestionProposalCard, type QuestionFill } from "./question-proposal-card"
import type { CoverLetterPanelController } from "./use-cover-letter-panel"
import { useCoverLetterAiPanel } from "./use-cover-letter-ai-panel"
import { coverLetterClosedCopy } from "./panel-rules"

export function CoverLetterPanel({
  panel,
  placement,
  questions,
  filled,
  onFill,
  onDirectInput,
}: {
  panel: CoverLetterPanelController
  placement: DocPanelPlacement
  questions: Array<{ slot: string; question_text: string; answer_title: string; body: string }>
  filled: Array<{ slot: string; rev: number }>
  onFill: (fills: QuestionFill[]) => void
  /** C-18 대안 "직접 입력" → 첫 문항 내용 칸 */
  onDirectInput?: () => void
}) {
  const common = useCoverLetterAiPanel(panel, placement)
  return (
    <AiPanel
      panel={common}
      lockEntry="draft"
      // closed: 서류 대화는 39개에서 막는다 — 이전 S-46 문구 그대로 (UQ-764)
      copy={{ lock: AI_LOCK_ENTRIES.draft.description, notice: PANEL_FIXED_NOTE, closed: coverLetterClosedCopy(panel.messages.length) }}
      proposalInline
      // 초안 턴 실패는 제안 카드가 C-20 + 다시 시도를 그린다 (지금 본문·이전 제안 유지)
      hideDraftTurnFailure={() => panel.draftFailed}
      renderProposal={() => (
        <>
          <QuestionProposalCard panel={panel} questions={questions} filled={filled} onFill={onFill} />
          {/* 초안 턴이 끝났는데 남은 문항이 있으면 (UX v5.20 S-46 "첫 턴 제안" — UQ-748) */}
          {panel.offerNext && !panel.draftLimitReached ? <p className="pt-3 text-base leading-[1.75]">{PANEL_COPY.continueNext}</p> : null}
        </>
      )}
      renderAboveInput={() =>
        // 초안 턴 6회를 다 썼다 — 칩이 "빠진 부분 물어봐 줘" · "새 대화 시작"으로 바뀌고 이 한 줄이 이유를 알린다 (대화는 계속)
        panel.draftLimitReached && !panel.locked ? <p className="text-sm text-muted-foreground">{PANEL_COPY.draftLimitReached}</p> : null
      }
      onDirectInput={onDirectInput}
    />
  )
}
