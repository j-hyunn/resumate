/**
 * Route tree for every screen (S-xx). Build links with these helpers instead of string
 * literals so areas link to each other through one place (foundation-owned).
 *
 * Query strings carry only non-personal values (spec: C-14 "쿼리에는 유형 값만",
 * FL-13 "URL에는 지원 프로젝트 ID와 기능 이름만").
 */
import type { InterviewType, PolicyType, ProjectDetailField } from "@/types/db"
import { safeNextPath as contractSafeNextPath } from "@/lib/contracts/routes"

type Id = string

function withQuery(path: string, query?: Record<string, string | number | undefined | null>) {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

export const routes = {
  // (public) — A1
  landing: () => "/", // S-01
  /** S-02. `next` = 로그인 후 돌아갈 원래 경로 (same-origin path; checked by safeNextPath) */
  signIn: (next?: string | null) => withQuery("/sign-in", { next }), // S-02
  consent: (next?: string | null) => withQuery("/consent", { next }), // S-03
  /** S-30 with a document tab preselected */
  policies: (doc?: PolicyType) => withQuery("/policies", { doc }), // S-30

  // 커리어 — A2
  career: () => "/career", // S-08
  profile: () => "/career/profile", // S-04
  experienceNew: () => "/career/experiences/new", // S-09
  /** S-09. `achievement` opens that 경력 단위 성과 in S-11 (C-02 "원본으로 이동") */
  experience: (id: Id, query?: { achievement?: Id }) => withQuery(`/career/experiences/${id}`, query), // S-09
  educationNew: () => "/career/educations/new", // S-34
  education: (id: Id) => `/career/educations/${id}`, // S-34
  /** S-10 new; affiliation pre-selected via query (ids only) */
  projectNew: (query?: { experience_id?: Id; education_id?: Id; requirement_id?: Id }) =>
    withQuery("/career/projects/new", query), // S-10 (`requirement_id`: 관련 요건 참고 문구)
  /**
   * S-10. `requirement_id` (S-16 보완점) shows "관련 요건: {요건 content}" (A2 request 3).
   * v5.3 `focus: "fields"` (C-09 hint project_fields, A18): focus + highlight the empty name / role.
   */
  project: (id: Id, query?: { requirement_id?: Id; application_project_id?: Id; focus?: "fields" }) =>
    withQuery(`/career/projects/${id}`, query), // S-10
  projectDetailNew: (projectId: Id) => `/career/projects/${projectId}/details/new`, // S-35
  /** S-35; `focus` moves focus to a STAR field (C-02 "원본으로 이동") */
  projectDetail: (projectId: Id, detailId: Id, focus?: ProjectDetailField, achievement?: Id) =>
    withQuery(`/career/projects/${projectId}/details/${detailId}`, { focus, achievement }), // S-35 (`achievement` → S-11 open)
  skills: () => "/career/skills", // S-12
  /**
   * S-36 new chat. mode/project/affiliation ids only. From the C-09 gate also
   * `application_project_id` + `feature` (FL-13: "URL에는 지원 프로젝트 ID와 기능 이름만");
   * the in-progress settings travel in session storage (return-target.ts).
   */
  writingChatNew: (query?: {
    mode?: "new_project" | "augment_project"
    project_id?: Id
    experience_id?: Id
    education_id?: Id
    application_project_id?: Id
    feature?: "insight" | "career_description" | "cover_letter" | "job_interview"
  }) => withQuery("/career/writing-chats/new", query), // S-36
  writingChat: (id: Id) => `/career/writing-chats/${id}`, // S-36

  // 기업 JD 관리 — A3
  applications: () => "/applications", // S-13
  applicationNew: (query?: { from?: "board" }) => withQuery("/applications/new", query), // S-14
  application: (id: Id) => `/applications/${id}`, // S-31
  /**
   * S-15. Q53-2 · 9 from a C-20 "입력 원인 실패의 이동": `edit: 1` opens 공고 원문 수정, `from` picks the
   * "{기능}으로 돌아가기" link (`draft` for S-18), `cause` is the failure shown on a JD that has requirements.
   */
  applicationJd: (
    id: Id,
    query?: { edit?: 1; from?: "insight" | "drafts" | "questions" | "interview"; draft?: Id; cause?: "not_a_jd" | "input_too_long" | "safety_blocked" },
  ) => withQuery(`/applications/${id}/jd`, query), // S-15
  applicationInsight: (id: Id) => `/applications/${id}/insight`, // S-16
  applicationDrafts: (id: Id) => `/applications/${id}/drafts`, // S-17
  draftQuestions: (id: Id, draftId: Id) => `/applications/${id}/drafts/${draftId}/questions`, // S-18
  draft: (id: Id, draftId: Id) => `/applications/${id}/drafts/${draftId}`, // S-19

  // 면접 · 보드 — A4
  interviewPrep: (id: Id, type?: InterviewType) =>
    withQuery(`/applications/${id}/interview`, { type }), // S-20
  interviewSession: (id: Id, sessionId: Id) => `/applications/${id}/interview/${sessionId}`, // S-33
  interviewResult: (id: Id, sessionId: Id) =>
    `/applications/${id}/interview/${sessionId}/result`, // S-22
  interviews: () => "/interviews", // S-37
  board: () => "/board", // S-39

  // 설정 — A1
  settings: () => "/settings", // S-24
  /**
   * S-40 AI 연결 (page; the settings dialog has the same section "AI 연결").
   * `provider` → `#provider-card-{provider}` (C-19 경고 배지 → 해당 카드, UQ-208 / A1 UQ-267).
   */
  aiConnection: (provider?: "gemini" | "anthropic" | "openai") =>
    provider ? `/settings/ai#provider-card-${provider}` : "/settings/ai", // S-40
  /** S-42 AI 사용량 (page; dialog section "AI 사용량") */
  aiUsage: () => "/settings/ai/usage", // S-42
  /**
   * S-41 키 연결 단계 (focus screen outside the shell, leader decision Q-5).
   * `provider` omitted → 공급자 선택; `mode` = replace (③만) / tier (①②만); `activate` → 끝나면
   * 그 공급자를 활성으로 지정 (`activate=1`, A1 request 2); ids/values only.
   */
  aiConnect: (query?: { provider?: "gemini" | "anthropic" | "openai"; mode?: "replace" | "tier"; activate?: boolean }) =>
    withQuery("/settings/ai/connect", query && { provider: query.provider, mode: query.mode, activate: query.activate ? 1 : undefined }), // S-41
  withdraw: () => "/settings/withdraw", // S-25
  /**
   * S-25 탈퇴 마무리 (v5.3 A7, G-38 셸 밖 `(public)` 레이아웃). The deletion guard's only exempt
   * account path. `previewState` keeps `?state=` (e.g. "deletion-incomplete").
   */
  withdrawFinalize: (previewState?: string | null) =>
    previewState ? `/settings/withdraw/finalize?state=${encodeURIComponent(previewState)}` : "/settings/withdraw/finalize",
} as const

/** L-01 left menu, fixed order (UX-1, U-4) */
export type MenuKey = "career" | "applications" | "interviews" | "board"

export const MENU_ITEMS: ReadonlyArray<{ key: MenuKey; label: string; href: string }> = [
  { key: "career", label: "커리어", href: routes.career() },
  { key: "applications", label: "기업 JD 관리", href: routes.applications() },
  { key: "interviews", label: "모의 면접", href: routes.interviews() },
  { key: "board", label: "지원 현황", href: routes.board() },
]

/** Active-menu rule (L-01): application sub-screens (S-14~S-22, S-31, S-33) → 기업 JD 관리 */
export function menuKeyForPath(pathname: string): MenuKey | null {
  if (pathname.startsWith("/career")) return "career"
  if (pathname.startsWith("/applications")) return "applications"
  if (pathname.startsWith("/interviews")) return "interviews"
  if (pathname.startsWith("/board")) return "board"
  return null
}

/** `contractSafeNextPath` answers this when it refuses (a value no path can be) */
const REFUSED = "\u0000refused"

/**
 * The one check for "원래 URL" (`?next=`) on screens and component actions. QA-W5-08: the server's check
 * (`lib/contracts/routes.ts`) runs first, so both refuse the same values (open redirects, control characters,
 * `/auth/callback`, over 512 chars) and normalize the path the same way. On top of it, never the auth screens
 * themselves (S-02/S-03, and below them) which would loop (A1 UQ-99). Moved from components/account/account-data.ts.
 */
export function safeNextPath(next: unknown): string | null {
  const value = Array.isArray(next) ? next[0] : next
  if (typeof value !== "string") return null
  const safe = contractSafeNextPath(value, REFUSED)
  if (safe === REFUSED) return null
  const pathname = safe.split(/[?#]/)[0]
  for (const authPath of ["/sign-in", "/consent"]) {
    if (pathname === authPath || pathname.startsWith(`${authPath}/`)) return null
  }
  return safe
}
