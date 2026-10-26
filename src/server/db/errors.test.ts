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
    [{ code: "P0001", message: "invalid_detail_order" }, "invalid_detail_order", 409],
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
