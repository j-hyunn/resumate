"use client"

/**
 * S-46 자기소개서 작성 (UX v5.20 S-46 · L-02 1.3a / design-system 5.12).
 *
 * **한 주소 두 상태**(CF-A11): 자소서 정본 행(`application_documents`)이 없으면 **문항 설정 상태**,
 * 있으면 **작성 상태**. 행을 만드는 길은 `save_application_document` 첫 호출 하나이고, 그 호출은
 * **[자기소개서 작성 시작]**에서만 일어난다(**CF-S3** — 문항 설정 상태의 상단 바 "저장하기"는 늘
 * 비활성이고 ⌘S도 끈다). 대화 시작·턴·요건 추출은 행을 만들지 않는다.
 *
 * 작성 상태 본문은 왼쪽 탭 3개(**자소서** / **채용 공고**(S-15) / **인사이트**(S-16))다. 탭은 `?tab=`과
 * 짝이지만 **클라이언트 상태로 바꾸고 주소는 `replaceState`로만 맞춘다** — 서버 재렌더가 일어나면
 * 저장하지 않은 제목·본문이 사라지기 때문이다(CF-A12 "탭을 옮겨도 폼을 잃지 않는다").
 *
 * **CF-S1·CF-S2**: 저장 입력에 근거가 없다. `applied_proposals: [{writing_chat_id, slot, rev}]`만 보내고
 * 서버가 그 제안의 `sources[]`로 `evidence_links`를 만든다. 적용 제안이 없는 문항(손편집만)은 기존 근거
 * 행이 유지되므로 C-11이 갑자기 비지 않는다.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowUpRight, MoreHorizontal, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DocTitleInput, InlineField, InlineFields, PANEL_WIDTH } from "@/components/common/doc-inputs"
import { DocBody, DocHead, type DocPanelPlacement } from "@/components/common/shell/doc-body"
import {
  CrumbRow,
  PageShell,
  SaveButton,
  ShellBanners,
  StaleWriteDialog,
  preservationKey,
  useLeaveGuard,
  type SaveUiState,
} from "@/components/common/shell/page-shell"
import { ReturnBanner } from "@/components/common/return-banner"
import { DeleteConfirmDialog, type DeleteTarget } from "@/components/common/delete-confirm-dialog"
import { readNavOrigin } from "@/components/common/return-target"
import type { ApplicationDocument, DateString } from "@/types/db"
import type { EvidenceView } from "@/lib/data/evidence"
import { applicationDisplayName, formatRelative } from "@/lib/data/labels"
import { COVER_LETTER_MAX_QUESTIONS } from "@/lib/data/cover-letter-defaults"
import { PAGE_SAVE_SKIP_COPY } from "@/lib/data/career-v45-shared"
import { QUESTION_MAX_NOTE } from "@/lib/data/cover-letter-copy"
import { routes } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { deleteApplicationAction, markCoverLetterCopiedAction, saveCoverLetterDocumentAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"
import { useRestoreReturnParams } from "../shared"
import { AnswerTab } from "./answer-tab"
import { CoverLetterPanel } from "./cover-letter-panel"
import { useCoverLetterPanel } from "./use-cover-letter-panel"
import type { QuestionFill } from "./question-proposal-card"
import { QuestionSetup } from "./question-setup"
import {
  isUntouchedSeed,
  newQuestionForm,
  seedQuestionForms,
  toCoverLetterBody,
  toQuestionForms,
  validateQuestions,
  type QuestionErrors,
  type QuestionForm,
} from "./question-form"

export type CoverLetterTab = "cover_letter" | "jd" | "insight"

export interface CoverLetterScreenData {
  application_project_id: string
  name: string | null
  name_source: import("@/types/db").NameSource | null
  created_at: string
  deadline: DateString | null
  position_title: string | null
  source_url: string | null
  /** null = 문항 설정 상태 (CF-A11) */
  document: ApplicationDocument | null
  /** `getEvidence("application_document", doc.id)` — C-11 */
  evidence: Record<string, EvidenceView[]>
  /** 키가 있고 요건이 아직 없다 → [자기소개서 작성 시작]이 AI-01을 먼저 돌린다 */
  extract_first: boolean
  /** 패널 머리 "대화 기록 목록" (이 자기소개서의 대화) */
  chats: import("@/lib/data/cover-letter-chat-types").CoverLetterChatSummary[]
  /** `?chat=`으로 연 대화 */
  open_chat: import("@/lib/data/cover-letter-chat-types").CoverLetterChatView | null
  preview: { state: string | null; extractFail: import("@/types/db").AiErrorCode | null }
}

const PANEL_OPEN_KEY = "resumate:l02:cover_letter:panel"

export function CoverLetterScreen({
  data,
  initialTab,
  jdTab,
  insightTab,
  highlight,
}: {
  data: CoverLetterScreenData
  initialTab: CoverLetterTab
  /** 서버가 그린 "채용 공고" 탭(S-15 규칙) */
  jdTab: React.ReactNode
  /** 서버가 그린 "인사이트" 탭(S-16 규칙) */
  insightTab: React.ReactNode
  highlight?: { slot: string; start: number; end: number } | null
}) {
  const router = useRouter()
  const apId = data.application_project_id
  const previewState = data.preview.state

  // ---------- 폼 ----------
  const [doc, setDoc] = React.useState<ApplicationDocument | null>(data.document)
  const [forms, setForms] = React.useState<QuestionForm[]>(() => previewForms(data.document, previewState))
  const [baseline, setBaseline] = React.useState<string>(() => JSON.stringify(previewForms(data.document, previewState)))
  const [name, setName] = React.useState(data.name ?? "")
  const [deadline, setDeadline] = React.useState(data.deadline ?? "")
  const [headBaseline, setHeadBaseline] = React.useState({ name: data.name ?? "", deadline: data.deadline ?? "" })
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(data.document?.updated_at ?? null)
  const [errors, setErrors] = React.useState<Record<number, QuestionErrors>>(() =>
    previewState === "questions-invalid" ? validateQuestions(previewForms(data.document, previewState)).errors : {},
  )
  const [focusIndex, setFocusIndex] = React.useState<number | null>(null)
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [pageError, setPageError] = React.useState<string | null>(
    // `?state=too-many-questions` · `questions-max`: 서버 거부 문구를 그 자리에 그린다
    previewState === "too-many-questions" ? QUESTION_MAX_NOTE : null,
  )
  const [saveState, setSaveState] = React.useState<SaveUiState>(previewState === "save-failed" ? "failed" : "idle")
  const [savedAt, setSavedAt] = React.useState<string | null>(null)
  const [stale, setStale] = React.useState(previewState === "save-conflict")
  const [starting, setStarting] = React.useState(false)
  /**
   * 이번 방문에 [반영]한 제안 — **CF-S1: 저장 요청에 싣는 근거는 이것뿐이다**
   * (`applied_proposals: [{writingChatId, slot, rev}]`). 서버가 그 제안의 `draft.sources[]`로
   * `{slot}.sources.{n}` 근거를 다시 쓰고, 적용 제안이 없는 슬롯은 기존 근거를 유지한다.
   */
  const [applied, setApplied] = React.useState<Array<{ writingChatId: string; slot: string; rev: number }>>([])
  const [deleting, setDeleting] = React.useState<DeleteTarget | null>(null)
  const nameRef = React.useRef<HTMLInputElement | null>(null)

  const state: "questions" | "writing" = doc ? "writing" : "questions"
  const bodyChanged = JSON.stringify(forms) !== baseline
  const headChanged = name !== headBaseline.name || deadline !== headBaseline.deadline
  // 손대지 않은 기본 3문항만 있는 새 화면은 "변경 없음" (UX S-46 `[가정]`)
  const dirty =
    state === "questions" ? (!isUntouchedSeed(forms) && bodyChanged) || headChanged : bodyChanged || headChanged || applied.length > 0

  // ---------- 입력 보존 (1.3a — "지원 프로젝트 ID + cover_letter") ----------
  // 1.3a 입력 보존 키 — "지원 프로젝트 ID + cover_letter" (공용 헬퍼, 파운데이션 후속 ③)
  const preserveKey = preservationKey("cover_letter", apId, apId)
  const restored = React.useRef(false)
  React.useEffect(() => {
    if (restored.current) return
    restored.current = true
    try {
      const raw = window.localStorage.getItem(preserveKey)
      if (!raw) return
      const copy = JSON.parse(raw) as { forms: QuestionForm[]; name: string; deadline: string; base_updated_at: string | null }
      // U40-2: 이 복사본을 쓴 뒤 다른 곳에서 저장됐으면 버린다
      if ((copy.base_updated_at ?? null) !== (data.document?.updated_at ?? null)) {
        window.localStorage.removeItem(preserveKey)
        return
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration 뒤 한 번만 되살린다
      setForms(copy.forms)
      setName(copy.name)
      setDeadline(copy.deadline)
    } catch {
      /* storage unavailable */
    }
  }, [preserveKey, data.document?.updated_at])
  React.useEffect(() => {
    try {
      if (dirty) window.localStorage.setItem(preserveKey, JSON.stringify({ forms, name, deadline, base_updated_at: updatedAt }))
      else window.localStorage.removeItem(preserveKey)
    } catch {
      /* storage unavailable */
    }
  }, [dirty, forms, name, deadline, updatedAt, preserveKey])
  const clearPreserved = React.useCallback(() => {
    try {
      window.localStorage.removeItem(preserveKey)
    } catch {
      /* storage unavailable */
    }
  }, [preserveKey])

  // ---------- 탭 (주소는 replaceState로만 맞춘다) ----------
  const [tab, setTab] = React.useState<CoverLetterTab>(initialTab)
  const changeTab = React.useCallback((next: string) => {
    const value = (next === "jd" || next === "insight" ? next : "cover_letter") as CoverLetterTab
    setTab(value)
    const url = new URL(window.location.href)
    if (value === "cover_letter") url.searchParams.delete("tab")
    else url.searchParams.set("tab", value)
    window.history.replaceState(window.history.state, "", url.pathname + url.search)
  }, [])

  // ---------- 저장 (save_application_document 한 번 — 본문 + 머리 제목·마감일) ----------
  const formsRef = React.useRef(forms)
  React.useEffect(() => {
    formsRef.current = forms
  }, [forms])

  const runSave = React.useCallback(
    async (opts: { overwrite?: boolean; createRow?: boolean } = {}): Promise<boolean> => {
      const current = formsRef.current
      const { errors: errs, firstIndex } = validateQuestions(current)
      setErrors(errs)
      setFocusIndex(firstIndex)
      if (firstIndex !== null) {
        setSaveState("invalid")
        return false
      }
      if (name.length > 100) {
        setNameError("100자까지 쓸 수 있어요")
        setSaveState("invalid")
        nameRef.current?.focus()
        return false
      }
      if (current.length > COVER_LETTER_MAX_QUESTIONS) {
        setPageError(QUESTION_MAX_NOTE)
        setSaveState("invalid")
        return false
      }
      setSaveState("saving")
      setPageError(null)
      // 바뀐 키만 보낸다 (DM v4.15 `p_application_values`)
      const values: { name?: string; deadline?: DateString | null } = {}
      if (name !== headBaseline.name) values.name = name
      if (deadline !== headBaseline.deadline) values.deadline = (deadline || null) as DateString | null

      const r = await saveCoverLetterDocumentAction({
        application_project_id: apId,
        body: toCoverLetterBody(current),
        expected_updated_at: opts.overwrite ? null : updatedAt,
        // CF-S1: 근거 목록을 싣지 않고 반영한 제안만 보낸다
        applied_proposals: applied,
        application_values: Object.keys(values).length > 0 ? values : undefined,
      }).catch((e: unknown) => errorCode(e))

      if (typeof r === "string") {
        switch (r) {
          case "stale_write":
            setSaveState("stale")
            setStale(true)
            return false
          case "too_many_questions":
            setPageError(QUESTION_MAX_NOTE)
            setSaveState("invalid")
            return false
          case "invalid_fields":
            // 서버도 `char_limit`을 필수로 본다 — 같은 검증을 화면에서 이미 했으므로 안내만
            setPageError("글자 수 제한을 확인해 주세요")
            setSaveState("invalid")
            return false
          case "not_found":
            toast("자기소개서를 찾을 수 없어요")
            setSaveState("failed")
            return false
          default:
            setSaveState("failed")
            return false
        }
      }
      if (!r) {
        setSaveState("failed")
        return false
      }
      // 반환 9키(계약은 camelCase)로 머리를 다시 그린다 — 다시 읽지 않는다
      setUpdatedAt(r.updatedAt)
      setSavedAt(r.updatedAt)
      setBaseline(JSON.stringify(current))
      setName(r.name ?? "")
      setDeadline(r.deadline ?? "")
      setHeadBaseline({ name: r.name ?? "", deadline: r.deadline ?? "" })
      setSaveState("saved")
      clearPreserved()
      setDoc((prev) =>
        prev
          ? { ...prev, updated_at: r.updatedAt, filled_slot_count: r.filledSlotCount, slot_count: r.slotCount }
          : ({
              id: r.applicationDocumentId,
              user_id: "",
              created_at: r.updatedAt,
              updated_at: r.updatedAt,
              application_project_id: apId,
              document_kind: "cover_letter",
              body: toCoverLetterBody(current),
              filled_slot_count: r.filledSlotCount,
              slot_count: r.slotCount,
              meta: {},
              first_copied_at: null,
            } satisfies ApplicationDocument),
      )
      // 서버가 건너뛴 제안(`skipped`)은 그 사유 문구를 알린다 (S-10 "저장 응답의 건너뜀"과 같은 규칙)
      if (r.skipped.length > 0) toast(PAGE_SAVE_SKIP_COPY[r.skipped[0].reason])
      // 반영된 제안은 이번 요청이 보낸 것만 비운다
      setApplied((list) => list.filter((a) => !r.applied.some((x) => x.writingChatId === a.writingChatId && x.slot === a.slot)))
      if (opts.createRow) {
        // 정본 행이 생겼다 → 작성 상태(자소서 탭). 주소는 바뀌지 않는다
        setTab("cover_letter")
        toast.success("자기소개서를 만들었어요")
      }
      return true
    },
    [apId, name, deadline, headBaseline, updatedAt, applied, clearPreserved],
  )

  // ---------- 이탈 확인 ----------
  // 문항 설정 상태에는 "저장하고 나가기"가 없다 — 저장 경로가 [자기소개서 작성 시작] 하나다 (CF-S3).
  // 셸의 이탈 확인에 `hideLeaveSave`를 넘겨 버튼을 "나가기" / "계속 작성" 둘로 만든다 (파운데이션 후속 ②).
  const guard = useLeaveGuard({ dirty, onSave: () => runSave(), onDiscard: clearPreserved })

  // ---------- Resumate AI 패널 (작성 상태만) ----------
  /** 턴마다 보내는 지금 폼 — 저장 전 값이 우선이고 저장·로그에 남지 않는다 (CL-4, DM 2.5.1) */
  const formSnapshot = React.useMemo(
    () =>
      forms.map((f, i) => ({
        slot: f.slot || `q_${i + 1}`,
        question_text: f.question_text,
        char_limit: Number(f.char_limit) || 0,
        count_basis: f.count_basis,
        user_note: f.user_note || null,
        answer_title: f.answer_title || null,
        body: f.body,
      })),
    [forms],
  )
  const panel = useCoverLetterPanel({
    applicationProjectId: apId,
    initialChats: data.chats,
    initialChat: data.open_chat,
    formSnapshot,
    preview: {
      state: previewState,
      autoplay: previewState === "draft-stream" || previewState === "draft-failed" ? "draft" : null,
      turnError: previewState === "draft-failed" ? "provider_unavailable" : null,
    },
    requirementsPending: data.extract_first,
    onChatChange: (chatId) => {
      // 연 대화는 주소에 남긴다 (`?chat=`) — 서버 재렌더가 일어나지 않게 replaceState만 쓴다
      const url = new URL(window.location.href)
      if (chatId) url.searchParams.set("chat", chatId)
      else url.searchParams.delete("chat")
      window.history.replaceState(window.history.state, "", url.pathname + url.search)
    },
  })

  /** 제안 [반영] — 폼만 채우고(키 없이 가능) "저장하기"가 `applied_proposals`로 올린다 (UX-4) */
  const onFill = React.useCallback(
    (fills: QuestionFill[]) => {
      setForms((list) =>
        list.map((f) => {
          const fill = fills.find((x) => x.slot === f.slot)
          if (!fill) return f
          // 제안에 제목이 있으면 제목도 교체, 없으면 지금 제목을 둔다 (CF-A4)
          return { ...f, body: fill.body, answer_title: fill.answerTitle ?? f.answer_title }
        }),
      )
      setApplied((list) => [
        ...list.filter((a) => !fills.some((f) => f.slot === a.slot)),
        ...fills.map((f) => ({ writingChatId: f.writingChatId, slot: f.slot, rev: f.rev })),
      ])
      setErrors({})
      if (saveState !== "saving") setSaveState("idle")
      // 되돌리기 없음 (OD-P2) — 정보 토스트만
      toast(fills.length === 1 ? `${slotNumber(forms, fills[0].slot)}번 문항에 채웠어요` : `문항 ${fills.length}개에 채웠어요`)
    },
    [forms, saveState],
  )

  // ---------- 패널 자리 ----------
  const placement = usePanelPlacement()

  // C-10 → 돌아온 뒤 복귀 대상을 지운다
  useRestoreReturnParams(apId, "cover_letter")

  const fromBoard = React.useMemo(() => readNavOrigin(apId) === "board", [apId])
  const displayName = applicationDisplayName(name || data.name, data.name_source, data.created_at)
  const uiState: SaveUiState =
    saveState === "saving" || saveState === "failed" || saveState === "invalid" || saveState === "stale" ? saveState : dirty ? "dirty" : savedAt ? "saved" : "idle"
  // CF-S3: 문항 설정 상태에서는 늘 비활성 ("저장하기", 표식 점 없음, ⌘S 없음)
  const saveUi: SaveUiState = state === "questions" ? "idle" : uiState

  const head = (
    <DocHead className="space-y-2" label="자기소개서 정보">
      <div className="flex items-start gap-2">
        <DocTitleInput
          ref={nameRef}
          label="자기소개서 이름"
          placeholder="자기소개서 이름"
          value={name}
          maxLength={100}
          invalid={Boolean(nameError)}
          aria-describedby={nameError ? "cl-name-error" : undefined}
          onChange={(e) => {
            setName(e.target.value)
            setNameError(null)
            if (saveState !== "saving") setSaveState("idle")
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="mt-1 size-11 lg:size-8" aria-label="자기소개서 메뉴">
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* 단계 칩은 없다 (CF-3) — 전형 단계 변경은 S-39에서만 */}
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDeleting({ kind: "application_project", entity_id: apId, label: displayName, unsavedChanges: dirty })}
            >
              <Trash2 aria-hidden />
              자기소개서 삭제
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {nameError ? (
        <p id="cl-name-error" className="text-sm text-destructive" role="alert">
          {nameError}
        </p>
      ) : null}

      <InlineFields>
        {/* 지원 직무·JD 상세는 작성 상태 머리에만 (시안 4) */}
        {state === "writing" ? (
          <>
            <InlineField label="지원 직무">
              {data.position_title ? (
                <span className="text-sm">{data.position_title}</span>
              ) : (
                <span className="text-sm text-muted-foreground">포지션 없음</span>
              )}
            </InlineField>
            <InlineField label="채용 공고">
              {data.source_url ? (
                <Button variant="link" size="sm" className="h-auto px-0" asChild>
                  <a href={data.source_url} target="_blank" rel="noopener noreferrer">
                    JD 상세
                    <ArrowUpRight className="size-3.5" aria-hidden />
                    <span className="sr-only">새 창에서 열림</span>
                  </a>
                </Button>
              ) : (
                <Button variant="link" size="sm" className="h-auto px-0" onClick={() => changeTab("jd")}>
                  JD 상세
                </Button>
              )}
            </InlineField>
          </>
        ) : null}
        <InlineField label="마감일">
          <span className="flex items-center gap-1">
            {/* 일 단위 (CF-4) — 연·월 선택을 쓰지 않는다 */}
            <Input
              type="date"
              aria-label="마감일"
              className="w-[11rem]"
              value={deadline}
              onChange={(e) => {
                setDeadline(e.target.value)
                if (saveState !== "saving") setSaveState("idle")
              }}
            />
            {deadline ? (
              <Button variant="ghost" size="icon-xs" aria-label="마감일 비우기" onClick={() => setDeadline("")}>
                <X aria-hidden />
              </Button>
            ) : null}
          </span>
        </InlineField>
      </InlineFields>

      {state === "writing" && doc ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          문항 {forms.length}개 · 답변 {forms.filter((f) => f.body.trim()).length}개 · 마지막 수정 {formatRelative(updatedAt ?? doc.updated_at)}
        </p>
      ) : null}
      {pageError ? (
        <p className="text-sm text-destructive" role="alert">
          {pageError}
        </p>
      ) : null}
    </DocHead>
  )

  /** 반영하지 않은 제안이 있는 문항 — 머리에 "AI 제안 있음" 표식 */
  const unappliedSlots = React.useMemo(() => {
    const out = new Set<string>()
    for (const q of panel.chat?.structured_draft.document.questions ?? []) {
      if (q.draft.applied_at) continue
      if (applied.some((a) => a.slot === q.slot && a.rev === q.draft.rev)) continue
      out.add(q.slot)
    }
    return out
  }, [panel.chat, applied])

  const answerTab = (
    <AnswerTab
      forms={forms}
      errors={errors}
      evidence={data.evidence}
      onChange={(next) => {
        setForms(next)
        setErrors({})
        setPageError(null)
        if (saveState !== "saving") setSaveState("idle")
      }}
      onCopied={() => {
        // `first_copied_at` 기록 (PRD 7장 지표). 실패해도 복사는 끝났으므로 조용히 넘긴다
        void markCoverLetterCopiedAction(apId).catch(() => null)
      }}
      onOpenPanel={() => {
        placement.setWideOpen(true)
        panel.focusInput()
      }}
      unappliedSlots={unappliedSlots}
      highlight={highlight}
    />
  )

  return (
    <PageShell
      guard={guard}
      hideLeaveSave={state === "questions"}
      aiReopen={state === "writing" ? { visible: placement.mode === "wide" && !placement.wideOpen, onClick: () => placement.setWideOpen(true) } : null}
      save={
        <SaveButton
          state={saveUi}
          savedAt={savedAt}
          onSave={() => state === "writing" && void runSave()}
          // CF-S3: 문항 설정 상태에서는 ⌘S가 동작하지 않고, **비활성인 이유를 알리지 않는다**(CF-S5)
          hideTooltip={state === "questions"}
        />
      }
    >
      <CrumbRow
        back={fromBoard ? { href: routes.board(), label: "지원 현황" } : { href: routes.applications(), label: "자기소개서 관리" }}
        items={fromBoard ? [{ label: "지원 현황", href: routes.board() }] : [{ label: "자기소개서 관리", href: routes.applications() }]}
        current={displayName}
      />
      <ShellBanners>
        <ReturnBanner />
      </ShellBanners>
      {head}
      <Separator className="shrink-0" />

      {state === "questions" ? (
        // 문항 설정 상태: 탭 목록·AI 패널 없이 한 열
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 max-md:px-4">
          <div className="mx-auto w-full max-w-prose-edit">
            <QuestionSetup
              applicationProjectId={apId}
              forms={forms}
              errors={errors}
              onChange={(next) => {
                setForms(next)
                setErrors({})
                setPageError(null)
              }}
              onStart={async () => {
                setStarting(true)
                // 순서 = 추출(요건 선행, QuestionSetup이 먼저 돌린다) → **성공 뒤** 저장 (v5.20 정정, DM-3)
                const ok = await runSave({ createRow: true })
                setStarting(false)
                return ok
              }}
              starting={starting}
              extractFirst={data.extract_first}
              extractFailPreview={data.preview.extractFail}
              focusIndex={focusIndex}
            />
          </div>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={changeTab} orientation="vertical" className="min-h-0 flex-1">
          <div className="flex min-h-0 flex-1 max-lg:flex-col">
            <TabsList
              variant="pill"
              className="w-40 shrink-0 flex-col items-stretch gap-1 border-r px-3 py-4 max-lg:w-full max-lg:flex-row max-lg:border-r-0 max-lg:border-b max-lg:px-4 max-lg:py-2"
            >
              {/* 탭 이름 — CF-U3 확정: 작성 화면 탭은 "자소서" */}
              <TabsTrigger value="cover_letter" className="justify-start max-lg:justify-center">
                자소서
              </TabsTrigger>
              <TabsTrigger value="jd" className="justify-start max-lg:justify-center">
                채용 공고
              </TabsTrigger>
              <TabsTrigger value="insight" className="justify-start max-lg:justify-center">
                인사이트
              </TabsTrigger>
            </TabsList>
            {/* 가운데 탭 내용 + 손잡이 + 패널. 탭을 옮겨도 폼·패널 상태가 유지된다 (CF-A12) */}
            <div className="flex min-h-0 flex-1">
              <DocBody
                className="min-h-0 flex-1"
                placement={placement}
                left={
                  <>
                    <TabsContent value="cover_letter" forceMount className={cn(tab !== "cover_letter" && "hidden")}>
                      {answerTab}
                    </TabsContent>
                    <TabsContent value="jd" forceMount className={cn(tab !== "jd" && "hidden")}>
                      {jdTab}
                    </TabsContent>
                    <TabsContent value="insight" forceMount className={cn(tab !== "insight" && "hidden")}>
                      {insightTab}
                    </TabsContent>
                  </>
                }
                aside={
                  <CoverLetterPanel
                    panel={{ ...panel, hide: () => placement.setWideOpen(false) }}
                    questions={forms.map((f, i) => ({ slot: f.slot || `q_${i + 1}`, question_text: f.question_text, answer_title: f.answer_title, body: f.body }))}
                    filled={applied.map((a) => ({ slot: a.slot, rev: a.rev }))}
                    onFill={onFill}
                  />
                }
              />
            </div>
          </div>
        </Tabs>
      )}

      <StaleWriteDialog
        open={stale}
        entity="deliverable"
        busy={saveState === "saving"}
        onOpenChange={setStale}
        onOverwrite={() => {
          setStale(false)
          void runSave({ overwrite: true })
        }}
        onReload={guard.reloadDiscarding}
      />
      <DeleteConfirmDialog
        target={deleting}
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={async () => {
          await deleteApplicationAction(apId)
          clearPreserved()
          toast.success("자기소개서를 삭제했어요")
          router.replace(fromBoard ? routes.board() : routes.applications())
        }}
      />
    </PageShell>
  )
}

/**
 * `?state=` 미리 보기로 폼을 만든다 (화면 모양만 바꾸고 저장소는 건드리지 않는다):
 * - `questions` / `extracting` / `extract-failed*` → 기본 3문항(문항 설정 상태)
 * - `questions-invalid` → 문항 1개를 비우고 글자 수 제한도 비운다(검증 오류)
 * - `questions-max` → 5문항("+ 문항 추가" 비활성)
 * - `empty-answers` → 정본 행의 제목·답변을 비운 작성 상태(빈 상태 상자)
 */
function previewForms(doc: ApplicationDocument | null, state: string | null): QuestionForm[] {
  if (state === "questions-invalid") {
    const forms = seedQuestionForms()
    forms[0] = { ...forms[0], question_text: "" }
    forms[1] = { ...forms[1], char_limit: "" }
    return forms
  }
  if (state === "questions-max") {
    const forms = seedQuestionForms()
    while (forms.length < COVER_LETTER_MAX_QUESTIONS) forms.push({ ...newQuestionForm(), question_text: `추가 문항 ${forms.length + 1}` })
    return forms
  }
  if (!doc) return seedQuestionForms()
  const forms = toQuestionForms(doc.body)
  if (state === "empty-answers") return forms.map((f) => ({ ...f, answer_title: "", body: "", blocks: [] }))
  return forms
}

/** 패널 자리·너비 — 패널 본체가 붙기 전까지 화면이 들고 있다 (5.9 폭 규칙은 `DocBody`가 적용) */
function usePanelPlacement(): DocPanelPlacement {
  const [mode, setMode] = React.useState<"wide" | "narrow">("wide")
  const [wideOpen, setWideOpen] = React.useState(true)
  // 기억해 둔 열림 상태는 hydration 뒤 한 번만 되살린다 (서버·클라이언트 첫 그림을 같게 두려고)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [width, setWidth] = React.useState<number>(PANEL_WIDTH.default)
  React.useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration 뒤 한 번만 되살린다
      if (window.localStorage.getItem(PANEL_OPEN_KEY) === "0") setWideOpen(false)
    } catch {
      /* storage unavailable */
    }
  }, [])
  const setOpen = React.useCallback((open: boolean) => {
    setWideOpen(open)
    try {
      window.localStorage.setItem(PANEL_OPEN_KEY, open ? "1" : "0")
    } catch {
      /* storage unavailable */
    }
  }, [])
  return { mode, setMode, wideOpen, setWideOpen: setOpen, sheetOpen, setSheetOpen, width, setWidth }
}

function errorCode(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code?: unknown }).code) : "save_failed"
}

/** 토스트에 쓰는 문항 번호 */
function slotNumber(forms: QuestionForm[], slot: string): number {
  const at = forms.findIndex((f) => f.slot === slot)
  return at >= 0 ? at + 1 : 1
}
