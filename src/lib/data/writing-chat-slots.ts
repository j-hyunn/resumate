/**
 * S-36 slot model (client- and server-safe). Moved from components/career/writing-chat/slots.ts
 * (Phase 3) because the mock AI turn (lib/mock/writing-chat-turn.ts) depends on it. Question order F-P1-13 (2):
 * 기본 정보 → 상황 → 과제 → 행동 → 결과 → 회고 및 배운 점.
 * The mock keeps one detail card per chat (structured_draft.details[0]).
 */
import type { ProjectDetail, StructuredDraft, StructuredField, WritingChatMode } from "@/types/db"

export type ChatSlot = "name" | "role" | "title" | "situation" | "task" | "action" | "result" | "learnings"

export const SLOT_LABELS: Record<ChatSlot, string> = {
  name: "프로젝트 이름",
  role: "역할",
  title: "상세 내용 제목",
  situation: "상황",
  task: "과제",
  action: "행동",
  result: "결과",
  learnings: "회고 및 배운 점",
}

export interface StepDef {
  key: "basic" | "situation" | "task" | "action" | "result" | "learnings"
  label: string
  slots: ChatSlot[]
}

export function stepDefs(mode: WritingChatMode): StepDef[] {
  return [
    // [UI-가정] 기본 정보 단계 = 프로젝트 이름·역할(새 프로젝트) + 상세 내용 제목
    { key: "basic", label: "기본 정보", slots: mode === "new_project" ? ["name", "role", "title"] : ["title"] },
    { key: "situation", label: "상황", slots: ["situation"] },
    { key: "task", label: "과제", slots: ["task"] },
    { key: "action", label: "행동", slots: ["action"] },
    { key: "result", label: "결과", slots: ["result"] },
    { key: "learnings", label: "회고 및 배운 점", slots: ["learnings"] },
  ]
}

const DETAIL_SLOTS: ChatSlot[] = ["title", "situation", "task", "action", "result", "learnings"]
export function isDetailSlot(slot: ChatSlot): slot is Exclude<ChatSlot, "name" | "role"> {
  return DETAIL_SLOTS.includes(slot)
}

/** structured_draft path for a slot (apply_structured_draft_patch path) */
export function slotPath(slot: ChatSlot): string {
  return isDetailSlot(slot) ? `details.0.fields.${slot}` : `project.${slot}`
}

export function slotField(draft: StructuredDraft, slot: ChatSlot): StructuredField | undefined {
  if (isDetailSlot(slot)) return draft.details?.[0]?.fields[slot]
  return draft.project?.[slot]
}

function hasValue(f?: StructuredField<unknown>): boolean {
  return Boolean(f && f.value !== null && f.value !== "")
}

/** Filled = draft value present, or (augment) the existing detail already has it. */
export function isSlotFilled(draft: StructuredDraft, slot: ChatSlot, existing?: Pick<ProjectDetail, ProjectDetailKeys> | null): boolean {
  if (isDetailSlot(slot) && existing && existing[slot]) return true
  return hasValue(slotField(draft, slot))
}
type ProjectDetailKeys = "title" | "situation" | "task" | "action" | "result" | "learnings"

export function slotOrder(mode: WritingChatMode, requiredFirst: boolean): ChatSlot[] {
  const base: ChatSlot[] =
    mode === "new_project"
      ? ["name", "role", "title", "situation", "task", "action", "result", "learnings"]
      : ["title", "situation", "task", "action", "result", "learnings"]
  if (!requiredFirst) return base
  // gate entry (AI 명세 AI-12): 필수(이름·역할·제목·상황·행동) 먼저
  const required: ChatSlot[] = ["name", "role", "title", "situation", "action"]
  return [...base.filter((s) => required.includes(s)), ...base.filter((s) => !required.includes(s))]
}

export function nextOpenSlot(
  draft: StructuredDraft,
  mode: WritingChatMode,
  existing: Pick<ProjectDetail, ProjectDetailKeys> | null,
  skipped: ChatSlot[],
  requiredFirst: boolean,
): ChatSlot | null {
  return slotOrder(mode, requiredFirst).find((s) => !isSlotFilled(draft, s, existing) && !skipped.includes(s)) ?? null
}

/** Fixed-copy message sent by "이 부분부터 다시 물어봐 줘" / "AI에게 물어봐 줘" — [UI-가정] copy */
export function requestSlotMessage(slot: ChatSlot, fromStep: boolean): string {
  return fromStep ? `${SLOT_LABELS[slot]} 부분부터 다시 물어봐 줘` : `${SLOT_LABELS[slot]} 부분을 물어봐 줘`
}

export const QUICK_REPLIES = ["잘 모르겠어요", "건너뛸게요"] as const

/** "project.name" / "details.0.fields.action" → slot */
export function slotFromPath(path: string): ChatSlot | null {
  const last = path.split(".").pop() as ChatSlot | undefined
  return last && last in SLOT_LABELS ? last : null
}
