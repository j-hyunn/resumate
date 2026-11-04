import { describe, expect, it } from "vitest"
import { keepsEvaluationOnRetry } from "./grading"

/**
 * R-63 on a mixed session (some answers graded, some failed, one input-caused): which evaluation
 * rows a same-row retry of the session's `interview_evaluation` job leaves as they are (DM 2.9.1
 * case (1), DM 2.7.1). The mock must reopen what `retry_ai_job` reopens (supabase/tests/
 * interview_grading.test.sql "R-63 reopens every row of the job and clears the cause").
 */
const JOB = "job-1"
const ok = { status: "succeeded", error_code: null, ai_job_id: JOB } as const
const failed = { status: "failed", error_code: "rate_limited", ai_job_id: JOB } as const
const inputCaused = { status: "failed", error_code: "input_too_long", ai_job_id: JOB } as const
const otherJobOk = { status: "succeeded", error_code: null, ai_job_id: "job-0" } as const

describe("keepsEvaluationOnRetry (R-63, UQ-612)", () => {
  it("same provider: graded and input-caused rows stay, other failures reopen", () => {
    expect(keepsEvaluationOnRetry(ok, JOB, false)).toBe(true)
    expect(keepsEvaluationOnRetry(inputCaused, JOB, false)).toBe(true)
    expect(keepsEvaluationOnRetry(failed, JOB, false)).toBe(false)
  })

  it("another provider: every row this job wrote reopens, input-caused included", () => {
    expect(keepsEvaluationOnRetry(ok, JOB, true)).toBe(false)
    expect(keepsEvaluationOnRetry(inputCaused, JOB, true)).toBe(false)
    expect(keepsEvaluationOnRetry(failed, JOB, true)).toBe(false)
  })

  it("another provider: a graded row another job wrote stays", () => {
    expect(keepsEvaluationOnRetry(otherJobOk, JOB, true)).toBe(true)
  })
})
