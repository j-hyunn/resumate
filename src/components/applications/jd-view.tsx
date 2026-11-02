"use client"

/**
 * S-15 JD·요건 (F-P2-02): 왼쪽 "공고 원문"(문장 하이라이트) / 오른쪽 요건 목록(카테고리별, 핵심 배지,
 * 직접 수정 표시) + 기술 키워드. 요건마다 원문 문장(source_sids)이 연결된다.
 * 요건 수정(F-P2-03)은 Could라 MVP에서 읽기 전용.
 */
import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Loader2, PenLine, TextSearch } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { AiErrorNotice } from "@/components/common/ai-error-notice"
import { AiLock } from "@/components/common/ai-lock"
import { AiRunButton } from "@/components/common/ai-run-button"
import { useAiConnection } from "@/components/common/ai-connection-context"
import { isAiRejected } from "@/components/common/ai-rejection"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import { isInputCausedFailure } from "@/lib/data/ai-errors"
import { refusalOf } from "./extract-first"
import { JdRawEditButton, JdRawEditor, JdRawSavedNote, useJdRawEdit } from "./jd-raw-edit"
import type { AiErrorCode, AiJob, AiRetryRefusalCode, JdRequirement, JdSentence } from "@/types/db"
import { cn } from "@/lib/utils"
import { IMPORTANCE_HIGH_LABEL, REQUIREMENT_CATEGORY_LABELS, REQUIREMENT_CATEGORY_ORDER } from "./labels"
import { retryJdExtractionAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"

/** "started here" marker for the running view (UQ-530); keeps `from` so the return link survives */
function useExtractingUrl() {
  const pathname = usePathname()
  const params = useSearchParams()
  return () => {
    const next = new URLSearchParams(params.toString())
    next.set("extracting", "self")
    return `${pathname}?${next.toString()}`
  }
}

/** S-15 수정 중: "요건 정리하기" 자리 (명세 문구) */
function SaveFirstNote() {
  return <p className="text-sm text-muted-foreground">저장한 뒤 정리할 수 있어요</p>
}

export function JdView({
  applicationProjectId,
  previewSave = null,
  rawText,
  sentences,
  requirements,
  techKeywords,
  seniority,
  requirementsSlot,
}: {
  applicationProjectId: string
  /** `?state=raw-*` previews of the save */
  previewSave?: "ok" | "failed" | "refused" | null
  /** job_descriptions.raw_text — shown as is; sentences are highlighted by start/end offsets (C-2, A3 UQ-73) */
  rawText: string
  sentences: JdSentence[]
  requirements: JdRequirement[]
  techKeywords: Array<{ keyword: string; source_sids: string[] }>
  seniority: string | null
  /**
   * 요건 영역 replacement while there are no requirements yet (v4): C-18 영역형 / "요건 정리하기" /
   * C-20 block / 분석 중. The 공고 원문 panel always stays (02 S-15 v5).
   */
  requirementsSlot?: React.ReactNode
}) {
  const [active, setActive] = React.useState<{ key: string; sids: string[] } | null>(null)
  const sentenceRefs = React.useRef<Record<string, HTMLSpanElement | null>>({})
  const edit = useJdRawEdit()

  const show = (key: string, sids: string[]) => {
    setActive((cur) => (cur?.key === key ? null : { key, sids }))
    const first = sids[0] && sentenceRefs.current[sids[0]]
    if (first) first.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="gap-3 p-5 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg leading-7 font-semibold">공고 원문</h2>
          <JdRawEditButton />
        </div>
        <JdRawSavedNote />
        {edit.editing ? (
          <JdRawEditor applicationProjectId={applicationProjectId} rawText={rawText} previewSave={previewSave} />
        ) : (
        <p className="text-base leading-[1.75] whitespace-pre-wrap">
          {segments(rawText, sentences).map((seg, i) => {
            if (!seg.sid) return <React.Fragment key={`t${i}`}>{seg.text}</React.Fragment>
            const sid = seg.sid
            const on = active?.sids.includes(sid)
            return (
              <span
                key={sid}
                ref={(el) => {
                  sentenceRefs.current[sid] = el
                }}
                className={cn("rounded-sm transition-colors", on && "bg-ai-subtle text-ai-subtle-foreground")}
              >
                {on ? <mark className="bg-transparent text-inherit">{seg.text}</mark> : seg.text}
              </span>
            )
          })}
        </p>
        )}
      </Card>

      {requirementsSlot ? (
        <div className="space-y-6">{requirementsSlot}</div>
      ) : (
      <div className="space-y-6">
        {seniority ? (
          <p className="text-sm text-muted-foreground">
            경력 조건: <span className="text-foreground">{seniority}</span>
          </p>
        ) : null}
        {REQUIREMENT_CATEGORY_ORDER.map((cat) => {
          const items = requirements.filter((r) => r.category === cat)
          return (
            <section key={cat} className="space-y-2" aria-labelledby={`req-${cat}`}>
              <h2 id={`req-${cat}`} className="text-base leading-6 font-semibold">
                {REQUIREMENT_CATEGORY_LABELS[cat]} <span className="text-sm font-normal text-muted-foreground tabular-nums">{items.length}</span>
              </h2>
              {items.length === 0 ? (
                // [UI-가정] 카테고리 빈 상태 문구
                <p className="text-sm text-muted-foreground">공고에서 찾지 못했어요</p>
              ) : (
                <ul className="divide-y rounded-lg border bg-card">
                  {items.map((r) => (
                    <li key={r.id} className="flex items-start gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="flex flex-wrap items-center gap-2">
                          {r.importance === "high" ? <Badge variant="secondary">{IMPORTANCE_HIGH_LABEL}</Badge> : null}
                          <span>{r.content}</span>
                          {r.origin === "user" || r.is_user_edited ? (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <PenLine className="size-3" aria-hidden />
                              직접 수정
                            </span>
                          ) : null}
                        </p>
                        {r.keywords.length ? <p className="text-sm text-muted-foreground">{r.keywords.join(", ")}</p> : null}
                      </div>
                      {r.source_sids.length ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-pressed={active?.key === r.id}
                          onClick={() => show(r.id, r.source_sids)}
                          aria-label={`${r.content} 원문 문장 보기`}
                        >
                          <TextSearch aria-hidden />
                          원문
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
        <section className="space-y-2" aria-labelledby="req-tech">
          <h2 id="req-tech" className="text-base leading-6 font-semibold">
            기술 키워드
          </h2>
          {techKeywords.length === 0 ? (
            <p className="text-sm text-muted-foreground">공고에서 찾지 못했어요</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {techKeywords.map((k) => (
                <button
                  key={k.keyword}
                  type="button"
                  onClick={() => show(`kw-${k.keyword}`, k.source_sids)}
                  aria-pressed={active?.key === `kw-${k.keyword}`}
                  className="focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Badge variant="secondary" className="h-7 px-2.5 text-sm">
                    {k.keyword}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      )}
    </div>
  )
}

/** raw_text split into plain gaps and sentence spans by offsets (falls back to sentence text if offsets don't fit) */
function segments(raw: string, sentences: JdSentence[]): Array<{ sid: string | null; text: string }> {
  const sorted = [...sentences].sort((a, b) => a.start - b.start)
  const valid = sorted.every((s, i) => s.start >= 0 && s.end <= raw.length && s.start <= s.end && (i === 0 || s.start >= sorted[i - 1].end))
  if (!valid) return sorted.flatMap((s) => [{ sid: s.sid, text: s.text }, { sid: null, text: "\n" }])
  const out: Array<{ sid: string | null; text: string }> = []
  let pos = 0
  for (const s of sorted) {
    if (s.start > pos) out.push({ sid: null, text: raw.slice(pos, s.start) })
    out.push({ sid: s.sid, text: raw.slice(s.start, s.end) })
    pos = s.end
  }
  if (pos < raw.length) out.push({ sid: null, text: raw.slice(pos) })
  return out
}

/**
 * AI-01 실패 → C-20 block in the 요건 영역 (not_a_jd → "채용 공고가 아닌 텍스트로 보여요"). v5.3: request
 * path (A14 countdown "{N}초 뒤 다시 보낼 수 있어요"), input-caused failures have no retry (R-69) —
 * "고친 뒤 요건 정리하기로 새로 실행해 주세요". The retry is a **new** extraction on the active provider.
 * Q53-2: an editable JD's C-20 button is "공고 원문 고치기" (C-20 "입력 원인 실패의 이동"); the cause line
 * stays until the save.
 */
export function ExtractionFailed({
  applicationProjectId,
  code,
  job,
  previewRefusal = null,
  rerunnable = true,
}: {
  applicationProjectId: string
  code: AiErrorCode
  /** false: `succeeded` + 요건 0개 — begin_jd_extraction refuses `succeeded`, so only the text edit moves on (Q53-11) */
  rerunnable?: boolean
  /** failed ai_jobs row (provider / retry_after / quota_resets_at) */
  job?: Pick<AiJob, "provider" | "retry_after" | "quota_resets_at"> | null
  /** `?state=retry-*` preview of a refused retry */
  previewRefusal?: AiRetryRefusalCode | null
}) {
  const router = useRouter()
  const extractingUrl = useExtractingUrl()
  const edit = useJdRawEdit()
  const previewWrite = usePreviewWriteGuard()
  const [retrying, setRetrying] = React.useState(false)
  const [refusal, setRefusal] = React.useState<AiRetryRefusalCode | null>(previewRefusal)
  const [already, setAlready] = React.useState(false)
  const retry = async () => {
    if (previewWrite.stop()) return
    setRefusal(null)
    setRetrying(true)
    const r = await retryJdExtractionAction(applicationProjectId)
    if (isAiRejected(r)) {
      setRefusal(await refusalOf(r))
      setRetrying(false)
      return
    }
    if (typeof r === "object" && "already" in r) setAlready(true)
    router.replace(extractingUrl())
    router.refresh()
  }
  const inputCaused = isInputCausedFailure(code)
  // [UI-가정] previews without a job: request-path wait of 20 s (A14 mock default)
  const [fallbackWait] = React.useState(() => new Date(Date.now() + 20_000).toISOString())
  return (
    <div className="space-y-2">
      <AiErrorNotice
        code={code}
        provider={job?.provider}
        retryAfter={job?.retry_after ?? (code === "rate_limited" || code === "provider_unavailable" ? fallbackWait : null)}
        quotaResetsAt={job?.quota_resets_at}
        onRetry={inputCaused ? undefined : () => void retry()}
        retrying={retrying}
        refusal={refusal}
        lockEntry="requirements"
        requestPath
        rerunLabel="요건 정리하기"
        reduceTarget="공고 원문"
        onFocusInput={edit.editable && !edit.editing ? edit.start : undefined}
        inputLabel="공고 원문 고치기"
      />
      {/*
        UQ-513: input-caused failures have no "다시 시도" (R-69) — the run button "요건 정리하기" (+ C-19)
        starts a new extraction instead of a dead end. 수정 중에는 비활성 (Q53-2).
      */}
      {inputCaused && !already && rerunnable ? (
        retrying ? (
          <ExtractingLine />
        ) : (
          <>
            <AiRunButton
              lock={{ entry: "requirements" }}
              variant="outline"
              disabled={edit.editing}
              onRun={async () => {
                if (previewWrite.stop()) return undefined
                const r = await retryJdExtractionAction(applicationProjectId)
                if (isAiRejected(r)) return r
                setRetrying(true)
                if (typeof r === "object" && "already" in r) setAlready(true)
                router.replace(extractingUrl())
                router.refresh()
                return undefined
              }}
            >
              요건 정리하기
            </AiRunButton>
            {edit.editing ? <SaveFirstNote /> : null}
          </>
        )
      ) : null}
      {already ? <ExtractingLine already /> : null}
    </div>
  )
}

/** "공고 요건 정리 중" spinner in the run button's place; "이미 정리하고 있어요" when another path runs it (02 S-15 v5.3) */
export function ExtractingLine({ already = false }: { already?: boolean }) {
  return (
    <p className="flex items-center gap-2 text-sm font-medium text-ai-subtle-foreground" role="status">
      <Loader2 className="size-4 animate-spin text-ai" aria-hidden />
      {already ? "이미 정리하고 있어요" : "공고 요건 정리 중"}
    </p>
  )
}

/**
 * v4: JD registered without a key (extraction pending, no job) → C-18 영역형, or "요건 정리하기"
 * once a key is connected (02 C-18 진입점 "요건 정리하기 (S-15)"). Raw text stays visible below.
 * v5.3: while the request runs the button's place shows "공고 요건 정리 중"; a start refusal goes back to
 * AiRunButton (C-18 / C-21 / key_invalid).
 */
export function RunExtraction({
  applicationProjectId,
  unknownFailure = false,
}: {
  applicationProjectId: string
  /** S-15 "원인을 알 수 없는 실패" (실패 기록이 정리됨, 04 §2.6.1): no edit button, 다시 정리만 */
  unknownFailure?: boolean
}) {
  const router = useRouter()
  const extractingUrl = useExtractingUrl()
  const connection = useAiConnection()
  const edit = useJdRawEdit()
  const previewWrite = usePreviewWriteGuard()
  const [pending, setPending] = React.useState<false | "running" | "already">(false)
  if (connection && !connection.active_provider)
    return <AiLock entry="requirements" size="area" featureLabel="요건 정리" alternativeNote="공고 원문은 그대로 볼 수 있어요" />
  return (
    <Card className="max-w-xl gap-3 p-5">
      <h2 className="text-lg leading-7 font-semibold">요건 정리 전</h2>
      {/* D-30: 키를 연결해도 자동으로 추출하지 않음 — 사용자가 누를 때만 */}
      <p className="text-base text-muted-foreground">
        {unknownFailure ? "요건을 정리하지 못했어요. 다시 정리해 보세요" : "공고에서 주요 업무·자격요건·우대사항을 정리해 드려요"}
      </p>
      {pending ? (
        <ExtractingLine already={pending === "already"} />
      ) : (
        <AiRunButton
          lock={{ entry: "requirements" }}
          disabled={edit.editing}
          onRun={async () => {
            if (previewWrite.stop()) return undefined
            const r = await retryJdExtractionAction(applicationProjectId)
            if (isAiRejected(r)) return r
            setPending(typeof r === "object" && "already" in r ? "already" : "running")
            edit.clearSaved()
            // UQ-530: mark "started here" so the running view says "공고 요건 정리 중" (not "이미 정리하고 있어요")
            router.replace(extractingUrl())
            router.refresh()
            return undefined
          }}
        >
          요건 정리하기
        </AiRunButton>
      )}
      {edit.editing ? <SaveFirstNote /> : null}
    </Card>
  )
}
