import { describe, expect, it } from "vitest";
import { extractionJobToCheck, resolveExtraction, type ExtractionJobRow } from "./read";

/** S6 follow-up of QA-S5-06: a `running` JD whose extraction job ended (trigger skipped a locked row) shows as failed. */

const job = (status: string, error_code: string | null = null): ExtractionJobRow => ({
  id: "j1",
  status,
  error_code,
  retry_after: null,
  quota_resets_at: null,
  finished_at: status === "running" ? null : "2026-11-01T00:00:00.000Z",
});
const jobs = (row?: ExtractionJobRow) => new Map(row ? [[row.id, row]] : []);
const running = { extraction_status: "running", extraction_job_id: "j1" };

describe("resolveExtraction", () => {
  it("running + live job stays running", () => {
    expect(resolveExtraction(running, jobs(job("running")))).toEqual({ status: "running", failure: null });
  });

  it("running + failed / canceled job → failed with that failure", () => {
    expect(resolveExtraction(running, jobs(job("failed", "timeout")))).toMatchObject({ status: "failed", failure: { code: "timeout", jobId: "j1" } });
    expect(resolveExtraction(running, jobs(job("canceled")))).toMatchObject({ status: "failed", failure: { code: "canceled" } });
  });

  it("running + job row gone → failed / stalled", () => {
    expect(resolveExtraction(running, jobs())).toMatchObject({ status: "failed", failure: { code: "stalled", jobId: "j1", failedAt: null } });
  });

  it("failed keeps its job failure; succeeded / pending are untouched", () => {
    expect(resolveExtraction({ extraction_status: "failed", extraction_job_id: "j1" }, jobs(job("failed", "key_invalid")))).toMatchObject({ status: "failed", failure: { code: "key_invalid" } });
    expect(resolveExtraction({ extraction_status: "succeeded", extraction_job_id: "j1" }, jobs(job("failed")))).toEqual({ status: "succeeded", failure: null });
    expect(extractionJobToCheck({ extraction_status: "pending", extraction_job_id: null })).toEqual([]);
    expect(extractionJobToCheck(running)).toEqual(["j1"]);
  });
});
