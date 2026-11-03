import type { ProjectStarField } from "@/types/db"

const STAR: ProjectStarField[] = ["situation", "task", "action", "result", "learnings"]

/** S-10 `?focus=`: a STAR 칸 (C-02), `star` / legacy `fields` (C-09 → 빈 STAR 칸, 상황 → 행동) */
export function parseFocus(v: string | undefined): ProjectStarField | "star" | null {
  if (!v) return null
  if ((STAR as string[]).includes(v)) return v as ProjectStarField
  return v === "star" || v === "fields" ? "star" : null
}
