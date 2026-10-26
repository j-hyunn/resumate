import type { Database } from "@/server/db/database.types";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import { AppError } from "@/lib/contracts/errors";

/**
 * Career rows for the Career Context Pack (C-1), read as app_ai_writer.
 * Columns are listed explicitly: app_ai_writer has column grants, and
 * `select *` fails (S1 rule). `display_name` is never read (C-1, C-7).
 */

type Tables = Database["public"]["Tables"];
type Row<T extends keyof Tables> = Tables[T]["Row"];

export const PROFILE_COLUMNS = "id, desired_job_title, total_years_of_experience, interested_industries, updated_at" as const;
export const EXPERIENCE_COLUMNS =
  "id, status, company_name, start_month, end_month, is_current, job_rank, job_position, department, employment_type, summary, created_at, updated_at" as const;
export const EDUCATION_COLUMNS =
  "id, status, institution_name, education_type, program_name, start_month, end_month, enrollment_status, description, created_at, updated_at" as const;
export const PROJECT_COLUMNS =
  "id, status, experience_id, education_id, name, start_month, end_month, role, team_size, summary, created_at, updated_at" as const;
export const PROJECT_DETAIL_COLUMNS =
  "id, status, project_id, title, situation, task, action, result, learnings, sort_order, created_at, updated_at" as const;
export const ACHIEVEMENT_COLUMNS =
  "id, status, project_detail_id, experience_id, kind, metric_name, value_before, value_after, unit, description, created_at, updated_at" as const;
export const SKILL_COLUMNS = "id, name, normalized_name, is_manual, created_at, updated_at" as const;
export const PROJECT_SKILL_COLUMNS = "project_id, skill_id" as const;

export type ProfileRow = Pick<Row<"profiles">, "id" | "desired_job_title" | "total_years_of_experience" | "interested_industries" | "updated_at">;
export type ExperienceRow = Pick<
  Row<"experiences">,
  | "id"
  | "status"
  | "company_name"
  | "start_month"
  | "end_month"
  | "is_current"
  | "job_rank"
  | "job_position"
  | "department"
  | "employment_type"
  | "summary"
  | "created_at"
  | "updated_at"
>;
export type EducationRow = Pick<
  Row<"educations">,
  | "id"
  | "status"
  | "institution_name"
  | "education_type"
  | "program_name"
  | "start_month"
  | "end_month"
  | "enrollment_status"
  | "description"
  | "created_at"
  | "updated_at"
>;
export type ProjectRow = Pick<
  Row<"projects">,
  | "id"
  | "status"
  | "experience_id"
  | "education_id"
  | "name"
  | "start_month"
  | "end_month"
  | "role"
  | "team_size"
  | "summary"
  | "created_at"
  | "updated_at"
>;
export type ProjectDetailRow = Pick<
  Row<"project_details">,
  "id" | "status" | "project_id" | "title" | "situation" | "task" | "action" | "result" | "learnings" | "sort_order" | "created_at" | "updated_at"
>;
export type AchievementRow = Pick<
  Row<"achievements">,
  | "id"
  | "status"
  | "project_detail_id"
  | "experience_id"
  | "kind"
  | "metric_name"
  | "value_before"
  | "value_after"
  | "unit"
  | "description"
  | "created_at"
  | "updated_at"
>;
export type SkillRow = Pick<Row<"skills">, "id" | "name" | "normalized_name" | "is_manual" | "created_at" | "updated_at">;
export type ProjectSkillRow = Pick<Row<"project_skills">, "project_id" | "skill_id">;

export type CareerRows = {
  profile: ProfileRow | null;
  experiences: ExperienceRow[];
  educations: EducationRow[];
  projects: ProjectRow[];
  projectDetails: ProjectDetailRow[];
  achievements: AchievementRow[];
  skills: SkillRow[];
  projectSkills: ProjectSkillRow[];
};

/**
 * Loads the signed-in user's career rows (RLS scopes them via the JWT `sub`).
 * Only `complete` rows of status-bearing tables are fetched; the pack builder
 * then drops children of non-complete parents.
 */
export async function loadCareerRows(db: AiWriterSupabaseClient): Promise<CareerRows> {
  const [profile, experiences, educations, projects, projectDetails, achievements, skills, projectSkills] = await Promise.all([
    db.from("profiles").select(PROFILE_COLUMNS).maybeSingle(),
    db.from("experiences").select(EXPERIENCE_COLUMNS).eq("status", "complete"),
    db.from("educations").select(EDUCATION_COLUMNS).eq("status", "complete"),
    db.from("projects").select(PROJECT_COLUMNS).eq("status", "complete"),
    db.from("project_details").select(PROJECT_DETAIL_COLUMNS).eq("status", "complete"),
    db.from("achievements").select(ACHIEVEMENT_COLUMNS).eq("status", "complete"),
    db.from("skills").select(SKILL_COLUMNS),
    db.from("project_skills").select(PROJECT_SKILL_COLUMNS),
  ]);
  for (const result of [profile, experiences, educations, projects, projectDetails, achievements, skills, projectSkills]) {
    if (result.error) throw new AppError("internal_error", undefined, { cause: result.error });
  }
  return {
    profile: profile.data ?? null,
    experiences: experiences.data ?? [],
    educations: educations.data ?? [],
    projects: projects.data ?? [],
    projectDetails: projectDetails.data ?? [],
    achievements: achievements.data ?? [],
    skills: skills.data ?? [],
    projectSkills: projectSkills.data ?? [],
  };
}
