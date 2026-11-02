"use client"

/**
 * S-36 정리 결과 미리보기: 소속 칸(제안 [연결][아니요] / 직접 고르기, 보강 모드는 읽기 전용),
 * 프로젝트 기본 정보, 상세 내용 카드(새로 / 기존), 필드별 C-15 상태, 검토 필요 요약,
 * 자리 표시("아직 없음" + "AI에게 물어봐 줘"), 완료 조건 표시.
 */
import * as React from "react"
import { Check, Circle, Lock, PenLine } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { CharCount } from "@/components/common/input-guide"
import type { ProjectDetailField, StructuredField } from "@/types/db"
import { DETAIL_FIELD_LABELS, formatPeriod } from "@/lib/data/labels"
import type { ChatView } from "@/lib/data/writing-chat-view"
import { ActorAmbiguousBadge, EmptyValue, FieldStateMark, NeedsReviewBox, SourceChips, fieldUiState } from "./source-chip"
import { slotFromPath, type ChatSlot } from "@/lib/data/writing-chat-slots"
import { WRITING_CHAT_FIELD_LIMITS } from "@/lib/data/writing-chat-limits"

export type DraftPatch =
  | { path: string; action: "edit"; value: string | number | null }
  | { path: string; action: "accept" | "reject" }

export interface PreviewHandlers {
  onPatch: (patch: DraftPatch) => Promise<void>
  onAffiliation: (aff: { experience_id: string | null; education_id: string | null } | "dismiss_suggestion") => Promise<void>
  onAsk: (slot: ChatSlot) => void
  /** UQ-483: "AI에게 물어봐 줘" sends a message → disabled while a reply runs or at the cap (39·40) */
  askDisabled?: boolean
  onJump: (messageId: string, quote?: string) => void
  onJumpToQuestion: () => void
}

const DETAIL_ORDER: ProjectDetailField[] = ["title", "situation", "task", "action", "result", "learnings"]
const REQUIRED_DETAIL: ProjectDetailField[] = ["title", "situation", "action"]

export function countNeedsReview(view: ChatView): number {
  const d = view.chat.structured_draft
  let n = 0
  const check = (f?: StructuredField<unknown>) => {
    if (f && f.review === "needs_review" && f.value !== null && f.value !== "") n += 1
  }
  Object.values(d.project ?? {}).forEach((f) => check(f as StructuredField<unknown>))
  for (const det of d.details ?? []) {
    Object.values(det.fields).forEach((f) => check(f as StructuredField<unknown>))
    for (const a of det.achievements) Object.values(a).forEach((f) => check(f as StructuredField<unknown>))
  }
  return n
}

export function DraftPreview({
  view,
  readOnly,
  busy,
  flashPaths,
  highlightMessageId,
  handlers,
}: {
  view: ChatView
  readOnly: boolean
  busy: boolean
  flashPaths: string[]
  highlightMessageId: string | null
  handlers: PreviewHandlers
}) {
  const { chat, project, existingDetail } = view
  const draft = chat.structured_draft
  const detail = draft.details?.[0]
  const numbers = chat.user_message_numbers
  const review = countNeedsReview(view)
  const augment = chat.mode === "augment_project"
  const ambiguous = (draft.clarifications ?? []).some((c) => c.kind === "actor_ambiguous" && c.field === "action")

  const fieldProps = (path: string) => ({
    path,
    readOnly: readOnly || busy,
    flash: flashPaths.includes(path),
    highlightMessageId,
    numbers,
    handlers,
  })

  const val = (f?: StructuredField<unknown>) => (f && f.value !== null && f.value !== "" ? f.value : null)
  const projectName = augment ? project?.name : val(draft.project?.name)
  const projectRole = augment ? project?.role : val(draft.project?.role)
  const detailVal = (k: ProjectDetailField) => existingDetail?.[k] ?? val(detail?.fields[k])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg leading-7 font-semibold">정리 결과</h2>
        {review > 0 ? (
          <Button
            variant="outline"
            size="sm"
            className="border-warning text-warning-subtle-foreground"
            onClick={() => {
              const el = document.querySelector<HTMLElement>("[data-needs-review]")
              el?.scrollIntoView({ block: "center" })
              el?.focus()
            }}
          >
            검토가 필요한 항목 {review}개
          </Button>
        ) : null}
      </div>

      <AffiliationField view={view} readOnly={readOnly || busy} handlers={handlers} />

      <section className="space-y-4" aria-label="프로젝트 기본 정보">
        <h3 className="text-base leading-6 font-semibold">프로젝트</h3>
        {augment ? (
          <div className="space-y-2 text-base">
            <ReadOnlyValue label="이름" value={project?.name} />
            <ReadOnlyValue label="역할" value={project?.role} />
            <ReadOnlyValue label="한 줄 요약" value={project?.summary} />
            {/* UQ-74: 기존 프로젝트의 기간·팀 규모·사용 기술도 읽기 전용으로 */}
            <ReadOnlyValue label="기간" value={project?.start_month ? formatPeriod(project.start_month, project.end_month) : null} />
            <ReadOnlyValue label="팀 규모" value={project?.team_size ? `${project.team_size}명` : null} />
            <ReadOnlyValue label="사용 기술(기존)" value={project?.skills.length ? project.skills.map((sk) => sk.name).join(", ") : null} />
          </div>
        ) : (
          <>
            <DraftField label="이름" required field={draft.project?.name} slot="name" maxChars={WRITING_CHAT_FIELD_LIMITS.name} {...fieldProps("project.name")} />
            <DraftField label="역할" required field={draft.project?.role} slot="role" maxChars={WRITING_CHAT_FIELD_LIMITS.role} {...fieldProps("project.role")} />
            <DraftField label="한 줄 요약" field={draft.project?.summary} {...fieldProps("project.summary")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <DraftField label="시작(YYYY-MM)" field={draft.project?.start_month} short {...fieldProps("project.start_month")} />
              <DraftField label="종료(YYYY-MM)" field={draft.project?.end_month} short {...fieldProps("project.end_month")} />
            </div>
            <DraftField label="팀 규모" field={draft.project?.team_size as StructuredField<unknown> | undefined} short numeric {...fieldProps("project.team_size")} />
          </>
        )}
        <div className="space-y-1.5">
          <p className="text-sm leading-5 font-medium">{augment ? "이번 대화에서 나온 사용 기술" : "사용 기술"}</p>
          {(draft.skills ?? []).length ? (
            <ul className="flex flex-wrap gap-2">
              {(draft.skills ?? []).map((s) => (
                <li key={s.value} className="flex items-center gap-1">
                  <Badge variant="secondary">{s.value}</Badge>
                  <SourceChips field={s} numbers={numbers} onJump={handlers.onJump} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyValue className="text-sm" />
          )}
        </div>
      </section>

      <Card className="gap-4 p-4" aria-label="상세 내용">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base leading-6 font-semibold">상세 내용</h3>
          {existingDetail ? <Badge variant="outline">기존 상세 내용에 추가</Badge> : <Badge variant="outline">새로</Badge>}
        </div>
        {DETAIL_ORDER.map((k) => {
          const path = `details.0.fields.${k}`
          if (existingDetail?.[k])
            return (
              <div key={k} className="space-y-1">
                <p className="flex items-center justify-between gap-2 text-sm leading-5 font-medium">
                  {DETAIL_FIELD_LABELS[k]}
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="size-3" aria-hidden />
                    기존 내용
                  </span>
                </p>
                <p className="text-base leading-[1.75] whitespace-pre-wrap text-muted-foreground">{existingDetail[k]}</p>
              </div>
            )
          return (
            <DraftField
              key={k}
              label={DETAIL_FIELD_LABELS[k]}
              required={REQUIRED_DETAIL.includes(k)}
              field={detail?.fields[k]}
              slot={k}
              long
              badge={k === "action" && ambiguous ? <ActorAmbiguousBadge onClick={handlers.onJumpToQuestion} /> : null}
              note={k === "action" && ambiguous ? "본인 역할 확인 중 — 팀이 한 일과 본인이 한 일을 AI가 묻고 있어요" : null}
              {...fieldProps(path)}
            />
          )
        })}
        {/* UQ-61: 정량 성과 필드도 C-15 네 상태 + 검토 필요 수락/거절 (details[0].achievements[i].{field}) */}
        <div className="space-y-2">
          <p className="text-sm leading-5 font-medium">정량 성과</p>
          {detail?.achievements.length ? (
            <ul className="space-y-3">
              {detail.achievements.map((a, i) => {
                const base = `details.0.achievements.${i}`
                return (
                  <li key={i} className="space-y-3 rounded-md border p-3" aria-label={`정량 성과 ${i + 1}`}>
                    <DraftField label="지표 이름" field={a.metric_name} maxChars={WRITING_CHAT_FIELD_LIMITS.metric_name} {...fieldProps(`${base}.metric_name`)} />
                    <div className="grid gap-3 sm:grid-cols-3">
                      <DraftField label="이전 값" field={a.value_before as StructuredField<unknown> | undefined} numeric decimal {...fieldProps(`${base}.value_before`)} />
                      <DraftField label="이후 값" field={a.value_after as StructuredField<unknown> | undefined} numeric decimal {...fieldProps(`${base}.value_after`)} />
                      <DraftField label="단위" field={a.unit} maxChars={WRITING_CHAT_FIELD_LIMITS.unit} {...fieldProps(`${base}.unit`)} />
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyValue className="text-sm" />
          )}
        </div>
      </Card>

      <section className="space-y-1.5 rounded-md bg-muted p-3 text-sm" aria-label="완료 조건">
        <p className="font-medium">완료 조건</p>
        <Condition met={Boolean(projectName && projectRole)} text="프로젝트: 이름·역할" />
        <Condition met={REQUIRED_DETAIL.every((k) => detailVal(k))} text="상세 내용: 제목·상황·행동" />
        <p className="text-muted-foreground">채우지 않아도 저장할 수 있어요. 덜 찬 항목은 작성 중으로 저장돼요</p>
      </section>
    </div>
  )
}

function Condition({ met, text }: { met: boolean; text: string }) {
  return (
    <p className="flex items-center gap-1.5">
      {met ? <Check className="size-4 text-success" aria-hidden /> : <Circle className="size-4 text-muted-foreground" aria-hidden />}
      {text}
      <span className="sr-only">{met ? " 채움" : " 비어 있음"}</span>
    </p>
  )
}

function ReadOnlyValue({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="space-y-0.5">
      <p className="flex items-center gap-2 text-sm font-medium">
        {label}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3" aria-hidden />
          기존 내용
        </span>
      </p>
      <p className="text-muted-foreground">{value ?? "—"}</p>
    </div>
  )
}

function DraftField({
  label,
  required,
  field,
  path,
  slot,
  readOnly,
  flash,
  highlightMessageId,
  numbers,
  handlers,
  long,
  short,
  numeric,
  decimal,
  badge,
  note,
  maxChars,
}: {
  /** v5.3 S-36 입력 길이 (구현 값 [가정]): over → C-07 글자 수 경고 */
  maxChars?: number
  label: string
  required?: boolean
  field?: StructuredField<unknown>
  path: string
  slot?: ChatSlot
  readOnly: boolean
  flash: boolean
  highlightMessageId: string | null
  numbers: Record<string, number>
  handlers: PreviewHandlers
  long?: boolean
  short?: boolean
  numeric?: boolean
  /** numeric with decimals (정량 성과 값) */
  decimal?: boolean
  badge?: React.ReactNode
  note?: React.ReactNode
}) {
  const [editing, setEditing] = React.useState(false)
  const [text, setText] = React.useState("")
  const state = fieldUiState(field)
  const highlighted = Boolean(highlightMessageId && field?.source_message_ids.includes(highlightMessageId))
  const id = `pv-${path.replace(/\./g, "-")}`
  const askSlot = slot ?? slotFromPath(path)

  const startEdit = () => {
    setText(field?.value === null || field?.value === undefined ? "" : String(field.value))
    setEditing(true)
  }
  const commit = async () => {
    const t = text.trim()
    const parsed = decimal ? Number(t.replace(/[^\d.-]/g, "")) : Number(t.replace(/[^\d]/g, ""))
    const value = t === "" ? null : numeric ? (Number.isFinite(parsed) ? parsed : null) : text
    setEditing(false)
    await handlers.onPatch({ path, action: "edit", value })
  }

  const over = maxChars !== undefined && text.length > maxChars
  const countId = `${id}-count`
  const shownLength = typeof field?.value === "string" ? field.value.length : 0
  const valueNode = editing ? (
    <div className="space-y-2">
      {long ? (
        <Textarea id={id} aria-label={label} autoFocus className="min-h-24 text-base leading-[1.75]" value={text} onChange={(e) => setText(e.target.value)} />
      ) : (
        <Input
          id={id}
          aria-label={label}
          autoFocus
          inputMode={numeric ? (decimal ? "decimal" : "numeric") : undefined}
          aria-describedby={maxChars !== undefined ? countId : undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      {maxChars !== undefined ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* [UI-가정] over the limit: 경고 + 적용 비활성 (the server would refuse the longer value) */}
          {over ? <p className="text-sm text-destructive">{maxChars}자 이내로 줄여 주세요</p> : <span />}
          <CharCount id={countId} count={text.length} limit={maxChars} />
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" onClick={commit} disabled={over}>
          적용
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          취소
        </Button>
      </div>
    </div>
  ) : state === "empty" ? (
    <div className="flex flex-wrap items-center gap-x-2">
      <EmptyValue />
      {!readOnly ? (
        <>
          {askSlot ? (
            <Button variant="link" size="sm" className="h-auto px-0" disabled={handlers.askDisabled} onClick={() => handlers.onAsk(askSlot)}>
              AI에게 물어봐 줘
            </Button>
          ) : null}
          <Button variant="link" size="sm" className="h-auto px-0" onClick={startEdit}>
            직접 입력
          </Button>
        </>
      ) : null}
    </div>
  ) : (
    <div className="flex items-start gap-2">
      <p className={cn("min-w-0 flex-1 whitespace-pre-wrap", long ? "text-base leading-[1.75]" : "text-base")}>{String(field?.value)}</p>
      {maxChars !== undefined && shownLength > maxChars ? (
        // [UI-가정] an AI value longer than the limit shows the count warning until it is edited
        <CharCount count={shownLength} limit={maxChars} className="mt-1 shrink-0" />
      ) : null}
      {!readOnly ? (
        <Button variant="ghost" size="icon-sm" className="size-11 lg:size-8" aria-label={`${label} 직접 수정`} onClick={startEdit}>
          <PenLine aria-hidden />
        </Button>
      ) : null}
    </div>
  )

  return (
    <div
      className={cn("space-y-1.5 rounded-md", (flash || highlighted) && "animate-field-flash", short && "max-w-xs")}
      data-path={path}
      data-source-ids={field?.source_message_ids.join(" ")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm leading-5 font-medium">
          {label}
          {required ? <span className="text-xs font-normal text-muted-foreground">필수</span> : null}
          {badge}
        </span>
        {state !== "needs_review" ? <FieldStateMark state={state} field={field} numbers={numbers} onJump={handlers.onJump} /> : null}
      </div>
      {state === "needs_review" && field && !editing ? (
        <div data-needs-review tabIndex={-1}>
          <NeedsReviewBox
            fieldLabel={label}
            field={field}
            numbers={numbers}
            onJump={handlers.onJump}
            disabled={readOnly}
            onAccept={() => void handlers.onPatch({ path, action: "accept" })}
            onReject={() => void handlers.onPatch({ path, action: "reject" })}
          >
            {valueNode}
          </NeedsReviewBox>
        </div>
      ) : (
        valueNode
      )}
      {note ? <p className="text-sm text-info-subtle-foreground">{note}</p> : null}
    </div>
  )
}

function AffiliationField({ view, readOnly, handlers }: { view: ChatView; readOnly: boolean; handlers: PreviewHandlers }) {
  const { chat, project, experiences, educations } = view
  const augment = chat.mode === "augment_project"
  const expId = augment ? project?.experience_id : chat.experience_id
  const eduId = augment ? project?.education_id : chat.education_id
  const current = expId
    ? `경력 · ${experiences.find((e) => e.id === expId)?.company_name ?? ""}`
    : eduId
      ? `교육 · ${educations.find((e) => e.id === eduId)?.institution_name ?? ""}`
      : null
  const suggestion = chat.structured_draft.affiliation_suggestion
  const suggestedName = suggestion
    ? suggestion.type === "experience"
      ? experiences.find((e) => e.id === suggestion.id)?.company_name
      : educations.find((e) => e.id === suggestion.id)?.institution_name
    : null
  const value = expId ? `exp:${expId}` : eduId ? `edu:${eduId}` : "none"

  return (
    <section className="space-y-1.5" aria-label="소속">
      <p className="flex items-center gap-2 text-sm leading-5 font-medium">
        소속
        {augment ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3" aria-hidden />
            기존 프로젝트의 소속
          </span>
        ) : null}
      </p>
      {augment || readOnly ? (
        <p className={current ? "text-base" : "text-muted-foreground"}>{current ?? "비어 있음"}</p>
      ) : (
        <Select
          value={value}
          onValueChange={(v) => {
            const [kind, id] = v.split(":")
            void handlers.onAffiliation({ experience_id: kind === "exp" ? id : null, education_id: kind === "edu" ? id : null })
          }}
        >
          <SelectTrigger aria-label="소속 직접 고르기" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">비어 있음 (기타 프로젝트)</SelectItem>
            {experiences.length ? (
              <SelectGroup>
                <SelectLabel>경력</SelectLabel>
                {experiences.map((e) => (
                  <SelectItem key={e.id} value={`exp:${e.id}`}>
                    {e.company_name ?? "회사명 없음"}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null}
            {educations.length ? (
              <SelectGroup>
                <SelectLabel>교육</SelectLabel>
                {educations.map((e) => (
                  <SelectItem key={e.id} value={`edu:${e.id}`}>
                    {e.institution_name ?? "기관명 없음"}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null}
          </SelectContent>
        </Select>
      )}
      {!augment && !readOnly && suggestion && suggestedName ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-ai/30 bg-ai-subtle p-3 text-sm text-ai-subtle-foreground" role="status">
          <span className="min-w-0 flex-1">
            &apos;{suggestedName}&apos; {suggestion.type === "experience" ? "경력" : "교육"}에 연결할까요?
          </span>
          <Button
            size="sm"
            onClick={() =>
              void handlers.onAffiliation(
                suggestion.type === "experience"
                  ? { experience_id: suggestion.id, education_id: null }
                  : { experience_id: null, education_id: suggestion.id },
              )
            }
          >
            연결
          </Button>
          <Button size="sm" variant="outline" onClick={() => void handlers.onAffiliation("dismiss_suggestion")}>
            아니요
          </Button>
        </div>
      ) : null}
    </section>
  )
}
