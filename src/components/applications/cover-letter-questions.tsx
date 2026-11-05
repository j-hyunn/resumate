"use client"

/**
 * S-18 자기소개서 문항 설정 (F-DOC-02, F-DOC-09). 문항 카드: 문항 · 글자 수 · 공백 기준 · 메모(300자).
 * 자동 저장(C-06). 추가 / 삭제(최소 1). "초안 생성" → S-19에서 문항 순서대로 스트리밍.
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Info, Loader2, Plus, Trash2 } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { CharCount, InputGuide } from "@/components/common/input-guide"
import { DataInsufficientGate } from "@/components/common/data-gate"
import { SaveStatus, useAutosave, type SaveState } from "@/components/common/save-status"
import { WaitJd } from "@/components/common/state-views"
import { AiRunButton } from "@/components/common/ai-run-button"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import type { AiConnection, AiErrorCode, CountBasis, DataReadiness, DraftSection } from "@/types/db"
import { routes } from "@/lib/routes"
import { COUNT_BASIS_LABELS } from "./labels"
import { useRestoreReturnParams } from "./shared"
import { addQuestionAction, deleteQuestionAction, saveQuestionAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"
import { EXTRACT_FIRST_NOTE } from "@/app/(dashboard)/(gated)/applications/_lib/jd-state"
import { useRequirementsFirst } from "./extract-first"
import { useAiConnection } from "@/components/common/ai-connection-context"

const NOTE_MAX = 300
/** v5.3 S-18: 문항은 초안당 최대 10개, 문항 문장 1,000자(공백 포함) — 구현 값 [가정] */
const MAX_QUESTIONS = 10
const QUESTION_MAX = 1_000

type QuestionPatch = Partial<Pick<DraftSection, "question_text" | "char_limit" | "count_basis" | "user_note">>

export function CoverLetterQuestions({
  applicationProjectId: apId,
  applicationName,
  draftId,
  sections,
  readiness,
  activeChatId,
  waitJd,
  extractFirst = false,
  extractFailPreview = null,
  gateChatFailure = null,
  failSave = false,
}: {
  applicationProjectId: string
  applicationName: string
  draftId: string
  sections: DraftSection[]
  readiness: DataReadiness
  activeChatId: string | null
  waitJd: boolean
  /** JD has no requirements yet → A13 요건 선행 추출 before generation */
  extractFirst?: boolean
  /** `?state=extract-failed*` */
  extractFailPreview?: AiErrorCode | null
  /** C-09 대화 시작 실패 분기 (?state=insufficient-chat-failed) */
  gateChatFailure?: AiErrorCode | null
  failSave?: boolean
}) {
  const router = useRouter()
  const previewWrite = usePreviewWriteGuard()
  // v5 S-18: 문항 편집·메모는 키 없이 가능, 생성 버튼만 C-18 인라인 / C-19
  const connection = useAiConnection(readiness.ai_connection)
  const locked = !!connection && !connection.active_provider
  const [states, setStates] = React.useState<Record<string, CardStatus>>({})
  const [adding, setAdding] = React.useState(false)
  const report = React.useCallback((id: string, s: CardStatus) => {
    setStates((prev) => (prev[id]?.state === s.state && prev[id]?.savedAt === s.savedAt && prev[id]?.empty === s.empty ? prev : { ...prev, [id]: s }))
  }, [])

  // header save status = worst of the cards
  const all = Object.values(states)
  const failed = all.find((s) => s.state === "failed")
  const saving = all.some((s) => s.state === "saving")
  const lastSaved = all.reduce<Date | null>((m, s) => (s.savedAt && (!m || s.savedAt > m) ? s.savedAt : m), null)
  const headerState: SaveState = failed ? "failed" : saving ? "saving" : lastSaved ? "saved" : "idle"

  const add = async () => {
    if (previewWrite.stop()) return
    setAdding(true)
    await addQuestionAction(draftId)
    setAdding(false)
    router.refresh()
  }
  const remove = async (sectionId: string) => {
    if (previewWrite.stop()) return
    const ok = await deleteQuestionAction(draftId, sectionId)
    if (!ok) toast.error("문항은 1개 이상 있어야 해요")
    router.refresh()
  }

  // v5.3 A13: requirements are extracted here first (separate request, "공고 요건 정리 중"); a failure
  // shows C-20 under the button and generation does not start. Then S-19 starts the queue.
  const req = useRequirementsFirst(apId, { needed: extractFirst, rerunLabel: "전체 문항 생성", previewFail: extractFailPreview, jdEditFrom: { from: "questions", draft: draftId } })
  const [going, setGoing] = React.useState(false)
  const goGenerate = async (target: string) => {
    setGoing(true)
    try {
      // UQ-703: S-19 reads the stored questions, so typed edits go first (unmount would save them too, but late)
      if (target === "all") await Promise.all(Object.values(states).map((s) => s.flush()))
      router.push(`${routes.draft(apId, draftId)}?generate=${target}`)
    } catch {
      setGoing(false)
    }
  }

  // C-10 → back on S-18: clear the cover_letter return target (A3 UQ-63)
  useRestoreReturnParams(apId, "cover_letter")

  const ready = readiness.features.draft.ready
  // A3 UQ-77: 전체 생성 = 아직 초안이 없는 문항만 (S-19 queue와 같은 기준)
  const pendingSections = sections.filter((s) => !s.ai_content?.blocks.length)
  // UQ-703: an emptied field isn't saved (W3-9), so the stored text is old — judge by what the card shows
  const anyEmpty = pendingSections.some((s) => states[s.id]?.empty ?? !s.question_text?.trim())
  const allDone = pendingSections.length === 0

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <SaveStatus state={headerState} savedAt={lastSaved} onRetry={failed?.retry} />
      </div>
      <ol className="space-y-4">
        {sections.map((s, i) => (
          <li key={s.id}>
            <QuestionCard
              section={s}
              index={i + 1}
              canDelete={sections.length > 1}
              onDelete={() => void remove(s.id)}
              onStatus={report}
              failSave={failSave}
              generate={{
                connection,
                disabled: waitJd || !ready || req.busy,
                draftHref: routes.draft(apId, draftId),
                onGenerate: () => req.run(() => goGenerate(s.id)),
              }}
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={add} disabled={adding || sections.length >= MAX_QUESTIONS}>
          {adding ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          문항 추가
        </Button>
        {sections.length >= MAX_QUESTIONS ? (
          // [UI-가정] 문구 (G-39, P-13)
          <span className="text-sm text-muted-foreground">문항은 {MAX_QUESTIONS}개까지 추가할 수 있어요</span>
        ) : null}
      </div>

      <Card className="gap-3 p-5">
        <h2 className="text-lg leading-7 font-semibold">초안 생성</h2>
        <p className="text-sm text-muted-foreground">
          문항마다 사용할 경력·프로젝트를 먼저 고르고, 고른 근거와 메모·공고 내용만으로 글자 수에 맞춰 써요
        </p>
        {!ready && !locked ? (
          <DataInsufficientGate
            feature="draft"
            featureLabel="자기소개서"
            returnFeature="cover_letter"
            readiness={readiness}
            applicationProjectId={apId}
            applicationName={applicationName}
            returnHref={routes.draftQuestions(apId, draftId)}
            returnParams={{ draft_id: draftId }}
            activeChatId={activeChatId}
            chatFailure={gateChatFailure}
          />
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <AiRunButton
                lock={{ entry: "draft", feature: "cover_letter", actionName: "전체 문항 생성" }}
                onRun={() => req.run(() => goGenerate("all"))}
                pending={going}
                disabled={waitJd || anyEmpty || allDone || req.busy}
                connection={connection}
                footer={req.needed && !locked && !req.busy ? <p className="text-sm leading-5 text-muted-foreground">{EXTRACT_FIRST_NOTE}</p> : null}
              >
                전체 문항 생성
              </AiRunButton>
              {sections.some((x) => x.ai_content?.blocks.length) ? (
                <Button variant="outline" asChild>
                  <Link href={routes.draft(apId, draftId)}>초안 편집기 열기</Link>
                </Button>
              ) : null}
            </div>
            {req.slot ? (
              req.slot
            ) : waitJd ? (
              <WaitJd />
            ) : allDone ? (
              // [UI-가정]
              <p className="text-sm text-muted-foreground">모든 문항에 초안이 있어요. 초안 편집기에서 문항별로 다시 생성할 수 있어요</p>
            ) : anyEmpty ? (
              // [UI-가정]
              <p className="text-sm text-muted-foreground">비어 있는 문항을 채우면 생성할 수 있어요</p>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  )
}

/** What a card tells the page: its save state, a way to save now, and whether its question field is blank on screen */
type CardStatus = { state: SaveState; savedAt: Date | null; retry: () => void; flush: () => Promise<void>; empty: boolean }

function QuestionCard({
  section,
  index,
  canDelete,
  onDelete,
  onStatus,
  failSave,
  generate,
}: {
  section: DraftSection
  index: number
  canDelete: boolean
  onDelete: () => void
  onStatus: (id: string, s: CardStatus) => void
  failSave: boolean
  /** A3 UQ-241: "이 문항만 생성" (C-18 인라인 / C-19) → S-19 ?generate={id} */
  generate: { connection: AiConnection | null; disabled: boolean; draftHref: string; onGenerate: () => Promise<unknown> }
}) {
  const [question, setQuestion] = React.useState(section.question_text ?? "")
  const [limit, setLimit] = React.useState(section.char_limit ? String(section.char_limit) : "")
  const [basis, setBasis] = React.useState<CountBasis>(section.count_basis ?? "with_spaces")
  const [note, setNote] = React.useState(section.user_note ?? "")
  const removed = React.useRef(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const autosave = useAutosave<QuestionPatch>({
    save: async (patch) => {
      if (removed.current) return // deleted card: don't write to a removed section (A3 UQ-67)
      if (Object.keys(patch).length === 0) return // only an emptied question so far: nothing to send (W3-9)
      await saveQuestionAction(section.id, patch, failSave)
    },
  })
  const pending = React.useRef<QuestionPatch>({})
  const queue = (patch: QuestionPatch) => {
    pending.current = { ...pending.current, ...patch }
    // W3-9: the contract refuses an empty question. Skip that field while it's empty (stored text stays), keep saving the others
    const { question_text: text, ...others } = pending.current
    autosave.schedule(text !== undefined && !text?.trim() ? others : pending.current)
  }
  const empty = !question.trim()
  React.useEffect(() => {
    onStatus(section.id, { state: autosave.state, savedAt: autosave.savedAt, retry: autosave.retry, flush: autosave.flush, empty })
  }, [autosave.state, autosave.savedAt, autosave.retry, autosave.flush, empty, onStatus, section.id])

  const p = `q-${section.id}`
  const hasDraft = !!section.ai_content?.blocks.length
  const generated = hasDraft
  return (
    <Card className="gap-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground tabular-nums">
          문항 {index}
          {generated ? " · 초안 있음" : ""}
        </p>
        {canDelete ? (
          <Button
            variant="destructive-ghost"
            size="sm"
            onClick={() => {
              if (hasDraft) setConfirmDelete(true)
              else {
                removed.current = true
                onDelete()
              }
            }}
            aria-label={`문항 ${index} 삭제`}
          >
            <Trash2 aria-hidden />
            삭제
          </Button>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${p}-text`}>
          문항 <span className="text-destructive" aria-hidden>*</span>
          <span className="sr-only">필수</span>
        </Label>
        <Input
          id={`${p}-text`}
          value={question}
          maxLength={QUESTION_MAX}
          onChange={(e) => {
            setQuestion(e.target.value)
            queue({ question_text: e.target.value })
          }}
          onBlur={() => void autosave.flush()}
          placeholder="예: 지원 동기를 작성해 주세요."
          aria-describedby={`${p}-text-count ${p}-text-empty`}
        />
        {/* [UI-가정] W3-9 */}
        {!question.trim() ? (
          <p id={`${p}-text-empty`} className="text-sm text-muted-foreground">
            문항을 입력하면 저장돼요
          </p>
        ) : null}
        {/* v5.3 S-18 문항 1,000자 — C-07 글자 수 규칙 (90%부터 경고색) */}
        {question.length >= QUESTION_MAX * 0.9 ? (
          <div className="flex justify-end">
            <CharCount id={`${p}-text-count`} count={question.length} limit={QUESTION_MAX} />
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${p}-limit`}>글자 수</Label>
          <Input
            id={`${p}-limit`}
            type="number"
            inputMode="numeric"
            min={100}
            max={5000}
            step={50}
            className="w-28 tabular-nums"
            value={limit}
            onChange={(e) => {
              setLimit(e.target.value)
              const n = Number(e.target.value)
              queue({ char_limit: Number.isFinite(n) && n > 0 ? Math.round(n) : null })
            }}
            onBlur={() => void autosave.flush()}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${p}-basis`}>공백 기준</Label>
          <Select
            value={basis}
            onValueChange={(v) => {
              setBasis(v as CountBasis)
              queue({ count_basis: v as CountBasis })
            }}
          >
            <SelectTrigger id={`${p}-basis`} className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="with_spaces">{COUNT_BASIS_LABELS.with_spaces}</SelectItem>
              <SelectItem value="without_spaces">{COUNT_BASIS_LABELS.without_spaces}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {/* v5.3 A12 글자 수 범위 안내 (design-system 6장 A3 "S-18 글자 수 안내") */}
      <p className="-mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          AI는 제한의 90~110% 안으로 맞춰요. <span className="font-medium text-foreground">최대 10%까지 넘을 수 있으니</span> 제출 전에 글자 수를 확인해 주세요
        </span>
      </p>
      <div className="space-y-1.5">
        <Label htmlFor={`${p}-note`}>문항 메모</Label>
        <Textarea
          id={`${p}-note`}
          value={note}
          maxLength={NOTE_MAX}
          className="min-h-24 text-base leading-[1.75]"
          onChange={(e) => {
            setNote(e.target.value)
            queue({ user_note: e.target.value })
          }}
          onBlur={() => void autosave.flush()}
          aria-describedby={`${p}-note-help`}
        />
        <div id={`${p}-note-help`} className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {/* [UI-가정] 메모 안내 문구 (v3 문구 없음) + S-18 포부 문항 힌트 */}
              강조하고 싶은 점이나 지원 이유를 남기면 AI가 초안에 반영해요
              {section.template_key === "future_plan" ? ". 회고 및 배운 점이 있으면 AI가 참고해요" : ""}
            </p>
            <CharCount count={note.length} limit={NOTE_MAX} />
          </div>
          <InputGuide guide="G-2" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        {hasDraft ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={generate.draftHref}>초안 보기</Link>
          </Button>
        ) : (
          <AiRunButton
            lock={{ entry: "draft", feature: "cover_letter", actionName: `문항 ${index} 이 문항만 생성` }}
            variant="outline"
            size="sm"
            connection={generate.connection}
            disabled={generate.disabled || !question.trim()}
            onRun={async () => {
              await autosave.flush()
              return generate.onGenerate()
            }}
          >
            이 문항만 생성
          </AiRunButton>
        )}
      </div>
      {/* C-05 패턴의 확인 — 초안이 있는 문항만 (A3 UQ-67, 기획 확인 P-A3-2) // [UI-가정] 문구 */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>문항 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              문항 {index}과 이 문항의 답변·직접 고친 내용·사용한 경력·프로젝트가 함께 삭제돼요. 되돌릴 수 없어요
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                removed.current = true
                setConfirmDelete(false)
                onDelete()
              }}
            >
              삭제
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
