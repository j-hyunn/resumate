import { describe, expect, it, vi } from "vitest"
import { AppError } from "@/lib/contracts/errors"
import { bridgeSaveProjectDeliverable, bridgeSaveProjectPage, saveErrorOf } from "./career-v45-bridge"
import { blankProjectValues, type SaveProjectPageInput } from "./career-v45-shared"

const EXP = "00000000-0000-4e01-8000-000000000001"
const row = (id: string, updatedAt = "2026-11-03T00:00:00Z") => ({ id, status: "draft" as const, updatedAt })

function input(over: Partial<SaveProjectPageInput> = {}): SaveProjectPageInput {
  return { project_id: null, client_id: "client-1", values: { ...blankProjectValues({ experience_id: EXP }), name: "결제 개선" }, expected_updated_at: null, applied_proposals: [], ...over }
}

describe("saveErrorOf (UQ-PA-12)", () => {
  it("conflict → stale_write", () => {
    expect(saveErrorOf(new AppError("conflict")).code).toBe("stale_write")
  })
  it("v4.5 codes pass through, camelCase field → v4.5 key", () => {
    expect(saveErrorOf(new AppError("field_too_long", undefined, { details: { field: "startMonth" } }))).toEqual({ code: "field_too_long", field: "start_month" })
    expect(saveErrorOf(new AppError("project_name_required")).code).toBe("project_name_required")
    expect(saveErrorOf(new AppError("invalid_classification", undefined, { details: { field: "projectType" } }))).toEqual({ code: "invalid_classification", field: "project_type" })
  })
  it("period refinement errors → invalid_period; unknown → save_failed", () => {
    expect(saveErrorOf(new AppError("invalid_input", undefined, { details: { field: "endMonth" } })).code).toBe("invalid_period")
    expect(saveErrorOf(new Error("network")).code).toBe("save_failed")
  })
})

describe("bridgeSaveProjectPage (UQ-PA-3 / UQ-PA-11)", () => {
  it("create: client_id is the new row id, then the whole page in one section save", async () => {
    const createProject = vi.fn(async (x: { id: string }) => row(x.id, "t1"))
    const saveProjectSection = vi.fn(async (x: { id: string }) => row(x.id, "t2"))
    const r = await bridgeSaveProjectPage(input(), { createProject, saveProjectSection })
    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ id: "client-1", name: "결제 개선", affiliation: { type: "experience", id: EXP } }))
    expect(saveProjectSection).toHaveBeenCalledWith(expect.objectContaining({ id: "client-1", expectedUpdatedAt: "t1" }))
    expect(r).toMatchObject({ ok: true, project_id: "client-1", updated_at: "t2" })
  })

  it("create ok + section save failed → refusal carries `created` (retry updates, no second project)", async () => {
    const createProject = vi.fn(async (x: { id: string }) => row(x.id, "t1"))
    const saveProjectSection = vi.fn(async () => {
      throw new AppError("field_too_long", undefined, { details: { field: "situation" } })
    })
    const r = await bridgeSaveProjectPage(input(), { createProject, saveProjectSection })
    expect(r).toEqual({ ok: false, error: { code: "field_too_long", field: "situation", created: { project_id: "client-1", updated_at: "t1" } } })

    // the screen retries with the kept id → update only
    const retry = await bridgeSaveProjectPage(input({ project_id: "client-1", expected_updated_at: "t1" }), { createProject, saveProjectSection: async (x) => row(x.id, "t3") })
    expect(createProject).toHaveBeenCalledTimes(1)
    expect(retry).toMatchObject({ ok: true, project_id: "client-1" })
  })

  it("create failure → nothing created, no `created`", async () => {
    const r = await bridgeSaveProjectPage(input(), {
      createProject: async () => {
        throw new Error("network")
      },
      saveProjectSection: vi.fn(),
    })
    expect(r).toEqual({ ok: false, error: { code: "save_failed" } })
  })

  it("empty name / no affiliation are refused before any call", async () => {
    const deps = { createProject: vi.fn(), saveProjectSection: vi.fn() }
    expect(await bridgeSaveProjectPage(input({ values: { ...input().values, name: "  " } }), deps)).toMatchObject({ error: { code: "project_name_required" } })
    expect(await bridgeSaveProjectPage(input({ values: { ...blankProjectValues({}), name: "x" } }), deps)).toMatchObject({ error: { code: "project_affiliation_required" } })
    expect(deps.createProject).not.toHaveBeenCalled()
  })

  it("v4.4 can't record p_applied_proposals → skipped mark_failed, never applied", async () => {
    const r = await bridgeSaveProjectPage(input({ project_id: "p1", applied_proposals: [{ writing_chat_id: "c1", field: "result", rev: 2 }] }), {
      createProject: vi.fn(),
      saveProjectSection: async (x) => row(x.id),
    })
    expect(r).toMatchObject({ ok: true, applied: [], skipped: [{ writing_chat_id: "c1", field: "result", reason: "mark_failed" }] })
  })

  it("is_current clears end_month; months go as 'YYYY-MM'", async () => {
    const saveProjectSection = vi.fn(async (x: { id: string }) => row(x.id))
    await bridgeSaveProjectPage(input({ project_id: "p1", values: { ...input().values, start_month: "2024-03-01", end_month: "2025-01-01", is_current: true } }), { createProject: vi.fn(), saveProjectSection })
    expect(saveProjectSection).toHaveBeenCalledWith(expect.objectContaining({ startMonth: "2024-03", endMonth: null, isCurrent: true }))
  })
})

describe("bridgeSaveProjectDeliverable", () => {
  it("create uses client_id (retry-safe) and the project id; update sends the expected version", async () => {
    const saveDeliverable = vi.fn(async (x: { id: string }) => ({ id: x.id, updatedAt: "t" }))
    await bridgeSaveProjectDeliverable({ project_deliverable_id: null, client_id: "d-client", project_id: "p6", title: " 회고 ", body: "", expected_updated_at: null, applied_proposals: [] }, { saveDeliverable })
    expect(saveDeliverable).toHaveBeenLastCalledWith({ id: "d-client", expectedUpdatedAt: undefined, projectId: "p6", title: "회고", body: "" })
    await bridgeSaveProjectDeliverable({ project_deliverable_id: "d1", project_id: "p6", title: "회고", body: "b", expected_updated_at: "t0", applied_proposals: [] }, { saveDeliverable })
    expect(saveDeliverable).toHaveBeenLastCalledWith({ id: "d1", expectedUpdatedAt: "t0", projectId: undefined, title: "회고", body: "b" })
  })
  it("empty title refused; limit code passes through", async () => {
    expect(await bridgeSaveProjectDeliverable({ project_deliverable_id: null, project_id: "p", title: "", body: "", expected_updated_at: null, applied_proposals: [] }, { saveDeliverable: vi.fn() })).toMatchObject({ error: { code: "deliverable_title_required" } })
    const r = await bridgeSaveProjectDeliverable({ project_deliverable_id: null, project_id: "p", title: "t", body: "", expected_updated_at: null, applied_proposals: [] }, {
      saveDeliverable: async () => {
        throw new AppError("deliverable_limit_reached")
      },
    })
    expect(r).toMatchObject({ ok: false, error: { code: "deliverable_limit_reached" } })
  })
})
