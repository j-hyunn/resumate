"use client"

/**
 * S-17 서류 초안 목록·경력기술서 설정 (FL-03).
 * - 목록: 이 기업 JD의 초안(종류·상태·편집일) → S-19 / S-18, 삭제(C-05)
 * - 새 서류: 경력기술서(포함 항목 = AI에게 맡기기 기본 / 직접 고르기, C-11 트리, 출처 배지) → 생성 → S-19 스트리밍
 *            자기소개서 → 기본 3문항 시드(AI 없음) → S-18
 * - C-09 게이트(draft.ready), ST-LIMIT, ST-WAIT-JD, C-10 복귀 시 포함 항목 복원
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CircleX, FileText, ListChecks, Loader2, MoreHorizontal, NotebookPen, RotateCcw, Trash2, TriangleAlert } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { AiProgressInline } from "@/components/common/ai-progress"
import { DataInsufficientGate } from "@/components/common/data-gate"
import { DeleteConfirmDialog } from "@/components/common/delete-confirm-dialog"
import { WaitJd } from "@/components/common/state-views"
import { AiRunButton } from "@/components/common/ai-run-button"
import { peekAiConnected } from "@/components/common/ai-connect-return"
import type { AiConnection, AiErrorCode, DataReadiness, Draft, DraftOptions, DraftSelectionOrigin, DraftStatus, DraftTone } from "@/types/db"
import { AI_RETRY_TOKEN_NOTE, AiErrorNotice, aiErrorTitle } from "@/components/common/ai-error-notice"
import { useAiConsentGate } from "@/components/common/consent-gate"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import { isAiRejected, notifyAiRejected } from "@/components/common/ai-rejection"
import { AI_PROVIDER_LABELS } from "@/lib/mock/ai-providers"
import { useRequirementsFirst } from "./extract-first"
import { toast } from "sonner"
import { actionFailedMessage } from "@/lib/data/labels"
import { formatDate } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { DRAFT_STATUS_LABELS, DRAFT_TYPE_LABELS, SELECTION_ORIGIN_LABELS } from "./labels"
import { SourceCheckTree, type TreeSelection } from "./source-tree"
import { useRestoreReturnParams } from "./shared"
import type { SourceTree } from "@/lib/data/drafts"
import {
  createCareerDescriptionAction,
  createCoverLetterAction,
  deleteDraftAction,
  rankDraftSourcesAction,
} from "@/app/(dashboard)/(gated)/applications/_lib/actions"
import { EXTRACT_FIRST_NOTE } from "@/app/(dashboard)/(gated)/applications/_lib/jd-state"
import { notifyAiConnectionChanged, useAiConnection } from "@/components/common/ai-connection-context"
import { ProviderResultTag } from "@/components/common/provider-badge"
import { initialDraftEntry, markDraftEntered } from "./draft-entry"

/**
 * Q53-7: opening a "작성 중" row shows the 경력기술서 settings in the panel below, even when 자기소개서 is
 * selected there. Row and panel are sibling client components under a server page.
 */
const OPEN_COMPOSING_EVENT = "resumate:open-composing-draft"

/** per-row values the page derives from sections (자소서 실패 문항 수 · 완료 문항 유무, v5.3) */
export interface DraftRowMeta {
  failed_sections: number
  /** 생성 완료된 문항이 있음 (없으면 결과 배지 없음) */
  has_result: boolean
}

/** v5.3 S-17 초안 목록 상태 배지 (design-system 6장 A3, drafts.status 5종) */
function DraftStatusBadge({ status, failedSections }: { status: DraftStatus; failedSections: number }) {
  switch (status) {
    case "composing":
      return <Badge variant="draft">{DRAFT_STATUS_LABELS.composing}</Badge>
    case "generating":
      return (
        <Badge variant="ai">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          {DRAFT_STATUS_LABELS.generating}
        </Badge>
      )
    case "ready":
      return <Badge variant="success">{DRAFT_STATUS_LABELS.ready}</Badge>
    case "partially_failed":
      return (
        <Badge variant="warning">
          <TriangleAlert className="size-3" aria-hidden />
          {failedSections > 0 ? `${failedSections}개 문항 생성 실패` : DRAFT_STATUS_LABELS.partially_failed}
        </Badge>
      )
    case "failed":
      return (
        <Badge variant="destructive-subtle">
          <CircleX className="size-3" aria-hidden />
          {DRAFT_STATUS_LABELS.failed}
        </Badge>
      )
  }
}

export function DraftList({
  applicationProjectId,
  drafts,
  meta = {},
  extractFirst = false,
}: {
  applicationProjectId: string
  drafts: Draft[]
  meta?: Record<string, DraftRowMeta>
  /** UQ-521: 실패 초안 "다시 시도"도 요건 선행 추출(A13)을 먼저 — 새 초안 행은 추출 성공 뒤에만 */
  extractFirst?: boolean
}) {
  const router = useRouter()
  const req = useRequirementsFirst(applicationProjectId, { needed: extractFirst, rerunLabel: "다시 시도", jdEditFrom: { from: "drafts" } })
  const previewWrite = usePreviewWriteGuard()
  const [target, setTarget] = React.useState<Draft | null>(null)
  /**
   * v5.3 A4: a failed career description is retried as a **new** draft row with the same settings
   * (포함 항목·문체), from the start, on the active provider. The failed row stays.
   */
  const retryFailed = async (d: Draft) => {
    if (previewWrite.stop()) return
    try {
      const { id } = await createCareerDescriptionAction(applicationProjectId, { ...d.options, tone: d.options.tone ?? "concise" }, d.id)
      router.push(`${routes.draft(applicationProjectId, id)}?generate=1`)
    } catch {
      toast.error(actionFailedMessage("다시 시도"))
    }
  }
  if (drafts.length === 0) return <p className="text-muted-foreground">아직 만든 서류 초안이 없어요</p>
  return (
    <>
      <ul className="space-y-2">
        {drafts.map((d) => {
          // Q53-7 경력기술서 `composing`: 블록 없음. 열면 아래 설정이 options로 복원돼 있다 (자동 AI-11 없음)
          const composingCd = d.draft_type === "career_description" && d.status === "composing"
          const href = composingCd
            ? `${routes.applicationDrafts(applicationProjectId)}#new-draft`
            : d.draft_type === "cover_letter" && d.status === "composing"
              ? routes.draftQuestions(applicationProjectId, d.id)
              : routes.draft(applicationProjectId, d.id)
          const label = `${DRAFT_TYPE_LABELS[d.draft_type]}${d.title && d.title !== DRAFT_TYPE_LABELS[d.draft_type] ? ` · ${d.title}` : ""}`
          // A4: 경력기술서 생성 실패 행은 열 수 없다 (블록 없음) — 다시 시도(새 초안) / 삭제
          const failedCd = d.draft_type === "career_description" && d.status === "failed"
          const m = meta[d.id]
          // 결과 배지: drafts.provider·model·model_tier — 자소서는 data layer가 문항 생성 완료 때만 복사 (S-17 v5.3, UQ-522)
          const result = (d.draft_type === "career_description" ? d.status !== "failed" && !composingCd : (m?.has_result ?? false)) ? d : null
          const menu = (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`${label} 메뉴`}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onSelect={() => setTarget(d)}>
                  <Trash2 aria-hidden />
                  삭제
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
          const meta1 = (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <DraftStatusBadge status={d.status} failedSections={m?.failed_sections ?? 0} />
              <span className="tabular-nums">{d.edited_at ? `편집 ${formatDate(d.edited_at)}` : `생성 ${formatDate(d.created_at)}`}</span>
              {d.options.selection_origin ? <span>· {SELECTION_ORIGIN_LABELS[d.options.selection_origin]}</span> : null}
              {d.draft_type === "career_description" ? <span>· 문체 {TONE_LABELS[d.options.tone ?? "concise"]}</span> : null}
              {result?.provider ? <ProviderResultTag provider={result.provider} model_tier={result.model_tier} model={result.model} className="relative z-10" /> : null}
            </p>
          )
          const Icon = d.draft_type === "cover_letter" ? NotebookPen : FileText
          if (failedCd)
            return (
              <li key={d.id}>
                <Card size="sm" className="gap-2 px-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-muted-foreground">{label}</p>
                        {meta1}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <AiRunButton
                        lock={{ entry: "draft", actionName: `${label} 다시 시도` }}
                        variant="outline"
                        size="sm"
                        disabled={req.busy}
                        onRun={() => req.run(() => retryFailed(d))}
                      >
                        <RotateCcw aria-hidden />
                        다시 시도
                      </AiRunButton>
                      <Button variant="destructive-ghost" size="sm" aria-label={`${label} 삭제`} onClick={() => setTarget(d)}>
                        삭제
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{AI_RETRY_TOKEN_NOTE}</p>
                </Card>
              </li>
            )
          return (
            <li key={d.id}>
              <Card size="sm" interactive className="relative flex-row items-center gap-3 px-4">
                <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <Link href={href} onClick={composingCd ? () => window.dispatchEvent(new Event(OPEN_COMPOSING_EVENT)) : undefined} className="font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {label}
                  </Link>
                  {meta1}
                </div>
                <div className="relative z-10">{menu}</div>
              </Card>
            </li>
          )
        })}
      </ul>
      {req.slot}
      <DeleteConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        target={target ? { kind: "draft", entity_id: target.id, label: DRAFT_TYPE_LABELS[target.draft_type] } : null}
        onConfirm={async () => {
          if (!target) return
          await deleteDraftAction(target.id)
          setTarget(null)
          router.refresh()
        }}
      />
    </>
  )
}

type Kind = "career_description" | "cover_letter"

/** v5.3 C-11 / S-17: 경력기술서 프로젝트 최대 8개 (구현 값 [가정]) */
const MAX_PROJECTS = 8

const TONE_LABELS: Record<DraftTone, string> = { concise: "간결", detailed: "상세" }

const projectsOf = (ids: string[]): TreeSelection => ({ projects: Object.fromEntries(ids.slice(0, MAX_PROJECTS).map((i) => [i, [] as string[]])) })

export function NewDraftPanel({
  applicationProjectId: apId,
  applicationName,
  tree,
  insightPriorities,
  readiness,
  activeChatId,
  waitJd,
  extractFirst = false,
  extractFailPreview = null,
  gateChatFailure = null,
  failRanking = false,
  composingDraft = null,
  previewGate = null,
}: {
  applicationProjectId: string
  applicationName: string
  tree: SourceTree
  /** latest insight strategy.project_priorities (rank order) */
  insightPriorities: string[] | null
  readiness: DataReadiness
  activeChatId: string | null
  waitJd: boolean
  /** JD has no requirements yet (추출 전·실패, UQ-510) → A13 요건 선행 추출 before AI-11 / 생성 */
  extractFirst?: boolean
  /** `?state=extract-failed*` */
  extractFailPreview?: AiErrorCode | null
  /** C-09 대화 시작 실패 분기 (?state=insufficient-chat-failed) */
  gateChatFailure?: AiErrorCode | null
  failRanking?: boolean
  /** Q53-7: the stopped first generation, restored as the settings (no automatic AI-11) */
  composingDraft?: Draft | null
  /** `?state=no-requirements-consent | -key-invalid`: the gate on a JD without requirements */
  previewGate?: "consent" | "key_invalid" | null
}) {
  const router = useRouter()
  const previewConnection: AiConnection | null = previewGate
    ? {
        active_provider: readiness.ai_connection.active_provider ?? "gemini",
        key_status: previewGate === "key_invalid" ? "invalid" : "valid",
        connection_tier: readiness.ai_connection.connection_tier ?? "free",
        consent_required: previewGate === "consent",
      }
    : null
  const baseConnection = previewConnection ?? readiness.ai_connection
  const connection = useAiConnection(baseConnection)
  // v4: no key → AI-11 (AI에게 맡기기) and 초안 생성 are locked; the tree stays usable (직접 고르기)
  const locked = !!connection && !connection.active_provider
  const consent = useAiConsentGate(baseConnection)
  const previewWrite = usePreviewWriteGuard()
  // v5.3 A13: requirements are extracted first (separate request), then AI-11 / generation
  const req = useRequirementsFirst(apId, { needed: extractFirst, rerunLabel: "초안 생성", previewFail: extractFailPreview, jdEditFrom: { from: "drafts" } })
  const [kind, setKind] = React.useState<Kind>("career_description")
  React.useEffect(() => {
    const open = () => setKind("career_description")
    window.addEventListener(OPEN_COMPOSING_EVENT, open)
    return () => window.removeEventListener(OPEN_COMPOSING_EVENT, open)
  }, [])
  // Q53-4: 기본 선택은 "AI에게 맡기기" (자동 실행이 없는 진입 포함). 키 없음만 고를 수 없어 직접 고르기.
  // Q53-7: `composing` 복원은 저장된 출처를 따른다
  const [mode, setMode] = React.useState<"ai" | "user">(() =>
    composingDraft ? (composingDraft.options.selection_origin === "user" ? "user" : "ai") : locked ? "user" : "ai",
  )
  const modeRef = React.useRef(mode)
  React.useEffect(() => {
    modeRef.current = mode
  })
  // v5.3 A17: 문체 — 화면 기본 선택은 간결, 생성 요청에 항상 값을 보낸다. Q53-7: 복원
  const [tone, setTone] = React.useState<DraftTone>(composingDraft?.options.tone ?? "concise")
  const usePriorities = !!insightPriorities && insightPriorities.length > 0
  const allProjects = React.useMemo(() => [...tree.affiliations.flatMap((a) => a.projects), ...tree.standalone], [tree])
  /** Q53-7: `options` of the stopped generation; projects deleted since are dropped from the checks */
  const [resumed] = React.useState(() => {
    if (!composingDraft) return null
    const ids = (composingDraft.options.included_project_ids ?? []).filter((id) => allProjects.some((p) => p.id === id))
    const saved: DraftSelectionOrigin = composingDraft.options.selection_origin ?? "user"
    // UQ-604: every item an AI pick chose is gone → nothing is left to restore, it can be asked again (C-11)
    return { selection: projectsOf(ids), origin: saved !== "user" && ids.length === 0 ? null : saved }
  })
  const keyInvalid = connection?.key_status === "invalid"
  /** Q53-4: 동의 필요·키 무효는 추출도 AI-11도 자동으로 돌리지 않는다. 누를 때 C-21 / 키 교체 */
  const gateBlocked = consent.required || keyInvalid
  /**
   * AI-11 runs automatically once on entry (03 AI-11). Never without a key, never right after returning
   * from AI 연결 (D-UX-16), never when the key gets connected while on the page, never on a `composing`
   * restore (Q53-7), never through the gate (Q53-4). A JD without requirements runs it after "새 경력기술서".
   */
  const [autoRank] = React.useState(
    () => !usePriorities && !resumed && readiness.features.draft.ready && !locked && !extractFirst && !gateBlocked,
  )
  /**
   * Q53-4 / FL-03 요건 없는 JD: "새 경력기술서" → 추출 → 설정 화면 + AI-11 (the press is what allows the
   * extraction, D-30). Gate blocked / 복귀 / 복원 skip this step and open the settings without any call.
   * One-way (UQ-600): 동의 or a new key on the way must not bring the step back.
   */
  const [entry, setEntry] = React.useState(() => initialDraftEntry({ extractFirst, resumed: !!resumed, gateBlocked, locked }))
  const markEntered = React.useCallback(() => setEntry(markDraftEntered()), [])
  const settingsHead = React.useRef<HTMLParagraphElement>(null)
  const [selection, setSelection] = React.useState<TreeSelection>(() => (resumed?.origin ? resumed.selection : usePriorities ? projectsOf(insightPriorities!) : { projects: {} }))
  const [origin, setOrigin] = React.useState<DraftSelectionOrigin | null>(resumed?.origin ?? (usePriorities ? "insight" : null))
  /** AI default (insight priorities / AI-11) — restored when switching back to "AI에게 맡기기" (A3 UQ-76) */
  const [aiDefault, setAiDefault] = React.useState<{ selection: TreeSelection; origin: DraftSelectionOrigin } | null>(() => {
    if (resumed?.origin && resumed.origin !== "user") return { selection: resumed.selection, origin: resumed.origin }
    return usePriorities ? { selection: projectsOf(insightPriorities!), origin: "insight" } : null
  })
  const [ranking, setRanking] = React.useState(autoRank)
  /** C-20 key_invalid after picking "AI에게 맡기기" with an invalid key (Q53-4) */
  const [rankInvalid, setRankInvalid] = React.useState(false)
  /** v5.3 A23: AI-11 failed → unchecked tree + 직접 고르기 + cause line + "AI에게 다시 맡기기" */
  const [rankFailure, setRankFailure] = React.useState<AiErrorCode | null>(null)
  // read during render (before child AiRunButton effects consume the flag); used only in the effect below
  const [returnedAtMount] = React.useState(justReturnedFromConnect)
  const [busy, setBusy] = React.useState(false)
  const restored = React.useRef(false)
  /** the user changed the checks (an AI-11 result never overwrites them) */
  const touched = React.useRef(false)

  // C-10 → restore 경력기술서 포함 항목 · 문체
  useRestoreReturnParams(apId, "career_description", (params) => {
    const ids = Array.isArray(params.included_project_ids) ? (params.included_project_ids as string[]) : null
    if (params.tone === "concise" || params.tone === "detailed") setTone(params.tone)
    if (ids) {
      restored.current = true
      markEntered()
      setKind("career_description")
      setMode("user")
      setOrigin("user")
      setSelection(projectsOf(ids))
    }
  })
  // C-10 → back from the 자기소개서 gate: restore the chosen kind and clear the target (A3 UQ-63)
  useRestoreReturnParams(apId, "cover_letter", () => setKind("cover_letter"))

  // Q53-4: 자동 실행이 없는 진입도 기본 선택은 "AI에게 맡기기" (체크 없는 트리 + 아래 안내)
  // 키 없음은 "AI에게 맡기기"를 고를 수 없어 직접 고르기 (A23: 대체 선택 없음)
  const [manualDefaultApplied, setManualDefaultApplied] = React.useState(false)
  if (locked && !usePriorities && !resumed && !manualDefaultApplied) {
    setManualDefaultApplied(true)
    setMode("user")
    setOrigin("user")
  }

  /** AI-11 (sync). Returns a start refusal so AiRunButton can open C-18 / C-21. */
  const runRanking = React.useCallback(
    async (applyToSelection: () => boolean): Promise<unknown> => {
      setRanking(true)
      setRankFailure(null)
      const r = await rankDraftSourcesAction(apId, failRanking)
      setRanking(false)
      // UQ-603 (C-11): a gate refusal keeps "AI에게 맡기기" selected and the checks as they are
      if (isAiRejected(r)) return r
      if (!r.ok) {
        // A23: no fallback selection — the tree opens unchecked, 직접 고르기 (selection_origin = user)
        setRankFailure(r.error_code)
        setAiDefault(null)
        if (!restored.current && !touched.current) {
          setMode("user")
          setOrigin("user")
          setSelection({ projects: {} })
        }
        return undefined
      }
      const next = { selection: projectsOf(r.project_ids), origin: "ai_ranking" as const }
      setAiDefault(next)
      // never overwrite what the user chose (C-10 restore, 직접 고르기, edited checks)
      if (!applyToSelection()) return undefined
      setSelection(next.selection)
      setOrigin(next.origin)
      return undefined
    },
    [apId, failRanking],
  )

  // plain first entry with a key: AI-11 once (03 AI-11). Not re-run when `locked` changes.
  React.useEffect(() => {
    if (returnedAtMount) queueMicrotask(markEntered) // FL-19: settings first, no extraction
    if (!autoRank) return
    if (returnedAtMount) {
      // D-UX-16: back from AI 연결 → no automatic call; "AI에게 맡기기" stays selected (Q53-4, C-11)
      queueMicrotask(() => setRanking(false))
      return
    }
    let alive = true
    void runRanking(() => alive && !restored.current && !touched.current && modeRef.current === "ai").then((r) => {
      // UQ-603: no automatic C-21. The button stays ("AI에게 맡기기") and asks when pressed; refresh what it reads
      if (alive && isAiRejected(r)) notifyAiConnectionChanged()
    })
    return () => {
      alive = false
    }
  }, [autoRank, runRanking, returnedAtMount, markEntered])

  /** "AI에게 맡기기" / "AI에게 다시 맡기기": requirements first (A13), then AI-11 on the active provider */
  const rankNow = () =>
    req.run(() => {
      markEntered()
      return runRanking(() => {
        if (modeRef.current !== "ai" && !rankFailure) return false
        setMode("ai")
        return true
      })
    })

  /** "새 경력기술서" on a JD without requirements: extraction, then the settings with AI-11 once (Q53-4) */
  const enterNewCareerDescription = () =>
    req.run(() => {
      markEntered()
      if (usePriorities) return undefined
      return runRanking(() => !restored.current && !touched.current && modeRef.current === "ai")
    })
  const entryStep = kind === "career_description" && entry === "entry_step"

  /** "AI에게 맡기기" chosen (radio): use the AI default, or ask AI-11 now (consent first, R-67) */
  const chooseAiMode = () => {
    setMode("ai")
    setRankInvalid(false)
    if (aiDefault) {
      setSelection(aiDefault.selection)
      setOrigin(aiDefault.origin)
      return
    }
    if (locked) return
    if (keyInvalid) {
      setRankInvalid(true)
      return
    }
    consent.guard(() => {
      void rankNow().then((r) => {
        if (isAiRejected(r)) notifyAiRejected(r)
      })
    })
  }

  const includedIds = allProjects.filter((p) => p.id in selection.projects).map((p) => p.id)
  const order = insightPriorities?.length ? [...insightPriorities.filter((i) => includedIds.includes(i)), ...includedIds.filter((i) => !insightPriorities.includes(i))] : includedIds
  const featureLabel = kind === "career_description" ? "경력기술서" : "자기소개서"

  const generate = async () => {
    if (previewWrite.stop()) return
    setBusy(true)
    try {
      if (kind === "cover_letter") {
        const { id } = await createCoverLetterAction(apId)
        router.push(routes.draftQuestions(apId, id))
        return
      }
      const picked = allProjects.filter((p) => includedIds.includes(p.id))
      const options: DraftOptions = {
        included_experience_ids: [...new Set(picked.map((p) => p.experience_id).filter((x): x is string => !!x))],
        included_education_ids: [...new Set(picked.map((p) => p.education_id).filter((x): x is string => !!x))],
        included_project_ids: includedIds,
        project_order: order,
        selection_origin: mode === "user" ? "user" : (origin ?? "ai_ranking"),
        tone,
      }
      const { id } = await createCareerDescriptionAction(apId, options)
      router.push(`${routes.draft(apId, id)}?generate=1`)
    } catch {
      setBusy(false)
    }
  }

  // FL-08: 키 확인이 먼저 — 키가 없으면 경력기술서는 C-18 인라인(아래 AiRunButton), 게이트는 키가 있을 때만
  const gate = !readiness.features.draft.ready && !(locked && kind === "career_description") ? (
    <DataInsufficientGate
      feature="draft"
      featureLabel={featureLabel}
      returnFeature={kind}
      readiness={readiness}
      applicationProjectId={apId}
      applicationName={applicationName}
      returnHref={routes.applicationDrafts(apId)}
      returnParams={kind === "career_description" ? { included_project_ids: includedIds, tone } : undefined}
      activeChatId={activeChatId}
      chatFailure={gateChatFailure}
    />
  ) : null

  const shownOrigin: DraftSelectionOrigin | null = mode === "user" ? "user" : origin
  const full = includedIds.length >= MAX_PROJECTS
  // C-11 "자동 실행이 없는 진입": "AI에게 맡기기" is selected but nothing has run yet
  const aiWaiting = mode === "ai" && !aiDefault && !ranking && !req.busy && !rankFailure && !locked && includedIds.length === 0

  // UQ-608: "새 경력기술서" / "AI에게 맡기기" disappear when pressed → focus to the settings, not <body>
  const lastButtons = React.useRef({ entryStep, aiWaiting })
  React.useEffect(() => {
    const was = lastButtons.current
    lastButtons.current = { entryStep, aiWaiting }
    const gone = (was.entryStep && !entryStep) || (was.aiWaiting && !aiWaiting)
    if (gone && (!document.activeElement || document.activeElement === document.body)) settingsHead.current?.focus()
  }, [entryStep, aiWaiting])

  return (
    <Card id="new-draft" className="scroll-mt-20 gap-5 p-5">
      <h2 className="text-lg leading-7 font-semibold">새 서류 만들기</h2>
      <RadioGroup value={kind} onValueChange={(v) => setKind(v as Kind)} className="grid gap-3 sm:grid-cols-2" aria-label="서류 종류">
        <KindOption value="career_description" title="경력기술서" description="경력별 → 프로젝트별 역할·행동·결과로 정리해요" />
        <KindOption value="cover_letter" title="자기소개서" description="기본 3문항(지원 동기 / 직무 역량 / 입사 후 포부 및 성장 계획)으로 시작해요" />
      </RadioGroup>

      {gate ?? (entryStep ? (
        <div className="space-y-2">
          <AiRunButton lock={{ entry: "draft" }} onRun={enterNewCareerDescription} disabled={req.busy || waitJd} connection={connection}>
            새 경력기술서
          </AiRunButton>
          {req.busy ? null : <p className="text-sm leading-5 text-muted-foreground">{EXTRACT_FIRST_NOTE}</p>}
          {req.slot}
        </div>
      ) : (
        <>
          {kind === "career_description" ? (
            <div className="space-y-4">
              {/* v5.3 A17 문체: 트리 위 [UI-가정 위치 G-39], 해제 불가, null = 간결 */}
              <div className="space-y-2">
                <p id="cd-tone" className="text-sm font-medium">
                  문체
                </p>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={tone}
                  onValueChange={(v) => {
                    if (v === "concise" || v === "detailed") setTone(v)
                  }}
                  aria-labelledby="cd-tone"
                >
                  {(["concise", "detailed"] as const).map((t) => (
                    <ToggleGroupItem
                      key={t}
                      value={t}
                      className="h-9 px-4 text-sm"
                    >
                      {TONE_LABELS[t]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <div className="space-y-2">
                <p ref={settingsHead} tabIndex={-1} className="text-sm font-medium outline-none">
                  포함할 경력·프로젝트
                </p>
                <RadioGroup
                  value={mode}
                  onValueChange={(v) => {
                    if (v === "user") {
                      setMode("user")
                      setOrigin("user")
                    } else chooseAiMode()
                  }}
                  className="flex flex-wrap gap-4"
                  aria-label="포함 항목 고르는 방법"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="ai" id="mode-ai" disabled={locked || ranking || req.busy} />
                    <Label htmlFor="mode-ai" className="font-normal">
                      AI에게 맡기기
                      {locked ? <span className="ml-1 text-xs text-muted-foreground">(AI 연결 후)</span> : null}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="user" id="mode-user" />
                    <Label htmlFor="mode-user" className="font-normal">
                      직접 고르기
                    </Label>
                  </div>
                </RadioGroup>
                {rankInvalid && keyInvalid ? <AiErrorNotice code="key_invalid" size="inline" /> : null}
                {aiWaiting ? (
                  // C-11 "자동 실행이 없는 진입" (Q53-4): the radio is already selected, so the press needs its own button
                  <div className="space-y-2 pt-1">
                    <p className="text-sm text-muted-foreground">&lsquo;AI에게 맡기기&rsquo;를 누르면 포함할 항목을 골라 드려요</p>
                    <AiRunButton lock={{ entry: "draft", actionName: "AI에게 맡기기" }} variant="outline" size="sm" connection={connection} onRun={rankNow}>
                      AI에게 맡기기
                    </AiRunButton>
                  </div>
                ) : null}
              </div>
              {rankFailure ? (
                // v5.3 A23 AI 기본 선택 실패 (design-system 6장 A3)
                <Alert variant="warning">
                  <ListChecks aria-hidden />
                  <AlertTitle>AI가 포함할 항목을 고르지 못했어요. 직접 골라 주세요</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p className="text-sm">{aiErrorTitle(rankFailure, { provider: connection?.active_provider ? AI_PROVIDER_LABELS[connection.active_provider] : undefined })}</p>
                    <AiRunButton
                      lock={{ entry: "draft", actionName: "AI에게 다시 맡기기" }}
                      variant="outline"
                      size="sm"
                      pending={ranking}
                      disabled={req.busy}
                      connection={connection}
                      onRun={rankNow}
                    >
                      AI에게 다시 맡기기
                    </AiRunButton>
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="rounded-lg border p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {ranking ? (
                    <AiProgressInline progress={{ stage: "rank" }} />
                  ) : shownOrigin ? (
                    <Badge variant={shownOrigin === "insight" ? "info" : shownOrigin === "ai_ranking" ? "ai" : "outline"}>{SELECTION_ORIGIN_LABELS[shownOrigin]}</Badge>
                  ) : null}
                  <span className="text-sm text-muted-foreground tabular-nums">{includedIds.length}개 포함</span>
                  {full ? (
                    // [UI-가정] 문구 (G-39, P-13)
                    <span className="text-sm text-muted-foreground">· 프로젝트는 {MAX_PROJECTS}개까지 고를 수 있어요</span>
                  ) : null}
                </div>
                {ranking ? (
                  <div className="space-y-2" aria-hidden>
                    <Skeleton className="h-5 w-1/2" />
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-5 w-1/3" />
                  </div>
                ) : (
                  <SourceCheckTree
                    tree={tree}
                    selection={selection}
                    onChange={(next) => {
                      touched.current = true
                      setSelection(next)
                    }}
                    disabled={mode === "ai"}
                    idPrefix="cd"
                    maxProjects={MAX_PROJECTS}
                  />
                )}
                {mode === "ai" ? <p className="mt-3 text-sm text-muted-foreground">직접 고르기로 바꾸면 체크를 고칠 수 있어요</p> : null}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">문항·글자 수·메모를 정한 뒤 문항마다 초안을 만들어요. 문항 설정은 AI 연결 없이도 할 수 있어요</p>
          )}

          <div className="space-y-2">
            {kind === "career_description" && includedIds.length === 0 && !ranking && !locked ? (
              // [UI-가정] 문구 (G-39): 1개 이상 골라야 생성
              <p className="text-sm text-muted-foreground">포함할 항목을 1개 이상 골라 주세요</p>
            ) : null}
            {kind === "career_description" ? (
              <AiRunButton
                lock={{ entry: "draft" }}
                onRun={() => req.run(generate)}
                pending={busy}
                disabled={waitJd || ranking || req.busy || includedIds.length === 0}
                connection={connection}
                footer={req.needed && !locked && !req.busy ? <p className="text-sm leading-5 text-muted-foreground">{EXTRACT_FIRST_NOTE}</p> : null}
              >
                초안 생성
              </AiRunButton>
            ) : (
              <Button onClick={generate} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                문항 설정하기
              </Button>
            )}
            {kind === "career_description" ? (
              req.slot ?? (waitJd ? <WaitJd /> : null)
            ) : null}
          </div>
        </>
      ))}
      {consent.dialog}
    </Card>
  )
}

function KindOption({ value, title, description }: { value: Kind; title: string; description: string }) {
  return (
    <Label
      htmlFor={`kind-${value}`}
      className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-base font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-subtle"
    >
      <RadioGroupItem value={value} id={`kind-${value}`} className="mt-1" />
      <span className="space-y-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </Label>
  )
}

/** Just back from AI 연결 (FL-19)? Peeks without consuming (foundation `peekAiConnected`). */
function justReturnedFromConnect(): boolean {
  return peekAiConnected()
}
