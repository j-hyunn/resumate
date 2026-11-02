import {
  dateToYearMonth,
  yearMonthToDate,
  type DeliverableDto,
  type DeliverableSummaryDto,
  type EducationDto,
  type ExperienceDto,
  type ProjectCardDto,
  type ProjectDto,
  type SaveDeliverablePatch,
  type SaveEducationPatch,
  type SaveExperiencePatch,
  type SaveProjectPatch,
  type SkillDto,
} from "@/lib/contracts/career";
import type { CareerStatus, Competency, EducationType, EmploymentType, EnrollmentStatus, ExperienceType, ProjectType, SkillProficiency } from "@/lib/contracts/enums";
import type { Database } from "@/server/db/database.types";

/** Row ↔ DTO / patch ↔ column mapping for the career tables (DM v4.4). Pure. */

type Tables = Database["public"]["Tables"];
export type ExperienceRow = Tables["experiences"]["Row"];
export type EducationRow = Tables["educations"]["Row"];
export type ProjectRow = Tables["projects"]["Row"];
export type DeliverableRow = Tables["project_deliverables"]["Row"];
export type SkillRow = Tables["skills"]["Row"];
export type ProjectSkillRow = Tables["project_skills"]["Row"];

// Explicit column lists: never `select *` (app_ai_writer reuses some of these and has column grants).
export const EXPERIENCE_COLUMNS =
  "id, status, company_name, start_month, end_month, is_current, job_rank, job_position, department, employment_type, summary, created_at, updated_at" as const;
export const EDUCATION_COLUMNS =
  "id, status, institution_name, education_type, program_name, start_month, end_month, enrollment_status, description, created_at, updated_at" as const;
export const PROJECT_COLUMNS =
  "id, status, experience_id, education_id, name, start_month, end_month, is_current, project_type, experience_type, competencies, situation, task, action, result, learnings, role, description, link_url, source_writing_chat_id, content_updated_at, created_at, updated_at" as const;
/** S-09 / S-34 project cards (DM §7: id, name, project_type, start_month, end_month, is_current). */
export const PROJECT_CARD_COLUMNS = "id, status, name, project_type, start_month, end_month, is_current, created_at" as const;
/** S-43 list: body excluded (DM §7). */
export const DELIVERABLE_SUMMARY_COLUMNS = "id, project_id, title, sort_order, updated_at" as const;
export const DELIVERABLE_COLUMNS = "id, project_id, title, body, sort_order, created_at, updated_at" as const;
export const SKILL_COLUMNS = "id, name, normalized_name, is_manual, proficiency, created_at, updated_at" as const;
export const PROJECT_SKILL_COLUMNS = "project_id, skill_id, created_at" as const;
/** created_at lets a retried create tell "never edited" (updated_at = created_at) apart (QA-S2-08). */
export const SAVE_RESULT_COLUMNS = "id, status, created_at, updated_at" as const;

const month = (d: string | null) => dateToYearMonth(d);
const toDate = (ym: string | null | undefined) => (ym === undefined ? undefined : ym === null ? null : yearMonthToDate(ym));

/** Sets `out[key] = value` only when the patch carried the key. */
function put<T extends object, K extends keyof T>(out: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) out[key] = value;
}

// ---------- rows → DTO ----------

export function toExperienceDto(r: ExperienceSelect): ExperienceDto {
  return {
    id: r.id,
    status: r.status as CareerStatus,
    companyName: r.company_name,
    startMonth: month(r.start_month),
    endMonth: month(r.end_month),
    isCurrent: r.is_current,
    jobRank: r.job_rank,
    jobPosition: r.job_position,
    department: r.department,
    employmentType: r.employment_type as EmploymentType | null,
    summary: r.summary,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toEducationDto(r: EducationSelect): EducationDto {
  return {
    id: r.id,
    status: r.status as CareerStatus,
    institutionName: r.institution_name,
    educationType: r.education_type as EducationType | null,
    programName: r.program_name,
    startMonth: month(r.start_month),
    endMonth: month(r.end_month),
    enrollmentStatus: r.enrollment_status as EnrollmentStatus | null,
    description: r.description,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type ExperienceSelect = Omit<ExperienceRow, "user_id">;
export type EducationSelect = Omit<EducationRow, "user_id">;
export type ProjectSelect = Omit<ProjectRow, "user_id">;
export type SkillSelect = Omit<SkillRow, "user_id">;

/** affiliated (experience / education) vs standalone (DM-20). */
export function projectScope(r: { experience_id: string | null; education_id: string | null }): "affiliated" | "standalone" {
  return r.experience_id || r.education_id ? "affiliated" : "standalone";
}

export function toProjectDto(r: ProjectSelect): ProjectDto {
  return {
    id: r.id,
    status: r.status as CareerStatus,
    scope: projectScope(r),
    experienceId: r.experience_id,
    educationId: r.education_id,
    name: r.name,
    startMonth: month(r.start_month),
    endMonth: month(r.end_month),
    isCurrent: r.is_current,
    projectType: r.project_type as ProjectType | null,
    experienceType: r.experience_type as ExperienceType | null,
    competencies: (r.competencies ?? []) as Competency[],
    situation: r.situation,
    task: r.task,
    action: r.action,
    result: r.result,
    learnings: r.learnings,
    sourceWritingChatId: r.source_writing_chat_id,
    role: r.role,
    description: r.description,
    linkUrl: r.link_url,
    contentUpdatedAt: r.content_updated_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type ProjectCardSelect = Pick<ProjectRow, "id" | "status" | "name" | "project_type" | "start_month" | "end_month" | "is_current" | "created_at">;

export function toProjectCardDto(r: ProjectCardSelect): ProjectCardDto {
  return {
    id: r.id,
    status: r.status as CareerStatus,
    name: r.name,
    projectType: r.project_type as ProjectType | null,
    startMonth: month(r.start_month),
    endMonth: month(r.end_month),
    isCurrent: r.is_current,
  };
}

/** S-09 / S-34 card order (DM §7 [가정]): start_month desc nulls last, then created_at desc. */
export function compareProjectCards(a: ProjectCardSelect, b: ProjectCardSelect): number {
  const sa = a.start_month;
  const sb = b.start_month;
  if (sa !== sb) {
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sa < sb ? 1 : -1;
  }
  return b.created_at.localeCompare(a.created_at);
}

export function toDeliverableSummaryDto(r: Pick<DeliverableRow, "id" | "project_id" | "title" | "sort_order" | "updated_at">): DeliverableSummaryDto {
  return { id: r.id, projectId: r.project_id, title: r.title, sortOrder: r.sort_order, updatedAt: r.updated_at };
}

export function toDeliverableDto(r: Omit<DeliverableRow, "user_id">): DeliverableDto {
  return { ...toDeliverableSummaryDto(r), body: r.body, createdAt: r.created_at };
}

export function toSkillDto(r: SkillSelect, projectCount = 0): SkillDto {
  return {
    id: r.id,
    name: r.name,
    normalizedName: r.normalized_name ?? r.name.toLowerCase(),
    isManual: r.is_manual,
    proficiency: r.proficiency as SkillProficiency | null,
    projectCount,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---------- patch → columns ----------

type ExperienceWrite = Tables["experiences"]["Update"];
type EducationWrite = Tables["educations"]["Update"];
type ProjectWrite = Tables["projects"]["Update"];
type DeliverableWrite = Tables["project_deliverables"]["Update"];
/**
 * `isCurrent: true` without an explicit endMonth also clears end_month, so a
 * partial save can't trip `experiences_is_current_check` against the stored value.
 */
export function toExperienceColumns(p: SaveExperiencePatch): ExperienceWrite {
  const out: ExperienceWrite = {};
  put(out, "company_name", p.companyName);
  put(out, "start_month", toDate(p.startMonth));
  put(out, "end_month", toDate(p.endMonth));
  put(out, "is_current", p.isCurrent);
  put(out, "job_rank", p.jobRank);
  put(out, "job_position", p.jobPosition);
  put(out, "department", p.department);
  put(out, "employment_type", p.employmentType);
  put(out, "summary", p.summary);
  if (p.isCurrent === true && p.endMonth === undefined) out.end_month = null;
  return out;
}

/** Same idea for `enrollment_status = 'enrolled'` (educations_enrolled_end_month_check). */
export function toEducationColumns(p: SaveEducationPatch): EducationWrite {
  const out: EducationWrite = {};
  put(out, "institution_name", p.institutionName);
  put(out, "education_type", p.educationType);
  put(out, "program_name", p.programName);
  put(out, "start_month", toDate(p.startMonth));
  put(out, "end_month", toDate(p.endMonth));
  put(out, "enrollment_status", p.enrollmentStatus);
  put(out, "description", p.description);
  if (p.enrollmentStatus === "enrolled" && p.endMonth === undefined) out.end_month = null;
  return out;
}

/**
 * Section save → columns (DM §7 v4.4). The affiliation writes both columns (experience ↔ education
 * move; `none` is sent as both null and the DB trigger refuses a scope change). `isCurrent: true`
 * without an explicit endMonth clears end_month (projects_is_current_check, CR-22).
 */
export function toProjectColumns(p: SaveProjectPatch): ProjectWrite {
  const out: ProjectWrite = {};
  if (p.affiliation) {
    out.experience_id = p.affiliation.type === "experience" ? p.affiliation.id : null;
    out.education_id = p.affiliation.type === "education" ? p.affiliation.id : null;
  }
  put(out, "name", p.name);
  put(out, "start_month", toDate(p.startMonth));
  put(out, "end_month", toDate(p.endMonth));
  put(out, "is_current", p.isCurrent);
  put(out, "project_type", p.projectType);
  put(out, "experience_type", p.experienceType);
  put(out, "competencies", p.competencies);
  put(out, "situation", p.situation);
  put(out, "task", p.task);
  put(out, "action", p.action);
  put(out, "result", p.result);
  put(out, "learnings", p.learnings);
  put(out, "role", p.role);
  put(out, "description", p.description);
  put(out, "link_url", p.linkUrl);
  if (p.isCurrent === true && p.endMonth === undefined) out.end_month = null;
  return out;
}

export function toDeliverableColumns(p: SaveDeliverablePatch): DeliverableWrite {
  const out: DeliverableWrite = {};
  put(out, "title", p.title);
  put(out, "body", p.body);
  return out;
}
