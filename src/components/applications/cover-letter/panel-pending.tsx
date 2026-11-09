"use client"

/**
 * S-46 오른쪽 **Resumate AI 패널 자리 — 연결 대기**.
 *
 * 패널 본체(대화 기록·시작 영역·메시지·초안 턴 스트리밍·**3.26 문항 초안 제안 카드**)는 아직 만들지
 * 못했다. 막힌 자리가 UI 안이 아니라 **데이터 계층·계약**이기 때문이다:
 *
 * - `useAiPanel`(`src/components/career/ai-panel/use-ai-panel.ts`)의 `AiPanelTarget`은
 *   `"project" | "deliverable"` 두 값뿐이고, 자소서 대화는 세 번째 대상(`cover_letter`)이다.
 * - 그 대상의 DTO·SSE 이벤트·`structured_draft`(`document.questions[]`)·대화 시작 RPC
 *   `start_document_writing_chat(p_application_project_id, p_document_kind, p_form_snapshot)`가
 *   **`src/lib/contracts/writing-chat.ts`**에 없다 — 이 파일은 백엔드 소유라 A3가 쓰지 않는다.
 * - 자소서 대화의 mock 계층(`writing_chats` where `application_project_id` + `document_kind`,
 *   초안 턴 시뮬레이션)도 A0 산출물에 없다.
 *
 * 그래서 이 자리는 **`// 연결 대기`**로 두고 보고서 "백엔드 요청 / 파운데이션 요청"에 올렸다. 왼쪽
 * 본문 입력·문항 편집·저장하기·복사는 패널 없이 그대로 동작한다(CL-8) — 명세가 요구하는 "키 없이도
 * 되는 자리"가 모두 왼쪽에 있어 화면이 막다른 길이 되지 않는다.
 */
import { Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AiLock } from "@/components/common/ai-lock"
import { useAiConnection } from "@/components/common/ai-connection-context"

export function CoverLetterPanelPending({ onClose }: { onClose: () => void }) {
  const connection = useAiConnection()
  const locked = connection !== null && !connection.active_provider
  return (
    <aside className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl bg-panel" aria-label="Resumate AI">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Sparkles className="size-4 text-ai" aria-hidden />
        <span className="text-sm font-medium">Resumate AI</span>
        <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="패널 닫기" onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {locked ? (
          // 키가 없으면 패널만 잠긴다 (C-18) — 왼쪽 본문·문항 편집·저장·복사는 그대로 된다 (CL-8)
          <AiLock entry="draft" size="area" />
        ) : (
          <p className="text-sm text-muted-foreground">
            {/* // 연결 대기 (contracts/writing-chat.ts — start_document_writing_chat · AI-04 초안 턴 SSE) */}
            자소서 작성 대화는 아직 연결되지 않았어요. 왼쪽에서 직접 쓰고 저장할 수 있어요
          </p>
        )}
      </div>
    </aside>
  )
}
