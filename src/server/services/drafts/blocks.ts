import type { DraftBlockView } from "@/lib/contracts/draft";
import { DRAFT_BLOCK_KINDS, type CountBasis, type DraftBlockKind } from "@/lib/contracts/enums";
import type { EvidenceChip } from "@/lib/contracts/evidence";
import { PARAGRAPH_SEPARATOR, countChars } from "@/server/ai/validation/drafts";

/**
 * draft_sections.ai_content / edited_content block (db notes "Block"). Unknown
 * keys are kept as stored (the DB keeps them too).
 */
export type StoredBlock = {
  block_id: string;
  block_kind: DraftBlockKind;
  text: string;
  project_id?: string | null;
  requirement_ids?: string[];
  placeholders?: Array<{ token: string; hint?: string | null }>;
  flags?: string[];
  generated_by?: string | null;
  user_modified?: boolean;
  header?: unknown;
  [key: string]: unknown;
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

/** Lenient parse: drops malformed entries instead of failing the whole read. */
export function parseBlocks(value: unknown): StoredBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const b = raw as Record<string, unknown>;
    if (typeof b.block_id !== "string" || typeof b.text !== "string") return [];
    if (!(DRAFT_BLOCK_KINDS as readonly unknown[]).includes(b.block_kind)) return [];
    return [b as StoredBlock];
  });
}

/**
 * QA-S7-05: only the placeholder tokens still present in the block text (the user may have typed the real
 * value over `[수치 입력 필요]`). One entry per stored placeholder whose token occurs in `text`.
 */
export function presentPlaceholders(placeholders: unknown, text: string): Array<{ token: string; hint: string | null }> {
  return (Array.isArray(placeholders) ? placeholders : []).flatMap((p) =>
    p && typeof p === "object" && typeof (p as { token?: unknown }).token === "string" && text.includes((p as { token: string }).token)
      ? [{ token: (p as { token: string }).token, hint: typeof (p as { hint?: unknown }).hint === "string" ? (p as { hint: string }).hint : null }]
      : [],
  );
}

function placeholdersOf(b: StoredBlock): DraftBlockView["placeholders"] {
  return presentPlaceholders(b.placeholders, b.text);
}

/**
 * Editor blocks: the edited list (when saved, `[]` included) decides order and
 * text; the AI original rides along. Without an edit (null), the AI blocks.
 */
export function toBlockViews(ai: StoredBlock[], edited: StoredBlock[] | null, chips: Map<string, EvidenceChip[]> | undefined): DraftBlockView[] {
  const aiById = new Map(ai.map((b) => [b.block_id, b]));
  // QA-S7-06: a saved edit (even an empty one — every block deleted) wins over the AI text; only null = 없음.
  const shown = edited ?? ai;
  return shown.map((b) => {
    const original = aiById.get(b.block_id) ?? null;
    const base = original ?? b;
    return {
      blockId: b.block_id,
      blockKind: b.block_kind,
      projectId: typeof base.project_id === "string" ? base.project_id : null,
      text: b.text,
      aiText: original ? original.text : null,
      userModified: original ? b.text !== original.text : b.user_modified === true,
      requirementIds: strings(base.requirement_ids),
      placeholders: placeholdersOf(b),
      flags: strings(base.flags),
      generatedBy: typeof base.generated_by === "string" ? base.generated_by : null,
      evidence: chips?.get(b.block_id) ?? [],
    };
  });
}

/** Shown cover letter text by count_basis — same counter and paragraph join as AI-04 (`ai_char_count`). */
export function countShownChars(texts: readonly string[], basis: CountBasis): number {
  return countChars(texts.join(PARAGRAPH_SEPARATOR), basis);
}
