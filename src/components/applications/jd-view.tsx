"use client"

/**
 * S-15 JD·요건 (F-P2-02): 왼쪽 "공고 원문"(문장 하이라이트) / 오른쪽 요건 목록(카테고리별, 핵심 배지,
 * 직접 수정 표시) + 기술 키워드. 요건마다 원문 문장(source_sids)이 연결된다.
 * 요건 수정(F-P2-03)은 Could라 MVP에서 읽기 전용.
 * R17: 요건은 더 이상 추출하지 않는다 — 요건·키워드·경력 조건이 모두 비어 있으면 오른쪽 열을 그리지 않아
 * 원문만 보인다 (요건 목록 영역 재설계는 UI 요청).
 */
import { DocTextarea } from "@/components/common/doc-markdown-editor"
import * as React from "react"
import { ArrowUpRight, PenLine, TextSearch } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { JdRawEditButton, JdRawEditor, JdRawPanelTitle, JdRawSavedNote, useJdRawEdit } from "./jd-raw-edit"
import type { JdRequirement, JdSentence } from "@/types/db"
import { cn } from "@/lib/utils"
import { IMPORTANCE_HIGH_LABEL, REQUIREMENT_CATEGORY_LABELS, REQUIREMENT_CATEGORY_ORDER } from "./labels"

export function JdView({
  applicationProjectId,
  previewSave = null,
  rawText,
  sentences,
  requirements,
  techKeywords,
  seniority,
  sourceUrl = null,
  requirementsSlot,
}: {
  applicationProjectId: string
  /** `?state=raw-*` previews of the save */
  previewSave?: "ok" | "failed" | "refused" | null
  /** job_descriptions.raw_text — shown as is; sentences are highlighted by start/end offsets (C-2, A3 UQ-73) */
  rawText: string
  sentences: JdSentence[]
  requirements: JdRequirement[]
  techKeywords: Array<{ keyword: string; source_sids: string[] }>
  seniority: string | null
  /**
   * (v5.20, CF-A16) 공고 URL로 만든 자기소개서면 `job_descriptions.source_url` — 원문 패널 머리에
   * "원래 공고 열기"를 둔다. 원문 수정(Q53-2)은 이 주소를 바꾸지 않는다 `[가정]`.
   */
  sourceUrl?: string | null
  /**
   * 요건 영역 replacement while there are no requirements yet (v4): C-18 영역형 / "요건 정리하기" /
   * C-20 block / 분석 중. The 공고 원문 panel always stays (02 S-15 v5).
   */
  requirementsSlot?: React.ReactNode
}) {
  const [active, setActive] = React.useState<{ key: string; sids: string[] } | null>(null)
  const sentenceRefs = React.useRef<Record<string, HTMLSpanElement | null>>({})
  const edit = useJdRawEdit()

  const show = (key: string, sids: string[]) => {
    setActive((cur) => (cur?.key === key ? null : { key, sids }))
    const first = sids[0] && sentenceRefs.current[sids[0]]
    if (first) first.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  return (
    // (2026-11-10 사용자 요청) 원문은 카드 없이 컨테이너 폭 전체를 쓴다. 오른쪽 열(요건)이 비면 — 예: AI 미연결로
    // "요건 정리하기"가 아무것도 그리지 않을 때 — 그 div를 감춰(`empty:hidden`) 원문만 꽉 차게 보인다
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
      <section aria-label="공고 원문" className="flex min-w-0 flex-col gap-3 xl:flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <JdRawPanelTitle>공고 원문</JdRawPanelTitle>
          <span className="flex items-center gap-1">
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
        {edit.editing ? (
          <JdRawEditor applicationProjectId={applicationProjectId} rawText={rawText} previewSave={previewSave} />
        ) : !active ? (
          // 공고 원문은 마크다운으로 보인다 (2026-11-10 사용자 요청 — "일반 텍스트 입력창이 아니라 마크다운 형식으로").
          // 공통 마크다운 편집기를 읽기 전용으로 쓴다. 요건 근거를 눌러 문장을 강조할 때는 글자 위치(offset)로 강조해야
          // 해서 아래 일반 글 보기로 바꾼다 `[UI-가정]`
          <DocTextarea value={rawText} onValueChange={() => {}} readOnly grow aria-label="공고 원문" className="min-h-0" />
        ) : (
        <p className="text-base leading-[1.75] whitespace-pre-wrap">
          {segments(rawText, sentences).map((seg, i) => {
            if (!seg.sid) return <React.Fragment key={`t${i}`}>{seg.text}</React.Fragment>
            const sid = seg.sid
            const on = active?.sids.includes(sid)
            return (
              <span
                key={sid}
                ref={(el) => {
                  sentenceRefs.current[sid] = el
                }}
                className={cn("rounded-sm transition-colors", on && "bg-ai-subtle text-ai-subtle-foreground")}
              >
                {on ? <mark className="bg-transparent text-inherit">{seg.text}</mark> : seg.text}
              </span>
            )
          })}
        </p>
        )}
      </section>

      {requirementsSlot ? (
        <div className="min-w-0 space-y-6 empty:hidden xl:flex-1">{requirementsSlot}</div>
      ) : requirements.length === 0 && techKeywords.length === 0 && !seniority ? null : (
      <div className="min-w-0 space-y-6 empty:hidden xl:flex-1">
        {seniority ? (
          <p className="text-sm text-muted-foreground">
            경력 조건: <span className="text-foreground">{seniority}</span>
          </p>
        ) : null}
        {REQUIREMENT_CATEGORY_ORDER.map((cat) => {
          const items = requirements.filter((r) => r.category === cat)
          return (
            <section key={cat} className="space-y-2" aria-labelledby={`req-${cat}`}>
              <h2 id={`req-${cat}`} className="text-base leading-6 font-semibold">
                {REQUIREMENT_CATEGORY_LABELS[cat]} <span className="text-sm font-normal text-muted-foreground tabular-nums">{items.length}</span>
              </h2>
              {items.length === 0 ? (
                // [UI-가정] 카테고리 빈 상태 문구
                <p className="text-sm text-muted-foreground">공고에서 찾지 못했어요</p>
              ) : (
                <ul className="divide-y rounded-lg border bg-card">
                  {items.map((r) => (
                    <li key={r.id} className="flex items-start gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="flex flex-wrap items-center gap-2">
                          {r.importance === "high" ? <Badge variant="secondary">{IMPORTANCE_HIGH_LABEL}</Badge> : null}
                          <span>{r.content}</span>
                          {r.origin === "user" || r.is_user_edited ? (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <PenLine className="size-3" aria-hidden />
                              직접 수정
                            </span>
                          ) : null}
                        </p>
                        {r.keywords.length ? <p className="text-sm text-muted-foreground">{r.keywords.join(", ")}</p> : null}
                      </div>
                      {r.source_sids.length ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-pressed={active?.key === r.id}
                          onClick={() => show(r.id, r.source_sids)}
                          aria-label={`${r.content} 원문 문장 보기`}
                        >
                          <TextSearch aria-hidden />
                          원문
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
        <section className="space-y-2" aria-labelledby="req-tech">
          <h2 id="req-tech" className="text-base leading-6 font-semibold">
            기술 키워드
          </h2>
          {techKeywords.length === 0 ? (
            <p className="text-sm text-muted-foreground">공고에서 찾지 못했어요</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {techKeywords.map((k) => (
                <button
                  key={k.keyword}
                  type="button"
                  onClick={() => show(`kw-${k.keyword}`, k.source_sids)}
                  aria-pressed={active?.key === `kw-${k.keyword}`}
                  className="focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Badge variant="secondary" className="h-7 px-2.5 text-sm">
                    {k.keyword}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      )}
    </div>
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

// R17 (2026-11-14): `ExtractionFailed`, `ExtractingLine`, `RunExtraction` ("요건 정리하기", AI-01) are gone —
// the JD is used as raw text, so there is no requirement extraction to start, wait for, or retry.
