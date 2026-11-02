import { Suspense } from "react"
import { AiConnectionProvider } from "@/components/common/ai-connection-context"
import { PreviewStateSwitcher } from "@/components/common/preview-state-client"

/**
 * 집중 화면 (셸 밖, 사이드바 없음) — S-41 키 연결 단계 (leader decision Q-5, design-system 5.7).
 * The screen draws its own h-16 top bar (X "연결 그만두기" · 제목 · StepIndicator).
 * // [UI-가정] narrow screens (<1024) also use this focus layout instead of the shell page variant.
 */
export default function FocusLayout({ children }: { children: React.ReactNode }) {
  return (
    <AiConnectionProvider>
      <div className="flex min-h-dvh flex-col bg-background">
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
      </div>
      <Suspense fallback={null}>
        <PreviewStateSwitcher />
      </Suspense>
    </AiConnectionProvider>
  )
}
