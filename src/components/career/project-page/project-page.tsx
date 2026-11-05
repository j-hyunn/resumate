"use client"

/**
 * S-10 프로젝트 상세 (UX v5.6 S-10 · L-02 1.3a · FL-05 · FL-14, AI v4.6 AI-12, DM v4.5 2.5.1).
 *
 * L-02 PageShell → CrumbRow "{회사명/기관명} › {프로젝트명} › 프로젝트 상세" → banners (C-10, 관련 요건, 입력 보존)
 * 새 프로젝트(행 없음)는 이동 줄 현재 위치가 "새 프로젝트 추가"다(33 런). 머리 맨 위 새 행 안내 배너는 두지 않는다(사용자 결정 2026-11-05).
 * → 머리 (제목 = 프로젝트명 입력 · ⋯ 소속 변경 / 프로젝트 삭제 · 종류 · 경험 유형 · 역량 · 진행 기간 · 진행 중)
 * → Separator → DocBody: STAR 5칸 | ResizeHandle | Resumate AI 패널 (+ StarProposalCard).
 *
 * Page save = one `save_project_page` (saveProjectPageAction) with `p_applied_proposals` = the [반영] fills of this
 * visit `{writing_chat_id, field, rev}`. A new page has no row until the first save / first AI message; then the URL
 * is replaced (history.replaceState, `?state=` kept) — the component stays mounted so a running first turn continues.
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRightLeft, CircleAlert, Info, MoreHorizontal, Sparkles, Trash2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { ChipSelect, CompetencyChips, DocTextarea, DocTitleInput, InlineField, InlineFields, flashElement } from "@/components/common/doc-inputs"
import { MonthField } from "@/components/common/input-guide"
import { DeleteConfirmDialog } from "@/components/common/delete-confirm-dialog"
import { ErrorState } from "@/components/common/state-views"
import { RETURN_FEATURE_LABELS, ReturnBanner, notifyCareerSaved, useGateContinuation } from "@/components/common/return-banner"
import { readCareerReturn } from "@/components/common/return-target"
import { DocBody, DocHead } from "@/components/common/shell/doc-body"
import {
  CrumbRow,
  PageShell,
  SaveButton,
  ShellBanners,
  StaleWriteDialog,
  preservationKey,
  useInputPreservation,
  useLeaveGuard,
  type SaveUiState,
} from "@/components/common/shell/page-shell"
import { isRestorable, type VersionedCopy } from "@/components/common/shell/input-preservation"
import { AiPanel, useAiPanel } from "@/components/career/ai-panel"
import { CRUMB_CURRENT, firstSaveToast } from "@/components/career/new-row-notice"
import { useNewRowRemount } from "@/components/career/new-row-remount"
import { deleteAffiliatedProjectAction } from "@/components/career/actions"
import { StarProposalCard, PROPOSAL_FIELD_LABELS, fillableFields, hasProposals, type FillOptions, type ProposalFocusRequest } from "@/components/career/star-proposal-card"
import { applyFills, isFilledNow, markDraftApplied, mergeApplied, planFill, type FillPlan } from "@/components/career/star-proposal-fill"
import { saveProjectPageAction } from "@/lib/data/career-v45-actions"
import {
  PAGE_LIMITS,
  PAGE_SAVE_ERROR_COPY,
  PAGE_SAVE_SKIP_COPY,
  PERIOD_CURRENT_WITH_END_COPY,
  PERIOD_START_FIRST_COPY,
  STAR_FIELDS_ORDER,
  fieldTooLongCopy,
  isBlank,
  toProjectFormSnapshot,
  type AppliedProjectProposal,
  type ProjectPageData,
  type ProjectPageValues,
  type ProjectProposalField,
  type SaveProjectPageResult,
} from "@/lib/data/career-v45-shared"
import { COMPETENCY_LABELS, EXPERIENCE_TYPE_LABELS, PROJECT_TYPE_LABELS, STAR_FIELD_LABELS, directionParticle, projectSpanLabel } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import type { Competency, ProjectStarField, ProjectStructuredDraft, ReturnTarget } from "@/types/db"
import { AffiliationDialog } from "./affiliation-dialog"

// ---------------------------------------------------------------------------
// spec copy
// ---------------------------------------------------------------------------

/** STAR 칸 자리 표시 (UX S-10 STAR 표) */
const STAR_PLACEHOLDER: Record<ProjectStarField, string> = {
  situation: "배경, 팀 구성, 문제 상황",
  task: "본인이 맡은 목표·책임",
  action: "본인이 직접 한 일",
  result: "결과와 성과. 숫자가 있으면 함께 써 주세요",
  learnings: "이 경험에서 얻은 교훈을 본인 말로 써 주세요. AI는 이 내용을 사실이 아니라 본인의 회고로 다뤄요",
}

const NAME_REQUIRED = "프로젝트명을 입력해 주세요"
const PERIOD_ORDER = "종료월은 시작월보다 빠를 수 없어요"
const NOT_FOUND_TOAST = "찾을 수 없는 항목이에요"

type ErrorKey = "name" | "period" | "project_type" | "experience_type" | "competencies" | ProjectStarField
type Errors = Partial<Record<ErrorKey, string>>

const FOCUS_ORDER: ErrorKey[] = ["name", "project_type", "experience_type", "period", "competencies", ...STAR_FIELDS_ORDER]

function focusTargetId(k: ErrorKey): string {
  if (k === "name") return "project-title"
  if (k === "period") return "p-start-year"
  if (k === "project_type" || k === "experience_type" || k === "competencies") return `head-${k}`
  return `star-field-${k}`
}

/** 첫 오류 칸으로 포커스: classification rows focus their trigger button, not the wrapper (QA UQ-S10-8) */
function focusError(k: ErrorKey): void {
  const el = document.getElementById(focusTargetId(k))
  const target = k === "project_type" || k === "experience_type" || k === "competencies" ? (el?.querySelector<HTMLElement>("button") ?? el) : el
  target?.focus()
}

/** 화면 검사 (UX S-10: 이름 · 2,000자 · 기간 순서 · 역량 3개) */
export function validateProjectValues(v: ProjectPageValues): Errors {
  const e: Errors = {}
  if (isBlank(v.name)) e.name = NAME_REQUIRED
  else if (v.name.trim().length > PAGE_LIMITS.projectName) e.name = fieldTooLongCopy(PAGE_LIMITS.projectName)
  if (!v.start_month && v.end_month && !v.is_current) e.period = PERIOD_START_FIRST_COPY
  else if (v.start_month && v.end_month && !v.is_current && v.end_month < v.start_month) e.period = PERIOD_ORDER
  if (v.competencies.length > 3) e.competencies = PAGE_SAVE_ERROR_COPY.invalid_classification
  for (const f of STAR_FIELDS_ORDER) if ((v[f] ?? "").length > PAGE_LIMITS.star) e[f] = fieldTooLongCopy(PAGE_LIMITS.star)
  return e
}

/** server refusal → the field it sticks to (UX S-10 저장 실패 표) */
function errorOfRefusal(code: string, field: string | null | undefined, v: ProjectPageValues): Errors | null {
  switch (code) {
    case "project_name_required":
      return { name: NAME_REQUIRED }
    case "field_too_long": {
      if (field === "name") return { name: fieldTooLongCopy(PAGE_LIMITS.projectName) }
      if (field && (STAR_FIELDS_ORDER as readonly string[]).includes(field)) return { [field]: fieldTooLongCopy(PAGE_LIMITS.star) } as Errors
      return null
    }
    case "invalid_period":
      return { period: v.is_current && v.end_month ? PERIOD_CURRENT_WITH_END_COPY : PERIOD_ORDER }
    case "invalid_classification": {
      const k = field === "project_type" || field === "experience_type" || field === "competencies" ? field : "project_type"
      return { [k]: PAGE_SAVE_ERROR_COPY.invalid_classification } as Errors
    }
    default:
      return null
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function withState(url: string, previewState: string | null): string {
  if (!previewState) return url
  return `${url}${url.includes("?") ? "&" : "?"}state=${encodeURIComponent(previewState)}`
}

export interface ProjectPageProps {
  data: ProjectPageData
  /** `?focus=` — a STAR field (C-02) or "star" (C-09 project_star: 빈 STAR 칸, 상황 → 행동) */
  initialFocus?: ProjectStarField | "star" | null
  /** S-16 보완점 "관련 요건" (server-rendered) */
  requirementNotice?: React.ReactNode
}

/**
 * 새 행 페이지가 Next 16의 숨은 트리(`<Activity>`)로 되살아나는 것을 막는 겉면 — 자세한 이유는
 * `../new-row-remount.tsx`. "+ 프로젝트 추가"로 다시 들어오면 방금 만든 프로젝트가 아니라 빈 새 프로젝트가 열린다.
 */
export function ProjectPage(props: ProjectPageProps) {
  const { key, markRow } = useNewRowRemount()
  return <ProjectPageBody key={key} {...props} markRow={markRow} />
}

function ProjectPageBody({ data, initialFocus, requirementNotice, markRow }: ProjectPageProps & { markRow: (rowId: string) => void }) {
  const router = useRouter()
  const previewState = data.preview?.state ?? null
  const [projectId, setProjectId] = React.useState(data.project_id)
  // one id per new page, reused on every retry (idempotent create, UQ-PA-3)
  const [clientId] = React.useState(() => crypto.randomUUID())
  const [baseline, setBaseline] = React.useState<ProjectPageValues>(data.values)
  const [values, setValues] = React.useState<ProjectPageValues>(() => {
    if (data.preview?.dirty) return { ...data.values, learnings: `${data.values.learnings ?? ""}\n- 저장하지 않은 수정 (미리보기)`.trim() }
    if (previewState === "invalid") return { ...data.values, name: "" }
    return data.values
  })
  const [updatedAt, setUpdatedAt] = React.useState(data.updated_at)
  const [applied, setApplied] = React.useState<AppliedProjectProposal[]>([])
  const [errors, setErrors] = React.useState<Errors>(() => (previewState === "invalid" ? { name: NAME_REQUIRED } : {}))
  const [pageError, setPageError] = React.useState<{ text: string; toCareer?: boolean } | null>(null)
  const [nameAttention, setNameAttention] = React.useState(false)
  const [saveState, setSaveState] = React.useState<SaveUiState>(previewState === "invalid" ? "invalid" : "idle")
  const [savedAt, setSavedAt] = React.useState<string | null>(null)
  const [stale, setStale] = React.useState(false)
  const [focusedField, setFocusedField] = React.useState<ProjectStarField | null>(null)
  // fields whose typing / paste ran into the 2,000 limit — error until the text gets shorter again
  const [limitHit, setLimitHit] = React.useState<ReadonlySet<ProjectStarField>>(new Set())
  const [saveSkips, setSaveSkips] = React.useState<Extract<SaveProjectPageResult, { ok: true }>["skipped"]>([])
  const [competencyPick, setCompetencyPick] = React.useState<{ key: string; pick: Competency[] } | null>(null)
  const [focusRequest, setFocusRequest] = React.useState<ProposalFocusRequest | null>(null)
  const [live, setLive] = React.useState("")
  const [notFound, setNotFound] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [affOpen, setAffOpen] = React.useState(false)
  const [leaving, setLeaving] = React.useState(false)
  const [returnTarget, setReturnTarget] = React.useState<{ application_project_id: string; feature: ReturnTarget["feature"]; params?: Record<string, unknown> } | null>(null)
  const chatIdRef = React.useRef<string | null>(data.open_chat?.id ?? null)
  const titleRef = React.useRef<HTMLInputElement | null>(null)

  const valuesRef = React.useRef(values)
  const appliedRef = React.useRef(applied)
  React.useEffect(() => {
    valuesRef.current = values
    appliedRef.current = applied
  })

  const dirty = !leaving && !same(values, baseline)
  const gate = useGateContinuation()

  // 소속 (the form value; 소속 변경 changes it before the save)
  const parentType: "experience" | "education" = values.experience_id ? "experience" : values.education_id ? "education" : data.parent.type
  const parentId = values.experience_id ?? values.education_id ?? data.parent.id
  const parentName = data.affiliations.find((a) => a.type === parentType && a.id === parentId)?.name ?? (parentId === data.parent.id ? data.parent.name : null)
  const parentHref = routes.careerItem(parentType, parentId)

  // 입력 보존: key = row id, or `{소속 id}:new` (1.3a)
  // the copy carries the row version the edits started from (U40-2)
  const preserved = useInputPreservation<{ values: ProjectPageValues; applied: AppliedProjectProposal[] } & VersionedCopy>(
    preservationKey("project", projectId, data.parent.id),
  )
  React.useEffect(() => {
    preserved.write(dirty ? { values, applied, base_updated_at: updatedAt } : null)
  }, [dirty, values, applied, updatedAt, preserved])

  // C-09 gate entry: the return target lives in the browser session; the first new chat carries it
  React.useEffect(() => {
    const t = readCareerReturn()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- session storage is read after hydration
    if (t) setReturnTarget({ application_project_id: t.application_project_id, feature: t.feature, params: t.params })
  }, [])

  // initial focus: 새 프로젝트 → 프로젝트명 / ?focus= → that STAR 칸
  React.useEffect(() => {
    const t = window.setTimeout(() => {
      // preventScroll: on a short window the head box scrolls (UQ-SC-1) — keep the new-row notice in view (UQ-333)
      if (!data.project_id) return titleRef.current?.focus({ preventScroll: true })
      if (!initialFocus) return
      const f =
        initialFocus === "star"
          ? ((["situation", "action"] as ProjectStarField[]).find((x) => isBlank(data.values[x])) ?? "situation")
          : initialFocus
      const el = document.getElementById(`star-field-${f}`)
      el?.focus()
      el?.scrollIntoView({ block: "center" })
    }, 120)
    return () => window.clearTimeout(t)
  }, [data.project_id, data.values, initialFocus])

  const replaceUrl = React.useCallback(
    (id: string, chatId: string | null) => {
      // 이 트리가 행을 들고 있다는 표시 — 새 행 주소로 다시 들어오면 버려진다 (new-row-remount.tsx)
      markRow(id)
      window.history.replaceState(null, "", withState(routes.projectPage(id, chatId ? { chat: chatId } : undefined), previewState))
    },
    [previewState, markRow],
  )

  // ---------- save ----------
  const panelRef = React.useRef<ReturnType<typeof useAiPanel> | null>(null)

  const doSave = React.useCallback(
    async (opts: { overwrite?: boolean; fromPanel?: boolean } = {}): Promise<string | null> => {
      const sent = valuesRef.current
      const sentApplied = appliedRef.current
      const local = validateProjectValues(sent)
      if (Object.keys(local).length) {
        setErrors(local)
        setSaveState("invalid")
        const first = FOCUS_ORDER.find((k) => local[k])
        if (first) focusError(first)
        return null
      }
      setErrors({})
      setPageError(null)
      setSaveState("saving")
      const wasNew = !projectId
      const r = await saveProjectPageAction(
        { project_id: projectId, client_id: projectId ? null : clientId, values: sent, expected_updated_at: opts.overwrite ? null : updatedAt, applied_proposals: sentApplied },
        previewState,
      ).catch(() => null)
      if (!r || !r.ok) {
        // the row was created but the rest failed: keep it so the retry updates (UQ-PA-3); drop the `{parent}:new` copy (UQ-PA-21)
        if (r?.error.created) {
          if (wasNew) preserved.clear()
          setProjectId(r.error.created.project_id)
          setUpdatedAt(r.error.created.updated_at)
          replaceUrl(r.error.created.project_id, chatIdRef.current)
        }
        const code = r?.error.code ?? "save_failed"
        if (code === "stale_write") {
          setSaveState("stale")
          setStale(true)
          return null
        }
        if (code === "not_found") {
          setLeaving(true)
          setNotFound(true)
          return null
        }
        if (code === "project_not_affiliated") {
          setLeaving(true)
          toast(PAGE_SAVE_ERROR_COPY.project_not_affiliated)
          router.replace(routes.careerItem("project", projectId ?? ""))
          return null
        }
        if (code === "project_affiliation_required") {
          setPageError({ text: PAGE_SAVE_ERROR_COPY.project_affiliation_required, toCareer: true })
          setSaveState("invalid")
          return null
        }
        if (code === "project_scope_change_not_allowed") {
          setPageError({ text: PAGE_SAVE_ERROR_COPY.project_scope_change_not_allowed })
          setSaveState("invalid")
          return null
        }
        const fieldErr = errorOfRefusal(code, r?.error.field, sent)
        if (fieldErr) {
          setErrors(fieldErr)
          setSaveState("invalid")
          const first = FOCUS_ORDER.find((k) => fieldErr[k])
          if (first) focusError(first)
          return null
        }
        setSaveState("failed")
        return null
      }
      // success: the `{parent}:new` copy goes before the key switches to the row id (UQ-PA-21)
      preserved.clear()
      setProjectId(r.project_id)
      setUpdatedAt(r.updated_at)
      setBaseline(sent)
      // entries sent are done (applied or skipped); fills made during the save stay
      setApplied((list) => list.filter((a) => !sentApplied.some((s) => s.writing_chat_id === a.writing_chat_id && s.field === a.field && s.rev === a.rev)))
      setSavedAt(r.updated_at)
      setSaveState("saved")
      setSaveSkips(r.skipped)
      const panel = panelRef.current
      if (panel) {
        const open = panel.chat
        const mine = r.applied.filter((a) => a.writing_chat_id === open?.id).map((a) => a.field)
        if (open && mine.length) panel.setDraft(markDraftApplied(open.structured_draft as ProjectStructuredDraft, mine, r.updated_at))
        const chats = [...new Set(r.applied.map((a) => a.writing_chat_id))]
        if (chats.length) panel.markApplied(chats)
      }
      if (wasNew) replaceUrl(r.project_id, chatIdRef.current)
      // OD-C3: the save that created the row → "프로젝트를 커리어에 추가했어요" once; later saves = C-06 "저장됨 HH:MM" only.
      // The panel's first-message save shows its own toast instead (UX S-10 [가정]).
      const added = firstSaveToast("project", { wasNew, fromPanel: Boolean(opts.fromPanel) })
      if (added) toast(added)
      notifyCareerSaved()
      void gate.recheck()
      return r.project_id
    },
    [projectId, clientId, updatedAt, previewState, preserved, replaceUrl, router, gate],
  )
  const doSaveRef = React.useRef(doSave)
  React.useEffect(() => {
    doSaveRef.current = doSave
  })

  // 입력 보존: what a previous visit left unsaved comes back on its own (no restore banner) — the page is dirty,
  // so 저장하기 is enabled and leaving asks first. U40-2: only when the row wasn't saved elsewhere since the copy
  // was written (base_updated_at = the row's updated_at now); otherwise the copy is dropped and the saved row shows
  const { stored: preservedStored, resolve: resolvePreserved, clear: clearPreserved } = preserved
  const loadedUpdatedAt = data.updated_at
  React.useEffect(() => {
    if (!preservedStored) return
    if (!isRestorable(preservedStored, loadedUpdatedAt)) {
      clearPreserved()
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- apply the stored copy once, after hydration
    setValues(preservedStored.values)
    setApplied(preservedStored.applied)
    resolvePreserved()
  }, [preservedStored, resolvePreserved, clearPreserved, loadedUpdatedAt])

  const guard = useLeaveGuard({ dirty, onSave: async () => Boolean(await doSaveRef.current()), onDiscard: preserved.clear })

  // ---------- panel ----------
  const formSnapshot = React.useMemo(() => toProjectFormSnapshot(values), [values])
  const panel = useAiPanel({
    target: "project",
    targetId: projectId,
    initialChats: data.chats,
    initialChat: data.open_chat,
    formSnapshot,
    preview: data.preview,
    returnTarget,
    gateFeatureLabel: returnTarget ? RETURN_FEATURE_LABELS[returnTarget.feature] : null,
    requireName: () => {
      if (!isBlank(valuesRef.current.name)) return true
      setNameAttention(true)
      titleRef.current?.focus()
      return false
    },
    savePage: () => doSaveRef.current({ fromPanel: true }),
    onChatChange: (chatId) => {
      chatIdRef.current = chatId
      // [UI-가정] a new page keeps its URL until the row exists (the save replaces it with `?chat=` then)
      if (projectIdRef.current) replaceUrl(projectIdRef.current, chatId)
    },
  })
  const projectIdRef = React.useRef(projectId)
  React.useEffect(() => {
    projectIdRef.current = projectId
    panelRef.current = panel
  })

  const draft = panel.chat?.structured_draft as ProjectStructuredDraft | undefined
  const chatId = panel.chat?.id ?? null
  const pickKey = chatId && draft?.classification.competencies ? `${chatId}:${draft.classification.competencies.rev ?? 1}` : null
  const pick = competencyPick && competencyPick.key === pickKey ? competencyPick.pick : null

  // ---------- [반영] = fill the form ----------
  const fieldElement = (f: ProjectProposalField): HTMLElement | null => {
    if (f === "start_month" || f === "end_month") return document.getElementById("head-period")
    if (f === "project_type" || f === "experience_type" || f === "competencies") return document.getElementById(`head-${f}`)
    return document.getElementById(`star-field-${f}`)
  }

  const onFill = (cid: string, fields: readonly ProjectProposalField[], opts?: FillOptions): FillPlan => {
    const d = panel.chat?.structured_draft as ProjectStructuredDraft | undefined
    if (!d || panel.chat?.id !== cid) return { fills: [], skips: [] }
    const plan = planFill({
      draft: d,
      chatId: cid,
      values: valuesRef.current,
      applied: appliedRef.current,
      fields,
      competencyPick: pick,
      overwriteClassification: opts?.overwriteClassification,
    })
    if (!plan.fills.length) return plan
    const nextValues = applyFills(valuesRef.current, plan.fills)
    valuesRef.current = nextValues
    setValues(nextValues)
    setApplied((a) => {
      const merged = mergeApplied(a, cid, plan.fills)
      appliedRef.current = merged
      return merged
    })
    setSaveSkips([])
    if (saveState !== "saving") setSaveState("idle")
    const label = plan.fills.length === 1 ? PROPOSAL_FIELD_LABELS[plan.fills[0].field] : plan.fills.map((f) => PROPOSAL_FIELD_LABELS[f.field]).join(", ")
    window.setTimeout(() => plan.fills.forEach((f) => flashElement(fieldElement(f.field))), 30)
    // OD-P2 (UX v5.13): an information toast only — no undo button (going back = "저장하지 않고 나가기").
    // 여러 섹션이면 이름을 쉼표로 이어 씀 (구현 그대로)
    toast(`${label}에 채웠어요`)
    setLive(`${label}에 채웠어요. 저장하기를 눌러야 저장돼요`)
    return plan
  }

  const showInForm = (f: ProjectProposalField) => {
    panel.placement.setSheetOpen(false)
    window.setTimeout(() => {
      const el = fieldElement(f)
      el?.scrollIntoView({ block: "center" })
      flashElement(el)
    }, 250)
  }

  // ---------- edits ----------
  const set = <K extends keyof ProjectPageValues>(k: K, v: ProjectPageValues[K]) => {
    if (saveState !== "saving") setSaveState("idle")
    setValues((x) => {
      const next = { ...x, [k]: v }
      // 진행 중: 종료월 비활성·비움 (UX S-10 머리)
      if (k === "is_current" && v === true) next.end_month = null
      return next
    })
    const ek: ErrorKey | null = k === "name" ? "name" : k === "start_month" || k === "end_month" || k === "is_current" ? "period" : (k as ErrorKey)
    if (ek && errors[ek]) setErrors((e) => ({ ...e, [ek]: undefined }))
  }

  const pickAffiliation = (a: ProjectPageData["affiliations"][number]) => {
    setPageError(null)
    setValues((v) => ({ ...v, experience_id: a.type === "experience" ? a.id : null, education_id: a.type === "education" ? a.id : null }))
  }

  // ---------- derived ----------
  // 아직 행이 없는 "새 프로젝트" 상태 — URL이 아니라 `projectId`를 따르므로 첫 저장 성공 직후 바로 기존 행 표시로 바뀐다
  const isNew = !projectId
  const uiState: SaveUiState = saveState === "saving" || saveState === "failed" || saveState === "invalid" || saveState === "stale" ? saveState : dirty ? "dirty" : savedAt ? "saved" : "idle"
  // the open chat's skips are drawn inside its card; the rest (or every skip when no card shows) here
  const cardShown = Boolean(chatId && draft && hasProposals(draft))
  const outsideSkipLines = [
    ...new Set(saveSkips.filter((sk) => !cardShown || sk.writing_chat_id !== chatId).map((sk) => PAGE_SAVE_SKIP_COPY[sk.reason])),
  ]
  // projectSpanLabel already returns "(1년 11개월)" or "" (QA UQ-S10-1)
  const spanLabel = values.start_month && (values.end_month || values.is_current) ? projectSpanLabel(values.start_month, values.end_month, values.is_current) : ""
  const pendingFor = (f: ProjectStarField) => {
    const o = draft?.star[f]
    return Boolean(chatId && o && !isBlank(o.value) && !o.applied_at && !isFilledNow(applied, chatId, f, o))
  }

  if (notFound) return <ErrorState kind="not-found" inShell={false} />

  return (
    <PageShell guard={guard} aiReopen={panel.reopen} save={<SaveButton state={uiState} savedAt={savedAt} onSave={() => void doSave()} />}>
      <CrumbRow
        back={{ href: parentHref, label: parentName }}
        items={[
          { label: parentName, href: parentHref },
          // 행이 없고 이름도 비었으면 자리 표시 칸을 빼서 "{경력명} › 새 프로젝트 추가"로 읽히게 한다 (33 런)
          ...(isNew && isBlank(values.name) ? [] : [{ label: values.name, placeholder: "새 프로젝트" }]),
        ]}
        current={isNew ? CRUMB_CURRENT.project.new : CRUMB_CURRENT.project.existing}
      />
      <ShellBanners>
        <ReturnBanner />
        {requirementNotice}
        {pageError ? (
          <Alert variant="destructive" className="py-2">
            <CircleAlert aria-hidden />
            <AlertDescription className="flex flex-wrap items-center gap-2 text-sm">
              {pageError.text}
              {pageError.toCareer ? (
                <Button asChild variant="link" size="sm" className="h-auto px-0">
                  <Link href={routes.career()}>커리어로 가기</Link>
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
      </ShellBanners>

      {/* 머리 */}
      <DocHead className="space-y-3" label="프로젝트 정보">
        <div className="flex items-start gap-2">
          <DocTitleInput
            ref={titleRef}
            id="project-title"
            label="프로젝트명"
            placeholder="프로젝트명을 입력해 주세요"
            aria-required
            maxLength={PAGE_LIMITS.projectName}
            value={values.name}
            attention={nameAttention && isBlank(values.name)}
            invalid={Boolean(errors.name)}
            aria-describedby={errors.name || nameAttention ? "project-title-msg" : undefined}
            onChange={(e) => set("name", e.target.value)}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="프로젝트 메뉴" className="mt-1">
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setAffOpen(true)}>
                <ArrowRightLeft aria-hidden />
                소속 변경
              </DropdownMenuItem>
              {projectId ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                    <Trash2 aria-hidden />
                    프로젝트 삭제
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {errors.name ? (
          <p id="project-title-msg" className="flex items-center gap-1.5 text-sm text-destructive">
            <CircleAlert className="size-4" aria-hidden />
            {errors.name}
          </p>
        ) : nameAttention && isBlank(values.name) ? (
          <p id="project-title-msg" className="flex items-center gap-1.5 text-sm text-warning-subtle-foreground">
            <TriangleAlert className="size-4 text-warning" aria-hidden />
            대화를 시작하려면 프로젝트명을 먼저 입력해 주세요
          </p>
        ) : null}
        <div className="space-y-2">
          {/* row 1: 프로젝트 종류 · 경험 유형 · 역량 / row 2: 진행 기간 — narrow: one field per line */}
          <InlineFields className="max-md:flex-col">
            <InlineField label="프로젝트 종류" labelId="f-type" error={errors.project_type ? <FieldError id="err-project_type" text={errors.project_type} /> : null}>
              <span id="head-project_type" tabIndex={-1} className="rounded-md">
                <ChipSelect value={values.project_type} onChange={(v) => set("project_type", v)} options={PROJECT_TYPE_LABELS} labelledBy="f-type" describedBy={errors.project_type ? "err-project_type" : undefined} invalid={Boolean(errors.project_type)} />
              </span>
            </InlineField>
            <InlineField label="경험 유형" labelId="f-exp" error={errors.experience_type ? <FieldError id="err-experience_type" text={errors.experience_type} /> : null}>
              <span id="head-experience_type" tabIndex={-1} className="rounded-md">
                <ChipSelect value={values.experience_type} onChange={(v) => set("experience_type", v)} options={EXPERIENCE_TYPE_LABELS} labelledBy="f-exp" describedBy={errors.experience_type ? "err-experience_type" : undefined} invalid={Boolean(errors.experience_type)} />
              </span>
            </InlineField>
            <InlineField label="역량" labelId="f-comp" error={errors.competencies ? <FieldError id="err-competencies" text={errors.competencies} /> : null}>
              <span id="head-competencies" tabIndex={-1} className="rounded-md">
                <CompetencyChips value={values.competencies} onChange={(v) => set("competencies", v)} options={COMPETENCY_LABELS} labelledBy="f-comp" describedBy={errors.competencies ? "err-competencies" : undefined} invalid={Boolean(errors.competencies)} />
              </span>
            </InlineField>
          </InlineFields>
          <InlineFields className="max-md:flex-col">
            <InlineField label="진행 기간" labelId="f-period" error={errors.period ? <FieldError id="err-period" text={errors.period} /> : null}>
              <span id="head-period" tabIndex={-1} className="flex flex-wrap items-center gap-2 rounded-md">
                <MonthField id="p-start" label="시작" size="sm" labelHidden invalid={Boolean(errors.period)} value={values.start_month} onChange={(v) => set("start_month", v)} />
                <span aria-hidden>~</span>
                <MonthField
                  id="p-end"
                  label="종료"
                  size="sm"
                  labelHidden
                  invalid={Boolean(errors.period)}
                  value={values.is_current ? null : values.end_month}
                  disabled={values.is_current}
                  onChange={(v) => set("end_month", v)}
                />
                <Label className="flex items-center gap-2 text-sm font-normal">
                  <Checkbox checked={values.is_current} onCheckedChange={(c) => set("is_current", c === true)} />
                  진행 중
                </Label>
                {spanLabel ? <span className="text-sm text-muted-foreground tabular-nums">{spanLabel}</span> : null}
              </span>
            </InlineField>
          </InlineFields>
        </div>
        {/* 저장 응답 건너뜀 for chats whose card isn't open (deleted = not_found, another chat) — QA UQ-S10-2 */}
        {outsideSkipLines.length ? (
          <ul className="space-y-0.5" aria-live="polite">
            {outsideSkipLines.map((l) => (
              <li key={l} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                {l}
              </li>
            ))}
          </ul>
        ) : null}
      </DocHead>
      <Separator />

      <DocBody
        placement={panel.placement}
        left={
          <div className="space-y-6">
            {STAR_FIELDS_ORDER.map((f) => {
              const v = values[f] ?? ""
              // typing / paste stop at 2,000 (the editor); over only via an outside fill — the label shows it, save refuses
              const over = v.length > PAGE_LIMITS.star || (limitHit.has(f) && v.length >= PAGE_LIMITS.star)
              const invalid = over || Boolean(errors[f])
              const showCount = over || focusedField === f || v.length > PAGE_LIMITS.star * 0.9
              return (
                <section key={f} aria-labelledby={`star-${f}`} className="space-y-1.5">
                  <h3 id={`star-${f}`} className="flex items-center gap-2 text-base leading-6 font-medium">
                    {invalid ? <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden /> : null}
                    <span className={cn(invalid && "text-destructive")}>{STAR_FIELD_LABELS[f].ko}</span>
                    <span className="font-normal text-muted-foreground">{STAR_FIELD_LABELS[f].en}</span>
                    {pendingFor(f) ? (
                      <button
                        type="button"
                        aria-label={`${STAR_FIELD_LABELS[f].ko} AI 제안 보기`}
                        onClick={() => {
                          panel.show()
                          setFocusRequest({ field: f, nonce: Date.now() })
                        }}
                        className="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <Badge variant="ai" className="h-5 gap-1 px-1.5">
                          <Sparkles className="size-3" aria-hidden />
                          AI 제안 있음
                        </Badge>
                      </button>
                    ) : null}
                    {/* 글자 수 in the label row (focus / ≥ 90% / over); over = the error line itself */}
                    {showCount ? (
                      <span id={`star-count-${f}`} className={cn("ml-auto text-sm font-normal tabular-nums", over ? "text-destructive" : "text-muted-foreground")}>
                        {over ? `${fieldTooLongCopy(PAGE_LIMITS.star)} · ` : null}
                        {v.length.toLocaleString("ko-KR")} / {PAGE_LIMITS.star.toLocaleString("ko-KR")}
                      </span>
                    ) : null}
                  </h3>
                  <DocTextarea
                    id={`star-field-${f}`}
                    aria-labelledby={`star-${f}`}
                    aria-invalid={invalid ? true : undefined}
                    aria-describedby={over ? `star-count-${f}` : errors[f] ? `star-help-${f}` : undefined}
                    maxLength={PAGE_LIMITS.star}
                    onLimitReached={() => setLimitHit((s) => (s.has(f) ? s : new Set(s).add(f)))}
                    onFocus={() => setFocusedField(f)}
                    onBlur={() => setFocusedField((x) => (x === f ? null : x))}
                    value={v}
                    placeholder={STAR_PLACEHOLDER[f]}
                    className="min-h-32"
                    onValueChange={(nv) => {
                      if (nv.length < PAGE_LIMITS.star && limitHit.has(f))
                        setLimitHit((s) => {
                          const n = new Set(s)
                          n.delete(f)
                          return n
                        })
                      set(f, nv)
                    }}
                  />
                  {/* no 글자 수 (the editor still stops at the limit) — the line is the error only */}
                  {errors[f] && !over ? (
                    <div id={`star-help-${f}`}>
                      <FieldError text={errors[f]!} />
                    </div>
                  ) : null}
                </section>
              )
            })}
            <div role="status" aria-live="polite" className="sr-only">
              {live}
            </div>
          </div>
        }
        aside={
          <AiPanel
            panel={panel}
            proposalInline
            renderProposal={(p) => (
              <StarProposalCard
                panel={p}
                values={values}
                applied={applied}
                onFill={onFill}
                competencyPick={pick}
                onCompetencyPickChange={(next) => pickKey && setCompetencyPick({ key: pickKey, pick: next })}
                saveSkips={saveSkips}
                focusRequest={focusRequest}
                onShowInForm={showInForm}
              />
            )}
            renderClosedActions={(p) => {
              const d = p.chat?.structured_draft as ProjectStructuredDraft | undefined
              if (!p.chat || !d) return null
              const n = fillableFields(d, p.chat.id, applied, pick, values)
              return (
                <Button size="sm" disabled={!n.length || p.responding} onClick={() => p.chat && onFill(p.chat.id, n)}>
                  모두 반영 <span className="tabular-nums">({n.length})</span>
                </Button>
              )
            }}
            renderAboveInput={() =>
              gate.ready && gate.returnHref && gate.target ? (
                <Button asChild size="sm" className="w-full">
                  <Link href={gate.returnHref}>{RETURN_FEATURE_LABELS[gate.target.feature]}
                    {directionParticle(RETURN_FEATURE_LABELS[gate.target.feature])} 돌아가기</Link>
                </Button>
              ) : null
            }
            onUserMessageClick={(m) => setFocusRequest({ messageId: m.id, nonce: Date.now() })}
            onDirectInput={() => document.getElementById("star-field-situation")?.focus()}
          />
        }
      />

      <StaleWriteDialog
        open={stale}
        entity="project"
        busy={saveState === "saving"}
        onOpenChange={setStale}
        onOverwrite={() => {
          setStale(false)
          void doSave({ overwrite: true })
        }}
        onReload={guard.reloadDiscarding}
      />
      <AffiliationDialog open={affOpen} onOpenChange={setAffOpen} affiliations={data.affiliations} current={{ type: parentType, id: parentId }} onPick={pickAffiliation} />
      <DeleteConfirmDialog
        target={projectId ? { kind: "career", entity_type: "project", entity_id: projectId, label: values.name || baseline.name, scope: "affiliated", unsavedChanges: dirty } : null}
        open={deleteOpen && Boolean(projectId)}
        onOpenChange={setDeleteOpen}
        onConfirm={async (opts) => {
          if (!projectId) return
          await deleteAffiliatedProjectAction(projectId, opts.result_mode)
          // unsaved edits go with it (C-05 S-10): no leave prompt, no restore banner
          setLeaving(true)
          preserved.clear()
          // [UI-가정] 삭제 완료 토스트
          toast("프로젝트를 삭제했어요")
          // the saved affiliation, not an unsaved 소속 변경 (QA UQ-S10-5)
          router.replace(routes.careerItem(baseline.experience_id ? "experience" : baseline.education_id ? "education" : data.parent.type, baseline.experience_id ?? baseline.education_id ?? data.parent.id))
        }}
      />
    </PageShell>
  )
}

function FieldError({ text, id }: { text: string; id?: string }) {
  return (
    <p id={id} className={cn("flex items-center gap-1.5 text-sm text-destructive")}>
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      {text}
    </p>
  )
}

export { NOT_FOUND_TOAST }
