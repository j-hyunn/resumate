"use client"

/**
 * v5.3 A13 요건 선행 추출 (FL-03, 02 S-17·S-18, design-system 6장 A3 "S-17·S-18 요건 선행 추출").
 * When the JD has no requirements yet (registered without a key), the run button first calls AI-01 as a
 * separate request ("공고 요건 정리 중"), waits for it to finish, and only then runs the generation step
 * (AI-11 / 초안 생성 / 문항 생성). A failed extraction shows C-20 inline in the same place and **nothing
 * is created** (no draft row).
 *
 *   const req = useRequirementsFirst(apId, { needed: extractFirst, rerunLabel: "초안 생성" })
 *   <AiRunButton onRun={() => req.run(generate)} disabled={req.busy} … />
 *   {req.slot}
 */
import * as React from "react"
import { Loader2 } from "lucide-react"
import { AiErrorNotice, type AiErrorInfo } from "@/components/common/ai-error-notice"
import { isAiRejected } from "@/components/common/ai-rejection"
import { notifyAiConnectionChanged } from "@/components/common/ai-connection-context"
import type { AiRejected } from "@/lib/data/ai-errors"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import { getAiConnectionAction } from "@/lib/data/actions"
import { routes } from "@/lib/routes"
import type { AiErrorCode, AiRetryRefusalCode } from "@/types/db"
import { getJdExtractionStateAction, retryJdExtractionAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"

const POLL_MS = 1_200
/** A14 request path: default wait before a failed request-path call may be sent again (mock) */
const REQUEST_WAIT_MS = 20_000
/** 02 S-15: "요건 정리하기"는 동기 요청 최대 30초 [가정] → 넘으면 timeout으로 실패 (UQ-523) */
const EXTRACT_TIMEOUT_MS = 30_000

/**
 * Path ⑤ refusal (요건 추출·서류 = request-scoped work): the server folds "consent needed" into key_missing →
 * re-read the connection to pick the C-20 retry-refusal row (02 C-20 "다시 시도 거부", G-34).
 */
export async function refusalOf(r: AiRejected): Promise<AiRetryRefusalCode> {
  if (r.rejected === "key_invalid") return "key_invalid"
  const fresh = await getAiConnectionAction()
  notifyAiConnectionChanged()
  if (fresh.active_provider && fresh.key_status === "invalid") return "key_invalid"
  if (fresh.active_provider && fresh.consent_required) return "ai_consent_required"
  return "key_missing"
}

export interface RequirementsFirst {
  /** extraction is running (button disabled, "공고 요건 정리 중") */
  busy: boolean
  /** requirements still need extracting before the next run */
  needed: boolean
  /** run AI-01 first when needed, then `next` (its result is returned so AiRunButton handles refusals) */
  run: (next: () => unknown) => Promise<unknown>
  /** status line / C-20 inline under the run button */
  slot: React.ReactNode
}

export function useRequirementsFirst(
  applicationProjectId: string,
  opts: {
    needed: boolean
    /** run button label for the input-caused caption ("고친 뒤 {rerunLabel}로 새로 실행해 주세요") */
    rerunLabel: string
    /** `?state=extract-failed*` preview: fail the extraction with this code (nothing is written) */
    previewFail?: AiErrorCode | null
    /** C-20 "입력 원인 실패의 이동" (Q53-2): input-caused failures go to S-15 공고 원문 수정 */
    /** (v5.20, CF-A12) 채용 공고 탭을 원문 수정 상태로 열고 "{인사이트 / 자소서} 탭으로 돌아가기"를 고른다 */
    jdEditFrom?: { from: "insight" | "cover_letter" }
  },
): RequirementsFirst {
  const previewWrite = usePreviewWriteGuard()
  const [done, setDone] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [already, setAlready] = React.useState(false)
  const [failure, setFailure] = React.useState<AiErrorInfo | null>(null)
  /** UQ-523: a refused retry from the C-20 below swaps its action row (C-18 / C-21 / 키 교체) */
  const [refusal, setRefusal] = React.useState<AiRetryRefusalCode | null>(null)
  const lastNext = React.useRef<(() => unknown) | null>(null)
  const alive = React.useRef(true)
  React.useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const needed = opts.needed && !done

  const fail = (info: AiErrorInfo) => {
    const wait = info.code === "rate_limited" || info.code === "provider_unavailable"
    setFailure({ ...info, retryAfter: info.retryAfter ?? (wait ? new Date(Date.now() + REQUEST_WAIT_MS).toISOString() : null) })
    setBusy(false)
    setAlready(false)
  }

  const run = async (next: () => unknown): Promise<unknown> => {
    lastNext.current = next
    if (!needed) return next()
    setFailure(null)
    setRefusal(null)
    setBusy(true)
    if (opts.previewFail) {
      await new Promise((r) => setTimeout(r, 1_500))
      if (alive.current) fail({ code: opts.previewFail })
      return undefined
    }
    if (previewWrite.active) {
      // `?state=`: the extraction is simulated, the JD stays as stored
      await new Promise((r) => setTimeout(r, 1_200))
      if (!alive.current) return undefined
      setDone(true)
      setBusy(false)
      return next()
    }
    let started: Awaited<ReturnType<typeof retryJdExtractionAction>>
    try {
      started = await retryJdExtractionAction(applicationProjectId)
    } catch (err) {
      // 던진 오류(네트워크·서버)로 "정리 중"에 묶이지 않게 풀고 호출한 쪽에 넘긴다 (2026-11-10)
      setBusy(false)
      throw err
    }
    if (isAiRejected(started)) {
      // path ⑤ refusal: nothing changed — the run button re-reads readiness (C-18 / C-21 / key_invalid)
      setBusy(false)
      return started
    }
    if (started === false) {
      fail({ code: "not_a_jd" })
      return undefined
    }
    if (typeof started === "object" && "already" in started) setAlready(true)
    // AI-01 is a sync request in the real backend; the mock finishes it after a few seconds → poll
    const deadline = Date.now() + EXTRACT_TIMEOUT_MS
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      if (!alive.current) return undefined
      if (Date.now() > deadline) {
        fail({ code: "timeout" })
        return undefined
      }
      const s = await getJdExtractionStateAction(applicationProjectId)
      if (s.status === "succeeded") {
        if (s.requirement_count === 0) {
          // 02 S-16: 추출은 됐는데 요건이 0개 → not_a_jd 문구
          fail({ code: "not_a_jd" })
          return undefined
        }
        setDone(true)
        setBusy(false)
        setAlready(false)
        return next()
      }
      if (s.status === "failed") {
        fail({ code: s.error_code ?? "provider_unavailable", provider: s.provider, retryAfter: s.retry_after, quotaResetsAt: s.quota_resets_at })
        return undefined
      }
    }
  }

  const slot = busy ? (
    <p className="flex items-center gap-2 text-sm text-ai-subtle-foreground" role="status">
      <Loader2 className="size-4 animate-spin text-ai" aria-hidden />
      {already ? "이미 정리하고 있어요" : "공고 요건 정리 중"}
    </p>
  ) : failure ? (
    <AiErrorNotice
      {...failure}
      size="inline"
      requestPath
      rerunLabel={opts.rerunLabel}
      reduceTarget="공고 원문"
      refusal={refusal}
      lockEntry="draft"
      inputHref={opts.jdEditFrom ? routes.coverLetter(applicationProjectId, { tab: "jd", edit: 1, ...opts.jdEditFrom }) : undefined}
      inputLabel="공고 원문 고치기"
      onRetry={() => {
        const next = lastNext.current
        const shown = failure
        if (!next) return
        void run(next).then(async (r) => {
          if (isAiRejected(r)) {
            const code = await refusalOf(r)
            setFailure((f) => f ?? shown)
            setRefusal(code)
          }
        })
      }}
    />
  ) : null

  return { busy, needed, run, slot }
}

