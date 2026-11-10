"use client"

/**
 * S-14 자기소개서 추가 — **2단계 모달** (`AddApplicationDialog`, UX v5.20 S-14 / design-system 5.6.2,
 * CF-8·CF-10·CF-A6·CF-A7·CF-A15·CF-A16·CF-A17). v5.18까지의 전체 페이지 `/applications/new`를 대체한다.
 *
 * ① JD 입력: 공고 URL **또는** 직접 입력 → [다음] = (URL이면) 서버 가져오기 → 미리 보기 추출(AI-01,
 *    행 없음). **Q53-1 게이트는 ①의 [다음]**에서 판정한다(CF-A6) — `consent_required`는 C-21,
 *    `key_status = 'invalid'`는 버튼 아래 C-20. **"AI 없이 계속" 버튼은 두지 않는다(CF-U1).**
 * ② 지원 기업 / 포지션: 기업명·포지션명·공고 내용(채움 순서 AI-01 → `JobPosting` → 빈 칸, CF-A6).
 *    **마감일 칸은 없다**(CF-2 — S-46 머리에서 정한다). [자기소개서 작성] = 생성(`previewJobId`·
 *    `source_url` 함께) → S-46 문항 설정 상태. 보드에서 열었으면 라벨이 "추가하기"이고 보드에 남는다.
 *
 * (58 런) 틀은 공통 `FormDialog`(S-08 커리어 추가 모달과 같은 틀 — 폭 602 · 데스크톱 고정 높이, 두 단계 같은 크기)이고,
 * 칸은 공통 `FormSection`·`FormField`·`FormFieldError`다. 단계 표시는 두지 않는다(시안 1). 좁은 화면은 그 틀 그대로
 * (화면 폭 − 2rem)이다 — 옛 전체 화면 시트(UQ-745)는 커리어 모달과 맞추며 버렸다 `[UI-가정]`.
 *
 * 작성 중 자동 저장 없음(CF-A17): 입력이 있는 채로 닫으면 확인 한 줄. C-21·키 교체로 떠날 때만
 * 브라우저 세션에 입력을 남긴다(`form-draft.ts`의 규칙 그대로, 주소에는 넣지 않는다).
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { CloudAlert, Info, Sparkles, TriangleAlert } from "lucide-react"
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
import { AiErrorNotice } from "@/components/common/ai-error-notice"
import { AiLock } from "@/components/common/ai-lock"
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
import { notifyAiConnectionChanged, useAiConnection } from "@/components/common/ai-connection-context"
import { useAiConsentGate } from "@/components/common/consent-gate"
import { CharCount } from "@/components/common/input-guide"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import { readAiConnectReturn } from "@/components/common/ai-connect-return"
import { setNavOrigin } from "@/components/common/return-target"
import { isAiRejected } from "@/lib/data/ai-errors"
import { JD_FETCH_FAILED_MESSAGE } from "@/lib/data/cover-letter-copy"
import { JD_LONG_WARNING, JD_RAW_TEXT_LONG, JD_RAW_TEXT_MAX, JD_RAW_TEXT_SHORT, JD_SHORT_WARNING } from "@/lib/data/jd-raw-text"
import { routes } from "@/lib/routes"
import { keepsFormDraftOnLeave, previewRefusalAction } from "./form-draft"
import { createApplicationAction, extractJdPreviewAction, fetchJobPostingAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"

/** v5.3 S-14: 지원 기업·지원 포지션 각 200자 (구현 값 `[가정]`) */
const FIELD_MAX = 200
/** URL은 2,048자까지 `[가정]` (UX S-14 입력 검사) */
const URL_MAX = 2_048

type Phase = "idle" | "fetching" | "extracting" | "creating"

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
  const connection = useAiConnection()
  const consent = useAiConsentGate()
  const previewWrite = usePreviewWriteGuard()

  // --- `?state=` 미리 보기 ---------------------------------------------------
  const pv = previewState
  const [step, setStep] = React.useState<0 | 1>(() => (pv && STEP2_STATES.includes(pv) ? 1 : 0))
  const [url, setUrl] = React.useState("")
  const [direct, setDirect] = React.useState(() => (pv && STEP2_STATES.includes(pv) ? MOCK_PASTED : ""))
  const [company, setCompany] = React.useState("")
  const [position, setPosition] = React.useState("")
  const [raw, setRaw] = React.useState(() => (pv && STEP2_STATES.includes(pv) ? MOCK_PASTED : ""))
  const [phase, setPhase] = React.useState<Phase>(() => previewPhase(pv))
  const [fetchFailed, setFetchFailed] = React.useState(pv === "fetch-failed")
  const [previewJobId, setPreviewJobId] = React.useState<string | null>(null)
  const [previewDeadline, setPreviewDeadline] = React.useState<string | null>(null)
  const [requirementCount, setRequirementCount] = React.useState<number | null>(pv === "step2" ? 6 : null)
  /** ②에서 공고 내용을 고쳤는가 — 서버가 원문 해시를 대조하므로 미리 보기가 버려진다 (CF-A17) */
  const [rawEdited, setRawEdited] = React.useState(false)
  const [keyInvalidShown, setKeyInvalidShown] = React.useState(pv === "key-invalid" || pv === "ai-failed-key-invalid")
  /** ② 머리의 C-20 축약 — [다음]의 AI-01이 실패했을 때 (막지 않는다) */
  const [extractFailed, setExtractFailed] = React.useState(pv === "extract-failed")
  const [createFailed, setCreateFailed] = React.useState(pv === "create-failed")
  const [invalidUrlRefused, setInvalidUrlRefused] = React.useState(pv === "invalid-source-url")
  const [closeConfirm, setCloseConfirm] = React.useState(pv === "close-confirm")
  const [restored, setRestored] = React.useState(false)
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

  const keyless = connection !== null && !connection.active_provider
  const keyInvalid = connection?.key_status === "invalid"

  // --- 입력 보존 (C-21·키 교체 왕복만, UX S-14 "입력 보존") ------------------
  React.useEffect(() => {
    if (!open) return
    const d = readFormDraft(fromBoard)
    if (!d) return
    queueMicrotask(() => {
      setUrl(d.url)
      setDirect(d.direct)
      setCompany(d.company)
      setPosition(d.position)
      setRaw(d.raw)
      setStep(d.step === 1 ? 1 : 0)
      setPreviewJobId(d.preview_job_id)
      setPreviewDeadline(d.preview_deadline)
      setRequirementCount(d.requirement_count)
      setRestored(true)
    })
  }, [open, fromBoard])
  React.useEffect(() => {
    if (!open) return
    writeFormDraft(fromBoard, {
      step,
      url,
      direct,
      company,
      position,
      raw,
      preview_job_id: previewJobId,
      preview_deadline: previewDeadline,
      requirement_count: requirementCount,
    })
  }, [open, fromBoard, step, url, direct, company, position, raw, previewJobId, previewDeadline, requirementCount])
  // B-6: 키 교체 / AI 연결 왕복으로 떠날 때만 남긴다 — 그 밖의 길은 버린다
  React.useEffect(() => {
    const here = window.location.pathname
    return () => {
      if (!keepsFormDraftOnLeave(readAiConnectReturn()?.href, here)) clearFormDraft(fromBoard)
    }
  }, [fromBoard])

  const urlTrimmed = url.trim()
  const directTrimmed = direct.trim()
  const rawTrimmed = raw.trim()
  const urlInvalid = urlTrimmed.length > 0 && !/^https?:\/\/\S+$/i.test(urlTrimmed)
  const busy = phase !== "idle"

  const anyInput = Boolean(urlTrimmed || directTrimmed || rawTrimmed || company.trim() || position.trim())

  const reset = () => {
    setStep(0)
    setUrl("")
    setDirect("")
    setCompany("")
    setPosition("")
    setRaw("")
    setPhase("idle")
    setFetchFailed(false)
    setPreviewJobId(null)
    setPreviewDeadline(null)
    setRequirementCount(null)
    setRawEdited(false)
    setKeyInvalidShown(false)
    setExtractFailed(false)
    setCreateFailed(false)
    setInvalidUrlRefused(false)
    setRestored(false)
    setUrlTouched(false)
  }

  const close = (next: boolean) => {
    if (next) return onOpenChange(true)
    // 아무것도 입력하지 않았으면 확인 없이 닫는다 (CF-A17)
    if (anyInput && !busy) return setCloseConfirm(true)
    clearFormDraft(fromBoard)
    reset()
    onOpenChange(false)
  }

  // --- ① [다음] -------------------------------------------------------------
  const goNext = async () => {
    setExtractFailed(false)
    setKeyInvalidShown(false)
    let text = directTrimmed
    let fetchedCompany: string | null = null
    let fetchedPosition: string | null = null
    let failedFetch = false

    if (urlTrimmed) {
      setPhase("fetching")
      const got = await fetchJobPostingAction(urlTrimmed).catch(() => null)
      if (!got) {
        // 실패 6종을 화면에서 나누지 않는다 (CF-10) — ②로 가서 직접 붙여넣게 한다
        failedFetch = true
        text = ""
      } else {
        text = got.rawText
        fetchedCompany = got.companyName
        fetchedPosition = got.positionTitle
      }
    }

    // 본문이 있고 키가 있으면 AI-01 미리 보기 (행 없음, CF-A17)
    let preview: { previewJobId: string; companyName: string | null; positionTitle: string | null; deadline: string | null; requirementCount: number } | null = null
    if (text && !keyless) {
      setPhase("extracting")
      const r = await extractJdPreviewAction(text).catch(() => null)
      if (r && isAiRejected(r)) {
        // 경로 ⑥: 화면 판정과 서버 판정이 어긋났다(다른 탭에서 키·동의가 바뀜 등). **원인별로** 처리한다
        // (UQ-751 · UX S-14 Q53-1 표 · R15: 409 `key_invalid`·`ai_consent_required`, 그 밖은 C-20)
        notifyAiConnectionChanged()
        const action = previewRefusalAction(r.refusal)
        if (action === "stay_key_invalid") {
          setPhase("idle")
          setKeyInvalidShown(true)
          return
        }
        if (action === "consent") {
          setPhase("idle")
          consent.open(() => void goNext())
          return
        }
        if (action === "step2_with_notice") setExtractFailed(true)
      } else if (r) preview = r
      // AI-01이 실패하면 막지 않고 ②로 간다 (UX S-14 `[가정]`) — ② 머리에 C-20 축약
      else setExtractFailed(true)
    }

    setFetchFailed(failedFetch)
    setRaw(text)
    setRawEdited(false)
    setPreviewJobId(preview?.previewJobId ?? null)
    setPreviewDeadline(preview?.deadline ?? null)
    setRequirementCount(preview?.requirementCount ?? null)
    // 채움 순서: ① AI-01 추출값 ② URL 공고의 `JobPosting` 값 ③ 빈 칸 (CF-A6)
    setCompany(preview?.companyName ?? fetchedCompany ?? "")
    setPosition(preview?.positionTitle ?? fetchedPosition ?? "")
    setPhase("idle")
    setStep(1)
  }

  const submitStep1 = (e: React.FormEvent) => {
    e.preventDefault()
    setUrlTouched(true)
    if (urlInvalid || (!urlTrimmed && !directTrimmed) || busy) return
    // Q53-1: 요청을 보내지 않고 막는다 (키 없음은 막지 않는다 — CF-U1 우회 버튼 없음)
    if (keyInvalid) return setKeyInvalidShown(true)
    if (previewWrite.stop()) return
    consent.guard(() => void goNext())
  }

  // --- ② [자기소개서 작성] --------------------------------------------------
  const create = async (opts: { withoutUrl?: boolean } = {}) => {
    setCreateFailed(false)
    setInvalidUrlRefused(false)
    setPhase("creating")
    const result = await createApplicationAction({
      raw_text: raw,
      name: null,
      deadline: null,
      company_name: company.trim() || null,
      position_title: position.trim() || null,
      source_url: opts.withoutUrl ? null : urlTrimmed || null,
      preview_job_id: previewJobId,
      preview_deadline: previewDeadline,
    }).catch(() => null)

    // `invalid_source_url`(400)은 값으로 온다 — 던진 오류는 Server Action 경계에서 `code`를 잃는다
    if (result && "refused" in result) {
      setPhase("idle")
      setInvalidUrlRefused(true)
      return
    }
    if (!result) {
      setPhase("idle")
      setCreateFailed(true)
      return
    }
    if (isAiRejected(result)) {
      // 경로 ⑥ (행 없음, 입력 유지)
      setPhase("idle")
      notifyAiConnectionChanged()
      if (result.refusal === "key_invalid") setKeyInvalidShown(true)
      else consent.open(() => void create(opts))
      return
    }
    // 미리 보기가 버려졌을 때 조용히 삼키지 않는다 (R15 `preview_skip_reason`) — [UI-가정] 문구
    if (previewJobId && !result.preview_applied && result.preview_skip_reason) {
      toast("공고 내용이 달라져 미리 정리한 요건은 쓰지 않았어요. 만든 뒤 '채용 공고' 탭에서 다시 정리해요")
    }
    clearFormDraft(fromBoard)
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
  const nextLabel = phase === "fetching" ? "공고를 가져오는 중" : phase === "extracting" ? "공고 내용을 정리하는 중" : "다음"

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
              <>
                {restored ? (
                  // [UI-가정] 복원 안내 (C-21·키 교체 왕복에서 돌아왔을 때만)
                  <p className="text-sm text-muted-foreground" role="status">
                    작성하던 내용을 불러왔어요
                  </p>
                ) : null}
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
              </>
            ) : (
              <>
                {/* 상황이 생겼을 때만 — 입력 거부·만들기 실패·미리 보기 추출 실패 */}
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
                {extractFailed ? <AiErrorNotice code="provider_unavailable" size="inline" /> : null}

                <FormSection title="지원 기업 / 포지션">
                  {/* 미리 채운 값도 보통 글자로 — 출처 배지를 두지 않는다 (CF-A6) */}
                  <FormField id="add-ap-company" label="지원 기업">
                    <Input id="add-ap-company" placeholder="기업 명" value={company} maxLength={FIELD_MAX} onChange={(e) => setCompany(e.target.value)} />
                  </FormField>
                  <FormField id="add-ap-position" label="지원 포지션">
                    <Input id="add-ap-position" placeholder="포지션 명" value={position} maxLength={FIELD_MAX} onChange={(e) => setPosition(e.target.value)} />
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
                    {requirementCount !== null && requirementCount > 0 ? (
                      rawEdited ? (
                        <p className="flex items-center gap-1.5 text-sm text-warning-subtle-foreground">
                          <TriangleAlert className="size-3.5 text-warning" aria-hidden />
                          공고 내용을 고쳐서 요건은 만든 뒤 다시 정리해요
                        </p>
                      ) : (
                        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Sparkles className="size-3.5 text-ai" aria-hidden />
                          공고에서 요건 {requirementCount}개를 미리 정리해 두었어요
                        </p>
                      )
                    ) : null}
                    <div className="group/raw flex min-h-0 flex-1 flex-col gap-2">
                      <Textarea
                        id="add-ap-raw"
                        className="min-h-48 flex-1 resize-none text-base leading-[1.75]"
                        placeholder="포지션 공고 내용을 입력해주세요."
                        value={raw}
                        disabled={busy}
                        aria-describedby="add-ap-raw-note"
                        onChange={(e) => {
                          setRaw(e.target.value)
                          setRawEdited(true)
                        }}
                        required
                      />
                      <InputChecks text={rawTrimmed} />
                      {/* U-6 (예외 Q53-2) — 공고 칸에 포커스가 있을 때만 보인다 `[UI-가정]`(시안에 상시 보조 문구 없음). 낭독기는 늘 읽는다 */}
                      <p id="add-ap-raw-note" className="sr-only flex items-start gap-1.5 text-sm text-muted-foreground group-focus-within/raw:not-sr-only">
                        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        만든 뒤에는 공고 내용을 바꿀 수 없어요. 요건 정리에 실패한 공고만 고칠 수 있어요
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
              {step === 0 ? (
                <FormDialogSubmit pending={busy} disabled={urlInvalid || (!urlTrimmed && !directTrimmed)}>
                  {nextLabel}
                </FormDialogSubmit>
              ) : (
                <FormDialogSubmit pending={phase === "creating"} disabled={!rawTrimmed}>
                  {phase === "creating" ? "만드는 중…" : primaryLabel}
                </FormDialogSubmit>
              )}
              {/* Q53-1 게이트 — 생겼을 때만 (키 무효 C-20) */}
              {keyInvalidShown ? <AiErrorNotice code="key_invalid" size="inline" /> : null}
              {/* 키 없음: ②에서 요건을 미리 정리하지 못한 이유를 그때만 알린다 (막지 않는다, CF-U1) `[UI-가정]` */}
              {step === 1 && keyless ? (
                <AiLock entry="requirements" size="inline" description="AI를 연결하면 공고에서 회사명·포지션명·마감일·요건을 정리해 드려요" />
              ) : null}
            </div>
          </FormDialogFooter>
        </FormDialogForm>
      </FormDialog>

      {/* 닫기 확인 (CF-A17) — 미리 보기에 이미 토큰을 썼기 때문에 묻는다 */}
      <AlertDialog open={closeConfirm} onOpenChange={setCloseConfirm}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>입력한 내용과 정리한 결과가 사라져요</AlertDialogTitle>
            <AlertDialogDescription>지금 닫으면 붙여넣은 공고와 미리 정리한 요건이 남지 않아요</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="destructive-ghost"
              onClick={() => {
                setCloseConfirm(false)
                clearFormDraft(fromBoard)
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
      {consent.dialog}
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
// `?state=` 미리 보기
// ---------------------------------------------------------------------------

const STEP2_STATES = ["step2", "fetch-failed", "extract-failed", "creating", "create-failed", "invalid-source-url"]
const MOCK_PASTED = [
  "[그린뱅크] 결제 백엔드 엔지니어 채용",
  "주요 업무",
  "- 결제·정산 서비스의 API 설계와 운영을 맡습니다.",
  "자격 요건",
  "- 백엔드 개발 경력 5년 이상",
].join("\n")

function previewPhase(state: string | null): Phase {
  if (state === "fetching") return "fetching"
  if (state === "extracting") return "extracting"
  if (state === "creating") return "creating"
  return "idle"
}

// ---------------------------------------------------------------------------
// 입력 보존 (sessionStorage, 진입 경로별). 주소에는 아무것도 넣지 않는다.
// 키 교체로 떠날 때만 남고(`keepsFormDraftOnLeave`), 생성 성공 때 지운다.
// ---------------------------------------------------------------------------

interface FormDraft {
  step: number
  url: string
  direct: string
  company: string
  position: string
  raw: string
  preview_job_id: string | null
  preview_deadline: string | null
  requirement_count: number | null
}

const draftKey = (fromBoard: boolean) => `resumate.a3.add-application.${fromBoard ? "board" : "list"}`

function readFormDraft(fromBoard: boolean): FormDraft | null {
  try {
    const stored = window.sessionStorage.getItem(draftKey(fromBoard))
    if (!stored) return null
    const d = JSON.parse(stored) as FormDraft
    return d.url || d.direct || d.raw || d.company || d.position ? d : null
  } catch {
    return null
  }
}

function writeFormDraft(fromBoard: boolean, d: FormDraft) {
  try {
    if (d.url || d.direct || d.raw || d.company || d.position) window.sessionStorage.setItem(draftKey(fromBoard), JSON.stringify(d))
    else window.sessionStorage.removeItem(draftKey(fromBoard))
  } catch {
    /* storage unavailable */
  }
}

function clearFormDraft(fromBoard: boolean) {
  try {
    window.sessionStorage.removeItem(draftKey(fromBoard))
  } catch {
    /* storage unavailable */
  }
}
