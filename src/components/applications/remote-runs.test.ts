import { describe, expect, it } from "vitest"
import { remoteRunTargets } from "./remote-runs"

describe("remoteRunTargets (S-19 reconnect)", () => {
  const cd = { draft_type: "career_description", status: "generating", ai_job_id: "job-1" }

  it("follows a career description still generating after a reload", () => {
    expect(remoteRunTargets(cd, [], null)).toEqual({ draft: "job-1" })
  })

  it("not while this screen streams it, nor without a job (stand-in before the route opened one)", () => {
    expect(remoteRunTargets(cd, [], "draft")).toEqual({})
    expect(remoteRunTargets({ ...cd, ai_job_id: null }, [], null)).toEqual({})
    expect(remoteRunTargets({ ...cd, status: "ready" }, [], null)).toEqual({})
  })

  it("follows each generating question except the one being streamed", () => {
    const cover = { draft_type: "cover_letter", status: "generating", ai_job_id: null }
    const sections = [
      { id: "s1", status: "generating", ai_job_id: "job-a" },
      { id: "s2", status: "ready", ai_job_id: "job-old" },
      { id: "s3", status: "generating", ai_job_id: "job-c" },
      { id: "s4", status: "generating", ai_job_id: null },
    ]
    expect(remoteRunTargets(cover, sections, null)).toEqual({ s1: "job-a", s3: "job-c" })
    expect(remoteRunTargets(cover, sections, "s1")).toEqual({ s3: "job-c" })
  })
})
