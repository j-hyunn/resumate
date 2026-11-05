/**
 * Route tree for every screen (S-xx). Build links with these helpers instead of string
 * literals so areas link to each other through one place (foundation-owned).
 *
 * Query strings carry only non-personal values (spec: C-14 "쿼리에는 유형 값만",
 * FL-13 "URL에는 지원 프로젝트 ID와 기능 이름만").
 */
import type { InterviewType, PolicyType, ProjectStarField } from "@/types/db"
import { safeNextPath as contractSafeNextPath } from "@/lib/contracts/routes"
import type { SettingsSectionId } from "@/components/account/settings-section-list"

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
  /** S-30: one page per policy document (default 개인정보 처리방침) */
  policies: (doc: PolicyType = "privacy") => `/policies/${doc}`, // S-30

  // 커리어 — A2
  career: () => "/career", // S-08
  profile: () => "/career/profile", // S-04
  /**
   * S-08 with the C-22 add modal open for `kind` (`?new={kind}`, [UI-가정]) — S-09 새 경력 is that modal (OD-C2).
   * The retired `/career/experiences/new` · `/career/educations/new` pages redirect here.
   */
  careerNew: (kind: "experience" | "education" | "project") => `/career?new=${kind}`, // S-08 (S-09 · S-34 · S-43 새 항목)
  skills: () => "/career/skills", // S-12
  // --- v5.6 L-02 (S-10 · S-44, PA-1·PA-3). A2 moves the S-10 / S-44 pages into `(page)`; ids only in queries ---
  /** S-08 with one item selected in the right panel (`?item={kind}:{id}`, S-09 / S-34 / S-43) */
  careerItem: (kind: "experience" | "education" | "project", id: Id, query?: { edit?: "content" }) =>
    // `edit` [UI-가정] = open the S-43 edit on arrival (C-09 project_fields → 내용)
    `/career?item=${kind}:${id}${query?.edit ? `&edit=${query.edit}` : ""}`, // S-08
  /**
   * S-10 새 프로젝트 (UX v5.6 URL [가정]): `?experience={id}` or `?education={id}`; `requirement_id` = S-16 관련 요건
   */
  projectPageNew: (affiliation: ({ experience: Id } | { education: Id }) & { requirement_id?: Id }) => withQuery("/career/projects/new", affiliation), // S-10
  /**
   * S-10 프로젝트 상세. `chat` = the open panel chat (`?chat=`, [가정]); `focus` = a STAR 칸 (C-02 → that 칸) or
   * `star` (C-09 project_star → the first empty STAR 칸); `requirement_id` = S-16 관련 요건.
   */
  projectPage: (id: Id, query?: { chat?: Id; focus?: ProjectStarField | "star"; requirement_id?: Id }) => withQuery(`/career/projects/${id}`, query), // S-10
  /** S-44 새 산출물 (`/career/projects/{project_id}/deliverables/new`, [가정]) */
  deliverableNew: (projectId: Id) => `/career/projects/${projectId}/deliverables/new`, // S-44
  /**
   * S-44 산출물 상세; `chat` = the open panel chat; `range` = C-02 근거 구간 강조 — `source_locator {start, end}`
   * as `?range={start}-{end}` (character offsets in the body) [UI-가정]. S-44 parses it with `parseRangeParam`.
   */
  deliverable: (id: Id, query?: { chat?: Id; range?: { start: number; end: number } | null }) =>
    withQuery(`/career/deliverables/${id}`, { chat: query?.chat, range: query?.range ? `${query.range.start}-${query.range.end}` : undefined }), // S-44
  /**
   * A writing chat by id when its target isn't known here (C-09 "이어서 대화하기"): the retired S-36 path is a
   * redirect to that chat's S-10 / S-44 panel (`?chat=`).
   */
  writingChatRedirect: (id: Id) => `/career/writing-chats/${id}`, // → S-10 / S-44

  // 자기소개서 관리 — A3
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
  /**
   * S-22 of a "자기소개서 삭제됨" session (OD-I6, U36-1): under 모의 면접, keyed by the session only (its
   * application_project_id is null). No S-33 / S-20 address for such a session. A live session opened here is
   * redirected to `interviewResult`; `/applications/{id}/interview/{sessionId}[/result]` of a deleted one comes here.
   */
  interviewDeletedResult: (sessionId: Id) => `/interviews/${sessionId}/result`, // S-22 (자기소개서 삭제됨)
  board: () => "/board", // S-39

  // 설정 — A1
  /**
   * S-24 설정 다이얼로그 (S-40 AI 연결 · S-42 AI 사용량 are its sections; there are no settings
   * pages). Inside a shell use <SettingsLink> / openSettings(): it opens the dialog in place. This URL
   * is the fallback for screens without the dialog (S-41 focus screen, S-25 취소): S-08 with
   * `?settings={section}` — the shell opens the dialog on that section and drops the query.
   * `provider` scrolls to that S-40 card (C-19 경고 배지 → 해당 카드, UQ-208 / UQ-267).
   */
  settings: (section?: SettingsSectionId, provider?: "gemini" | "anthropic" | "openai") =>
    withQuery("/career", { settings: section ?? "account", provider }), // S-24 · S-40 · S-42
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
  { key: "applications", label: "자기소개서 관리", href: routes.applications() },
  { key: "interviews", label: "모의 면접", href: routes.interviews() },
  { key: "board", label: "지원 현황", href: routes.board() },
]

/** Active-menu rule (L-01): application sub-screens (S-14~S-22, S-31, S-33) → 자기소개서 관리; `/interviews/{id}/result` (자기소개서 삭제됨 S-22) → 모의 면접 */
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

/** S-44 `?range={start}-{end}` → `{start, end}` (null when absent / malformed / empty). */
export function parseRangeParam(value: string | string[] | null | undefined): { start: number; end: number } | null {
  const v = Array.isArray(value) ? value[0] : value
  const m = typeof v === "string" ? /^(\d+)-(\d+)$/.exec(v) : null
  if (!m) return null
  const start = Number(m[1])
  const end = Number(m[2])
  return end > start ? { start, end } : null
}
