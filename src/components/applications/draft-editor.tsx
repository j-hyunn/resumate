"use client"

/**
 * S-19 초안 편집기 (F-DOC-01~04, 08). design-system 5.3:
 * - ≥1280: 왼쪽 문서(max-w-prose-edit) + 오른쪽 sticky 패널(C-11, 자리 표시 목록)
 * - <1280: 패널은 머리의 "근거·출처" Sheet, 자소서 C-11은 문항 카드 아래 Collapsible
 * 경력기술서 = AI-03 블록 스트리밍, 자소서 = AI-04 문항 단위(근거 선택 먼저 → 문단).
 * 블록 편집은 edited_content로 자동 저장(C-06), AI 원본(ai_content)은 그대로.
 */
import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { ChevronDown, Clock, Copy, Info, PanelRight, Pencil, Sparkles, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { AiProgressInline } from "@/components/common/ai-progress"
import { DataInsufficientGate } from "@/components/common/data-gate"
import { EvidenceChips, EvidenceProvider } from "@/components/common/evidence"
import { countChars } from "@/components/common/input-guide"
import { BlockFlagBadges, CopyWithPlaceholderGuard, PLACEHOLDER_TOKENS, PlaceholderText, countPlaceholders } from "@/components/common/placeholders"
import { markCareerReturn, type ReturnTargetInput } from "@/components/common/return-target"
import { SaveStatus, useAutosave } from "@/components/common/save-status"
import { AiFailedInline, WaitJd } from "@/components/common/state-views"
import { AiErrorNotice, type AiErrorInfo } from "@/components/common/ai-error-notice"
import { AiRunButton } from "@/components/common/ai-run-button"
import { useAiConnection } from "@/components/common/ai-connection-context"
import { ProviderResultTag } from "@/components/common/provider-badge"
import { PendingBlock, StreamRegion, StreamingBlock, StreamingHeader, useAiStream, type GenerationNotesPayload } from "@/components/common/streaming"
import type { AiErrorCode, DataReadiness, DraftBlock, DraftSection, DraftSectionSource, DraftTone } from "@/types/db"
import type { DraftWithSections } from "@/lib/data/applications"
import type { EvidenceView } from "@/lib/data/evidence"
import { actionFailedMessage } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { cn } from "@/lib/utils"
import {
  COUNT_BASIS_LABELS,
  DRAFT_TYPE_LABELS,
  OMITTED_PROJECT_FALLBACK,
  OMITTED_REASON_FALLBACK,
  OMITTED_REASON_LABELS,
  SOURCE_ORIGIN_LABELS,
  SOURCE_ROLE_LABELS,
} from "./labels"

/** A3 UQ-86: the server refused to start (URL ?generate=, key removed in another tab …). [UI-가정] 문구 */
function notifyRefused(reason: "insufficient" | "locked" | "key_invalid" | "unavailable") {
  if (reason === "locked") toast.error("AI 연결하면 사용할 수 있어요. 설정 > AI 연결에서 키를 연결해 주세요")
  else if (reason === "key_invalid") toast.error("AI 키가 더 이상 작동하지 않아요. 설정 > AI 연결에서 새 키로 바꿔 주세요")
  else if (reason === "insufficient") toast.error("서류 초안을 만들려면 커리어가 조금 더 필요해요. 서류 초안 화면에서 채울 항목을 확인해 주세요")
  else toast.error(actionFailedMessage("생성 시작"))
}
import { CareerDescriptionSources, OverwriteConfirm, SectionSources, type RegenerateGuard } from "./sources-used"
import { AutoRefresh, useRestoreReturnParams } from "./shared"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import { useRequirementsFirst } from "./extract-first"
import { AiLock } from "@/components/common/ai-lock"
import { isAiRejected, notifyAiRejected } from "@/components/common/ai-rejection"
import type { SourceTree } from "@/lib/data/drafts"
import {
  createCareerDescriptionAction,
  finalizeCareerDescriptionAction,
  finalizeCoverLetterSectionAction,
  markDraftCopiedAction,
  prepareCareerDescriptionAction,
  prepareCoverLetterSectionAction,
  saveEditedContentAction,
} from "@/app/(dashboard)/(gated)/applications/_lib/actions"

type Section = DraftSection & { sources: DraftSectionSource[] }

const TOKEN_RE = new RegExp(PLACEHOLDER_TOKENS.map((t) => t.replace(/[[\]]/g, "\\$&")).join("|"), "g")

export interface DraftEditorProps {
  applicationProjectId: string
  applicationName: string
  draft: DraftWithSections
  evidence: Record<string, Record<string, EvidenceView[]>>
  tree: SourceTree
  requirements: Record<string, string>
  readiness: DataReadiness
  activeChatId: string | null
  waitJd: boolean
  /** JD has no requirements (추출 전·실패) → A13 요건 선행 추출 before any generation (UQ-510) */
  extractFirst?: boolean
  /** C-09 대화 시작 실패 분기 (?state=insufficient-chat-failed) */
  gateChatFailure?: AiErrorCode | null
  /** ?generate=1 | all | {sectionId} */
  autoGenerate: string | null
  /** v5.3 A4: the stored career description failed (no blocks) → C-20 + 새 초안으로 다시 시도 */
  storedFailure: Omit<AiErrorInfo, "sameRow"> | null
  preview: { stream: boolean; failed: AiErrorCode | null; failSave: boolean; finalizing?: boolean; stopping?: boolean }
}

/** S-19 생성 직후 안내 (A21): not stored — kept in memory until the screen is left ("" = 경력기술서) */
type NotesMap = Record<string, GenerationNotesPayload>

/** `?state=ai-stream` replay only — real runs use the plan's `notes` / `adjust_length` (UQ-516) */
const PREVIEW_NOTES: GenerationNotesPayload = {
  omitted: ["미리보기 프로젝트 — 포함할 항목에서 빠져 이번 초안에 넣지 않았어요"],
  notes_for_user: ["확인이 필요한 자리 표시를 남겼어요. 제출 전에 채워 주세요"],
}

function blocksOf(s: Section): DraftBlock[] {
  return s.edited_content?.blocks ?? s.ai_content?.blocks ?? []
}

function sectionText(s: Section): string {
  return blocksOf(s)
    .map((b) => b.text)
    .join("\n")
}

function documentText(draft: DraftWithSections, sections: Section[]): string {
  if (draft.draft_type === "cover_letter")
    return sections.map((s, i) => `${i + 1}. ${s.question_text ?? ""}\n\n${blocksOf(s).map((b) => b.text).join("\n\n")}`).join("\n\n")
  return sections.map((s) => [s.heading, ...blocksOf(s).map((b) => (b.block_kind === "bullet" ? `- ${b.text}` : b.text))].filter(Boolean).join("\n")).join("\n\n")
}

export function DraftEditor(props: DraftEditorProps) {
  const { applicationProjectId: apId, applicationName, draft, evidence, tree, requirements, readiness, waitJd, preview } = props
  const router = useRouter()
  const pathname = usePathname()
  const stream = useAiStream()
  const [sections, setSections] = React.useState<Section[]>(draft.sections)
  const [activeId, setActiveId] = React.useState<string | null>(draft.sections[0]?.id ?? null)
  const [current, setCurrent] = React.useState<string | null>(null) // section id or "draft" while streaming
  const [queue, setQueue] = React.useState<string[]>([])
  const [failedIds, setFailedIds] = React.useState<Record<string, AiErrorCode>>({})
  const [cdFailed, setCdFailed] = React.useState<AiErrorCode | null>(preview.failed ?? props.storedFailure?.code ?? null)
  /** v5.3 A21 생성 직후 안내 (validated 뒤, 저장 안 됨) */
  const [genNotes, setGenNotes] = React.useState<NotesMap>({})
  // UQ-239: provider / retry_after / quota_resets_at of each failure (from the stream error event)
  const [failInfo, setFailInfo] = React.useState<Record<string, Omit<AiErrorInfo, "code">>>(() => {
    const f = props.storedFailure
    const init: Record<string, Omit<AiErrorInfo, "code">> = {}
    if (f) init.draft = { provider: f.provider, retryAfter: f.retryAfter, quotaResetsAt: f.quotaResetsAt }
    return init
  })
  const [canceled, setCanceled] = React.useState(false)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  /** sections with local edits not yet saved (A3 UQ-68: server refresh must not overwrite them) */
  const [dirty, setDirty] = React.useState<Record<string, true>>({})
  /** last generation target, so a preview failure keeps showing what was received */
  const [lastTarget, setLastTarget] = React.useState<string | null>(null)
  const started = React.useRef(false)
  const generationRef = React.useRef<string | null>(null)
  const blocksRef = React.useRef(stream.blocks)
  const isPreview = preview.stream || !!preview.failed
  const isCover = draft.draft_type === "cover_letter"
  const connection = useAiConnection(readiness.ai_connection)
  const previewWrite = usePreviewWriteGuard()
  const locked = !!connection && !connection.active_provider
  const feature = isCover ? "cover_letter" : "career_description"
  // v5.3 A13 (UQ-510): every generate button on S-19 extracts requirements first when the JD has none
  const req = useRequirementsFirst(apId, {
    needed: !!props.extractFirst && !isPreview,
    rerunLabel: isCover ? "이 문항만 생성" : "초안 생성",
    jdEditFrom: isCover ? { from: "questions", draft: draft.id } : { from: "drafts" },
  })
  /** run from a place without AiRunButton (C-20 retry, 근거 변경 확인): a refusal becomes a toast + connection re-read */
  const runNotified = (next: () => unknown) => {
    void req.run(next).then((r) => {
      if (isAiRejected(r)) notifyAiRejected(r)
    })
  }

  // keep local copy in sync with server refreshes (not while a stream writes into it)
  const [syncedFrom, setSyncedFrom] = React.useState(draft.sections)
  if (syncedFrom !== draft.sections && current === null) {
    setSyncedFrom(draft.sections)
    setSections((prev) =>
      draft.sections.map((s) => {
        if (!dirty[s.id]) return s
        const local = prev.find((p) => p.id === s.id)
        return local ? { ...s, edited_content: local.edited_content } : s
      }),
    )
  }
  useRestoreReturnParams(apId, feature)

  const returnTarget: ReturnTargetInput = { application_project_id: apId, feature, application_name: applicationName, href: routes.draft(apId, draft.id) }
  const guard: RegenerateGuard = { ready: readiness.features.draft.ready, busy: current !== null || req.busy }
  const requirementLabel = (id: string) => requirements[id] ?? "삭제된 요건"

  // ---------------------------------------------------------------- autosave edits
  // A3 UQ-60: only sections with unsaved edits are sent; a saved (or regenerated) section leaves the
  // pending map, so an old edit can never be written over a newly generated body.
  const pendingEdits = React.useRef<Record<string, DraftBlock[]>>({})
  const autosave = useAutosave<number>({
    save: async () => {
      const snapshot = { ...pendingEdits.current }
      for (const [sectionId, blocks] of Object.entries(snapshot)) {
        await saveEditedContentAction(draft.id, sectionId, { blocks }, preview.failSave)
        if (pendingEdits.current[sectionId] === blocks) {
          delete pendingEdits.current[sectionId]
          setDirty((d) => {
            const next = { ...d }
            delete next[sectionId]
            return next
          })
        }
      }
    },
  })
  const editSeq = React.useRef(0)
  const editBlock = (sectionId: string, blockId: string, text: string) => {
    const target = sections.find((s) => s.id === sectionId)
    if (!target) return
    const blocks = blocksOf(target).map((b) => (b.block_id === blockId ? { ...b, text, user_modified: true } : b))
    pendingEdits.current = { ...pendingEdits.current, [sectionId]: blocks }
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, edited_content: { blocks } } : s)))
    setDirty((d) => (d[sectionId] ? d : { ...d, [sectionId]: true }))
    autosave.schedule(++editSeq.current)
  }
  /** a section about to be regenerated drops its unsaved edits (the new body replaces them) */
  const dropPendingEdits = React.useCallback((sectionIds: string[] | "all") => {
    const ids = sectionIds === "all" ? Object.keys(pendingEdits.current) : sectionIds
    for (const id of ids) delete pendingEdits.current[id]
    setDirty((d) => {
      const next = { ...d }
      for (const id of ids) delete next[id]
      return next
    })
  }, [])

  // ---------------------------------------------------------------- generation
  const generateCareerDescription = React.useCallback(async () => {
    if (!preview.stream && !preview.failed && previewWrite.stop()) return
    setCdFailed(null)
    setCanceled(false)
    setCurrent("draft")
    setLastTarget("draft")
    dropPendingEdits("all")
    if (preview.stream || preview.failed) {
      // preview: replay existing blocks without writing
      const blocks = draft.sections.flatMap((s) => blocksOf(s).map((b) => ({ block_id: b.block_id, text: b.text, flags: b.flags })))
      stream.start({ blocks, fail: preview.failed ?? undefined, failAfterBlocks: 1, discardOnError: true, notes: PREVIEW_NOTES })
      return
    }
    const plan = await prepareCareerDescriptionAction(draft.id)
    if ("refused" in plan) {
      setCurrent(null)
      notifyRefused(plan.refused)
      return
    }
    generationRef.current = plan.generation_id
    if ("request" in plan) {
      stream.start({ ...plan.request, discardOnError: true })
      return
    }
    // v5.3 A4: a failure keeps no block (discardOnError); validated replaces the whole draft (F9)
    stream.start({
      blocks: plan.blocks,
      provider: plan.provider,
      discardOnError: true,
      notes: plan.notes,
    })
  }, [draft.id, draft.sections, preview.failed, preview.stream, previewWrite, stream, dropPendingEdits])

  const generateSection = React.useCallback(
    async (sectionId: string) => {
      if (!preview.stream && !preview.failed && previewWrite.stop()) return
      setFailedIds((f) => {
        const next = { ...f }
        delete next[sectionId]
        return next
      })
      setCanceled(false)
      setCurrent(sectionId)
      setActiveId(sectionId)
      setLastTarget(sectionId)
      dropPendingEdits([sectionId])
      if (preview.stream || preview.failed) {
        const s = draft.sections.find((x) => x.id === sectionId)
        const blocks = s ? blocksOf(s).map((b) => ({ block_id: b.block_id, text: b.text, flags: b.flags })) : []
        stream.start({
          sources: [{ label: s?.sources[0]?.source_label ?? "그린페이먼츠 › 결제 승인 API 성능 개선", rationale: "문항 의도와 가장 직접 연결돼요" }],
          blocks: blocks.length ? blocks : [{ block_id: "preview", text: "저는 문제를 측정하고 구조를 바꿔 결과를 만드는 데 강점이 있습니다." }],
          fail: preview.failed ?? undefined,
          failAfterBlocks: 1,
        })
        return
      }
      const plan = await prepareCoverLetterSectionAction(sectionId)
      if ("refused" in plan) {
        setCurrent(null)
        notifyRefused(plan.refused)
        return
      }
      generationRef.current = plan.generation_id
      if ("request" in plan) {
        stream.start(plan.request)
        return
      }
      stream.start({
        sources: plan.sources,
        blocks: plan.blocks.map((b) => ({ ...b, section_id: sectionId })),
        provider: plan.provider,
        // v5.3 C-04: plan values — adjusting_length only when the answer is outside 90~110% of the limit (A12)
        adjustLength: plan.adjust_length,
        notes: plan.notes,
      })
    },
    [draft.sections, preview.failed, preview.stream, previewWrite, stream, dropPendingEdits],
  )

  React.useEffect(() => {
    blocksRef.current = stream.blocks
  })

  // react to stream end
  const lastStatus = React.useRef(stream.status)
  React.useEffect(() => {
    if (lastStatus.current === stream.status) return
    lastStatus.current = stream.status
    if (current === null || stream.status === "streaming" || stream.status === "idle") return
    // C-04 "validated가 먼저 도착하면 완료": a stop that lands after the whole draft was confirmed is not a stop
    const confirmedBeforeStop = stream.status === "canceled" && current === "draft" && stream.validatedSections.includes("")
    const ok = stream.status === "done" || confirmedBeforeStop
    const target = current
    const generationId = generationRef.current
    generationRef.current = null
    // v5.3 C-04 / A4: only blocks confirmed by `validated` count — provisional blocks are not stored
    // (career description failure: none; 자소서: the failed 문항 keeps nothing)
    const completed = blocksRef.current.filter((b) => b.state === "validated").map((b) => b.block_id)
    // A21: 생성 직후 안내 stays in memory for this visit only
    const notes = stream.notes
    void (async () => {
      // UQ-528: a new generation replaces that target's notes (no notes → the old box entry goes away)
      if (ok)
        setGenNotes((m) => {
          const key = target === "draft" ? "" : target
          const next = { ...m }
          delete next[key]
          const fresh = notes[key] ?? notes[""]
          if (fresh) next[key] = fresh
          return next
        })
      if (!isPreview && generationId) {
        const result = {
          ok,
          completed_block_ids: completed,
          // v5.3 (A0): 중단 is not a failure; the failure cause / wait is stored for reloads
          canceled: stream.status === "canceled" && !ok,
          error_code: stream.errorInfo?.code ?? null,
          retry_after: stream.errorInfo?.retryAfter ?? null,
          quota_resets_at: stream.errorInfo?.quotaResetsAt ?? null,
        }
        if (target === "draft") {
          const stopped = await finalizeCareerDescriptionAction(draft.id, generationId, result)
          // Q53-7: 블록 없이 이전 상태로. 이 초안 행은 없어졌거나(다시 생성) 생성 전으로 돌아갔다(첫 생성)
          if (stopped) {
            setCurrent(null)
            toast("생성을 중단했어요") // [UI-가정]
            if (stopped.stopped === "regeneration") router.replace(routes.draft(apId, stopped.back_to_draft_id))
            else router.replace(`${routes.applicationDrafts(apId)}#new-draft`)
            return
          }
        } else await finalizeCoverLetterSectionAction(target, generationId, result)
      }
      if (stream.status === "canceled" && !ok) setCanceled(true)
      else if (!ok) {
        if (stream.errorInfo) {
          const { code: _code, ...info } = stream.errorInfo
          void _code
          setFailInfo((m) => ({ ...m, [target]: info }))
        }
        if (target === "draft") setCdFailed(stream.error ?? "provider_unavailable")
        else setFailedIds((f) => ({ ...f, [target]: stream.error ?? "provider_unavailable" }))
        setQueue([])
      }
      setCurrent(null)
      if (!isPreview) router.refresh()
    })()
  }, [stream.status, stream.error, stream.errorInfo, stream.notes, stream.validatedSections, current, draft.id, apId, isPreview, router])

  // drain queue (전체 생성: 문항 순서대로)
  React.useEffect(() => {
    if (current !== null || queue.length === 0) return
    const [next, ...rest] = queue
    queueMicrotask(() => {
      setQueue(rest)
      void generateSection(next)
    })
  }, [current, queue, generateSection])

  // auto start from S-17 / S-18 (?generate=…) or preview
  // A3 UQ-231: the trigger is kept while AI-01 is running (ST-WAIT-JD) and starts once the JD is ready
  const pendingTrigger = React.useRef<string | null | undefined>(undefined)
  const [waitingTrigger, setWaitingTrigger] = React.useState(false)
  React.useEffect(() => {
    if (started.current) return
    if (pendingTrigger.current === undefined) {
      pendingTrigger.current = props.autoGenerate ?? (preview.stream || preview.failed ? (isCover ? draft.sections[0]?.id : "1") : null)
      if (props.autoGenerate) router.replace(pathname)
    }
    const trigger = pendingTrigger.current
    if (!trigger) return
    if (locked || !readiness.features.draft.ready) {
      started.current = true
      return
    }
    if (waitJd) {
      queueMicrotask(() => setWaitingTrigger(true))
      return
    }
    started.current = true
    queueMicrotask(() => {
      setWaitingTrigger(false)
      // A13: requirements first when the JD has none (S-17/S-18 normally did it already)
      runNotified(() => {
        if (!isCover) return generateCareerDescription()
        if (trigger === "all") return setQueue(draft.sections.filter((s) => !s.ai_content?.blocks.length).map((s) => s.id))
        if (draft.sections.some((s) => s.id === trigger)) return generateSection(trigger)
        if (draft.sections[0]) return generateSection(draft.sections[0].id)
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitJd])

  const regenerateCareer = async (projectIds: string[], tone: DraftTone = draft.options.tone ?? "concise") => {
    if (previewWrite.stop()) return
    const picked = [...tree.affiliations.flatMap((a) => a.projects), ...tree.standalone].filter((p) => projectIds.includes(p.id))
    const { id } = await createCareerDescriptionAction(
      apId,
      {
        included_project_ids: projectIds,
        project_order: projectIds,
        included_experience_ids: [...new Set(picked.map((p) => p.experience_id).filter((x): x is string => !!x))],
        included_education_ids: [...new Set(picked.map((p) => p.education_id).filter((x): x is string => !!x))],
        selection_origin: "user",
        tone,
      },
      draft.id,
    )
    router.push(`${routes.draft(apId, id)}?generate=1`)
  }

  /** v5.3 A4: 경력기술서 실패 "다시 시도" = 같은 설정·문체·포함 항목으로 **새 초안 행**, 처음부터, 활성 공급자 */
  const [retryingNew, setRetryingNew] = React.useState(false)
  const retryAsNewDraft = async () => {
    if (previewWrite.stop()) return
    setRetryingNew(true)
    try {
      const { id } = await createCareerDescriptionAction(apId, { ...draft.options, tone: draft.options.tone ?? "concise" }, draft.id)
      router.push(`${routes.draft(apId, id)}?generate=1`)
    } catch {
      setRetryingNew(false)
      toast.error(actionFailedMessage("다시 시도"))
    }
  }

  // ---------------------------------------------------------------- copy
  // UQ-701: a failed career description has nothing to copy (its leftover section rows carry only headings)
  const fullText = !isCover && cdFailed ? "" : documentText(draft, sections)
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      if (!previewWrite.active) await markDraftCopiedAction(draft.id)
      toast.success("복사했어요") // [UI-가정]
    } catch {
      toast.error("복사하지 못했어요")
    }
  }

  // A3 UQ-78: list = tokens actually left in the current text; hint from the block's placeholders
  const placeholderList = sections.flatMap((s) =>
    blocksOf(s).flatMap((b) =>
      (b.text.match(TOKEN_RE) ?? []).map((token, i) => ({
        key: `${s.id}-${b.block_id}-${i}`,
        sectionId: s.id,
        token,
        hint: b.placeholders.filter((p) => p.token === token)[i]?.hint ?? b.placeholders.find((p) => p.token === token)?.hint ?? "",
      })),
    ),
  )

  // FL-08: 키가 없으면 C-18(각 실행 버튼 자리)이 먼저 — 게이트는 키가 있을 때만
  const gate = !readiness.features.draft.ready && !locked ? (
    <DataInsufficientGate
      feature="draft"
      featureLabel={DRAFT_TYPE_LABELS[draft.draft_type]}
      returnFeature={feature}
      readiness={readiness}
      applicationProjectId={apId}
      applicationName={applicationName}
      returnHref={routes.draft(apId, draft.id)}
      activeChatId={props.activeChatId}
      chatFailure={props.gateChatFailure}
    />
  ) : null

  // v5.3 S-17·S-19 결과 배지 = drafts.provider·model·model_tier (자소서는 data layer가 문항 생성 완료 때만 복사, UQ-522)
  const resultMeta = (isCover ? sections.some((x) => x.status === "ready") : sections.some((x) => blocksOf(x).length > 0)) ? draft : null

  /**
   * v5.3 A4 경력기술서 실패 (design-system 6장 A3): no blocks, C-20 block, first line + "다시 시도" = 새 초안 행
   * (항상 처음부터라 "처음부터 다시" 줄 없음, 보존 줄 없음). Input-caused failures have no retry (R-69).
   */
  const keyInvalid = connection?.key_status === "invalid"
  const cdFailure = cdFailed ? (
    <div className="space-y-2">
      <AiErrorNotice
        code={cdFailed}
        {...failInfo.draft}
        lead="생성에 실패했어요. 다시 시도하면 새 초안으로 처음부터 만들어요"
        hidePreserved
        requestPath
        rerunLabel="초안 생성"
        // UQ-521: no usable key → no retry (a new draft row must not be made); C-18 / 키 교체 below
        onRetry={guard.ready && !isPreview && !locked && !keyInvalid ? () => runNotified(retryAsNewDraft) : undefined}
        retryHref={isPreview ? routes.applicationDrafts(apId) : undefined}
        retrying={retryingNew || req.busy}
        inputHref={routes.applicationDrafts(apId)}
        inputLabel="포함 항목으로 돌아가기"
        reduceTarget="포함할 프로젝트"
      />
      {locked ? <AiLock entry="draft" size="inline" /> : keyInvalid && cdFailed !== "key_invalid" ? <AiErrorNotice code="key_invalid" size="inline" /> : null}
    </div>
  ) : null

  const activeSection = sections.find((s) => s.id === activeId) ?? sections[0] ?? null
  const panel = (
    <div className="space-y-6">
      {isCover ? (
        activeSection ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">문항 {sections.indexOf(activeSection) + 1}</p>
            <SectionSources
              key={activeSection.id + activeSection.updated_at}
              section={activeSection}
              sources={activeSection.sources}
              tree={tree}
              requirementLabel={requirementLabel}
              guard={guard}
              onRegenerate={() => runNotified(() => generateSection(activeSection.id))}
              idPrefix={`p-${activeSection.id}`}
            />
          </div>
        ) : null
      ) : (
        cdFailed ? (
          // design-system 6장 A3 "S-19 경력기술서 실패": 오른쪽 패널(C-11)은 비운다
          null
        ) : (
          <CareerDescriptionSources key={draft.id} options={draft.options} tree={tree} guard={guard} onRegenerate={(ids, tone) => runNotified(() => regenerateCareer(ids, tone))} />
        )
      )}
      <div className="space-y-2 border-t pt-4">
        <h3 className="text-base leading-6 font-semibold">
          자리 표시 <span className="text-sm font-normal text-muted-foreground tabular-nums">{placeholderList.length}개</span>
        </h3>
        {placeholderList.length === 0 ? (
          <p className="text-sm text-muted-foreground">채워야 할 자리 표시가 없어요</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {placeholderList.map((p) => (
              <li key={p.key}>
                <PlaceholderText text={p.token} />
                {p.hint ? <span className="ml-1 text-muted-foreground">{p.hint}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )

  return (
    <EvidenceProvider returnTarget={returnTarget}>
      <div className="space-y-6">
        {/* header actions */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="mr-auto flex flex-wrap items-center gap-3">
            <SaveStatus state={autosave.state} savedAt={autosave.savedAt} onRetry={() => void autosave.retry()} />
            {/* C-19 결과 배지 (drafts.provider · model_tier, 모델 ID는 툴팁) */}
            {/* v5.3: 자소서는 마지막으로 생성 완료된 문항의 공급자·모델 (S-17·S-19) */}
            {resultMeta ? <ProviderResultTag provider={resultMeta.provider} model_tier={resultMeta.model_tier} model={resultMeta.model} /> : null}
          </div>
          <Button variant="outline" size="sm" className="xl:hidden" onClick={() => setSheetOpen(true)}>
            <PanelRight aria-hidden />
            근거·출처
          </Button>
          <CopyWithPlaceholderGuard text={fullText} onCopy={() => void copy(fullText)}>
            {(onClick) => (
              <Button variant="outline" size="sm" onClick={onClick} disabled={current !== null || preview.finalizing || preview.stopping || fullText.trim() === ""}>
                <Copy aria-hidden />
                전체 복사
              </Button>
            )}
          </CopyWithPlaceholderGuard>
        </div>
        {gate}
        {req.slot ?? (waitJd ? <WaitJd /> : null)}
        {/* waiting for AI-01 before an auto-start (S-17/S-18 → ?generate=) */}
        <AutoRefresh active={waitingTrigger && waitJd} />

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="mx-auto w-full max-w-[42rem] space-y-6">
            <GenerationNotes notes={genNotes} sections={sections} isCover={isCover} projectLabels={tree.project_labels} />
            {preview.finalizing || preview.stopping ? (
              // UQ-524 `?state=finalizing`: "마무리 중" 정지 화면 — 임시 블록, 편집·복사 막힘 (C-04). `?state=stopping`: 중단 대기 (W3-4)
              <StreamRegion status="streaming" className="space-y-3">
                <StreamingHeader onStop={() => undefined} phase="finalizing" stopping={preview.stopping} />
                {(sections[0] ? blocksOf(sections[0]) : []).map((b) => (
                  <StreamingBlock key={b.block_id} block={{ text: b.text, state: "completed" }} />
                ))}
              </StreamRegion>
            ) : isCover ? (
              sections.map((s, i) => (
                <QuestionSection
                  key={s.id}
                  index={i + 1}
                  section={s}
                  evidence={evidence[s.id] ?? {}}
                  active={activeSection?.id === s.id}
                  onFocus={() => setActiveId(s.id)}
                  streaming={current === s.id || (isPreview && lastTarget === s.id && failedIds[s.id]) ? stream : null}
                  queued={queue.includes(s.id)}
                  failed={failedIds[s.id] ?? null}
                  failedInfo={failInfo[s.id]}
                  busy={current !== null}
                  canGenerate={guard.ready && !waitJd && !req.busy}
                  onGenerate={() => req.run(() => generateSection(s.id))}
                  onEdit={(blockId, text) => editBlock(s.id, blockId, text)}
                  onCopy={(text) => void copy(text)}
                  returnTarget={returnTarget}
                  questionsHref={routes.draftQuestions(apId, draft.id)}
                  sourcesPanel={
                    <SectionSources
                      key={s.id + s.updated_at}
                      section={s}
                      sources={s.sources}
                      tree={tree}
                      requirementLabel={requirementLabel}
                      guard={guard}
                      onRegenerate={() => runNotified(() => generateSection(s.id))}
                      idPrefix={`c-${s.id}`}
                    />
                  }
                />
              ))
            ) : current === "draft" || (isPreview && lastTarget === "draft" && (cdFailed || canceled) && stream.blocks.length > 0) ? (
              <StreamRegion status={stream.status} className="space-y-3">
                {current === "draft" ? <StreamingHeader onStop={stream.cancel} phase={stream.phase} adjusting={stream.adjusting} stopping={stream.status === "canceled"} /> : null}
                {cdFailed && current === null ? cdFailure : null}
                {stream.blocks.map((b) => (
                  <StreamingBlock key={b.block_id} block={b}>
                    <BlockFlagBadges flags={b.flags} />
                  </StreamingBlock>
                ))}
                {stream.blocks.length === 0 && current === "draft" ? <PendingBlock /> : null}
              </StreamRegion>
            ) : (
              <>
                {cdFailed ? cdFailure : null}
                {canceled ? (
                  // [UI-가정] 중단 안내 문구 (canceled는 실패로 표시하지 않음)
                  // v5.3 C-04: 확정(validated) 전 임시 블록은 저장되지 않는다 — // [UI-가정] 문구
                  <p className="text-sm text-muted-foreground">생성을 중단했어요. 확정되기 전 내용은 남지 않아요</p>
                ) : null}
                {sections.length === 0 && !cdFailed && draft.status !== "failed" ? (
                  <Card className="gap-3 p-5">
                    <p className="text-muted-foreground">아직 생성된 내용이 없어요</p>
                    <AiRunButton lock={{ entry: "draft" }} onRun={() => req.run(generateCareerDescription)} disabled={!guard.ready || waitJd || req.busy}>
                      <Sparkles aria-hidden />
                      초안 생성
                    </AiRunButton>
                  </Card>
                ) : null}
                {(cdFailed ? [] : sections).map((s) => (
                  <CareerSection
                    key={s.id}
                    section={s}
                    evidence={evidence[s.id] ?? {}}
                    onEdit={(blockId, text) => editBlock(s.id, blockId, text)}
                    returnTarget={returnTarget}
                  />
                ))}
              </>
            )}
          </div>
          <aside className="hidden xl:block">
            <Card className="sticky top-20 max-h-[calc(100dvh-6rem)] gap-0 overflow-y-auto p-4">{panel}</Card>
          </aside>
        </div>
      </div>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader className="border-b p-4">
            <SheetTitle className="text-lg font-semibold">근거·출처</SheetTitle>
            <SheetDescription className="sr-only">사용한 경력·프로젝트와 자리 표시 목록</SheetDescription>
          </SheetHeader>
          <div className="p-4">{panel}</div>
        </SheetContent>
      </Sheet>
    </EvidenceProvider>
  )
}

// ---------------------------------------------------------------------------
// blocks
// ---------------------------------------------------------------------------

function EditableBlock({
  block,
  evidence,
  onEdit,
  returnTarget,
  bullet = false,
}: {
  block: DraftBlock
  evidence: EvidenceView[] | undefined
  onEdit: (text: string) => void
  returnTarget: ReturnTargetInput
  bullet?: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const ref = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])
  const careerTarget = block.placeholders.length || countPlaceholders(block.text) ? evidence?.find((e) => e.href && e.to_career)?.href ?? null : null
  const addToCareer = careerTarget
    ? () => {
        markCareerReturn(returnTarget)
        router.push(careerTarget)
      }
    : undefined
  return (
    <div className="group rounded-md px-2 py-1 -mx-2 transition-colors hover:bg-accent/50">
      {editing ? (
        <Textarea
          ref={ref}
          value={block.text}
          onChange={(e) => onEdit(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          className="min-h-20 text-base leading-[1.75]"
          aria-label="초안 문단 편집"
        />
      ) : (
        <div className="flex items-start gap-2">
          {/* A3 UQ-79: clicking the text edits too (the pencil button is the keyboard path) */}
          <p className={cn("flex-1 cursor-text text-base leading-[1.75] whitespace-pre-wrap", bullet && "pl-4 -indent-4")} onClick={() => setEditing(true)}>
            {bullet ? "• " : null}
            <PlaceholderText text={block.text} placeholders={block.placeholders} />
          </p>
          <Button
            variant="ghost"
            size="icon-sm"
            className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label="이 문단 편집"
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden />
          </Button>
        </div>
      )}
      <EvidenceChips
        items={evidence}
        leading={
          block.flags.length || block.user_modified || addToCareer ? (
            <BlockFlagBadges flags={block.flags} userModified={block.user_modified} onAddToCareer={addToCareer} />
          ) : undefined
        }
      />
    </div>
  )
}

function CareerSection({
  section,
  evidence,
  onEdit,
  returnTarget,
}: {
  section: Section
  evidence: Record<string, EvidenceView[]>
  onEdit: (blockId: string, text: string) => void
  returnTarget: ReturnTargetInput
}) {
  return (
    <section className="space-y-2">
      {section.heading ? <h2 className="text-base leading-6 font-semibold">{section.heading}</h2> : null}
      <div className="space-y-1">
        {blocksOf(section).map((b) => (
          <div key={b.block_id} className={b.block_kind === "role_line" ? "pt-2 font-medium" : undefined}>
            <EditableBlock block={b} evidence={evidence[b.block_id]} onEdit={(t) => onEdit(b.block_id, t)} returnTarget={returnTarget} bullet={b.block_kind === "bullet"} />
          </div>
        ))}
      </div>
    </section>
  )
}

function QuestionSection({
  index,
  section,
  evidence,
  active,
  onFocus,
  streaming,
  queued,
  failed,
  failedInfo,
  busy,
  canGenerate,
  onGenerate,
  onEdit,
  onCopy,
  returnTarget,
  sourcesPanel,
  questionsHref,
}: {
  index: number
  section: Section
  evidence: Record<string, EvidenceView[]>
  active: boolean
  onFocus: () => void
  streaming: ReturnType<typeof useAiStream> | null
  queued: boolean
  failed: AiErrorCode | null
  failedInfo?: Omit<AiErrorInfo, "code">
  busy: boolean
  canGenerate: boolean
  /** result returned so AiRunButton can handle a start refusal (C-18 / C-21) */
  onGenerate: () => Promise<unknown>
  onEdit: (blockId: string, text: string) => void
  onCopy: (text: string) => void
  returnTarget: ReturnTargetInput
  sourcesPanel: React.ReactNode
  /** S-18 (input_rejected / key_missing "입력으로") */
  questionsHref: string
}) {
  const [confirm, setConfirm] = React.useState(false)
  const generateNotified = () => {
    void onGenerate().then((r) => {
      if (isAiRejected(r)) notifyAiRejected(r)
    })
  }
  const basis = section.count_basis ?? "with_spaces"
  const text = sectionText(section)
  const count = countChars(text, basis)
  const limit = section.char_limit
  // v5.3 A12: over the limit but within 110% → AI left it as is; edited past 110% → short line only
  const over = limit && count > limit ? count - limit : 0
  const overWithinRange = over > 0 && !!limit && count <= limit * 1.1
  // A21: the char warning is kept in validation_report (shown again on re-open) — // [UI-가정] key name
  const storedCharWarning = section.validation_report?.char_adjust_needed === true
  const hasContent = blocksOf(section).length > 0
  /** stored partial result of an interrupted first generation (A3 UQ-62) */
  const partial = section.status === "failed" && hasContent
  return (
    <Card
      className={cn("gap-4 p-5", active && "xl:ring-2 xl:ring-ring/40")}
      onFocusCapture={onFocus}
      onClick={onFocus}
      aria-labelledby={`q-${section.id}`}
      role="region"
    >
      <header className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground tabular-nums">문항 {index}</p>
        <h2 id={`q-${section.id}`} className="text-lg leading-7 font-semibold">
          {section.question_text || "문항을 입력해 주세요"}
        </h2>
        {limit ? (
          <div className="space-y-0.5">
            {/* v5.3 S-19 글자 수 표시 (편집본 기준 실시간) */}
            <p className={cn("flex items-center gap-1 text-xs tabular-nums", over > 0 || storedCharWarning ? "text-warning-subtle-foreground" : "text-muted-foreground")}>
              {over > 0 || storedCharWarning ? <TriangleAlert className="size-3.5 text-warning" aria-hidden /> : null}
              현재 {count.toLocaleString("ko-KR")}자 / 제한 {limit.toLocaleString("ko-KR")}자({COUNT_BASIS_LABELS[basis]})
            </p>
            {over > 0 ? (
              <p className="text-sm text-warning-subtle-foreground">
                {overWithinRange
                  ? `제한보다 ${over.toLocaleString("ko-KR")}자 많아요. AI 보정 범위(최대 10% 초과) 안이라 그대로 두었어요. 제출처 제한을 확인해 주세요`
                  : // [UI-가정] G-40 편집으로 110%를 넘었을 때
                    `제한보다 ${over.toLocaleString("ko-KR")}자 많아요`}
              </p>
            ) : storedCharWarning ? (
              <p className="text-sm text-warning-subtle-foreground">글자 수를 맞추지 못했어요</p>
            ) : null}
          </div>
        ) : null}
      </header>

      {streaming ? (
        <StreamRegion status={streaming.status} className="space-y-3">
          {/* W3-4: after 중단, `busy` lasts until the run has closed (finalize waits for it) */}
          {streaming.status === "streaming" || (streaming.status === "canceled" && busy) ? (
            <StreamingHeader
              onStop={streaming.cancel}
              phase={streaming.phase}
              stopping={streaming.status === "canceled"}
              adjusting={streaming.adjusting && (!streaming.adjusting.section_id || streaming.adjusting.section_id === section.id) ? streaming.adjusting : null}
            />
          ) : null}
          {streaming.sources === null ? (
            <AiProgressInline progress={{ stage: "rank" }} />
          ) : (
            <ul className="space-y-1 rounded-md bg-muted p-3 text-sm">
              {streaming.sources.map((s, i) => (
                <li key={i} className="space-y-1">
                  <p>
                    <span className="font-medium">{s.label}</span>
                    <span className="text-muted-foreground"> — {s.rationale}</span>
                  </p>
                  {/* A3 UQ-85: same role / origin badges as the finished C-11 rows */}
                  {s.role || s.origin ? (
                    <span className="flex flex-wrap gap-1">
                      {s.role ? <Badge variant={s.role === "primary" ? "secondary" : "outline"}>{SOURCE_ROLE_LABELS[s.role]}</Badge> : null}
                      {s.origin === "ai" ? (
                        <Badge variant="ai">
                          <Sparkles aria-hidden />
                          {SOURCE_ORIGIN_LABELS.ai}
                        </Badge>
                      ) : s.origin === "user" ? (
                        <Badge variant="outline">{SOURCE_ORIGIN_LABELS.user}</Badge>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {streaming.blocks.map((b) => (
            <StreamingBlock key={b.block_id} block={b}>
              <BlockFlagBadges flags={b.flags} />
            </StreamingBlock>
          ))}
          {streaming.sources !== null && streaming.blocks.length === 0 ? <PendingBlock /> : null}
        </StreamRegion>
      ) : hasContent ? (
        <div className="space-y-1">
          {blocksOf(section).map((b) => (
            <EditableBlock key={b.block_id} block={b} evidence={evidence[b.block_id]} onEdit={(t) => onEdit(b.block_id, t)} returnTarget={returnTarget} />
          ))}
        </div>
      ) : queued ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">앞 문항이 끝나면 작성해요</p>
          <PendingBlock />
        </div>
      ) : null}

      {failed ? (
        // v5.3: 실패한 문항만 C-20 inline (요청 안 경로 대기 A14), 다시 시도 = 활성 공급자, 입력 원인은 다시 시도 없음
        <AiErrorNotice
          code={failed}
          {...failedInfo}
          size="inline"
          requestPath
          rerunLabel="이 문항만 생성"
          onRetry={canGenerate && !busy ? generateNotified : undefined}
          inputHref={questionsHref}
          inputLabel="문항 설정으로"
          reduceTarget="문항 메모"
        />
      ) : section.status === "failed" && !hasContent && !streaming ? (
        // [UI-가정] 이전 방문에서 실패한 문항 (원인은 저장돼 있지 않음) — 아래 "이 문항만 생성"으로 다시
        <AiFailedInline message="이 문항을 만들지 못했어요" />
      ) : partial && !streaming ? (
        // [UI-가정] 중단·실패로 일부 문단만 받은 문항
        <div className="space-y-2">
          <AiFailedInline message="이 문항을 끝까지 만들지 못했어요" />
          {/* A3 UQ-235 */}
          <AiRunButton lock={{ entry: "draft", feature: "cover_letter", actionName: "이 문항 다시 생성" }} variant="outline" size="sm" rerun onRun={onGenerate} disabled={!canGenerate || busy}>
            다시 생성
          </AiRunButton>
        </div>
      ) : null}

      {!streaming && !queued ? (
        <div className="flex flex-wrap items-center gap-2">
          {hasContent ? (
            <>
              <CopyWithPlaceholderGuard text={text} onCopy={() => onCopy(text)}>
                {(onClick) => (
                  <Button variant="outline" size="sm" onClick={onClick}>
                    <Copy aria-hidden />
                    문항 복사
                  </Button>
                )}
              </CopyWithPlaceholderGuard>
              {!section.sources_modified_at ? (
                <AiRunButton lock={{ entry: "draft", feature: "cover_letter" }} variant="ghost" size="sm" rerun onRun={() => setConfirm(true)} disabled={busy || !canGenerate}>
                  다시 생성
                </AiRunButton>
              ) : null}
            </>
          ) : !failed ? (
            <AiRunButton lock={{ entry: "draft", feature: "cover_letter" }} onRun={onGenerate} disabled={busy || !canGenerate || !section.question_text?.trim()}>
              <Sparkles aria-hidden />
              이 문항만 생성
            </AiRunButton>
          ) : null}
        </div>
      ) : null}

      {/* <1280: C-11 under the card */}
      <Collapsible className="xl:hidden">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="-ml-2">
            <ChevronDown aria-hidden />
            사용한 경력·프로젝트 {section.sources.length ? `${section.sources.length}개` : ""}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">{sourcesPanel}</CollapsibleContent>
      </Collapsible>
      <OverwriteConfirm open={confirm} onOpenChange={setConfirm} onConfirm={generateNotified} variant="cover_letter" />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// v5.3 A21 생성 직후 안내 (design-system 6장 A3 "S-19 생성 직후 안내 상자", GenerationNotes)
// ---------------------------------------------------------------------------

/** One "포함하지 않은 항목" line: a real run's project id → "회사 › 프로젝트" (C-11 tree) + reason; the mock's ready line split on " — " */
function omittedLine(o: NonNullable<GenerationNotesPayload["omitted"]>[number], projectLabels: Record<string, string>): { item: string; why: string | null } {
  if (typeof o !== "string") return { item: projectLabels[o.project_id] ?? OMITTED_PROJECT_FALLBACK, why: OMITTED_REASON_LABELS[o.reason] ?? OMITTED_REASON_FALLBACK }
  const [item, ...why] = o.split(" — ")
  return { item, why: why.length ? why.join(" — ") : null }
}

function GenerationNotes({
  notes,
  sections,
  isCover,
  projectLabels,
}: {
  notes: NotesMap
  sections: Section[]
  isCover: boolean
  /** C-11 source tree `project_labels` (id → "회사명 또는 기관명 › 프로젝트명") */
  projectLabels: Record<string, string>
}) {
  const groups = Object.entries(notes)
    .map(([key, n]) => {
      const index = isCover ? sections.findIndex((s) => s.id === key) : -1
      return { key, index, n }
    })
    .filter((g) => g.n.omitted?.length || g.n.notes_for_user?.length || g.n.char_adjust_needed)
    .sort((a, b) => a.index - b.index)
  if (groups.length === 0) return null
  const count = groups.reduce((m, g) => m + (g.n.omitted?.length ?? 0) + (g.n.notes_for_user?.length ?? 0) + (g.n.char_adjust_needed ? 1 : 0), 0)
  return (
    <Collapsible defaultOpen className="rounded-lg border border-info/30 bg-info-subtle">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Info className="size-4 text-info" aria-hidden />
        {/* [UI-가정] 제목 (G-40) */}
        <span className="text-sm font-semibold text-info-subtle-foreground">생성 직후 안내</span>
        <Badge variant="count">{count}</Badge>
        <ChevronDown className="ml-auto size-4 text-info-subtle-foreground transition-transform group-data-[state=closed]:-rotate-90" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 px-4 pb-4 text-sm text-info-subtle-foreground">
        {groups.map(({ key, index, n }) => (
          <div key={key} className="space-y-3">
            {isCover && index >= 0 ? <p className="text-xs tabular-nums">문항 {index + 1}</p> : null}
            {n.omitted?.length ? (
              <div>
                <p className="font-medium">포함하지 않은 항목</p>
                <ul className="list-disc space-y-1.5 pl-5">
                  {n.omitted.map((o, i) => {
                    const { item, why } = omittedLine(o, projectLabels)
                    return (
                      <li key={i}>
                        <span className="font-medium break-words">{item}</span>
                        {why ? ` — ${why}` : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
            {n.notes_for_user?.length ? (
              <div>
                <p className="font-medium">확인해 주세요</p>
                <ul className="list-disc space-y-1.5 pl-5">
                  {n.notes_for_user.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {n.char_adjust_needed ? (
              <div>
                <p className="font-medium">글자 수를 맞추지 못했어요</p>
                {/* [UI-가정] 본문 한 줄 (명세는 묶음 제목만) */}
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>제출 전에 글자 수를 확인해 주세요</li>
                </ul>
              </div>
            ) : null}
          </div>
        ))}
        <p className="flex items-center gap-1.5 border-t border-info/20 pt-3 text-xs">
          <Clock className="size-3.5" aria-hidden />
          이 안내는 지금만 보여요. 필요하면 메모해 두세요
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}
