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
  // S3 usage ledger RPCs (reserve_usage, charge_usage, release_usage)
  usage_limit_reached: { message: "이번 달 사용 한도에 도달했습니다.", status: 429 },
  usage_limit_missing: { message: "이 기능의 사용 한도 정보가 없어 지금은 실행할 수 없습니다.", status: 503 },
  invalid_usage_feature: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_usage_units: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_usage_reason: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  usage_event_not_found: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_usage_transition: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 409 },
  // S3 ai_jobs (status guard trigger, request_ai_job_cancel, sweep_stalled_ai_jobs)
  invalid_ai_job_transition: { message: "이미 끝난 작업입니다.", status: 409 },
  ai_job_not_found: { message: "요청한 항목을 찾을 수 없습니다.", status: 404 },
  invalid_stalled_before: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
};

/** Raise names that the frontend sees under a generic code instead of their own. */
const RAISE_CODE_ALIASES: Record<string, string> = {
  not_authenticated: "unauthenticated",
  career_item_not_found: "not_found",
  invalid_entity_type: "invalid_input",
  invalid_affiliation_mode: "invalid_input",
  invalid_result_mode: "invalid_input",
  // Server-side programming errors: the client sees a generic internal error.
  invalid_usage_feature: "internal_error",
  invalid_usage_units: "internal_error",
  invalid_usage_reason: "internal_error",
  usage_event_not_found: "internal_error",
  invalid_stalled_before: "internal_error",
  ai_job_not_found: "not_found",
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
