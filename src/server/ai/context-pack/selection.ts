import type { AliasEntry, AliasMap } from "./aliases";
import type { CareerRows } from "./career-rows";

/**
 * Document source selection helpers (S7: AI-03 포함 항목, AI-04 사용한 경력·프로젝트,
 * AI-11 기본 선택). Pure functions over career rows and pack alias maps.
 */

/** AI-03 card: "프로젝트 최대 8개" [가정]; AI-11 includes at most 8 as well. */
export const MAX_DRAFT_PROJECTS = 8;

export type DraftSourceSelection = {
  includedProjectIds: string[];
  /** Every pack project: the order the screen lists them in (included first). */
  projectOrder: string[];
  includedExperienceIds: string[];
  includedEducationIds: string[];
};

/** Pack projects in pack order (experience → education → other; latest first), with their parent. */
export function packProjects(aliases: AliasMap): Array<{ id: string; alias: string; parent: AliasEntry | null; entry: AliasEntry }> {
  const out: Array<{ id: string; alias: string; parent: AliasEntry | null; entry: AliasEntry }> = [];
  for (const entry of aliases.values()) {
    if (entry.sourceType !== "project") continue;
    const parentAlias = entry.parents[0];
    out.push({ id: entry.id, alias: entry.alias, entry, parent: parentAlias ? (aliases.get(parentAlias) ?? null) : null });
  }
  return out;
}

/** Included experiences/educations derived from included projects (AI-11 card: "소속 프로젝트에서 서버가 파생"), pack order. */
export function deriveSelection(aliases: AliasMap, includedProjectIds: readonly string[], restOrder?: readonly string[]): DraftSourceSelection {
  const projects = packProjects(aliases);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const included = includedProjectIds.filter((id, i) => byId.has(id) && includedProjectIds.indexOf(id) === i).slice(0, MAX_DRAFT_PROJECTS);
  const includedSet = new Set(included);
  const rest = (restOrder ?? projects.map((p) => p.id)).filter((id) => byId.has(id) && !includedSet.has(id));
  const restSet = new Set(rest);
  const tail = projects.map((p) => p.id).filter((id) => !includedSet.has(id) && !restSet.has(id));
  const parents = projects.filter((p) => includedSet.has(p.id) && p.parent).map((p) => p.parent as AliasEntry);
  const ordered = (type: "experience" | "education") => {
    const ids = new Set(parents.filter((p) => p.sourceType === type).map((p) => p.id));
    return [...aliases.values()].filter((e) => e.sourceType === type && ids.has(e.id)).map((e) => e.id);
  };
  return {
    includedProjectIds: included,
    projectOrder: [...included, ...rest, ...tail],
    includedExperienceIds: ordered("experience"),
    includedEducationIds: ordered("education"),
  };
}

/** "최신 경력순 전체 선택" (AI-03 기본 선택 (3), AI-11 실패 시): pack order, at most 8. */
export function fallbackSelectionFromAliases(aliases: AliasMap): DraftSourceSelection {
  return deriveSelection(aliases, packProjects(aliases).map((p) => p.id));
}

/** Insight `strategy.project_priorities` (AI-03 기본 선택 (1)): by rank; projects gone from the pack are skipped. */
export function selectionFromPrioritiesWithAliases(aliases: AliasMap, priorities: ReadonlyArray<{ project_id: string; rank: number }>): DraftSourceSelection {
  const ids = [...priorities].sort((a, b) => a.rank - b.rank).map((p) => p.project_id);
  return deriveSelection(aliases, ids);
}

/**
 * Career rows narrowed to a selection (AI-03 "선택한 경력·프로젝트와 그 성과·스킬만",
 * AI-04 user mode). `experienceIds`/`educationIds` are included as headers
 * (their own fields and experience-level achievements); only `projectIds`
 * come with them, unless the parent is in `whole*Ids` (all its projects).
 * Parents of selected projects are added. Skills: those tagged on included projects.
 * The profile always stays.
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
  const details = rows.projectDetails.filter((d) => projectIds.has(d.project_id));
  const detailIds = new Set(details.map((d) => d.id));
  const links = rows.projectSkills.filter((l) => projectIds.has(l.project_id));
  const skillIds = new Set(links.map((l) => l.skill_id));
  return {
    profile: rows.profile,
    experiences: rows.experiences.filter((e) => expIds.has(e.id)),
    educations: rows.educations.filter((e) => eduIds.has(e.id)),
    projects,
    projectDetails: details,
    achievements: rows.achievements.filter((a) =>
      a.project_detail_id ? detailIds.has(a.project_detail_id) : a.experience_id ? expIds.has(a.experience_id) : false,
    ),
    skills: rows.skills.filter((s) => skillIds.has(s.id)),
    projectSkills: links,
  };
}

/** "회사명 › 프로젝트명" label for a source (C-11 표시, draft_section_sources.source_label). */
export function sourceLabel(aliases: AliasMap, refs: { projectAlias: string | null; parentAlias: string | null }): string {
  const parent = refs.parentAlias ? aliases.get(refs.parentAlias) : undefined;
  const project = refs.projectAlias ? aliases.get(refs.projectAlias) : undefined;
  return [parent?.label, project?.label].filter((v): v is string => !!v && v.trim() !== "").join(" › ");
}
