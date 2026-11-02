import type { DraftSourceRole, QuestionClass } from "@/lib/contracts/enums";
import type { AliasMap } from "../context-pack/aliases";
import type { ConnectionTier, ModelTier, NormalizedUsage, ProviderId } from "../providers/types";
import type { DraftBlock } from "../validation/draft-blocks";
import type { ValidatedEvidence } from "../validation/evidence";
import { toEvidenceLinkRows, type EvidenceLinkInsert } from "./evidence-links";

/**
 * S7 → `complete_career_description(p_payload)` / `complete_cover_letter_section(p_payload)`
 * (db-engineer S7 notes "Payload 모양"). C-3: blocks carry no evidence;
 * evidence rows use `item_key = block_id` (or `sources.{n}` for AI-04
 * selection reasons), aliases → UUIDs. Owner keys are filled by the RPC.
 */

/** DB limits (db notes). */
const LABEL_MAX = 300;
const QUOTE_MAX = 2000;
export const RATIONALE_MAX = 300;

export type PayloadMeta = {
  schema_version: number;
  prompt_version: string;
  provider: ProviderId;
  model: string;
  model_tier: ModelTier;
  connection_tier: ConnectionTier;
  validation_report: Record<string, number> | null;
  usage: NormalizedUsage | null;
};

export type PayloadHashes = { input_hash: string; career_snapshot_hash: string };

/** evidence_links insert keys minus the owner keys the RPC fills. */
export type PayloadEvidence = Omit<EvidenceLinkInsert, "owner_type" | "owner_id" | "application_project_id" | "user_id">;

export type CompleteCareerDescriptionPayload = {
  sections: Array<{ section_id: string; blocks: DraftBlock[]; validation_report: Record<string, number> | null }>;
  hashes: PayloadHashes;
  meta: PayloadMeta;
  evidence: Array<PayloadEvidence & { section_id: string }>;
  /** Not in db notes' list: model omissions + notes for the user (AI-03 출력). Stored if the RPC keeps them (spec-gaps S7 ai). */
  omitted: Array<{ project_id: string; reason: "user_excluded" | "low_relevance" }>;
  notes_for_user: string[];
};

export type CoverLetterPayloadSource = {
  project_id: string | null;
  experience_id: string | null;
  education_id: string | null;
  project_detail_ids: string[];
  role: DraftSourceRole;
  rationale: string | null;
  requirement_ids: string[];
  reuse_reason: string | null;
  source_label: string | null;
};

export type CompleteCoverLetterSectionPayload = {
  question_class: QuestionClass;
  blocks: DraftBlock[];
  ai_char_count: number;
  correction_applied: boolean;
  sources: CoverLetterPayloadSource[];
  hashes: PayloadHashes;
  meta: PayloadMeta;
  evidence: PayloadEvidence[];
  /** Not in db notes' list (spec-gaps S7 ai): still out of ±10% after correction (or correction failed). */
  char_adjust_needed: boolean;
  notes_for_user: string[];
};

/** Owner placeholder: the complete_* RPC overwrites owner keys. */
const PLACEHOLDER_OWNER = {
  ownerType: "draft_section",
  ownerId: "00000000-0000-0000-0000-000000000000",
  applicationProjectId: "00000000-0000-0000-0000-000000000000",
} as const;

/** Validated evidence → payload evidence rows (aliases → UUIDs, DB length limits). */
export function toPayloadEvidence(
  items: ReadonlyArray<{ itemKey: string; evidence: readonly ValidatedEvidence[] }>,
  aliases: AliasMap,
  now: Date,
): PayloadEvidence[] {
  return toEvidenceLinkRows({ owner: PLACEHOLDER_OWNER, items, aliases, now }).map((row) => {
    const { owner_type: _t, owner_id: _i, application_project_id: _a, user_id: _u, ...rest } = row;
    void _t;
    void _i;
    void _a;
    void _u;
    return {
      ...rest,
      quote: rest.quote && rest.quote.length > QUOTE_MAX ? rest.quote.slice(0, QUOTE_MAX) : rest.quote,
      source_label: rest.source_label && rest.source_label.length > LABEL_MAX ? `${rest.source_label.slice(0, LABEL_MAX - 1)}…` : rest.source_label,
    };
  });
}

export function clipText(text: string | null, max: number): string | null {
  if (text === null) return null;
  const t = text.trim();
  if (t === "") return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** AI-04 selection-reason evidence key (C-3: `item_key = sources.{n}`). */
export function sourceItemKey(n: number): string {
  return `sources.${n}`;
}
