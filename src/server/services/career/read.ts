import type { PostgrestError } from "@supabase/supabase-js";
import { CAREER_LIMITS } from "@/lib/contracts/career";
import type {
  CareerListDto,
  CareerListItem,
  DeliverableDetailDto,
  EducationDetailDto,
  ExperienceDetailDto,
  ProjectDetailDto,
  StandaloneProjectDetailDto,
} from "@/lib/contracts/career";
import type { CareerStatus } from "@/lib/contracts/enums";
import { AppError } from "@/lib/contracts/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { listDeliverableWritingChats, listProjectWritingChats } from "@/server/services/writing-chat/chat";
import {
  DELIVERABLE_COLUMNS,
  DELIVERABLE_SUMMARY_COLUMNS,
  EDUCATION_COLUMNS,
  EXPERIENCE_COLUMNS,
  PROJECT_CARD_COLUMNS,
  PROJECT_COLUMNS,
  SKILL_COLUMNS,
  compareProjectCards,
  toDeliverableDto,
  toDeliverableSummaryDto,
  toEducationDto,
  toExperienceDto,
  toProjectCardDto,
  toProjectDto,
  toSkillDto,
} from "./mappers";
import { educationDisplayName } from "./education-name";
import { mapSaveError } from "./save";
import { groupCareerByYear } from "./year-view";

/**
 * Career reads v4.4 (DM §2.4, §7 v4.4 rows "커리어 목록" … "산출물 보기"). All as the user (RLS).
 * Pages call these directly (Server Components); actions wrap them for client refreshes.
 */

type Res = { data: unknown; error: PostgrestError | null };

function rows<R extends Res>(res: R): NonNullable<R["data"]> {
  if (res.error) throw mapSaveError(res.error);
  return (res.data ?? []) as NonNullable<R["data"]>;
}

function row<R extends Res>(res: R): R["data"] {
  if (res.error) throw mapSaveError(res.error);
  return res.data;
}

const month = (d: string | null) => (d === null ? null : d.slice(0, 7));

/** S-08 left: experiences, educations, standalone projects grouped by start year (CR-4). */
export async function getCareerList(supabase: UserSupabaseClient): Promise<CareerListDto> {
  const [experiences, educations, projects] = await Promise.all([
    supabase.from("experiences").select("id, company_name, start_month, status, created_at"),
    supabase.from("educations").select("id, program_name, institution_name, start_month, status, created_at"),
    supabase.from("projects").select("id, name, start_month, status, created_at").is("experience_id", null).is("education_id", null),
  ]);
  const items: CareerListItem[] = [
    ...rows(experiences).map((r) => ({ entityType: "experience" as const, id: r.id, name: r.company_name, startMonth: month(r.start_month), status: r.status as CareerStatus, createdAt: r.created_at })),
    ...rows(educations).map((r) => ({ entityType: "education" as const, id: r.id, name: educationDisplayName(r.program_name, r.institution_name), startMonth: month(r.start_month), status: r.status as CareerStatus, createdAt: r.created_at })),
    ...rows(projects).map((r) => ({ entityType: "project" as const, id: r.id, name: r.name, startMonth: month(r.start_month), status: r.status as CareerStatus, createdAt: r.created_at })),
  ];
  return { years: groupCareerByYear(items), isEmpty: items.length === 0 };
}

async function projectCards(supabase: UserSupabaseClient, column: "experience_id" | "education_id", id: string) {
  const list = rows(await supabase.from("projects").select(PROJECT_CARD_COLUMNS).eq(column, id));
  return [...list].sort(compareProjectCards).map(toProjectCardDto);
}

/** S-09 panel. null = not found (or not the user's). */
export async function getExperienceDetail(supabase: UserSupabaseClient, id: string): Promise<ExperienceDetailDto | null> {
  const exp = row(await supabase.from("experiences").select(EXPERIENCE_COLUMNS).eq("id", id).maybeSingle());
  if (!exp) return null;
  return { experience: toExperienceDto(exp), projects: await projectCards(supabase, "experience_id", id) };
}

/** S-34 panel. */
export async function getEducationDetail(supabase: UserSupabaseClient, id: string): Promise<EducationDetailDto | null> {
  const edu = row(await supabase.from("educations").select(EDUCATION_COLUMNS).eq("id", id).maybeSingle());
  if (!edu) return null;
  return { education: toEducationDto(edu), projects: await projectCards(supabase, "education_id", id) };
}

/** S-43 panel: a standalone project. An affiliated id → `null` here (the screen redirects to S-10). */
export async function getStandaloneProjectDetail(supabase: UserSupabaseClient, id: string): Promise<StandaloneProjectDetailDto | null> {
  const project = row(await supabase.from("projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle());
  if (!project || project.experience_id || project.education_id) return null;
  const [links, deliverables] = await Promise.all([
    supabase.from("project_skills").select("skill_id, created_at").eq("project_id", id).order("created_at"),
    supabase.from("project_deliverables").select(DELIVERABLE_SUMMARY_COLUMNS).eq("project_id", id).order("sort_order"),
  ]);
  const skillIds = rows(links).map((l) => l.skill_id);
  const skillRows = skillIds.length === 0 ? [] : rows(await supabase.from("skills").select(SKILL_COLUMNS).in("id", skillIds));
  const byId = new Map(skillRows.map((s) => [s.id, s]));
  const list = rows(deliverables).map(toDeliverableSummaryDto);
  return {
    project: toProjectDto(project),
    skills: skillIds.flatMap((sid) => {
      const s = byId.get(sid);
      return s ? [toSkillDto(s)] : [];
    }),
    deliverables: list,
    deliverableLimitReached: list.length >= CAREER_LIMITS.maxDeliverables,
  };
}

/** S-10 page: an affiliated project + parent name + its chats. A standalone id → `null` (S-08 `?item=project:`). */
export async function getProjectDetail(supabase: UserSupabaseClient, id: string): Promise<ProjectDetailDto | null> {
  const project = row(await supabase.from("projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle());
  if (!project || (!project.experience_id && !project.education_id)) return null;
  const parent = project.experience_id
    ? row(await supabase.from("experiences").select("id, company_name").eq("id", project.experience_id).maybeSingle())
    : null;
  const edu = project.education_id
    ? row(await supabase.from("educations").select("id, program_name, institution_name").eq("id", project.education_id).maybeSingle())
    : null;
  const writingChats = await listProjectWritingChats(supabase, id);
  return {
    project: toProjectDto(project),
    parent: project.experience_id
      ? { type: "experience", id: project.experience_id, name: parent?.company_name ?? null }
      : { type: "education", id: project.education_id!, name: edu ? educationDisplayName(edu.program_name, edu.institution_name) : null },
    writingChats,
  };
}

/** S-44. */
export async function getDeliverable(supabase: UserSupabaseClient, id: string): Promise<DeliverableDetailDto | null> {
  const d = row(await supabase.from("project_deliverables").select(DELIVERABLE_COLUMNS).eq("id", id).maybeSingle());
  if (!d) return null;
  const project = row(await supabase.from("projects").select("id, name").eq("id", d.project_id).maybeSingle());
  if (!project) throw new AppError("not_found");
  // v4.5 (DM §7 산출물 상세): the deliverable's AI chats, latest activity first.
  const writingChats = await listDeliverableWritingChats(supabase, d.id);
  return { deliverable: toDeliverableDto(d), project: { id: project.id, name: project.name }, writingChats };
}
