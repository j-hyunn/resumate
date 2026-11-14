"use client"

/**
 * S-46 **작성 상태 — "자소서" 탭** (UX v5.20 S-46 "자소서 탭" / design-system 5.12 "자소서 탭 — 문항 블록").
 *
 * 문항마다: 문항 이름(읽기 전용) + **제목**(`answer_title`, 글자 수 제한에 **미포함** CF-6) + 내용(늘 입력
 * 상태) + 글자 수 표시 + ⋯ 메뉴(문항 편집 · 이 문항 복사 · 위로/아래로 이동 · 문항 삭제) + 메모(접힘) +
 * **C-11 "사용한 경력·프로젝트"**(접힘, CF-S1·CF-S2).
 *
 * **문항 편집**은 제자리 편집 모드다(모달 아님) — 문항 문장·글자 수 제한·기준·메모를 여기서 모두 고친다.
 * **P-30**: 문항 설정 상태로 돌아갈 입구를 따로 만들지 않는다(머리 ⋯에 "문항 설정" 항목 없음).
 * 값은 폼에만 남고 저장은 상단 바 "저장하기"다.
 */
import * as React from "react"
import { ChevronDown, ChevronUp, Copy, ListChecks, MoreHorizontal, Pencil, Plus, Sparkles, Trash2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DocTextarea, DocTitleInput, flashElement, highlightRange } from "@/components/common/doc-inputs"
import { useAiConnection } from "@/components/common/ai-connection-context"
import type { EvidenceView } from "@/lib/data/evidence"
import { QUESTION_MAX_NOTE, QUESTION_MIN_NOTE } from "@/lib/data/cover-letter-copy"
import { COVER_LETTER_LIMITS, COVER_LETTER_MAX_QUESTIONS } from "@/lib/data/cover-letter-defaults"
import { COUNT_BASIS_LABELS } from "../labels"
import { QuestionNoteField, QuestionSettingsRow, QuestionTextField } from "./question-fields"
import { DeleteQuestionDialog } from "./delete-question-dialog"
import { SourcesUsed } from "./sources-used"
import { allClipboardText, countChars, newQuestionForm, questionClipboardText, type QuestionErrors, type QuestionForm } from "./question-form"

/** 자리 표시가 남아 있으면 복사 뒤 C-08 경고를 토스트에 붙인다 `[UI-가정]` */
const PLACEHOLDER_RE = /\[[^[\]]*확인[^[\]]*\]/

export function AnswerTab({
  forms,
  allocateSlot,
  errors,
  evidence,
  onChange,
  onCopied,
  onOpenPanel,
  onRevealProposal,
  /** 반영하지 않은 제안이 있는 문항 slot (패널이 붙으면 채워진다 — 지금은 빈 집합) */
  unappliedSlots,
  highlight,
  meta = null,
}: {
  forms: QuestionForm[]
  /** 새 문항의 슬롯 — 화면의 발급기가 준다 (안정 키, 재사용 금지 — UQ-740) */
  allocateSlot: () => string
  errors: Record<number, QuestionErrors>
  /** `getEvidence("application_document", docId)` — 키는 `{slot}.sources.{n}` / `{slot}.blocks.{block_id}` */
  evidence: Record<string, EvidenceView[]>
  onChange: (next: QuestionForm[]) => void
  /** "전체 복사" 성공 때 `first_copied_at`을 남긴다 */
  onCopied: () => void
  /** 패널을 열고 입력창에 포커스 ("AI와 초안 쓰기") */
  onOpenPanel: () => void
  /** "AI 제안 있음" → 패널을 열고 그 문항의 제안 [자세히] 자리로 (UP-4 · UQ-749) */
  onRevealProposal: (slot: string) => void
  unappliedSlots?: Set<string>
  /** C-02 근거 구간 강조 (`?range=`) */
  highlight?: { slot: string; start: number; end: number } | null
  /** 요약 한 줄 "문항 n개 · 답변 m개 · 마지막 수정 …" (머리에서 이 탭 머리로 옮겼다 — 58 런) */
  meta?: string | null
}) {
  const connection = useAiConnection()
  const locked = connection !== null && !connection.active_provider
  const [editing, setEditing] = React.useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  const [noteOpen, setNoteOpen] = React.useState<Record<string, boolean>>({})
  const [deleting, setDeleting] = React.useState<number | null>(null)
  /** 지금 내용을 쓰는 문항 (글자 수 줄을 그때 보인다) */
  const [focused, setFocused] = React.useState<string | null>(null)
  const bodyRefs = React.useRef<Record<string, HTMLElement | null>>({})

  const patch = (i: number, p: Partial<QuestionForm>) => onChange(forms.map((f, idx) => (idx === i ? { ...f, ...p } : f)))
  const remove = (i: number) => onChange(forms.filter((_, idx) => idx !== i))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= forms.length) return
    const next = [...forms]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const full = forms.length >= COVER_LETTER_MAX_QUESTIONS
  const anyAnswer = forms.some((f) => f.body.trim())

  // C-02 근거 구간 강조: 그 문항으로 스크롤하고 구간을 선택한다 (5.9 규칙)
  const highlightDone = React.useRef(false)
  React.useEffect(() => {
    if (!highlight || highlightDone.current) return
    const el = bodyRefs.current[highlight.slot]
    const t = window.setTimeout(() => {
      highlightDone.current = true
      if (!highlightRange(el, { start: highlight.start, end: highlight.end })) toast("지금 답변에서 그 문장을 찾지 못했어요")
    }, 120)
    return () => window.clearTimeout(t)
  }, [highlight])

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      toast("복사하지 못했어요. 직접 선택해 복사해 주세요")
      return
    }
    // 자리 표시가 남으면 C-08 경고를 붙인다 `[UI-가정]`
    toast.success(PLACEHOLDER_RE.test(text) ? `${what}를 복사했어요. 확인이 필요한 자리 표시가 남아 있어요` : `${what}를 복사했어요`)
  }

  return (
    <div className="space-y-6">
      {/* 머리 (시안 3): 굵은 "자기소개서" + 오른쪽 ⋯ — 전체 복사는 이 메뉴로 옮겼다 `[UI-가정]` */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 className="text-xl leading-8 font-bold">자기소개서</h2>
          {meta ? <p className="text-xs text-muted-foreground tabular-nums">{meta}</p> : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="mt-1" aria-label="자기소개서 본문 메뉴">
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                void copy(allClipboardText(forms), "자기소개서 전체")
                onCopied()
              }}
            >
              <Copy aria-hidden />
              전체 복사
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 빈 상태 — 답변이 하나도 없을 때만 (R-CF-8). 시안의 빈 문서 모양을 해치지 않게 상자 대신 한 묶음의 작은 글 `[UI-가정]` */}
      {!anyAnswer ? (
        <div className="space-y-1.5 text-sm text-muted-foreground">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Sparkles className="size-4 text-ai" aria-hidden />
            <span>
              {forms.length <= 3
                ? "아직 답변이 비어 있어요. 오른쪽 Resumate AI와 대화하면 바로 초안을 제안해 드려요"
                : "아직 답변이 비어 있어요. 오른쪽 Resumate AI와 대화하면 먼저 1~3번 문항부터 초안을 제안해 드려요"}
            </span>
            {locked ? null : (
              <Button variant="link" size="sm" className="h-auto px-0" onClick={onOpenPanel}>
                AI와 초안 쓰기
              </Button>
            )}
          </p>
        </div>
      ) : null}

      <ol className="space-y-10">
        {forms.map((f, i) => {
          const idPrefix = `qa-${f.question_id}`
          const isEditing = Boolean(editing[f.question_id])
          const isCollapsed = Boolean(collapsed[f.question_id])
          const noteShown = noteOpen[f.question_id] || Boolean(f.user_note)
          const limit = Number(f.char_limit) || 0
          const count = countChars(f.body, f.count_basis)
          const over = limit > 0 ? count - limit : 0
          const hasProposal = unappliedSlots?.has(f.slot) ?? false
          // 글자 수는 S-10 STAR 칸 규칙처럼 **필요할 때만**: 이 문항을 쓰는 중 · 90% 이상 · 초과 `[UI-가정]`
          const showCount = focused === f.question_id || over > 0 || (limit > 0 && count >= limit * 0.9) || Boolean(errors[i]?.body)
          return (
            <li key={f.question_id} className="group/question space-y-1">
              {/* 문항 문장 (작은 회색, 읽기 전용) + 작게 드러나는 표식·메뉴 */}
              <div className="flex items-start gap-2">
                {isEditing ? (
                  <span className="min-w-0 flex-1 text-sm text-muted-foreground tabular-nums">문항 {i + 1} 편집</span>
                ) : (
                  <p className="min-w-0 flex-1 pt-1 text-sm text-muted-foreground">
                    <span className="sr-only">문항 {i + 1}. </span>
                    {f.question_text || "문항을 입력해 주세요"}
                  </p>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {hasProposal ? (
                    <button
                      type="button"
                      className="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      onClick={() => onRevealProposal(f.slot)}
                    >
                      <Badge variant="ai" className="h-5 gap-1 px-1.5">
                        <Sparkles className="size-3" aria-hidden />
                        AI 제안 있음
                      </Badge>
                    </button>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`문항 ${i + 1} 메뉴`} className={REVEAL}>
                        <MoreHorizontal aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing((s) => ({ ...s, [f.question_id]: true }))}>
                        <Pencil aria-hidden />
                        문항 편집
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void copy(questionClipboardText(f, i + 1), `문항 ${i + 1}`)}>
                        <Copy aria-hidden />
                        이 문항 복사
                      </DropdownMenuItem>
                      {!noteShown ? (
                        <DropdownMenuItem onSelect={() => setNoteOpen((s) => ({ ...s, [f.question_id]: true }))}>
                          <ListChecks aria-hidden />
                          메모 추가
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => setCollapsed((s) => ({ ...s, [f.question_id]: !isCollapsed }))}>
                        {isCollapsed ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
                        {isCollapsed ? "펼치기" : "접기"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {/* 순서 변경은 메뉴로만 — 드래그를 두지 않는다(키보드와 같은 길) */}
                      <DropdownMenuItem disabled={i === 0} onSelect={() => move(i, -1)}>
                        <ChevronUp aria-hidden />
                        위로 이동
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={i === forms.length - 1} onSelect={() => move(i, 1)}>
                        <ChevronDown aria-hidden />
                        아래로 이동
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={forms.length <= 1}
                        onSelect={() => {
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
                </span>
              </div>

              {/* 문항 편집 = 제자리 편집 모드 (P-30 — 이것이 문항 설정으로 돌아갈 입구를 대신한다) */}
              {isEditing ? (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                  <QuestionTextField
                    idPrefix={`${idPrefix}-edit`}
                    value={f.question_text}
                    error={errors[i]?.question_text}
                    onChange={(v) => patch(i, { question_text: v })}
                  />
                  <QuestionSettingsRow
                    idPrefix={`${idPrefix}-edit`}
                    form={f}
                    errors={errors[i]}
                    noteOpen={noteShown}
                    onOpenNote={() => setNoteOpen((s) => ({ ...s, [f.question_id]: true }))}
                    onChange={(p) => patch(i, p)}
                  />
                  {noteShown ? <QuestionNoteField idPrefix={`${idPrefix}-edit`} form={f} errors={errors[i]} onChange={(p) => patch(i, p)} /> : null}
                  <div className="flex justify-end">
                    <Button variant="secondary" size="sm" onClick={() => setEditing((s) => ({ ...s, [f.question_id]: false }))}>
                      확인
                    </Button>
                  </div>
                </div>
              ) : null}

              {isCollapsed ? null : (
                <>
                  {/* 제목 — L-02 문서형 입력 `DocTitleInput`(S-10·S-44 머리 제목과 같은 것), 본문 크기로. 글자 수에 넣지 않는다 (CF-6) */}
                  <DocTitleInput
                    label={`문항 ${i + 1} 답변 제목`}
                    aria-required={false}
                    value={f.answer_title}
                    maxLength={COVER_LETTER_LIMITS.answer_title}
                    placeholder="제목"
                    invalid={Boolean(errors[i]?.answer_title)}
                    className="text-base leading-7 font-bold"
                    onChange={(e) => patch(i, { answer_title: e.target.value })}
                  />
                  {errors[i]?.answer_title ? (
                    <p className="text-sm text-destructive" role="alert">
                      {errors[i]?.answer_title}
                    </p>
                  ) : null}

                  {/* 내용 — L-02 문서형 입력 `DocTextarea`(S-10 STAR · S-44 본문과 같은 것), 내용만큼 자란다 */}
                  <DocTextarea
                    ref={(el) => {
                      bodyRefs.current[f.slot] = el
                    }}
                    aria-label={`문항 ${i + 1} 내용`}
                    aria-invalid={errors[i]?.body ? true : undefined}
                    grow
                    className="min-h-12"
                    value={f.body}
                    placeholder="내용"
                    onFocus={() => setFocused(f.question_id)}
                    onBlur={() => setFocused((x) => (x === f.question_id ? null : x))}
                    onValueChange={(v) => {
                      patch(i, { body: v })
                      // 본문을 고치면 근거 구간 강조를 지운다
                      highlightDone.current = true
                    }}
                  />

                  {/* 글자 수 표시 (A12·CL-A4) — 내용만 센다 */}
                  {showCount ? (
                    <div className="space-y-0.5">
                      <p
                        className={
                          over > 0
                            ? "flex items-center gap-1.5 text-xs font-medium text-warning-subtle-foreground tabular-nums"
                            : "text-xs font-medium text-muted-foreground tabular-nums"
                        }
                      >
                        {over > 0 ? <TriangleAlert className="size-3.5 text-warning" aria-hidden /> : null}
                        현재 {count.toLocaleString("ko-KR")}자 / 제한 {limit.toLocaleString("ko-KR")}자({COUNT_BASIS_LABELS[f.count_basis]})
                      </p>
                      {over > 0 ? (
                        <p className="text-xs text-warning-subtle-foreground">
                          {over <= Math.round(limit * 0.1)
                            ? `제한보다 ${over.toLocaleString("ko-KR")}자 많아요. AI 보정 범위(최대 10% 초과) 안이라 그대로 두었어요. 제출처 제한을 확인해 주세요`
                            : // [UI-가정] 110%를 넘으면 수만 알린다
                              `제한보다 ${over.toLocaleString("ko-KR")}자 많아요`}
                        </p>
                      ) : null}
                      {errors[i]?.body ? (
                        <p className="text-sm text-destructive" role="alert">
                          {errors[i]?.body}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {/* C-11 (접힘) — 근거의 원천은 그 문항 초안 제안의 sources[] (CF-S1). 근거가 없으면 그리지 않는다 */}
                  <SourcesUsed items={sourcesOf(evidence, f.slot)} questionNumber={i + 1} />

                  {/* 메모 (접힘, CF-A10) — ⋯ "메모 추가"로 펼친다. 값이 있으면 펼친 채로 */}
                  {!isEditing && noteShown ? <QuestionNoteField idPrefix={idPrefix} form={f} errors={errors[i]} onChange={(p) => patch(i, p)} /> : null}
                </>
              )}
            </li>
          )
        })}
      </ol>

      {/* "+ 문항 추가 n/5" — 문항 설정 상태와 같은 고스트 버튼 (작성 상태에도 있다, CL-8) */}
      <div className="space-y-1.5">
        <Button
          variant="ghost"
          className="-ml-3 text-muted-foreground"
          disabled={full}
          onClick={() => {
            const next = newQuestionForm(allocateSlot())
            onChange([...forms, next])
            setEditing((s) => ({ ...s, [next.question_id]: true }))
            window.setTimeout(() => flashElement(document.getElementById(`qa-${next.question_id}-edit-text`)), 60)
          }}
        >
          <Plus aria-hidden />
          문항 추가 <span className="tabular-nums">{forms.length}/{COVER_LETTER_MAX_QUESTIONS}</span>
        </Button>
        {full ? <p className="text-sm text-muted-foreground">{QUESTION_MAX_NOTE}</p> : null}
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

/**
 * 문항 ⋯ 메뉴 — 시안처럼 평소에는 숨기고 그 문항에 마우스를 올리거나 포커스가 들어올 때 보인다 `[UI-가정]`.
 * 마우스가 없는 기기(터치)는 늘 보인다. 메뉴가 열려 있는 동안도 보인다.
 */
const REVEAL =
  "[@media(hover:hover)]:opacity-0 group-hover/question:opacity-100 group-focus-within/question:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"

/**
 * 그 문항의 근거 목록 — `{slot}.sources.{n}` 키를 **n 순서대로** 모은다(주 근거가 먼저, CF-S2:
 * 화면이 다시 정렬하지 않는다).
 */
function sourcesOf(evidence: Record<string, EvidenceView[]>, slot: string): EvidenceView[] {
  const prefix = `${slot}.sources.`
  return Object.keys(evidence)
    .filter((k) => k.startsWith(prefix))
    .sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)))
    .flatMap((k) => evidence[k])
}
