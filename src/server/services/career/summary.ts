import type {
  CareerSummary,
  EducationDto,
  ExperienceDto,
  ProjectDetailDto,
  ProjectDto,
  SkillDto,
} from "@/lib/contracts/career";

/**
 * S-08 top summary (F-P1-07 축소판 [가정]): plain status counts plus two
 * rule-based hints. Not the AI pack inclusion rule — that is get_data_readiness.
 */
export function summarizeCareer(parts: {
  experiences: readonly Pick<ExperienceDto, "status">[];
  educations: readonly Pick<EducationDto, "status">[];
  projects: readonly Pick<ProjectDto, "status" | "completeDetailCount">[];
  projectDetails: readonly Pick<ProjectDetailDto, "status" | "result">[];
  skills: readonly Pick<SkillDto, "id">[];
}): CareerSummary {
  const countBy = (rows: readonly { status: string }[], status: string) => rows.filter((r) => r.status === status).length;
  return {
    completeCounts: {
      experiences: countBy(parts.experiences, "complete"),
      educations: countBy(parts.educations, "complete"),
      projects: countBy(parts.projects, "complete"),
      projectDetails: countBy(parts.projectDetails, "complete"),
    },
    draftCounts: {
      experiences: countBy(parts.experiences, "draft"),
      educations: countBy(parts.educations, "draft"),
      projects: countBy(parts.projects, "draft"),
      projectDetails: countBy(parts.projectDetails, "draft"),
    },
    detailsWithoutResult: parts.projectDetails.filter((d) => d.result === null).length,
    projectsWithoutCompleteDetail: parts.projects.filter((p) => p.completeDetailCount === 0).length,
    skillCount: parts.skills.length,
  };
}
