"use server"

/**
 * 자기소개서 관리 server actions. Thin wrappers over src/lib/data/*. Screens refresh with
 * router.refresh() after a write.
 *
 * (v5.20, CF-1·CF-7) 폐기된 액션: `rankDraftSourcesAction`(AI-11) · `createCareerDescriptionAction` ·
 * `createCoverLetterAction` · `deleteDraftAction` · `prepare/finalizeCareerDescriptionAction` ·
 * `prepare/finalizeCoverLetterSectionAction` · `saveEditedContentAction` · `setSectionSourcesAction` ·
 * `markDraftCopiedAction` — S-17·S-19·S-45가 없어지고 초안은 S-46 패널의 초안 턴이 만든다.
 */
import type { AiErrorCode, ApplicationProject } from "@/types/db"
import { createApplicationProject, startInsight, updateApplicationProject, updateFailedJdRawText } from "@/lib/data/applications"
import { deleteApplicationProject } from "@/lib/data/deletion"
import { withAiGuard } from "@/lib/data/ai-guard"
// (v5.20, CF-1·CF-5) 폐기된 `draft_sections` 행 단위 문항 액션은 쓰는 화면이 없어졌다.
// R17: JD 요건 추출 액션(`retryJdExtractionAction`·`getJdExtractionStateAction`)과 S-14 ① 요건 미리 보기
// (`extractJdPreviewAction`)도 없어졌다 — 공고는 원문 그대로 쓴다.
import type { DocumentFormSnapshot } from "@/lib/contracts/application-document"
import { AppError, isAppError, runAction } from "@/lib/contracts/errors"
import { deleteCoverLetterChat, getCoverLetterChat, startCoverLetterChat } from "@/lib/data/cover-letter-chats"
import {
  fetchJobPosting,
  getCoverLetterDocument,
  listCoverLetterSlotCounts,
  markCoverLetterCopied,
  saveCoverLetterDocument,
  type SaveCoverLetterInput,
} from "@/lib/data/cover-letters"

// --- S-14 ② 생성 · S-46 머리 ----------------------------------------------------------------

export async function createApplicationAction(input: {
  raw_text: string
  name: string | null
  deadline: string | null
  /** S-14 ② 지원 기업·지원 포지션 → JD company_name / position_title (source 'user') */
  company_name?: string | null
  position_title?: string | null
  /** (v5.20, CF-10·CF-A16) ①의 공고 URL → `p_source_url` */
  source_url?: string | null
  fail?: boolean
}): Promise<CreateApplicationOutcome | { refused: "invalid_source_url" }> {
  if (input.fail) throw new Error("save failed (mock)")
  const raw = input.raw_text.trim()
  if (!raw) throw new Error("raw_text required")
  try {
    return await createApplicationGuarded(input, raw)
  } catch (e) {
    // `invalid_source_url`(400)은 값으로 돌려준다 — 던지면 Server Action 경계에서 `code`를 잃어
    // 화면이 "주소 없이 만들기"를 띄울 수 없다 (UX S-14 "주소 저장 불가")
    if (isAppError(e) && e.code === "invalid_source_url") return { refused: "invalid_source_url" }
    throw e
  }
}

async function createApplicationGuarded(input: Parameters<typeof createApplicationAction>[0], raw: string): Promise<CreateApplicationOutcome> {
  // (v5.20, CF-A7) 이름 규칙 "{기업 명} 자기소개서"는 data layer(createApplicationProject)가 정한다
  // R17 [가정 R17-9]: 공고 등록은 AI를 쓰지 않아 연결 게이트(Q53-1 경로 ⑥)가 없다
  const ap = await createApplicationProject({
    raw_text: raw,
    name: input.name?.trim() || null,
    deadline: input.deadline || null,
    company_name: input.company_name,
    position_title: input.position_title,
    source_url: input.source_url,
  })
  return { id: ap.id }
}

/** S-14 ② [자기소개서 작성]의 결과 (R17: 미리 보기 적용 결과 키 삭제) */
export interface CreateApplicationOutcome {
  id: string
}

/** 채용 공고 탭 공고 원문 저장 (Q53-2, RPC update_failed_jd_raw_text): `{ refused }` = nothing changed */
export async function updateFailedJdRawTextAction(applicationProjectId: string, rawText: string) {
  return updateFailedJdRawText(applicationProjectId, rawText)
}

export async function updateApplicationAction(
  id: string,
  patch: Partial<Pick<ApplicationProject, "name" | "deadline">>,
  opts?: { fail?: boolean },
) {
  if (opts?.fail) throw new Error("save failed (mock)")
  return updateApplicationProject(id, patch)
}

export async function deleteApplicationAction(id: string) {
  await deleteApplicationProject(id)
}

// --- 인사이트 탭 (S-16) --------------------------------------------------------------------

/**
 * v4: key checked first on the server (`{ rejected }` → nothing changed). R17: no AI-01 first — AI-02
 * reads the JD raw text. No service limit (D-34).
 */
export async function startInsightAction(applicationProjectId: string, fail?: AiErrorCode, opts?: { rate_wait?: boolean }) {
  return withAiGuard(() => startInsight(applicationProjectId, { fail: fail ?? null, rate_wait: opts?.rate_wait }))
}

// --- S-46 문항 설정 (옛 S-18 — A3가 다시 쓴다) ------------------------------------------------

// --- S-14 ① JD 입력 · S-46 자소서 정본 (v5.20 — 실제 경로, lib/data/cover-letters.ts) ----------

/** S-14 ① [다음]: 공고 URL 가져오기 (AI 아님). 실패는 throw → 화면이 "가져오지 못했어요" 한 문구로 */
export async function fetchJobPostingAction(url: string) {
  return fetchJobPosting(url)
}

/** S-46: 정본 행 (없으면 문항 설정 상태, 있으면 작성 상태 — CF-A11) */
export async function getCoverLetterDocumentAction(applicationProjectId: string) {
  return getCoverLetterDocument(applicationProjectId)
}

/**
 * S-46 "저장하기" / [자기소개서 작성 시작] — 본문 + 머리 제목·마감일을 한 번에 (DM v4.15).
 * **`ActionResult`로 돌려준다**: Server Action에서 던진 오류는 경계를 넘으며 `code`·`details`를 잃어
 * (메시지만 남는다) 화면이 `stale_write`·`too_many_questions`·`invalid_slot`을 가를 수 없었다.
 */
export async function saveCoverLetterDocumentAction(input: SaveCoverLetterInput) {
  return runAction(() => saveCoverLetterDocument(input))
}

/** S-46 "전체 복사" (`first_copied_at`, PRD 7장 지표) */
export async function markCoverLetterCopiedAction(applicationProjectId: string) {
  return markCoverLetterCopied(applicationProjectId)
}

/** S-39 카드 "자소서 작성 중 / 작성됨" (UI 5) */
export async function listCoverLetterSlotCountsAction() {
  return listCoverLetterSlotCounts()
}

// --- S-46 자소서 작성 대화 (R15 + 후속: 시작·열기·목록·삭제 모두 실제 경로) -------------------

/** 패널 "+ 새 대화" / 첫 메시지 — `start_document_writing_chat`. 정본 행을 만들지 않는다 (CF-S3) */
export async function startCoverLetterChatAction(applicationProjectId: string, formSnapshot?: DocumentFormSnapshot) {
  return startCoverLetterChat(applicationProjectId, formSnapshot)
}

/**
 * 패널 기록 목록에서 대화를 열거나 턴이 끝난 뒤 **저장된 제안으로 다시 맞출 때** (R15 후속 `getWritingChat`).
 * `ActionResult`로 돌려준다 — 던진 오류는 경계에서 `code`를 잃는다.
 */
export async function getCoverLetterChatAction(chatId: string, applicationProjectId: string) {
  return runAction(async () => {
    // UQ-758: 이 지원 건의 대화가 아니면 열지 않는다
    const chat = await getCoverLetterChat(chatId, applicationProjectId)
    if (!chat) throw new AppError("not_found", "요청한 대화를 찾을 수 없어요")
    return chat
  })
}

/** 패널 ⋯ "이 대화 삭제" (C-05 `writing_chat`) */
export async function deleteCoverLetterChatAction(chatId: string) {
  return deleteCoverLetterChat(chatId)
}
