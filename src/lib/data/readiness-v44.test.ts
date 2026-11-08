import { describe, expect, it } from "vitest"
import { toLegacyReadiness } from "./readiness"
import type { DataReadiness as V44 } from "@/lib/contracts/career"

const base = (features: Partial<V44["features"]>): V44 => ({
  counts: {
    complete_experiences: 1,
    complete_educations: 0,
    complete_projects: 0,
    projects_without_complete_star: 2,
    standalone_projects_without_description: 1,
    draft_experiences: 0,
    draft_educations: 0,
    draft_projects: 3,
  },
  draft_item_ids: { experiences: [], educations: [], projects: [] },
  features: {
    insight: { ready: false, missing: ["complete_project"], hints: [], next_action: "create_project" },
    draft: { ready: true },
    ...features,
  },
  ai_connection: { active_provider: "gemini", key_status: "valid", connection_tier: "free", consent_required: false },
})

const P = "00000000-0000-4e03-8000-000000000006"

describe("toLegacyReadiness passes DM §6 v4.4 through (UQ-INT-4)", () => {
  it("create_project stays create_project (C-23), counts keep the v4.4 names", () => {
    const r = toLegacyReadiness(base({}))
    expect(r.features.insight).toMatchObject({ ready: false, next_action: "create_project" })
    expect(r.counts.projects_without_complete_star).toBe(2)
    expect(r.counts.standalone_projects_without_description).toBe(1)
  })
  it("project_star / project_fields hints and suggested_project_id are kept", () => {
    const r = toLegacyReadiness(
      base({
        insight: { ready: false, missing: ["complete_project"], hints: ["project_star"], next_action: "writing_chat", suggested_project_id: P },
        draft: { ready: false, missing: ["complete_project"], hints: ["project_fields"], next_action: "form", suggested_project_id: P },
      }),
    )
    expect(r.features.insight).toMatchObject({ next_action: "writing_chat", hints: ["project_star"], suggested_project_id: P })
    expect(r.features.draft).toMatchObject({ next_action: "form", hints: ["project_fields"], suggested_project_id: P })
  })
})
