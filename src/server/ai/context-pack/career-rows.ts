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
/** v4.4 projects (DM 2.3): STAR + classification on affiliated rows, role/description on standalone rows. link_url is never read (C-1). */
export const PROJECT_COLUMNS =
  "id, status, experience_id, education_id, name, start_month, end_month, is_current, project_type, experience_type, competencies, situation, task, action, result, learnings, role, description, content_updated_at, created_at, updated_at" as const;
/** v4.4 project_deliverables (DM 2.3, CR-8). */
export const DELIVERABLE_COLUMNS = "id, project_id, title, body, sort_order, created_at, updated_at" as const;
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
/**
 * Written out (not Pick<Row<"projects">>) so the pack does not depend on the
 * generated types' exact nullability; the loader's rows are assignable to it.
 */
export type ProjectRow = {
  id: string;
  status: string;
  experience_id: string | null;
  education_id: string | null;
  name: string;
  start_month: string | null;
  end_month: string | null;
  /** CR-22: "진행 중" (CHECK: NOT is_current OR end_month IS NULL). */
  is_current: boolean;
  /** CR-9 classification (affiliated only). Reference only, never evidence (C-1.2). */
  project_type: string | null;
  experience_type: string | null;
  competencies: string[];
  /** STAR (affiliated only, CR-2). `task` = 화면 "역할", `result` = "결과/성과", `learnings` = "배운 점". */
  situation: string | null;
  task: string | null;
  action: string | null;
  result: string | null;
  learnings: string | null;
  /** Standalone only (CR-7): 담당 업무 / 프로젝트 내용. */
  role: string | null;
  description: string | null;
  /** Evidence "변경됨" baseline (DM 2.8): changes only with citable fields. */
  content_updated_at: string;
  created_at: string;
  updated_at: string;
};
export type DeliverableRow = {
  id: string;
  project_id: string;
  title: string;
  /** Raw markdown (≤ 20,000 chars); the pack gets normalized text (C-1.1). */
  body: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};
export type SkillRow = Pick<Row<"skills">, "id" | "name" | "normalized_name" | "is_manual" | "created_at" | "updated_at">;
export type ProjectSkillRow = Pick<Row<"project_skills">, "project_id" | "skill_id">;

export type CareerRows = {
  profile: ProfileRow | null;
  experiences: ExperienceRow[];
  educations: EducationRow[];
  projects: ProjectRow[];
  /** v4.4: deliverables of standalone projects (no status; included with a complete parent). */
  deliverables: DeliverableRow[];
  skills: SkillRow[];
  projectSkills: ProjectSkillRow[];
};

/**
 * Loads the signed-in user's career rows (RLS scopes them via the JWT `sub`).
 * Only `complete` rows of status-bearing tables are fetched; the pack builder
 * then drops children of non-complete parents (deliverables have no status).
 */
export async function loadCareerRows(db: AiWriterSupabaseClient): Promise<CareerRows> {
  const [profile, experiences, educations, projects, deliverables, skills, projectSkills] = await Promise.all([
    db.from("profiles").select(PROFILE_COLUMNS).maybeSingle(),
    db.from("experiences").select(EXPERIENCE_COLUMNS).eq("status", "complete"),
    db.from("educations").select(EDUCATION_COLUMNS).eq("status", "complete"),
    db.from("projects").select(PROJECT_COLUMNS).eq("status", "complete"),
    db.from("project_deliverables").select(DELIVERABLE_COLUMNS),
    db.from("skills").select(SKILL_COLUMNS),
    db.from("project_skills").select(PROJECT_SKILL_COLUMNS),
  ]);
  for (const result of [profile, experiences, educations, projects, deliverables, skills, projectSkills]) {
    if (result.error) throw new AppError("internal_error", undefined, { cause: result.error });
  }
  return {
    profile: profile.data ?? null,
    experiences: experiences.data ?? [],
    educations: educations.data ?? [],
    projects: projects.data ?? [],
    deliverables: deliverables.data ?? [],
    skills: skills.data ?? [],
    projectSkills: projectSkills.data ?? [],
  };
}
