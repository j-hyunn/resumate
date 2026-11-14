"use client"

/**
 * C-18 AI 잠금 상태 (02 C-18, design-system 3.18) — ST-AI-LOCKED.
 *
 *   <AiLock entry="insight" size="area" />                 화면·탭 본문 대신 (기존 결과 없음)
 *   <AiLock entry="draft" size="inline" actionName="문항 초안 만들기" />   실행 버튼 하나 대신
 *   <AiLockPopup open … entry="insight" returnHref={…} />          팝업형
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
import { AiConnectLink } from "./ai-connect-link"
import { markAiConnectReturn } from "./ai-connect-return"

export type AiLockEntry =
  | "writing_chat"
  | "requirements"
  | "insight"
  | "draft"
  | "usage"

/** Entry-point table (02 C-18): 기능 설명 1줄 + 기본 대안 */
export const AI_LOCK_ENTRIES: Record<AiLockEntry, { description: string; alternative?: string }> = {
  writing_chat: { description: "질문에 답하면 AI가 STAR(상황·역할·행동·결과/성과·배운 점)에 넣을 내용을 제안해요", alternative: "직접 입력" }, // C-18 (v5.13)
  requirements: { description: "공고에서 주요 업무·자격요건·우대사항을 정리해 드려요" },
  insight: { description: "이 공고와 내 커리어를 비교해 충족 요건·강점·보완점을 정리해요", alternative: "커리어 정리하기" },
  draft: { description: "커리어를 바탕으로 자소서 문항 초안을 써 드려요" }, // C-18 (v5.20, CF-1·CF-A13 — 경력기술서 폐기)
  usage: { description: "AI를 연결하면 Resumate에서 쓴 토큰과 예상 비용을 여기서 볼 수 있어요" },
}

/** UQ-350: default FL-19 feature per entry ((v5.20, CF-1) "draft" → 자소서 — 서류가 하나다) */
const ENTRY_FEATURE: Record<AiLockEntry, AiFeatureKey> = {
  writing_chat: "writing_chat",
  requirements: "requirements",
  insight: "insight",
  draft: "cover_letter",
  usage: "usage",
}

export const AI_LOCK_TITLE = "AI 연결하면 사용할 수 있어요"
export const AI_LOCK_RECOMMEND = "Gemini 무료 키로 결제 없이 시작할 수 있어요"

export interface AiLockProps {
  entry: AiLockEntry
  size?: "area" | "inline"
  /** 영역형을 카드 틀 없이 그린다 — 컨테이너에 바로 보일 때(S-46 인사이트 탭, 2026-11-10). 기본 false */
  bare?: boolean
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
  const remember = () => markAiConnectReturn({ href: returnHref, feature_label: AI_FEATURE_NAMES[feature], params })
  return { gemini: routes.aiConnect({ provider: "gemini" }), remember }
}

export function AiLock({
  bare = false,
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
  const { gemini, remember } = useConnectLinks(returnHref, featureKey, returnParams)
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
          <AiConnectLink onClick={remember}>
            AI 연결하기
          </AiConnectLink>
        </Button>
        {alt}
      </div>
    )
  }

  return (
    <LockFrame
      bare={bare}
      role="region"
      aria-label={`${featureLabel ?? AI_FEATURE_NAMES[featureKey]} 잠김`}
      className={cn(bare ? "flex max-w-xl flex-col gap-4" : "max-w-xl gap-4 p-6", className)}
    >
      <div className="grid size-10 place-items-center rounded-full bg-primary-subtle">
        <PlugZap className="size-5 text-primary-text" aria-hidden />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg leading-7 font-semibold">{title}</h2>
        <p className="text-base text-muted-foreground">{desc}</p>
      </div>
      <div>
        <Button asChild>
          <AiConnectLink onClick={remember}>
            AI 연결하기
          </AiConnectLink>
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
    </LockFrame>
  )
}

/**
 * C-18 팝업형, generic (design-system 3.18) with caller-given copy. Closing changes nothing.
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
  /** default: AI_LOCK_TITLE */
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
    // the settings dialog may open in place (saved key) — don't leave this dialog under it
    onOpenChange(false)
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
            <AiConnectLink onClick={remember}>
              AI 연결하기
            </AiConnectLink>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 영역형의 틀 — 기본은 카드, `bare`면 틀 없는 블록 */
function LockFrame({ bare, ...props }: React.ComponentProps<"div"> & { bare: boolean }) {
  return bare ? <div {...props} /> : <Card {...props} />
}
