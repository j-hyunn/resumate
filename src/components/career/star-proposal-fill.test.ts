import { describe, expect, it } from "vitest"
import type { DraftStarFieldObject, ProjectStructuredDraft } from "@/types/db"
import { blankProjectValues } from "@/lib/data/career-v45-shared"
import { applyFills, isFillable, markDraftApplied, mergeApplied, planFill } from "./star-proposal-fill"

const star = (value: string, extra?: Partial<DraftStarFieldObject>): DraftStarFieldObject => ({
  value,
  op: "set",
  origin: "ai",
  source_message_ids: ["m1"],
  source_quotes: ["q"],
  review: "ok",
  reviewed_at: null,
  applied_at: null,
  rev: 1,
  ...extra,
})

function draft(): ProjectStructuredDraft {
  return {
    schema_version: 3,
    project: { start_month: { value: "2023-03", origin: "ai", source_message_ids: ["m1"], source_quotes: ["q"], review: "ok", reviewed_at: null, applied_at: null, rev: 1 } },
    star: { situation: star("새 상황"), action: star("덧붙일 행동", { op: "append", rev: 3 }), result: star("검토", { review: "needs_review" }) },
    classification: {
      project_type: { value: "improvement", origin: "ai", source_message_ids: [], review: "ok", reviewed_at: null, applied_at: null, rev: 1, reason: null },
      competencies: { value: ["analysis", "execution"], origin: "ai", source_message_ids: [], review: "ok", reviewed_at: null, applied_at: null, rev: 2, reason: null },
    },
    clarifications: [],
    sensitive_flags_count: 0,
  }
}

const base = () => ({ ...blankProjectValues({ experience_id: "e1" }), name: "p", action: "기존 행동" })

describe("planFill", () => {
  it("fills empty STAR fields with the value and appends legacy 'append' proposals to filled ones", () => {
    const plan = planFill({ draft: draft(), chatId: "c", values: base(), applied: [], fields: ["situation", "action"] })
    expect(plan.fills).toEqual([
      { field: "situation", next: "새 상황", rev: 1 },
      { field: "action", next: "기존 행동\n덧붙일 행동", rev: 3 },
    ])
  })

  it("RQ-5: a 'set' proposal on a filled field replaces the form value (OD-P2: no undo, no prev kept)", () => {
    const d = draft()
    d.star.action = star("기존 행동을 합쳐 다시 씀. 캐시 무효화 규칙을 직접 설계함", { rev: 4 })
    const plan = planFill({ draft: d, chatId: "c", values: base(), applied: [], fields: ["action"] })
    expect(plan.fills).toEqual([{ field: "action", next: "기존 행동을 합쳐 다시 씀. 캐시 무효화 규칙을 직접 설계함", rev: 4 }])
    expect(applyFills(base(), plan.fills).action).toBe("기존 행동을 합쳐 다시 씀. 캐시 무효화 규칙을 직접 설계함")
  })

  it("2,000자 check uses the resulting length: 'set' replaces (fits), 'append' would overflow", () => {
    const values = { ...base(), action: "x".repeat(1500) }
    const set = draft()
    set.star.action = star("y".repeat(1800))
    expect(planFill({ draft: set, chatId: "c", values, applied: [], fields: ["action"] }).fills[0].next).toBe("y".repeat(1800))
    const app = draft()
    app.star.action = star("y".repeat(1800), { op: "append" })
    expect(planFill({ draft: app, chatId: "c", values, applied: [], fields: ["action"] }).skips[0].reason).toBe("too_long")
    const over = draft()
    over.star.action = star("y".repeat(2001))
    expect(planFill({ draft: over, chatId: "c", values, applied: [], fields: ["action"] }).skips[0].reason).toBe("too_long")
  })

  it("skips needs_review, already filled and too long sections", () => {
    const values = { ...base(), situation: "x".repeat(1999) }
    const d = draft()
    d.star.situation = star("새 상황", { op: "append" })
    const plan = planFill({ draft: d, chatId: "c", values, applied: [{ writing_chat_id: "c", field: "action", rev: 3 }], fields: ["situation", "action", "result"] })
    expect(plan.fills).toEqual([])
    expect(plan.skips.map((s) => s.reason)).toEqual(["too_long", "already_applied", "needs_review"])
  })

  it("treats a newer rev as a new proposal", () => {
    expect(isFillable(draft(), "c", "action", [{ writing_chat_id: "c", field: "action", rev: 2 }])).toBe(true)
  })

  it("fills the period only when empty, as 'YYYY-MM-01'", () => {
    expect(planFill({ draft: draft(), chatId: "c", values: base(), applied: [], fields: ["start_month"] }).fills[0].next).toBe("2023-03-01")
    expect(planFill({ draft: draft(), chatId: "c", values: { ...base(), start_month: "2022-01-01" }, applied: [], fields: ["start_month"] }).skips[0].reason).toBe("period_already_set")
  })

  it("classification: only empty values; partial competency pick; none checked = no entry", () => {
    const set = planFill({ draft: draft(), chatId: "c", values: { ...base(), project_type: "new_build" }, applied: [], fields: ["project_type"] })
    expect(set.skips[0].reason).toBe("classification_already_set")
    // row [반영] (overwriteClassification): the recommendation replaces what the user chose
    const over = planFill({ draft: draft(), chatId: "c", values: { ...base(), project_type: "new_build" }, applied: [], fields: ["project_type"], overwriteClassification: true })
    expect(over.skips).toEqual([])
    expect(over.fills[0]).toEqual({ field: "project_type", next: "improvement", rev: 1 })
    const part = planFill({ draft: draft(), chatId: "c", values: base(), applied: [], fields: ["competencies"], competencyPick: ["execution"] })
    expect(part.fills).toEqual([{ field: "competencies", next: ["execution"], rev: 2 }])
    const none = planFill({ draft: draft(), chatId: "c", values: base(), applied: [], fields: ["competencies"], competencyPick: [] })
    expect(none.fills).toEqual([])
    expect(none.skips).toEqual([])
  })
})

describe("OD-P2: fills carry no undo data", () => {
  it("a fill entry is only {field, next, rev}", () => {
    const plan = planFill({ draft: draft(), chatId: "c", values: base(), applied: [], fields: ["situation", "start_month", "project_type", "competencies"] })
    for (const f of plan.fills) expect(Object.keys(f).sort()).toEqual(["field", "next", "rev"])
  })
})

describe("applied memory", () => {
  it("keeps one entry per (chat, field) and applies the values", () => {
    const plan = planFill({ draft: draft(), chatId: "c", values: base(), applied: [], fields: ["situation", "competencies"] })
    const applied = mergeApplied([{ writing_chat_id: "c", field: "situation", rev: 0 }, { writing_chat_id: "other", field: "situation", rev: 1 }], "c", plan.fills)
    expect(applied).toEqual([
      { writing_chat_id: "other", field: "situation", rev: 1 },
      { writing_chat_id: "c", field: "situation", rev: 1 },
      { writing_chat_id: "c", field: "competencies", rev: 2 },
    ])
    const values = applyFills(base(), plan.fills)
    expect(values.situation).toBe("새 상황")
    expect(values.competencies).toEqual(["analysis", "execution"])
  })

  it("marks saved fields applied on a copy", () => {
    const d = draft()
    const marked = markDraftApplied(d, ["situation", "competencies"], "t")
    expect(marked.star.situation?.applied_at).toBe("t")
    expect(marked.classification.competencies?.applied_at).toBe("t")
    expect(d.star.situation?.applied_at).toBeNull()
  })
})
