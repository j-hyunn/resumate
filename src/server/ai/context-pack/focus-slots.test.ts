import { describe, expect, it } from "vitest";
import { DETAIL_DONE_ID, DETAIL_DRAFT_ID } from "../__fixtures__/AI-12/conversations";
import { parseStructuredDraft, type DetailField, type ProjectField } from "../schemas/structured-draft";
import { computeFocusSlots, nextDetailKey, predictReadyToReturn, type FocusInput } from "./focus-slots";

const f = (value: string | number, review: "ok" | "needs_review" | "accepted" = "ok") => ({
  value,
  origin: "ai",
  source_message_ids: ["m"],
  source_quotes: ["q"],
  review,
  reviewed_at: null,
});

type InputOverrides = Omit<Partial<FocusInput>, "draft"> & { draft?: unknown };

function input(overrides: InputOverrides = {}): FocusInput {
  const { draft, ...rest } = overrides;
  return {
    mode: "new_project",
    draft: parseStructuredDraft(draft ?? {}),
    existingProject: null,
    existingDetails: [],
    gate: null,
    requestedSlot: null,
    affiliationParentStatus: null,
    ...rest,
  };
}

const slotsOf = (i: FocusInput) => computeFocusSlots(i).slots.map((s) => `${s.slot}${s.detail ? `:${s.detail.label}` : ""}/${s.reason}`);

describe("computeFocusSlots — order (AI-12 대화 진행 규칙)", () => {
  it("empty new project: basic info then situation of a new D1", () => {
    expect(slotsOf(input())).toEqual(["basic_info/order", "situation:D1/order"]);
    expect(computeFocusSlots(input()).slots[0].missingFields).toEqual(["name", "role", "start_month"]);
  });

  it("follows S → T → A → R → learnings for the latest detail", () => {
    const draft = {
      project: { name: f("결제"), role: f("백엔드"), start_month: f("2023-03") },
      details: [{ detail_key: "D1", fields: { title: f("t"), situation: f("s") } }],
    };
    expect(slotsOf(input({ draft }))).toEqual(["task:D1/order", "action:D1/order"]);
  });

  it("an achievement counts as a result", () => {
    const draft = {
      project: { name: f("결제"), role: f("백엔드"), start_month: f("2023-03") },
      details: [{ detail_key: "D1", fields: { title: f("t"), situation: f("s"), task: f("t"), action: f("a") }, achievements: [{ value_after: f(3) }] }],
    };
    expect(slotsOf(input({ draft }))).toEqual(["learnings:D1/order", "next_episode/order"]);
  });

  it("asks the period once name and role are known", () => {
    const draft = {
      project: { name: f("결제"), role: f("백엔드") },
      details: [{ detail_key: "D1", fields: { title: f("t"), situation: f("s"), task: f("t"), action: f("a"), result: f("r"), learnings: f("l") } }],
    };
    expect(slotsOf(input({ draft }))).toEqual(["basic_info/follow_up", "next_episode/order"]);
  });

  it("works on the last D-key detail and offers the next key", () => {
    const draft = { details: [{ detail_key: "D1" }, { detail_key: "D2" }] };
    expect(nextDetailKey(parseStructuredDraft(draft))).toBe("D3");
    expect(computeFocusSlots(input({ draft })).slots[1].detail?.label).toBe("D2");
  });
});

describe("computeFocusSlots — requested_slot and clarifications", () => {
  it("puts requested_slot first; filled slot → reinforce", () => {
    const draft = { details: [{ detail_key: "D1", fields: { action: f("a") } }] };
    expect(slotsOf(input({ draft, requestedSlot: { slot: "action", detail_key: "D1", existing_detail_id: null } }))).toEqual([
      "action:D1/requested_reinforce",
      "basic_info/order",
    ]);
    expect(slotsOf(input({ requestedSlot: { slot: "result", detail_key: null, existing_detail_id: null } }))[0]).toBe("result:D1/requested");
  });

  it("re-asks an unresolved clarification before new questions", () => {
    const draft = { clarifications: [{ kind: "actor_ambiguous", field: "action", detail_key: "D1" }], details: [{ detail_key: "D1" }] };
    const plan = computeFocusSlots(input({ draft }));
    expect(plan.slots[0]).toMatchObject({ slot: "action", reason: "clarification", clarification: "actor_ambiguous" });
    expect(plan.clarifications).toHaveLength(1);
  });

  it("a needs_review value counts as asked (not re-asked)", () => {
    const draft = { project: { name: f("x"), role: f("y", "needs_review"), start_month: f("2023-01") } };
    expect(slotsOf(input({ draft }))[0]).toBe("situation:D1/order");
  });
});

describe("computeFocusSlots — gate entry (U-5)", () => {
  const gate = { feature: "insight" as const, missing: ["complete_project" as const] };

  it("required fields first, then optional once", () => {
    expect(slotsOf(input({ gate }))).toEqual(["basic_info/gate_required", "situation:D1/gate_required"]);
    const draft = { project: { name: f("n"), role: f("r"), start_month: f("2023-01") }, details: [{ detail_key: "D1", fields: { title: f("t"), situation: f("s") } }] };
    expect(slotsOf(input({ gate, draft }))).toEqual(["action:D1/gate_required", "task:D1/optional_offer"]);
  });

  it("augment: fills the first draft existing detail's required fields", () => {
    const existingDetails = [
      { id: DETAIL_DRAFT_ID, alias: "DET-1", status: "draft" as const, sortOrder: 1, filled: new Set<DetailField>(["title"]) },
      { id: DETAIL_DONE_ID, alias: "DET-2", status: "complete" as const, sortOrder: 2, filled: new Set<DetailField>(["title", "situation", "action"]) },
    ];
    const plan = computeFocusSlots(
      input({ mode: "augment_project", gate, existingProject: { filled: new Set<ProjectField>(["name", "role"]) }, existingDetails }),
    );
    expect(plan.slots.map((s) => `${s.slot}:${s.detail?.label}`)).toEqual(["situation:DET-1", "action:DET-1"]);
    expect(plan.slots[0].missingFields).toEqual(["situation"]);
  });
});

describe("predictReadyToReturn (D-01)", () => {
  const gate = { feature: "insight" as const, missing: ["complete_project" as const] };
  const complete = {
    project: { name: f("n"), role: f("r") },
    details: [{ detail_key: "D1", fields: { title: f("t"), situation: f("s"), action: f("a") } }],
  };

  it.each([
    ["no gate", { draft: complete, gate: null }, false],
    ["complete draft", { draft: complete, gate }, true],
    ["missing experience can't be fixed here", { draft: complete, gate: { feature: "insight" as const, missing: ["complete_experience" as const, "complete_project" as const] } }, false],
    ["needs_review action is skipped on save", { draft: { ...complete, details: [{ detail_key: "D1", fields: { title: f("t"), situation: f("s"), action: f("a", "needs_review") } }] }, gate }, false],
    ["accepted counts", { draft: { ...complete, details: [{ detail_key: "D1", fields: { title: f("t"), situation: f("s"), action: f("a", "accepted") } }] }, gate }, true],
    ["no role", { draft: { ...complete, project: { name: f("n") } }, gate }, false],
    ["draft parent experience", { draft: complete, gate, affiliationParentStatus: "draft" as const }, false],
    ["already ready", { draft: {}, gate: { feature: "insight" as const, missing: [] } }, true],
  ])("%s → %s", (_name, overrides, expected) => {
    expect(predictReadyToReturn(input(overrides as InputOverrides))).toBe(expected);
    expect(computeFocusSlots(input(overrides as InputOverrides)).readyToReturn).toBe(expected);
  });

  it("augment: existing values + draft values combine", () => {
    const existingDetails = [{ id: DETAIL_DRAFT_ID, alias: "DET-1", status: "draft" as const, sortOrder: 1, filled: new Set<DetailField>(["title"]) }];
    const draft = { details: [{ detail_key: null, existing_detail_id: DETAIL_DRAFT_ID, fields: { situation: f("s"), action: f("a") } }] };
    expect(
      predictReadyToReturn(input({ mode: "augment_project", gate, draft, existingProject: { filled: new Set<ProjectField>(["name", "role"]) }, existingDetails })),
    ).toBe(true);
  });
});
