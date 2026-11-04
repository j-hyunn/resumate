import type { Education } from "@/types/db"

/**
 * An education's display name (S-08 list row · S-34 panel title · S-34 page title/breadcrumb):
 * 교육 명 (`program_name`), falling back to 운영 기관 (`institution_name`) when it's empty.
 * Matches the add modal (add-career-dialog: 교육 명 → program_name, 운영 기관 → institution_name).
 * User request 2026-11-04 — 02-user-flows S-08/S-34 still say `institution_name` (기획 확인 필요).
 */
export function educationName(e: Pick<Education, "program_name" | "institution_name">): string | null {
  return e.program_name?.trim() || e.institution_name?.trim() || null
}
