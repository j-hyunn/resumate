"use client"

/**
 * S-46 인사이트 안내 (v5.21, JR-5·JR-6). 자소서 대화(AI-04)는 공고 원문을 읽지 않고 **커리어 + 최신 인사이트 + 대화**를
 * 읽는다 — 그래서 인사이트가 없거나 만드는 중이면 그 사실을 한 줄로 알린다. 대화는 기다리지 않고 커리어만으로 진행한다.
 *
 * - 문항 설정 상태: 생성 직후 인사이트가 자동으로 시작됐으면(FL-10 `insightJobId`) 머리 아래 한 줄 `[가정]`.
 * - 패널 시작 영역: 고정 안내 + (인사이트 없음) "인사이트가 있으면 …" + (키 있음) [인사이트 탭 열기] `[가정]` /
 *   (만드는 중) "인사이트를 만드는 중이에요. 끝나면 …" `[가정]`.
 */
import * as React from "react"
import { Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PANEL_FIXED_NOTE } from "@/lib/data/cover-letter-chat-types"

/** 이 자기소개서의 인사이트: 없음 / 대기·실행 중 / 완료된 결과 있음 */
export type CoverLetterInsightState = "none" | "generating" | "ready"

/** FL-10 문항 설정 상태 `[가정]` 문구 */
export const QUESTIONS_INSIGHT_GENERATING = "인사이트를 만드는 중이에요. 작성을 시작하면 인사이트 탭에서 볼 수 있어요"
/** S-46 시작 영역 `[가정: 문구]` */
export const PANEL_INSIGHT_NONE = "인사이트가 있으면 공고에 맞춘 답을 쓸 수 있어요"
/** S-46 시작 영역 `[가정]` */
export const PANEL_INSIGHT_GENERATING = "인사이트를 만드는 중이에요. 끝나면 공고에 맞춘 답을 쓸 수 있어요"

export function QuestionsInsightLine({ insight }: { insight: CoverLetterInsightState }) {
  if (insight !== "generating") return null
  return (
    <p className="flex items-start gap-1.5 text-sm text-muted-foreground" role="status">
      <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-ai" aria-hidden />
      {QUESTIONS_INSIGHT_GENERATING}
    </p>
  )
}

/** The panel start-area notice: the fixed line + the insight line (JR-5) */
export function PanelStartNotice({
  insight,
  canOpenInsight,
  onOpenInsight,
}: {
  insight: CoverLetterInsightState
  /** (키 있음) [인사이트 탭 열기] */
  canOpenInsight: boolean
  onOpenInsight: () => void
}) {
  return (
    <span className="flex flex-col items-start gap-1.5">
      <span>{PANEL_FIXED_NOTE}</span>
      {insight === "none" ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{PANEL_INSIGHT_NONE}</span>
          {canOpenInsight ? (
            <Button variant="link" size="sm" className="h-auto px-0" onClick={onOpenInsight}>
              <Sparkles aria-hidden />
              인사이트 탭 열기
            </Button>
          ) : null}
        </span>
      ) : insight === "generating" ? (
        <span>{PANEL_INSIGHT_GENERATING}</span>
      ) : null}
    </span>
  )
}
