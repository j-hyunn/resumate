import { describe, expect, it } from "vitest";
import { parseStructuredDraft, type StarField } from "../schemas/structured-draft";
import { computeFocusSlots, quickChips, type FocusInput, type ProjectSlotState } from "./focus-slots";

const EMPTY_STAR: Record<StarField, string | null> = { situation: null, task: null, action: null, result: null, learnings: null };

function project(star: Partial<Record<StarField, string>> = {}, startMonth: string | null = null): ProjectSlotState {
  return { star: { ...EMPTY_STAR, ...star }, startMonth };
}

const field = (value: string, extra: Record<string, unknown> = {}) => ({ value, origin: "ai", source_message_ids: [], source_quotes: [], review: "ok", reviewed_at: null, applied_at: null, ...extra });

function input(over: Partial<Omit<FocusInput, "draft">> & { draft?: unknown } = {}): FocusInput {
  return {
    project: project(),
    gate: null,
    requestedSlot: null,
    ...over,
    draft: parseStructuredDraft(over.draft ?? {}),
  };
}

const slots = (plan: ReturnType<typeof computeFocusSlots>) => plan.slots.map((s) => `${s.slot}:${s.reason}`);

describe("computeFocusSlots — order", () => {
  it("non-gate: period first (only when empty), then S → T → A → R → learnings", () => {
    const plan = computeFocusSlots(input());
    expect(slots(plan)).toEqual(["period:order", "situation:order"]);
    expect(plan.upcoming.map((s) => s.slot)).toEqual(["task", "action", "result"]);
    expect(slots(computeFocusSlots(input({ project: project({}, "2023-03") })))).toEqual(["situation:order", "task:order"]);
  });

  it("a pending proposal counts as filled", () => {
    const plan = computeFocusSlots(input({ project: project({}, "2023-03"), draft: { star: { situation: field("상황") } } }));
    expect(slots(plan)).toEqual(["task:order", "action:order"]);
  });

  it("once required is filled, optional slots are offered", () => {
    const plan = computeFocusSlots(input({ project: project({ situation: "s", action: "a" }, "2023-03") }));
    expect(slots(plan)).toEqual(["task:optional_offer", "result:optional_offer"]);
  });

  it("gate: situation, action first, then period, then optional_offer", () => {
    const plan = computeFocusSlots(input({ gate: { feature: "insight", missing: ["complete_project"] } }));
    expect(slots(plan)).toEqual(["situation:gate_required", "action:gate_required"]);
    expect(plan.upcoming.map((s) => `${s.slot}:${s.reason}`)).toEqual(["period:order", "task:optional_offer", "result:optional_offer"]);
  });

  it("everything filled → no slots", () => {
    const all = project({ situation: "s", task: "t", action: "a", result: "r", learnings: "l" }, "2023-03");
    expect(computeFocusSlots(input({ project: all })).slots).toEqual([]);
  });
});

describe("computeFocusSlots — requested, clarifications, full fields", () => {
  it("requested_slot goes first; a filled slot is asked as reinforcement", () => {
    expect(slots(computeFocusSlots(input({ requestedSlot: { slot: "learnings" } })))).toEqual(["learnings:requested", "period:order"]);
    const filled = computeFocusSlots(input({ project: project({ action: "a" }), requestedSlot: { slot: "action" } }));
    expect(filled.slots[0]).toEqual({ slot: "action", missingFields: [], reason: "requested_reinforce" });
  });

  it("the first clarification comes before ordered slots", () => {
    const plan = computeFocusSlots(input({ project: project({}, "2023-03"), draft: { clarifications: [{ kind: "number_vague", field: "result" }] } }));
    expect(plan.slots[0]).toMatchObject({ slot: "result", reason: "clarification", clarification: "number_vague" });
    expect(plan.clarifications).toHaveLength(1);
    const period = computeFocusSlots(input({ draft: { clarifications: [{ kind: "period_unclear", field: "start_month" }] } }));
    expect(period.slots.map((s) => s.slot)).toEqual(["period", "situation"]);
  });

  it("full fields are never asked (even when requested)", () => {
    const plan = computeFocusSlots(input({ project: project({}, "2023-03"), fullFields: ["situation"], requestedSlot: { slot: "situation" } }));
    expect(plan.slots.map((s) => s.slot)).toEqual(["task", "action"]);
    expect(plan.fullFields).toEqual(["situation"]);
  });
});

describe("computeFocusSlots — flags", () => {
  it("requiredComplete / canApply: needs_review proposals don't count; project values do", () => {
    const pending = computeFocusSlots(input({ draft: { star: { situation: field("s"), action: field("a") } } }));
    expect(pending).toMatchObject({ requiredComplete: true, canApply: true });
    const review = computeFocusSlots(input({ draft: { star: { situation: field("s"), action: field("a", { review: "needs_review" }) } } }));
    expect(review).toMatchObject({ requiredComplete: false, canApply: false });
    const onProject = computeFocusSlots(input({ project: project({ situation: "s", action: "a" }) }));
    expect(onProject).toMatchObject({ requiredComplete: true, canApply: false });
  });

  it("readyToReturn = gate and nothing missing", () => {
    expect(computeFocusSlots(input()).readyToReturn).toBe(false);
    expect(computeFocusSlots(input({ gate: { feature: "insight", missing: ["complete_project"] } })).readyToReturn).toBe(false);
    expect(computeFocusSlots(input({ gate: { feature: "insight", missing: [] } })).readyToReturn).toBe(true);
  });
});

describe("quickChips", () => {
  const chips = (p: ProjectSlotState, draft: unknown = {}) => quickChips({ project: p, draft: parseStructuredDraft(draft) }).map((c) => `${c.label}→${c.requested_slot}`);

  it("required empty → first empty required, result, learnings", () => {
    expect(chips(project())).toEqual(["비어 있는 항목부터 물어봐 줘→situation", "결과/성과도 정리하고 싶어요→result", "배운 점도 정리하고 싶어요→learnings"]);
    expect(chips(project({ situation: "s" }))[0]).toBe("비어 있는 항목부터 물어봐 줘→action");
  });

  it("required filled (project or proposal), optional empty → first empty, action, result", () => {
    expect(chips(project({ situation: "s" }), { star: { action: field("a") } })).toEqual([
      "남은 항목 채우기→task",
      "본인이 한 일을 더 구체적으로→action",
      "결과/성과에 수치 더하기→result",
    ]);
  });

  it("all filled → reinforce action, result, learnings", () => {
    expect(chips(project({ situation: "s", task: "t", action: "a", result: "r", learnings: "l" }))).toEqual([
      "행동 보강하기→action",
      "결과/성과 보강하기→result",
      "배운 점 보강하기→learnings",
    ]);
  });
});
