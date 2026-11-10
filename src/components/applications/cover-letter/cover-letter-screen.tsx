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
import { submitFailedMessage } from "@/lib/data/labels"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DocTitleInput, FieldRow, FieldRows, PANEL_WIDTH } from "@/components/common/doc-inputs"
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
import { expectedVersion, restorableCopy, staleDialogReloadOnly } from "./save-version"
import {
  createSlotAllocator,
  invalidSlotCopy,
  isUntouchedSeed,
  questionStructure,
  questionStructureChanged,
  slotsInUse,
  newQuestionForm,
  nextSlot,
  seedQuestionForms,
  toCoverLetterBody,
  toQuestionForms,
  validateQuestions,
  type QuestionErrors,
  type QuestionForm,
} from "./question-form"

/**
 * 세로 탭 한 칸 — 공통 알약 탭의 선택 색(연한 초록)을 시안 3의 **회색 바탕 + 검은 글자**로 바꾼다 `[UI-가정]`.
 * 같은 변형 접두사로 써야 tailwind-merge가 기본 알약 색을 대체한다.
 */
const TAB_PILL =
  "h-10 w-full justify-start px-4 text-foreground group-data-[variant=pill]/tabs-list:h-10 group-data-[variant=pill]/tabs-list:text-foreground group-data-[variant=pill]/tabs-list:data-active:bg-muted group-data-[variant=pill]/tabs-list:data-active:text-foreground dark:group-data-[variant=pill]/tabs-list:data-active:bg-muted dark:group-data-[variant=pill]/tabs-list:data-active:text-foreground max-lg:w-auto max-lg:justify-center"

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

  // ---------- 슬롯 발급기 (UQ-740 · DM 2.5.1 "안정 키, 재사용 금지") ----------
  // 이 서류에서 쓴 적 있는 번호를 모두 기억한다: 저장된 정본 · 기본 3문항 · 열려 있는 대화의 제안 ·
  // 이번 방문에 발급한 것(지운 것 포함). 그래서 문항을 지우고 다시 넣어도 번호를 다시 쓰지 않는다.
  const [slots] = React.useState(() =>
    createSlotAllocator(
      slotsInUse({ forms: [], document: data.document, chat: data.open_chat }),
      // R15 후속 3: 읽은 정본의 `slot_high_water` — 서버는 저장한 번호를, 화면은 저장하지 않은 번호를 맡는다.
      // 새 번호 = max(slot_high_water, 열린 제안, 이번 방문 발급분) + 1. 행이 없으면 0
      { highWater: data.document?.slot_high_water ?? 0 },
    ),
  )
  // 발급할 때마다 **지금 화면의 모든 슬롯**을 한 함수(`slotsInUse`)로 모아 넘긴다 — 입력 보존으로 되살린
  // 문항(UQ-756)과 기록에서 연 대화의 제안(UQ-757)도 이 길로 "쓴 번호"가 된다. 값은 이벤트 때 ref로 읽는다
  const slotSourcesRef = React.useRef<Parameters<typeof slotsInUse>[0]>({ forms: [], document: data.document, chat: data.open_chat })
  const allocateSlot = React.useCallback(() => slots.allocate(slotsInUse(slotSourcesRef.current)), [slots])

  // ---------- 폼 ----------
  const [doc, setDoc] = React.useState<ApplicationDocument | null>(data.document)
  const docRef = React.useRef<ApplicationDocument | null>(data.document)
  // 첫 폼은 **한 번만** 만든다 — 만들 때마다 새 `question_id`가 생겨 기준선과 어긋나지 않게
  const [initialForms] = React.useState<QuestionForm[]>(() => {
    const forms = previewForms(data.document, previewState)
    slots.markUsed(forms.map((f) => f.slot))
    return forms
  })
  const [forms, setForms] = React.useState<QuestionForm[]>(initialForms)
  const [baseline, setBaseline] = React.useState<string>(() => JSON.stringify(initialForms))
  const [name, setName] = React.useState(data.name ?? "")
  const [deadline, setDeadline] = React.useState(data.deadline ?? "")
  const [headBaseline, setHeadBaseline] = React.useState({ name: data.name ?? "", deadline: data.deadline ?? "" })
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(data.document?.updated_at ?? null)
  const [errors, setErrors] = React.useState<Record<number, QuestionErrors>>(() =>
    previewState === "questions-invalid" ? validateQuestions(initialForms).errors : {},
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
      if (!restorableCopy(copy.base_updated_at, data.document?.updated_at)) {
        window.localStorage.removeItem(preserveKey)
        return
      }
      // 되살린 문항의 슬롯도 "쓴 번호"다 (UQ-756) — 같은 수집 함수를 지난다
      slots.markUsed(slotsInUse({ forms: copy.forms }))
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration 뒤 한 번만 되살린다
      setForms(copy.forms)
      setName(copy.name)
      setDeadline(copy.deadline)
    } catch {
      /* storage unavailable */
    }
  }, [preserveKey, data.document?.updated_at, slots])
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

  // "다른 곳에서 바뀜"의 지금 버전 — "내 내용으로 저장"이 이 값을 기대 버전으로 다시 보낸다.
  // 정본이 있는 상태에서 **기대 버전 null을 보내는 길을 두지 않는다**(UQ-741: RPC는 null이면 검사 없이 덮는다)
  const staleVersion = React.useRef<string | null>(null)

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

      // 기대 버전: 행이 있으면 늘 보낸다. "내 내용으로 저장"은 충돌 때 받은 지금 버전을 보낸다(null 아님).
      // 행이 없을 때(첫 저장)만 null이다 — 그때는 덮을 정본이 없다.
      const expected = expectedVersion({ rowUpdatedAt: updatedAt, overwrite: Boolean(opts.overwrite), staleVersion: staleVersion.current })
      const result = await saveCoverLetterDocumentAction({
        application_project_id: apId,
        body: toCoverLetterBody(current),
        expected_updated_at: expected,
        // CF-S1: 근거 목록을 싣지 않고 반영한 제안만 보낸다
        applied_proposals: applied,
        application_values: Object.keys(values).length > 0 ? values : undefined,
      }).catch(() => null)

      if (!result || "error" in result) {
        const code = result?.error.code ?? "save_failed"
        switch (code) {
          case "stale_write": {
            const current = result?.error.details?.current_updated_at
            staleVersion.current = typeof current === "string" ? current : null
            setSaveState("stale")
            setStale(true)
            return false
          }
          case "too_many_questions":
            setPageError(QUESTION_MAX_NOTE)
            setSaveState("invalid")
            return false
          case "invalid_fields":
          case "field_too_long":
            // 서버도 `char_limit`을 필수로 본다 — 같은 검증을 화면에서 이미 했으므로 안내만
            setPageError(code === "field_too_long" ? "글자 수 한도를 넘은 칸이 있어요" : "글자 수 제한을 확인해 주세요")
            setSaveState("invalid")
            return false
          case "invalid_slot": {
            // 슬롯이 겹치거나 형식이 아니다 (UQ-756처럼 실제로 생길 수 있다). "저장 실패"로 뭉개지 않고
            // 어느 문항인지 알린다 — 그대로 다시 눌러도 같은 거부라 "다시 시도"가 아니라 검증 오류로 둔다
            // `details.field` = 거부된 그 slot (겹침 · 번호 + question_id 불일치 · 서버가 이미 쓴 번호 — R15 후속 3)
            const field = result?.error.details?.field
            const at = typeof field === "string" ? current.findIndex((f) => f.slot === field) : -1
            // 그 번호는 이제 "쓴 번호"다 — 지우고 다시 추가하면 그보다 큰 번호를 받는다
            if (typeof field === "string") slots.markUsed([field])
            setPageError(invalidSlotCopy(at >= 0 ? at + 1 : null))
            setSaveState("invalid")
            return false
          }
          case "not_found":
          case "application_project_not_found":
            toast("자기소개서를 찾을 수 없어요")
            setSaveState("failed")
            return false
          default:
            setSaveState("failed")
            // 문항 설정 상태는 상단 저장 상태 표시가 `idle`로 고정(CF-S3·S5)이라 "저장 실패"가 어디에도 안 보였다
            // (2026-11-10 "작성 시작을 눌러도 아무 동작이 없다"). 정본 행을 만드는 [자기소개서 작성 시작]의 실패는 알린다
            if (opts.createRow) toast.error(submitFailedMessage("자기소개서"))
            return false
        }
      }
      const r = result.data
      staleVersion.current = null
      // 반환 11키(계약은 camelCase)로 머리를 다시 그린다 — 다시 읽지 않는다
      // R15 후속 3: 서버의 최고 번호를 발급기에 넣는다 — 다음 새 문항은 이것 + 1부터
      slots.markHighWater(r.slotHighWater)
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
          ? {
              ...prev,
              // 저장한 본문이 이제 정본이다 — CF-S8 "문항 구성이 바뀌었나"의 기준선이 된다
              body: toCoverLetterBody(current),
              updated_at: r.updatedAt,
              filled_slot_count: r.filledSlotCount,
              slot_count: r.slotCount,
              slot_high_water: r.slotHighWater,
            }
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
              slot_high_water: r.slotHighWater,
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
    [apId, name, deadline, headBaseline, updatedAt, applied, clearPreserved, slots],
  )

  // ---------- 이탈 확인 ----------
  // 문항 설정 상태에는 "저장하고 나가기"가 없다 — 저장 경로가 [자기소개서 작성 시작] 하나다 (CF-S3).
  // 셸의 이탈 확인에 `hideLeaveSave`를 넘겨 버튼을 "나가기" / "계속 작성" 둘로 만든다 (파운데이션 후속 ②).
  const guard = useLeaveGuard({ dirty, onSave: () => runSave(), onDiscard: clearPreserved })

  // ---------- Resumate AI 패널 (작성 상태만) ----------
  /** 턴마다 보내는 지금 폼 — 저장 전 값이 우선이고 저장·로그에 남지 않는다 (CL-4, DM 2.5.1) */
  const formSnapshot = React.useMemo(
    () =>
      forms.map((f) => ({
        slot: f.slot,
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
    // CF-S8 (확정 2026-11-10, 사용자): 저장하지 않은 문항 **구성** 변경(추가·삭제·순서)이 있으면 턴 전에
    // "저장하기"와 **같은 경로**(`runSave`)로 먼저 저장한다 — 기대 버전·CF-S7·slot_high_water·question_id 보존·
    // 반영한 제안(`applied_proposals`)이 평소 저장 그대로 적용된다. 실패하면 `false` → 턴을 보내지 않는다.
    // 값(답변·제목·메모)만 바뀌었으면 저장하지 않고 스냅숏으로 보낸다 `[가정]`
    beforeTurn: async () => {
      const stored = docRef.current ? questionStructure(docRef.current.body.questions) : null
      if (!questionStructureChanged(stored, formsRef.current)) return true
      return runSave()
    },
    onChatChange: (chatId) => {
      // 연 대화는 주소에 남긴다 (`?chat=`) — 서버 재렌더가 일어나지 않게 replaceState만 쓴다
      const url = new URL(window.location.href)
      if (chatId) url.searchParams.set("chat", chatId)
      else url.searchParams.delete("chat")
      window.history.replaceState(window.history.state, "", url.pathname + url.search)
    },
  })

  // CF-S8 판정에 쓰는 지금의 정본 (턴을 보내는 이벤트 때 읽는다)
  React.useEffect(() => {
    docRef.current = doc
  }, [doc])

  // 발급기가 읽는 "지금 화면의 슬롯" — 폼·정본·열린 대화가 바뀔 때마다 맞춘다 (UQ-756·757)
  React.useEffect(() => {
    slotSourcesRef.current = { forms, document: doc, chat: panel.chat }
  }, [forms, doc, panel.chat])

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
    <DocHead className="space-y-3" label="자기소개서 정보">
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

      {/* 라벨/값 줄 (시안 2·3: 왼쪽 회색 라벨 열 + 오른쪽 컨트롤) — S-10 머리의 `FieldRows`를 그대로 쓴다.
          마감일(두 상태) → 지원 직무 · JD 상세(작성 상태만, 확정 항목) */}
      <FieldRows className="max-w-2xl">
        <FieldRow label="마감일" labelId="cl-deadline-label">
          {/* 일 단위 (CF-4) — 시안의 연·월 두 셀렉트 대신 같은 높이·테두리의 날짜 칸 하나 */}
          <Input
            type="date"
            aria-labelledby="cl-deadline-label"
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
        </FieldRow>
        {state === "writing" ? (
          <>
            <FieldRow label="지원 직무">
              {data.position_title ? (
                <span className="text-sm">{data.position_title}</span>
              ) : (
                <span className="text-sm text-muted-foreground">포지션 없음</span>
              )}
            </FieldRow>
            <FieldRow label="채용 공고">
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
            </FieldRow>
          </>
        ) : null}
      </FieldRows>

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
      allocateSlot={allocateSlot}
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
      meta={doc ? `문항 ${forms.length}개 · 답변 ${forms.filter((f) => f.body.trim()).length}개 · 마지막 수정 ${formatRelative(updatedAt ?? doc.updated_at)}` : null}
      onRevealProposal={(slot) => {
        // 좁은 화면이면 시트를 열고, 넓은 화면이면 패널을 연 뒤 그 문항의 제안 자리로 간다 (UQ-749)
        if (placement.mode === "narrow") placement.setSheetOpen(true)
        else placement.setWideOpen(true)
        panel.revealSlot(slot)
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
          // CF-S3: 문항 설정 상태에는 ⌘S가 없다 — 툴팁·`aria-keyshortcuts`도 없고 비활성 이유도 알리지 않는다
          // (CF-S5 · UQ-750)
          noShortcut={state === "questions"}
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
        // 문항 설정 상태: 탭 목록·AI 패널 없이 가운데 좁은 한 열 (시안 2 — 위아래 여백 넉넉히)
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-16 pb-10 max-md:px-4 max-md:pt-8">
          {/* 시안 2의 열 폭 약 600px(그림 830px ÷ 1.39) — 59 QA UQ-762 */}
          <div className="mx-auto w-full max-w-[37.5rem]">
            <QuestionSetup
              applicationProjectId={apId}
              allocateSlot={allocateSlot}
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
            {/* 세로 알약 탭 (시안 3: 알약 폭 약 140px = 열 164px − 왼쪽 여백 24px, 59 QA UQ-765, 선택 탭 = 회색 바탕 알약, 구분선 없음) — 공통 `Tabs` `variant="pill"` */}
            <TabsList
              variant="pill"
              className="w-[10.25rem] shrink-0 flex-col items-stretch gap-1 py-6 pl-6 max-lg:w-full max-lg:flex-row max-lg:border-b max-lg:px-4 max-lg:py-2"
            >
              {/* 탭 이름 — CF-U3 확정: 작성 화면 탭은 "자소서" */}
              <TabsTrigger value="cover_letter" className={TAB_PILL}>
                자소서
              </TabsTrigger>
              <TabsTrigger value="jd" className={TAB_PILL}>
                채용 공고
              </TabsTrigger>
              <TabsTrigger value="insight" className={TAB_PILL}>
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
                    panel={panel}
                    placement={placement}
                    onDirectInput={() => document.querySelector<HTMLElement>(`[aria-label="문항 1 내용"]`)?.focus()}
                    questions={forms.map((f) => ({ slot: f.slot, question_text: f.question_text, answer_title: f.answer_title, body: f.body }))}
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
        entity="cover_letter"
        busy={saveState === "saving"}
        onOpenChange={setStale}
        // CF-S9 (확정 2026-11-10, 사용자): **문항 설정 상태**의 [작성 시작]이 `stale_write`를 받으면 "새로 불러오기"
        // 하나만 둔다 — 이 탭의 문항 설정으로 덮으면 다른 탭이 만든 문항의 근거 행이 빈 문항에 남거나 슬롯 판정에서
        // 거부된다. "새로 불러오기"는 이 탭의 입력 보존 복사본까지 버리고 정본을 다시 읽어 **작성 상태**로 연다.
        // **작성 상태**(CF-S8 자동 저장 실패 포함)는 CF-S7 그대로 버튼 둘이다
        reloadOnly={staleDialogReloadOnly(state)}
        onOverwrite={() => {
          setStale(false)
          // 작성 상태에서만 닿는다 — `stale_write`가 준 지금 버전을 실어 다시 보낸다 (CF-S7)
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
    // 기본 3문항(q_1~q_3) 다음 번호를 받는다 (q_4·q_5)
    while (forms.length < COVER_LETTER_MAX_QUESTIONS)
      forms.push({ ...newQuestionForm(nextSlot(forms.map((f) => f.slot))), question_text: `추가 문항 ${forms.length + 1}` })
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


/** 토스트에 쓰는 문항 번호 */
function slotNumber(forms: QuestionForm[], slot: string): number {
  const at = forms.findIndex((f) => f.slot === slot)
  return at >= 0 ? at + 1 : 1
}

