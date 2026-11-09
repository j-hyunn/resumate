import "server-only"
/**
 * 자기소개서 흐름 data layer (UX v5.20 S-13 · S-14 · S-46, DM v4.15 2.6.2 · 2.7.3).
 *
 * 백엔드 슬라이스 R15가 아직 없어 여기 함수는 **mock 분기만** 동작한다. real 분기는
 * `// 연결 대기 (<문서 위치>)`로 두고 `notWired()`를 던진다 — 이름·시그니처는 그대로 두고
 * 백엔드가 몸통만 바꾼다 (ui-context "Data layer"). 각 함수의 대기 상태는
 * `_workspace/ui/46_frontend-engineer-A0_report.md` "백엔드 요청"에 적혀 있다.
 *
 * **근거를 저장 요청에 싣지 않는다** (기획 PR #68 CF-S1): 문항 근거의 원천은 그 문항 초안
 * 제안의 `sources[]`이고, 저장 RPC가 `p_applied_proposals`로 받은 제안에서 `evidence_links`를
 * 만든다. 화면·데이터 계층은 근거 목록을 올려 보내지 않는다.
 */
import type {
  ApplicationDocument,
  ApplicationValuesPatch,
  AppliedProposalRef,
  CoverLetterBody,
  JdExtractPreview,
  JdFetchResult,
  SaveApplicationDocumentResult,
  Uuid,
} from "@/types/db"
import { AppError } from "@/lib/contracts/errors"
import { clone, mockRequest } from "@/lib/mock/store"
import { newId, USER_ID } from "@/lib/mock/ids"
import { activeKey, MockAiError } from "@/lib/mock/ai"
import { consentRequired } from "@/lib/mock/consent"
import {
  COVER_LETTER_MAX_QUESTIONS,
} from "./cover-letter-defaults"
import { composeCoverLetterName } from "./labels"
import { listApplicationProjects } from "./applications"
import { rememberJdPreview } from "./jd-preview-store"
import {
  filledSlotCount,
  JD_FETCH_FAILED_MESSAGE,
  type CoverLetterListRow,
  type CoverLetterSlotCounts,
} from "./cover-letter-copy"

/**
 * 순수 헬퍼·문구·뷰 타입은 **`./cover-letter-copy`**(server-only 아님)에 있다 — 클라이언트
 * 컴포넌트가 이 파일에서 import하면 `pnpm build`가 깨지기 때문이다. 기존 import 경로를 지키려고
 * 여기서 다시 내보낸다.
 */
export * from "./cover-letter-copy"
import { previewOr } from "./source"

/** real 분기가 아직 없는 함수의 공통 거부 — 화면은 ST-ERROR로 떨어진다 */
function notWired(what: string): never {
  throw new AppError("wiring_pending", `${what}은(는) 아직 백엔드에 연결되지 않았어요`, { status: 503, details: { what } })
}

// ---------------------------------------------------------------------------
// S-13 자기소개서 목록
// ---------------------------------------------------------------------------

/**
 * S-13: `created_at desc` ("최근 작성 순", 정렬 선택 없음 — CF-A8 `[가정]`).
 * 이미 연결된 `listApplicationProjects()`(W-슬라이스) 위에서 모양만 줄이므로 real 분기가 따로 없다.
 */
export async function listCoverLetters(): Promise<CoverLetterListRow[]> {
  const rows = await listApplicationProjects()
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      name_source: r.name_source,
      position_title: r.job_description?.position_title ?? null,
      created_at: r.created_at,
      deadline: r.deadline,
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// ---------------------------------------------------------------------------
// S-14 ① JD 입력 — URL 가져오기 · 미리 보기 추출
// ---------------------------------------------------------------------------

/**
 * S-14 ① [다음]의 URL 가져오기. **AI 실행이 아니다** (키 불필요, 사용량 미터에 남지 않는다 — CF-A16).
 * 실패 코드 5종(`fetch_*`)은 화면에서 나누지 않고 한 문구로 알린다 (UX S-14 `[가정]`).
 *
 * 연결 대기: `POST /api/job-descriptions/fetch` (DM v4.15 11.10 · decisions 4.23 백엔드 8)
 */
export async function fetchJobPosting(url: string): Promise<JdFetchResult> {
  return previewOr(
    async () => {
      await mockRequest()
      if (!/^https?:\/\//i.test(url)) throw new AppError("invalid_source_url", JD_FETCH_FAILED_MESSAGE)
      // mock: 실패 6종을 주소로 고른다 (미리 보기용). 화면은 6종을 한 문구로 받는다 (CF-10)
      const code = MOCK_FETCH_FAILURES.find((c) => url.toLowerCase().includes(c.hint))
      if (code) throw new AppError(code.code, JD_FETCH_FAILED_MESSAGE)
      return {
        rawText: MOCK_FETCHED_JD,
        // schema.org JobPosting 값이 없을 수도 있다 (응답은 null 허용)
        companyName: "그린뱅크",
        positionTitle: "결제 백엔드 엔지니어",
      }
    },
    // 연결 대기 (DM v4.15 11.10 — POST /api/job-descriptions/fetch)
    async () => notWired("공고 URL 가져오기"),
  )
}

/** mock 전용: 주소에 이 글자가 들어가면 그 코드로 실패한다 (`?state=fetch-failed` 미리 보기와 같은 길) */
const MOCK_FETCH_FAILURES = [
  { hint: "blocked", code: "fetch_blocked" as const },
  { hint: "timeout", code: "fetch_timeout" as const },
  { hint: "toolarge", code: "fetch_too_large" as const },
  { hint: "tooshort", code: "fetch_too_short" as const },
  { hint: "fail", code: "fetch_failed" as const },
]

const MOCK_FETCHED_JD = [
  "[그린뱅크] 결제 백엔드 엔지니어 채용",
  "주요 업무",
  "- 결제·정산 서비스의 API 설계와 운영을 맡습니다.",
  "- 대용량 트래픽을 처리하는 결제 게이트웨이를 개선합니다.",
  "자격 요건",
  "- 백엔드 개발 경력 5년 이상",
  "- Java 또는 Kotlin 기반 서비스 개발 경험",
  "우대 사항",
  "- 결제·정산 도메인 경험",
  "- Kubernetes 운영 경험",
  "접수 마감: 2026년 12월 15일",
].join("\n")

/**
 * S-14 ① [다음]의 미리 보기 추출 — **행을 만들지 않는 AI-01**(DM 2.6.2).
 * Q53-1 게이트를 여기서 판정한다 (CF-A6 · R-CF-4): 동의 필요·키 무효면 거부하고 ①에 머문다.
 * 활성 공급자가 없으면 돌리지 않고 호출하는 쪽이 바로 ②로 간다 (CL-8 · D-30).
 *
 * 연결 대기: `POST /api/job-descriptions/extract-preview` (DM v4.15 2.6.2)
 */
export async function extractJdPreview(rawText: string): Promise<JdExtractPreview> {
  return previewOr(
    async () => {
      const db = await mockRequest(600)
      const key = activeKey(db)
      if (!key) throw MockAiError.refuse("ai_not_connected")
      if (key.status === "invalid") throw MockAiError.refuse("key_invalid")
      if (consentRequired(db, key.provider, key.connection_tier)) throw MockAiError.refuse("ai_consent_required")
      const lines = rawText.split(/\n+/).filter((l) => l.trim().length >= 8)
      const previewJobId = newId()
      // 생성 때 서버가 하는 원문 대조를 재현하려고 이 원문을 기억한다 (mock 전용)
      rememberJdPreview(previewJobId, rawText)
      return {
        previewJobId,
        companyName: /그린뱅크/.test(rawText) ? "그린뱅크" : null,
        positionTitle: /엔지니어|개발/.test(rawText) ? "결제 백엔드 엔지니어" : null,
        // AI-01 `deadline.value` — 연도 없는 날짜·"상시 채용"은 비운다 (CF-A5)
        deadline: /마감/.test(rawText) ? "2026-12-15" : null,
        requirementCount: Math.min(lines.length, 6),
      }
    },
    // 연결 대기 (DM v4.15 2.6.2 — POST /api/job-descriptions/extract-preview)
    async () => notWired("공고 요건 미리 보기"),
  )
}

// ---------------------------------------------------------------------------
// S-46 자소서 정본 (application_documents)
// ---------------------------------------------------------------------------

/**
 * S-46: 이 지원 프로젝트의 자소서 정본 1행 (`document_kind = 'cover_letter'`, CF-A2).
 * `null`이면 **문항 설정 상태**, 있으면 **작성 상태**로 연다 (CF-A11).
 *
 * 연결 대기: `application_documents` 읽기 (DM 2.7.3)
 */
export async function getCoverLetterDocument(applicationProjectId: Uuid): Promise<ApplicationDocument | null> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      const doc = db.application_documents.find((d) => d.application_project_id === applicationProjectId)
      return doc ? clone(doc) : null
    },
    // 연결 대기 (DM 2.7.3 — application_documents select)
    async () => notWired("자소서 정본 읽기"),
  )
}

/**
 * S-39: 보드 카드가 `body` jsonb를 읽지 않도록 수만 모아 온다.
 * 표시 없음 = 행 없음 또는 `filled_slot_count = 0` / "자소서 작성 중" = 0 < filled < slot /
 * "자소서 작성됨" = filled = slot (slot > 0) — DM 2.7.3 `[가정]`(CF-A14).
 *
 * 연결 대기: `application_documents` 수 조회 (DM 2.7.3)
 */
export async function listCoverLetterSlotCounts(): Promise<Record<Uuid, CoverLetterSlotCounts>> {
  return previewOr(
    async () => {
      const db = await mockRequest()
      return Object.fromEntries(
        db.application_documents.map((d) => [
          d.application_project_id,
          { slot_count: d.slot_count, filled_slot_count: d.filled_slot_count },
        ]),
      )
    },
    // 연결 대기 (DM 2.7.3 — application_documents 수 조회)
    async () => notWired("자소서 작성 상태 조회"),
  )
}

/**
 * S-46 "저장하기" = `save_application_document` **한 번** (본문 + 머리 제목·마감일).
 * `p_applied_proposals`로 반영한 제안을 보내면 서버가 `evidence_links`를 만든다 —
 * **근거 목록은 보내지 않는다** (CF-S1).
 *
 * 연결 대기: `save_application_document(… p_application_values)` (DM 2.7.3 · v4.15 2.5.1)
 */
export interface SaveCoverLetterInput {
  application_project_id: Uuid
  body: CoverLetterBody
  /** 문체만 (CL-A3) */
  meta?: { tone?: "concise" | "detailed" | null }
  /** 기대 버전 = 서류 `updated_at`. 정본 행이 없는 첫 저장은 null */
  expected_updated_at: string | null
  /** 반영한 제안 `[{writing_chat_id, slot, rev}]` */
  applied_proposals?: AppliedProposalRef[]
  /** 머리 제목·마감일 — 바뀐 키만 (DM v4.15 `p_application_values`) */
  application_values?: ApplicationValuesPatch
  /** @deprecated R15: `p_client_id`는 받아도 무시된다 — 멱등 키로 쓰지 않는다 */
  client_id?: string
}

export async function saveCoverLetterDocument(input: SaveCoverLetterInput): Promise<SaveApplicationDocumentResult> {
  return previewOr(
    async () => {
      const db = await mockRequest(250)
      const ap = db.application_projects.find((a) => a.id === input.application_project_id)
      if (!ap) throw new AppError("not_found", "자기소개서를 찾을 수 없어요")
      let doc = db.application_documents.find((d) => d.application_project_id === ap.id) ?? null
      // R15: 5 초과이고 **저장돼 있던 수보다 많을 때만** 거부한다. `current` = 저장돼 있던 문항 수(행 없으면 0)
      const storedCount = doc?.slot_count ?? 0
      if (input.body.questions.length > COVER_LETTER_MAX_QUESTIONS && input.body.questions.length > storedCount)
        throw new AppError("too_many_questions", `문항은 ${COVER_LETTER_MAX_QUESTIONS}개까지 추가할 수 있어요`, {
          status: 400,
          details: { limit: COVER_LETTER_MAX_QUESTIONS, current: storedCount },
        })
      // R15: `char_limit`은 필수 — 경로 `questions.q_n.char_limit` (화면이 기본 800을 채워 보낸다, CF-U2)
      const badLimit = input.body.questions.findIndex((q) => !Number.isFinite(q.char_limit) || q.char_limit < 1 || q.char_limit > 10_000)
      if (badLimit >= 0)
        throw new AppError("invalid_fields", "글자 수 제한을 확인해 주세요", {
          status: 400,
          details: { fields: [`questions.q_${badLimit + 1}.char_limit`] },
        })
      if (doc && input.expected_updated_at && doc.updated_at !== input.expected_updated_at)
        throw new AppError("stale_write", "다른 곳에서 내용이 바뀌었어요")
      const now = new Date().toISOString()
      const body: CoverLetterBody = {
        questions: input.body.questions.map((q, i) => ({ ...q, slot: `q_${i + 1}`, sort_order: i + 1 })),
      }
      if (!doc) {
        doc = {
          id: newId(),
          user_id: USER_ID,
          created_at: now,
          updated_at: now,
          application_project_id: ap.id,
          document_kind: "cover_letter",
          body,
          filled_slot_count: filledSlotCount(body),
          slot_count: body.questions.length,
          meta: { tone: input.meta?.tone ?? null },
          first_copied_at: null,
        }
        db.application_documents.push(doc)
      } else {
        Object.assign(doc, {
          body,
          filled_slot_count: filledSlotCount(body),
          slot_count: body.questions.length,
          meta: { ...doc.meta, ...(input.meta ?? {}) },
          updated_at: now,
        })
      }
      // 머리 제목·마감일은 같은 요청에서 — 한쪽만 저장되는 경우가 없다 (v5.20 정정)
      const values = input.application_values
      if (values && "name" in values) {
        const next = values.name?.trim() ?? ""
        if (next) {
          ap.name = next.slice(0, 100)
          ap.name_source = "user"
        } else {
          const jd = db.job_descriptions.find((j) => j.application_project_id === ap.id)
          const composed = composeCoverLetterName(jd?.company_name ?? null)
          ap.name = composed
          ap.name_source = composed ? "ai" : "default"
        }
      }
      if (values && "deadline" in values) ap.deadline = values.deadline ?? null
      ap.last_activity_at = now
      ap.updated_at = now
      return {
        application_document_id: doc.id,
        document_kind: "cover_letter" as const,
        filled_slot_count: doc.filled_slot_count,
        slot_count: doc.slot_count,
        name: ap.name,
        name_source: ap.name_source,
        deadline: ap.deadline,
        updated_at: doc.updated_at,
        applied: input.applied_proposals ?? [],
        skipped: [],
      }
    },
    // 연결 대기 (DM 2.7.3 — save_application_document + p_application_values)
    async () => notWired("자소서 저장"),
  )
}

/** S-46 "전체 복사" 기록 (`first_copied_at`, PRD 7장 지표). 연결 대기 (DM 2.7.3) */
export async function markCoverLetterCopied(applicationProjectId: Uuid): Promise<void> {
  return previewOr(
    async () => {
      const db = await mockRequest(0)
      const doc = db.application_documents.find((d) => d.application_project_id === applicationProjectId)
      if (doc && !doc.first_copied_at) doc.first_copied_at = new Date().toISOString()
    },
    // 연결 대기 (DM 2.7.3 — application_documents.first_copied_at)
    async () => notWired("복사 기록"),
  )
}
