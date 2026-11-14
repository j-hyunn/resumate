import { describe, expect, it } from "vitest";
import { isFailureBeforeRawTextEdit } from "@/lib/contracts/application";
import { jdRawTextLockOf, type JdRawTextFacts } from "./read";

// R17: `resolveExtraction` / `extractionJobToCheck` are gone with AI-01 (the JD view has no extraction state).

describe("jdRawTextLockOf (DM 2.6.1 conditions 1~5, same order as the RPC)", () => {
  it("R17-6: a JD created after R17 (pending, no extraction job) is locked, like the unchanged RPC", async () => {
    await expect(jdRawTextLockOf(facts({ extractionStatus: "pending", extractionJob: null }))).resolves.toBe("jd_raw_text_locked");
  });

  const inputFailure = { job_type: "jd_extraction", status: "failed", error_code: "not_a_jd" };
  const facts = (over: Partial<JdRawTextFacts> = {}): JdRawTextFacts => ({
    jobInProgress: false,
    extractionStatus: "failed",
    extractionJob: inputFailure,
    requirementCount: 0,
    hasResults: async () => false,
    ...over,
  });

  it.each(["not_a_jd", "input_too_long", "safety_blocked"])("input-caused failure %s, no requirements, no results → editable", async (error_code) => {
    await expect(jdRawTextLockOf(facts({ extractionJob: { ...inputFailure, error_code } }))).resolves.toBeNull();
  });

  it("succeeded with 0 requirements → editable, whatever the job says (Q53-11)", async () => {
    await expect(jdRawTextLockOf(facts({ extractionStatus: "succeeded", extractionJob: null }))).resolves.toBeNull();
  });

  it("running whose job failed counts as failed; a live one is locked", async () => {
    await expect(jdRawTextLockOf(facts({ extractionStatus: "running" }))).resolves.toBeNull();
    await expect(jdRawTextLockOf(facts({ extractionStatus: "running", extractionJob: { ...inputFailure, status: "running", error_code: null } }))).resolves.toBe("jd_raw_text_locked");
    await expect(jdRawTextLockOf(facts({ extractionStatus: "running", extractionJob: { ...inputFailure, status: "canceled", error_code: null } }))).resolves.toBe("jd_raw_text_locked");
  });

  it("condition 1 comes first", async () => {
    await expect(jdRawTextLockOf(facts({ jobInProgress: true, requirementCount: 3, hasResults: async () => true }))).resolves.toBe("jd_job_in_progress");
  });

  it("pending (before re-extraction) and requirements → locked", async () => {
    await expect(jdRawTextLockOf(facts({ extractionStatus: "pending", extractionJob: null }))).resolves.toBe("jd_raw_text_locked");
    await expect(jdRawTextLockOf(facts({ extractionStatus: "succeeded", requirementCount: 1 }))).resolves.toBe("jd_raw_text_locked");
    await expect(jdRawTextLockOf(facts({ requirementCount: 1 }))).resolves.toBe("jd_raw_text_locked");
  });

  it("a failure that isn't input-caused, or whose job is gone or of another type → jd_failure_not_input", async () => {
    await expect(jdRawTextLockOf(facts({ extractionJob: { ...inputFailure, error_code: "timeout" } }))).resolves.toBe("jd_failure_not_input");
    await expect(jdRawTextLockOf(facts({ extractionJob: null }))).resolves.toBe("jd_failure_not_input");
    await expect(jdRawTextLockOf(facts({ extractionJob: { ...inputFailure, job_type: "insight" } }))).resolves.toBe("jd_failure_not_input");
    await expect(jdRawTextLockOf(facts({ extractionJob: { ...inputFailure, status: "canceled" } }))).resolves.toBe("jd_failure_not_input");
  });

  it("results built from this text → jd_has_results, read only when 1~4 pass", async () => {
    await expect(jdRawTextLockOf(facts({ hasResults: async () => true }))).resolves.toBe("jd_has_results");
    await expect(jdRawTextLockOf(facts({ extractionStatus: "succeeded", extractionJob: null, hasResults: async () => true }))).resolves.toBe("jd_has_results");
    let read = false;
    await jdRawTextLockOf(
      facts({
        requirementCount: 1,
        hasResults: async () => {
          read = true;
          return true;
        },
      }),
    );
    expect(read).toBe(false);
  });
});

describe("isFailureBeforeRawTextEdit (DM 2.6.1)", () => {
  it("only a job finished strictly before the edit is past; nothing to compare → not past", () => {
    expect(isFailureBeforeRawTextEdit("2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z")).toBe(true);
    expect(isFailureBeforeRawTextEdit("2026-11-02T00:00:00Z", "2026-11-02T00:00:00Z")).toBe(false);
    expect(isFailureBeforeRawTextEdit("2026-11-03T00:00:00Z", "2026-11-02T00:00:00Z")).toBe(false);
    expect(isFailureBeforeRawTextEdit(null, "2026-11-02T00:00:00Z")).toBe(false);
    expect(isFailureBeforeRawTextEdit("2026-11-01T00:00:00Z", null)).toBe(false);
  });
});
