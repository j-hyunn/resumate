import {
  hasValue,
  isApplicable,
  type Clarification,
  type StarField,
  type StructuredDraft,
} from "../schemas/structured-draft";

/**
 * AI-12 v4.5 "대화 진행 규칙 (서버가 슬롯 순서를 결정, STAR 1개)", the gate-entry
 * rules (U-5), and the quick chips (CR-5). Pure functions of the project's
 * current values, the chat's proposal, the gate context, and `requested_slot`.
 *
 * A slot counts as filled when the project has a value or the proposal has a
 * pending value. Skipped slots ("모르겠어요/건너뛸게요") are not tracked in the
 * DB; the reply sees the conversation and moves on (`upcoming`).
 */

export const SLOT_IDS = ["period", "situation", "task", "action", "result", "learnings"] as const;
export type SlotId = (typeof SLOT_IDS)[number];
export type StarSlot = Exclude<SlotId, "period">;

/** (R14, AI spec v4.14 RM-1) `job_interview` is gone: three return targets. */
export const GATE_FEATURES = ["insight", "career_description", "cover_letter"] as const;
export type GateFeature = (typeof GATE_FEATURES)[number];
export type ReadinessMissing = "complete_experience" | "complete_project";

export type RequestedSlot = { slot: SlotId };

export type FocusReason = "requested" | "requested_reinforce" | "clarification" | "gate_required" | "order" | "optional_offer";

export type FocusSlot = {
  slot: SlotId;
  /** Empty columns of this slot. */
  missingFields: string[];
  reason: FocusReason;
  /** For reason "clarification". */
  clarification?: Clarification["kind"];
};

export type FocusPlan = {
  /** 1–2 slots for this turn, in order. */
  slots: FocusSlot[];
  /** Next unfilled slots after `slots` (≤ 3), to move on when the user skips. */
  upcoming: FocusSlot[];
  /** Required STAR (situation + action) is on the project or applicable in the proposal. */
  requiredComplete: boolean;
  /** Required STAR is complete only through the proposal → the reply may say "왼쪽에 반영할 수 있어요". */
  canApply: boolean;
  /** Gate entry and D-01 is met now (readiness recomputed every turn, after an apply) → "돌아갈 수 있어요". */
  readyToReturn: boolean;
  /** STAR fields with no room left (C-14) — not asked; the reply says the field is full. */
  fullFields: StarField[];
  /** Unresolved clarifications in the proposal. */
  clarifications: Clarification[];
};

export type ProjectSlotState = {
  /** Project STAR as it is now. */
  star: Readonly<Record<StarField, string | null>>;
  startMonth: string | null;
};

export type FocusInput = {
  project: ProjectSlotState;
  draft: StructuredDraft;
  gate: { feature: GateFeature; missing: readonly ReadinessMissing[] } | null;
  requestedSlot: RequestedSlot | null;
  /** STAR fields with no room for appended text (C-14). */
  fullFields?: readonly StarField[];
};

export const STAR_ORDER: readonly StarSlot[] = ["situation", "task", "action", "result", "learnings"];
export const REQUIRED_STAR: readonly StarSlot[] = ["situation", "action"];
export const OPTIONAL_STAR: readonly StarSlot[] = ["task", "result", "learnings"];

export const MAX_FOCUS_SLOTS = 2;
export const MAX_UPCOMING = 3;

function filled(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim() !== "";
}

export function starFilled(input: Pick<FocusInput, "project" | "draft">, field: StarField): boolean {
  return filled(input.project.star[field]) || hasValue(input.draft.star[field]);
}

/** Filled for D-01 purposes: on the project, or an applicable (not needs_review) proposal. */
function starSavable(input: Pick<FocusInput, "project" | "draft">, field: StarField): boolean {
  return filled(input.project.star[field]) || isApplicable(input.draft.star[field]);
}

function periodFilled(input: Pick<FocusInput, "project" | "draft">): boolean {
  return filled(input.project.startMonth) || hasValue(input.draft.project.start_month);
}

function missingFor(input: FocusInput, slot: SlotId): string[] {
  if (slot === "period") return periodFilled(input) ? [] : ["start_month"];
  return starFilled(input, slot) ? [] : [slot];
}

export function computeFocusSlots(input: FocusInput): FocusPlan {
  const full = new Set(input.fullFields ?? []);
  const slots: FocusSlot[] = [];

  // 1. requested_slot first (R-18); a filled slot is asked as reinforcement ("보강할 내용이 있나요?").
  if (input.requestedSlot && !(input.requestedSlot.slot !== "period" && full.has(input.requestedSlot.slot))) {
    const slot = input.requestedSlot.slot;
    const missing = missingFor(input, slot);
    slots.push({ slot, missingFields: missing, reason: missing.length ? "requested" : "requested_reinforce" });
  }

  // 2. unresolved clarifications (되묻기) before new questions.
  const firstClar = input.draft.clarifications[0];
  if (firstClar && slots.length < MAX_FOCUS_SLOTS) {
    const slot = clarificationSlot(firstClar);
    if (!slots.some((s) => s.slot === slot) && !(slot !== "period" && full.has(slot))) {
      slots.push({ slot, missingFields: missingFor(input, slot), reason: "clarification", clarification: firstClar.kind });
    }
  }

  // 3. ordered unfilled slots.
  const rest = orderedSlots(input).filter((s) => !slots.some((t) => t.slot === s.slot) && !(s.slot !== "period" && full.has(s.slot)));
  while (slots.length < MAX_FOCUS_SLOTS && rest.length > 0) slots.push(rest.shift()!);

  const requiredComplete = REQUIRED_STAR.every((f) => starSavable(input, f));
  const requiredOnProject = REQUIRED_STAR.every((f) => filled(input.project.star[f]));
  return {
    slots: slots.slice(0, MAX_FOCUS_SLOTS),
    upcoming: rest.slice(0, MAX_UPCOMING),
    requiredComplete,
    canApply: requiredComplete && !requiredOnProject,
    readyToReturn: !!input.gate && input.gate.missing.length === 0,
    fullFields: [...full],
    clarifications: [...input.draft.clarifications],
  };
}

function clarificationSlot(c: Clarification): SlotId {
  switch (c.kind) {
    case "actor_ambiguous":
      return "action";
    case "number_vague":
      return "result";
    case "period_unclear":
      return "period";
  }
}

/**
 * Spec table order: period (only when empty) → S → T → A → R → learnings.
 * Gate entry: required (situation, action) first (U-5), then period, then the
 * optional fields once. Once required is filled, optional slots are offered
 * (`optional_offer`) rather than asked in order.
 */
function orderedSlots(input: FocusInput): FocusSlot[] {
  const out: FocusSlot[] = [];
  const requiredDone = REQUIRED_STAR.every((f) => starFilled(input, f));
  const push = (slot: SlotId, reason: FocusReason) => {
    const missing = missingFor(input, slot);
    if (missing.length > 0) out.push({ slot, missingFields: missing, reason });
  };
  if (input.gate) {
    for (const slot of REQUIRED_STAR) push(slot, "gate_required");
    push("period", "order");
    for (const slot of OPTIONAL_STAR) push(slot, "optional_offer");
    return out;
  }
  push("period", "order");
  for (const slot of STAR_ORDER) push(slot, requiredDone && OPTIONAL_STAR.includes(slot) ? "optional_offer" : "order");
  return out;
}

// ---------- quick chips (AI-12 "빠른 버튼 칩 3개", [가정]) ----------

export type QuickChip = {
  /** Button text; also the fixed user message the chip sends (counted in the 40-message cap). */
  label: string;
  requested_slot: StarSlot;
};

/**
 * Three chips for the panel input (sent with `turn_done` and on chat load).
 * State = project values + pending proposal values (CR-5 table):
 * - a required field (situation/action) empty → first empty required, result, learnings
 * - required filled, an optional (task/result/learnings) empty → first empty, action, result
 * - all filled → reinforce action, result, learnings
 */
export function quickChips(input: Pick<FocusInput, "project" | "draft">): QuickChip[] {
  const firstEmpty = (fields: readonly StarSlot[]) => fields.find((f) => !starFilled(input, f));
  const requiredEmpty = firstEmpty(REQUIRED_STAR);
  if (requiredEmpty) {
    return [
      { label: "비어 있는 항목부터 물어봐 줘", requested_slot: requiredEmpty },
      { label: "결과/성과도 정리하고 싶어요", requested_slot: "result" },
      { label: "배운 점도 정리하고 싶어요", requested_slot: "learnings" },
    ];
  }
  const anyEmpty = firstEmpty(STAR_ORDER);
  if (anyEmpty) {
    return [
      { label: "남은 항목 채우기", requested_slot: anyEmpty },
      { label: "본인이 한 일을 더 구체적으로", requested_slot: "action" },
      { label: "결과/성과에 수치 더하기", requested_slot: "result" },
    ];
  }
  return [
    { label: "행동 보강하기", requested_slot: "action" },
    { label: "결과/성과 보강하기", requested_slot: "result" },
    { label: "배운 점 보강하기", requested_slot: "learnings" },
  ];
}
