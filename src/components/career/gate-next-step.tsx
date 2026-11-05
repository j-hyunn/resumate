"use client"

/**
 * C-09/C-10 다음 단계 버튼 (S-09 저장 완료, S-36 저장 완료). FL-13 v5: 키가 없거나 무효이면
 * AI 작성 대화 대신 폼 경로("직접 입력하기"), 무효면 C-20 key_invalid 한 줄 +
 * "키를 확인하면 AI와 대화로 채울 수 있어요 [AI 연결 확인]".
 * Server readiness already returns next_action = 'form' then (continueHref = null); this also
 * covers the client `?state=ai-locked|key-invalid` previews.
 */
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AiErrorNotice } from "@/components/common/ai-error-notice"
import { useAiConnection, useAiConnectionLoaded } from "@/components/common/ai-connection-context"
import { AiConnectLink } from "@/components/common/ai-connect-link"
import { Skeleton } from "@/components/ui/skeleton"
import { markAiConnectReturn } from "@/components/common/ai-connect-return"
import { directionParticle, AI_FEATURE_NAMES } from "@/lib/data/labels"

export function GateNextStep({
  featureLabel,
  ready,
  returnHref,
  continueHref,
  directHref,
  onReturn,
  secondary,
  loading,
}: {
  /** UQ-298: readiness not loaded yet → no branch shown (avoid flashing the form path) */
  loading?: boolean
  featureLabel: string
  ready: boolean
  returnHref: string | null
  continueHref: string | null
  /** 폼 경로 (새 프로젝트 / 새 상세 내용) */
  directHref: string
  onReturn?: () => void
  secondary?: React.ReactNode
}) {
  const connection = useAiConnection()
  const connectionLoaded = useAiConnectionLoaded()
  const aiUsable = !connection || (connection.active_provider !== null && connection.key_status !== "invalid")
  const invalid = connection?.key_status === "invalid"
  if (loading || !connectionLoaded)
    return (
      <div className="flex flex-wrap gap-2" aria-busy="true">
        <Skeleton className="h-10 w-40" />
        <span className="sr-only">다음 단계를 확인하는 중</span>
        {secondary}
      </div>
    )
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {ready && returnHref ? (
          <Button asChild>
            <Link href={returnHref} onClick={onReturn}>
              {featureLabel}
              {directionParticle(featureLabel)} 돌아가기
            </Link>
          </Button>
        ) : continueHref && aiUsable ? (
          <Button asChild>
            <Link href={continueHref}>AI와 대화하며 채우기</Link>
          </Button>
        ) : !ready ? (
          <Button asChild>
            <Link href={directHref}>직접 입력하기</Link>
          </Button>
        ) : null}
        {secondary}
      </div>
      {!ready && invalid ? (
        <div className="space-y-1">
          <AiErrorNotice code="key_invalid" size="inline" />
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            키를 확인하면 AI와 대화로 채울 수 있어요
            <Button asChild variant="link" size="sm" className="h-auto px-0">
              <AiConnectLink onClick={() => markAiConnectReturn({ feature_label: AI_FEATURE_NAMES.writing_chat })}>
                AI 연결 확인
              </AiConnectLink>
            </Button>
          </p>
        </div>
      ) : null}
    </div>
  )
}

/**
 * UQ-291: lock props for A2 AI-chat entry buttons whose children are icon + text — keeps the
 * feature name in the accessible name (actionName), visible in the C-18 description, and in the
 * C-18 region label; the FL-19 return name is always AI_FEATURE_NAMES.writing_chat (UQ-350). // [UI-가정] "{기능} · {설명}" visible form
 */
export function chatLock(feature: string, alternativeHref?: string) {
  return {
    entry: "writing_chat" as const,
    actionName: feature,
    // UQ-350: FL-19 returns to "AI 작성 대화" (AI_FEATURE_NAMES), not the button label
    feature: "writing_chat" as const,
    // C-18 v5.13: the writing chat proposes STAR content (no "상세 내용" since v5.5)
    description: `${feature} · 질문에 답하면 AI가 STAR(상황·역할·행동·결과/성과·배운 점)에 넣을 내용을 제안해요`,
    alternativeHref,
  }
}
