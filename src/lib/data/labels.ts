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
  CriterionGrade,
  EducationType,
  EmploymentType,
  EnrollmentStatus,
  EvidenceSourceType,
  InterviewSessionStatus,
  InterviewType,
  ProjectDetailField,
  RequirementMatchStatus,
  StageOutcome,
  WritingChatMode,
  WritingChatStatus,
} from "@/types/db"

/** 1.1.4 / S-39 열 순서 */
export const STAGE_ORDER: readonly ApplicationStage[] = [
  "before_apply",
  "document",
  "assignment",
  "job_interview",
  "culture_fit_interview",
  "closed",
]

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  before_apply: "지원 전",
  document: "서류 전형",
  assignment: "과제 전형",
  job_interview: "직무 인터뷰 전형",
  culture_fit_interview: "컬처핏 전형",
  closed: "전형 종료",
}

export const OUTCOME_LABELS: Record<StageOutcome | "none", string> = {
  passed: "최종 합격",
  failed: "불합격",
  none: "결과 미기록",
}

/**
 * C-03 단계 문구 (02 C-03 v5.3, 데이터 모델 확정 키). extract/reply: 화면 표시는 선택.
 * `prepare` depends on the job (채점은 "채점 준비 중"), interview `generate` adds "(n/N)",
 * `complete` has no copy — use aiStageLabel(jobType, progress) instead of reading this map directly.
 */
export const AI_STAGE_LABELS: Record<AiProgressStage, string> = {
  prepare: "공고 요건 정리 중",
  match: "요건 대조 중",
  synthesize: "강점·지원 방향 정리 중",
  validate: "근거 확인 중",
  rank: "쓸 경력·프로젝트 고르는 중",
  generate: "작성 중",
  adjust_length: "글자 수 맞추는 중",
  evaluate: "답변 채점 중",
  summarize: "종합 평가 정리 중",
  score: "점수 계산 중",
  synthesize_regen: "강점·지원 방향 정리 중",
  // `complete` keeps the previous stage's copy; this fallback is only used without a job type
  complete: "마무리 중",
  // [UI-가정] extract/reply have no spec copy (AI-12 "화면 표시는 선택")
  extract: "정리 중",
  reply: "답하는 중",
}

/** Stage shown for `complete` per job (02 C-03: 직전 단계 문구 유지) */
const COMPLETE_AS: Partial<Record<AiJobType, AiProgressStage>> = {
  interview_questions: "generate",
  interview_evaluation: "score",
  insight: "validate",
}

/**
 * C-03 단계 문구 for a job (02 C-03 v5.3): 채점 `prepare` "채점 준비 중", 면접 질문 `generate`
 * "질문 만드는 중 (n/N)", `synthesize_regen` = `synthesize`, `complete` = the previous stage's copy.
 */
export function aiStageLabel(
  jobType: AiJobType | null | undefined,
  progress: Pick<AiJobProgress, "stage" | "done" | "total"> | null | undefined,
): string {
  if (!progress) return "준비 중"
  const stage = progress.stage === "complete" && jobType ? (COMPLETE_AS[jobType] ?? "complete") : progress.stage
  if (stage === "prepare" && jobType === "interview_evaluation") return "채점 준비 중"
  if (stage === "generate" && jobType === "interview_questions") {
    const total = progress.total
    const done = progress.stage === "complete" ? total : progress.done
    return total ? `질문 만드는 중 (${done ?? 0}/${total})` : "질문 만드는 중"
  }
  return AI_STAGE_LABELS[stage]
}

/** S-42 기능별 표 기능 이름 (ai_usage_records.feature, 02 S-42) */
export const AI_USAGE_FEATURE_LABELS: Record<AiUsageFeature, string> = {
  jd_extraction: "요건 추출",
  insight: "인사이트",
  career_description: "경력기술서",
  cover_letter: "자기소개서",
  interview_questions: "면접 질문",
  interview_evaluation: "면접 채점",
  writing_chat: "AI 작성 대화",
  key_verification: "연결 확인",
  // [UI-가정] Should features, not shown in the 8-row table
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

export const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = {
  job: "직무 면접",
  culture_fit: "컬처핏 면접",
}

/** S-20 / S-37 세션 상태 */
export const SESSION_STATUS_LABELS: Record<InterviewSessionStatus, string> = {
  in_progress: "작성 중",
  evaluating: "채점 중",
  completed: "완료",
  evaluation_failed: "채점 실패",
  abandoned: "그만둠",
}

export const MATCH_STATUS_LABELS: Record<RequirementMatchStatus, string> = {
  met: "충족",
  partial: "부분 충족",
  no_evidence: "근거 없음",
}

/** C-17 항목 등급 — // [UI-가정] labels not in spec (design-system P-2) */
export const GRADE_LABELS: Record<CriterionGrade, string> = {
  excellent: "매우 좋음",
  good: "좋음",
  fair: "보통",
  poor: "부족",
  not_applicable: "해당 없음",
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

/** C-01 칩 종류 라벨 */
export const EVIDENCE_KIND_LABELS: Record<EvidenceSourceType, string> = {
  profile: "기본 프로필",
  experience: "경력",
  education: "교육",
  project: "프로젝트",
  project_detail: "상세 내용",
  achievement: "정량 성과",
  skill: "스킬",
  jd_requirement: "JD 요건",
  jd_sentence: "공고 원문",
  interview_answer: "내 답변",
  user_note: "내 메모",
}

/**
 * C-01 kind part of the label. project_detail → "상세 내용 · {필드}";
 * learnings → "회고 및 배운 점" only (02 C-01 회고 구분).
 */
export function evidenceKindLabel(sourceType: EvidenceSourceType, sourceField: string | null): string {
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
export function countsAsDraft(d: { draft_type: string; status: string }): boolean {
  return !(d.draft_type === "career_description" && d.status === "composing")
}

/** "면접 세션 수" (S-13 · S-31 · S-39): 질문 0개인 그만둔 세션 제외 (Q53-9) [가정 명세] */
export function countsAsInterview(s: { status: string }, savedQuestions: number): boolean {
  return !(s.status === "abandoned" && savedQuestions === 0)
}

/** Default JD name "새 기업 JD (2026-10-28)" (S-14, KST date) */
export function defaultApplicationName(createdAt: string | Date): string {
  return `새 기업 JD (${kstDateString(createdAt)})`
}

/** application_projects.name display: null → "새 기업 JD", default → "새 기업 JD (날짜)" (S-14 [가정], KST) */
export function applicationDisplayName(name: string | null, nameSource: string | null, createdAt?: string): string {
  if (!name) return "새 기업 JD"
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
 * l / r / y read without a 받침 ("Gemini로", "Claude로", "OpenAI로"); digits by their Korean
 * reading; anything else → "(으)로".
 */
export function directionParticle(word: string): string {
  const ch = word.trim().slice(-1)
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

/** S-42 displayed "입력 토큰" = input + cache read + cache write (UQ-203, see ai-usage.ts) */
export function displayInputTokens(t: { input_tokens: number; cached_input_tokens: number; cache_write_tokens: number }): number {
  return t.input_tokens + t.cached_input_tokens + t.cache_write_tokens
}

/**
 * UQ-350 — FL-19 "{원래 기능}으로 돌아가기" / S-40 "{원래 기능}으로 돌아가려면 …" feature names.
 * One fixed map (leader decision, [UI-가정] pending planning B-24). Buttons' own labels are never
 * used for this sentence; S-20 is always "면접 질문 생성" whatever the entry point.
 * Particles: directionParticle(name).
 */
export const AI_FEATURE_NAMES = {
  requirements: "요건 정리",
  insight: "인사이트",
  career_description: "경력기술서",
  cover_letter: "자기소개서",
  draft_source_ranking: "AI 근거 선택",
  interview_questions: "면접 질문 생성",
  interview_evaluation: "면접 채점",
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
