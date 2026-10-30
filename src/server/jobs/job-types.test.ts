import { describe, expect, it } from "vitest";
import { AI_JOB_TYPES } from "@/lib/contracts/enums";
import "./definitions";
import { getJobType } from "./registry";
import { REQUEST_SCOPED_JOB_TYPES } from "./runner";

/**
 * QA-S9-06: every job type the DB CHECK allows (mirrored in AI_JOB_TYPES) is
 * either a registered runner job (retry / cron continue use its steps) or
 * request-scoped (never requeued) — exactly one of the two.
 */
describe("job type coverage (QA-S9-06)", () => {
  it.each(AI_JOB_TYPES.map((t) => [t]))("%s is registered xor request-scoped", (jobType) => {
    const registered = getJobType(jobType) !== undefined;
    const requestScoped = REQUEST_SCOPED_JOB_TYPES.has(jobType);
    expect(registered !== requestScoped, `registered=${registered} requestScoped=${requestScoped}`).toBe(true);
  });

  it("the request-scoped set has no stray values", () => {
    for (const t of REQUEST_SCOPED_JOB_TYPES) expect(AI_JOB_TYPES).toContain(t);
  });
});
