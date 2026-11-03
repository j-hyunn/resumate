/**
 * C-05 deletion: RPC get_deletion_impact / delete_career_item (04 §4.2) plus application
 * project / draft / interview session deletion. Server only.
 */
import type {
  AffiliationMode,
  DeletionEntityType,
  DeletionImpact,
  EvidenceSourceType,
  ResultMode,
} from "@/types/db"
import { mockRequest } from "@/lib/mock/store"
import { mockV45DeletionImpact, mockV45Delete } from "@/lib/mock/career-v45"
import { countsAsDraft } from "./labels"
import type { MockDb } from "@/lib/mock/fixtures"
import { loadDraftCounts } from "@/server/services/drafts/progress"
import * as applicationActions from "@/server/actions/application"
import * as draftActions from "@/server/actions/draft"
import * as interviewActions from "@/server/actions/interview"
import {
  DeleteCareerItemInput,
  DeletionImpactInput,
  type CareerDeletionImpact,
  type DeleteCareerItemResult,
  type WritingChatDeletionImpact,
} from "@/lib/contracts/career"
import type { DeletableEntityType } from "@/lib/contracts/enums"
import { AppError, invalid } from "@/lib/contracts/errors"
import { requireConsentedUser } from "@/server/auth/session"
import { rememberDeletedRow } from "@/server/auth/user-cookies"
import * as career from "@/server/services/career"
import { mapDbError } from "@/server/db/errors"
import { isPreviewRequest, previewOr, unwrap } from "./source"

interface CascadeSet {
  experiences: string[]
  educations: string[]
  projects: string[]
  project_details: string[]
  achievements: string[]
  skills: string[]
  writing_chats: string[]
  project_skills: number
}

function collect(db: MockDb, entityType: DeletionEntityType, entityId: string, affiliationMode: AffiliationMode): CascadeSet {
  const set: CascadeSet = {
    experiences: [],
    educations: [],
    projects: [],
    project_details: [],
    achievements: [],
    skills: [],
    writing_chats: [],
    project_skills: 0,
  }
  const addProject = (projectId: string) => {
    set.projects.push(projectId)
    for (const d of db.project_details.filter((x) => x.project_id === projectId)) addDetail(d.id)
    set.project_skills += db.project_skills.filter((ps) => ps.project_id === projectId).length
    set.writing_chats.push(...db.writing_chats.filter((c) => c.project_id === projectId).map((c) => c.id))
  }
  const addDetail = (detailId: string) => {
    set.project_details.push(detailId)
    set.achievements.push(...db.achievements.filter((a) => a.project_detail_id === detailId).map((a) => a.id))
  }
  switch (entityType) {
    case "experience":
      set.experiences.push(entityId)
      set.achievements.push(...db.achievements.filter((a) => a.experience_id === entityId).map((a) => a.id))
      if (affiliationMode === "delete_projects")
        db.projects.filter((p) => p.experience_id === entityId).forEach((p) => addProject(p.id))
      break
    case "education":
      set.educations.push(entityId)
      if (affiliationMode === "delete_projects")
        db.projects.filter((p) => p.education_id === entityId).forEach((p) => addProject(p.id))
      break
    case "project":
      addProject(entityId)
      break
    case "project_detail":
      addDetail(entityId)
      break
    case "achievement":
      set.achievements.push(entityId)
      break
    case "skill":
      set.skills.push(entityId)
      set.project_skills += db.project_skills.filter((ps) => ps.skill_id === entityId).length
      break
    case "writing_chat":
      set.writing_chats.push(entityId)
      break
  }
  return set
}

function sourceIds(set: CascadeSet): Array<{ type: EvidenceSourceType; ids: string[] }> {
  return [
    { type: "experience", ids: set.experiences },
    { type: "education", ids: set.educations },
    { type: "project", ids: set.projects },
    { type: "project_detail", ids: set.project_details },
    { type: "achievement", ids: set.achievements },
    { type: "skill", ids: set.skills },
  ]
}

function affectedEvidence(db: MockDb, set: CascadeSet) {
  const targets = sourceIds(set)
  return db.evidence_links.filter((e) => targets.some((t) => t.type === e.source_type && e.source_id && t.ids.includes(e.source_id)))
}

function affectedSources(db: MockDb, set: CascadeSet) {
  return db.draft_section_sources.filter(
    (s) =>
      (s.experience_id && set.experiences.includes(s.experience_id)) ||
      (s.education_id && set.educations.includes(s.education_id)) ||
      (s.project_id && set.projects.includes(s.project_id)) ||
      s.project_detail_ids.some((id) => set.project_details.includes(id)),
  )
}

/** RPC get_deletion_impact(entity_type, entity_id, affiliation_mode) */
export async function getDeletionImpact(
  entityType: DeletionEntityType,
  entityId: string,
  affiliationMode: AffiliationMode = "delete_projects",
): Promise<DeletionImpact> {
  return previewOr(
    () => mockDeletionImpact(entityType, entityId, affiliationMode),
    async () => {
      const parsed = DeletionImpactInput.safeParse({ entityType: legacyEntityType(entityType), entityId, affiliationMode: legacyAffiliationMode(entityType, affiliationMode) })
      if (!parsed.success) return unwrap(invalid(parsed.error))
      const { supabase } = await requireConsentedUser()
      return toDeletionImpact(await career.getDeletionImpact(supabase, parsed.data))
    },
  )
}

/**
 * @deprecated R4 shim: the current UI still offers `project_detail` / `achievement` (dropped in DM v4.4)
 * and "keep projects" (refused since CR-15). Those answer a clear error instead of acting differently.
 */
function legacyEntityType(entityType: DeletionEntityType): string {
  if (entityType === "project_detail" || entityType === "achievement") {
    throw new AppError("not_supported", "이 항목은 새 커리어 구조에서 없어졌어요. 새로고침 후 다시 확인해 주세요.", { status: 410 })
  }
  return entityType
}

/** CR-15: an experience / education delete always removes its projects; other types ignore the mode. */
function legacyAffiliationMode(entityType: DeletionEntityType, mode: AffiliationMode): "delete_projects" {
  if (mode === "keep_projects" && (entityType === "experience" || entityType === "education")) {
    throw new AppError("affiliation_mode_not_supported", "경력·교육을 지우면 그 안의 프로젝트도 함께 지워져요. 새로고침 후 다시 시도해 주세요.", { status: 400 })
  }
  return "delete_projects"
}

/** RPC jsonb (v4.4) → the legacy screen shape (`writing_chat` has its own counts and no cascade, DM §4.2). */
function toDeletionImpact(impact: CareerDeletionImpact | WritingChatDeletionImpact): DeletionImpact {
  if ("cascade" in impact) {
    return {
      cascade: {
        projects: impact.cascade.projects,
        project_details: 0,
        achievements: 0,
        project_skills: impact.cascade.project_skills,
        writing_chats: impact.cascade.writing_chats,
        project_deliverables: impact.cascade.project_deliverables,
      },
      affected_results: impact.affected_results,
    }
  }
  return {
    cascade: { projects: 0, project_details: 0, achievements: 0, project_skills: 0, writing_chats: 0, project_deliverables: 0 },
    affected_results: { by_application_project: [] },
    // v4.4 has no saved rows: `last_applied_at` set → "반영된 STAR는 남아요" (shown as 1 kept row).
    writing_chat: { message_count: impact.message_count, linked_saved_rows: impact.last_applied_at ? 1 : 0 },
  }
}

/** C-05 v4.4 impact (S-09 / S-34 / S-43 / S-44 / S-10 패널). 연결 대기: the reworked delete dialog calls this. */
export async function getCareerDeletionImpact(
  entityType: DeletableEntityType,
  entityId: string,
): Promise<CareerDeletionImpact | WritingChatDeletionImpact> {
  const parsed = DeletionImpactInput.safeParse({ entityType, entityId })
  if (!parsed.success) return unwrap(invalid(parsed.error))
  const { supabase } = await requireConsentedUser()
  return career.getDeletionImpact(supabase, parsed.data)
}

/** C-05 v4.4 delete. 연결 대기. */
export async function deleteCareerEntity(
  entityType: DeletableEntityType,
  entityId: string,
  resultMode: ResultMode = "keep_results",
): Promise<DeleteCareerItemResult> {
  const parsed = DeleteCareerItemInput.safeParse({ entityType, entityId, resultMode })
  if (!parsed.success) return unwrap(invalid(parsed.error))
  const { supabase, user } = await requireConsentedUser()
  const result = await career.deleteCareerItem(supabase, parsed.data)
  await rememberDeletedRow(user.id, parsed.data.entityId)
  return result
}

async function mockDeletionImpact(entityType: DeletionEntityType, entityId: string, affiliationMode: AffiliationMode): Promise<DeletionImpact> {
  const db = await mockRequest(400)
  const set = collect(db, entityType, entityId, affiliationMode)
  // v4.5 rows (S-10 / S-44 mock: deliverables, deliverable chats, STAR chats) live in lib/mock/career-v45
  const projectIds = entityType === "project" ? [...new Set([...set.projects, entityId])] : set.projects
  const v45 = await mockV45DeletionImpact(entityType, entityId, projectIds)
  const impact: DeletionImpact = {
    cascade: {
      projects: set.projects.length,
      project_details: set.project_details.length,
      achievements: set.achievements.length,
      project_skills: set.project_skills,
      writing_chats: set.writing_chats.length + v45.writing_chats,
      project_deliverables: v45.project_deliverables,
    },
    affected_results: { by_application_project: [] },
  }
  if (entityType === "project_deliverable") return impact
  if (entityType === "writing_chat") {
    const chat = db.writing_chats.find((c) => c.id === entityId)
    if (v45.found) {
      impact.writing_chat = { message_count: v45.message_count ?? 0, linked_saved_rows: v45.last_applied_at ? 1 : 0 }
      return impact
    }
    impact.writing_chat = {
      message_count: chat?.message_count ?? 0,
      linked_saved_rows:
        db.projects.filter((p) => p.source_writing_chat_id === entityId).length +
        db.project_details.filter((d) => d.source_writing_chat_id === entityId).length +
        db.achievements.filter((a) => a.source_writing_chat_id === entityId).length,
    }
    return impact
  }
  const evidence = affectedEvidence(db, set)
  const sources = affectedSources(db, set)
  const byAp = new Map<string, { insights: Set<string>; drafts: Set<string>; sections: Set<string>; sessions: Set<string> }>()
  const bucket = (apId: string) => {
    let b = byAp.get(apId)
    if (!b) {
      b = { insights: new Set(), drafts: new Set(), sections: new Set(), sessions: new Set() }
      byAp.set(apId, b)
    }
    return b
  }
  for (const e of evidence) {
    const b = bucket(e.application_project_id)
    if (e.owner_type === "insight") b.insights.add(e.owner_id)
    if (e.owner_type === "draft_section") {
      b.sections.add(e.owner_id)
      const section = db.draft_sections.find((s) => s.id === e.owner_id)
      if (section) b.drafts.add(section.draft_id)
    }
    if (e.owner_type === "interview_question" || e.owner_type === "answer_evaluation" || e.owner_type === "session_feedback") {
      const sessionId =
        db.interview_questions.find((q) => q.id === e.owner_id)?.session_id ??
        db.answer_evaluations.find((a) => a.id === e.owner_id)?.session_id ??
        db.session_feedbacks.find((f) => f.id === e.owner_id)?.session_id
      if (sessionId) b.sessions.add(sessionId)
    }
  }
  for (const s of sources) {
    const b = bucket(s.application_project_id)
    b.sections.add(s.draft_section_id)
    const section = db.draft_sections.find((x) => x.id === s.draft_section_id)
    if (section) b.drafts.add(section.draft_id)
  }
  impact.affected_results.by_application_project = [...byAp.entries()].map(([apId, b]) => ({
    application_project_id: apId,
    name: db.application_projects.find((a) => a.id === apId)?.name ?? null,
    insights: b.insights.size,
    drafts: b.drafts.size,
    draft_sections: b.sections.size,
    interview_sessions: b.sessions.size,
  }))
  return impact
}

/** RPC delete_career_item(entity_type, entity_id, affiliation_mode, result_mode) */
export async function deleteCareerItem(
  entityType: DeletionEntityType,
  entityId: string,
  affiliationMode: AffiliationMode = "delete_projects",
  resultMode: ResultMode = "keep_results",
): Promise<void> {
  return previewOr(
    () => mockDeleteCareerItem(entityType, entityId, affiliationMode, resultMode),
    async () => {
      const parsed = DeleteCareerItemInput.safeParse({ entityType: legacyEntityType(entityType), entityId, affiliationMode: legacyAffiliationMode(entityType, affiliationMode), resultMode })
      if (!parsed.success) return unwrap(invalid(parsed.error))
      const { supabase, user } = await requireConsentedUser()
      await career.deleteCareerItem(supabase, parsed.data)
      // QA-W5-06 (2): a lost-response create retried in another tab can't bring this row back.
      await rememberDeletedRow(user.id, parsed.data.entityId)
    },
  )
}

async function mockDeleteCareerItem(entityType: DeletionEntityType, entityId: string, affiliationMode: AffiliationMode, resultMode: ResultMode): Promise<void> {
  const db = await mockRequest()
  const set = collect(db, entityType, entityId, affiliationMode)
  // v4.5 mock rows first (FK cascade: deliverable → its chats, project → its deliverables / chats)
  await mockV45Delete(entityType, entityId, entityType === "project" ? [...new Set([...set.projects, entityId])] : set.projects)
  if (entityType === "project_deliverable") return
  const now = new Date().toISOString()

  if (entityType !== "writing_chat") {
    const evidence = affectedEvidence(db, set)
    if (resultMode === "delete_results") {
      const insightIds = new Set(evidence.filter((e) => e.owner_type === "insight").map((e) => e.owner_id))
      const sectionIds = new Set(evidence.filter((e) => e.owner_type === "draft_section").map((e) => e.owner_id))
      affectedSources(db, set).forEach((s) => sectionIds.add(s.draft_section_id))
      db.insights = db.insights.filter((i) => !insightIds.has(i.id))
      // 경력기술서 = 문서 전체, 자소서 = 해당 문항 생성 결과만 초기화 (04 §4.2)
      for (const sectionId of sectionIds) {
        const section = db.draft_sections.find((s) => s.id === sectionId)
        const draft = section && db.drafts.find((d) => d.id === section.draft_id)
        if (!section || !draft) continue
        if (draft.draft_type === "career_description") {
          db.drafts = db.drafts.filter((d) => d.id !== draft.id)
          db.draft_sections = db.draft_sections.filter((s) => s.draft_id !== draft.id)
        } else {
          Object.assign(section, { ai_content: null, edited_content: null, status: "pending", updated_at: now })
        }
      }
      db.evidence_links = db.evidence_links.filter((e) => !evidence.includes(e))
    } else {
      for (const e of evidence) Object.assign(e, { quote: null, source_deleted_at: now })
      for (const s of affectedSources(db, set)) {
        if (
          (s.experience_id && set.experiences.includes(s.experience_id)) ||
          (s.education_id && set.educations.includes(s.education_id)) ||
          (s.project_id && set.projects.includes(s.project_id))
        )
          s.source_deleted_at = now
        s.project_detail_ids = s.project_detail_ids.filter((id) => !set.project_details.includes(id))
      }
    }
  }

  const parentProjects = new Set(
    db.project_details.filter((d) => set.project_details.includes(d.id)).map((d) => d.project_id),
  )
  db.experiences = db.experiences.filter((e) => !set.experiences.includes(e.id))
  db.educations = db.educations.filter((e) => !set.educations.includes(e.id))
  db.projects = db.projects.filter((p) => !set.projects.includes(p.id))
  db.project_details = db.project_details.filter((d) => !set.project_details.includes(d.id))
  db.achievements = db.achievements.filter((a) => !set.achievements.includes(a.id))
  db.skills = db.skills.filter((s) => !set.skills.includes(s.id))
  db.project_skills = db.project_skills.filter((ps) => !set.projects.includes(ps.project_id) && !set.skills.includes(ps.skill_id))
  db.writing_chat_messages = db.writing_chat_messages.filter((m) => !set.writing_chats.includes(m.writing_chat_id))
  db.writing_chats = db.writing_chats.filter((c) => !set.writing_chats.includes(c.id))
  // set null references
  for (const p of db.projects) {
    if (p.experience_id && set.experiences.includes(p.experience_id)) p.experience_id = null
    if (p.education_id && set.educations.includes(p.education_id)) p.education_id = null
    if (p.source_writing_chat_id && set.writing_chats.includes(p.source_writing_chat_id)) p.source_writing_chat_id = null
  }
  for (const d of db.project_details)
    if (d.source_writing_chat_id && set.writing_chats.includes(d.source_writing_chat_id)) d.source_writing_chat_id = null
  for (const a of db.achievements)
    if (a.source_writing_chat_id && set.writing_chats.includes(a.source_writing_chat_id)) a.source_writing_chat_id = null
  for (const c of db.writing_chats) {
    if (c.experience_id && set.experiences.includes(c.experience_id)) c.experience_id = null
    if (c.education_id && set.educations.includes(c.education_id)) c.education_id = null
  }
  // parent project status may drop to draft when its last complete detail is gone
  for (const projectId of parentProjects) {
    const project = db.projects.find((p) => p.id === projectId)
    if (!project) continue
    const hasComplete = db.project_details.some((d) => d.project_id === projectId && d.status === "complete")
    project.status = project.name && project.role && hasComplete ? "complete" : "draft"
    project.updated_at = now
  }
}

/** C-05 기업 JD 삭제 counts */
export interface ApplicationDeletionImpact {
  insights: number
  drafts: number
  interview_sessions: number
  stage_events: number
}

export async function getApplicationDeletionImpact(applicationProjectId: string): Promise<ApplicationDeletionImpact> {
  return previewOr(
    async () => {
      const db = await mockRequest(400)
      return {
        insights: db.insights.filter((i) => i.application_project_id === applicationProjectId).length,
        drafts: db.drafts.filter((d) => d.application_project_id === applicationProjectId && countsAsDraft(d)).length,
        interview_sessions: db.interview_sessions.filter((s) => s.application_project_id === applicationProjectId).length,
        stage_events: db.application_stage_events.filter((e) => e.application_project_id === applicationProjectId).length,
      }
    },
    async () => {
      const { supabase } = await requireConsentedUser()
      const head = { count: "exact", head: true } as const
      const [insights, drafts, sessions, events] = await Promise.all([
        supabase.from("insights").select("id", head).eq("application_project_id", applicationProjectId),
        loadDraftCounts(supabase, [applicationProjectId]),
        supabase.from("interview_sessions").select("id", head).eq("application_project_id", applicationProjectId),
        supabase.from("application_stage_events").select("id", head).eq("application_project_id", applicationProjectId),
      ])
      for (const r of [insights, sessions, events]) if (r.error) throw mapDbError(r.error)
      return { insights: insights.count ?? 0, drafts: drafts.get(applicationProjectId) ?? 0, interview_sessions: sessions.count ?? 0, stage_events: events.count ?? 0 }
    },
  )
}

/** F-AP-05: deletes the application project and everything under it; running AI jobs are canceled. */
export async function deleteApplicationProject(applicationProjectId: string): Promise<void> {
  if (!(await isPreviewRequest())) {
    unwrap(await applicationActions.deleteApplicationProject({ id: applicationProjectId }))
    return
  }
  const db = await mockRequest()
  const now = new Date().toISOString()
  for (const job of db.ai_jobs.filter((j) => j.application_project_id === applicationProjectId)) {
    if (job.status === "queued" || job.status === "running") job.cancel_requested_at = now
  }
  const jdIds = db.job_descriptions.filter((j) => j.application_project_id === applicationProjectId).map((j) => j.id)
  const draftIds = db.drafts.filter((d) => d.application_project_id === applicationProjectId).map((d) => d.id)
  const sessionIds = db.interview_sessions.filter((s) => s.application_project_id === applicationProjectId).map((s) => s.id)
  db.application_projects = db.application_projects.filter((a) => a.id !== applicationProjectId)
  db.application_stage_events = db.application_stage_events.filter((e) => e.application_project_id !== applicationProjectId)
  db.job_descriptions = db.job_descriptions.filter((j) => !jdIds.includes(j.id))
  db.jd_requirements = db.jd_requirements.filter((r) => !jdIds.includes(r.job_description_id))
  db.insights = db.insights.filter((i) => i.application_project_id !== applicationProjectId)
  db.drafts = db.drafts.filter((d) => !draftIds.includes(d.id))
  db.draft_sections = db.draft_sections.filter((s) => !draftIds.includes(s.draft_id))
  db.draft_section_sources = db.draft_section_sources.filter((s) => s.application_project_id !== applicationProjectId)
  db.interview_sessions = db.interview_sessions.filter((s) => !sessionIds.includes(s.id))
  db.interview_questions = db.interview_questions.filter((q) => !sessionIds.includes(q.session_id))
  db.interview_answers = db.interview_answers.filter((a) => !sessionIds.includes(a.session_id))
  db.answer_evaluations = db.answer_evaluations.filter((a) => !sessionIds.includes(a.session_id))
  db.session_feedbacks = db.session_feedbacks.filter((f) => !sessionIds.includes(f.session_id))
  db.evidence_links = db.evidence_links.filter((e) => e.application_project_id !== applicationProjectId)
}

/** C-05 초안 / 면접 세션: 하위 개수 */
export async function getDraftDeletionImpact(draftId: string): Promise<{ sections: number }> {
  if (!(await isPreviewRequest())) {
    const { supabase } = await requireConsentedUser()
    const { count, error } = await supabase.from("draft_sections").select("id", { count: "exact", head: true }).eq("draft_id", draftId)
    if (error) throw mapDbError(error)
    return { sections: count ?? 0 }
  }
  const db = await mockRequest(300)
  return { sections: db.draft_sections.filter((s) => s.draft_id === draftId).length }
}

export async function deleteDraft(draftId: string): Promise<void> {
  if (!(await isPreviewRequest())) {
    unwrap(await draftActions.deleteDraft({ draftId }))
    return
  }
  const db = await mockRequest()
  const sectionIds = db.draft_sections.filter((s) => s.draft_id === draftId).map((s) => s.id)
  db.drafts = db.drafts.filter((d) => d.id !== draftId)
  db.draft_sections = db.draft_sections.filter((s) => s.draft_id !== draftId)
  db.draft_section_sources = db.draft_section_sources.filter((s) => !sectionIds.includes(s.draft_section_id))
  db.evidence_links = db.evidence_links.filter((e) => !(e.owner_type === "draft_section" && sectionIds.includes(e.owner_id)))
}

export async function getInterviewSessionDeletionImpact(sessionId: string): Promise<{ questions: number; answers: number }> {
  return previewOr(
    async () => {
      const db = await mockRequest(300)
      return {
        questions: db.interview_questions.filter((q) => q.session_id === sessionId).length,
        answers: db.interview_answers.filter((a) => a.session_id === sessionId && a.answer_text.trim() !== "").length,
      }
    },
    async () => {
      const { supabase } = await requireConsentedUser()
      const [session, questions] = await Promise.all([
        // answered_count: non-blank answers, kept by the answer trigger.
        supabase.from("interview_sessions").select("answered_count").eq("id", sessionId).maybeSingle(),
        supabase.from("interview_questions").select("id", { count: "exact", head: true }).eq("session_id", sessionId),
      ])
      if (session.error) throw mapDbError(session.error)
      if (questions.error) throw mapDbError(questions.error)
      return { questions: questions.count ?? 0, answers: session.data?.answered_count ?? 0 }
    },
  )
}

export async function deleteInterviewSession(sessionId: string): Promise<void> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      const questionIds = db.interview_questions.filter((q) => q.session_id === sessionId).map((q) => q.id)
      const evalIds = db.answer_evaluations.filter((a) => a.session_id === sessionId).map((a) => a.id)
      const fbIds = db.session_feedbacks.filter((f) => f.session_id === sessionId).map((f) => f.id)
      db.interview_sessions = db.interview_sessions.filter((s) => s.id !== sessionId)
      db.interview_questions = db.interview_questions.filter((q) => q.session_id !== sessionId)
      db.interview_answers = db.interview_answers.filter((a) => a.session_id !== sessionId)
      db.answer_evaluations = db.answer_evaluations.filter((a) => a.session_id !== sessionId)
      db.session_feedbacks = db.session_feedbacks.filter((f) => f.session_id !== sessionId)
      const owners = new Set([...questionIds, ...evalIds, ...fbIds])
      db.evidence_links = db.evidence_links.filter((e) => !owners.has(e.owner_id))
    },
    async () => {
      unwrap(await interviewActions.deleteInterviewSession({ sessionId }))
    },
  )
}
