"use client"

/**
 * S-46 **문항 설정 상태** (= 옛 S-18, UX v5.20 S-46 "문항 설정 상태" / design-system 5.12,
 * CF-5·CF-A10·CF-A11·CF-U2·CF-S3).
 *
 * 왼쪽 탭도 AI 패널도 그리지 않는다 — 문항을 정하는 단계이고 AI를 쓰지 않는다. C-18·C-19도 없다
 * (CL-8). (58 런) 시안 2에 맞춰 [자기소개서 작성 시작] 옆 C-19 배지도 뺐다 — 선행 추출이 돌면 버튼 아래
 * ST-WAIT-JD 줄이 공급자 없이 진행을 알린다 `[UI-가정]`.
 *
 * 모양 (58 런, 시안 2): 가운데 좁은 열 · 제목 "자기소개서 문항 추가" + 회색 부제 · 문항 한 줄 =
 * [문항 입력(안쪽 끝 ⋯)][글자 수 "자"] · 마지막 줄 왼쪽 "+ 문항 추가 n/5", 오른쪽 [자기소개서 작성 시작].
 * 기준(공백 포함/제외)·메모·삭제는 문항 칸 안쪽 끝 ⋯ 메뉴로 숨긴다(확정 항목이라 없애지 않는다).
 *
 * **CF-S3**: 정본 행을 만드는 첫 저장은 **[자기소개서 작성 시작] 하나**다. 상단 바 "저장하기"는 이
 * 상태에서 늘 비활성이고 ⌘S도 아무 일을 하지 않는다 — 화면(`cover-letter-screen.tsx`)이 그 규칙을
 * 들고 있다. 순서는 **추출 → 성공 뒤 저장**이다(v5.20 정정, DM-3).
 */
import { toast } from "sonner"
import { isAiRejected, notifyAiRejected } from "@/components/common/ai-rejection"
import { submitFailedMessage } from "@/lib/data/labels"
import * as React from "react"
import { Info, Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AiErrorCode, CountBasis } from "@/types/db"
import { COVER_LETTER_DEFAULT_COUNT_BASIS, COVER_LETTER_DEFAULT_QUESTIONS, COVER_LETTER_MAX_QUESTIONS } from "@/lib/data/cover-letter-defaults"
import { CHAR_LIMIT_A12_NOTE, QUESTION_MAX_NOTE, QUESTION_MIN_NOTE } from "@/lib/data/cover-letter-copy"
import { COUNT_BASIS_LABELS } from "../labels"
import { useRequirementsFirst } from "../extract-first"
import { CharLimitInput, QuestionNoteField, QuestionTextField } from "./question-fields"
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
  const [noteOpen, setNoteOpen] = React.useState<Record<string, boolean>>({})
  const [deleting, setDeleting] = React.useState<number | null>(null)
  /** 글자 수 칸에 포커스가 있는 문항 — A12 안내를 그때 보인다 */
  const [limitFocus, setLimitFocus] = React.useState<string | null>(null)
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

  /**
   * [자기소개서 작성 시작] — 요건 선행 추출(필요할 때) → 저장. 결과를 버리지 않는다(2026-11-10 사용자 보고
   * "누르면 아무 동작도 안 해"): 추출이 AI 동의·키 문제로 **거절되면 `run`이 거절 값을 돌려줄 뿐 아무것도 그리지
   * 않아**, 버튼이 잠깐 돌고 멈춘 것처럼 보였다. 거절은 공통 `notifyAiRejected`(C-20 제목 토스트 + 연결 다시 읽기,
   * 버튼은 다음 클릭에 C-18/C-21로 바뀐다)로, 던진 오류는 저장 실패 문구로 알린다.
   */
  const startWriting = async () => {
    try {
      const r = await req.run(onStart)
      if (isAiRejected(r)) notifyAiRejected(r)
    } catch {
      toast.error(submitFailedMessage("자기소개서"))
    }
  }

  const patch = (i: number, p: Partial<QuestionForm>) => onChange(forms.map((f, idx) => (idx === i ? { ...f, ...p } : f)))
  const add = () => onChange([...forms, newQuestionForm(allocateSlot())])
  const remove = (i: number) => onChange(forms.filter((_, idx) => idx !== i))
  const full = forms.length >= COVER_LETTER_MAX_QUESTIONS

  return (
    <div className="space-y-6">
      {/* 머리 (시안 2) */}
      <div className="space-y-1.5">
        <h2 className="text-lg leading-7 font-semibold">자기소개서 문항 추가</h2>
        <p className="text-base text-muted-foreground">작성하고자 하는 자기소개서 문항을 입력해주세요</p>
      </div>

      {/* 문항 한 줄 = [문항 입력(넓게, 안쪽 끝 ⋯)] [글자 수 + "자"] — 라벨 없음(sr-only, 번호 포함), 자리 표시 = 기본 문항 문구.
          글자 수 칸의 오른쪽 끝이 아래 [자기소개서 작성 시작]의 오른쪽 끝과 맞는다 (59 QA UQ-767) */}
      <ol className="space-y-4">
        {forms.map((f, i) => {
          const idPrefix = `qs-${f.question_id}`
          const open = noteOpen[f.question_id] || Boolean(f.user_note)
          const nonDefaultBasis = f.count_basis !== COVER_LETTER_DEFAULT_COUNT_BASIS
          return (
            <li key={f.question_id} className="space-y-2">
              <div className="flex items-start gap-3">
                <span className="sr-only">문항 {i + 1}</span>
                <QuestionTextField
                  idPrefix={idPrefix}
                  number={i + 1}
                  trailing={
                    <>
                {/* 기준·메모·삭제는 시안 기본 화면에 없다 → 문항 칸 안 오른쪽 끝 작은 ⋯ 메뉴로 숨긴다 `[UI-가정]` (확정 항목이라 없애지 않는다, 59 QA UQ-767) */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`문항 ${i + 1} 설정`}>
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">글자 수 기준</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={f.count_basis} onValueChange={(v) => patch(i, { count_basis: v as CountBasis })}>
                      <DropdownMenuRadioItem value="with_spaces">{COUNT_BASIS_LABELS.with_spaces}</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="without_spaces">{COUNT_BASIS_LABELS.without_spaces}</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled={open} onSelect={() => setNoteOpen((s) => ({ ...s, [f.question_id]: true }))}>
                      <Plus aria-hidden />
                      메모 추가
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={forms.length <= 1}
                      onSelect={() => {
                        // 답변·제목이 없는 문항은 확인 없이 지운다 (UX S-46 문항 편집)
                        if (f.body.trim() || f.answer_title.trim()) setDeleting(i)
                        else remove(i)
                      }}
                    >
                      <Trash2 aria-hidden />
                      문항 삭제
                    </DropdownMenuItem>
                    {forms.length <= 1 ? <p className="px-2 py-1 text-xs text-muted-foreground">{QUESTION_MIN_NOTE}</p> : null}
                  </DropdownMenuContent>
                </DropdownMenu>
                    </>
                  }
                  compact
                  placeholder={COVER_LETTER_DEFAULT_QUESTIONS[i]?.question_text ?? "작성하고자 하는 문항을 입력해 주세요"}
                  value={f.question_text}
                  error={errors[i]?.question_text}
                  onChange={(v) => patch(i, { question_text: v })}
                  inputRef={(el) => {
                    textRefs.current[i] = el
                  }}
                />
                <CharLimitInput
                  id={`${idPrefix}-limit`}
                  number={i + 1}
                  value={f.char_limit}
                  invalid={Boolean(errors[i]?.char_limit)}
                  describedBy={`${errors[i]?.char_limit ? `${idPrefix}-limit-error ` : ""}${limitFocus === f.question_id ? `${idPrefix}-limit-note` : ""}`.trim() || undefined}
                  onChange={(v) => patch(i, { char_limit: v })}
                  onFocus={() => setLimitFocus(f.question_id)}
                  onBlur={() => setLimitFocus((x) => (x === f.question_id ? null : x))}
                  inputRef={(el) => {
                    limitRefs.current[i] = el
                  }}
                />
              </div>
              {errors[i]?.char_limit ? (
                <p id={`${idPrefix}-limit-error`} className="text-sm text-destructive" role="alert">
                  {errors[i]?.char_limit}
                </p>
              ) : null}
              {/* A12 안내 — 글자 수 칸에 포커스가 있을 때만 `[UI-가정]` */}
              {limitFocus === f.question_id ? (
                <p id={`${idPrefix}-limit-note`} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {CHAR_LIMIT_A12_NOTE}
                </p>
              ) : null}
              {/* 기본(공백 포함)이 아닐 때만 기준을 한 줄로 알린다 `[UI-가정]` */}
              {nonDefaultBasis ? <p className="text-xs text-muted-foreground">{COUNT_BASIS_LABELS[f.count_basis]} 기준으로 세요</p> : null}
              {open ? <QuestionNoteField idPrefix={idPrefix} form={f} errors={errors[i]} onChange={(p) => patch(i, p)} /> : null}
            </li>
          )
        })}
      </ol>

      {/* 마지막 줄 (시안 2): 왼쪽 고스트 "+ 문항 추가 n/5", 오른쪽 주 버튼 하나 (R-C8 · CF-S3 — 상단 바 "저장하기"는 비활성) */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" className="-ml-3 text-muted-foreground" disabled={full} onClick={add}>
            <Plus aria-hidden />
            문항 추가 <span className="tabular-nums">{forms.length}/{COVER_LETTER_MAX_QUESTIONS}</span>
          </Button>
          <Button disabled={starting || req.busy} onClick={() => void startWriting()}>
            {starting || req.busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            자기소개서 작성 시작
          </Button>
        </div>
        {full ? <p className="text-sm text-muted-foreground">{QUESTION_MAX_NOTE}</p> : null}
        {forms.length <= 1 ? <p className="text-xs text-muted-foreground">{QUESTION_MIN_NOTE}</p> : null}
        {/* ST-WAIT-JD("공고 요건 정리 중") · 실패는 같은 자리 C-20 inline (입력 원인이면 "공고 원문 고치기") */}
        <div className="flex justify-end empty:hidden">{req.slot}</div>
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
