"use client"

/**
 * C-18 AI 잠금 상태 (02 C-18, design-system 3.18) — ST-AI-LOCKED.
 *
 *   <AiLock entry="insight" size="area" />                 화면·탭 본문 대신 (기존 결과 없음)
 *   <AiLock entry="draft" size="inline" actionName="경력기술서 생성" />   실행 버튼 하나 대신
 *   <AiLockDialog open … interviewType="job" returnHref={routes.interviewPrep(id, {type})} />  C-14 키 없음 변형
 *
 * "AI 연결하기" → S-41 (저장된 키 없음) / S-40, and remembers the FL-19 return target.
 * Not a failure: primary-subtle icon circle, no warning/destructive colour.
 */
import * as React from "react"
import Link from "next/link"
import { Gift, Lock, PlugZap } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { routes } from "@/lib/routes"
import { AI_FEATURE_NAMES, type AiFeatureKey } from "@/lib/data/labels"
import { useAiConnectHref } from "./ai-connection-context"
import { markAiConnectReturn } from "./ai-connect-return"

export type AiLockEntry =
  | "writing_chat"
  | "requirements"
  | "insight"
  | "draft"
  | "interview_new"
  | "interview_submit"
  | "usage"

/** Entry-point table (02 C-18): 기능 설명 1줄 + 기본 대안 */
export const AI_LOCK_ENTRIES: Record<AiLockEntry, { description: string; alternative?: string }> = {
  writing_chat: { description: "질문에 답하면 AI가 프로젝트와 상세 내용으로 정리해 줘요", alternative: "직접 입력" },
  requirements: { description: "공고에서 주요 업무·자격요건·우대사항을 정리해 드려요" },
  insight: { description: "이 공고와 내 커리어를 비교해 충족 요건·강점·보완점을 정리해요", alternative: "커리어 정리하기" },
  draft: { description: "커리어를 바탕으로 경력기술서·자기소개서 초안을 써 드려요" },
  interview_new: { description: "공고와 커리어에 맞춘 면접 질문을 만들고 답변을 채점해요", alternative: "지난 세션 보기" },
  interview_submit: { description: "제출하면 연결한 AI로 채점해요. 작성한 답변은 저장돼 있어요", alternative: "계속 작성" },
  usage: { description: "AI를 연결하면 Resumate에서 쓴 토큰과 예상 비용을 여기서 볼 수 있어요" },
}

/** UQ-350: default FL-19 feature per entry ("draft" → 경력기술서; cover-letter call sites pass `feature="cover_letter"`) */
const ENTRY_FEATURE: Record<AiLockEntry, AiFeatureKey> = {
  writing_chat: "writing_chat",
  requirements: "requirements",
  insight: "insight",
  draft: "career_description",
  interview_new: "interview_questions",
  interview_submit: "interview_evaluation",
  usage: "usage",
}

export const AI_LOCK_TITLE = "AI 연결하면 사용할 수 있어요"
export const AI_LOCK_RECOMMEND = "Gemini 무료 키로 결제 없이 시작할 수 있어요"

export interface AiLockProps {
  entry: AiLockEntry
  size?: "area" | "inline"
  /** override the 기능 설명 */
  description?: string
  /**
   * 대안 링크 (키 없이 할 수 있는 일). `alternativeHref` or `onAlternative`; label defaults to the
   * entry's 대안. Omit both to hide the line. "공고 원문은 그대로 보임" kinds are page content.
   */
  alternativeLabel?: string
  alternativeHref?: string
  onAlternative?: () => void
  /** extra text before the alternative link (area form), e.g. "공고 원문은 그대로 볼 수 있어요" */
  alternativeNote?: string
  /** inline: name of the replaced run button, read first by screen readers (3.18 접근성). Never the FL-19 name */
  actionName?: string
  /**
   * UQ-350: the feature FL-19 returns to ("{원래 기능}으로 돌아가기", AI_FEATURE_NAMES). Defaults per
   * `entry`; pass it where one entry covers several features (draft → cover_letter).
   */
  feature?: AiFeatureKey
  /** area: "{기능} 잠김" region label (defaults to the feature name) */
  featureLabel?: string
  /** where FL-19 returns (default: current URL) */
  returnHref?: string
  /** 진행 중 설정 restored after the round trip via consumeAiReturnParams() (UQ-351/352) */
  returnParams?: Record<string, unknown>
  /**
   * v5.3: replace the title "AI 연결하면 사용할 수 있어요" — the retry refusal key_missing uses
   * AI_LOCK_RETRY_TITLE "AI 연결이 필요해요. 작성한 내용은 저장돼 있어요" (02 C-20).
   */
  title?: string
  className?: string
}

/** 02 C-20 "다시 시도 거부" key_missing: the C-18 inline lock with this title */
export const AI_LOCK_RETRY_TITLE = "AI 연결이 필요해요. 작성한 내용은 저장돼 있어요"

function useConnectLinks(returnHref: string | undefined, feature: AiFeatureKey, params?: Record<string, unknown>) {
  const href = useAiConnectHref()
  const remember = () => markAiConnectReturn({ href: returnHref, feature_label: AI_FEATURE_NAMES[feature], params })
  return { href, gemini: routes.aiConnect({ provider: "gemini" }), remember }
}

export function AiLock({
  entry,
  size = "area",
  description,
  alternativeLabel,
  alternativeHref,
  onAlternative,
  alternativeNote,
  actionName,
  feature,
  featureLabel,
  returnHref,
  returnParams,
  title = AI_LOCK_TITLE,
  className,
}: AiLockProps) {
  const featureKey = feature ?? ENTRY_FEATURE[entry]
  const meta = AI_LOCK_ENTRIES[entry]
  const desc = description ?? meta.description
  const altLabel = alternativeLabel ?? meta.alternative
  const { href, gemini, remember } = useConnectLinks(returnHref, featureKey, returnParams)
  const alt =
    altLabel && (alternativeHref || onAlternative) ? (
      alternativeHref ? (
        <Button variant="link" size="sm" asChild className="h-auto px-0">
          <Link href={alternativeHref}>{altLabel}</Link>
        </Button>
      ) : (
        <Button variant="link" size="sm" className="h-auto px-0" onClick={onAlternative}>
          {altLabel}
        </Button>
      )
    ) : null

  if (size === "inline") {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-input bg-card px-3 py-2.5",
          className,
        )}
      >
        <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {actionName ? <span className="sr-only">{actionName} — </span> : null}
            {title}
          </p>
          <p className="text-sm leading-5 text-muted-foreground max-md:line-clamp-2">{desc}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={href} onClick={remember}>
            AI 연결하기
          </Link>
        </Button>
        {alt}
      </div>
    )
  }

  return (
    <Card
      role="region"
      aria-label={`${featureLabel ?? AI_FEATURE_NAMES[featureKey]} 잠김`}
      className={cn("max-w-xl gap-4 p-6", className)}
    >
      <div className="grid size-10 place-items-center rounded-full bg-primary-subtle">
        <PlugZap className="size-5 text-primary" aria-hidden />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg leading-7 font-semibold">{title}</h2>
        <p className="text-base text-muted-foreground">{desc}</p>
      </div>
      <div>
        <Button asChild>
          <Link href={href} onClick={remember}>
            AI 연결하기
          </Link>
        </Button>
      </div>
      <p className="flex items-center gap-1.5 text-sm leading-5 text-muted-foreground">
        <Gift className="size-4 shrink-0" aria-hidden />
        <Button variant="link" size="sm" asChild className="h-auto px-0">
          <Link href={gemini} onClick={remember}>
            {AI_LOCK_RECOMMEND}
          </Link>
        </Button>
      </p>
      {alt || alternativeNote ? (
        <>
          <Separator />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-5 text-muted-foreground">
            {alternativeNote ? <span>{alternativeNote}</span> : null}
            {alt}
          </div>
        </>
      ) : null}
    </Card>
  )
}

/**
 * C-14 키 없음 변형 (팝업형). Replaces the interview-stage popup when no key is active.
 * Closing keeps the card move (the caller already moved it).
 */
export function AiLockDialog({
  open,
  onOpenChange,
  interviewType,
  returnHref,
  onConnect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  interviewType: "job" | "culture_fit"
  /** FL-19 복귀 대상 = S-20 `?type=` */
  returnHref: string
  /** also run when leaving to connect (UQ-326: board origin + S-20 진입 안내 markers) */
  onConnect?: () => void
}) {
  const links = useConnectLinks(returnHref, "interview_questions")
  const { href, gemini } = links
  const remember = () => {
    links.remember()
    onConnect?.()
  }
  const typeLabel = interviewType === "job" ? "직무 면접" : "컬처핏 면접"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>면접 연습은 AI 연결 후 사용할 수 있어요</DialogTitle>
          <DialogDescription className="text-base">
            연결하면 {typeLabel}이 선택된 면접 준비로 바로 이어져요
          </DialogDescription>
        </DialogHeader>
        <p className="flex items-center gap-1.5 text-sm leading-5 text-muted-foreground">
          <Gift className="size-4 shrink-0" aria-hidden />
          <Button variant="link" size="sm" asChild className="h-auto px-0">
            <Link href={gemini} onClick={remember}>
              {AI_LOCK_RECOMMEND}
            </Link>
          </Button>
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button asChild>
            <Link href={href} onClick={remember}>
              AI 연결하기
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * C-18 팝업형, generic (design-system 3.18; A4 request 4). Same look as AiLockDialog (C-14 키 없음
 * 변형) with caller-given copy — e.g. S-37 메뉴 "다시 채점" without a key. Closing changes nothing.
 */
export function AiLockPopup({
  open,
  onOpenChange,
  title,
  description,
  entry,
  feature,
  returnHref,
  returnParams,
  onConnect,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** e.g. "다시 채점은 AI 연결 후 사용할 수 있어요" (default: AI_LOCK_TITLE) */
  title?: string
  /** default: the entry's 기능 설명 (02 C-18 표) */
  description?: string
  entry: AiLockEntry
  /** FL-19 "{기능}으로 돌아가기" (default per entry) */
  feature?: AiFeatureKey
  returnHref?: string
  returnParams?: Record<string, unknown>
  onConnect?: () => void
  /** extra body content under the description */
  children?: React.ReactNode
}) {
  const links = useConnectLinks(returnHref, feature ?? ENTRY_FEATURE[entry], returnParams)
  const remember = () => {
    links.remember()
    onConnect?.()
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle>{title ?? AI_LOCK_TITLE}</DialogTitle>
          <DialogDescription className="text-base">{description ?? AI_LOCK_ENTRIES[entry].description}</DialogDescription>
        </DialogHeader>
        {children}
        <p className="flex items-center gap-1.5 text-sm leading-5 text-muted-foreground">
          <Gift className="size-4 shrink-0" aria-hidden />
          <Button variant="link" size="sm" asChild className="h-auto px-0">
            <Link href={links.gemini} onClick={remember}>
              {AI_LOCK_RECOMMEND}
            </Link>
          </Button>
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button asChild>
            <Link href={links.href} onClick={remember}>
              AI 연결하기
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
