/**
 * 자소서 흐름의 **순수 헬퍼·문구·뷰 타입** — `server-only`가 아니다.
 *
 * `src/lib/data/cover-letters.ts`는 `import "server-only"`라서 클라이언트 컴포넌트가 거기서
 * 무언가를 import하면 `pnpm build`가 깨진다(A4가 실제로 겪었다). 화면이 쓰는 판정·셈·문구는
 * 데이터 접근과 성격이 다르므로 여기로 옮겼다 — 데이터 접근 함수(`listCoverLetters` ·
 * `saveCoverLetterDocument` 등)는 `cover-letters.ts`에 그대로 남는다.
 * 호환을 위해 `cover-letters.ts`가 이 모듈을 다시 내보낸다.
 */
import type { ApplicationDocument, CoverLetterBody, CountBasis, DateString, NameSource, Uuid } from "@/types/db"

// ---------------------------------------------------------------------------
// 문항 헬퍼
// ---------------------------------------------------------------------------

// (UQ-740) `seedCoverLetterQuestions`·`newCoverLetterQuestion(sortOrder)`는 지웠다 — 슬롯을
// 순서에서 계산해 "안정 키, 재사용 금지"(DM 2.5.1)를 어겼고 쓰는 곳도 없었다. 문항 폼과 슬롯 발급은
// `src/components/applications/cover-letter/question-form.ts`가 맡는다.

/** S-46 두 상태 판정 (CF-A11): 정본 행이 없으면 문항 설정, 있으면 작성 */
export type CoverLetterScreenState = "questions" | "writing"

export function coverLetterScreenState(doc: ApplicationDocument | null): CoverLetterScreenState {
  return doc ? "writing" : "questions"
}

/** 본문이 비어 있지 않은 문항 수 — 제목만 있는 문항은 세지 않는다 (CF-A4) */
export function filledSlotCount(body: CoverLetterBody): number {
  return body.questions.filter((q) => q.body.trim().length > 0).length
}

/** 글자 수 표시: 내용만 센다 (제목 제외, CF-6) */
export function countAnswerChars(body: string, countBasis: CountBasis): number {
  return countBasis === "without_spaces" ? body.replace(/\s/g, "").length : body.length
}

// ---------------------------------------------------------------------------
// S-39 카드 서류 표시 (UI 5, CF-3·CF-A14)
// ---------------------------------------------------------------------------

export interface CoverLetterSlotCounts {
  slot_count: number
  filled_slot_count: number
}

export type CoverLetterProgressLabel = null | "자소서 작성 중" | "자소서 작성됨"

/**
 * 표시 없음 = 행 없음 또는 `filled_slot_count = 0` / "자소서 작성 중" = 0 < filled < slot /
 * "자소서 작성됨" = filled = slot (slot > 0) — DM 2.7.3 `[가정]`(CF-A14).
 */
export function coverLetterProgressLabel(counts: CoverLetterSlotCounts | undefined): CoverLetterProgressLabel {
  if (!counts || counts.slot_count === 0 || counts.filled_slot_count === 0) return null
  return counts.filled_slot_count >= counts.slot_count ? "자소서 작성됨" : "자소서 작성 중"
}

// ---------------------------------------------------------------------------
// S-13 행 (UX v5.20 S-13 "행")
// ---------------------------------------------------------------------------

export interface CoverLetterListRow {
  id: Uuid
  /** `application_projects.name` 그대로 — 화면은 이름을 다시 만들지 않는다 (CF-A14) */
  name: string | null
  name_source: NameSource | null
  /** `job_descriptions.position_title` — 비면 줄 생략 */
  position_title: string | null
  created_at: string
  /** `application_projects.deadline` — 값이 있을 때만 D-day를 보인다 (CF-2·CF-9) */
  deadline: DateString | null
}

// ---------------------------------------------------------------------------
// 문구
// ---------------------------------------------------------------------------

/**
 * CF-10 확정 문구 — 가져오기 실패 코드 6종(`invalid_source_url`·`fetch_blocked`·`fetch_timeout`·
 * `fetch_too_large`·`fetch_too_short`·`fetch_failed`)을 화면에서 나누지 않는다 (UX S-14).
 */
export const JD_FETCH_FAILED_MESSAGE = "이 공고는 가져오지 못했어요. 내용을 직접 붙여넣어 주세요"

/** A12 글자 수 범위 안내 (UX S-46 문항 설정 상태·문항 편집) */
export const CHAR_LIMIT_A12_NOTE =
  "AI는 제한의 90~110% 안으로 맞춰요. 최대 10%까지 넘을 수 있으니 제출 전에 글자 수를 확인해 주세요"

/** 문항 설정 상태 안내 1줄 `[UI-가정]` (UX S-46) */
export const QUESTION_SETUP_NOTE = "지원서에 있는 문항과 글자 수를 그대로 넣어 주세요. 문항은 나중에도 고칠 수 있어요"

/** 자소서 탭 안내 1줄 `[UI-가정]` + G-2 민감정보 문구 (NFR-AI-01·02) */
export const ANSWER_NOTE = "문항 답변은 모아 둔 커리어와 공고 요건을 근거로 써요. 지어낸 경험·수치는 넣지 않아요"

/** 문항 상한 안내 (v5.20, CF-5) */
export const QUESTION_MAX_NOTE = "문항은 5개까지 추가할 수 있어요"

/** 마지막 1문항 (UX S-46 문항 편집) */
export const QUESTION_MIN_NOTE = "문항은 1개 이상 있어야 해요"
