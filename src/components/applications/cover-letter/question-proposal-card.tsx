"use client"

/**
 * S-46 **문항 초안 제안 카드** (`QuestionProposalCard`, design-system v5.15 **3.26**;
 * UX v5.20 S-46 "문항 초안 제안 카드" · "제안 카드 구성" · "반영 규칙"; AI-04 개정분).
 *
 * 3.25(`DraftProposalCard`)에서 그대로 쓰는 것: 블록 렌더링 · 검토 블록 [수락]/[빼기] · 출처 칩(C-15) ·
 * 확인 필요 사실 · 빈 부분 칩 · 뺀 문장 · 작성 중 보기 · 상한 안내.
 * **다른 점**: 반영 단위가 **문항 슬롯**이고, 제목이 "자소서 초안", 주 버튼이 **[모두 반영 (n)]**,
 * 문항마다 묶음(문항 n · 문항 문장 · **제안 제목** · 블록 · 글자 수 · C-11 근거 목록 · [반영])이며
 * 문항별로 잠긴다.
 *
 * **CF-S1·CF-S2**: 여기 근거 목록은 `sources_selected` 카드(표시용)이라 **선택 이유 한 줄을 보일 수
 * 있다** — 정본 쪽 C-11(3.10)은 경로 한 줄뿐이다. 두 자리의 모양이 다른 것이 정상이다. 저장 요청에는
 * 근거를 싣지 않고 `applied_proposals: [{writingChatId, slot, rev}]`만 보낸다.
 *
 * **초안 남은 횟수는 "초안 턴" 기준 6회**다 (DM 2.9.4 — 문항당이 아니다). 한 턴이 문항 3개를 써도 1회.
 */
import * as React from "react"
import { ChevronRight, Info, Loader2, Minus, Sparkles, TriangleAlert } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { AiErrorNotice } from "@/components/common/ai-error-notice"
import { SourceChips } from "@/components/common/source-chip"
import { CHIP_CLASS } from "@/components/common/evidence"
import { StreamingCaret } from "@/components/common/streaming"
import { cn } from "@/lib/utils"
import { computeBodyHash } from "@/lib/body-hash"
import {
  COVER_LETTER_DRAFT_LIMIT,
  PANEL_COPY,
  type CoverLetterProposalBlock,
  type CoverLetterProposalQuestion,
  type CoverLetterSourceCard,
} from "@/lib/data/cover-letter-chat-types"
import type { CoverLetterPanelController } from "./use-cover-letter-panel"

export const PROPOSAL_CARD_ID = "cover-letter-proposal-card"

/** 한 문항을 폼에 채운 결과 — 화면이 `applied_proposals`에 쌓는다 */
export interface QuestionFill {
  writingChatId: string
  slot: string
  rev: number
  /** 제안에 제목이 있으면 제목도 교체한다 (없으면 지금 제목을 둔다 — CF-A4) */
  answerTitle: string | null
  body: string
}

export interface QuestionProposalCardProps {
  panel: CoverLetterPanelController
  /** 지금 폼의 문항 (번호·문항 문장·현재 내용) */
  questions: Array<{ slot: string; question_text: string; answer_title: string; body: string }>
  /** 이번 방문에 이미 채운 슬롯 (`{slot}:{rev}`) */
  filled: Array<{ slot: string; rev: number }>
  onFill: (fills: QuestionFill[]) => void
}

/** `review in ('ok','accepted')` 블록만 채운다 (UX S-46 반영 규칙) */
function fillableBlocks(blocks: CoverLetterProposalBlock[]): CoverLetterProposalBlock[] {
  return blocks.filter((b) => b.review === "ok" || b.review === "accepted")
}

function bodyOf(blocks: CoverLetterProposalBlock[]): string {
  return fillableBlocks(blocks)
    .map((b) => b.text)
    .join("\n\n")
}

export function QuestionProposalCard({ panel, questions, filled, onFill }: QuestionProposalCardProps) {
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const [accepted, setAccepted] = React.useState<Record<string, "accepted" | "rejected">>({})
  const [confirm, setConfirm] = React.useState<{ fills: QuestionFill[]; overwriting: number; changedSinceDraft: boolean } | null>(null)
  const listRef = React.useRef<HTMLOListElement | null>(null)

  // "AI 제안 있음" → [자세히]를 그 문항 자리로 펼친다 (UP-4 · UQ-749)
  const focusRequest = panel.focusRequest
  React.useEffect(() => {
    if (!focusRequest) return
    const focusSlot = focusRequest.slot
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 바깥(문항 머리 표식)에서 온 요청을 한 번 반영한다
    setDetailsOpen(true)
    const t = window.setTimeout(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-slot="${CSS.escape(focusSlot)}"]`)
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
      el?.focus({ preventScroll: true })
    }, 60)
    return () => window.clearTimeout(t)
  }, [focusRequest])
  const chat = panel.chat
  const draft = chat?.structured_draft
  const proposals = draft?.document.questions ?? []
  const facts = draft?.facts.filter((f) => f.review === "needs_review") ?? []

  // 초안 작성 중 (임시 블록 — `draft_done`이 통째로 교체한다)
  const drafting = panel.phase === "drafting" || panel.phase === "adjusting"

  if (panel.draftLimitReached && proposals.length === 0)
    return (
      <Alert variant="info" id={PROPOSAL_CARD_ID}>
        <Info aria-hidden />
        <AlertDescription className="space-y-2">
          <span className="block">{PANEL_COPY.draftLimitReached}</span>
          <Button variant="outline" size="sm" onClick={panel.newChat}>
            새 대화
          </Button>
        </AlertDescription>
      </Alert>
    )

  if (proposals.length === 0 && !drafting && !panel.draftFailed) return null

  const reviewState = (b: CoverLetterProposalBlock): CoverLetterProposalBlock["review"] => accepted[b.block_id] ?? b.review
  const slotFilled = (slot: string, rev: number) => filled.some((f) => f.slot === slot && f.rev === rev)

  const buildFill = (p: CoverLetterProposalQuestion): QuestionFill | null => {
    const blocks = p.draft.blocks.filter((b) => {
      const r = reviewState(b)
      return r === "ok" || r === "accepted"
    })
    if (blocks.length === 0) return null
    return {
      writingChatId: chat!.id,
      slot: p.slot,
      rev: p.draft.rev,
      answerTitle: p.draft.answer_title,
      body: blocks.map((b) => b.text).join("\n\n"),
    }
  }

  const applyNow = (fills: QuestionFill[]) => {
    onFill(fills)
    setConfirm(null)
  }

  const requestApply = async (fills: QuestionFill[]) => {
    // 이미 제목·내용이 있는 문항은 확인 한 줄 (UX S-46 반영 규칙)
    const filledQuestions = fills.filter((f) => {
      const q = questions.find((x) => x.slot === f.slot)
      return Boolean(q && (q.body.trim() || q.answer_title.trim()))
    })
    if (filledQuestions.length === 0) return applyNow(fills)
    // `base_body_hash`가 지금 답변의 해시와 다르면(초안을 만든 뒤 답변을 고쳤다) 문구를 바꾼다 (UQ-747).
    // 해시는 서버와 같은 정규화(OD-P5)로 **문항별** 계산한다
    const changed = await Promise.all(
      filledQuestions.map(async (f) => {
        const base = proposals.find((p) => p.slot === f.slot)?.draft.base_body_hash ?? null
        const q = questions.find((x) => x.slot === f.slot)
        if (!base || !q) return false
        return (await computeBodyHash(q.body)) !== base
      }),
    )
    setConfirm({ fills, overwriting: filledQuestions.length, changedSinceDraft: changed.some(Boolean) })
  }

  const applicable = proposals.map(buildFill).filter((f): f is QuestionFill => f !== null && !slotFilled(f.slot, f.rev))

  return (
    <div id={PROPOSAL_CARD_ID} className="space-y-2 rounded-lg border bg-card p-3">
      {/* 확인 줄 (UP-4) — 마지막 AI 턴 바로 아래 */}
      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="size-4 text-ai" aria-hidden />
          자소서 초안
        </p>
        <p className="text-sm text-muted-foreground">
          {drafting ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin text-ai" aria-hidden />
              {panel.phase === "adjusting" ? PANEL_COPY.adjusting : PANEL_COPY.drafting}
              {panel.slow ? ` · ${PANEL_COPY.slowDraft}` : null}
            </span>
          ) : (
            proposalSummary(proposals, questions)
          )}
        </p>
        {/* 초안 남은 횟수 — 턴 기준 (DM 2.9.4) */}
        <p className="text-xs text-muted-foreground tabular-nums">
          초안 남은 횟수 {panel.draftRemaining} / {COVER_LETTER_DRAFT_LIMIT}
        </p>
      </div>

      {/* 초안 실패 — 지금 본문·이전 제안을 그대로 두고 횟수도 줄지 않는다 */}
      {panel.draftFailed ? (
        <div className="space-y-1">
          <p className="text-sm text-warning-subtle-foreground">{PANEL_COPY.draftFailed}</p>
          {panel.failure ? <AiErrorNotice {...panel.failure} size="inline" onRetry={panel.retry} /> : null}
        </div>
      ) : null}

      {/* 작성 중 임시 블록 보기 */}
      {drafting && panel.provisional ? (
        <div className="space-y-1 rounded-md bg-muted/40 p-2">
          <p className="text-xs font-medium text-muted-foreground tabular-nums">문항 {panel.provisional.questionNo}</p>
          {panel.provisional.blocks.map((b) => (
            <p key={b.block_id} className="text-sm leading-[1.7]">
              {b.text}
            </p>
          ))}
          <StreamingCaret />
        </div>
      ) : null}

      {proposals.length > 0 && !drafting ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={applicable.length === 0} onClick={() => void requestApply(applicable)}>
              모두 반영 ({applicable.length})
            </Button>
            <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  자세히
                  <ChevronRight className={cn("size-4 transition-transform", detailsOpen && "rotate-90")} aria-hidden />
                </Button>
              </CollapsibleTrigger>
            </Collapsible>
          </div>

          {detailsOpen ? (
            <ol ref={listRef} className="space-y-3">
              {proposals
                .slice()
                // 화면의 문항 순서(`sort_order`)대로 — 슬롯 번호는 순서가 아니다 (UQ-740)
                .sort((a, b) => orderOf(questions, a.slot) - orderOf(questions, b.slot))
                .map((p) => {
                  const index = questions.findIndex((q) => q.slot === p.slot)
                  const q = questions[index]
                  const locked = slotFilled(p.slot, p.draft.rev)
                  const fill = buildFill(p)
                  return (
                    <li key={p.slot} data-slot={p.slot} tabIndex={-1} className="space-y-2 rounded-md border p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-xs font-medium text-muted-foreground tabular-nums">문항 {index >= 0 ? index + 1 : "?"}</p>
                          <p className="truncate text-sm">{q?.question_text ?? p.slot}</p>
                        </div>
                        {locked ? <Badge variant="secondary">폼에 채움 · 저장 전</Badge> : null}
                      </div>

                      {/* 제안 제목 — 없으면 줄을 생략한다 (CF-6) */}
                      {p.draft.answer_title ? (
                        <p className="text-sm">
                          <span className="text-muted-foreground">제목</span> <span className="font-semibold">{p.draft.answer_title}</span>
                        </p>
                      ) : null}

                      {p.draft.blocks.map((b) => {
                        const r = reviewState(b)
                        if (r === "rejected") return null
                        return (
                          <div key={b.block_id} className={cn("space-y-1 rounded-md p-2", r === "needs_review" && "bg-warning-subtle")}>
                            <p className="text-sm leading-[1.7]">{b.text}</p>
                            {/*
                              블록별 출처 칩 3종 (C-15, 3.26). 공용 `SourceChip`에는 `evidence` 종류
                              ("커리어에서" / "공고 요건에서")가 없어 여기서 같은 칩 모양(`CHIP_CLASS`)으로
                              그린다 — 공용에 그 종류를 더하는 쪽이 깔끔하다(보고서 파운데이션 요청).
                            */}
                            <SourceChips>
                              {b.evidence.map((e) => (
                                <span key={`${e.source_type}-${e.source_id}`} className={cn(CHIP_CLASS, "cursor-default")} tabIndex={0}>
                                  <span className="truncate">{e.source_type === "jd_requirement" ? "공고 요건에서" : "커리어에서"}</span>
                                </span>
                              ))}
                              {b.source_fact_ids.length > 0 ? (
                                <span className={cn(CHIP_CLASS, "cursor-default")} tabIndex={0}>
                                  <span className="truncate">이 말에서 정리했어요</span>
                                </span>
                              ) : null}
                              {b.source_body_quotes.length > 0 ? (
                                <span className={cn(CHIP_CLASS, "cursor-default")} tabIndex={0}>
                                  <span className="truncate">지금 본문에서</span>
                                </span>
                              ) : null}
                            </SourceChips>
                            {r === "needs_review" ? (
                              <div className="space-y-1">
                                <p className="text-xs text-warning-subtle-foreground">{PANEL_COPY.needsReviewBlock}</p>
                                <div className="flex gap-1.5">
                                  <Button size="sm" variant="outline" onClick={() => setAccepted((a) => ({ ...a, [b.block_id]: "accepted" }))}>
                                    수락
                                  </Button>
                                  <Button size="sm" variant="muted-ghost" onClick={() => setAccepted((a) => ({ ...a, [b.block_id]: "rejected" }))}>
                                    <Minus aria-hidden />
                                    빼기
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        )
                      })}

                      {/* 글자 수 — 보정 후 값 */}
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {p.draft.char_count.toLocaleString("ko-KR")}자 / 제한 {(p.draft.char_limit_at_generation ?? 0).toLocaleString("ko-KR")}자
                      </p>

                      {/* 근거 목록 (CL-5) — **제안 쪽만** 선택 이유 한 줄을 보인다 (CF-S2) */}
                      <ProposalSources sources={panel.sources[p.slot]} />

                      {p.draft.missing_slots.length > 0 ? (
                        <p className="text-xs text-muted-foreground">아직 비어 있는 부분: {p.draft.missing_slots.join(" · ")}</p>
                      ) : null}
                      {p.draft.dropped_block_count > 0 ? (
                        <p className="text-xs text-muted-foreground">확인되지 않은 문장 {p.draft.dropped_block_count}개는 뺐어요</p>
                      ) : null}
                      {p.draft.char_adjust_needed ? (
                        <p className="flex items-center gap-1.5 text-xs text-warning-subtle-foreground">
                          <TriangleAlert className="size-3.5 text-warning" aria-hidden />
                          글자 수를 맞추려고 한 번 더 다듬었어요. 제출 전에 글자 수를 확인해 주세요
                        </p>
                      ) : null}

                      <Button size="sm" variant="outline" disabled={locked || !fill} onClick={() => fill && void requestApply([fill])}>
                        반영
                      </Button>
                    </li>
                  )
                })}
            </ol>
          ) : null}

          {/* 확인이 필요한 사실 (접힌 묶음) */}
          {facts.length > 0 ? (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  확인이 필요한 내용 {facts.length}개
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 pt-1">
                {facts.map((f) => (
                  <p key={f.fact_id} className="text-sm">
                    {f.text}
                  </p>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </>
      ) : null}

      {/* 반영 확인 — 되돌리기 없음 (OD-P2) */}
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>이 문항을 AI 초안으로 바꿀까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.changedSinceDraft
                ? // UX v5.20 S-46 반영 규칙 문구 그대로 (`base_body_hash`가 다를 때)
                  "초안을 만든 뒤 답변이 바뀌었어요. 바꾸면 바뀐 내용도 사라져요"
                : confirm && confirm.fills.length > 1
                  ? `답변이 있는 문항 ${confirm.overwriting}개는 바뀌어요`
                  : "지금 쓴 답변은 제안으로 바뀌어요. 되돌릴 수 없어요"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button onClick={() => confirm && applyNow(confirm.fills)}>바꾸기</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** 문항의 화면 순서 (없는 슬롯은 맨 뒤) */
function orderOf(questions: Array<{ slot: string }>, slot: string): number {
  const at = questions.findIndex((q) => q.slot === slot)
  return at >= 0 ? at : Number.MAX_SAFE_INTEGER
}

/** "{n}번~{m}번 문항 초안을 만들었어요. 문항마다 반영할까요?" */
function proposalSummary(proposals: CoverLetterProposalQuestion[], questions: Array<{ slot: string }>): string {
  const numbers = proposals
    .map((p) => questions.findIndex((q) => q.slot === p.slot) + 1)
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
  if (numbers.length === 0) return "문항 초안을 만들었어요. 문항마다 반영할까요?"
  const range = numbers.length === 1 ? `${numbers[0]}번` : `${numbers[0]}번~${numbers[numbers.length - 1]}번`
  return `${range} 문항 초안을 만들었어요. 문항마다 반영할까요?`
}

/**
 * 제안 쪽 근거 목록 — C-11(3.10)과 **행 모양은 같고** 여기만 선택 이유 한 줄이 더 붙는다(CF-S2).
 * `sortOrder`로 정렬한다(주 근거 먼저). 값은 `sources_selected`의 **camelCase** 카드다.
 */
function ProposalSources({ sources }: { sources: CoverLetterSourceCard[] | undefined }) {
  const list = (sources ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder)
  if (list.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground tabular-nums">사용한 경력·프로젝트 {list.length}개</p>
      <ul className="space-y-1">
        {list.map((s) => (
          <li key={`${s.sortOrder}-${s.label}`} className="space-y-0.5">
            <p className="text-sm font-medium">{s.label}</p>
            {/* 제안 쪽에만 있는 줄 — 정본 C-11에는 두지 않는다 (저장되지 않는 값이다) */}
            <p className="text-xs text-muted-foreground">{s.reuseReason ?? s.rationale}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

export { bodyOf, fillableBlocks }
