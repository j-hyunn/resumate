import type { Education } from "@/types/db"
import { educationDisplayName } from "@/server/services/career/education-name"

/**
 * An education's display name (S-08 list row · S-34 panel title · S-34 page title/breadcrumb) — ED-2:
 * 교육 명 (`program_name`), falling back to 운영 기관 (`institution_name`), null when both are empty.
 * Row-shaped adapter only: the rule itself lives in `@/server/services/career/education-name` (pure, no
 * server-only imports), which the server paths, the data layer and the mock store also use (UQ-735).
 */
export function educationName(e: Pick<Education, "program_name" | "institution_name">): string | null {
  return educationDisplayName(e.program_name, e.institution_name)
}
