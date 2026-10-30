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
  // R2 retry_ai_job (DM 2.11.7 path ②, same codes and copy as runGateError in jobs/provider-context.ts)
  key_missing: { message: "AI 연결이 필요합니다. 키를 등록한 뒤 다시 시도해 주세요.", status: 409 },
  key_invalid: { message: "AI 키가 유효하지 않습니다. 키를 확인해 다시 연결해 주세요.", status: 409 },
  ai_consent_required: { message: "AI 데이터 사용 고지에 다시 동의해 주세요.", status: 409 },
  ai_job_not_retryable: { message: "다시 시도할 수 없는 작업입니다.", status: 409 },
  // QA-R2-01: the active provider / tier changed while the retry was being prepared (twice in a row).
  ai_connection_changed: { message: "AI 연결이 방금 바뀌었어요. 다시 시도해 주세요.", status: 409 },
  invalid_run_meta: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
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
  // S4 writing chat (start / message / patch / affiliation / save RPCs)
  writing_chat_not_found: { message: "요청한 대화를 찾을 수 없습니다.", status: 404 },
  writing_chat_not_active: { message: "저장했거나 그만둔 대화예요. 새 대화를 시작해 주세요.", status: 409 },
  invalid_writing_chat_transition: { message: "저장했거나 그만둔 대화예요. 새 대화를 시작해 주세요.", status: 409 },
  message_limit_reached: { message: "대화가 길어져 더 보낼 수 없어요. 지금까지 내용을 저장하거나 폼으로 옮겨 이어서 써 주세요.", status: 409 },
  turn_in_progress: { message: "이전 메시지에 대한 응답을 만들고 있어요. 잠시 후 다시 보내 주세요.", status: 409 },
  no_pending_user_message: { message: "다시 보낼 응답이 없어요.", status: 409 },
  invalid_content: { message: "메시지는 1자 이상 4,000자 이하로 입력해 주세요." },
  invalid_mode: { message: "입력값을 확인해 주세요." },
  project_required: { message: "입력값을 확인해 주세요." },
  project_not_allowed: { message: "입력값을 확인해 주세요." },
  project_not_found: { message: "대상 프로젝트를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", status: 404 },
  invalid_return_target: { message: "입력값을 확인해 주세요." },
  invalid_affiliation: { message: "소속은 경력이나 교육 중 하나만 고를 수 있어요." },
  affiliation_not_found: { message: "연결할 경력·교육을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", status: 404 },
  affiliation_not_editable: { message: "기존 프로젝트를 보강하는 대화에서는 소속을 바꿀 수 없어요.", status: 409 },
  invalid_period: { message: "기간을 확인해 주세요. 종료 월이 시작 월보다 빠를 수 없어요." },
  // S5 application projects / JD (db notes "RPC 시그니처")
  application_project_not_found: { message: "기업 JD를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", status: 404 },
  job_description_not_found: { message: "기업 JD를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", status: 404 },
  application_project_id_conflict: { message: "다른 변경과 충돌했습니다. 새로고침 후 다시 시도해 주세요.", status: 409 },
  invalid_id: { message: "입력값을 확인해 주세요." },
  invalid_raw_text: { message: "공고 원문은 1자 이상 50,000자 이하로 입력해 주세요." },
  invalid_name: { message: "이름은 1자 이상 100자 이하로 입력해 주세요." },
  invalid_company_name: { message: "회사명은 200자 이하로 입력해 주세요." },
  invalid_position_title: { message: "포지션명은 200자 이하로 입력해 주세요." },
  invalid_stage: { message: "입력값을 확인해 주세요." },
  invalid_outcome: { message: "전형 결과는 전형 종료 단계에서만 기록할 수 있어요." },
  not_closed: { message: "전형 결과는 전형 종료 단계에서만 기록할 수 있어요.", status: 409 },
  already_extracted: { message: "이미 요건을 정리한 공고예요.", status: 409 },
  extraction_in_progress: { message: "공고를 분석하고 있어요. 잠시 후 다시 확인해 주세요.", status: 409 },
  user_edited_requirements_exist: { message: "직접 수정한 요건이 있어 다시 정리할 수 없어요.", status: 409 },
  // S6 insights (db notes "RPC 시그니처")
  insight_not_found: { message: "인사이트를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", status: 404 },
  insight_in_progress: { message: "인사이트를 만들고 있어요. 잠시 후 다시 확인해 주세요.", status: 409 },
  jd_not_extracted: { message: "공고 요건을 먼저 정리해야 해요.", status: 409 },
  invalid_insight_payload: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_evidence_source: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  // S7 drafts (db notes "RPC 시그니처와 반환 형태")
  draft_not_found: { message: "초안을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", status: 404 },
  section_not_found: { message: "문항을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", status: 404 },
  draft_id_conflict: { message: "다른 변경과 충돌했습니다. 새로고침 후 다시 시도해 주세요.", status: 409 },
  section_id_conflict: { message: "다른 변경과 충돌했습니다. 새로고침 후 다시 시도해 주세요.", status: 409 },
  invalid_title: { message: "제목은 1자 이상 100자 이하로 입력해 주세요." },
  invalid_question: { message: "문항은 1자 이상 1,000자 이하, 글자 수는 1~10,000자로 입력해 주세요." },
  question_limit_reached: { message: "문항은 10개까지 추가할 수 있어요.", status: 409 },
  last_question: { message: "문항은 최소 1개가 있어야 해요.", status: 409 },
  section_generating: { message: "이 문항의 초안을 만들고 있어요. 생성이 끝난 뒤 다시 시도해 주세요.", status: 409 },
  section_in_progress: { message: "이 문항의 초안을 만들고 있어요. 잠시 후 다시 확인해 주세요.", status: 409 },
  invalid_section_order: { message: "문항 목록이 바뀌었습니다. 새로고침 후 다시 시도해 주세요.", status: 409 },
  invalid_sources: { message: "사용할 경력·프로젝트를 확인해 주세요." },
  source_not_found: { message: "완료된 경력·교육·프로젝트만 고를 수 있어요. 새로고침 후 다시 시도해 주세요.", status: 409 },
  invalid_draft_options: { message: "포함할 항목을 확인해 주세요." },
  invalid_draft_sections: { message: "포함할 항목을 확인해 주세요." },
  invalid_draft_payload: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  // server-built arguments
  invalid_raw_text_hash: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_sentences: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_extraction_result: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  // apply_structured_draft_patch: user-session rule violations (db notes "거부 사유")
  invalid_patch: { message: "입력값을 확인해 주세요." },
  invalid_value: { message: "입력값을 확인해 주세요." },
  field_already_filled: { message: "기존 상세 내용에 이미 쓴 칸은 여기서 바꿀 수 없어요.", status: 409 },
  protected_field: { message: "다른 변경과 충돌했습니다. 새로고침 후 다시 시도해 주세요.", status: 409 },
  invalid_source: { message: "입력값을 확인해 주세요." },
  detail_not_found: { message: "상세 내용 카드를 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.", status: 409 },
  achievement_not_found: { message: "정량 성과를 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.", status: 409 },
  invalid_review_transition: { message: "이미 검토한 항목이에요. 새로고침 후 확인해 주세요.", status: 409 },
  // Server-built arguments (AI turn path): our bug, not the user's input.
  invalid_ai_metadata: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_ai_job: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_message_status: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_message_state: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  message_not_found: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_sequence: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  // S8 interviews (db notes)
  interview_in_progress: { message: "이 기업 JD에 작성 중인 면접이 있어요. 이어서 쓰거나 그만둔 뒤 새로 시작해 주세요.", status: 409 },
  session_id_conflict: { message: "다른 변경과 충돌했습니다. 새로고침 후 다시 시도해 주세요.", status: 409 },
  invalid_interview_type: { message: "면접 유형을 골라 주세요." },
  invalid_question_count: { message: "질문 수는 3, 5, 7 중에서 골라 주세요." },
  invalid_data_sufficiency: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  interview_session_not_found: { message: "면접 세션을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", status: 404 },
  interview_answer_not_found: { message: "답변을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", status: 404 },
  interview_not_in_progress: { message: "이미 제출했거나 그만둔 면접이에요.", status: 409 },
  interview_already_submitted: { message: "이미 제출한 면접이에요. 결과 화면에서 확인해 주세요.", status: 409 },
  interview_not_ready: { message: "질문을 모두 만든 뒤에 제출할 수 있어요.", status: 409 },
  interview_not_submitted: { message: "제출한 뒤에 볼 수 있어요.", status: 409 },
  interview_generation_in_progress: { message: "질문을 만들고 있어요. 잠시 후 다시 확인해 주세요.", status: 409 },
  interview_evaluation_in_progress: { message: "채점하고 있어요. 잠시 후 다시 확인해 주세요.", status: 409 },
  interview_questions_ready: { message: "질문을 이미 모두 만들었어요.", status: 409 },
  interview_evaluation_not_needed: { message: "다시 채점할 답변이 없어요.", status: 409 },
  interview_questions_incomplete: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  invalid_interview_payload: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  answer_not_evaluable: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  // S9 delete_account: the server computes the hash, so a bad one is our bug.
  invalid_subject_hash: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  // R1 get_account_deletion_state / server-only key RPCs: the server passes the session user id,
  // so these are call bugs (QA-R1-01), never user input.
  invalid_user_id: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
  user_not_found: { message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", status: 500 },
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
  invalid_subject_hash: "internal_error",
  invalid_user_id: "internal_error",
  user_not_found: "internal_error",
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
  writing_chat_not_found: "not_found",
  invalid_writing_chat_transition: "writing_chat_not_active",
  no_pending_user_message: "nothing_to_retry",
  invalid_content: "invalid_input",
  invalid_mode: "invalid_input",
  project_required: "invalid_input",
  project_not_allowed: "invalid_input",
  project_not_found: "not_found",
  invalid_return_target: "invalid_input",
  invalid_affiliation: "invalid_input",
  affiliation_not_found: "not_found",
  invalid_period: "invalid_input",
  invalid_patch: "invalid_input",
  invalid_value: "invalid_input",
  invalid_source: "invalid_input",
  protected_field: "conflict",
  invalid_ai_metadata: "internal_error",
  invalid_run_meta: "internal_error",
  invalid_ai_job: "internal_error",
  invalid_message_status: "internal_error",
  invalid_message_state: "internal_error",
  message_not_found: "internal_error",
  invalid_sequence: "internal_error",
  application_project_not_found: "not_found",
  job_description_not_found: "not_found",
  application_project_id_conflict: "conflict",
  invalid_id: "invalid_input",
  invalid_raw_text: "invalid_input",
  invalid_name: "invalid_input",
  invalid_company_name: "invalid_input",
  invalid_position_title: "invalid_input",
  invalid_stage: "invalid_input",
  draft_not_found: "not_found",
  section_not_found: "not_found",
  draft_id_conflict: "conflict",
  section_id_conflict: "conflict",
  invalid_title: "invalid_input",
  invalid_question: "invalid_input",
  invalid_section_order: "conflict",
  invalid_sources: "invalid_input",
  invalid_draft_options: "invalid_input",
  invalid_draft_sections: "invalid_input",
  invalid_draft_payload: "internal_error",
  invalid_raw_text_hash: "internal_error",
  invalid_sentences: "internal_error",
  invalid_extraction_result: "internal_error",
  invalid_insight_payload: "internal_error",
  invalid_evidence_source: "internal_error",
  session_id_conflict: "conflict",
  invalid_interview_type: "invalid_input",
  invalid_question_count: "invalid_input",
  invalid_data_sufficiency: "internal_error",
  interview_session_not_found: "not_found",
  interview_answer_not_found: "not_found",
  interview_questions_incomplete: "internal_error",
  invalid_interview_payload: "internal_error",
  answer_not_evaluable: "internal_error",
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
