"use client"

/**
 * S-15 공고 내용 수정 (v5.21, JR-7 — 02 S-15 "공고 내용 수정" 표 · DM v4.16 2.6.1 `update_jd_raw_text`).
 * **공고 원문은 언제든 고칠 수 있다** — [공고 내용 수정]은 늘 보이고, 이 자기소개서의 인사이트가 대기·실행 중일 때만
 * 비활성 + "인사이트를 만드는 중에는 수정할 수 없어요"(`rawTextLockedReason = job_in_progress`). Not an AI run:
 * works without a key, saves on "저장" only, never starts AI (인사이트 자동 시작은 자기소개서를 만들 때만, JR-6).
 */
import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CircleAlert, CircleCheck, Loader2, PenLine, TriangleAlert } from "lucide-react"
import { Alert, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { CharCount } from "@/components/common/input-guide"
import { DocTextarea } from "@/components/common/doc-markdown-editor"
import {
  JD_LOCKED_IN_PROGRESS_MESSAGE,
  JD_LONG_WARNING,
  JD_NO_SENTENCES_MESSAGE,
  JD_RAW_TEXT_LONG,
  JD_RAW_TEXT_MAX,
  JD_RAW_TEXT_SHORT,
  JD_SHORT_WARNING,
} from "@/lib/data/jd-raw-text"
import type { JdRawTextRefusalCode } from "@/types/db"
import { updateJdRawTextAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"
import { jdRawEditReducer, jdRawEditView, jdRawFocusTarget } from "./jd-raw-edit-state"

/** S-15 "저장 성공" (v5.21 `[가정]` 문구) */
const SAVED_NOTE = "저장했어요"
/** S-15 "저장 실패" (`[가정]` 문구) */
const SAVE_FAILED = "저장하지 못했어요. 다시 시도해 주세요"
/** [UI-가정] `jd_raw_text_unchanged` — 화면은 바뀐 내용이 없으면 "저장"을 끄지만 서버가 같다고 볼 때(앞뒤 공백 등) */
const SAVE_UNCHANGED = "바뀐 내용이 없어요"

/** `?state=raw-save-*` → the refusal the preview answers */
export type JdRawPreviewSave = "ok" | "failed" | "refused" | "no_sentences" | null

/** S-15 "저장 실패" 표: refusal code → the line under the editor (DM v4.16 codes) */
export function jdRawRefusalCopy(code: JdRawTextRefusalCode): string {
  if (code === "jd_job_in_progress") return JD_LOCKED_IN_PROGRESS_MESSAGE
  if (code === "jd_no_sentences") return JD_NO_SENTENCES_MESSAGE
  if (code === "jd_raw_text_unchanged") return SAVE_UNCHANGED
  return SAVE_FAILED
}
/** [UI-가정] 저장하지 않고 떠날 때 확인 (S-15 "수정 중" 문구 없음). 떠나는 경로마다 문구가 다르다 */
const LEAVE_COPY = {
  cancel: { title: "고친 내용을 버릴까요?", action: "버리기" },
  leave: { title: "저장하지 않고 떠날까요?", action: "떠나기" },
} as const
const LEAVE_BODY = "저장하지 않은 내용은 사라져요"

/** What the unsaved-edits dialog is asking about */
type LeaveAsk = { kind: "cancel" } | { kind: "link"; href: string } | { kind: "back" }

interface JdRawEditValue {
  /** getJdView.rawTextEditable (JR-7: false only while an insight job is queued / running), and no refused save */
  editable: boolean
  /** getJdView.rawTextLockedReason — why [공고 내용 수정] is disabled */
  lockedReason: "job_in_progress" | null
  editing: boolean
  start: () => void
  stop: () => void
  saved: boolean
  markSaved: () => void
  clearSaved: () => void
  /** the conditions changed under a save (02 S-15 "저장 실패"): editor and typed text stay */
  markRefused: () => void
  /** the textarea just closed and focus is the next element's to take. True once (UQ-608) */
  takeFocus: () => boolean
}

const JdRawEditContext = React.createContext<JdRawEditValue | null>(null)

/** Outside the provider: not editable (S-15 only) */
export function useJdRawEdit(): JdRawEditValue {
  const none = () => undefined
  return (
    React.useContext(JdRawEditContext) ?? {
      editable: false,
      lockedReason: null,
      editing: false,
      start: none,
      stop: none,
      saved: false,
      markSaved: none,
      clearSaved: none,
      markRefused: none,
      takeFocus: () => false,
    }
  )
}

export function JdRawEditProvider({
  editable,
  lockedReason = null,
  initialEditing,
  initialSaved = false,
  children,
}: {
  editable: boolean
  lockedReason?: "job_in_progress" | null
  /** `?edit=1` from a C-20 "공고 원문 고치기" (S-16 인사이트 입력 원인 실패) */
  initialEditing: boolean
  /** `?state=raw-saved` */
  initialSaved?: boolean
  children: React.ReactNode
}) {
  const [state, dispatch] = React.useReducer(jdRawEditReducer, { editing: initialEditing, refused: false, saved: initialSaved })
  const view = jdRawEditView(state, editable)
  const pendingFocus = React.useRef(false)
  // a refused save (`jd_job_in_progress`) reads as locked until the server says otherwise
  const reason = lockedReason ?? (state.refused ? "job_in_progress" : null)
  const value = React.useMemo<JdRawEditValue>(
    () => ({
      editable: view.editable,
      lockedReason: reason,
      editing: view.editorOpen,
      start: () => dispatch("start"),
      stop: () => {
        pendingFocus.current = true
        dispatch("stop")
      },
      saved: state.saved,
      markSaved: () => {
        pendingFocus.current = true
        dispatch("saved")
      },
      clearSaved: () => dispatch("clear_saved"),
      markRefused: () => dispatch("refused"),
      takeFocus: () => {
        const take = pendingFocus.current
        pendingFocus.current = false
        return take
      },
    }),
    [view.editable, view.editorOpen, state.saved, reason],
  )
  return <JdRawEditContext.Provider value={value}>{children}</JdRawEditContext.Provider>
}

/**
 * Head of the 공고 원문 panel: **[공고 내용 수정]** (v5.21, JR-7) — always shown (no key needed). Disabled while an
 * insight is queued / running, with the reason next to it `[가정]` 문구.
 */
export function JdRawEditButton() {
  const edit = useJdRawEdit()
  const button = React.useRef<HTMLButtonElement>(null)
  // UQ-608: 취소 → the textarea is gone; after 저장 the saved note takes it instead
  React.useEffect(() => {
    if (jdRawFocusTarget(edit) === "button" && edit.takeFocus()) button.current?.focus()
  }, [edit])
  if (edit.editing) return null
  const locked = !edit.editable
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {locked && edit.lockedReason === "job_in_progress" ? (
        <span id="jd-raw-locked-reason" className="text-sm text-muted-foreground">
          {JD_LOCKED_IN_PROGRESS_MESSAGE}
        </span>
      ) : null}
      <Button
        ref={button}
        variant="outline"
        size="sm"
        disabled={locked}
        aria-describedby={locked && edit.lockedReason ? "jd-raw-locked-reason" : undefined}
        onClick={edit.start}
      >
        <PenLine aria-hidden />
        공고 내용 수정
      </Button>
    </span>
  )
}

/**
 * Title of the 공고 원문 panel. UQ-608 remaining case: after a refused save (an insight started meanwhile)
 * "취소" closes the textarea and the disabled [공고 내용 수정] can't take focus — the title does, not <body>.
 */
export function JdRawPanelTitle({ children }: { children: React.ReactNode }) {
  const edit = useJdRawEdit()
  const title = React.useRef<HTMLHeadingElement>(null)
  React.useEffect(() => {
    if (jdRawFocusTarget(edit) === "title" && edit.takeFocus()) title.current?.focus()
  }, [edit])
  return (
    <h2 ref={title} tabIndex={-1} className="text-lg leading-7 font-semibold outline-none">
      {children}
    </h2>
  )
}

// (v5.21, JR-7) `JdLockedNotice` ("요건이 있는 공고", Q53-9·Q53-11) is gone — the raw text is always editable.

export function JdRawSavedNote() {
  const edit = useJdRawEdit()
  const { saved } = edit
  const note = React.useRef<HTMLDivElement>(null)
  // UQ-608: 저장 → the textarea is gone, focus lands on what happened
  React.useEffect(() => {
    if (jdRawFocusTarget(edit) === "note" && edit.takeFocus()) note.current?.focus()
  }, [saved, edit])
  if (!saved) return null
  return (
    <Alert ref={note} role="status" tabIndex={-1} className="outline-none">
      <CircleCheck className="text-success" aria-hidden />
      <AlertTitle className="font-normal">{SAVED_NOTE}</AlertTitle>
    </Alert>
  )
}

export function JdRawEditor({
  applicationProjectId,
  rawText,
  previewSave = null,
}: {
  applicationProjectId: string
  rawText: string
  /** `?state=raw-*`: no write. "ok" pretends it saved; the others show that answer */
  previewSave?: JdRawPreviewSave
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const edit = useJdRawEdit()
  const [text, setText] = React.useState(rawText)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const id = React.useId()
  const trimmed = text.trim()
  const dirty = trimmed !== rawText.trim()
  const tooLong = trimmed.length > JD_RAW_TEXT_MAX
  // a refused save keeps the text but can't be sent again until the screen says it can be edited
  const canSave = edit.editable && trimmed.length > 0 && !tooLong && dirty && !saving
  const [ask, setAsk] = React.useState<LeaveAsk | null>(null)
  /** a same-URL history entry is on top, so browser back lands here first */
  const backGuard = React.useRef(false)
  const leaving = React.useRef(false)

  // [UI-가정] 저장하지 않고 떠나면 확인: tab close + in-app links (no router-level leave hook)
  React.useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return // opens elsewhere: this tab stays
      const link = (e.target as Element | null)?.closest?.("a[href]")
      const href = link?.getAttribute("href")
      if (!href || link?.getAttribute("target") === "_blank") return
      e.preventDefault()
      e.stopPropagation()
      setAsk({ kind: "link", href })
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    document.addEventListener("click", onClick, true)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      document.removeEventListener("click", onClick, true)
    }
  }, [dirty])

  // [UI-가정] 브라우저 뒤로 가기: the entry keeps Next's history state, so its own popstate handler stays a no-op.
  // The entry is not removed once the text is clean again: one back press then stays on this screen.
  React.useEffect(() => {
    if (dirty && !backGuard.current) {
      window.history.pushState(window.history.state, "")
      backGuard.current = true
    }
    const onPop = () => {
      if (!backGuard.current || leaving.current) return
      backGuard.current = false
      if (dirty) setAsk({ kind: "back" })
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [dirty])

  const stay = () => {
    if (leaving.current) return // the dialog closing after "떠나기"
    if (ask?.kind === "back") {
      window.history.pushState(window.history.state, "")
      backGuard.current = true
    }
    setAsk(null)
  }
  const discard = () => {
    const current = ask
    setAsk(null)
    if (current?.kind === "cancel") {
      setText(rawText)
      setError(null)
      edit.stop()
      dropEditParam()
      return
    }
    leaving.current = true
    if (current?.kind === "back") window.history.back()
    else if (current?.kind === "link") router.push(current.href)
  }

  /** the entry param did its job: a refresh must not reopen the editor */
  const dropEditParam = () => {
    const next = new URLSearchParams(params.toString())
    next.delete("edit")
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      if (previewSave === "failed") throw new Error("save failed (preview)")
      const result: { refused: JdRawTextRefusalCode } | Awaited<ReturnType<typeof updateJdRawTextAction>> | null =
        previewSave === "refused"
          ? { refused: "jd_job_in_progress" }
          : previewSave === "no_sentences"
            ? { refused: "jd_no_sentences" }
            : previewSave === "ok"
              ? null
              : await updateJdRawTextAction(applicationProjectId, trimmed)
      if (result && "refused" in result) {
        setError(jdRawRefusalCopy(result.refused))
        // `jd_no_sentences` / `jd_raw_text_unchanged`: input kept, fix and save again
        if (result.refused !== "jd_job_in_progress") return
        // 그 사이 인사이트가 시작됨 (다른 탭): input kept + 최신 상태 다시 읽기.
        // The refusal is recorded first so the read-back can't close the editor (UQ-601)
        edit.markRefused()
        if (previewSave === "refused") {
          // same read-back, driven by the URL: the page answers `editable = false`
          const next = new URLSearchParams(params.toString())
          next.set("refused", "1")
          router.replace(`${pathname}?${next.toString()}`)
        } else router.refresh()
        return
      }
      edit.markSaved()
      edit.stop()
      dropEditParam()
      router.refresh()
    } catch {
      setError(SAVE_FAILED)
    } finally {
      setSaving(false)
    }
  }

  const focused = React.useRef(false)
  const focusOnce = React.useCallback((el: HTMLElement | null) => {
    if (!el || focused.current) return
    focused.current = true
    el.focus()
  }, [])

  return (
    <div className="space-y-3">
      {/* 공고 원문 편집도 공통 마크다운 편집기로 (2026-11-10 사용자 요청 — 보기와 같은 마크다운 형식).
          저장되는 원문은 편집기가 내보내는 마크다운 문자열이다. 처음 열 때 한 번 포커스를 준다(옛 autoFocus) */}
      <DocTextarea
        ref={focusOnce}
        id={id}
        aria-label="공고 원문"
        value={text}
        onValueChange={setText}
        grow
        className="min-h-80"
        aria-invalid={tooLong || undefined}
      />
      <div className="flex justify-end">
        <CharCount count={trimmed.length} limit={JD_RAW_TEXT_MAX} />
      </div>
      {trimmed.length > 0 && trimmed.length < JD_RAW_TEXT_SHORT ? (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle className="font-normal">{JD_SHORT_WARNING}</AlertTitle>
        </Alert>
      ) : null}
      {trimmed.length > JD_RAW_TEXT_LONG ? (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle className="font-normal">{JD_LONG_WARNING}</AlertTitle>
        </Alert>
      ) : null}
      {error ? (
        <p className="flex items-center gap-1.5 text-sm text-destructive" role="alert">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          disabled={saving}
          onClick={() => {
            if (dirty) {
              setAsk({ kind: "cancel" })
              return
            }
            setError(null)
            edit.stop()
            dropEditParam()
          }}
        >
          취소
        </Button>
        <Button onClick={() => void save()} disabled={!canSave}>
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
          저장
        </Button>
      </div>
      <AlertDialog open={ask !== null} onOpenChange={(open) => !open && stay()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{(ask?.kind === "cancel" ? LEAVE_COPY.cancel : LEAVE_COPY.leave).title}</AlertDialogTitle>
            <AlertDialogDescription>{LEAVE_BODY}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>계속 고치기</AlertDialogCancel>
            <AlertDialogAction onClick={discard}>{(ask?.kind === "cancel" ? LEAVE_COPY.cancel : LEAVE_COPY.leave).action}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
