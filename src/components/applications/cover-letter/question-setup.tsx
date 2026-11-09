"use client"

/**
 * S-46 **문항 설정 상태** (= 옛 S-18, UX v5.20 S-46 "문항 설정 상태" / design-system 5.12,
 * CF-5·CF-A10·CF-A11·CF-U2·CF-S3).
 *
 * 왼쪽 탭도 AI 패널도 그리지 않는다 — 문항을 정하는 단계이고 AI를 쓰지 않는다. C-18·C-19도 없다
 * (CL-8). 유일한 예외가 바닥 [자기소개서 작성 시작] 옆의 C-19다(요건 선행 추출이 돌 수 있다).
 *
 * **CF-S3**: 정본 행을 만드는 첫 저장은 **[자기소개서 작성 시작] 하나**다. 상단 바 "저장하기"는 이
 * 상태에서 늘 비활성이고 ⌘S도 아무 일을 하지 않는다 — 화면(`cover-letter-screen.tsx`)이 그 규칙을
 * 들고 있다. 순서는 **추출 → 성공 뒤 저장**이다(v5.20 정정, DM-3).
 */
import * as React from "react"
import { Info, Loader2, Plus, Trash2 } from "lucide-react"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ProviderBadge } from "@/components/common/provider-badge"
import { useAiConnection } from "@/components/common/ai-connection-context"
import type { AiErrorCode } from "@/types/db"
import { COVER_LETTER_MAX_QUESTIONS } from "@/lib/data/cover-letter-defaults"
import { QUESTION_MAX_NOTE, QUESTION_MIN_NOTE, QUESTION_SETUP_NOTE } from "@/lib/data/cover-letter-copy"
import { useRequirementsFirst } from "../extract-first"
import { QuestionNoteField, QuestionSettingsRow, QuestionTextField } from "./question-fields"
import { DeleteQuestionDialog } from "./delete-question-dialog"
import type { QuestionErrors, QuestionForm } from "./question-form"
import { newQuestionForm } from "./question-form"

export function QuestionSetup({
  applicationProjectId,
  allocateSlot,
  forms,
  errors,
  onChange,
  onStart,
  starting,
  extractFirst,
  extractFailPreview = null,
  focusIndex,
}: {
  applicationProjectId: string
  /** 새 문항의 슬롯 — 화면의 발급기가 준다 (안정 키, 재사용 금지 — UQ-740) */
  allocateSlot: () => string
  forms: QuestionForm[]
  errors: Record<number, QuestionErrors>
  onChange: (next: QuestionForm[]) => void
  /** 요건 추출이 성공한 뒤 호출된다 — 저장(정본 행 생성)은 화면이 한다 */
  onStart: () => Promise<unknown>
  starting: boolean
  /** 키가 있고 요건이 아직 없다 → [자기소개서 작성 시작]이 AI-01을 먼저 돌린다 (FL-03) */
  extractFirst: boolean
  extractFailPreview?: AiErrorCode | null
  /** 검증 오류 뒤 포커스를 줄 문항 (L-02 규칙: 첫 오류 칸) */
  focusIndex: number | null
}) {
  const connection = useAiConnection()
  const locked = connection !== null && !connection.active_provider
  const [noteOpen, setNoteOpen] = React.useState<Record<string, boolean>>({})
  const [deleting, setDeleting] = React.useState<number | null>(null)
  const textRefs = React.useRef<Record<number, HTMLTextAreaElement | null>>({})
  const limitRefs = React.useRef<Record<number, HTMLInputElement | null>>({})

  // 첫 오류 칸에 포커스 (L-02)
  React.useEffect(() => {
    if (focusIndex === null) return
    const e = errors[focusIndex]
    if (e?.question_text) textRefs.current[focusIndex]?.focus()
    else if (e?.char_limit) limitRefs.current[focusIndex]?.focus()
  }, [focusIndex, errors])

  const req = useRequirementsFirst(applicationProjectId, {
    needed: extractFirst,
    rerunLabel: "자기소개서 작성 시작",
    previewFail: extractFailPreview,
    jdEditFrom: { from: "cover_letter" },
  })

  const patch = (i: number, p: Partial<QuestionForm>) => onChange(forms.map((f, idx) => (idx === i ? { ...f, ...p } : f)))
  const add = () => onChange([...forms, newQuestionForm(allocateSlot())])
  const remove = (i: number) => onChange(forms.filter((_, idx) => idx !== i))
  const full = forms.length >= COVER_LETTER_MAX_QUESTIONS

  return (
    <div className="space-y-5">
      <Alert variant="info">
        <Info aria-hidden />
        <AlertTitle className="font-normal">{QUESTION_SETUP_NOTE}</AlertTitle>
      </Alert>

      <ol className="space-y-3">
        {forms.map((f, i) => {
          const idPrefix = `qs-${f.question_id}`
          const open = noteOpen[f.question_id] || Boolean(f.user_note)
          return (
            <li key={f.question_id} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <span className="mt-2 text-xs font-medium text-muted-foreground tabular-nums">문항 {i + 1}</span>
                <QuestionTextField
                  idPrefix={idPrefix}
                  value={f.question_text}
                  error={errors[i]?.question_text}
                  onChange={(v) => patch(i, { question_text: v })}
                  inputRef={(el) => {
                    textRefs.current[i] = el
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="mt-1"
                  disabled={forms.length <= 1}
                  aria-label={`문항 ${i + 1} 삭제`}
                  onClick={() => {
                    // 답변·제목이 없는 문항은 확인 없이 지운다 (UX S-46 문항 편집)
                    if (f.body.trim() || f.answer_title.trim()) setDeleting(i)
                    else remove(i)
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
              <QuestionSettingsRow
                idPrefix={idPrefix}
                form={f}
                errors={errors[i]}
                noteOpen={open}
                onOpenNote={() => setNoteOpen((s) => ({ ...s, [f.question_id]: true }))}
                onChange={(p) => patch(i, p)}
                limitRef={(el) => {
                  limitRefs.current[i] = el
                }}
              />
              {open ? <QuestionNoteField idPrefix={idPrefix} form={f} errors={errors[i]} onChange={(p) => patch(i, p)} /> : null}
            </li>
          )
        })}
      </ol>
      {forms.length <= 1 ? <p className="text-xs text-muted-foreground">{QUESTION_MIN_NOTE}</p> : null}

      <div className="space-y-1.5">
        <Button variant="outline" className="w-full border-dashed" disabled={full} onClick={add}>
          <Plus aria-hidden />+ 문항 추가 <span className="tabular-nums">{forms.length}/{COVER_LETTER_MAX_QUESTIONS}</span>
        </Button>
        {full ? <p className="text-sm text-muted-foreground">{QUESTION_MAX_NOTE}</p> : null}
      </div>

      {/* 주 버튼 하나 (R-C8). 상단 바 "저장하기"는 이 상태에서 비활성이다 (CF-S3) */}
      <div className="flex flex-col items-stretch gap-2 border-t pt-5 sm:items-end">
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {!locked ? <ProviderBadge /> : null}
          <Button size="lg" disabled={starting || req.busy} onClick={() => void req.run(onStart)}>
            {starting || req.busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            자기소개서 작성 시작
          </Button>
        </div>
        {/* ST-WAIT-JD("공고 요건 정리 중") · 실패는 같은 자리 C-20 inline (입력 원인이면 "공고 원문 고치기") */}
        {req.slot}
      </div>

      <DeleteQuestionDialog
        index={deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={() => {
          if (deleting !== null) remove(deleting)
          setDeleting(null)
        }}
      />
    </div>
  )
}
