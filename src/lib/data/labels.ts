/**
 * Display labels for enum values, shared by every area. Copy comes from the screen spec
 * (02-user-flows.md) and design-system.md 1.1.4 / 3.17; `[UI-가정]` marks labels the spec
 * doesn't give. Client-safe (no store access).
 */
import type {
  AiJobProgress,
  AiJobType,
  AiProgressStage,
  AiUsageFeature,
  ConnectionTier,
  ModelTier,
  ProviderKeyStatus,
  ApplicationStage,
  EducationType,
  EmploymentType,
  EnrollmentStatus,
  EvidenceSourceType,
  ProjectDetailField,
  RequirementMatchStatus,
  StageOutcome,
  WritingChatMode,
  WritingChatStatus,
  Competency,
  DeliverableSlot,
  ExperienceType,
  ProjectStarField,
  ProjectType,
  WritingKind,
} from "@/types/db"

/** 1.1.4 / S-39 열 순서 */
export const STAGE_ORDER: readonly ApplicationStage[] = [
  "before_apply",
  "document",
  "assignment",
  "closed",
]

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  before_apply: "지원 전",
  document: "서류 전형",
  assignment: "과제 전형",
  closed: "전형 종료",
}

export const OUTCOME_LABELS: Record<StageOutcome | "none", string> = {
  passed: "최종 합격",
  failed: "불합격",
  none: "결과 미기록",
}

/**
 * C-03 단계 문구 (02 C-03 v5.3, 데이터 모델 확정 키). extract/reply: 화면 표시는 선택.
 * Use aiStageLabel(jobType, progress) instead of reading this map directly.
 */
export const AI_STAGE_LABELS: Record<AiProgressStage, string> = {
  prepare: "공고 요건 정리 중",
  match: "요건 대조 중",
  synthesize: "강점·지원 방향 정리 중",
  validate: "근거 확인 중",
  rank: "쓸 경력·프로젝트 고르는 중",
  generate: "작성 중",
  adjust_length: "글자 수 맞추는 중",
  synthesize_regen: "강점·지원 방향 정리 중",
  // [UI-가정] extract/reply have no spec copy (AI-12 "화면 표시는 선택")
  extract: "정리 중",
  reply: "답하는 중",
}

/** C-03 단계 문구 for a job (02 C-03 v5.3): `synthesize_regen` = `synthesize`. `jobType` kept for the callers. */
export function aiStageLabel(
  jobType: AiJobType | null | undefined,
  progress: Pick<AiJobProgress, "stage" | "done" | "total"> | null | undefined,
): string {
  void jobType
  if (!progress) return "준비 중"
  return AI_STAGE_LABELS[progress.stage] ?? "준비 중"
}

/** S-42 기능별 표 기능 이름 (ai_usage_records.feature, 02 S-42) */
export const AI_USAGE_FEATURE_LABELS: Record<AiUsageFeature, string> = {
  jd_extraction: "요건 추출",
  insight: "인사이트",
  career_description: "경력기술서",
  cover_letter: "자소서 문항 답변", // 02 S-42 (D-UX-23)
  writing_chat: "AI 작성 대화",
  key_verification: "연결 확인",
  // [UI-가정] Should features, not shown in the display table
  writing_assist: "STAR 다듬기",
  chat_reply: "커리어 채팅",
}

/** C-19 등급 글자. UQ-262: paired form "무료 등급" / "유료 등급" (02 C-19 writes "Claude · 유료" — [UI-가정], 기획 확인) */
export const CONNECTION_TIER_LABELS: Record<ConnectionTier, string> = {
  free: "무료 등급",
  paid: "유료 등급",
}

/** C-19 결과 배지 단계 이름 (model_tier → 경량 / 기본 / 고성능) */
export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  light: "경량",
  default: "기본",
  heavy: "고성능",
}

/** S-40 키 상태 줄 */
export const KEY_STATUS_LABELS: Record<ProviderKeyStatus, string> = {
  valid: "연결됨",
  invalid: "키를 확인해 주세요",
  needs_check: "확인 필요",
}

export const MATCH_STATUS_LABELS: Record<RequirementMatchStatus, string> = {
  met: "충족",
  partial: "부분 충족",
  no_evidence: "근거 없음",
}

export const EDUCATION_TYPE_LABELS: Record<EducationType, string> = {
  degree: "학위 과정",
  course: "교육 과정",
}

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  enrolled: "재학·수강 중",
  graduated: "졸업",
  completed: "수료",
  dropped_out: "중퇴",
  on_leave: "휴학",
}

/** // [UI-가정] employment_type labels are not given in the screen spec */
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "정규직",
  contract: "계약직",
  freelance: "프리랜서",
  intern: "인턴",
  other: "기타",
}

export const WRITING_CHAT_MODE_LABELS: Record<WritingChatMode, string> = {
  new_project: "새 프로젝트",
  augment_project: "기존 프로젝트 보강",
}

export const WRITING_CHAT_STATUS_LABELS: Record<WritingChatStatus, string> = {
  active: "진행 중",
  saved: "저장 완료",
  handed_off: "폼으로 전환",
  abandoned: "그만둠",
}

/** STAR field names (C-01 "상세 내용 · {필드}", S-35 labels) */
export const DETAIL_FIELD_LABELS: Record<ProjectDetailField, string> = {
  title: "제목",
  situation: "상황",
  task: "과제",
  action: "행동",
  result: "결과",
  learnings: "회고 및 배운 점",
}

/** DM v4.4 `project` evidence source_field labels (CR-2: 역할 / 결과/성과 / 배운 점). */
export const PROJECT_EVIDENCE_FIELD_LABELS: Record<string, string> = {
  situation: "상황",
  task: "역할",
  action: "행동",
  result: "결과/성과",
  learnings: "배운 점",
  role: "담당 업무",
  description: "프로젝트 내용",
}

/** C-01 칩 종류 라벨 */
export const EVIDENCE_KIND_LABELS: Record<EvidenceSourceType, string> = {
  profile: "기본 프로필",
  experience: "경력",
  education: "교육",
  project: "프로젝트",
  project_deliverable: "산출물",
  project_detail: "상세 내용",
  achievement: "삭제된 근거", // 정량 성과 폐기 (CR-11, UQ-430): an old row only ever shows as deleted
  skill: "스킬",
  jd_requirement: "JD 요건",
  jd_sentence: "공고 원문",
  user_note: "내 메모",
}

/**
 * C-01 kind part of the label. project_detail → "상세 내용 · {필드}";
 * learnings → "회고 및 배운 점" only (02 C-01 회고 구분).
 */
export function evidenceKindLabel(sourceType: EvidenceSourceType, sourceField: string | null): string {
  // DM v4.4: STAR lives on projects — "프로젝트 · 행동"; learnings → "배운 점" (CR-2).
  if (sourceType === "project" && sourceField && sourceField in PROJECT_EVIDENCE_FIELD_LABELS) {
    if (sourceField === "learnings") return PROJECT_EVIDENCE_FIELD_LABELS.learnings!
    return `${EVIDENCE_KIND_LABELS.project} · ${PROJECT_EVIDENCE_FIELD_LABELS[sourceField]}`
  }
  if (sourceType === "project_detail") {
    if (sourceField === "learnings") return DETAIL_FIELD_LABELS.learnings
    const field = sourceField && sourceField in DETAIL_FIELD_LABELS ? DETAIL_FIELD_LABELS[sourceField as ProjectDetailField] : null
    return field ? `${EVIDENCE_KIND_LABELS.project_detail} · ${field}` : EVIDENCE_KIND_LABELS.project_detail
  }
  return EVIDENCE_KIND_LABELS[sourceType]
}

/** 'YYYY-MM-DD' → '2024.03' */
export function formatMonth(value: string | null | undefined): string {
  if (!value) return ""
  return value.slice(0, 7).replace("-", ".")
}

/** 기간 "2021.03 ~ 재직 중" */
export function formatPeriod(start: string | null, end: string | null, ongoingLabel?: string): string {
  if (!start && !end) return ""
  const s = formatMonth(start)
  const e = end ? formatMonth(end) : ongoingLabel ?? ""
  return e ? `${s} ~ ${e}` : s
}

/**
 * v5.5 기간 "2023.11 - 2025.09" (C-25 · S-09 · S-34 · S-43). `ongoing` → "현재";
 * an open end that isn't ongoing → "2023.11 -". No start month → "".
 */
export function formatRange(start: string | null, end: string | null, ongoing = false): string {
  if (!start) return ""
  const s = formatMonth(start)
  if (ongoing) return `${s} - 현재`
  return end ? `${s} - ${formatMonth(end)}` : `${s} -`
}

/** C-25 개월 수, both ends counted: 2023.11~2025.09 → "1년 11개월". Needs both months. */
export function formatMonthSpan(start: string | null, end: string | null): string {
  if (!start || !end) return ""
  const months = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + (Number(end.slice(5, 7)) - Number(start.slice(5, 7))) + 1
  if (months < 1) return ""
  const y = Math.floor(months / 12)
  const m = months % 12
  return [y ? `${y}년` : null, m ? `${m}개월` : null].filter(Boolean).join(" ")
}

const KST_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })

/** "2026-10-28" — calendar date in KST (UQ-234). Date-only strings ("2026-10-28") pass through. */
export function kstDateString(iso: string | Date): string {
  if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  return KST_DATE.format(typeof iso === "string" ? new Date(iso) : iso)
}

/** Today in KST ("2026-10-28") */
export function kstToday(): string {
  return kstDateString(new Date())
}

/**
 * "서류 초안 수" (S-13 · S-31 · S-39, C-05 N): 경력기술서 `composing` (첫 생성 중단, Q53-7) has no user
 * content and isn't counted. 자소서 `composing` holds written questions and is.
 */
/**
 * "서류가 있다"의 셈법. R15 (DM v4.13 (7), CF-A14): a 자기소개서 정본 counts when at least one
 * question has a written answer — `filled_slot_count > 0`. There is at most one row per
 * 지원 프로젝트, so the count is 0 or 1.
 *
 * The old `drafts` shape (`{draft_type, status}`) is still accepted so the retired 서류 screens
 * S-17 / S-19 keep compiling on `?state=` previews (leader decision 2026-11-09). `[가정]`
 */
export function countsAsDraft(d: { filled_slot_count: number } | { draft_type: string; status: string }): boolean {
  if ("filled_slot_count" in d) return d.filled_slot_count > 0
  return !(d.draft_type === "career_description" && d.status === "composing")
}

/** Default name "새 자기소개서 (2026-10-28)" (S-14, KST date; R4 CR-23 [가정] = private.application_default_name) */
export function defaultApplicationName(createdAt: string | Date): string {
  return `새 자기소개서 (${kstDateString(createdAt)})`
}

/** application_projects.name display: null → "새 자기소개서", default → "새 자기소개서 (날짜)" (S-14 [가정], KST, CR-23) */
export function applicationDisplayName(name: string | null, nameSource: string | null, createdAt?: string): string {
  if (!name) return "새 자기소개서"
  if (nameSource === "default" && createdAt) return defaultApplicationName(createdAt)
  return name
}

/** HH:MM in KST (C-06 "저장됨 HH:MM"); fixed time zone so server and client agree (UQ-22) */
export function formatTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }).format(d)
}

/** 2026.10.24 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ""
  return kstDateString(iso).replaceAll("-", ".")
}

/** "3시간 전" style relative time for last_activity_at */
export function formatRelative(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - Date.parse(iso))
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "방금"
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}일 전`
  return formatDate(iso)
}

/**
 * 으로/로 particle by final consonant (ㄹ받침 → 로). v5.3 (UQ-450): Latin words ending in a vowel /
 * l / r / y read without a 받침 ("Gemini로", "Claude로"); an upper-case acronym is read letter by letter
 * ("GPT로" = 지피티로, only M·N end in a 받침 → "으로"); digits by their Korean reading; anything else → "(으)로".
 */
export function directionParticle(word: string): string {
  const ch = word.trim().slice(-1)
  if (/[A-Z]{2}$/.test(word.trim())) return /[MN]/.test(ch) ? "으로" : "로"
  if (/[aeiouylrAEIOUYLR]/.test(ch)) return "로"
  if (/[0-9]/.test(ch)) return "036".includes(ch) ? "으로" : "로"
  const last = ch.charCodeAt(0)
  if (!(last >= 0xac00 && last <= 0xd7a3)) return "(으)로"
  const jong = (last - 0xac00) % 28
  return jong === 0 || jong === 8 ? "로" : "으로"
}

/** 을/를 particle by final consonant. Non-Hangul → "을(를)". */
export function objectParticle(word: string): string {
  const last = word.charCodeAt(word.length - 1)
  if (last < 0xac00 || last > 0xd7a3) return "을(를)"
  return (last - 0xac00) % 28 === 0 ? "를" : "을"
}

/** 을/를 for a display name that may end in ")" or a digit (기본 이름 "새 자기소개서 (2026-11-05)"): digits are read in Korean */
function nameObjectParticle(name: string): string {
  const core = name.trim().replace(/[)\]'"\s]+$/, "")
  const ch = core.slice(-1)
  if (/[0-9]/.test(ch)) return "013678".includes(ch) ? "을" : "를"
  return objectParticle(core)
}

/**
 * C-05 자기소개서 삭제 object phrase with the U36-7 overlap rule (UX v5.14, same as the S-31 title): a name that
 * already contains "자기소개서" doesn't get " 자기소개서" again. quoted → dialog first line, plain → toast.
 */
export function applicationObjectPhrase(name: string, { quoted }: { quoted: boolean }): string {
  const shown = quoted ? `'${name}'` : name
  return name.includes("자기소개서") ? `${shown}${nameObjectParticle(name)}` : `${shown} 자기소개서를`
}

/**
 * 자기소개서 삭제 성공 토스트 (S-13 · S-31 · S-39 공통). UX v5.15 토스트 목록 (U38-1)
 */
export function applicationDeletedToast(name: string): string {
  return `${applicationObjectPhrase(name, { quoted: false })} 삭제했어요`
}

/** ST-SAVE-FAILED 제출형 (design-system 4장, 리더 결정 UQ-128): "{대상}을(를) 저장하지 못했어요. 입력한 내용은 그대로 있어요" */
export function submitFailedMessage(target: string): string {
  return `${target}${objectParticle(target)} 저장하지 못했어요. 입력한 내용은 그대로 있어요`
}

/** 대상 없는 동작(탈퇴·삭제·제출 등): "{동작}하지 못했어요. 잠시 후 다시 시도해 주세요" */
export function actionFailedMessage(action: string): string {
  return `${action}하지 못했어요. 잠시 후 다시 시도해 주세요`
}

/**
 * F-COM-03 v4 Resumate 원칙 (AI 학습 고지): settings, policies, sign-up consent and C-21 all use
 * this one constant (UQ-209). Call sites that end a sentence append ".".
 */
export const AI_TRAINING_NOTICE =
  "Resumate는 내 데이터를 AI 학습에 쓰지 않아요. 공급자의 데이터 사용은 연결한 공급자·등급의 정책을 따라요"

/**
 * UQ-350 — FL-19 "{원래 기능}으로 돌아가기" / S-40 "{원래 기능}으로 돌아가려면 …" feature names.
 * One fixed map (leader decision, [UI-가정] pending planning B-24). Buttons' own labels are never
 * used for this sentence.
 * Particles: directionParticle(name).
 */
export const AI_FEATURE_NAMES = {
  requirements: "요건 정리",
  insight: "인사이트",
  career_description: "경력기술서",
  // UX v5.14 U36-6: C-18 기능 이름 = "자소서 문항 답변" ("자기소개서"는 지원 건 이름, CR-23)
  cover_letter: "자소서 문항 답변",
  // R15 (CL-2): "AI 근거 선택" removed — AI-11 is retired (CF-1). The `draft_source_ranking`
  // job_type / feature value stays in the DB CHECK for rows already recorded (CF-A3).
  writing_chat: "AI 작성 대화",
  // [UI-가정] S-42 entry (not in the leader list)
  usage: "AI 사용량",
} as const

export type AiFeatureKey = keyof typeof AI_FEATURE_NAMES

/** "인사이트로 돌아가기" */
export function returnToFeatureLabel(key: AiFeatureKey): string {
  const name = AI_FEATURE_NAMES[key]
  return `${name}${directionParticle(name)} 돌아가기`
}

// ---------------------------------------------------------------------------
// v5.6 S-10 · S-44 (PRD F-P1-19 / CR-17 표시명, DM 2.3 키 → 표시명)
// ---------------------------------------------------------------------------

/** projects.project_type → 화면 "프로젝트 종류" (C-25 카드 태그) */
export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  new_build: "신규 구축",
  improvement: "개선·고도화",
  operation: "운영·유지보수",
  research: "분석·리서치",
  marketing: "마케팅·캠페인",
  process_improvement: "프로세스·조직 개선",
  migration: "전환·마이그레이션",
  coursework: "교육·학습 과제",
  other: "기타",
}

/** projects.experience_type → 화면 "경험 유형" */
export const EXPERIENCE_TYPE_LABELS: Record<ExperienceType, string> = {
  impact: "성과 창출",
  problem_solving: "문제 해결",
  collaboration: "협업·갈등 조정",
  leadership: "주도·리딩",
  failure_recovery: "실패·극복",
  new_challenge: "새로운 시도",
  customer_facing: "고객·사용자 대응",
}

/** projects.competencies 원소 → 화면 "역량" */
export const COMPETENCY_LABELS: Record<Competency, string> = {
  problem_solving: "문제 해결력",
  analysis: "분석력",
  planning: "기획력",
  execution: "실행력",
  communication: "커뮤니케이션",
  collaboration: "협업",
  leadership: "리더십",
  technical_expertise: "기술 전문성",
  customer_insight: "고객 이해",
  learning_agility: "학습 민첩성",
}

/** S-10 STAR 칸 제목 (한글 · 영문, CR-2) */
export const STAR_FIELD_LABELS: Record<ProjectStarField, { ko: string; en: string }> = {
  situation: { ko: "상황", en: "Situation" },
  task: { ko: "역할", en: "Task" },
  action: { ko: "행동", en: "Action" },
  result: { ko: "결과/성과", en: "Result" },
  learnings: { ko: "배운 점", en: "Insights" },
}

/** structured_draft.writing_kind (AI-13 종류 표시명) */
export const WRITING_KIND_LABELS: Record<WritingKind, string> = {
  planning_summary: "기획서 요약",
  design_doc: "설계 문서",
  retrospective: "회고",
  presentation: "발표",
  other: "기타",
}

/**
 * AI-13 종류별 슬롯 (위에서부터 묻는 순서, 슬롯 3 = 본인 기여 필수). Display names = the AI spec's slot table,
 * keys = the AI-13 output schema's 19 `facts[].slot` keys. 회고 슬롯 1 reuses `scope` (no separate key in the list).
 */
export const DELIVERABLE_SLOTS_BY_KIND: Record<WritingKind, ReadonlyArray<{ slot: DeliverableSlot; label: string }>> = {
  planning_summary: [
    { slot: "background", label: "배경·해결할 문제" },
    { slot: "goal", label: "목표·대상 사용자" },
    { slot: "contribution", label: "본인이 맡은 부분" },
    { slot: "scope", label: "핵심 기능·범위" },
    { slot: "outcome", label: "결과·검증" },
  ],
  design_doc: [
    { slot: "requirements", label: "해결할 문제·요구사항" },
    { slot: "structure", label: "구조(구성 요소·흐름)" },
    { slot: "contribution", label: "본인이 맡은 부분" },
    { slot: "decisions", label: "주요 결정과 대안·이유" },
    { slot: "limits", label: "결과·한계" },
  ],
  retrospective: [
    { slot: "scope", label: "무엇을 했나(범위)" },
    { slot: "went_well", label: "잘된 점" },
    { slot: "contribution", label: "본인이 맡은 부분" },
    { slot: "went_wrong", label: "아쉬운 점·원인" },
    { slot: "learnings", label: "배운 점·다음에 다르게 할 점" },
  ],
  presentation: [
    { slot: "audience", label: "발표 자리·청중" },
    { slot: "message", label: "핵심 메시지" },
    { slot: "contribution", label: "본인이 맡은 부분" },
    { slot: "outline", label: "구성" },
    { slot: "reaction", label: "반응·결과" },
  ],
  other: [
    { slot: "what", label: "어떤 결과물인가" },
    { slot: "purpose", label: "목적" },
    { slot: "contribution", label: "본인이 맡은 부분" },
    { slot: "content", label: "주요 내용" },
    { slot: "outcome", label: "결과" },
  ],
}

/** "아직 비어 있는 부분: {슬롯 표시명}" — the kind's label first, then any kind, then the raw key. */
export function deliverableSlotLabel(slot: string, kind: WritingKind | null): string {
  const own = kind ? DELIVERABLE_SLOTS_BY_KIND[kind].find((s) => s.slot === slot) : undefined
  if (own) return own.label
  for (const list of Object.values(DELIVERABLE_SLOTS_BY_KIND)) {
    const hit = list.find((s) => s.slot === slot)
    if (hit) return hit.label
  }
  return slot
}

/** C-25 "(1년 11개월)" with the 진행 중 rule: `is_current` counts to this month (KST). 'YYYY-MM-DD' or 'YYYY-MM'. */
export function projectSpanLabel(start: string | null, end: string | null, isCurrent: boolean, today = kstToday()): string {
  if (!start) return ""
  const last = isCurrent ? today : end
  const span = formatMonthSpan(start, last)
  return span ? `(${span})` : ""
}
