"use client"

/**
 * S-15 공고 원문 수정 (Q53-2, 02 S-15 표 · 04 §2.6.1). The one exception to "JD 교체 불가": a JD whose
 * extraction failed for an input cause and has no requirements. Not an AI run: works without a key,
 * saves on "저장" only, never starts an extraction (D-30).
 *
 * The provider wraps the panel and the 요건 영역 so both know the edit state: while editing,
 * "요건 정리하기" is disabled and the C-20 keeps showing the cause.
 */
import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CircleAlert, CircleCheck, Loader2, PenLine, TriangleAlert } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Textarea } from "@/components/ui/textarea"
import { aiErrorTitle } from "@/components/common/ai-error-notice"
import { CharCount } from "@/components/common/input-guide"
import { JD_LONG_WARNING, JD_RAW_TEXT_LONG, JD_RAW_TEXT_MAX, JD_RAW_TEXT_SHORT, JD_SHORT_WARNING } from "@/lib/data/jd-raw-text"
import { routes } from "@/lib/routes"
import type { AiErrorCode } from "@/types/db"
import { updateFailedJdRawTextAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"
import { jdRawEditReducer, jdRawEditView } from "./jd-raw-edit-state"

/** S-15 "저장 성공" (명세 문구) */
const SAVED_NOTE = "저장했어요. '요건 정리하기'를 누르면 고친 공고로 다시 정리해요"
/** S-15 "저장 실패" (명세 문구) */
const SAVE_FAILED = "저장하지 못했어요. 다시 시도해 주세요"
const SAVE_REFUSED = "이 공고는 지금 고칠 수 없어요"
/** [UI-가정] 저장하지 않고 떠날 때 확인 (S-15 "수정 중" 문구 없음). 떠나는 경로마다 문구가 다르다 */
const LEAVE_COPY = {
  cancel: { title: "고친 내용을 버릴까요?", action: "버리기" },
  leave: { title: "저장하지 않고 떠날까요?", action: "떠나기" },
} as const
const LEAVE_BODY = "저장하지 않은 내용은 사라져요"

/** What the unsaved-edits dialog is asking about */
type LeaveAsk = { kind: "cancel" } | { kind: "link"; href: string } | { kind: "back" }

interface JdRawEditValue {
  /** 04 §2.6.1 조건 1~5 (getJdView.rawTextEditable), and no refused save; false → no button anywhere */
  editable: boolean
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
  initialEditing,
  initialSaved = false,
  children,
}: {
  editable: boolean
  /** `?edit=1` from a C-20 "공고 원문 고치기" (S-16 · S-17 · S-18 · S-33) */
  initialEditing: boolean
  /** `?state=raw-saved` */
  initialSaved?: boolean
  children: React.ReactNode
}) {
  const [state, dispatch] = React.useReducer(jdRawEditReducer, { editing: initialEditing, refused: false, saved: initialSaved })
  const view = jdRawEditView(state, editable)
  const pendingFocus = React.useRef(false)
  const value = React.useMemo<JdRawEditValue>(
    () => ({
      editable: view.editable,
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
    [view.editable, view.editorOpen, state.saved],
  )
  return <JdRawEditContext.Provider value={value}>{children}</JdRawEditContext.Provider>
}

/** Head of the 공고 원문 panel: "공고 원문 고치기" (no key needed) */
export function JdRawEditButton() {
  const edit = useJdRawEdit()
  const button = React.useRef<HTMLButtonElement>(null)
  const shown = edit.editable && !edit.editing
  // UQ-608: 취소 → the textarea is gone; after 저장 the saved note takes it instead
  React.useEffect(() => {
    if (shown && !edit.saved && edit.takeFocus()) button.current?.focus()
  }, [shown, edit])
  if (!shown) return null
  return (
    <Button ref={button} variant="outline" size="sm" onClick={edit.start}>
      <PenLine aria-hidden />
      공고 원문 고치기
    </Button>
  )
}

/**
 * S-15 "요건이 있는 공고" (Q53-9): reached from an input-caused 질문 생성·인사이트 failure. The text can't
 * be edited (Q53-2 범위 밖), so this says what to do instead of a dead end. [가정 명세]
 */
export function JdLockedNotice({ cause, hasResults = false }: { cause: AiErrorCode; hasResults?: boolean }) {
  return (
    <Alert variant="warning">
      <TriangleAlert aria-hidden />
      <AlertTitle>{aiErrorTitle(cause, { reduceTarget: "공고 원문" })}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          {hasResults
            ? // [UI-가정] Q53-11 `succeeded` + 요건 0개 + 이 원문으로 만든 결과 있음
              "이 공고로 만든 결과가 있어 원문을 고칠 수 없어요. 공고가 원인이면 새 기업 JD로 추가해 주세요"
            : "이 공고는 요건이 정리되어 있어 원문을 고칠 수 없어요. 공고가 원인이면 새 기업 JD로 추가하고, 커리어가 길면 줄인 뒤 다시 실행해 주세요"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={routes.applicationNew()}>새 기업 JD 추가</Link>
          </Button>
          {hasResults ? null : (
            <Button asChild variant="outline" size="sm">
              <Link href={routes.career()}>커리어 정리하기</Link>
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}

export function JdRawSavedNote() {
  const edit = useJdRawEdit()
  const { saved } = edit
  const note = React.useRef<HTMLDivElement>(null)
  // UQ-608: 저장 → the textarea is gone, focus lands on what happened
  React.useEffect(() => {
    if (saved && edit.takeFocus()) note.current?.focus()
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
  previewSave?: "ok" | "failed" | "refused" | null
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
      const result =
        previewSave === "refused"
          ? { refused: "jd_raw_text_locked" as const }
          : previewSave === "ok"
            ? null
            : await updateFailedJdRawTextAction(applicationProjectId, trimmed)
      if (result && "refused" in result) {
        // 조건에서 벗어남 (다른 탭에서 추출 중·성공): input kept + 최신 상태 다시 읽기.
        // The refusal is recorded first so the read-back can't close the editor (UQ-601)
        edit.markRefused()
        setError(SAVE_REFUSED)
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

  return (
    <div className="space-y-3">
      <Textarea
        id={id}
        aria-label="공고 원문"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-80 font-sans text-base"
        aria-invalid={tooLong || undefined}
        autoFocus
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
