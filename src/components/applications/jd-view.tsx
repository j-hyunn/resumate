"use client"

/**
 * S-15 채용 공고 탭 본문 (v5.21, JR-1·JR-Q1 — 02 S-15 "채용 공고 탭 구성"): **공고 원문 + 문장 하이라이트**만 있다.
 * 요건 목록·기술 키워드·경력 조건·"요건 정리하기"는 없어졌다(AI-01 폐기). 이 탭에는 AI 진입점이 없다.
 *
 * - 공고 원문 = `job_descriptions.raw_text` 그대로(정규화된 원문, 줄바꿈·불릿 포함). 문장 위치는 `sentences`
 *   원소 `{sid, text, start, end}`(UTF-16 오프셋)로 알고, 하이라이트는 그 구간을 강조한다. 문장 ID는 보이지 않는다.
 * - 하이라이트: 인사이트 근거 칩(`jd_sentence`, 문장 하나 `?tab=jd&s=S3`)이나 S-16 요건 행 "공고 원문"
 *   링크(`sids` 전체 `?tab=jd&s=S3,S4`)에서 오면 그 문장들을 강조하고 첫 문장으로 스크롤한다. 탭을 떠나거나 원문을
 *   누르면 지운다 `[가정]`. 가리키는 문장이 지금 원문에 없으면 강조 없이 "이 근거가 가리키던 문장을 찾지 못했어요" `[가정]`.
 */
import { DocTextarea } from "@/components/common/doc-markdown-editor"
import * as React from "react"
import { ArrowUpRight, SearchX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { JdRawEditButton, JdRawEditor, JdRawPanelTitle, JdRawSavedNote, useJdRawEdit, type JdRawPreviewSave } from "./jd-raw-edit"
import type { JdSentence } from "@/types/db"
import { cn } from "@/lib/utils"
import { JD_TAB_LEFT_EVENT, SENTENCE_NOT_FOUND } from "./jd-highlight"
import { useJdHighlightRequest } from "./jd-highlight-context"

export function JdView({
  applicationProjectId,
  previewSave = null,
  rawText,
  sentences,
  sourceUrl = null,
  highlight = [],
}: {
  applicationProjectId: string
  /** `?state=raw-*` previews of the save */
  previewSave?: JdRawPreviewSave
  /** job_descriptions.raw_text — shown as is; sentences are highlighted by start/end offsets (DM v4.16 2.6) */
  rawText: string
  sentences: JdSentence[]
  /**
   * (v5.20, CF-A16) 공고 URL로 만든 자기소개서면 `job_descriptions.source_url` — 원문 패널 머리에
   * "원래 공고 열기"를 둔다. 공고 내용 수정은 이 주소를 바꾸지 않는다 `[가정]`.
   */
  sourceUrl?: string | null
  /** `?s=S3,S4` — the sentences to highlight */
  highlight?: string[]
}) {
  const edit = useJdRawEdit()
  const sentenceRefs = React.useRef<Record<string, HTMLSpanElement | null>>({})
  // UQ-614: an in-page click (S-46 → `JdHighlightRequestContext`, new nonce each time) wins over the server `?s=`, so the
  // same link clicked again — or after leaving the tab — highlights again
  const request = useJdHighlightRequest()
  const key = request ? `r${request.nonce}` : `s${highlight.join(",")}`
  const wanted = request ? request.sids : highlight
  const [active, setActive] = React.useState<{ key: string; sids: string[] }>({ key, sids: wanted })
  // a new request / `?s=` (another chip / link) replaces the highlight — adjust during render, no effect round
  if (active.key !== key) setActive({ key, sids: wanted })

  const known = React.useMemo(() => new Set(sentences.map((s) => s.sid)), [sentences])
  const shown = active.sids.filter((sid) => known.has(sid))
  const missing = active.sids.length > 0 && shown.length < active.sids.length

  const clear = React.useCallback(() => setActive((cur) => (cur.sids.length ? { key: cur.key, sids: [] } : cur)), [])
  React.useEffect(() => {
    window.addEventListener(JD_TAB_LEFT_EVENT, clear)
    return () => window.removeEventListener(JD_TAB_LEFT_EVENT, clear)
  }, [clear])

  const first = shown[0] ?? null
  // UQ-620: scroll to the first highlighted sentence and move focus there (tabIndex -1), so screen readers start at it
  React.useEffect(() => {
    if (!first) return
    const t = window.setTimeout(() => {
      const el = sentenceRefs.current[first]
      if (!el) return
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: "center", behavior: "smooth" })
    }, 50)
    return () => window.clearTimeout(t)
  }, [first, active.key])

  return (
    // (2026-11-10 사용자 요청) 원문은 카드 없이 컨테이너 폭 전체를 쓴다
    <section aria-label="공고 원문" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <JdRawPanelTitle>공고 원문</JdRawPanelTitle>
        <span className="flex flex-wrap items-center gap-2">
          {sourceUrl ? (
            <Button variant="link" size="sm" className="h-auto px-0" asChild>
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                원래 공고 열기
                <ArrowUpRight className="size-3.5" aria-hidden />
                <span className="sr-only">새 창에서 열림</span>
              </a>
            </Button>
          ) : null}
          <JdRawEditButton />
        </span>
      </div>
      <JdRawSavedNote />
      {missing && !edit.editing ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
          <SearchX className="size-4 shrink-0" aria-hidden />
          {SENTENCE_NOT_FOUND}
        </p>
      ) : null}
      {/* UQ-623: the live region stays mounted; only its text changes, so the first highlight is announced */}
      <span className="sr-only" role="status">
        {shown.length > 0 && !edit.editing ? `근거 문장 ${shown.length}개를 강조했어요` : ""}
      </span>
      {edit.editing ? (
        <JdRawEditor applicationProjectId={applicationProjectId} rawText={rawText} previewSave={previewSave} />
      ) : shown.length === 0 ? (
        // 공고 원문은 마크다운으로 보인다 (2026-11-10 사용자 요청 — "일반 텍스트 입력창이 아니라 마크다운 형식으로").
        // 공통 마크다운 편집기를 읽기 전용으로 쓴다. 문장을 강조할 때는 글자 위치(offset)로 강조해야 해서 아래 일반 글
        // 보기로 바꾼다 `[UI-가정]`
        <DocTextarea value={rawText} onValueChange={() => {}} readOnly grow aria-label="공고 원문" className="min-h-0" />
      ) : (
        // 원문을 누르면 강조를 지운다 `[가정]` (선택·복사는 그대로 — 클릭만, 드래그 선택은 지우지 않는다)
        <p
          // UQ-621: long URLs / tokens wrap on narrow screens (no horizontal scroll)
          className="text-base leading-[1.75] break-words whitespace-pre-wrap [overflow-wrap:anywhere]"
          onClick={() => {
            if (!window.getSelection()?.toString()) clear()
          }}
        >
          {segments(rawText, sentences).map((seg, i) => {
            if (!seg.sid) return <React.Fragment key={`t${i}`}>{seg.text}</React.Fragment>
            const sid = seg.sid
            const on = shown.includes(sid)
            return (
              <span
                key={sid}
                ref={(el) => {
                  sentenceRefs.current[sid] = el
                }}
                tabIndex={sid === first ? -1 : undefined}
                className={cn("rounded-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", on && "bg-ai-subtle text-ai-subtle-foreground")}
              >
                {on ? (
                  <mark className="bg-transparent text-inherit">
                    {/* UQ-620: `<mark>` is not read by most screen readers — say what it is `[UI-가정]` */}
                    <span className="sr-only">근거 문장: </span>
                    {seg.text}
                  </mark>
                ) : (
                  seg.text
                )}
              </span>
            )
          })}
        </p>
      )}
    </section>
  )
}

/** raw_text split into plain gaps and sentence spans by offsets (falls back to sentence text if offsets don't fit) */
function segments(raw: string, sentences: JdSentence[]): Array<{ sid: string | null; text: string }> {
  const sorted = [...sentences].sort((a, b) => a.start - b.start)
  const valid = sorted.every((s, i) => s.start >= 0 && s.end <= raw.length && s.start <= s.end && (i === 0 || s.start >= sorted[i - 1].end))
  if (!valid) return sorted.flatMap((s) => [{ sid: s.sid, text: s.text }, { sid: null, text: "\n" }])
  const out: Array<{ sid: string | null; text: string }> = []
  let pos = 0
  for (const s of sorted) {
    if (s.start > pos) out.push({ sid: null, text: raw.slice(pos, s.start) })
    out.push({ sid: s.sid, text: raw.slice(s.start, s.end) })
    pos = s.end
  }
  if (pos < raw.length) out.push({ sid: null, text: raw.slice(pos) })
  return out
}
