import { describe, expect, it } from "vitest"
import { AppError } from "@/lib/contracts/errors"
import { decideConflict, fingerprint, isPeriodReversed, newRowId, periodPatch, storedPeriod } from "./row-save"
import { guardRowSave } from "./row-save-guard"

describe("isPeriodReversed / periodPatch", () => {
  it("compares months, whichever way they are written", () => {
    expect(isPeriodReversed("2024-05-01", "2024-04-01")).toBe(true)
    expect(isPeriodReversed("2024-05", "2024-04-01")).toBe(true)
    expect(isPeriodReversed("2024-05-01", "2024-05-01")).toBe(false)
    expect(isPeriodReversed(null, "2024-04-01")).toBe(false)
    expect(isPeriodReversed("2024-05-01", null)).toBe(false)
  })
  it("leaves a reversed period out of the patch, without undefined keys", () => {
    expect(Object.keys(periodPatch("2024-05-01", "2024-04-01"))).toEqual([])
    expect(periodPatch("2024-04-01", "2024-05-01")).toEqual({ start_month: "2024-04-01", end_month: "2024-05-01" })
    expect(periodPatch(null, null)).toEqual({ start_month: null, end_month: null })
  })
})

describe("decideConflict", () => {
  const comparable = (r: { name: string }) => ({ name: r.name })
  it("the row already holds what was sent: a lost response", () => {
    expect(decideConflict({ base: { name: "a" }, latest: { name: "b " }, sent: { name: "b" }, comparable })).toBe("already_saved")
  })
  it("nothing the form shows changed: send again", () => {
    expect(decideConflict({ base: { name: "a", status: "draft" }, latest: { name: "a", status: "complete" }, sent: { name: "c" }, comparable })).toBe("rebase")
  })
  it("the form's fields changed elsewhere: the user decides", () => {
    expect(decideConflict({ base: { name: "a" }, latest: { name: "b" }, sent: { name: "c" }, comparable })).toBe("conflict")
  })
  it("a new row has no base to compare with", () => {
    expect(decideConflict({ base: null, latest: { name: "b" }, sent: { name: "c" }, comparable })).toBe("conflict")
  })
  // UQ-702: an experience whose end month the form still holds while "재직 중" is on
  type Exp = { start_month: string | null; end_month: string | null; is_current: boolean }
  const asForm = (r: Exp) => ({ start_month: r.start_month, end_month: r.end_month, is_current: r.is_current })
  const stored = (v: Exp, latest: Exp) => ({ ...v, ...storedPeriod(v.start_month, v.is_current ? null : v.end_month, latest) })
  it("turning on 재직 중, response lost: the row holds what the save left, not what the form holds", () => {
    const base = { start_month: "2023-01-01", end_month: "2024-06-01", is_current: false }
    const latest = { start_month: "2023-01-01", end_month: null, is_current: true }
    const sent = { start_month: "2023-01", end_month: "2024-06", is_current: true }
    expect(decideConflict({ base, latest, sent, comparable: asForm })).toBe("conflict") // before: a false conflict
    expect(decideConflict({ base, latest, sent, comparable: asForm, stored })).toBe("already_saved")
  })
  it("a reversed period isn't sent, so the stored period counts as saved", () => {
    const base = { start_month: "2023-01-01", end_month: "2024-06-01", is_current: false }
    const latest = { ...base }
    const sent = { start_month: "2024-08", end_month: "2024-06", is_current: false }
    expect(decideConflict({ base: { ...base, end_month: "2024-05-01" }, latest, sent, comparable: asForm, stored })).toBe("already_saved")
  })
  it("still a conflict when another tab changed the period", () => {
    const base = { start_month: "2023-01-01", end_month: "2024-06-01", is_current: false }
    const latest = { start_month: "2022-01-01", end_month: "2024-06-01", is_current: false }
    expect(decideConflict({ base, latest, sent: { ...base, is_current: true }, comparable: asForm, stored })).toBe("conflict")
  })
  it("QA-W5-06: first save lost twice — the row holds an earlier try of ours, so send again on it", () => {
    expect(decideConflict({ base: null, latest: { name: "b" }, sent: { name: "c" }, comparable, earlierTries: [{ name: "a" }, { name: "b" }] })).toBe("rebase")
    expect(decideConflict({ base: null, latest: { name: "x" }, sent: { name: "c" }, comparable, earlierTries: [{ name: "a" }, { name: "b" }] })).toBe("conflict")
  })
  it("no comparable: always the user's call", () => {
    expect(decideConflict({ base: { name: "a" }, latest: { name: "a" }, sent: { name: "a" } })).toBe("conflict")
  })
})

describe("fingerprint", () => {
  it("ignores what the contract normalizes", () => {
    expect(fingerprint({ a: " x ", m: "2024-03-01" })).toBe(fingerprint({ a: "x", m: "2024-03" }))
    expect(fingerprint({ a: "x" })).not.toBe(fingerprint({ a: "y" }))
  })
})

describe("newRowId", () => {
  it("is a uuid, new each time", () => {
    expect(newRowId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(newRowId()).not.toBe(newRowId())
  })
})

describe("guardRowSave", () => {
  const row = { id: "r" }
  const failing = (code: "conflict" | "not_found" | "invalid_input" | "internal_error") => async () => {
    throw new AppError(code)
  }
  it("passes the row through", async () => {
    expect(await guardRowSave(async () => row, async () => null)).toEqual({ ok: true, row })
  })
  it("a conflict comes with the latest row", async () => {
    expect(await guardRowSave(failing("conflict"), async () => row)).toEqual({ ok: false, reason: "conflict", latest: row })
  })
  it("a conflict with no row left is gone", async () => {
    expect(await guardRowSave(failing("conflict"), async () => null)).toEqual({ ok: false, reason: "gone" })
  })
  it("reads not_found and invalid_input as values", async () => {
    expect(await guardRowSave(failing("not_found"), async () => null)).toEqual({ ok: false, reason: "gone" })
    expect(await guardRowSave(failing("invalid_input"), async () => null)).toEqual({ ok: false, reason: "invalid" })
  })
  it("anything else stays thrown", async () => {
    await expect(guardRowSave(failing("internal_error"), async () => null)).rejects.toMatchObject({ code: "internal_error" })
    await expect(guardRowSave(async () => { throw new Error("mock") }, async () => null)).rejects.toThrow("mock")
  })
})
