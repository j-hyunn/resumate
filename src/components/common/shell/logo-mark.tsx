/**
 * Resumate 로고 마크 — the same mark in the L-01 sidebar head and the L-02 ShellBar (leader Q-9: no new
 * spelling, the wordmark is "Resumate"). // [UI-가정] 브랜드 마크가 정해지기 전까지 lucide 아이콘
 */
import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

export function LogoMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground", className)}>
      <Sparkles className="size-4" aria-hidden />
    </div>
  )
}
