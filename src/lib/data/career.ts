/**
 * 커리어 data layer (experiences, educations, projects, project_details, achievements,
 * skills, project_skills, profiles). Server only — call from Server Components or from
 * server actions. Backed by src/lib/mock; swap the bodies for Supabase queries later.
 *
 * Writes follow DM-8: saving never fails validation; `status` is recomputed on every save
 * ('draft' while required fields are missing). Parent project status follows its details.
 */
import type {
  Achievement,
  Education,
  Experience,
  Profile,
  Project,
  ProjectDetail,
  Skill,
  WritingChat,
} from "@/types/db"
import { clone, mockRequest } from "@/lib/mock/store"
import type { MockDb } from "@/lib/mock/fixtures"
import { newId, USER_ID } from "@/lib/mock/ids"

// ---------------------------------------------------------------------------
// completion rules (04 §2.2)
// ---------------------------------------------------------------------------

export function isExperienceComplete(e: Pick<Experience, "company_name" | "start_month" | "job_rank" | "job_position">) {
  return Boolean(e.company_name && e.start_month && (e.job_rank || e.job_position))
}
export function isEducationComplete(e: Pick<Education, "institution_name" | "education_type" | "start_month">) {
  return Boolean(e.institution_name && e.education_type && e.start_month)
}
export function isDetailComplete(d: Pick<ProjectDetail, "title" | "situation" | "action">) {
  return Boolean(d.title && d.situation && d.action)
}
export function isAchievementComplete(a: Pick<Achievement, "description" | "metric_name" | "value_before" | "value_after">) {
  return Boolean(a.description || (a.metric_name && (a.value_before !== null || a.value_after !== null)))
}

function recomputeProjectStatus(db: MockDb, projectId: string) {
  const project = db.projects.find((p) => p.id === projectId)
  if (!project) return
  const hasCompleteDetail = db.project_details.some((d) => d.project_id === projectId && d.status === "complete")
  project.status = project.name && project.role && hasCompleteDetail ? "complete" : "draft"
}

function touchCareer(db: MockDb) {
  const profile = db.profiles[0]
  if (profile) profile.career_data_updated_at = new Date().toISOString()
}

function stamp<T extends { updated_at: string }>(row: T): T {
  row.updated_at = new Date().toISOString()
  return row
}

function baseRow() {
  const now = new Date().toISOString()
  return { id: newId(), user_id: USER_ID, created_at: now, updated_at: now }
}

/** Mock write failure switch for ST-SAVE-FAILED previews: pass `{ fail: true }`. */
export interface WriteOptions {
  fail?: boolean
}
export class SaveFailedError extends Error {
  constructor() {
    super("save failed (mock)")
  }
}
function maybeFail(opts?: WriteOptions) {
  if (opts?.fail) throw new SaveFailedError()
}

// ---------------------------------------------------------------------------
// profile (S-04)
// ---------------------------------------------------------------------------

export async function getProfile(): Promise<Profile> {
  const db = await mockRequest()
  return clone(db.profiles[0])
}

export async function updateProfile(
  patch: Partial<Pick<Profile, "display_name" | "desired_job_title" | "total_years_of_experience" | "interested_industries">>,
  opts?: WriteOptions,
): Promise<Profile> {
  const db = await mockRequest()
  maybeFail(opts)
  const profile = db.profiles[0]
  Object.assign(profile, patch)
  stamp(profile)
  return clone(profile)
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

export async function listExperiences(): Promise<Experience[]> {
  const db = await mockRequest()
  return clone([...db.experiences].sort((a, b) => (b.start_month ?? "").localeCompare(a.start_month ?? "")))
}

export async function listEducations(): Promise<Education[]> {
  const db = await mockRequest()
  return clone([...db.educations].sort((a, b) => (b.start_month ?? "").localeCompare(a.start_month ?? "")))
}

export interface ProjectDetailWithAchievements extends ProjectDetail {
  achievements: Achievement[]
}

export interface ProjectWithChildren extends Project {
  details: ProjectDetailWithAchievements[]
  skills: Skill[]
  writing_chats: WritingChat[]
  experience: Experience | null
  education: Education | null
}

function projectWithChildren(db: MockDb, project: Project): ProjectWithChildren {
  const details = db.project_details
    .filter((d) => d.project_id === project.id)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((d) => ({ ...d, achievements: db.achievements.filter((a) => a.project_detail_id === d.id) }))
  const skillIds = db.project_skills.filter((ps) => ps.project_id === project.id).map((ps) => ps.skill_id)
  return {
    ...project,
    details,
    skills: db.skills.filter((s) => skillIds.includes(s.id)),
    writing_chats: db.writing_chats.filter((c) => c.project_id === project.id),
    experience: db.experiences.find((e) => e.id === project.experience_id) ?? null,
    education: db.educations.find((e) => e.id === project.education_id) ?? null,
  }
}

export interface ExperienceWithChildren extends Experience {
  projects: ProjectWithChildren[]
  /** 경력 단위 성과 (S-09) */
  achievements: Achievement[]
}

export async function getExperience(id: string): Promise<ExperienceWithChildren | null> {
  const db = await mockRequest()
  const exp = db.experiences.find((e) => e.id === id)
  if (!exp) return null
  return clone({
    ...exp,
    projects: db.projects.filter((p) => p.experience_id === id).map((p) => projectWithChildren(db, p)),
    achievements: db.achievements.filter((a) => a.experience_id === id),
  })
}

export interface EducationWithChildren extends Education {
  projects: ProjectWithChildren[]
}

export async function getEducation(id: string): Promise<EducationWithChildren | null> {
  const db = await mockRequest()
  const edu = db.educations.find((e) => e.id === id)
  if (!edu) return null
  return clone({ ...edu, projects: db.projects.filter((p) => p.education_id === id).map((p) => projectWithChildren(db, p)) })
}

export async function getProject(id: string): Promise<ProjectWithChildren | null> {
  const db = await mockRequest()
  const project = db.projects.find((p) => p.id === id)
  return project ? clone(projectWithChildren(db, project)) : null
}

export async function getProjectDetail(
  projectId: string,
  detailId: string,
): Promise<{ detail: ProjectDetailWithAchievements; project: ProjectWithChildren } | null> {
  const db = await mockRequest()
  const project = db.projects.find((p) => p.id === projectId)
  const detail = db.project_details.find((d) => d.id === detailId && d.project_id === projectId)
  if (!project || !detail) return null
  return clone({
    detail: { ...detail, achievements: db.achievements.filter((a) => a.project_detail_id === detail.id) },
    project: projectWithChildren(db, project),
  })
}

export interface SkillWithCount extends Skill {
  project_count: number
}

/** S-12 */
export async function listSkills(): Promise<SkillWithCount[]> {
  const db = await mockRequest()
  return clone(
    db.skills
      .map((s) => ({ ...s, project_count: db.project_skills.filter((ps) => ps.skill_id === s.id).length }))
      .sort((a, b) => b.project_count - a.project_count || a.name.localeCompare(b.name)),
  )
}

// ---------------------------------------------------------------------------
// S-08 career tree (year view, 04 §2.4 — computed, not stored)
// ---------------------------------------------------------------------------

export interface CareerTreeAffiliationEntry {
  kind: "experience" | "education"
  experience?: Experience
  education?: Education
  /** projects that started in this year */
  projects: ProjectWithChildren[]
  /** true when no project started in this year → collapsed header only */
  collapsed: boolean
}

export interface CareerTreeYear {
  year: number
  entries: CareerTreeAffiliationEntry[]
  /** 기타 프로젝트 (no affiliation) started this year */
  other_projects: ProjectWithChildren[]
}

export interface CareerTree {
  years: CareerTreeYear[]
  /** 연도 미정 (no affiliation and no period) */
  undated_projects: ProjectWithChildren[]
  counts: {
    complete_experiences: number
    complete_educations: number
    complete_projects: number
    complete_project_details: number
  }
  /** 규칙 기반 안내 1줄 inputs (S-08 상단 요약) */
  hints: {
    details_without_result: number
    projects_without_detail: number
  }
  skill_count: number
  profile: Profile
  active_writing_chats: WritingChat[]
  is_empty: boolean
}

function yearOf(date: string | null): number | null {
  return date ? Number(date.slice(0, 4)) : null
}

export async function getCareerTree(): Promise<CareerTree> {
  const db = await mockRequest()
  const thisYear = new Date().getFullYear()
  const projects = db.projects.map((p) => projectWithChildren(db, p))
  const yearMap = new Map<number, CareerTreeYear>()
  const ensureYear = (year: number) => {
    let y = yearMap.get(year)
    if (!y) {
      y = { year, entries: [], other_projects: [] }
      yearMap.set(year, y)
    }
    return y
  }

  const projectYear = (p: ProjectWithChildren): number | null =>
    yearOf(p.start_month) ?? yearOf(p.experience?.start_month ?? null) ?? yearOf(p.education?.start_month ?? null)

  const addAffiliation = (
    kind: "experience" | "education",
    row: Experience | Education,
    ongoing: boolean,
    ownProjects: ProjectWithChildren[],
  ) => {
    const start = yearOf(row.start_month)
    if (start === null) return
    const end = yearOf(row.end_month) ?? (ongoing ? thisYear : start)
    for (let year = end; year >= start; year -= 1) {
      const inYear = ownProjects.filter((p) => projectYear(p) === year)
      ensureYear(year).entries.push({
        kind,
        ...(kind === "experience" ? { experience: row as Experience } : { education: row as Education }),
        projects: inYear,
        collapsed: inYear.length === 0,
      })
    }
  }

  for (const exp of db.experiences) {
    addAffiliation("experience", exp, exp.is_current, projects.filter((p) => p.experience_id === exp.id))
  }
  for (const edu of db.educations) {
    addAffiliation("education", edu, edu.enrollment_status === "enrolled", projects.filter((p) => p.education_id === edu.id))
  }
  const undated: ProjectWithChildren[] = []
  for (const p of projects) {
    if (p.experience_id || p.education_id) {
      // affiliation without start month → undated bucket as well
      if (projectYear(p) === null) undated.push(p)
      continue
    }
    const year = projectYear(p)
    if (year === null) undated.push(p)
    else ensureYear(year).other_projects.push(p)
  }

  const years = [...yearMap.values()].sort((a, b) => b.year - a.year)
  for (const y of years) {
    y.entries.sort((a, b) => {
      const sa = (a.experience ?? a.education)?.start_month ?? ""
      const sb = (b.experience ?? b.education)?.start_month ?? ""
      return sb.localeCompare(sa)
    })
  }

  const completeDetails = db.project_details.filter((d) => d.status === "complete")
  return clone({
    years,
    undated_projects: undated,
    counts: {
      complete_experiences: db.experiences.filter((e) => e.status === "complete").length,
      complete_educations: db.educations.filter((e) => e.status === "complete").length,
      complete_projects: db.projects.filter((p) => p.status === "complete").length,
      complete_project_details: completeDetails.length,
    },
    hints: {
      details_without_result: db.project_details.filter((d) => !d.result).length,
      projects_without_detail: db.projects.filter((p) => !db.project_details.some((d) => d.project_id === p.id)).length,
    },
    skill_count: db.skills.length,
    profile: db.profiles[0],
    active_writing_chats: db.writing_chats
      .filter((c) => c.status === "active")
      .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at)),
    is_empty: db.experiences.length + db.educations.length + db.projects.length === 0,
  })
}

// ---------------------------------------------------------------------------
// writes (autosave targets). Return the saved row incl. recomputed status.
// ---------------------------------------------------------------------------

type ExperiencePatch = Partial<Omit<Experience, "id" | "user_id" | "created_at" | "updated_at" | "status">>

export async function saveExperience(id: string | null, patch: ExperiencePatch, opts?: WriteOptions): Promise<Experience> {
  const db = await mockRequest()
  maybeFail(opts)
  let row = id ? db.experiences.find((e) => e.id === id) : undefined
  if (!row) {
    row = {
      ...baseRow(),
      status: "draft",
      company_name: null,
      start_month: null,
      end_month: null,
      is_current: false,
      job_rank: null,
      job_position: null,
      department: null,
      employment_type: null,
      summary: null,
    }
    db.experiences.push(row)
  }
  Object.assign(row, patch)
  if (row.is_current) row.end_month = null
  row.status = isExperienceComplete(row) ? "complete" : "draft"
  stamp(row)
  touchCareer(db)
  return clone(row)
}

type EducationPatch = Partial<Omit<Education, "id" | "user_id" | "created_at" | "updated_at" | "status">>

export async function saveEducation(id: string | null, patch: EducationPatch, opts?: WriteOptions): Promise<Education> {
  const db = await mockRequest()
  maybeFail(opts)
  let row = id ? db.educations.find((e) => e.id === id) : undefined
  if (!row) {
    row = {
      ...baseRow(),
      status: "draft",
      institution_name: null,
      education_type: null,
      program_name: null,
      start_month: null,
      end_month: null,
      enrollment_status: null,
      description: null,
    }
    db.educations.push(row)
  }
  Object.assign(row, patch)
  if (row.enrollment_status === "enrolled") row.end_month = null
  row.status = isEducationComplete(row) ? "complete" : "draft"
  stamp(row)
  touchCareer(db)
  return clone(row)
}

type ProjectPatch = Partial<Omit<Project, "id" | "user_id" | "created_at" | "updated_at" | "status">>

export async function saveProject(id: string | null, patch: ProjectPatch, opts?: WriteOptions): Promise<Project> {
  const db = await mockRequest()
  maybeFail(opts)
  let row = id ? db.projects.find((p) => p.id === id) : undefined
  if (!row) {
    row = {
      ...baseRow(),
      status: "draft",
      experience_id: null,
      education_id: null,
      name: null,
      role: null,
      summary: null,
      start_month: null,
      end_month: null,
      team_size: null,
      source_writing_chat_id: null,
    }
    db.projects.push(row)
  }
  Object.assign(row, patch)
  // affiliation: at most one (CHECK num_nonnulls <= 1)
  if (patch.experience_id) row.education_id = null
  if (patch.education_id) row.experience_id = null
  recomputeProjectStatus(db, row.id)
  stamp(row)
  touchCareer(db)
  return clone(row)
}

/** project_skills tags by skill name; creates skills by normalized_name (S-10 사용 기술) */
export async function setProjectSkills(projectId: string, names: string[], opts?: WriteOptions): Promise<Skill[]> {
  const db = await mockRequest()
  maybeFail(opts)
  const normalized = (n: string) => n.trim().toLowerCase().replace(/\s+/g, "")
  db.project_skills = db.project_skills.filter((ps) => ps.project_id !== projectId)
  const result: Skill[] = []
  for (const name of names.map((n) => n.trim()).filter(Boolean)) {
    let skill = db.skills.find((s) => s.normalized_name === normalized(name))
    if (!skill) {
      skill = { ...baseRow(), name, normalized_name: normalized(name), is_manual: false, proficiency: null }
      db.skills.push(skill)
    }
    db.project_skills.push({ project_id: projectId, skill_id: skill.id, user_id: USER_ID, created_at: new Date().toISOString() })
    result.push(skill)
  }
  // 고아 태그 스킬 정리 (is_manual = false, 연결 0)
  db.skills = db.skills.filter((s) => s.is_manual || db.project_skills.some((ps) => ps.skill_id === s.id))
  touchCareer(db)
  return clone(result)
}

type DetailPatch = Partial<Omit<ProjectDetail, "id" | "user_id" | "created_at" | "updated_at" | "status" | "project_id">>

export async function saveProjectDetail(
  projectId: string,
  id: string | null,
  patch: DetailPatch,
  opts?: WriteOptions,
): Promise<ProjectDetail> {
  const db = await mockRequest()
  maybeFail(opts)
  let row = id ? db.project_details.find((d) => d.id === id) : undefined
  if (!row) {
    const siblings = db.project_details.filter((d) => d.project_id === projectId)
    row = {
      ...baseRow(),
      project_id: projectId,
      status: "draft",
      title: null,
      situation: null,
      task: null,
      action: null,
      result: null,
      learnings: null,
      sort_order: siblings.reduce((max, d) => Math.max(max, d.sort_order), 0) + 1,
      source_writing_chat_id: null,
    }
    db.project_details.push(row)
  }
  Object.assign(row, patch)
  row.status = isDetailComplete(row) ? "complete" : "draft"
  stamp(row)
  recomputeProjectStatus(db, projectId)
  const project = db.projects.find((p) => p.id === projectId)
  if (project) stamp(project)
  touchCareer(db)
  return clone(row)
}

/** S-10 상세 내용 순서 변경 */
export async function reorderProjectDetails(projectId: string, orderedIds: string[], opts?: WriteOptions): Promise<void> {
  const db = await mockRequest()
  maybeFail(opts)
  orderedIds.forEach((id, index) => {
    const d = db.project_details.find((x) => x.id === id && x.project_id === projectId)
    if (d) d.sort_order = index + 1
  })
}

type AchievementPatch = Partial<Omit<Achievement, "id" | "user_id" | "created_at" | "updated_at" | "status" | "kind">>

/** S-11. Exactly one of project_detail_id / experience_id must be set by the caller. */
export async function saveAchievement(id: string | null, patch: AchievementPatch, opts?: WriteOptions): Promise<Achievement> {
  const db = await mockRequest()
  maybeFail(opts)
  let row = id ? db.achievements.find((a) => a.id === id) : undefined
  if (!row) {
    row = {
      ...baseRow(),
      status: "draft",
      project_detail_id: null,
      experience_id: null,
      metric_name: null,
      value_before: null,
      value_after: null,
      unit: null,
      description: null,
      kind: null,
      source_writing_chat_id: null,
    }
    db.achievements.push(row)
  }
  Object.assign(row, patch)
  row.status = isAchievementComplete(row) ? "complete" : "draft"
  stamp(row)
  touchCareer(db)
  return clone(row)
}

/** S-12 manual skill */
export async function addManualSkill(name: string, opts?: WriteOptions): Promise<Skill> {
  const db = await mockRequest()
  maybeFail(opts)
  const normalized = name.trim().toLowerCase().replace(/\s+/g, "")
  let skill = db.skills.find((s) => s.normalized_name === normalized)
  if (!skill) {
    skill = { ...baseRow(), name: name.trim(), normalized_name: normalized, is_manual: true, proficiency: null }
    db.skills.push(skill)
  } else {
    skill.is_manual = true
  }
  return clone(skill)
}
