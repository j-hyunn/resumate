import { describe, expect, it } from "vitest";
import { mapDbError } from "./errors";

describe("mapDbError", () => {
  it.each([
    [{ code: "P0001", message: "invalid_consent_type" }, "invalid_consent_type", 400],
    [{ code: "P0001", message: "policy_version_missing" }, "policy_version_missing", 503],
    [{ code: "P0001", message: "unknown_policy_version" }, "unknown_policy_version", 409],
    [{ code: "P0001", message: "policy_version_not_current" }, "policy_version_not_current", 409],
    [{ code: "P0001", message: "duplicate_consent_type" }, "duplicate_consent_type", 400],
    [{ code: "P0001", message: "invalid_consent_items" }, "invalid_consent_items", 400],
    [{ code: "P0001", message: "required_consent_missing" }, "required_consent_missing", 400],
    [{ code: "42501", message: "not_authenticated" }, "unauthenticated", 401],
    [{ code: "PGRST116", message: "0 rows" }, "not_found", 404],
    [{ code: "42501", message: "permission denied for table profiles" }, "forbidden", 403],
    [{ code: "23514", message: "violates check constraint" }, "invalid_input", 400],
    [{ code: "22007", message: "invalid input syntax for type timestamp" }, "invalid_input", 400],
    [{ code: "22008", message: "date/time field value out of range" }, "invalid_input", 400],
    [{ code: "23505", message: "duplicate key" }, "conflict", 409],
    [{ code: "P0001", message: "career_item_not_found" }, "not_found", 404],
    [{ code: "P0001", message: "invalid_entity_type" }, "invalid_input", 400],
    [{ code: "P0001", message: "invalid_affiliation_mode" }, "invalid_input", 400],
    [{ code: "P0001", message: "invalid_result_mode" }, "invalid_input", 400],
    [{ code: "P0001", message: "invalid_deliverable_order" }, "conflict", 409],
    [{ code: "P0001", message: "deliverable_limit_reached" }, "deliverable_limit_reached", 409],
    [{ code: "P0001", message: "project_scope_change_not_allowed" }, "project_scope_change_not_allowed", 409],
    [{ code: "P0001", message: "affiliation_mode_not_supported" }, "invalid_input", 400],
    // R2 retry_ai_job (DM 2.11.7 path ②)
    [{ code: "P0001", message: "key_missing" }, "key_missing", 409],
    [{ code: "P0001", message: "key_invalid" }, "key_invalid", 409],
    [{ code: "P0001", message: "ai_consent_required" }, "ai_consent_required", 409],
    [{ code: "P0001", message: "ai_job_not_retryable" }, "ai_job_not_retryable", 409],
    [{ code: "P0001", message: "invalid_run_meta" }, "internal_error", 500],
    [{ code: "P0001", message: "ai_connection_changed" }, "ai_connection_changed", 409],
    [{ code: "P0001", message: "some_unlisted_raise" }, "internal_error", 500],
    [{ code: "XX000", message: "internal" }, "internal_error", 500],
  ])("%o → %s", (input, code, status) => {
    const err = mapDbError(input);
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
    // Raw DB text never becomes the user message.
    expect(err.message).not.toContain(input.message);
  });
});

describe("QA-W0-05 program errors", () => {
  it.each(["job_description_immutable"])("%s → internal_error 500", (raise) => {
    const err = mapDbError({ code: "P0001", message: raise });
    expect(err.code).toBe("internal_error");
    expect(err.status).toBe(500);
  });
});

describe("W0 refusals", () => {
  it.each(["jd_job_in_progress", "jd_raw_text_locked", "jd_failure_not_input", "jd_has_results", "jd_raw_text_unchanged"])("%s → 409 under its own code, Korean message", (raise) => {
    const err = mapDbError({ code: "P0001", message: raise });
    expect(err).toMatchObject({ code: raise, status: 409 });
    expect(err.message).toMatch(/[가-힣]/);
  });

  it("a W0 refusal carries no details", () => {
    expect(mapDbError({ code: "P0001", message: "jd_has_results", details: "x" }).details).toBeUndefined();
  });

  it.each(["key_invalid", "ai_consent_required"])("create_application_project gate %s → 409 (Q53-1)", (raise) => {
    expect(mapDbError({ code: "P0001", message: raise })).toMatchObject({ code: raise, status: 409 });
  });

  it("the raw text RPC's other refusals keep the generic codes (DM 2.6.1)", () => {
    expect(mapDbError({ code: "P0001", message: "job_description_not_found" })).toMatchObject({ code: "not_found", status: 404 });
    expect(mapDbError({ code: "P0001", message: "invalid_raw_text" })).toMatchObject({ code: "invalid_input", status: 400 });
    expect(mapDbError({ code: "P0001", message: "invalid_sentences" })).toMatchObject({ code: "internal_error", status: 500 });
    expect(mapDbError({ code: "42501", message: "not_authenticated" })).toMatchObject({ code: "unauthenticated", status: 401 });
  });
});

// ---------------- R15 자기소개서 관리 (CF-*, db notes ②) ----------------

describe("R15 save_application_document refusals", () => {
  it("too_many_questions: the raise detail '5,{current}' becomes details {limit, current} (R5-DB-8 shape)", () => {
    const err = mapDbError({ code: "P0001", message: "too_many_questions", details: "5,3" });
    expect(err).toMatchObject({ code: "too_many_questions", status: 400, details: { limit: 5, current: 3 } });
    expect(err.message).toMatch(/[가-힣]/);
    // The RPC uses `0` when there is no stored row yet.
    expect(mapDbError({ code: "P0001", message: "too_many_questions", details: "5,0" }).details).toEqual({ limit: 5, current: 0 });
  });

  it("too_many_questions without a usable detail carries no details", () => {
    expect(mapDbError({ code: "P0001", message: "too_many_questions" }).details).toBeUndefined();
    expect(mapDbError({ code: "P0001", message: "too_many_questions", details: "oops" }).details).toBeUndefined();
  });

  /**
   * R15-DB-9: the per-owner allowed-source check moved from a `23514` CHECK into the insert trigger,
   * so this arrives as `P0001` with the `item_key` as its detail. It must stay a 400 the screen can
   * act on, not the generic 500 the insight path used to give it.
   */
  it("invalid_evidence_source: P0001 → 400 with the item_key in details.field", () => {
    const err = mapDbError({ code: "P0001", message: "invalid_evidence_source", details: "q_1.blocks.b1" });
    expect(err).toMatchObject({ code: "invalid_evidence_source", status: 400, details: { field: "q_1.blocks.b1" } });
    expect(err.message).toMatch(/[가-힣]/);
    // V-8 last net: the detail names the field that was refused.
    expect(mapDbError({ code: "P0001", message: "invalid_evidence_source", details: "q_2.blocks.b3.learnings" }).details).toMatchObject({
      field: "q_2.blocks.b3.learnings",
    });
  });

  it("invalid_slot → 400 under its own code with the slot in details.field", () => {
    expect(mapDbError({ code: "P0001", message: "invalid_slot", details: "q_1" })).toMatchObject({ code: "invalid_slot", status: 400, details: { field: "q_1" } });
  });

  it("the other refusals keep the shared codes", () => {
    expect(mapDbError({ code: "P0001", message: "application_project_not_found" })).toMatchObject({ code: "not_found", status: 404 });
    expect(mapDbError({ code: "P0001", message: "stale_write", details: "2026-11-09T03:14:08.844340Z" })).toMatchObject({
      code: "stale_write",
      status: 409,
      details: { current_updated_at: "2026-11-09T03:14:08.844340Z" },
    });
    expect(mapDbError({ code: "P0001", message: "invalid_fields", details: "questions.q_2.char_limit" })).toMatchObject({
      code: "invalid_fields",
      status: 400,
      details: { field: "questions.q_2.char_limit" },
    });
    expect(mapDbError({ code: "P0001", message: "field_too_long", details: "questions.q_2.answer_title" })).toMatchObject({
      code: "field_too_long",
      status: 400,
    });
  });
});

describe("R15 create_application_project", () => {
  it("invalid_source_url → 400 invalid_input (no row is built, so the screen may resend without the URL)", () => {
    expect(mapDbError({ code: "P0001", message: "invalid_source_url" })).toMatchObject({ code: "invalid_input", status: 400 });
  });
});
