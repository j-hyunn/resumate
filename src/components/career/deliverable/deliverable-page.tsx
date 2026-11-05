"use client"

/**
 * S-44 산출물 상세 (UX v5.6 S-44 · FL-22 · L-02 1.3a; AI-13; DM v4.5 2.5.1). L-02 전체 페이지: 상단 바 "저장하기",
 * 이동 줄 "← {프로젝트명} › {산출물 제목} › 산출물 상세", 머리(제목 입력 + ⋯ 삭제) + G-2 안내, 왼쪽 마크다운 본문,
 * 오른쪽 Resumate AI 패널(AI-13 본문 초안 제안 카드). 새 산출물(`project_deliverable_id = null`)은 첫 저장 또는 첫 AI
 * 메시지 때 `save_project_deliverable`로 행을 만들고 URL을 바꾼다(replace, `?state=` 유지). 행이 생기기 전에는 이동 줄
 * 현재 위치가 "새 산출물 추가"다(33 런). 머리 맨 위 새 행 안내 배너는 두지 않는다(사용자 결정 2026-11-05).
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { MoreHorizontal, Sparkles, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { DocTextarea, DocTitleInput, flashElement, highlightRange } from "@/components/common/doc-inputs"
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
import { ReturnBanner } from "@/components/common/return-banner"
import { DeleteConfirmDialog, type DeleteTarget } from "@/components/common/delete-confirm-dialog"
import { AiPanel, useAiPanel } from "@/components/career/ai-panel"
import { CRUMB_CURRENT, firstSaveToast } from "@/components/career/new-row-notice"
import { useNewRowRemount } from "@/components/career/new-row-remount"
import { saveProjectDeliverableAction } from "@/lib/data/career-v45-actions"
import {
  PAGE_LIMITS,
  PAGE_SAVE_ERROR_COPY,
  PAGE_SAVE_SKIP_COPY,
  PANEL_COPY,
  fieldTooLongCopy,
  isBlank,
  type AppliedDeliverableProposal,
  type DeliverablePageData,
} from "@/lib/data/career-v45-shared"
import type { DeliverableStructuredDraft } from "@/types/db"
import { routes } from "@/lib/routes"
import Link from "next/link"
import { deleteDeliverableAction } from "../actions"
import { DRAFT_CARD_ID, DeliverableDraftCard, type DeliverableFill } from "../deliverable-draft-card"

type Form = { title: string; body: string }
/** the copy carries the row version the edits started from (U40-2) */
type Preserved = { form: Form; applied: AppliedDeliverableProposal[] } & VersionedCopy

/** S-44 G-2 안내 1줄 (CR-8, spec verbatim) */
const NOTICE = "산출물은 인사이트·서류·면접에서 AI가 근거로 써요. 민감정보·회사 기밀·다른 사람의 개인정보는 쓰지 마세요"
// [UI-가정] spec marks the placeholder [가정]
const BODY_PLACEHOLDER = "프로젝트에서 만든 결과물(기획서 요약, 설계 문서, 회고, 발표 내용 등)을 정리해 주세요"

/** URL after the row exists / the open chat changes — replace (no history entry), `?state=` kept (previews stay on mock) */
function replaceUrl(deliverableId: string | null, projectId: string, chatId: string | null) {
  const current = new URLSearchParams(window.location.search)
  const path = deliverableId ? routes.deliverable(deliverableId, { chat: chatId ?? undefined }) : routes.deliverableNew(projectId)
  const url = new URL(path, window.location.origin)
  const state = current.get("state")
  if (state) url.searchParams.set("state", state)
  window.history.replaceState(window.history.state, "", url.pathname + url.search)
}

/**
 * 새 행 페이지가 Next 16의 숨은 트리(`<Activity>`)로 되살아나는 것을 막는 겉면 — 자세한 이유는
 * `../new-row-remount.tsx`. "+ 산출물 추가"로 다시 들어오면 방금 만든 산출물이 아니라 빈 새 산출물이 열린다.
 */
export function DeliverablePage(props: { data: DeliverablePageData; range?: { start: number; end: number } | null }) {
  const { key, markRow } = useNewRowRemount()
  return <DeliverablePageBody key={key} {...props} markRow={markRow} />
}

function DeliverablePageBody({
  data,
  range = null,
  markRow,
}: {
  data: DeliverablePageData
  range?: { start: number; end: number } | null
  markRow: (rowId: string) => void
}) {
  const router = useRouter()
  const projectId = data.project.id
  const [id, setId] = React.useState<string | null>(data.project_deliverable_id)
  const [clientId] = React.useState(() => crypto.randomUUID())
  const [baseline, setBaseline] = React.useState<Form>({ title: data.title, body: data.body })
  const [form, setForm] = React.useState<Form>(() => ({
    title: data.title,
    body: data.preview?.dirty ? `${data.body}\n\n저장하지 않은 수정 (미리보기)`.trim() : data.body,
  }))
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(data.updated_at)
  const [applied, setApplied] = React.useState<AppliedDeliverableProposal[]>([])
  const [saveState, setSaveState] = React.useState<SaveUiState>("idle")
  const [savedAt, setSavedAt] = React.useState<string | null>(null)
  const [titleError, setTitleError] = React.useState<string | null>(null)
  const [bodyError, setBodyError] = React.useState<string | null>(null)
  const [pageError, setPageError] = React.useState<{ text: string; projectLink?: boolean } | null>(null)
  const [titleAttention, setTitleAttention] = React.useState(false)
  const [stale, setStale] = React.useState(false)
  // the last save's skipped[] (all entries): the open chat's go under its card, the rest (other / deleted chats) under the head (UQ-INT-2)
  const [skips, setSkips] = React.useState<Array<{ chatId: string; line: string }>>([])
  const [deleting, setDeleting] = React.useState<DeleteTarget | null>(null)
  const [draftFailed, setDraftFailed] = React.useState(false)
  const titleRef = React.useRef<HTMLInputElement | null>(null)
  const bodyRef = React.useRef<HTMLElement | null>(null)
  // initial focus: 새 산출물 → 제목. Not autoFocus: that scrolls the head box and can push the new-row notice
  // out of view on a short window (UQ-333)
  React.useEffect(() => {
    if (!data.project_deliverable_id) titleRef.current?.focus({ preventScroll: true })
  }, [data.project_deliverable_id])
  const previewState = data.preview?.state ?? null

  const dirty = form.title !== baseline.title || form.body !== baseline.body || applied.length > 0
  const uiState: SaveUiState =
    saveState === "saving" || saveState === "failed" || saveState === "invalid" || saveState === "stale" ? saveState : dirty ? "dirty" : savedAt ? "saved" : "idle"

  // ---------- 입력 보존 (L-02) ----------
  const preserved = useInputPreservation<Preserved>(preservationKey("deliverable", id, projectId))
  // the new page's `{project}:new` copy: dropped once the row id is known (UQ-PA-21)
  const newCopy = useInputPreservation<Preserved>(preservationKey("deliverable", null, projectId), { enabled: false })
  const startedNew = React.useRef(data.project_deliverable_id === null)
  const { clear: clearNewCopy } = newCopy
  React.useEffect(() => {
    // runs after the main store's key switch (its dispose may flush a last write to the `:new` key)
    if (startedNew.current && id) clearNewCopy()
  }, [id, clearNewCopy])
  const { write: writePreserved } = preserved
  React.useEffect(() => {
    writePreserved(dirty ? { form, applied, base_updated_at: updatedAt } : null)
  }, [dirty, form, applied, updatedAt, writePreserved])

  const formRef = React.useRef(form)
  React.useEffect(() => {
    formRef.current = form
  }, [form])

  const setTitle = (title: string) => {
    if (saveState !== "saving") setSaveState("idle")
    setTitleError(null)
    setPageError(null)
    setForm((f) => ({ ...f, title }))
  }
  const setBody = (body: string) => {
    if (saveState !== "saving") setSaveState("idle")
    setBodyError(body.length > PAGE_LIMITS.deliverableBody ? fieldTooLongCopy(PAGE_LIMITS.deliverableBody) : null)
    setPageError(null)
    setForm((f) => ({ ...f, body }))
  }

  // ---------- 저장하기 (save_project_deliverable) ----------
  const panelRef = React.useRef<ReturnType<typeof useAiPanel> | null>(null)
  const doSave = React.useCallback(
    async (overwrite = false, opts: { fromPanel?: boolean } = {}): Promise<string | null> => {
      const current = formRef.current
      if (isBlank(current.title)) {
        setTitleError(PAGE_SAVE_ERROR_COPY.deliverable_title_required)
        setSaveState("invalid")
        titleRef.current?.focus()
        return null
      }
      if (current.body.length > PAGE_LIMITS.deliverableBody) {
        setBodyError(fieldTooLongCopy(PAGE_LIMITS.deliverableBody))
        setSaveState("invalid")
        bodyRef.current?.focus()
        return null
      }
      setSaveState("saving")
      setPageError(null)
      const r = await saveProjectDeliverableAction(
        {
          project_deliverable_id: id,
          client_id: id ? null : clientId,
          project_id: projectId,
          title: current.title.trim(),
          body: current.body,
          expected_updated_at: overwrite ? null : updatedAt,
          applied_proposals: applied,
        },
        previewState,
      ).catch(() => null)
      if (!r || !r.ok) {
        const code = r?.error.code ?? "save_failed"
        switch (code) {
          case "stale_write":
            setSaveState("stale")
            setStale(true)
            return null
          case "deliverable_title_required":
            setTitleError(PAGE_SAVE_ERROR_COPY.deliverable_title_required)
            setSaveState("invalid")
            titleRef.current?.focus()
            return null
          case "field_too_long":
            if (r?.error.field === "title") {
              setTitleError(fieldTooLongCopy(PAGE_LIMITS.deliverableTitle))
              titleRef.current?.focus()
            } else {
              setBodyError(fieldTooLongCopy(PAGE_LIMITS.deliverableBody))
              bodyRef.current?.focus()
            }
            setSaveState("invalid")
            return null
          case "deliverable_limit_reached":
            // a refusal like a validation error: no "다시 시도" next to 저장하기 (UQ-S44-8)
            setPageError({ text: PAGE_SAVE_ERROR_COPY.deliverable_limit_reached })
            setSaveState("invalid")
            return null
          case "deliverable_requires_standalone_project":
            // [UI-가정] (UQ-S44-14) stay with the input on screen (copy it out) + a link to S-10, instead of leaving at once
            setPageError({ text: PAGE_SAVE_ERROR_COPY.deliverable_requires_standalone_project, projectLink: true })
            setSaveState("invalid")
            return null
          case "not_found":
            toast(PAGE_SAVE_ERROR_COPY.not_found)
            setSaveState("failed")
            return null
          default:
            setSaveState("failed")
            return null
        }
      }
      const wasNew = !id
      if (wasNew) preserved.clear() // the `:new` copy, before the key switches (UQ-PA-21)
      setId(r.project_deliverable_id)
      setUpdatedAt(r.updated_at)
      setBaseline(current)
      // only what this request sent: a fill made while saving stays for the next save (UQ-S44-12)
      const sent = applied
      setApplied((a) => a.filter((x) => !sent.includes(x)))
      setSavedAt(r.updated_at)
      setSaveState("saved")
      if (!wasNew) preserved.clear()
      if (wasNew) {
        markRow(r.project_deliverable_id)
        replaceUrl(r.project_deliverable_id, projectId, panelRef.current?.chat?.id ?? null)
      }
      // OD-C3: the save that created the row → "산출물을 추가했어요" once; later saves = C-06 "저장됨 HH:MM" only.
      // The panel's first-message save shows its own toast instead (UX S-44 [가정]).
      const added = firstSaveToast("deliverable", { wasNew, fromPanel: Boolean(opts.fromPanel) })
      if (added) toast(added)
      // 반영됨 (applied_at) on the open chat's draft; skipped → one line under the card
      const p = panelRef.current
      const openChat = p?.chat
      if (p && openChat && r.applied.some((a) => a.writing_chat_id === openChat.id)) {
        const d = openChat.structured_draft as DeliverableStructuredDraft
        const entry = applied.find((a) => a.writing_chat_id === openChat.id)
        if ("target" in d && d.deliverable.body && entry) {
          p.setDraft({ ...d, deliverable: { body: { ...d.deliverable.body, applied_at: r.updated_at, applied_mode: entry.mode, applied_rev: entry.rev } } })
        }
      }
      if (r.applied.length) p?.markApplied(r.applied.map((a) => a.writing_chat_id))
      setSkips(r.skipped.map((x) => ({ chatId: x.writing_chat_id, line: PAGE_SAVE_SKIP_COPY[x.reason] })))
      return r.project_deliverable_id
    },
    [id, clientId, projectId, updatedAt, applied, previewState, preserved, markRow],
  )

  // 입력 보존: what a previous visit left unsaved comes back on its own (no restore banner) — the page is dirty,
  // so 저장하기 is enabled and leaving asks first. U40-2: only when the row wasn't saved elsewhere since the copy
  // was written; otherwise the copy is dropped and the saved row shows
  const { stored: preservedStored, resolve: resolvePreserved, clear: clearPreserved } = preserved
  const loadedUpdatedAt = data.updated_at
  React.useEffect(() => {
    if (!preservedStored) return
    if (!isRestorable(preservedStored, loadedUpdatedAt)) {
      clearPreserved()
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- apply the stored copy once, after hydration
    setForm(preservedStored.form)
    setApplied(preservedStored.applied)
    resolvePreserved()
  }, [preservedStored, resolvePreserved, clearPreserved, loadedUpdatedAt])

  const guard = useLeaveGuard({ dirty, onSave: async () => Boolean(await doSave()), onDiscard: preserved.clear })

  // ---------- Resumate AI 패널 (AI-13) ----------
  const formSnapshot = React.useMemo(() => ({ title: form.title, body: form.body }), [form])
  const draftTurn = React.useRef(false)
  const panel = useAiPanel({
    target: "deliverable",
    targetId: id,
    initialChats: data.chats,
    initialChat: data.open_chat,
    formSnapshot,
    preview: data.preview,
    deliverableLimitReached: data.limit_reached,
    requireName: () => {
      if (!isBlank(formRef.current.title)) return true
      setTitleAttention(true)
      titleRef.current?.focus()
      return false
    },
    savePage: () => doSave(false, { fromPanel: true }),
    onChatChange: (chatId) => {
      setDraftFailed(false)
      draftTurn.current = false
      const rowId = idRef.current
      if (rowId) {
        markRow(rowId)
        replaceUrl(rowId, projectId, chatId)
      }
    },
    onTurnEvent: (ev) => {
      if (ev.type === "turn_started") {
        draftTurn.current = false
        setDraftFailed(false)
      } else if (ev.type === "draft_started") draftTurn.current = true
      else if (ev.type === "draft_done" || ev.type === "turn_done") draftTurn.current = false
      else if (ev.type === "error" && draftTurn.current) {
        draftTurn.current = false
        setDraftFailed(true)
      }
    },
  })
  React.useEffect(() => {
    panelRef.current = panel
  })
  const idRef = React.useRef(id)
  React.useEffect(() => {
    idRef.current = id
  }, [id])

  const openDraft = panel.chat?.structured_draft && "target" in panel.chat.structured_draft ? panel.chat.structured_draft : null
  const openBody = openDraft?.deliverable.body
  const filledEntry = panel.chat ? (applied.find((a) => a.writing_chat_id === panel.chat!.id) ?? null) : null
  const hasUnappliedDraft = Boolean(openBody && !openBody.applied_at && !(filledEntry && filledEntry.rev === openBody.rev))

  const onFill = (fill: DeliverableFill) => {
    setForm((f) => ({ ...f, body: fill.body }))
    setBodyError(null)
    if (saveState !== "saving") setSaveState("idle")
    setApplied((a) => [...a.filter((x) => x.writing_chat_id !== fill.chatId), { writing_chat_id: fill.chatId, rev: fill.rev, mode: fill.mode }])
    const el = bodyRef.current
    flashElement(el)
    // the body field has no inner scroll (grow): scroll the page column to its end (덧붙이기) / its start (교체)
    if (el) window.setTimeout(() => el.scrollIntoView({ block: fill.mode === "append" ? "end" : "start", behavior: "smooth" }), 0)
    // OD-P2 (UX v5.13): 본문 교체·덧붙이기·블록 반영 — an information toast only, no undo button
    // (going back = "저장하지 않고 나가기")
    toast("본문에 채웠어요")
  }

  const onBodyQuote = (quote: string) => {
    // [UI-가정] design-system 3.14: select the range; not found → highlight the field + toast
    if (!highlightRange(bodyRef.current, { quote })) toast("지금 본문에서 그 문장을 찾지 못했어요")
  }

  // C-02 근거 구간 강조 (`?range={start}-{end}`): select + scroll once on load; typing drops the selection (UQ-S44-2)
  const rangeDone = React.useRef(false)
  React.useEffect(() => {
    if (!range || rangeDone.current) return
    const el = bodyRef.current
    const t = window.setTimeout(() => {
      rangeDone.current = true
      // highlightRange scrolls to the range itself (the field is taller than the column)
      if (!highlightRange(el, range)) toast("지금 본문에서 그 문장을 찾지 못했어요")
    }, 120)
    return () => window.clearTimeout(t)
  }, [range])

  const showDraft = () => {
    panel.show()
    window.setTimeout(() => document.getElementById(DRAFT_CARD_ID)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 80)
  }

  // 아직 행이 없는 "새 산출물" 상태 — URL이 아니라 `id`를 따르므로 첫 저장 성공 직후 바로 기존 행 표시로 바뀐다
  const isNew = !id
  const crumbHref = routes.careerItem("project", projectId)
  const pageSkipLines = uniqueLines(skips.filter((x) => x.chatId !== panel.chat?.id))
  const titleMissingForChat = titleAttention && isBlank(form.title)

  return (
    <PageShell guard={guard} aiReopen={panel.reopen} save={<SaveButton state={uiState} savedAt={savedAt} onSave={() => void doSave()} />}>
      <CrumbRow
        back={{ href: crumbHref, label: data.project.name }}
        items={[
          { label: data.project.name, href: crumbHref },
          // 행이 없고 제목도 비었으면 자리 표시 칸을 빼서 "{프로젝트명} › 새 산출물 추가"로 읽히게 한다 (33 런)
          ...(isNew && isBlank(form.title) ? [] : [{ label: form.title, placeholder: "새 산출물" }]),
        ]}
        current={isNew ? CRUMB_CURRENT.deliverable.new : CRUMB_CURRENT.deliverable.existing}
      />
      <ShellBanners>
        <ReturnBanner />
      </ShellBanners>

      <DocHead className="space-y-2" label="산출물 정보">
        <div className="flex items-start gap-2">
          <DocTitleInput
            ref={titleRef}
            label="산출물 제목"
            placeholder="산출물 제목을 입력해 주세요"
            value={form.title}
            maxLength={PAGE_LIMITS.deliverableTitle}
            attention={titleMissingForChat}
            invalid={Boolean(titleError)}
            aria-describedby={titleError ? "dlv-title-error" : undefined}
            onChange={(e) => setTitle(e.target.value)}
          />
          {id ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="mt-1 size-11 lg:size-8" aria-label="산출물 메뉴">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleting({ kind: "career", entity_type: "project_deliverable", entity_id: id, label: form.title.trim() || data.title, unsavedChanges: dirty })}
                >
                  산출물 삭제
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {titleMissingForChat ? (
          <p className="flex items-center gap-1.5 text-sm text-warning-subtle-foreground">
            <TriangleAlert className="size-4 text-warning" aria-hidden />
            {PANEL_COPY.nameRequired.deliverable}
          </p>
        ) : titleError ? (
          <p id="dlv-title-error" className="text-sm text-destructive" role="alert">
            {titleError}
          </p>
        ) : null}
        {pageError ? (
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-destructive" role="alert">
            {pageError.text}
            {pageError.projectLink ? (
              <Button asChild variant="link" size="sm" className="h-auto px-0">
                <Link href={routes.projectPage(projectId)}>프로젝트로 가기</Link>
              </Button>
            ) : null}
          </p>
        ) : null}
        {pageSkipLines.map((line) => (
          <p key={line} className="text-sm text-muted-foreground">
            {line}
          </p>
        ))}
        <p className="text-sm text-muted-foreground">{NOTICE}</p>
      </DocHead>
      <Separator />

      <DocBody
        placement={panel.placement}
        left={
          <div className="space-y-2">
            {hasUnappliedDraft ? (
              // [UI-가정] spec marks it [가정]
              <Button variant="outline" size="sm" className="gap-1.5" onClick={showDraft}>
                <Sparkles className="text-ai" aria-hidden />
                AI 초안 있음
              </Button>
            ) : null}
            <DocTextarea
              ref={bodyRef}
              aria-label="본문"
              aria-invalid={bodyError ? true : undefined}
              aria-describedby={bodyError ? "dlv-body-error" : undefined}
              // 높이는 화면에 고정되지 않는다: 내용에 따라 자라고 왼쪽 입력 영역(DocBody)이 스크롤한다 (5.9 S-44 본문)
              grow
              className="min-h-[24rem]"
              value={form.body}
              onValueChange={setBody}
              placeholder={BODY_PLACEHOLDER}
            />
            <div className="flex flex-wrap items-center gap-2">
              {isBlank(form.body) && !panel.locked ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    panel.show()
                    panel.focusInput()
                  }}
                >
                  <Sparkles className="text-ai" aria-hidden />
                  AI와 초안 쓰기
                </Button>
              ) : null}
              <span className="flex-1" />
              {bodyError ? (
                <span id="dlv-body-error" className="text-sm text-destructive" role="alert">
                  {bodyError}
                </span>
              ) : null}
            </div>
          </div>
        }
        aside={
          <AiPanel
            panel={panel}
            proposalInline
            hideDraftTurnFailure={(f) => Boolean(f.draft_turn) || draftFailed}
            renderProposal={(p) => (
              <DeliverableDraftCard
                panel={p}
                formBody={form.body}
                filled={filledEntry}
                skipLine={uniqueLines(skips.filter((x) => x.chatId === p.chat?.id)).join(" · ") || null}
                draftFailed={draftFailed}
                onFill={onFill}
                onBodyQuote={onBodyQuote}
              />
            )}
            onDirectInput={() => bodyRef.current?.focus()}
          />
        }
      />

      <StaleWriteDialog
        open={stale}
        entity="deliverable"
        busy={saveState === "saving"}
        onOpenChange={setStale}
        onOverwrite={() => {
          setStale(false)
          void doSave(true)
        }}
        onReload={guard.reloadDiscarding}
      />
      <DeleteConfirmDialog
        target={deleting}
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={async (opts) => {
          if (!id) return
          await deleteDeliverableAction(id, opts.result_mode)
          preserved.clear()
          toast("산출물을 삭제했어요")
          // deleted: leave without the unsaved-changes prompt → S-43
          router.replace(crumbHref)
        }}
      />
    </PageShell>
  )
}

/** distinct skip copy lines, in order */
function uniqueLines(entries: Array<{ line: string }>): string[] {
  return [...new Set(entries.map((e) => e.line))]
}
