import type { CareerTreeDto } from "@/lib/contracts/career";
import type { UserSupabaseClient } from "@/server/db/types";
import {
  ACHIEVEMENT_COLUMNS,
  EDUCATION_COLUMNS,
  EXPERIENCE_COLUMNS,
  PROJECT_COLUMNS,
  PROJECT_DETAIL_COLUMNS,
  PROJECT_SKILL_COLUMNS,
  SKILL_COLUMNS,
  toAchievementDto,
  toEducationDto,
  toExperienceDto,
  toProjectDetailDto,
  toProjectDto,
  toSkillDto,
} from "./mappers";
import { mapSaveError } from "./save";
import { summarizeCareer } from "./summary";
import { currentYearInSeoul, groupCareerByYear } from "./year-view";

/**
 * S-08 career tree (DM §7 row 1, F-P1-09): all seven career tables read once as
 * the user (RLS), joined and grouped by year in memory (DM §2.4 — tens of rows
 * per user). Drafts are included; the screen shows them with a "작성 중" badge.
 * writing_chats (active) joins in S4.
 */
export async function getCareerTree(supabase: UserSupabaseClient, now: Date = new Date()): Promise<CareerTreeDto> {
  const [experiences, educations, projects, details, achievements, skills, links] = await Promise.all([
    supabase.from("experiences").select(EXPERIENCE_COLUMNS).order("start_month", { ascending: false, nullsFirst: false }),
    supabase.from("educations").select(EDUCATION_COLUMNS).order("start_month", { ascending: false, nullsFirst: false }),
    supabase.from("projects").select(PROJECT_COLUMNS).order("start_month", { ascending: false, nullsFirst: false }),
    supabase.from("project_details").select(PROJECT_DETAIL_COLUMNS).order("project_id").order("sort_order"),
    supabase.from("achievements").select(ACHIEVEMENT_COLUMNS).order("created_at"),
    supabase.from("skills").select(SKILL_COLUMNS).order("name"),
    supabase.from("project_skills").select(PROJECT_SKILL_COLUMNS).order("created_at"),
  ]);
  for (const res of [experiences, educations, projects, details, achievements, skills, links]) {
    if (res.error) throw mapSaveError(res.error);
  }

  const detailRows = details.data ?? [];
  const achievementRows = achievements.data ?? [];
  const linkRows = links.data ?? [];

  const achievementsPerDetail = new Map<string, number>();
  for (const a of achievementRows) {
    if (a.project_detail_id) achievementsPerDetail.set(a.project_detail_id, (achievementsPerDetail.get(a.project_detail_id) ?? 0) + 1);
  }
  const detailStats = new Map<string, { total: number; complete: number }>();
  for (const d of detailRows) {
    const s = detailStats.get(d.project_id) ?? { total: 0, complete: 0 };
    s.total += 1;
    if (d.status === "complete") s.complete += 1;
    detailStats.set(d.project_id, s);
  }
  const skillsPerProject = new Map<string, string[]>();
  const projectsPerSkill = new Map<string, number>();
  for (const l of linkRows) {
    skillsPerProject.set(l.project_id, [...(skillsPerProject.get(l.project_id) ?? []), l.skill_id]);
    projectsPerSkill.set(l.skill_id, (projectsPerSkill.get(l.skill_id) ?? 0) + 1);
  }

  const tree = {
    experiences: (experiences.data ?? []).map(toExperienceDto),
    educations: (educations.data ?? []).map(toEducationDto),
    projects: (projects.data ?? []).map((p) => {
      const s = detailStats.get(p.id);
      return toProjectDto(p, {
        skillIds: skillsPerProject.get(p.id) ?? [],
        detailCount: s?.total ?? 0,
        completeDetailCount: s?.complete ?? 0,
      });
    }),
    projectDetails: detailRows.map((d) => toProjectDetailDto(d, achievementsPerDetail.get(d.id) ?? 0)),
    achievements: achievementRows.map(toAchievementDto),
    skills: (skills.data ?? []).map((s) => toSkillDto(s, projectsPerSkill.get(s.id) ?? 0)),
  };

  return {
    ...tree,
    years: groupCareerByYear(tree, currentYearInSeoul(now)),
    summary: summarizeCareer(tree),
    isEmpty: tree.experiences.length === 0 && tree.educations.length === 0 && tree.projects.length === 0,
  };
}
