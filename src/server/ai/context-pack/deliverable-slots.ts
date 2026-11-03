/**
 * AI-13 산출물 AI 작성 대화 — 산출물 종류, 종류별 슬롯, 초안 조건, 빠른 버튼 칩
 * (AI spec v4.6 AI-13 "산출물 종류와 질문 구성", "빠른 버튼 칩 3개", C-14).
 *
 * Pure and dependency-free on purpose: the chip table is "one shared constant
 * + pure function" that the screen calls (R-PA-5), so this file must stay
 * importable from client code (no zod, no node APIs, no server-only).
 * Values marked [가정] are spec assumptions kept as named constants.
 */

// ---------- 산출물 종류 (writing_kind, structured_draft only — PA-2) ----------

export const WRITING_KINDS = ["planning_summary", "design_doc", "retrospective", "presentation", "other"] as const;
export type WritingKind = (typeof WRITING_KINDS)[number];

export const WRITING_KIND_LABELS: Readonly<Record<WritingKind, string>> = {
  planning_summary: "기획서 요약",
  design_doc: "설계 문서",
  retrospective: "회고",
  presentation: "발표",
  other: "기타",
};

export function isWritingKind(v: unknown): v is WritingKind {
  return typeof v === "string" && (WRITING_KINDS as readonly string[]).includes(v);
}

/**
 * [가정] AI-13 "정하는 법 ①": title keywords → kind, first match wins. Mirrors
 * `private.deliverable_writing_kind_guess` (r5 migration) exactly — the DB
 * pre-fills the new chat's writing_kind with it; QA compares the two lists.
 */
export const WRITING_KIND_TITLE_PATTERNS: ReadonlyArray<readonly [WritingKind, RegExp]> = [
  ["retrospective", /(회고|retrospective|retro\b)/i],
  ["design_doc", /(설계|아키텍처|architecture|design doc)/i],
  ["planning_summary", /(기획|planning)/i],
  ["presentation", /(발표|presentation|keynote)/i],
];

export function guessWritingKind(title: string | null | undefined): WritingKind | null {
  const t = title ?? "";
  if (!t.trim()) return null;
  for (const [kind, pattern] of WRITING_KIND_TITLE_PATTERNS) if (pattern.test(t)) return kind;
  return null;
}

// ---------- 슬롯 ----------

/** AI-13 `facts[].slot` keys [가정] (spec list, in spec order). */
export const DELIVERABLE_SLOTS = [
  "background",
  "goal",
  "contribution",
  "scope",
  "outcome",
  "requirements",
  "structure",
  "decisions",
  "limits",
  "went_well",
  "went_wrong",
  "learnings",
  "audience",
  "message",
  "outline",
  "reaction",
  "what",
  "purpose",
  "content",
] as const;
export type DeliverableSlot = (typeof DELIVERABLE_SLOTS)[number];

export function isDeliverableSlot(v: unknown): v is DeliverableSlot {
  return typeof v === "string" && (DELIVERABLE_SLOTS as readonly string[]).includes(v);
}

/** "본인 기여"는 모든 종류에서 필수 슬롯 (slot 3 of every kind). */
export const REQUIRED_DELIVERABLE_SLOT = "contribution" satisfies DeliverableSlot;

/** Slots per kind, asked top to bottom (AI-13 table) [가정 — slot keys]. */
export const KIND_SLOTS: Readonly<Record<WritingKind, readonly DeliverableSlot[]>> = {
  planning_summary: ["background", "goal", "contribution", "scope", "outcome"],
  design_doc: ["requirements", "structure", "contribution", "decisions", "limits"],
  retrospective: ["scope", "went_well", "contribution", "went_wrong", "learnings"],
  presentation: ["audience", "message", "contribution", "outline", "reaction"],
  other: ["what", "purpose", "contribution", "content", "outcome"],
};

/** Labels as the AI-13 slot table names them (per kind where a key is shared). */
const SLOT_LABEL_DEFAULT: Readonly<Record<DeliverableSlot, string>> = {
  background: "배경·해결할 문제",
  goal: "목표·대상 사용자",
  contribution: "본인이 맡은 부분",
  scope: "핵심 기능·범위",
  outcome: "결과·검증",
  requirements: "해결할 문제·요구사항",
  structure: "구조(구성 요소·흐름)",
  decisions: "주요 결정과 대안·이유",
  limits: "결과·한계",
  went_well: "잘된 점",
  went_wrong: "아쉬운 점·원인",
  learnings: "배운 점·다음에 다르게 할 점",
  audience: "발표 자리·청중",
  message: "핵심 메시지",
  outline: "구성",
  reaction: "반응·결과",
  what: "어떤 결과물인가",
  purpose: "목적",
  content: "주요 내용",
};

export function slotLabel(slot: DeliverableSlot, kind: WritingKind | null): string {
  if (kind === "retrospective" && slot === "scope") return "무엇을 했나(범위)";
  if (kind === "other" && slot === "outcome") return "결과";
  return SLOT_LABEL_DEFAULT[slot];
}

/** Slots that belong to the kind (unknown kind: none — the first question is the kind). */
export function slotsFor(kind: WritingKind | null): readonly DeliverableSlot[] {
  return kind ? KIND_SLOTS[kind] : [];
}

// ---------- 초안 조건·상한 (C-14, 7.4) ----------

/** [가정] 대화당 초안 생성 6회 (PRD F-P1-18 (7), DM 2.5.0 `draft_count`). */
export const DELIVERABLE_DRAFT_LIMIT = 6;
/** "사실이 2개 미만이고 본문이 비어 있으면" 초안 불가. */
export const DRAFT_MIN_FACTS = 2;

export const COMPOSE_STYLES = ["shorter", "more_detail_on_contribution"] as const;
export type ComposeStyle = (typeof COMPOSE_STYLES)[number];

/**
 * Turn request `requested_action`. `compose_draft` is the spec's; `ask_from_project`
 * is the "프로젝트 내용을 바탕으로 물어봐 줘" chip (spec: "부모 description 기반 질문") [가정].
 */
export const DELIVERABLE_REQUESTED_ACTIONS = ["compose_draft", "ask_from_project"] as const;
export type DeliverableRequestedAction = (typeof DELIVERABLE_REQUESTED_ACTIONS)[number];

/** Minimal view of a stored fact for slot / chip logic. */
export type FactLike = { slot: string; review: "ok" | "needs_review" | "accepted"; actor?: string };

/** Facts a draft may cite: validated ok, or needs_review the user accepted (V-10a). */
export function isUsableFact(f: FactLike): boolean {
  return f.review === "ok" || f.review === "accepted";
}

function blank(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === "";
}

/** Draft allowed by content: ≥ 2 usable facts, or a non-empty current body. */
export function canComposeByContent(usableFactCount: number, formBody: string | null | undefined): boolean {
  return usableFactCount >= DRAFT_MIN_FACTS || !blank(formBody);
}

// ---------- 빠른 버튼 칩 (AI-13 표, R-PA-5: the screen computes them) ----------

export type DeliverableChip = {
  /** Button text; also the fixed user message it sends (counted in the 40-message cap). */
  label: string;
  requested_slot: DeliverableSlot | null;
  requested_action: DeliverableRequestedAction | null;
  style: ComposeStyle | null;
  /** "새 대화 시작" — a screen action, not a message. */
  new_chat?: true;
};

export type DeliverableChipState = {
  /** The S-44 form's current body (unsaved edits included). */
  formBody: string | null;
  /** writing_kind of the open chat (null = unknown / no chat). */
  writingKind: WritingKind | null;
  /** facts[] of the open chat ([] when there is no chat row yet). */
  facts: readonly FactLike[];
  /** deliverable.body has a draft value. */
  hasDraft: boolean;
  /** structured_draft.draft_count (0 without a chat). */
  draftCount: number;
  /** status = 'closed' (or 40 messages): no chips. */
  closed?: boolean;
};

const chip = (label: string, extra: Partial<Omit<DeliverableChip, "label">> = {}): DeliverableChip => ({
  label,
  requested_slot: null,
  requested_action: null,
  style: null,
  ...extra,
});

/** First slot of the kind with no fact yet (any review state); null when all are filled or the kind is unknown. */
export function firstEmptySlot(kind: WritingKind | null, facts: readonly FactLike[]): DeliverableSlot | null {
  return slotsFor(kind).find((s) => !facts.some((f) => f.slot === s)) ?? null;
}

/**
 * AI-13 "빠른 버튼 칩 3개". Rows: 초안 불가 (usable facts < 2 and the body is
 * empty) / 초안 가능·초안 없음 / 초안 있음. At draft_count ≥ 6 the draft chips
 * become "빠진 부분 물어봐 줘" and "새 대화 시작". The server re-checks every
 * request (chips are never trusted).
 */
export function deliverableChips(state: DeliverableChipState): DeliverableChip[] {
  if (state.closed) return [];
  const usable = state.facts.filter(isUsableFact).length;
  const next = firstEmptySlot(state.writingKind, state.facts);
  const askMissing = chip("빠진 부분 물어봐 줘", { requested_slot: next });
  const moreContribution = chip("제가 한 일을 더 구체적으로", { requested_slot: REQUIRED_DELIVERABLE_SLOT });
  const newChat = chip("새 대화 시작", { new_chat: true });
  const limitReached = state.draftCount >= DELIVERABLE_DRAFT_LIMIT;

  if (!canComposeByContent(usable, state.formBody)) {
    return [
      chip("무엇을 쓰면 좋을지 알려 줘", { requested_slot: next }),
      chip("제가 맡은 부분부터 말할게요", { requested_slot: REQUIRED_DELIVERABLE_SLOT }),
      chip("프로젝트 내용을 바탕으로 물어봐 줘", { requested_action: "ask_from_project" }),
    ];
  }
  if (!state.hasDraft) {
    if (limitReached) return [askMissing, moreContribution, newChat];
    return [chip("지금까지 내용으로 초안 만들기", { requested_action: "compose_draft" }), askMissing, moreContribution];
  }
  if (limitReached) return [askMissing, newChat, moreContribution];
  return [
    chip("새 내용으로 초안 다시 만들기", { requested_action: "compose_draft" }),
    chip("더 짧게 정리해 줘", { requested_action: "compose_draft", style: "shorter" }),
    askMissing,
  ];
}
