import {
  hasValue,
  isSavable,
  type Clarification,
  type DetailField,
  type DraftDetail,
  type ProjectField,
  type StructuredDraft,
} from "../schemas/structured-draft";

/**
 * AI-12 "대화 진행 규칙 (서버가 슬롯 순서를 결정)" and the gate-entry rules
 * (U-5): the server decides which 1–2 slots the reply asks about this turn.
 * Pure function of the current draft, the augment target, the gate context,
 * and the screen's `requested_slot`.
 *
 * Skipped slots ("모르겠어요/건너뛸게요") are not tracked in the DB; the reply
 * sees the conversation and is told to move on from a slot the user skipped
 * (`upcoming` gives it the next candidates).
 */

export const SLOT_IDS = ["basic_info", "situation", "task", "action", "result", "learnings", "next_episode"] as const;
export type SlotId = (typeof SLOT_IDS)[number];

export const GATE_FEATURES = ["insight", "career_description", "cover_letter", "job_interview"] as const;
export type GateFeature = (typeof GATE_FEATURES)[number];
export type ReadinessMissing = "complete_experience" | "complete_project";

export type RequestedSlot = { slot: SlotId; detail_key: string | null; existing_detail_id: string | null };

export type DetailTarget = {
  detail_key: string | null;
  existing_detail_id: string | null;
  /** Alias the model sees: "D1" or "DET-2"; "new" for a detail not created yet. */
  label: string;
};

export type FocusReason =
  | "requested"
  | "requested_reinforce"
  | "clarification"
  | "gate_required"
  | "order"
  | "optional_offer"
  | "follow_up";

export type FocusSlot = {
  slot: SlotId;
  detail: DetailTarget | null;
  /** Empty fields of this slot (column names). */
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
  /** Required fields (project name·role + one detail title·situation·action) are all savable. */
  requiredComplete: boolean;
  /** Gate entry: saving now is predicted to satisfy D-01 → the reply says it can return. */
  readyToReturn: boolean;
  /** Unresolved clarifications in the draft. */
  clarifications: Clarification[];
};

export type ExistingDetailState = {
  id: string;
  alias: string;
  status: "draft" | "complete";
  sortOrder: number;
  filled: ReadonlySet<DetailField>;
};

export type FocusInput = {
  mode: "new_project" | "augment_project";
  draft: StructuredDraft;
  /** augment_project: filled columns of the target project and its details. */
  existingProject: { filled: ReadonlySet<ProjectField> } | null;
  existingDetails: readonly ExistingDetailState[];
  gate: { feature: GateFeature; missing: readonly ReadinessMissing[] } | null;
  requestedSlot: RequestedSlot | null;
  /** Status of the confirmed affiliation's experience/education row (a draft parent excludes the project, C-1). */
  affiliationParentStatus: "complete" | "draft" | null;
};

const REQUIRED_DETAIL: readonly DetailField[] = ["title", "situation", "action"];
const SLOT_FIELDS: Record<Exclude<SlotId, "basic_info" | "next_episode">, readonly DetailField[]> = {
  situation: ["title", "situation"],
  task: ["task"],
  action: ["action"],
  result: ["result"],
  learnings: ["learnings"],
};
const STAR_ORDER = ["situation", "task", "action", "result", "learnings"] as const;
const OPTIONAL_STAR = ["task", "result", "learnings"] as const;
const REQUIRED_STAR = ["situation", "action"] as const;

export const MAX_FOCUS_SLOTS = 2;
export const MAX_UPCOMING = 3;

export function computeFocusSlots(input: FocusInput): FocusPlan {
  const state = new DraftState(input);
  const ordered = orderedSlots(input, state);
  const slots: FocusSlot[] = [];

  // 1. requested_slot first (R-18).
  if (input.requestedSlot) {
    const r = input.requestedSlot;
    const detail = r.slot === "basic_info" || r.slot === "next_episode" ? null : state.detailFor(r);
    const missing = state.missingFor(r.slot, detail);
    const filled = r.slot !== "next_episode" && missing.length === 0;
    slots.push({ slot: r.slot, detail, missingFields: missing, reason: filled ? "requested_reinforce" : "requested" });
  }

  // 2. unresolved clarifications (되묻기) before new questions.
  const clarifications = input.draft.clarifications;
  const firstClar = clarifications[0];
  if (firstClar && slots.length < MAX_FOCUS_SLOTS) {
    const slot = clarificationSlot(firstClar);
    const detail = slot === "basic_info" ? null : state.targetFromClarification(firstClar);
    if (!slots.some((s) => s.slot === slot && sameDetail(s.detail, detail))) {
      slots.push({ slot, detail, missingFields: state.missingFor(slot, detail), reason: "clarification", clarification: firstClar.kind });
    }
  }

  // 3. ordered unfilled slots.
  const rest = ordered.filter((s) => !slots.some((t) => t.slot === s.slot && sameDetail(t.detail, s.detail)));
  while (slots.length < MAX_FOCUS_SLOTS && rest.length > 0) slots.push(rest.shift()!);

  const requiredComplete = state.requiredComplete();
  return {
    slots: slots.slice(0, MAX_FOCUS_SLOTS),
    upcoming: rest.slice(0, MAX_UPCOMING),
    requiredComplete,
    readyToReturn: predictReadyToReturn(input),
    clarifications: [...clarifications],
  };
}

/**
 * D-01 prediction for gate entry (AI-12 "서버는 턴마다 structured_draft를
 * 저장했을 때 D-01이 충족되는지 미리 계산"): no missing experience, and saving
 * now would yield a complete project (name·role + a detail with
 * title·situation·action, counting only values save_writing_chat writes).
 */
export function predictReadyToReturn(input: FocusInput): boolean {
  if (!input.gate) return false;
  if (input.gate.missing.includes("complete_experience")) return false;
  if (input.gate.missing.length === 0) return true;
  if (input.affiliationParentStatus === "draft") return false;
  return new DraftState(input).requiredComplete();
}

function clarificationSlot(c: Clarification): SlotId {
  switch (c.kind) {
    case "actor_ambiguous":
      return "action";
    case "number_vague":
      return "result";
    case "period_unclear":
    case "affiliation_unclear":
      return "basic_info";
  }
}

function sameDetail(a: DetailTarget | null, b: DetailTarget | null): boolean {
  if (!a || !b) return a === b;
  return a.detail_key === b.detail_key && a.existing_detail_id === b.existing_detail_id;
}

function orderedSlots(input: FocusInput, state: DraftState): FocusSlot[] {
  const out: FocusSlot[] = [];
  const gated = input.gate !== null;
  const detail = state.currentDetail();
  const push = (slot: SlotId, d: DetailTarget | null, reason: FocusReason) => {
    const missing = state.missingFor(slot, d);
    if (slot === "next_episode" || missing.length > 0) out.push({ slot, detail: d, missingFields: missing, reason });
  };

  const basicRequired = state.missingFor("basic_info", null).filter((f) => f === "name" || f === "role");
  if (basicRequired.length > 0) {
    out.push({ slot: "basic_info", detail: null, missingFields: state.missingFor("basic_info", null), reason: gated ? "gate_required" : "order" });
  }
  if (gated) {
    // Required first (U-5), then the optional fields once.
    for (const slot of REQUIRED_STAR) push(slot, detail, "gate_required");
    if (state.missingFor("basic_info", null).includes("start_month") && basicRequired.length === 0) push("basic_info", null, "follow_up");
    for (const slot of OPTIONAL_STAR) push(slot, detail, "optional_offer");
  } else {
    for (const slot of STAR_ORDER) push(slot, detail, "order");
    if (state.missingFor("basic_info", null).includes("start_month") && basicRequired.length === 0) push("basic_info", null, "follow_up");
  }
  push("next_episode", null, "order");
  return out;
}

class DraftState {
  constructor(private readonly input: FocusInput) {}

  private draftDetail(t: DetailTarget | null): DraftDetail | undefined {
    if (!t) return undefined;
    return this.input.draft.details.find((d) =>
      t.existing_detail_id ? d.existing_detail_id === t.existing_detail_id : d.existing_detail_id === null && d.detail_key === t.detail_key,
    );
  }

  private existing(t: DetailTarget | null): ExistingDetailState | undefined {
    if (!t?.existing_detail_id) return undefined;
    return this.input.existingDetails.find((d) => d.id === t.existing_detail_id);
  }

  projectFilled(field: ProjectField, savableOnly = false): boolean {
    if (this.input.existingProject?.filled.has(field)) return true;
    const f = this.input.draft.project[field];
    return savableOnly ? isSavable(f) : hasValue(f);
  }

  detailFilled(t: DetailTarget | null, field: DetailField, savableOnly = false): boolean {
    if (this.existing(t)?.filled.has(field)) return true;
    const f = this.draftDetail(t)?.fields[field];
    return savableOnly ? isSavable(f) : hasValue(f);
  }

  missingFor(slot: SlotId, t: DetailTarget | null): string[] {
    if (slot === "next_episode") return [];
    if (slot === "basic_info") {
      if (this.input.mode === "augment_project") {
        return (["name", "role"] as const).filter((f) => !this.projectFilled(f));
      }
      return (["name", "role", "start_month"] as const).filter((f) => !this.projectFilled(f));
    }
    const fields = [...SLOT_FIELDS[slot]];
    if (slot === "result") {
      const hasAchievement = (this.draftDetail(t)?.achievements.length ?? 0) > 0;
      return this.detailFilled(t, "result") || hasAchievement ? [] : fields;
    }
    return fields.filter((f) => !this.detailFilled(t, f));
  }

  /**
   * The detail this turn works on:
   * - augment: the first existing draft detail (sort order) missing a required
   *   field, else the latest new detail, else a new one;
   * - new_project: the latest new detail (D-key), else a new one ("D1").
   */
  currentDetail(): DetailTarget {
    if (this.input.mode === "augment_project") {
      const incomplete = [...this.input.existingDetails]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .find((d) => d.status === "draft" && REQUIRED_DETAIL.some((f) => !this.detailFilled({ detail_key: null, existing_detail_id: d.id, label: d.alias }, f)));
      if (incomplete) return { detail_key: null, existing_detail_id: incomplete.id, label: incomplete.alias };
    }
    const keyed = this.input.draft.details.filter((d) => d.existing_detail_id === null && d.detail_key);
    const last = keyed[keyed.length - 1];
    if (last?.detail_key) return { detail_key: last.detail_key, existing_detail_id: null, label: last.detail_key };
    return { detail_key: nextDetailKey(this.input.draft), existing_detail_id: null, label: nextDetailKey(this.input.draft) };
  }

  detailFor(r: RequestedSlot): DetailTarget {
    if (r.existing_detail_id) {
      const e = this.input.existingDetails.find((d) => d.id === r.existing_detail_id);
      if (e) return { detail_key: null, existing_detail_id: e.id, label: e.alias };
    }
    if (r.detail_key) return { detail_key: r.detail_key, existing_detail_id: null, label: r.detail_key };
    return this.currentDetail();
  }

  targetFromClarification(c: Clarification): DetailTarget {
    if (c.existing_detail_id) {
      const e = this.input.existingDetails.find((d) => d.id === c.existing_detail_id);
      return { detail_key: null, existing_detail_id: c.existing_detail_id, label: e?.alias ?? "DET-?" };
    }
    if (c.detail_key) return { detail_key: c.detail_key, existing_detail_id: null, label: c.detail_key };
    return this.currentDetail();
  }

  /** D-01 project part with savable values only (needs_review is skipped on save). */
  requiredComplete(): boolean {
    if (!this.projectFilled("name", true) || !this.projectFilled("role", true)) return false;
    const targets: DetailTarget[] = [
      ...this.input.existingDetails.map((d) => ({ detail_key: null, existing_detail_id: d.id, label: d.alias })),
      ...this.input.draft.details
        .filter((d) => d.existing_detail_id === null && d.detail_key)
        .map((d) => ({ detail_key: d.detail_key, existing_detail_id: null, label: d.detail_key! })),
    ];
    return targets.some((t) => REQUIRED_DETAIL.every((f) => this.detailFilled(t, f, true)));
  }
}

/** Next unused D-key ("D1", "D2", …). */
export function nextDetailKey(draft: StructuredDraft): string {
  let max = 0;
  for (const d of draft.details) {
    const m = /^D(\d+)$/.exec(d.detail_key ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `D${max + 1}`;
}
