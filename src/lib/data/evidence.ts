/**
 * Evidence links → C-01 chip / C-02 panel view models. Status is computed here, not in the
 * chip (patterns.md §5): 정상 / 변경됨 (source updated_at > source_snapshot_at; jd_sentence
 * always 정상) / 원본 삭제됨 (source_deleted_at). Server only.
 */
import type { EvidenceLink, EvidenceOwnerType, ProjectDetailField } from "@/types/db"
import { clone, mockRequest } from "@/lib/mock/store"
import type { MockDb } from "@/lib/mock/fixtures"
import { routes } from "@/lib/routes"
import { loadEvidenceRows } from "./evidence-real"
import { previewOr } from "./source"
import { educationDisplayName } from "@/server/services/career/education-name"
import { DETAIL_FIELD_LABELS, ENROLLMENT_STATUS_LABELS, EDUCATION_TYPE_LABELS, evidenceKindLabel } from "./labels"

export type EvidenceStatus = "ok" | "changed" | "deleted"

/** View model shared by C-01 EvidenceChip and C-02 EvidencePanel (client-safe shape) */
export interface EvidenceView {
  id: string
  item_key: string
  source_type: EvidenceLink["source_type"]
  source_field: string | null
  /** kind part: "상세 내용 · 행동", "회고 및 배운 점", "정량 성과" … */
  kind_label: string
  /** source_label (or current name) */
  source_label: string
  /** full chip label "{kind} · {source_label}" */
  label: string
  status: EvidenceStatus
  quote: string | null
  /** 원본 현재 값 when no quote (null if deleted) */
  current_value: string | null
  /** "연도 › 회사명/기관명 › 프로젝트명 › 상세 내용 제목 › 필드" */
  path: string[]
  /** "원본으로 이동" deep link (null when deleted) */
  href: string | null
  /** true when the link goes into 커리어 (show C-10 on arrival) */
  to_career: boolean
}

function year(date: string | null | undefined): string | null {
  return date ? date.slice(0, 4) : null
}

/** UI32-2: an education's name = trimmed program_name, else institution_name (null = both empty) */
function educationName(x: Pick<MockDb["educations"][number], "program_name" | "institution_name"> | undefined): string | null {
  return x ? educationDisplayName(x.program_name, x.institution_name) : null
}

/** Parent name of an affiliated project: company_name, or the education's name */
function parentName(db: MockDb, p: Pick<MockDb["projects"][number], "experience_id" | "education_id"> | undefined): string | null | undefined {
  if (!p) return undefined
  return db.experiences.find((r) => r.id === p.experience_id)?.company_name ?? educationName(db.educations.find((r) => r.id === p.education_id))
}

/** 04 §2.4: project year = coalesce(projects.start_month, 소속 start_month) (UQ-11) */
function projectYear(db: MockDb, p: MockDb["projects"][number] | undefined): string | null {
  if (!p) return null
  return (
    year(p.start_month) ??
    year(db.experiences.find((r) => r.id === p.experience_id)?.start_month) ??
    year(db.educations.find((r) => r.id === p.education_id)?.start_month)
  )
}

function resolve(db: MockDb, e: EvidenceLink): Omit<EvidenceView, "id" | "item_key" | "source_type" | "source_field" | "kind_label" | "label" | "status" | "quote"> & { updated_at: string | null } {
  const empty = { source_label: e.source_label ?? "", current_value: null, path: [], href: null, to_career: false, updated_at: null }
  if (e.source_deleted_at) return empty
  const sid = e.source_id
  switch (e.source_type) {
    case "profile": {
      const p = db.profiles[0]
      return { source_label: e.source_label ?? "기본 프로필", current_value: p.desired_job_title, path: ["기본 프로필"], href: routes.profile(), to_career: true, updated_at: p.updated_at }
    }
    case "experience": {
      const x = db.experiences.find((r) => r.id === sid)
      if (!x) return empty
      return {
        source_label: e.source_label ?? x.company_name ?? "",
        current_value: e.source_field === "summary" ? x.summary : [x.job_rank, x.job_position].filter(Boolean).join(" / "),
        path: [year(x.start_month), x.company_name].filter(Boolean) as string[],
        href: routes.experience(x.id),
        to_career: true,
        updated_at: x.updated_at,
      }
    }
    case "education": {
      const x = db.educations.find((r) => r.id === sid)
      if (!x) return empty
      const value =
        e.source_field === "education_type" && x.education_type
          ? EDUCATION_TYPE_LABELS[x.education_type]
          : e.source_field === "enrollment_status" && x.enrollment_status
            ? ENROLLMENT_STATUS_LABELS[x.enrollment_status]
            : e.source_field === "description"
              ? x.description
              : x.program_name
      return {
        source_label: e.source_label ?? educationName(x) ?? "",
        current_value: value,
        path: [year(x.start_month), educationName(x)].filter(Boolean) as string[],
        href: routes.education(x.id),
        to_career: true,
        updated_at: x.updated_at,
      }
    }
    case "project": {
      const x = db.projects.find((r) => r.id === sid)
      if (!x) return empty
      const parent = parentName(db, x)
      // DM v4.4: real rows carry STAR / description columns and `content_updated_at` (the "변경됨" baseline, DM 2.8).
      const v44 = x as unknown as Record<string, string | null | undefined>
      const field = e.source_field
      const value = field && field !== "name" && field !== "period" && field in v44 ? (v44[field] ?? null) : field === "summary" ? x.summary : x.name
      return {
        source_label: e.source_label ?? x.name ?? "",
        current_value: value,
        path: [projectYear(db, x), parent, x.name].filter(Boolean) as string[],
        // v5.6: affiliated → S-10 with that STAR 칸 focused (C-02), standalone → S-08 panel (S-43)
        href: x.experience_id || x.education_id ? routes.projectPage(x.id, { focus: starFocus(field) }) : routes.careerItem("project", x.id),
        to_career: true,
        updated_at: v44.content_updated_at ?? x.updated_at,
      }
    }
    case "project_deliverable": {
      // R4 (DM v4.4): deliverables of standalone projects → S-44 with the 근거 구간 (`?range=`, C-02)
      const d = (db as unknown as { project_deliverables?: Array<Record<string, string | null>> }).project_deliverables?.find((r) => r.id === sid)
      if (!d) return empty
      const p = db.projects.find((r) => r.id === d.project_id)
      return {
        source_label: e.source_label ?? d.title ?? "",
        current_value: e.source_field === "body" ? (d.body ?? null) : (d.title ?? null),
        path: [projectYear(db, p), p?.name, d.title].filter(Boolean) as string[],
        href: routes.deliverable(String(d.id), { range: e.source_field === "body" ? locatorRange(e.source_locator) : null }),
        to_career: true,
        updated_at: d.updated_at ?? null,
      }
    }
    case "project_detail": {
      const d = db.project_details.find((r) => r.id === sid)
      if (!d) return empty
      const p = db.projects.find((r) => r.id === d.project_id)
      const parent = parentName(db, p)
      const field = (e.source_field ?? "title") as ProjectDetailField
      return {
        source_label: e.source_label ?? d.title ?? "",
        current_value: d[field] ?? null,
        path: [projectYear(db, p), parent, p?.name, d.title, DETAIL_FIELD_LABELS[field]].filter(Boolean) as string[],
        // v5.5: 상세 내용 merged into S-10's STAR (CR-2)
        href: routes.projectPage(d.project_id, { focus: starFocus(field) }),
        to_career: true,
        updated_at: d.updated_at,
      }
    }
    case "achievement": {
      const a = db.achievements.find((r) => r.id === sid)
      if (!a) return empty
      const d = db.project_details.find((r) => r.id === a.project_detail_id)
      const ap = d ? db.projects.find((r) => r.id === d.project_id) : undefined
      const aParent = ap ? parentName(db, ap) : db.experiences.find((r) => r.id === a.experience_id)?.company_name
      const value = a.metric_name ? `${a.metric_name} ${a.value_before ?? ""} → ${a.value_after ?? ""} ${a.unit ?? ""}`.trim() : a.description
      // [UI-가정] S-11 is a modal; deep link opens its host screen (S-35 or S-09)
      return {
        source_label: e.source_label ?? a.metric_name ?? a.description ?? "",
        current_value: value,
        path: (d
          ? [projectYear(db, ap), aParent, ap?.name, d.title, "정량 성과"]
          : [aParent, "경력 단위 성과"]
        ).filter(Boolean) as string[],
        // `?achievement=` opens S-11 for this row on arrival (A2 request 4)
        href: d
          ? routes.projectPage(d.project_id, { focus: "result" })
          : a.experience_id
            ? routes.experience(a.experience_id, { achievement: a.id })
            : null,
        to_career: true,
        updated_at: a.updated_at,
      }
    }
    case "skill": {
      const s = db.skills.find((r) => r.id === sid)
      if (!s) return empty
      return { source_label: s.name, current_value: s.name, path: ["스킬"], href: routes.skills(), to_career: true, updated_at: s.updated_at }
    }
    case "jd_requirement": {
      const r = db.jd_requirements.find((x) => x.id === sid)
      // R11 최소 수정 (OD-I6): no project (detached interview evidence) → no link.
      return { source_label: e.source_label ?? r?.content ?? "", current_value: r?.content ?? null, path: ["JD 요건"], href: e.application_project_id ? routes.applicationJd(e.application_project_id) : null, to_career: false, updated_at: null }
    }
    case "jd_sentence":
      return { source_label: e.source_label ?? "", current_value: e.source_label, path: ["공고 원문"], href: e.application_project_id ? routes.applicationJd(e.application_project_id) : null, to_career: false, updated_at: null }
    case "interview_answer": {
      const a = db.interview_answers.find((x) => x.id === sid)
      return {
        source_label: e.source_label ?? "내 답변",
        current_value: a?.answer_text ?? null,
        path: ["모의 면접", "내 답변"],
        href: a && e.application_project_id ? routes.interviewResult(e.application_project_id, a.session_id) : null,
        to_career: false,
        updated_at: a?.updated_at ?? null,
      }
    }
    case "user_note": {
      const s = db.draft_sections.find((x) => x.id === sid)
      return {
        source_label: e.source_label ?? "내 메모",
        current_value: s?.user_note ?? null,
        path: ["자소서 문항 답변", "문항 메모"],
        href: s && e.application_project_id ? routes.draftQuestions(e.application_project_id, s.draft_id) : null,
        to_career: false,
        updated_at: s?.updated_at ?? null,
      }
    }
  }
}

export function toEvidenceView(db: MockDb, e: EvidenceLink): EvidenceView {
  const r = resolve(db, e)
  const status: EvidenceStatus = e.source_deleted_at
    ? "deleted"
    : e.source_type !== "jd_sentence" && r.updated_at && Date.parse(r.updated_at) > Date.parse(e.source_snapshot_at)
      ? "changed"
      : "ok"
  const kind = evidenceKindLabel(e.source_type, e.source_field)
  return {
    id: e.id,
    item_key: e.item_key,
    source_type: e.source_type,
    source_field: e.source_field,
    kind_label: kind,
    source_label: r.source_label,
    label: r.source_label ? `${kind} · ${r.source_label}` : kind,
    status,
    quote: status === "deleted" ? null : e.quote,
    current_value: status === "deleted" ? null : r.current_value,
    path: r.path,
    href: status === "deleted" ? null : r.href,
    to_career: r.to_career,
  }
}

/** All evidence for an owner row, grouped by item_key */
export async function getEvidence(ownerType: EvidenceOwnerType, ownerId: string): Promise<Record<string, EvidenceView[]>> {
  return (await getEvidenceForOwners(ownerType, [ownerId]))[ownerId] ?? {}
}

/** Evidence for several owners at once (e.g. all sections of a draft) */
export async function getEvidenceForOwners(ownerType: EvidenceOwnerType, ownerIds: string[]): Promise<Record<string, Record<string, EvidenceView[]>>> {
  const { db, links } = await previewOr(
    async () => {
      const mock = await mockRequest()
      return {
        db: mock,
        links: mock.evidence_links.filter((x) => x.owner_type === ownerType && ownerIds.includes(x.owner_id)).sort((a, b) => a.sort_order - b.sort_order),
      }
    },
    () => loadEvidenceRows(ownerType, ownerIds),
  )
  const out: Record<string, Record<string, EvidenceView[]>> = {}
  for (const e of links) {
    const byKey = (out[e.owner_id] ??= {})
    ;(byKey[e.item_key] ??= []).push(toEvidenceView(db, e))
  }
  return clone(out)
}

/** C-02 → S-10: STAR source fields focus that 칸; others (name, period, …) open the page plainly. */
function starFocus(field: string | null | undefined): "situation" | "task" | "action" | "result" | "learnings" | undefined {
  return field === "situation" || field === "task" || field === "action" || field === "result" || field === "learnings" ? field : undefined
}

/** `source_locator {start, end}` (character offsets in the deliverable body) → S-44 `?range=` */
function locatorRange(locator: Record<string, unknown> | null | undefined): { start: number; end: number } | null {
  const start = Number(locator?.start)
  const end = Number(locator?.end)
  return Number.isInteger(start) && Number.isInteger(end) && end > start && start >= 0 ? { start, end } : null
}
