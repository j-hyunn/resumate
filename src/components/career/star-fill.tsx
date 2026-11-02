/**
 * STAR 채움 표시 (design-system 6 A2): S T A R 회고 — 채움 primary-subtle, 빔 dashed.
 * Server- and client-safe.
 */
import { cn } from "@/lib/utils"
import type { ProjectDetail } from "@/types/db"

const CELLS = [
  { key: "situation", short: "S", label: "상황" },
  { key: "task", short: "T", label: "과제" },
  { key: "action", short: "A", label: "행동" },
  { key: "result", short: "R", label: "결과" },
  { key: "learnings", short: "회고", label: "회고 및 배운 점" },
] as const

export function StarFill({ detail, className }: { detail: Pick<ProjectDetail, "situation" | "task" | "action" | "result" | "learnings">; className?: string }) {
  const label = CELLS.map((c) => `${c.label} ${detail[c.key] ? "채움" : "비어 있음"}`).join(", ")
  return (
    <span role="img" aria-label={label} className={cn("inline-flex items-center gap-1", className)}>
      {CELLS.map((c) => {
        const filled = Boolean(detail[c.key])
        return (
          <span
            key={c.key}
            aria-hidden
            className={cn(
              "grid h-6 place-items-center rounded-sm text-xs font-medium",
              c.short.length > 1 ? "w-auto px-1" : "w-6",
              filled ? "bg-primary-subtle text-primary-subtle-foreground" : "border border-dashed text-muted-foreground",
            )}
          >
            {c.short}
          </span>
        )
      })}
    </span>
  )
}
