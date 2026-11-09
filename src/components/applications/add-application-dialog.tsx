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
 * 작성 중 자동 저장 없음(CF-A17): 입력이 있는 채로 닫으면 확인 한 줄. C-21·키 교체로 떠날 때만
 * 브라우저 세션에 입력을 남긴다(`form-draft.ts`의 규칙 그대로, 주소에는 넣지 않는다).
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { CloudAlert, Info, Loader2, Sparkles, TriangleAlert } from "lucide-react"
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { AiErrorNotice } from "@/components/common/ai-error-notice"
import { AiLock } from "@/components/common/ai-lock"
import { notifyAiConnectionChanged, useAiConnection } from "@/components/common/ai-connection-context"
import { useAiConsentGate } from "@/components/common/consent-gate"
import { CharCount } from "@/components/common/input-guide"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import { ProviderBadge } from "@/components/common/provider-badge"
import { readAiConnectReturn } from "@/components/common/ai-connect-return"
import { setNavOrigin } from "@/components/common/return-target"
import { isAiRejected } from "@/lib/data/ai-errors"
import { JD_FETCH_FAILED_MESSAGE } from "@/lib/data/cover-letter-copy"
import { JD_LONG_WARNING, JD_RAW_TEXT_LONG, JD_RAW_TEXT_MAX, JD_RAW_TEXT_SHORT, JD_SHORT_WARNING } from "@/lib/data/jd-raw-text"
import { routes } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { keepsFormDraftOnLeave } from "./form-draft"
import { createApplicationAction, extractJdPreviewAction, fetchJobPostingAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"

/** v5.3 S-14: 지원 기업·지원 포지션 각 200자 (구현 값 `[가정]`) */
const FIELD_MAX = 200
/** URL은 2,048자까지 `[가정]` (UX S-14 입력 검사) */
const URL_MAX = 2_048

const STEP_NAMES = ["JD 입력", "지원 기업 / 포지션"] as const

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
        // 경로 ⑥: 화면 판정과 서버 판정이 어긋났다 — ①에 머문다
        setPhase("idle")
        notifyAiConnectionChanged()
        if (r.refusal === "key_invalid") setKeyInvalidShown(true)
        else consent.open(() => void goNext())
        return
      }
      if (r) preview = r
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
    }).catch((e: unknown) => (isInvalidSourceUrl(e) ? "invalid_source_url" : null))

    if (result === "invalid_source_url") {
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
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl max-sm:h-dvh max-sm:max-w-none max-sm:rounded-none">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">자기소개서 작성</DialogTitle>
            <DialogDescription className="sr-only">공고 URL 또는 공고 내용으로 새 자기소개서를 만들어요</DialogDescription>
            <StepIndicator current={step} onGo={(i) => i < step && setStep(i as 0 | 1)} />
          </DialogHeader>

          {step === 0 ? (
            <form id="add-ap-step1" onSubmit={submitStep1} className="space-y-5" noValidate>
              {restored ? (
                // [UI-가정] 복원 안내
                <p className="text-sm text-muted-foreground" role="status">
                  작성하던 내용을 불러왔어요
                </p>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="add-ap-url">포지션 공고 URL</Label>
                <Input
                  id="add-ap-url"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={url}
                  maxLength={URL_MAX}
                  disabled={busy || directTrimmed.length > 0}
                  aria-invalid={urlTouched && urlInvalid ? true : undefined}
                  aria-describedby={urlTouched && urlInvalid ? "add-ap-url-error" : undefined}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={() => setUrlTouched(true)}
                />
                {urlTouched && urlInvalid ? (
                  <p id="add-ap-url-error" className="text-sm text-destructive" role="alert">
                    공고 주소를 확인해 주세요
                  </p>
                ) : directTrimmed.length > 0 ? (
                  // [UI-가정] 배타 안내
                  <p className="text-sm text-muted-foreground">URL과 직접 입력은 하나만 쓸 수 있어요</p>
                ) : null}
              </div>

              <div className="flex items-center gap-3" aria-hidden>
                <Separator className="flex-1" />
                <span className="text-sm text-muted-foreground">또는</span>
                <Separator className="flex-1" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="add-ap-direct">직접 입력</Label>
                <Textarea
                  id="add-ap-direct"
                  className="min-h-56 font-sans text-base"
                  placeholder="공고 내용을 붙여넣어 주세요"
                  value={direct}
                  disabled={busy || urlTrimmed.length > 0}
                  onChange={(e) => setDirect(e.target.value)}
                />
                <div className="flex items-start justify-between gap-2">
                  <LengthWarning text={directTrimmed} />
                  <CharCount count={directTrimmed.length} limit={JD_RAW_TEXT_MAX} />
                </div>
              </div>
            </form>
          ) : (
            <form id="add-ap-step2" onSubmit={submitStep2} className="space-y-5" noValidate>
              {invalidUrlRefused ? (
                <div className="space-y-1">
                  {/* `invalid_source_url`(400) — AI 실패가 아니라 입력 거부라 C-20을 쓰지 않는다 `[UI-가정]` */}
                  <p className="text-sm text-destructive" role="alert">
                    공고 주소를 저장할 수 없어요
                  </p>
                  {/* [UI-가정] 주소만 빼고 다시 보낸다 (입력 유지) */}
                  <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => void create({ withoutUrl: true })}>
                    주소 없이 만들기
                  </Button>
                </div>
              ) : null}
              {createFailed ? (
                <p className="text-sm text-destructive" role="alert">
                  만들지 못했어요. 다시 시도해 주세요
                </p>
              ) : null}
              {extractFailed ? <AiErrorNotice code="provider_unavailable" size="inline" /> : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="add-ap-company">지원 기업</Label>
                  {/* 미리 채운 값도 보통 글자로 — 출처 배지를 두지 않는다 (CF-A6) */}
                  <Input id="add-ap-company" value={company} maxLength={FIELD_MAX} onChange={(e) => setCompany(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="add-ap-position">지원 포지션</Label>
                  <Input id="add-ap-position" value={position} maxLength={FIELD_MAX} onChange={(e) => setPosition(e.target.value)} />
                </div>
              </div>

              {fetchFailed ? (
                <Alert variant="warning">
                  <CloudAlert aria-hidden />
                  <AlertTitle className="font-normal">{JD_FETCH_FAILED_MESSAGE}</AlertTitle>
                </Alert>
              ) : null}

              <div className="space-y-1.5">
                <div className="flex items-end justify-between gap-2">
                  <Label htmlFor="add-ap-raw">
                    공고 내용 <span className="text-destructive" aria-hidden>*</span>
                    <span className="sr-only">필수</span>
                  </Label>
                </div>
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
                <Textarea
                  id="add-ap-raw"
                  className="min-h-72 font-sans text-base"
                  placeholder="공고 내용을 붙여넣어 주세요"
                  value={raw}
                  disabled={busy}
                  onChange={(e) => {
                    setRaw(e.target.value)
                    setRawEdited(true)
                  }}
                  required
                />
                <div className="flex items-start justify-between gap-2">
                  <LengthWarning text={rawTrimmed} />
                  <CharCount count={rawTrimmed.length} limit={JD_RAW_TEXT_MAX} />
                </div>
                <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {/* U-6, 예외 Q53-2 */}
                  만든 뒤에는 공고 내용을 바꿀 수 없어요. 요건 정리에 실패한 공고만 고칠 수 있어요
                </p>
              </div>
            </form>
          )}

          <DialogFooter className="sm:justify-between">
            <div className="flex items-center">
              {step === 1 ? (
                <Button type="button" variant="muted-ghost" disabled={busy} onClick={() => setStep(0)}>
                  이전
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col items-stretch gap-1 sm:items-end">
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                {step === 0 ? (
                  <>
                    {/* 키가 있으면 [다음] 옆 C-19 (AI-01이 돈다). 없으면 C-18 인라인 — 막지 않는다 */}
                    {keyless ? (
                      <AiLock
                        entry="requirements"
                        size="inline"
                        description="AI를 연결하면 공고에서 회사명·포지션명·마감일·요건을 정리해 드려요"
                      />
                    ) : (
                      <ProviderBadge />
                    )}
                    <Button
                      type="submit"
                      form="add-ap-step1"
                      className="min-w-[12rem]"
                      disabled={busy || urlInvalid || (!urlTrimmed && !directTrimmed)}
                    >
                      {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                      {nextLabel}
                    </Button>
                  </>
                ) : (
                  <Button type="submit" form="add-ap-step2" disabled={phase === "creating" || !rawTrimmed}>
                    {phase === "creating" ? <Loader2 className="animate-spin" aria-hidden /> : null}
                    {phase === "creating" ? "만드는 중…" : primaryLabel}
                  </Button>
                )}
              </div>
              {keyInvalidShown ? <AiErrorNotice code="key_invalid" size="inline" /> : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

/** 5.7 `StepIndicator` 재사용 — 2단(지난 단계는 누를 수 있다) */
function StepIndicator({ current, onGo }: { current: number; onGo: (i: number) => void }) {
  return (
    <>
      <ol className="mt-3 hidden items-center gap-2 text-sm md:flex" aria-label="추가 단계">
        {STEP_NAMES.map((name, i) => {
          const done = i < current
          const now = i === current
          return (
            <li key={name} className="flex items-center gap-2" aria-current={now ? "step" : undefined}>
              {i > 0 ? <span className="h-px w-8 bg-border" aria-hidden /> : null}
              <button
                type="button"
                disabled={!done}
                onClick={() => onGo(i)}
                className={cn(
                  "grid size-6 place-items-center rounded-full text-sm font-semibold",
                  now ? "bg-primary text-primary-foreground" : done ? "bg-primary-subtle text-primary-subtle-foreground" : "border border-input text-muted-foreground",
                )}
              >
                {i + 1}
                <span className="sr-only">{done ? " (완료)" : ""}</span>
              </button>
              <span className={cn(now && "font-medium")}>{name}</span>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-sm text-muted-foreground tabular-nums md:hidden">
        {current + 1} / {STEP_NAMES.length} · {STEP_NAMES[current]}
      </p>
    </>
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

function isInvalidSourceUrl(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "invalid_source_url"
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
