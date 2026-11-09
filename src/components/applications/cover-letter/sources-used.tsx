"use client"

/**
 * C-11 "사용한 경력·프로젝트" — (v5.20 재작성, CL-5 / design-system v5.15 3.10) **읽기 전용 목록**.
 *
 * - 행은 **경로 한 줄뿐**이다: "회사명 또는 교육 표시 이름 › 프로젝트명" (v5.15, **CF-S2** 확정).
 *   주/보조(`role`)·AI 선택/내가 추가(`origin`) **배지도, 선택 이유(`rationale`) 줄도 그리지 않는다** —
 *   그 값들은 제안 쪽에만 있고 `rationale`은 정본에 저장되지 않아 새로 고침한 뒤에는 그릴 수 없다.
 *   선택 이유는 대화의 초안 턴 `sources_selected` 근거 카드에서 본다.
 * - 순서는 `{slot}.sources.{n}` **그대로**(주 근거가 먼저) — 화면이 다시 정렬하지 않는다.
 * - 행 전체가 C-02 근거 패널을 여는 버튼이다 `[UI-가정]`.
 * - 고르는 장치(체크 트리·"변경 사항으로 다시 생성"·프로젝트 8개 상한)는 **폐기**다. 근거를 바꾸려면
 *   패널 대화로 지시한다.
 * - 문항의 근거는 **그 문항 초안 제안의 `sources[]`**에서 온다(**CF-S1**). [반영]한 문항만 목록이 바뀌고
 *   손으로만 고친 문항은 기존 목록을 그대로 보인다 — 화면은 근거를 저장 요청에 싣지 않으므로 "저장 전"
 *   표시도 두지 않는다 `[UI-가정]`.
 */
import * as React from "react"
import { ChevronRight, ListChecks, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { EvidencePanel } from "@/components/common/evidence"
import type { EvidenceView } from "@/lib/data/evidence"
import { cn } from "@/lib/utils"

/**
 * `EvidenceView.path` = "연도 › 회사명/기관명 › 프로젝트명 › 상세 내용 제목 › 필드". C-11 행은
 * **"회사명 또는 교육 표시 이름 › 프로젝트명"** 두 마디만 보이므로 연도를 떼고 앞 두 마디를 쓴다
 * `[UI-가정]`(경로가 더 짧으면 있는 만큼).
 */
export function sourcePathLine(item: EvidenceView): string {
  const parts = item.path.filter((p) => p && !/^\d{4}$/.test(p))
  if (parts.length === 0) return item.source_label
  return parts.slice(0, 2).join(" › ")
}

export function SourcesUsed({ items, questionNumber }: { items: EvidenceView[] | undefined; questionNumber: number }) {
  const [open, setOpen] = React.useState(false)
  const [panel, setPanel] = React.useState<{ items: EvidenceView[]; focusId: string } | null>(null)
  const list = items ?? []
  // 0개면 트리거를 그리지 않는다 (3.10)
  if (list.length === 0) return null
  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
            <ListChecks className="size-4" aria-hidden />
            사용한 경력·프로젝트 <span className="tabular-nums">{list.length}</span>개
            <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul aria-label={`문항 ${questionNumber}이 사용한 경력·프로젝트`}>
            {list.map((item) => (
              <li key={item.id} className="border-b py-2 last:border-0">
                <button
                  type="button"
                  className="-mx-2 w-full rounded-md px-2 text-left text-sm font-medium hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => setPanel({ items: list, focusId: item.id })}
                >
                  {item.status === "deleted" ? (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Unlink className="size-3.5 shrink-0" aria-hidden />
                      {item.source_label}
                      <span className="sr-only">원본 삭제됨</span>
                    </span>
                  ) : (
                    sourcePathLine(item)
                  )}
                </button>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
      {/* C-02 — 화면에 EvidenceProvider가 없어도 되게 이 컴포넌트가 직접 들고 있다 */}
      <EvidencePanel open={panel !== null} onOpenChange={(o) => !o && setPanel(null)} items={panel?.items ?? []} focusId={panel?.focusId} />
    </>
  )
}
