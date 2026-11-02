"use client"

/**
 * AI 실행 버튼 묶음 (design-system 3.22, 02 "실행 버튼 공통 규칙") — replaces v1 UsageHint.
 *
 *   <AiRunButton lock={{ entry: "insight" }} onRun={start} pending={starting}>인사이트 생성</AiRunButton>
 *   <AiRunButton lock={{ entry: "draft" }} rerun onRun={regenerate}>다시 생성</AiRunButton>
 *
 * - 키 없음 (active_provider = null) → C-18 inline lock (`lock` props) instead of the bundle
 * - 키 무효 → button stays enabled; clicking shows C-20 key_invalid inline below (no run)
 * - 확인 필요 → runs normally; badge only
 * - running (same job on the same target) → disabled + "이미 만들고 있어요" (+ `runningSlot`, C-03 축약형)
 * - pending (sync) → Loader2 spinner, label kept
 * - after FL-19 return → ring 4 s + toast "AI를 연결했어요" (no auto-run, D-UX-16)
 * - (v5.3) consent_required → button stays enabled, badge 동의 필요형; clicking opens C-21 for the
 *   active provider × tier first and runs `onRun` after agreeing (closing sends nothing)
 * - (v5.3) `onRun` may return the server result: a start refusal `{ rejected, refusal }` (04 §2.11.7
 *   path ①) is handled here — ai_not_connected → C-18 inline, ai_consent_required → C-21 then
 *   re-run, key_invalid → C-20 key_invalid inline. A path ⑤ key_missing re-reads the connection
 *   (consent cause → C-21, else C-18).
 * Never shows counts / remaining usage (D-34).
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CircleCheck, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { AiConnection } from "@/types/db"
import { isAiRejected } from "@/lib/data/ai-errors"
import { getAiConnectionAction } from "@/lib/data/actions"
import { notifyAiConnectionChanged, useAiConnection, useAiConnectionLoaded } from "./ai-connection-context"
import { useAiConsentGate } from "./consent-gate"
import { AI_CONNECTED_RING, useAiConnectedHighlight } from "./ai-connect-return"
import { AiErrorNotice } from "./ai-error-notice"
import { AiLock, type AiLockProps } from "./ai-lock"
import { connectionLabel, ProviderBadge } from "./provider-badge"

export const AI_RERUN_NOTE = "다시 하면 공급자 토큰을 다시 써요"
export const AI_ALREADY_RUNNING = "이미 만들고 있어요"

export interface AiRunButtonProps {
  children: React.ReactNode
  /** may return the action result — a `{ rejected, refusal }` start refusal is handled (v5.3) */
  onRun?: () => unknown
  /** navigation instead of a button (e.g. S-08 "AI와 대화하며 정리" → S-36); `onRun` then runs on click */
  href?: string
  /** C-18 inline lock shown when no key is active */
  lock: Omit<AiLockProps, "size">
  pending?: boolean
  /** same AI job already running on this target */
  running?: boolean
  /** C-03 축약형 etc. under "이미 만들고 있어요" */
  runningSlot?: React.ReactNode
  /** 다시 생성·다시 채점: adds "다시 하면 공급자 토큰을 다시 써요" */
  rerun?: boolean
  /** v5.3 (A4 request 5): rerun note text, e.g. "다시 채점하면 공급자 토큰을 다시 써요" */
  rerunNote?: string
  /** other non-AI reasons to disable (validation, ST-WAIT-JD) */
  disabled?: boolean
  variant?: React.ComponentProps<typeof Button>["variant"]
  size?: React.ComponentProps<typeof Button>["size"]
  type?: "button" | "submit"
  form?: string
  /** server-loaded connection (else the AiConnectionProvider value) */
  connection?: AiConnection | null
  /** hide the C-19 badge (e.g. it is already in the card head) */
  hideBadge?: boolean
  /** extra content under the button row (e.g. ST-WAIT-JD) */
  footer?: React.ReactNode
  "aria-describedby"?: string
  /** fixed accessible name when the visible label changes (e.g. a countdown, UQ-353 / A-11) */
  "aria-label"?: string
  id?: string
  className?: string
  buttonClassName?: string
}

export function AiRunButton({
  children,
  onRun,
  href,
  lock,
  pending,
  running,
  runningSlot,
  rerun,
  rerunNote,
  disabled,
  variant = "default",
  size,
  type = "button",
  form,
  connection: explicit,
  hideBadge,
  footer,
  "aria-describedby": describedBy,
  "aria-label": ariaLabel,
  id,
  className,
  buttonClassName,
}: AiRunButtonProps) {
  const connection = useAiConnection(explicit)
  // UQ-207: until the connection state is known the button stays disabled (no unlocked click
  // that would bypass C-18); server-loaded `connection` skips the wait.
  const loaded = useAiConnectionLoaded(explicit)
  const [showInvalid, setShowInvalid] = React.useState(false)
  /** server said "no active provider" (ai_not_connected / key_missing) → C-18 inline */
  const [lockedByServer, setLockedByServer] = React.useState(false)
  const consent = useAiConsentGate(explicit)
  const router = useRouter()
  const runningId = React.useId()
  const highlighted = useAiConnectedHighlight(() => {
    toast("AI를 연결했어요", {
      icon: <CircleCheck className="size-4 text-success" aria-hidden />,
      description: connection ? connectionLabel(connection) : undefined,
    })
  })

  if ((connection && !connection.active_provider) || lockedByServer) {
    return <AiLock size="inline" actionName={lock.actionName ?? ariaLabel ?? (typeof children === "string" ? children : undefined)} {...lock} className={cn(lock.className, className)} />
  }

  const invalid = connection?.key_status === "invalid"
  const isDisabled = disabled || running || pending || !loaded

  /** run + handle a start refusal returned by the action (04 §2.11.7 ① / ⑤) */
  const execute = async () => {
    const result = await onRun?.()
    if (!isAiRejected(result)) return
    const code = result.refusal ?? result.rejected
    if (code === "ai_consent_required") {
      notifyAiConnectionChanged()
      consent.open(() => void execute())
      return
    }
    if (code === "key_invalid") {
      notifyAiConnectionChanged()
      setShowInvalid(true)
      return
    }
    if (code === "ai_not_connected" || code === "key_missing") {
      // path ⑤ folds "consent needed" into key_missing — re-read the connection to tell them apart
      const fresh = await getAiConnectionAction()
      notifyAiConnectionChanged()
      if (fresh.active_provider && fresh.consent_required) consent.open(() => void execute())
      else setLockedByServer(true)
    }
  }
  const handle = (e: React.MouseEvent) => {
    if (invalid) {
      e.preventDefault()
      setShowInvalid(true)
      return
    }
    if (consent.required) {
      e.preventDefault()
      consent.guard(() => {
        void execute()
        if (href) router.push(href)
      })
      return
    }
    void execute()
  }
  const content = (
    <>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </>
  )
  const describe = [describedBy, running ? runningId : undefined].filter(Boolean).join(" ") || undefined
  const btnClass = cn(highlighted && AI_CONNECTED_RING, buttonClassName)

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {href && !invalid && !isDisabled ? (
          <Button variant={variant} size={size} asChild className={btnClass} id={id}>
            <Link href={href} aria-describedby={describe} aria-label={ariaLabel} onClick={handle}>
              {content}
            </Link>
          </Button>
        ) : (
          <Button
            id={id}
            type={invalid ? "button" : type}
            form={form}
            variant={variant}
            size={size}
            onClick={handle}
            disabled={isDisabled}
            aria-describedby={describe}
            aria-label={ariaLabel}
            className={btnClass}
          >
            {content}
          </Button>
        )}
        {hideBadge ? null : <ProviderBadge connection={connection} />}
      </div>
      {running ? (
        <div id={runningId} className="flex flex-wrap items-center gap-2 text-sm leading-5 text-muted-foreground">
          <span>{AI_ALREADY_RUNNING}</span>
          {runningSlot}
        </div>
      ) : null}
      {rerun && !running ? <p className="text-xs text-muted-foreground">{rerunNote ?? AI_RERUN_NOTE}</p> : null}
      {showInvalid && (invalid || connection?.active_provider) ? <AiErrorNotice code="key_invalid" size="inline" className="pt-1" /> : null}
      {footer}
      {consent.dialog}
    </div>
  )
}
