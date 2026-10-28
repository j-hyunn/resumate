import { AppError } from "@/lib/contracts/errors";

/**
 * One place that turns PostgREST / Postgres errors into AppError codes.
 * RPCs raise `errcode = 'P0001', message = '<code_name>'`; known names map to a
 * Korean message here. Raw DB messages never reach the client.
 */

type DbError = { code?: string | null; message?: string | null; details?: string | null; hint?: string | null };

/** RPC `raise` names → user-facing Korean message (+ optional HTTP status). */
const RAISE_MESSAGES: Record<string, { message: string; status?: number }> = {
  // record_consents (S1)
  invalid_consent_items: { message: "동의 항목을 확인해 주세요." },
  invalid_consent_type: { message: "알 수 없는 동의 항목입니다." },
  duplicate_consent_type: { message: "같은 동의 항목이 중복되었습니다." },
  required_consent_missing: { message: "필수 항목에 모두 동의해 주세요." },
  policy_version_missing: { message: "약관 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", status: 503 },
  // consents insert guard trigger (S1 QA-02 hardening). The RPC fills the current
  // version, so these mean the policy table changed mid-request: ask to reload.
  unknown_policy_version: { message: "약관이 변경되었습니다. 새로고침 후 다시 동의해 주세요.", status: 409 },
  policy_version_not_current: { message: "약관이 변경되었습니다. 새로고침 후 다시 동의해 주세요.", status: 409 },
  not_authenticated: { message: "로그인이 필요합니다.", status: 401 },
  // S2 career RPCs (get_deletion_impact, delete_career_item, reorder_project_details)
  career_item_not_found: { message: "요청한 항목을 찾을 수 없습니다.", status: 404 },
  invalid_entity_type: { message: "입력값을 확인해 주세요." },
  invalid_affiliation_mode: { message: "입력값을 확인해 주세요." },
  invalid_result_mode: { message: "입력값을 확인해 주세요." },
  invalid_detail_order: { message: "상세 내용 목록이 바뀌었습니다. 새로고침 후 다시 시도해 주세요.", status: 409 },
  // S3/S3a ai_jobs (status guard trigger, request_ai_job_cancel, complete_ai_job, sweep_stalled_ai_jobs)
  invalid_ai_job_transition: { message: "이미 끝난 작업입니다.", status: 409 },
  ai_job_not_found: { message: "요청한 항목을 찾을 수 없습니다.", status: 404 },
  invalid_stalled_before: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  // S3a claim_due_ai_jobs (cron)
  invalid_now: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_limit: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  // S3b key RPCs (save_provider_key, record_provider_key_check, delete_provider_key, set_active_ai_provider)
  consent_required: { message: "AI 데이터 사용 고지에 다시 동의해 주세요.", status: 409 },
  key_not_found: { message: "등록된 키가 없는 공급자예요.", status: 404 },
  key_id_mismatch: { message: "다른 변경과 충돌했습니다. 새로고침 후 다시 시도해 주세요.", status: 409 },
  invalid_provider: { message: "입력값을 확인해 주세요." },
  invalid_connection_tier: { message: "입력값을 확인해 주세요." },
  // Server-built arguments: a mismatch here is our bug, not the user's input.
  invalid_verification_result: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_result_status: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_failure_cause: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_key_id: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_ai_job_state: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  key_not_available: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  // ai_data_use_consents insert guard (S3b): the disclosure changed while the user read it.
  unknown_disclosure_version: { message: "고지 내용이 바뀌었어요. 새 고지를 확인하고 다시 동의해 주세요.", status: 409 },
  disclosure_version_not_current: { message: "고지 내용이 바뀌었어요. 새 고지를 확인하고 다시 동의해 주세요.", status: 409 },
};

/** Raise names that the frontend sees under a generic code instead of their own. */
const RAISE_CODE_ALIASES: Record<string, string> = {
  not_authenticated: "unauthenticated",
  career_item_not_found: "not_found",
  invalid_entity_type: "invalid_input",
  invalid_affiliation_mode: "invalid_input",
  invalid_result_mode: "invalid_input",
  // Server-side programming errors: the client sees a generic internal error.
  invalid_stalled_before: "internal_error",
  invalid_now: "internal_error",
  invalid_limit: "internal_error",
  ai_job_not_found: "not_found",
  consent_required: "ai_consent_required",
  key_id_mismatch: "conflict",
  invalid_provider: "invalid_input",
  invalid_connection_tier: "invalid_input",
  invalid_verification_result: "internal_error",
  invalid_result_status: "internal_error",
  invalid_failure_cause: "internal_error",
  invalid_key_id: "internal_error",
  invalid_ai_job_state: "internal_error",
  key_not_available: "internal_error",
  unknown_disclosure_version: "ai_disclosure_changed",
  disclosure_version_not_current: "ai_disclosure_changed",
};

export function mapDbError(error: DbError): AppError {
  const code = error.code ?? "";
  const message = error.message ?? "";

  if (code === "P0001" && message in RAISE_MESSAGES) {
    const known = RAISE_MESSAGES[message]!;
    const appCode = RAISE_CODE_ALIASES[message] ?? message;
    return new AppError(appCode, known.message, { status: known.status, cause: error });
  }
  if (code === "42501" && message === "not_authenticated") return new AppError("unauthenticated", undefined, { cause: error });
  if (code === "PGRST116") return new AppError("not_found", undefined, { cause: error });
  if (code === "42501") return new AppError("forbidden", undefined, { cause: error });
  // 22007 bad datetime syntax, 22008 datetime out of range (QA-S2-01; zod catches most first).
  if (code === "23514" || code === "22001" || code === "22P02" || code === "23502" || code === "22007" || code === "22008") {
    return new AppError("invalid_input", undefined, { cause: error });
  }
  if (code === "23505") return new AppError("conflict", undefined, { cause: error });
  return new AppError("internal_error", undefined, { status: 500, cause: error });
}
