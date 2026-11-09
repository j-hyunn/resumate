import type { AliasMap } from "./aliases";
import type { CareerRows } from "./career-rows";

/**
 * Document source selection helpers (AI-04 문항 근거: 사용자가 고른 경력·프로젝트).
 * Pure functions over career rows and pack alias maps.
 *
 * (R15, CF-1) The 경력기술서 helpers (`MAX_DRAFT_PROJECTS`, `packProjects`,
 * `deriveSelection`, `selectionFromPrioritiesWithAliases`) went with AI-03·AI-11.
 */

/**
 * Career rows narrowed to a selection (AI-04 사용자 지정 근거; v4.5: affiliated
 * STAR, standalone role/description/skills/deliverables). `experienceIds`/`educationIds` are included as headers (their own
 * fields); only `projectIds`
 * come with them, unless the parent is in `whole*Ids` (all its projects).
 * Parents of selected projects are added. Skills: those tagged on included projects.
 * The server-computed total experience always stays (C-1, SD-2).
 */
export function filterCareerRows(
  rows: CareerRows,
  selection: {
    experienceIds?: readonly string[];
    educationIds?: readonly string[];
    projectIds?: readonly string[];
    wholeExperienceIds?: readonly string[];
    wholeEducationIds?: readonly string[];
  },
): CareerRows {
  const wholeExp = new Set(selection.wholeExperienceIds ?? []);
  const wholeEdu = new Set(selection.wholeEducationIds ?? []);
  const projectSet = new Set(selection.projectIds ?? []);
  const projects = rows.projects.filter(
    (p) => projectSet.has(p.id) || (p.experience_id !== null && wholeExp.has(p.experience_id)) || (p.education_id !== null && wholeEdu.has(p.education_id)),
  );
  const expIds = new Set([...(selection.experienceIds ?? []), ...wholeExp, ...projects.map((p) => p.experience_id).filter((v): v is string => !!v)]);
  const eduIds = new Set([...(selection.educationIds ?? []), ...wholeEdu, ...projects.map((p) => p.education_id).filter((v): v is string => !!v)]);
  const projectIds = new Set(projects.map((p) => p.id));
  const links = rows.projectSkills.filter((l) => projectIds.has(l.project_id));
  const skillIds = new Set(links.map((l) => l.skill_id));
  return {
    totalExperience: rows.totalExperience,
    experiences: rows.experiences.filter((e) => expIds.has(e.id)),
    educations: rows.educations.filter((e) => eduIds.has(e.id)),
    projects,
    // C-1.1 기능별 포함 범위: deliverables of selected standalone projects only.
    deliverables: rows.deliverables.filter((d) => projectIds.has(d.project_id)),
    skills: rows.skills.filter((s) => skillIds.has(s.id)),
    projectSkills: links,
  };
}

/** "회사명 › 프로젝트명" label for a source (C-11 표시, 근거 카드 `sources_selected`). */
export function sourceLabel(aliases: AliasMap, refs: { projectAlias: string | null; parentAlias: string | null }): string {
  const parent = refs.parentAlias ? aliases.get(refs.parentAlias) : undefined;
  const project = refs.projectAlias ? aliases.get(refs.projectAlias) : undefined;
  return [parent?.label, project?.label].filter((v): v is string => !!v && v.trim() !== "").join(" › ");
}
