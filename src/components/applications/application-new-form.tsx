"use client"

/**
 * S-14 자기소개서 추가 (FL-10). 공고 원문(필수·교체 불가, U-6) + 이름(선택, 비우면 AI가 채움) + 마감일.
 * 만들기 → stage = 'before_apply', AI-01 요건 추출 자동(키 있음) → S-31, or back to S-39 with an "열기" toast
 * when entered from the board. 키 없음: 추출 없이 저장 (D-30).
 * Q53-1: 동의 필요·키 무효면 행을 만들기 전에 막는다. 동의 필요 → C-21, 동의 뒤 그 만들기를 이어서 보내
 * 생성 + 추출. 키 무효 → 버튼 아래 C-20 key_invalid, 키 교체 뒤에는 복원된 입력에서 다시 누른다 (자동 실행 없음).
 * 그 사이 상태가 바뀌면 서버가 같은 코드로 거부한다 (경로 ⑥, 행 없음).
 */
import { kstToday, submitFailedMessage } from "@/lib/data/labels"
import { isAiRejected } from "@/lib/data/ai-errors"
import { JD_LONG_WARNING, JD_RAW_TEXT_LONG, JD_RAW_TEXT_MAX, JD_RAW_TEXT_SHORT, JD_SHORT_WARNING } from "@/lib/data/jd-raw-text"
import type { ApplicationCreateRefusalCode } from "@/types/db"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronDown, CircleAlert, Info, Loader2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ProviderBadge } from "@/components/common/provider-badge"
import { notifyAiConnectionChanged, useAiConnection } from "@/components/common/ai-connection-context"
import { AiErrorNotice } from "@/components/common/ai-error-notice"
import { AiLock } from "@/components/common/ai-lock"
import { useAiConsentGate } from "@/components/common/consent-gate"
import { CharCount } from "@/components/common/input-guide"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import { routes } from "@/lib/routes"
import { setNavOrigin } from "@/components/common/return-target"
import { readAiConnectReturn } from "@/components/common/ai-connect-return"
import { keepsFormDraftOnLeave } from "./form-draft"
import { createApplicationAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"

/** v5.3 S-14: 회사명·포지션명 각 200자 (구현 값 [가정]) */
const FIELD_MAX = 200

export function ApplicationNewForm({
  fromBoard,
  failSave = false,
  previewServerRefusal = null,
}: {
  fromBoard: boolean
  failSave?: boolean
  /** `?state=create-refused-*`: the screen passed the gate, then the server refused (경로 ⑥) */
  previewServerRefusal?: ApplicationCreateRefusalCode | null
}) {
  const router = useRouter()
  const [raw, setRaw] = React.useState("")
  const [company, setCompany] = React.useState("")
  const [position, setPosition] = React.useState("")
  const connection = useAiConnection()
  const consent = useAiConsentGate()
  const previewWrite = usePreviewWriteGuard()
  const previewRefused = React.useRef(false)
  // null while loading → treat as connected (collapsed); the server checks the gate anyway
  const keyless = connection !== null && !connection.active_provider
  const keyInvalid = connection?.key_status === "invalid"
  /** C-20 key_invalid under the button after 만들기 (Q53-1): nothing was sent or created */
  const [invalidShown, setInvalidShown] = React.useState(false)
  const [namesOpen, setNamesOpen] = React.useState(false)
  // v5.3 S-14 이름 규칙(둘 다 → "회사명 – 포지션명" 앞 100자 / 아니면 기본 이름·추출 대기)은 data layer가 정한다 (UQ-518)
  const [deadline, setDeadline] = React.useState("")
  // A3 UQ-230: keep the form across the AI 연결 round trip (FL-19) — browser session only
  const [restored, setRestored] = React.useState(false)
  React.useEffect(() => {
    const d = readFormDraft(fromBoard)
    if (!d) return
    queueMicrotask(() => {
      setRaw(d.raw_text)
      setCompany(d.company)
      setPosition(d.position)
      setDeadline(d.deadline)
      if (d.company || d.position) setNamesOpen(true)
      setRestored(true)
    })
  }, [fromBoard])
  React.useEffect(() => {
    writeFormDraft(fromBoard, { raw_text: raw, company, position, deadline })
  }, [fromBoard, raw, company, position, deadline])
  // B-6: kept only across the key swap / AI 연결 round trip; any other way out drops it
  // (the URL may already be the next screen's when this cleanup runs, so the path is taken at mount)
  React.useEffect(() => {
    const here = window.location.pathname
    return () => {
      if (!keepsFormDraftOnLeave(readAiConnectReturn()?.href, here)) clearFormDraft(fromBoard)
    }
  }, [fromBoard])
  const [touched, setTouched] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const rawId = React.useId()
  const errorId = React.useId()
  const back = fromBoard ? routes.board() : routes.applications()

  const trimmed = raw.trim()
  const rawError = touched && trimmed.length === 0 ? "공고 원문을 붙여넣어 주세요" : trimmed.length > JD_RAW_TEXT_MAX ? `${JD_RAW_TEXT_MAX.toLocaleString()}자까지 붙여넣을 수 있어요` : null

  const create = async () => {
    setSaving(true)
    setFailed(false)
    setInvalidShown(false)
    try {
      // `?state=` connection / gate is simulated: nothing is created. create-refused-* shows the server's answer.
      const refuseNow = previewServerRefusal && !previewRefused.current
      previewRefused.current = true
      const result =
        refuseNow
          ? { rejected: previewServerRefusal === "key_invalid" ? ("key_invalid" as const) : ("key_missing" as const), refusal: previewServerRefusal }
          : !failSave && previewWrite.stop()
            ? null
            : await createApplicationAction({
                raw_text: raw,
                name: null,
                deadline: deadline || null,
                company_name: company.trim() || null,
                position_title: position.trim() || null,
                fail: failSave,
              })
      if (result === null) {
        setSaving(false)
        return
      }
      if (isAiRejected(result)) {
        // 경로 ⑥: the gate changed between the screen's check and the request — no row, input kept
        setSaving(false)
        notifyAiConnectionChanged()
        if (result.refusal === "key_invalid") setInvalidShown(true)
        else consent.open(() => void create())
        return
      }
      const { id } = result
      clearFormDraft(fromBoard)
      if (fromBoard) {
        // S-39로 돌아가 "지원 전" 열 맨 위에 카드 + "열기" 토스트
        // [UI-가정] 토스트 문구
        toast.success("자기소개서를 추가했어요", { action: {
            label: "열기",
            // UQ-123: opened from the board flow → breadcrumb starts with "지원 현황"
            onClick: () => {
              setNavOrigin("board", id)
              router.push(routes.application(id))
            },
          } })
        router.push(routes.board())
      } else {
        router.push(routes.application(id))
      }
    } catch {
      setFailed(true)
      setSaving(false)
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (trimmed.length === 0 || trimmed.length > JD_RAW_TEXT_MAX || company.trim().length > FIELD_MAX || position.trim().length > FIELD_MAX) return
    // Q53-1: 판정은 C-18과 같다. 요청을 보내지 않고 막는다 (키 없음은 막지 않음)
    if (keyInvalid) {
      setFailed(false)
      setInvalidShown(true)
      return
    }
    consent.guard(() => void create())
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <Card className="gap-4 p-5">
        <div className="space-y-1.5">
          <div className="flex items-end justify-between gap-2">
            <Label htmlFor={rawId}>
              공고 원문 <span className="text-destructive" aria-hidden>*</span>
              <span className="sr-only">필수</span>
            </Label>
          </div>
          <p className="text-sm text-muted-foreground">
            {/* A3 UQ-233: 키가 없으면 요건 정리를 약속하지 않음 (D-30) */}
            {keyless
              ? "채용 공고 전체를 그대로 붙여넣어 주세요. AI를 연결하면 주요 업무·자격요건·우대사항을 정리해 드려요"
              : "채용 공고 전체를 그대로 붙여넣어 주세요. 주요 업무·자격요건·우대사항을 AI가 정리해요"}
          </p>
          {restored ? (
            // [UI-가정] 복원 안내
            <p className="text-sm text-muted-foreground" role="status">
              작성하던 내용을 불러왔어요
            </p>
          ) : null}
          <Textarea
            id={rawId}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={() => setTouched(true)}
            className="min-h-80 font-sans text-base"
            aria-invalid={rawError ? true : undefined}
            aria-describedby={rawError ? errorId : undefined}
            required
          />
          <div className="flex items-start justify-between gap-2">
            {rawError ? (
              <p id={errorId} className="flex items-center gap-1.5 text-sm text-destructive">
                <CircleAlert className="size-4 shrink-0" aria-hidden />
                {rawError}
              </p>
            ) : (
              <span />
            )}
            <CharCount count={trimmed.length} limit={JD_RAW_TEXT_MAX} />
          </div>
          {trimmed.length > 0 && trimmed.length < JD_RAW_TEXT_SHORT ? (
            <Alert variant="warning">
              <TriangleAlert aria-hidden />
              {/* v5.3 S-14 입력 검사 (경고만, 만들기는 막지 않음) */}
              <AlertTitle className="font-normal">{JD_SHORT_WARNING}</AlertTitle>
            </Alert>
          ) : null}
          {trimmed.length > JD_RAW_TEXT_LONG ? (
            <Alert variant="warning">
              <TriangleAlert aria-hidden />
              {/* v5.3 S-14 입력 검사 (경고만, 만들기는 막지 않음) */}
              <AlertTitle className="font-normal">{JD_LONG_WARNING}</AlertTitle>
            </Alert>
          ) : null}
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {/* 02 S-14 공고 원문 안내 (U-6, 예외 Q53-2) */}
            공고 원문은 만든 뒤에 바꿀 수 없어요. 요건 정리에 실패한 공고만 고칠 수 있어요. 다른 공고는 새 자기소개서로 추가해 주세요
          </p>
        </div>

        {keyless ? (
          // v5 S-14 키 없음: 입력란을 펼치고 C-18 인라인 안내 한 줄 (막지 않음, 요건 추출 안 함 D-30)
          <AiLock entry="requirements" size="inline" description="AI를 연결하면 공고에서 회사명·포지션명·요건을 자동으로 정리해 드려요" />
        ) : null}
        {keyless || namesOpen ? (
          <NameFields company={company} position={position} onCompany={setCompany} onPosition={setPosition} noExtraction={keyless} />
        ) : (
          <Button type="button" variant="link" size="sm" className="h-auto justify-start px-0" onClick={() => setNamesOpen(true)} aria-expanded={false}>
            <ChevronDown aria-hidden />
            회사명·포지션명 직접 입력
          </Button>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="ap-deadline">마감일</Label>
          <Input id="ap-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-full sm:w-48" />
        </div>
      </Card>

      {failed ? (
        <p className="flex items-center gap-1.5 text-sm text-destructive" role="alert">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          {/* ST-SAVE-FAILED — 입력은 그대로 */}
          {submitFailedMessage("자기소개서")}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button variant="outline" asChild>
          <Link href={back} onClick={() => clearFormDraft(fromBoard)}>취소</Link>
        </Button>
        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
              만들기
            </Button>
            {/* v5 S-14: 키가 있으면 만들기 옆 C-19 (요건 추출 자동) */}
            <ProviderBadge />
          </div>
          {/* Q53-1 키 무효: 버튼 아래 C-20. "키 교체" → S-41 ③ → 입력이 복원된 이 화면으로 (자동 실행 없음) */}
          {invalidShown ? <AiErrorNotice code="key_invalid" size="inline" /> : null}
        </div>
      </div>
      {consent.dialog}
    </form>
  )
}

function NameFields({
  company,
  position,
  onCompany,
  onPosition,
  noExtraction,
}: {
  company: string
  position: string
  onCompany: (v: string) => void
  onPosition: (v: string) => void
  noExtraction: boolean
}) {
  const today = kstToday() // A3 UQ-234: KST date (lib/data/labels)
  return (
    <div className="space-y-1.5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ap-company">회사명</Label>
          <Input id="ap-company" value={company} maxLength={FIELD_MAX} onChange={(e) => onCompany(e.target.value)} aria-describedby="ap-name-help" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ap-position">포지션명</Label>
          <Input id="ap-position" value={position} maxLength={FIELD_MAX} onChange={(e) => onPosition(e.target.value)} aria-describedby="ap-name-help" />
        </div>
      </div>
      <p id="ap-name-help" className="text-sm text-muted-foreground">
        {/* v5.3 S-14 이름 규칙 — // [UI-가정] 안내 문구 */}
        {noExtraction
          ? `둘 다 입력하면 이름을 "회사명 – 포지션명"으로, 아니면 "새 자기소개서 (${today})"로 만들어요`
          : `둘 다 입력하면 이름을 "회사명 – 포지션명"으로 만들어요. 아니면 공고에서 찾은 회사명·포지션명으로 채우고, 찾지 못하면 "새 자기소개서 (${today})"로 만들어요`}
      </p>
    </div>
  )
}

/** 'YYYY-MM-DD' in KST */

// ---------------------------------------------------------------------------
// S-14 form draft (A3 UQ-230, UX S-14 입력 보존). sessionStorage, 진입 경로(자기소개서 관리 / 보드)별. 키 교체로 떠날 때만 남고
// (keepsFormDraftOnLeave), 만들기 성공 시 삭제.
// Nothing goes to the URL; storage failures are ignored (input still works).
// ---------------------------------------------------------------------------

interface FormDraft {
  raw_text: string
  company: string
  position: string
  deadline: string
}

const draftKey = (fromBoard: boolean) => `resumate.a3.new-application.${fromBoard ? "board" : "list"}`

function readFormDraft(fromBoard: boolean): FormDraft | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(fromBoard))
    if (!raw) return null
    const d = JSON.parse(raw) as FormDraft
    return d.raw_text || d.company || d.position || d.deadline ? d : null
  } catch {
    return null
  }
}

function writeFormDraft(fromBoard: boolean, d: FormDraft) {
  try {
    if (d.raw_text || d.company || d.position || d.deadline) window.sessionStorage.setItem(draftKey(fromBoard), JSON.stringify(d))
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
