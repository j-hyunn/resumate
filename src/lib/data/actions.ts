"use server"

/**
 * Foundation server actions used by common components (C-03 polling, C-05 impact,
 * C-09/C-10 readiness, completion toasts, usage hint). Area screens put their own
 * server actions in their area folders and call src/lib/data/* from there.
 */
import type { AffiliationMode, AiErrorCode, AiProviderName, ApplicationStage, ConnectionTier, DeletionEntityType, StageOutcome } from "@/types/db"
import { moveApplicationStage, setApplicationOutcome } from "./applications"
import { cancelAiJob, getAiJob, listActiveAiJobs, retryAiJob } from "./ai-jobs"
import { abandonWritingChat, listAbandonedWritingChats, resumeWritingChat } from "./writing-chats"
import { deleteAccountConfirmed, getAccountDeletionState } from "./account"
import { getMockControls, setMockControls } from "./mock-controls"
import type { MockControls } from "@/lib/mock/fixtures"
import { getProject } from "./career"
import {
  getApplicationDeletionImpact,
  getDeletionImpact,
  getDraftDeletionImpact,
} from "./deletion"
import { getDataReadiness } from "./readiness"
import { getShellBadges } from "./shell"
import { getRunningAiJobCount, signOut } from "./account"
import type { AccountDeletionErrorCode } from "@/types/db"
import { withAiGuard } from "./ai-guard"
import { getAiPriceTables, getAiUsageSummaryV412 } from "./ai-usage"
import {
  changeProviderTier,
  deleteProviderKey,
  getAiConnection,
  getAiConnectionOverview,
  getAiConnectionState,
  getDataUseConsentState,
  needsDataUseConsent,
  publishMockReconsentDisclosure,
  recheckProviderKey,
  recordDataUseConsent,
  setActiveAiProvider,
  verifyAndSaveProviderKey,
  type KeyCheckMock,
} from "./ai-connection"

export async function getAiJobAction(jobId: string) {
  return getAiJob(jobId)
}

export async function listActiveAiJobsAction() {
  return listActiveAiJobs()
}

export async function cancelAiJobAction(jobId: string) {
  return cancelAiJob(jobId)
}

/**
 * C-20 "다시 시도" on the same row (POST /api/ai-jobs/{id}/retry). Returns `{ rejected, refusal }`
 * (isAiRejected) on a 409 — nothing changed. `refusal` ∈ ai_job_not_retryable / key_missing /
 * key_invalid / ai_consent_required / ai_connection_changed (04 §2.11.7 path ②). Otherwise the job,
 * re-pinned to the **current** active provider (restarted from `prepare` when it differs).
 */
export async function retryAiJobAction(jobId: string, fail?: AiErrorCode | null) {
  return withAiGuard(() => retryAiJob(jobId, { fail: fail ?? null }))
}

// --- v4.2 A6: AI 작성 대화 그만두기 / 다시 이어 하기 (S-08, S-10, S-36) -------------------------

/** 대화 그만두기 (`active → abandoned`, no AI) */
export async function abandonWritingChatAction(chatId: string) {
  return abandonWritingChat(chatId)
}

/** 다시 이어 하기 (`abandoned → active`, no AI call, works without a key). null when not abandoned */
export async function resumeWritingChatAction(chatId: string) {
  return resumeWritingChat(chatId)
}

/** S-08 "그만둔 대화 N개" */
export async function listAbandonedWritingChatsAction() {
  return listAbandonedWritingChats()
}

// --- v4.2 A7: 탈퇴 (S-25) ---------------------------------------------------------------

/**
 * S-25 탈퇴하기 / 탈퇴 마무리하기 (same idempotent request, `confirm: true`). `{ ok: true }` → sign
 * out → `/`; `{ ok: false, error }` with account_deletion_busy (nothing deleted) /
 * account_deletion_incomplete (→ 탈퇴 마무리 state) / failed.
 */
export async function deleteAccountConfirmedAction(
  input: { confirm: true },
  opts?: { fail?: boolean; simulate?: AccountDeletionErrorCode | null },
) {
  return deleteAccountConfirmed(input, opts)
}

/** get_account_deletion_state(): active / deletion_incomplete / profile_missing (A7 재진입) */
export async function getAccountDeletionStateAction() {
  return getAccountDeletionState()
}

// --- C-09 project_fields (A18) ------------------------------------------------------------

/**
 * projects.name / role of the C-09 `suggested_project_id`: "'{프로젝트명}' 마저 채우기" and the Q53-8 title
 * (빈 칸 수). Blank → null.
 */
export async function getProjectFieldsAction(projectId: string): Promise<{ name: string | null; role: string | null }> {
  const p = await getProject(projectId)
  return { name: p?.name?.trim() ? p.name : null, role: p?.role?.trim() ? p.role : null }
}

// --- MOCK ONLY: dev controls (/dev/states) ---------------------------------------------------

export async function getMockControlsAction() {
  return getMockControls()
}

export async function setMockControlsAction(patch: Partial<MockControls>) {
  return setMockControls(patch)
}

/** Publishes a `requires_reconsent` disclosure for the active provider → consent_required = true */
export async function publishMockReconsentDisclosureAction() {
  return publishMockReconsentDisclosure()
}

export async function getDeletionImpactAction(entityType: DeletionEntityType, entityId: string, affiliationMode?: AffiliationMode) {
  return getDeletionImpact(entityType, entityId, affiliationMode)
}

export async function getApplicationDeletionImpactAction(applicationProjectId: string) {
  return getApplicationDeletionImpact(applicationProjectId)
}

export async function getDraftDeletionImpactAction(draftId: string) {
  return getDraftDeletionImpact(draftId)
}

export async function getDataReadinessAction() {
  return getDataReadiness()
}

// --- v4 BYOK: AI 연결 · 사용량 (S-40 / S-41 / S-42, C-18 / C-19 / NavAiStatus) -------------

/** get_data_readiness().ai_connection only (badges, NavAiStatus, C-18) */
export async function getAiConnectionAction() {
  return getAiConnection()
}

/** ai_connection + has_any_key (AiConnectionProvider) */
export async function getAiConnectionStateAction() {
  return getAiConnectionState()
}

export async function getAiConnectionOverviewAction() {
  return getAiConnectionOverview()
}

/** S-42 "가격표 보기" (A1 request 3) */
export async function getAiPriceTablesAction(versions?: string[]) {
  return getAiPriceTables(versions)
}

/** C-21 dialog: { required, reconsent } for provider × tier (04 §2.11.5) */
export async function getDataUseConsentStateAction(provider: AiProviderName, tier: ConnectionTier) {
  return getDataUseConsentState(provider, tier)
}

/** S-40 활성 전환 / S-41: re-consent needed for provider × tier (04 §2.11.5) */
export async function needsDataUseConsentAction(provider: AiProviderName, tier: ConnectionTier) {
  return needsDataUseConsent(provider, tier)
}

/** 진행 중인 AI 작업 수 (all job types); `provider` → that provider only (S-40 키 삭제 문구) */
export async function getRunningAiJobCountAction(provider?: AiProviderName) {
  return getRunningAiJobCount(provider)
}

/** S-24 ② 사용량 블록: `providers[]` 교차 집계 (DM v4.12 2.9.5) */
export async function getAiUsageSummaryAction(periodMonth?: string) {
  return getAiUsageSummaryV412(periodMonth)
}

export async function recordDataUseConsentAction(input: {
  provider: AiProviderName
  connection_tier: ConnectionTier
  free_tier_acknowledged: boolean
  fail?: boolean
}) {
  return recordDataUseConsent(input)
}

/** S-41 ③ 키 확인 → save_provider_key (valid / limited) or rejected (not saved) */
export async function verifyAndSaveProviderKeyAction(input: {
  provider: AiProviderName
  connection_tier: ConnectionTier
  raw_key: string
  mock?: KeyCheckMock
}) {
  return verifyAndSaveProviderKey(input)
}

/** S-40 "다시 확인" → record_provider_key_check */
export async function recheckProviderKeyAction(provider: AiProviderName, mock?: KeyCheckMock) {
  return recheckProviderKey(provider, mock)
}

export async function deleteProviderKeyAction(provider: AiProviderName) {
  return deleteProviderKey(provider)
}

export async function setActiveAiProviderAction(provider: AiProviderName) {
  return setActiveAiProvider(provider)
}

export async function changeProviderTierAction(provider: AiProviderName, tier: ConnectionTier) {
  return changeProviderTier(provider, tier)
}

export async function getShellBadgesAction() {
  return getShellBadges()
}

/** L-01 사이드바 사용자 메뉴의 로그아웃 (S-24와 같은 동작) */
export async function shellSignOutAction() {
  await signOut()
}

// --- C-12 / C-13 (foundation-owned since A0 round 1) ---------------------------

export async function moveApplicationStageAction(
  applicationProjectId: string,
  toStage: ApplicationStage,
  outcome: StageOutcome | null = null,
  opts?: { fail?: boolean },
) {
  return moveApplicationStage(applicationProjectId, toStage, outcome, opts)
}

export async function setApplicationOutcomeAction(applicationProjectId: string, outcome: StageOutcome | null) {
  return setApplicationOutcome(applicationProjectId, outcome)
}
