"use client"

/**
 * S-14 자기소개서 추가 — **2단계 모달** (`AddApplicationDialog`, UX v5.21 S-14 / design-system 5.6.2,
 * CF-8·CF-10·CF-A7·CF-A16 · JR-1·JR-2·JR-6). v5.18까지의 전체 페이지 `/applications/new`를 대체한다.
 *
 * (v5.21, JR-1·JR-2) **모달에서 AI가 돌지 않는다** — 키 유무·동의·키 상태와 관계없이 하나의 모양이다.
 * ① JD 입력: 공고 URL **또는** 직접 입력 → [다음] = URL이면 서버 가져오기(`{rawText}`만, AI 아님)를 기다리고,
 *    직접 입력이면 서버 요청 없이 바로 ②로 `[가정]`.
 * ② 지원 기업 / 포지션: 지원 기업·지원 포지션·**마감일**(일 단위, 포지션 아래 `[가정]`)은 빈 칸에서 시작해 사용자가
 *    직접 입력하고(모두 선택), 공고 내용만 필수. [자기소개서 작성] = 생성(`source_url`·`deadline` 함께) → S-46
 *    문항 설정 상태. 보드에서 열었으면 라벨이 "추가하기"이고 보드에 남는다.
 *    (JR-6) AI가 연결돼 있으면 생성 직후 인사이트가 자동으로 시작되므로 버튼 위에 안내 한 줄 + C-19 배지.
 *
 * (58 런) 틀은 공통 `FormDialog`(S-08 커리어 추가 모달과 같은 틀 — 폭 602 · 데스크톱 고정 높이, 두 단계 같은 크기)이고,
 * 칸은 공통 `FormSection`·`FormField`·`FormFieldError`다. 단계 표시는 두지 않는다(시안 1).
 *
 * 작성 중 자동 저장 없음: 입력이 있는 채로 닫으면 확인 한 줄 "입력한 내용이 사라져요". (v5.21) 모달이 C-21·키 교체로
 * 떠나는 길이 없어져 브라우저 세션 입력 보존도 없앴다.
 */
import { cn } from "@/lib/utils"
import { DocTextarea } from "@/components/common/doc-markdown-editor"
import * as React from "react"
import { useRouter } from "next/navigation"
import { CloudAlert, Info, Sparkles, TriangleAlert, X } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  FormDialog,
  FormDialogBody,
  FormDialogFooter,
  FormDialogForm,
  FormDialogHeader,
  FormDialogSubmit,
  FormField,
  FormFieldError,
  FormSection,
} from "@/components/common/form-dialog"
import { CharCount } from "@/components/common/input-guide"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import { useAiConnection } from "@/components/common/ai-connection-context"
import { ProviderBadge } from "@/components/common/provider-badge"
import { setNavOrigin } from "@/components/common/return-target"
import { getDataReadinessAction } from "@/lib/data/actions"
import { JD_FETCH_FAILED_MESSAGE } from "@/lib/data/cover-letter-copy"
import {
  JD_LONG_WARNING,
  JD_NO_SENTENCES_MESSAGE,
  JD_RAW_TEXT_EDITABLE_NOTE,
  JD_RAW_TEXT_LONG,
  JD_RAW_TEXT_MAX,
  JD_RAW_TEXT_SHORT,
  JD_SHORT_WARNING,
} from "@/lib/data/jd-raw-text"
import { routes } from "@/lib/routes"
import { createApplicationAction, fetchJobPostingAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"

/** v5.3 S-14: 지원 기업·지원 포지션 각 200자 (구현 값 `[가정]`) */
const FIELD_MAX = 200
/** URL은 2,048자까지 `[가정]` (UX S-14 입력 검사) */
const URL_MAX = 2_048

/** (v5.21, JR-6) [자기소개서 작성] 위 안내 — AI가 연결돼 있을 때만 (`[가정]` 문구 그대로) */
export const AUTO_INSIGHT_NOTE = "만들면 인사이트를 바로 만들기 시작해요"

type Phase = "idle" | "fetching" | "creating"

export interface AddApplicationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** S-39 "지원 전" 열 "+"로 열었으면 true — 주 버튼 "추가하기", 생성 뒤 보드에 남는다 */
  fromBoard?: boolean
  /** `?state=` 미리 보기: 모달을 그 단계·그 실패 모양으로 연다 */
  previewState?: string | null
}

export function AddApplicationDialog({ open, onOpenChange, fromBoard = false, previewState = null }: AddApplicationDialogProps) {
  const router = useRouter()
  const previewWrite = usePreviewWriteGuard()
  const connection = useAiConnection()
  // (JR-6) "연결됨" = 활성 공급자 있음 · 키 무효 아님 · 동의 필요 없음 (`needs_check`는 연결됨) `[가정]`
  const aiConnected = Boolean(connection?.active_provider) && connection?.key_status !== "invalid" && !connection?.consent_required
  // UQ-617 `[UI-가정]`: the create action skips the auto-start when D-01 is not met (`insufficient_data`), so the line is
  // shown only once readiness says the insight can run (read when the dialog opens; unknown → hidden)
  const [insightReady, setInsightReady] = React.useState<boolean | null>(null)
  React.useEffect(() => {
    if (!open || !aiConnected) return
    let alive = true
    void getDataReadinessAction()
      .then((r) => alive && setInsightReady(r.features.insight.ready))
      .catch(() => alive && setInsightReady(null))
    return () => {
      alive = false
    }
  }, [open, aiConnected])
  const autoInsight = aiConnected && insightReady === true

  // --- `?state=` 미리 보기 ---------------------------------------------------
  const pv = previewState
  const step2Preview = Boolean(pv && STEP2_STATES.includes(pv))
  const [step, setStep] = React.useState<0 | 1>(() => (step2Preview ? 1 : 0))
  const [url, setUrl] = React.useState("")
  const [direct, setDirect] = React.useState(() => (step2Preview ? MOCK_PASTED : ""))
  const [company, setCompany] = React.useState("")
  const [position, setPosition] = React.useState("")
  const [deadline, setDeadline] = React.useState("")
  // 가져오기 실패는 공고 내용 칸을 비운 채 연다 (S-14 "가져오기 실패 안내")
  const [raw, setRaw] = React.useState(() => (step2Preview && pv !== "fetch-failed" ? MOCK_PASTED : ""))
  const [phase, setPhase] = React.useState<Phase>(() => previewPhase(pv))
  const [fetchFailed, setFetchFailed] = React.useState(pv === "fetch-failed")
  const [createFailed, setCreateFailed] = React.useState(pv === "create-failed")
  const [invalidUrlRefused, setInvalidUrlRefused] = React.useState(pv === "invalid-source-url")
  const [noSentences, setNoSentences] = React.useState(pv === "jd-no-sentences")
  const [closeConfirm, setCloseConfirm] = React.useState(pv === "close-confirm")
  const [urlTouched, setUrlTouched] = React.useState(false)

  // 단계가 바뀌면 포커스를 옮긴다 (UQ-746): ②로 가면 ② 첫 칸(지원 기업), ①로 돌아오면 쓰던 입력칸.
  // 누른 버튼이 사라져 포커스가 다이얼로그로 떨어지면 화면 낭독기가 단계 전환을 알기 어렵다.
  const stepRef = React.useRef(step)
  React.useEffect(() => {
    if (stepRef.current === step) return
    stepRef.current = step
    const id = step === 1 ? "add-ap-company" : document.getElementById("add-ap-url")?.hasAttribute("disabled") ? "add-ap-direct" : "add-ap-url"
    const t = window.setTimeout(() => document.getElementById(id)?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [step])

  const urlTrimmed = url.trim()
  const directTrimmed = direct.trim()
  const rawTrimmed = raw.trim()
  const urlInvalid = urlTrimmed.length > 0 && !/^https?:\/\/\S+$/i.test(urlTrimmed)
  const busy = phase !== "idle"

  const anyInput = Boolean(urlTrimmed || directTrimmed || rawTrimmed || company.trim() || position.trim() || deadline)

  const reset = () => {
    setStep(0)
    setUrl("")
    setDirect("")
    setCompany("")
    setPosition("")
    setDeadline("")
    setRaw("")
    setPhase("idle")
    setFetchFailed(false)
    setCreateFailed(false)
    setInvalidUrlRefused(false)
    setNoSentences(false)
    setUrlTouched(false)
  }

  const close = (next: boolean) => {
    if (next) return onOpenChange(true)
    // 아무것도 입력하지 않았으면 확인 없이 닫는다
    if (anyInput && !busy) return setCloseConfirm(true)
    reset()
    onOpenChange(false)
  }

  // --- ① [다음] -------------------------------------------------------------
  /** (v5.21, JR-1·JR-2) URL이면 가져오기만 기다린다 — 성공·실패 모두 ②로. 직접 입력이면 서버 요청 없이 ②로 `[가정]` */
  const goNext = async () => {
    if (!urlTrimmed) {
      setFetchFailed(false)
      setRaw(directTrimmed ? direct : "")
      setStep(1)
      return
    }
    setPhase("fetching")
    const got = await fetchJobPostingAction(urlTrimmed).catch(() => null)
    // 실패 코드 5종을 화면에서 나누지 않는다 (CF-10) — ②로 가서 직접 붙여넣게 한다.
    // 지원 기업·포지션·마감일은 가져오기 결과와 관계없이 빈 칸에서 시작한다 (JR-2, 응답 `{rawText}`만)
    setFetchFailed(!got)
    setRaw(got ? got.rawText : "")
    setPhase("idle")
    setStep(1)
  }

  const submitStep1 = (e: React.FormEvent) => {
    e.preventDefault()
    setUrlTouched(true)
    if (urlInvalid || (!urlTrimmed && !directTrimmed) || busy) return
    // 직접 입력은 서버를 부르지 않아 미리 보기에서도 그대로 ②로 간다
    if (urlTrimmed && previewWrite.stop()) return
    void goNext()
  }

  // --- ② [자기소개서 작성] --------------------------------------------------
  const create = async (opts: { withoutUrl?: boolean } = {}) => {
    setCreateFailed(false)
    setInvalidUrlRefused(false)
    setNoSentences(false)
    setPhase("creating")
    const result = await createApplicationAction({
      raw_text: raw,
      name: null,
      deadline: deadline || null,
      company_name: company.trim() || null,
      position_title: position.trim() || null,
      source_url: opts.withoutUrl ? null : urlTrimmed || null,
    }).catch(() => null)

    // 입력 거부(400)는 값으로 온다 — 던진 오류는 Server Action 경계에서 `code`를 잃는다
    if (result && "refused" in result) {
      setPhase("idle")
      if (result.refused === "jd_no_sentences") setNoSentences(true)
      else setInvalidUrlRefused(true)
      return
    }
    if (!result) {
      setPhase("idle")
      setCreateFailed(true)
      return
    }
    const id = result.id
    reset()
    onOpenChange(false)
    if (fromBoard) {
      // S-39에 남고 "열기" 토스트 (기존 동작 유지)
      toast.success("자기소개서를 추가했어요", {
        action: {
          label: "열기",
          onClick: () => {
            setNavOrigin("board", id)
            router.push(routes.coverLetter(id))
          },
        },
      })
      router.refresh()
    } else {
      // (JR-6) 자동 시작한 인사이트는 S-46이 진행 중 작업으로 읽어 "인사이트를 만드는 중이에요"를 보인다 (FL-10)
      router.push(routes.coverLetter(id))
    }
  }

  const submitStep2 = (e: React.FormEvent) => {
    e.preventDefault()
    if (!rawTrimmed || busy) return
    if (previewWrite.stop()) return
    void create()
  }

  const primaryLabel = fromBoard ? "추가하기" : "자기소개서 작성"
  const nextLabel = phase === "fetching" ? "공고를 가져오는 중" : "다음"

  return (
    <>
      {/* 공통 입력 모달 틀 (`FormDialog` — S-08 커리어 추가 모달과 같은 틀: 폭 602 · 모서리 20 · 데스크톱 고정 높이).
          시안 1의 모달 폭(그림 836px ÷ 1.39)이 이 틀이다. 두 단계 모두 같은 크기다 */}
      <FormDialog open={open} onOpenChange={close}>
        <FormDialogForm id={step === 0 ? "add-ap-step1" : "add-ap-step2"} onSubmit={step === 0 ? submitStep1 : submitStep2}>
          <FormDialogHeader
            title="자기소개서 추가"
            description={step === 0 ? "1단계 JD 입력 — 공고 URL 또는 공고 내용을 넣어 주세요" : "2단계 지원 기업 / 포지션 — 기업·포지션과 공고 내용을 확인해 주세요"}
          />

          <FormDialogBody>
            {step === 0 ? (
              <FormSection title="JD 입력" fill>
                <FormField id="add-ap-url" label="포지션 공고" error={urlTouched && urlInvalid ? "공고 주소를 확인해 주세요" : undefined}>
                  <Input
                    id="add-ap-url"
                    type="url"
                    inputMode="url"
                    placeholder="https://www.jd.com"
                    value={url}
                    maxLength={URL_MAX}
                    disabled={busy || directTrimmed.length > 0}
                    aria-invalid={urlTouched && urlInvalid ? true : undefined}
                    aria-describedby={urlTouched && urlInvalid ? "add-ap-url-error" : "add-ap-exclusive"}
                    onChange={(e) => setUrl(e.target.value)}
                    onBlur={() => setUrlTouched(true)}
                  />
                  {/* [UI-가정] 배타 안내 — 상시 줄 대신 화면 낭독기용 설명으로만 (시안에 보조 문구 없음) */}
                  <span id="add-ap-exclusive" className="sr-only">
                    URL과 직접 입력은 하나만 쓸 수 있어요
                  </span>
                </FormField>
                {/* 마지막 칸이 남은 높이를 채운다 (커리어 모달의 내용 칸과 같은 방식) */}
                <FormField id="add-ap-direct" label="직접 입력" fill>
                  <Textarea
                    id="add-ap-direct"
                    className="min-h-48 flex-1 resize-none text-base leading-[1.75]"
                    placeholder="포지션 공고 내용을 입력해주세요."
                    value={direct}
                    disabled={busy || urlTrimmed.length > 0}
                    aria-describedby="add-ap-exclusive"
                    onChange={(e) => setDirect(e.target.value)}
                  />
                  <InputChecks text={directTrimmed} />
                </FormField>
              </FormSection>
            ) : (
              <>
                {/* 상황이 생겼을 때만 — 입력 거부·만들기 실패 */}
                {invalidUrlRefused ? (
                  <div className="space-y-1">
                    {/* `invalid_source_url`(400) — AI 실패가 아니라 입력 거부라 C-20을 쓰지 않는다 `[UI-가정]` */}
                    <FormFieldError id="add-ap-source-url-error" message="공고 주소를 저장할 수 없어요" />
                    {/* [UI-가정] 주소만 빼고 다시 보낸다 (입력 유지) */}
                    <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => void create({ withoutUrl: true })}>
                      주소 없이 만들기
                    </Button>
                  </div>
                ) : null}
                {createFailed ? <FormFieldError id="add-ap-create-error" message="만들지 못했어요. 다시 시도해 주세요" /> : null}

                <FormSection title="지원 기업 / 포지션">
                  {/* (JR-2) 모두 선택 · 빈 칸에서 시작해 직접 입력한다 */}
                  <FormField id="add-ap-company" label="지원 기업">
                    <Input id="add-ap-company" placeholder="기업 명" value={company} maxLength={FIELD_MAX} onChange={(e) => setCompany(e.target.value)} />
                  </FormField>
                  <FormField id="add-ap-position" label="지원 포지션">
                    <Input id="add-ap-position" placeholder="포지션 명" value={position} maxLength={FIELD_MAX} onChange={(e) => setPosition(e.target.value)} />
                  </FormField>
                  {/* (v5.21, JR-2) 마감일 — 일 단위(CF-4), 선택. 자리는 지원 포지션 아래 `[가정]`, "비우기" 가능 `[가정]`.
                      입력 모양은 S-46 머리 마감일과 같다 (날짜 칸 + 비우기) */}
                  <FormField id="add-ap-deadline" label="마감일">
                    <div className="flex items-center gap-1">
                      <Input
                        id="add-ap-deadline"
                        type="date"
                        className="w-[11rem]"
                        value={deadline}
                        disabled={busy}
                        onChange={(e) => setDeadline(e.target.value)}
                      />
                      {deadline ? (
                        <Button type="button" variant="ghost" size="icon-xs" aria-label="마감일 비우기" disabled={busy} onClick={() => {
                            setDeadline("")
                            // UQ-618: the × disappears — keep focus on the date field
                            document.getElementById("add-ap-deadline")?.focus()
                          }}>
                          <X aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </FormField>
                </FormSection>

                <FormSection title="공고 내용" fill>
                  {fetchFailed ? (
                    <Alert variant="warning">
                      <CloudAlert aria-hidden />
                      <AlertTitle className="font-normal">{JD_FETCH_FAILED_MESSAGE}</AlertTitle>
                    </Alert>
                  ) : null}
                  <FormField
                    id="add-ap-raw"
                    fill
                    label={
                      <>
                        직접 입력
                        <span className="sr-only">(필수)</span>
                      </>
                    }
                  >
                    <div className="group/raw flex min-h-0 flex-1 flex-col gap-2">
                      {/* (2026-11-10) 가져온 공고는 마크다운이라 같은 공통 마크다운 편집기로 보인다 — 공통 Textarea와 같은 테두리 틀.
                          편집기는 사용자가 고치기 전에는 값을 다시 내보내지 않아(emitUpdate:false) 가져온 원문 그대로 저장된다 */}
                      <div
                        className={cn(
                          "flex min-h-48 flex-1 flex-col overflow-y-auto rounded-control border border-input bg-transparent px-2.5 py-2 transition-colors dark:bg-input/30",
                          busy && "cursor-not-allowed bg-input/50 opacity-50",
                          noSentences && "border-destructive",
                        )}
                      >
                        <DocTextarea
                          id="add-ap-raw"
                          placeholder="포지션 공고 내용을 입력해주세요."
                          value={raw}
                          readOnly={busy}
                          aria-invalid={noSentences ? true : undefined}
                          aria-describedby={noSentences ? "add-ap-raw-error add-ap-raw-note" : "add-ap-raw-note"}
                          onValueChange={(v) => {
                            setRaw(v)
                            setNoSentences(false)
                          }}
                          grow
                          className="mx-0 min-h-0 flex-1 px-0 py-0 hover:bg-transparent"
                        />
                      </div>
                      {/* (v5.21) `jd_no_sentences`(400) — 공고 내용 칸 아래, 입력 유지 */}
                      {noSentences ? <FormFieldError id="add-ap-raw-error" message={JD_NO_SENTENCES_MESSAGE} /> : null}
                      <InputChecks text={rawTrimmed} />
                      {/* (v5.21, JR-7) 공고 원문 안내 — 스펙대로 공고 내용 칸 아래에 늘 보인다 (UQ-619) */}
                      <p id="add-ap-raw-note" className="flex items-start gap-1.5 text-sm text-muted-foreground">
                        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        {JD_RAW_TEXT_EDITABLE_NOTE}
                      </p>
                    </div>
                  </FormField>
                </FormSection>
              </>
            )}
          </FormDialogBody>

          <FormDialogFooter className={step === 1 ? "items-start justify-between" : "items-start"}>
            {step === 1 ? (
              // 시안에 없지만 ①로 돌아가는 길은 남긴다 (입력 유지) `[UI-가정]`
              <Button type="button" variant="muted-ghost" disabled={busy} onClick={() => setStep(0)}>
                이전
              </Button>
            ) : null}
            <div className="flex flex-col items-end gap-1.5">
              {step === 1 && autoInsight ? (
                // (v5.21, JR-6) 생성 직후 인사이트가 자동으로 시작된다 — 공급자 토큰을 쓰므로 미리 알린다 (NFR-AI-08) `[가정]`
                <p className="flex flex-wrap items-center justify-end gap-1.5 text-sm text-muted-foreground" id="add-ap-auto-insight">
                  <Sparkles className="size-3.5 text-ai" aria-hidden />
                  {AUTO_INSIGHT_NOTE}
                  <ProviderBadge connection={connection} />
                </p>
              ) : null}
              {step === 0 ? (
                <FormDialogSubmit pending={busy} disabled={urlInvalid || (!urlTrimmed && !directTrimmed)}>
                  {nextLabel}
                </FormDialogSubmit>
              ) : (
                <FormDialogSubmit pending={phase === "creating"} disabled={!rawTrimmed} aria-describedby={autoInsight ? "add-ap-auto-insight" : undefined}>
                  {phase === "creating" ? "만드는 중…" : primaryLabel}
                </FormDialogSubmit>
              )}
            </div>
          </FormDialogFooter>
        </FormDialogForm>
      </FormDialog>

      {/* 닫기 확인 — 긴 공고를 붙여넣은 뒤 실수로 닫는 일이 잦다 (v5.21 문구 "입력한 내용이 사라져요" `[가정]`) */}
      <AlertDialog open={closeConfirm} onOpenChange={setCloseConfirm}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>입력한 내용이 사라져요</AlertDialogTitle>
            {/* [UI-가정] 화면 낭독기용 설명 (스펙은 한 줄) */}
            <AlertDialogDescription className="sr-only">지금 닫으면 입력한 공고가 남지 않아요</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="destructive-ghost"
              onClick={() => {
                setCloseConfirm(false)
                reset()
                onOpenChange(false)
              }}
            >
              닫기
            </Button>
            <AlertDialogCancel asChild>
              <Button>계속 작성</Button>
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * 공고 칸 아래 줄 — 길이 경고(짧음·김, 막지 않는다)와 글자 수. 시안에 상시 보조 줄이 없으므로 **문제가 있을 때만**
 * (경고가 있거나 상한의 90%를 넘었을 때) 보인다 `[UI-가정]`.
 */
function InputChecks({ text }: { text: string }) {
  const warn = text.length > 0 && (text.length < JD_RAW_TEXT_SHORT || text.length > JD_RAW_TEXT_LONG)
  const near = text.length >= JD_RAW_TEXT_MAX * 0.9
  if (!warn && !near) return null
  return (
    <div className="flex items-start justify-between gap-2">
      <LengthWarning text={text} />
      {near ? <CharCount count={text.length} limit={JD_RAW_TEXT_MAX} /> : <span />}
    </div>
  )
}

/** S-14 입력 검사 — 경고만, 막지 않는다 */
function LengthWarning({ text }: { text: string }) {
  const message = text.length === 0 ? null : text.length < JD_RAW_TEXT_SHORT ? JD_SHORT_WARNING : text.length > JD_RAW_TEXT_LONG ? JD_LONG_WARNING : null
  if (!message) return <span />
  return (
    <p className="flex items-start gap-1.5 text-sm text-warning-subtle-foreground">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
      {message}
    </p>
  )
}

// ---------------------------------------------------------------------------
// `?state=` 미리 보기 (v5.21: `extracting`·`extract-failed`·`key-invalid`·`ai-failed-key-invalid` 삭제,
// `jd-no-sentences` 추가)
// ---------------------------------------------------------------------------

const STEP2_STATES = ["step2", "fetch-failed", "creating", "create-failed", "invalid-source-url", "jd-no-sentences"]
const MOCK_PASTED = [
  "[그린뱅크] 결제 백엔드 엔지니어 채용",
  "주요 업무",
  "- 결제·정산 서비스의 API 설계와 운영을 맡습니다.",
  "자격 요건",
  "- 백엔드 개발 경력 5년 이상",
].join("\n")

function previewPhase(state: string | null): Phase {
  if (state === "fetching") return "fetching"
  if (state === "creating") return "creating"
  return "idle"
}
