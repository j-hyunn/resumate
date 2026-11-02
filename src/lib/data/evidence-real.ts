import "server-only"
import { AppError } from "@/lib/contracts/errors"
/**
 * W3: evidence chips from real rows. Loads the owners' `evidence_links` and the rows their chips point at (RLS =
 * ownership), then `toEvidenceView` computes status / path / deep link exactly as for the previews. Shared with
 * the interview screens.
 */
import { requireConsentedUser } from "@/server/auth/session"
import { mapDbError } from "@/server/db/errors"
import type { MockDb } from "@/lib/mock/fixtures"
import type { EvidenceLink, EvidenceOwnerType } from "@/types/db"

function rowsOf<T>(res: { data: T[] | null; error: Parameters<typeof mapDbError>[0] | null }): T[] {
  if (res.error) throw mapDbError(res.error)
  return res.data ?? []
}

const uniq = (values: Array<string | null | undefined>) => [...new Set(values.filter((v): v is string => Boolean(v)))]

export async function loadEvidenceRows(ownerType: EvidenceOwnerType, ownerIds: string[]): Promise<{ links: EvidenceLink[]; db: MockDb }> {
  const { supabase } = await requireConsentedUser()
  // QA-W5-07: Server Action input — a non-array / non-string id list is invalid_input, not a TypeError
  if (!Array.isArray(ownerIds) || ownerIds.some((id) => typeof id !== "string")) throw new AppError("invalid_input")
  const links = ownerIds.length
    ? (rowsOf(await supabase.from("evidence_links").select("*").eq("owner_type", ownerType).in("owner_id", ownerIds).order("sort_order")) as unknown as EvidenceLink[])
    : []
  const idsOf = (...types: Array<EvidenceLink["source_type"]>) => uniq(links.filter((l) => types.includes(l.source_type)).map((l) => l.source_id))
  type SourceTable = "achievements" | "project_details" | "projects" | "experiences" | "educations" | "skills" | "jd_requirements" | "interview_answers" | "draft_sections"
  const select = async <T,>(table: SourceTable, ids: string[]): Promise<T[]> => (ids.length ? (rowsOf(await supabase.from(table).select("*").in("id", ids)) as unknown as T[]) : [])

  type Row = Record<string, string | null>
  const achievements = await select<Row>("achievements", idsOf("achievement"))
  const details = await select<Row>("project_details", uniq([...idsOf("project_detail"), ...achievements.map((a) => a.project_detail_id)]))
  const projects = await select<Row>("projects", uniq([...idsOf("project"), ...details.map((d) => d.project_id)]))
  const [experiences, educations, skills, requirements, answers, sections, profiles] = await Promise.all([
    select<Row>("experiences", uniq([...idsOf("experience"), ...projects.map((p) => p.experience_id), ...achievements.map((a) => a.experience_id)])),
    select<Row>("educations", uniq([...idsOf("education"), ...projects.map((p) => p.education_id)])),
    select<Row>("skills", idsOf("skill")),
    select<Row>("jd_requirements", idsOf("jd_requirement")),
    select<Row>("interview_answers", idsOf("interview_answer")),
    select<Row>("draft_sections", idsOf("user_note")),
    idsOf("profile").length || links.some((l) => l.source_type === "profile") ? supabase.from("profiles").select("*").limit(1).then(rowsOf) : Promise.resolve([]),
  ])
  const db = {
    profiles,
    experiences,
    educations,
    projects,
    project_details: details,
    achievements,
    skills,
    jd_requirements: requirements,
    interview_answers: answers,
    draft_sections: sections,
  } as unknown as MockDb
  return { links, db }
}
