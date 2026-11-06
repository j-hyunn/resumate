"use client"

/**
 * S-24 ④ 개선 요청 탭 (UX v5.17 S-24 ④ SD-3 / F-COM-11, design-system 5.11.4). 서비스 안에서 내용을 받지 않고
 * 외부 폼 링크 하나뿐이다. 주소(`NEXT_PUBLIC_FEEDBACK_FORM_URL`)가 비어 있으면 "준비 중"(decisions 3.23 R13-U3).
 * 서버에서 읽는 값이 없어 로딩·오류 상태가 없다.
 *
 * preview: feedback-ready (주소가 있는 모양을 미리 본다 — 주소가 없으면 about:blank)
 */
import { Clock, ExternalLink, Info } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FEEDBACK_FORM_URL, IS_FEEDBACK_FORM_READY } from "@/lib/contracts/feedback"

export function FeedbackTab({ preview = null }: { preview?: string | null }) {
  const url = FEEDBACK_FORM_URL ?? (preview === "feedback-ready" ? "about:blank" : null)
  const ready = IS_FEEDBACK_FORM_READY || preview === "feedback-ready"
  return (
    <div className="space-y-4">
      <p className="text-base">쓰면서 아쉬웠던 점이나 바라는 기능을 알려 주세요</p>
      {ready && url ? (
        <>
          <Button asChild className="w-fit">
            <a href={url} target="_blank" rel="noopener noreferrer">
              개선 요청 보내기
              <ExternalLink className="size-3.5" aria-hidden />
              <span className="sr-only">(새 창)</span>
            </a>
          </Button>
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            입력한 내용은 폼 제공자에게 전달돼요. Resumate는 저장하지 않아요
          </p>
        </>
      ) : (
        <>
          {/* [UI-가정] G-71 준비 중 모양: disabled 버튼 + "준비 중" 배지 (SD-Q1 주소 미정) */}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled>
              개선 요청 보내기
              <ExternalLink className="size-3.5" aria-hidden />
            </Button>
            <Badge variant="outline">준비 중</Badge>
          </div>
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
            개선 요청 창구를 준비하고 있어요. 곧 열어요
          </p>
        </>
      )}
    </div>
  )
}
