import {
  dateToYearMonth,
  yearMonthToDate,
  type AchievementDto,
  type EducationDto,
  type ExperienceDto,
  type ProjectDetailDto,
  type ProjectDto,
  type SaveAchievementPatch,
  type SaveEducationPatch,
  type SaveExperiencePatch,
  type SaveProjectDetailPatch,
  type SaveProjectPatch,
  type SkillDto,
} from "@/lib/contracts/career";
import type { AchievementKind, CareerStatus, EducationType, EmploymentType, EnrollmentStatus, SkillProficiency } from "@/lib/contracts/enums";
import type { Database } from "@/server/db/database.types";

/** Row ↔ DTO / patch ↔ column mapping for the seven career tables. Pure. */

type Tables = Database["public"]["Tables"];
export type ExperienceRow = Tables["experiences"]["Row"];
export type EducationRow = Tables["educations"]["Row"];
export type ProjectRow = Tables["projects"]["Row"];
export type ProjectDetailRow = Tables["project_details"]["Row"];
export type AchievementRow = Tables["achievements"]["Row"];
export type SkillRow = Tables["skills"]["Row"];
export type ProjectSkillRow = Tables["project_skills"]["Row"];

// Explicit column lists: never `select *` (app_ai_writer reuses some of these and has column grants).
export const EXPERIENCE_COLUMNS =
  "id, status, company_name, start_month, end_month, is_current, job_rank, job_position, department, employment_type, summary, created_at, updated_at" as const;
export const EDUCATION_COLUMNS =
  "id, status, institution_name, education_type, program_name, start_month, end_month, enrollment_status, description, created_at, updated_at" as const;
export const PROJECT_COLUMNS =
  "id, status, experience_id, education_id, name, role, summary, start_month, end_month, team_size, source_writing_chat_id, created_at, updated_at" as const;
export const PROJECT_DETAIL_COLUMNS =
  "id, project_id, status, title, situation, task, action, result, learnings, sort_order, source_writing_chat_id, created_at, updated_at" as const;
export const ACHIEVEMENT_COLUMNS =
  "id, status, project_detail_id, experience_id, metric_name, value_before, value_after, unit, description, kind, source_writing_chat_id, created_at, updated_at" as const;
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
export type ProjectDetailSelect = Omit<ProjectDetailRow, "user_id">;
export type AchievementSelect = Omit<AchievementRow, "user_id">;
export type SkillSelect = Omit<SkillRow, "user_id">;

export function toProjectDto(
  r: ProjectSelect,
  rel: { skillIds: string[]; detailCount: number; completeDetailCount: number } = {
    skillIds: [],
    detailCount: 0,
    completeDetailCount: 0,
  },
): ProjectDto {
  return {
    id: r.id,
    status: r.status as CareerStatus,
    experienceId: r.experience_id,
    educationId: r.education_id,
    name: r.name,
    role: r.role,
    summary: r.summary,
    startMonth: month(r.start_month),
    endMonth: month(r.end_month),
    teamSize: r.team_size,
    sourceWritingChatId: r.source_writing_chat_id,
    skillIds: rel.skillIds,
    detailCount: rel.detailCount,
    completeDetailCount: rel.completeDetailCount,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const filled = (v: string | null) => v !== null && v.trim() !== "";

export function toProjectDetailDto(r: ProjectDetailSelect, achievementCount = 0): ProjectDetailDto {
  return {
    id: r.id,
    projectId: r.project_id,
    status: r.status as CareerStatus,
    title: r.title,
    situation: r.situation,
    task: r.task,
    action: r.action,
    result: r.result,
    learnings: r.learnings,
    sortOrder: r.sort_order,
    sourceWritingChatId: r.source_writing_chat_id,
    filled: {
      situation: filled(r.situation),
      task: filled(r.task),
      action: filled(r.action),
      result: filled(r.result),
      learnings: filled(r.learnings),
    },
    achievementCount,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toAchievementDto(r: AchievementSelect): AchievementDto {
  return {
    id: r.id,
    status: r.status as CareerStatus,
    projectDetailId: r.project_detail_id,
    experienceId: r.experience_id,
    metricName: r.metric_name,
    valueBefore: r.value_before,
    valueAfter: r.value_after,
    unit: r.unit,
    description: r.description,
    kind: (r.kind ?? "qualitative") as AchievementKind,
    sourceWritingChatId: r.source_writing_chat_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
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
type ProjectDetailWrite = Tables["project_details"]["Update"];
type AchievementWrite = Tables["achievements"]["Update"];

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

/** The affiliation always writes both columns, so switching never violates projects_affiliation_check. */
export function toProjectColumns(p: SaveProjectPatch): ProjectWrite {
  const out: ProjectWrite = {};
  if (p.affiliation) {
    out.experience_id = p.affiliation.type === "experience" ? p.affiliation.id : null;
    out.education_id = p.affiliation.type === "education" ? p.affiliation.id : null;
  }
  put(out, "name", p.name);
  put(out, "role", p.role);
  put(out, "summary", p.summary);
  put(out, "start_month", toDate(p.startMonth));
  put(out, "end_month", toDate(p.endMonth));
  put(out, "team_size", p.teamSize);
  return out;
}

export function toProjectDetailColumns(p: SaveProjectDetailPatch): ProjectDetailWrite {
  const out: ProjectDetailWrite = {};
  put(out, "title", p.title);
  put(out, "situation", p.situation);
  put(out, "task", p.task);
  put(out, "action", p.action);
  put(out, "result", p.result);
  put(out, "learnings", p.learnings);
  return out;
}

export function toAchievementColumns(p: SaveAchievementPatch): AchievementWrite {
  const out: AchievementWrite = {};
  put(out, "metric_name", p.metricName);
  put(out, "value_before", p.valueBefore);
  put(out, "value_after", p.valueAfter);
  put(out, "unit", p.unit);
  put(out, "description", p.description);
  return out;
}
