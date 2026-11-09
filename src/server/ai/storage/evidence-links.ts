import type { Database, Json } from "@/server/db/database.types";
import type { AliasMap } from "../context-pack/aliases";
import type { ValidatedEvidence } from "../validation/evidence";

/**
 * C-3 근거 저장: validated evidence → `evidence_links` rows. Result jsonb keeps
 * only `item_key`s; evidence lives in this table only.
 *
 * - `user_id` is omitted: the column defaults to private.current_uid() (the
 *   app_ai_writer JWT `sub`), so a row can't be written for another user.
 * - `ref` → `source_id` (UUID), `field` → `source_field` (null for JD
 *   sentence/requirement, note — the DB CHECK enforces C-3 per type).
 * - `source_snapshot_at` = the alias entry's snapshot (DM §2.8 v4.4: projects use
 *   `content_updated_at`, everything else the row `updated_at`), falling back to
 *   `now` when the source has none (sources without a row timestamp, e.g. JD sentences when the JD updated_at is not passed).
 * - `source_locator`: a per-quote locator when the entry has one (v4.5
 *   deliverable body → raw markdown `{start, end}`, C-1.1), else the entry's.
 * - `writing_chat_message` never goes here (DM-15) → throws.
 */

export type EvidenceLinkInsert = Database["public"]["Tables"]["evidence_links"]["Insert"];

/**
 * Owners this **AI-side** row builder may target — not the DB's full `evidence_links_owner_type_check`
 * list (that one is `src/lib/contracts/enums.ts`).
 *
 * - (R14, AI spec v4.14 RM-1) interview_question / answer_evaluation / session_feedback removed.
 * - (R15, UQ-752) `draft_section` removed — the table is dropped (CF-M1, `20261113004700`).
 * - `application_document` is **deliberately absent**: 서류 evidence is written by the user-session save
 *   RPC `save_application_document` from the applied proposal (CF-S1), never by an AI path. Adding it here
 *   would open a second, unvalidated write route.
 */
export const EVIDENCE_OWNER_TYPES = ["insight", "chat_message"] as const;
export type EvidenceOwnerType = (typeof EVIDENCE_OWNER_TYPES)[number];

export type EvidenceOwner = {
  ownerType: EvidenceOwnerType;
  ownerId: string;
  applicationProjectId: string;
};

export function toEvidenceLinkRows(input: {
  owner: EvidenceOwner;
  items: ReadonlyArray<{ itemKey: string; evidence: readonly ValidatedEvidence[] }>;
  aliases: AliasMap;
  now: Date;
}): EvidenceLinkInsert[] {
  const rows: EvidenceLinkInsert[] = [];
  for (const item of input.items) {
    item.evidence.forEach((e, index) => {
      if (e.source_type === "writing_chat_message") {
        throw new Error("toEvidenceLinkRows: writing_chat_message evidence is stored in writing_chats.structured_draft (DM-15)");
      }
      const entry = input.aliases.get(e.ref);
      // Validation ran against the same map; a miss here is a programming error, not model output.
      if (!entry || entry.sourceType !== e.source_type) throw new Error("toEvidenceLinkRows: evidence not in alias map");
      rows.push({
        owner_type: input.owner.ownerType,
        owner_id: input.owner.ownerId,
        application_project_id: input.owner.applicationProjectId,
        item_key: item.itemKey,
        sort_order: index,
        source_type: e.source_type,
        source_id: entry.id,
        source_field: e.field,
        quote: e.quote,
        quote_adjusted: e.quote_adjusted,
        source_snapshot_at: entry.snapshotAt ?? input.now.toISOString(),
        source_label: entry.label,
        source_locator: ((entry.locate && e.quote ? entry.locate(e.field ?? "", e.quote) : null) ?? entry.locator ?? null) as Json | null,
      });
    });
  }
  return rows;
}

/**
 * Removes model-only keys (`evidence` arrays and feature-specific ones such as
 * `positioning_evidence`) from a result before it is stored (C-3: result jsonb
 * never holds evidence). Returns a new value.
 */
export function stripEvidence<T>(value: T, keys: readonly string[] = ["evidence"]): T {
  const drop = new Set(keys);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) if (!drop.has(k)) out[k] = walk(v);
    return out;
  };
  return walk(value) as T;
}

/**
 * Alias references in results (`requirement_ref`, `requirement_refs`,
 * `project_priorities[].ref`) → UUIDs (C-3). Unknown aliases are dropped and
 * counted; callers decide whether that invalidates the item.
 */
export function resolveRefs(
  aliases: AliasMap,
  refs: readonly string[],
  expectedType: Parameters<AliasMap["resolveId"]>[1],
): { ids: string[]; unknown: number } {
  const ids: string[] = [];
  let unknown = 0;
  for (const ref of refs) {
    const id = aliases.resolveId(ref, expectedType);
    if (id === null) unknown++;
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, unknown };
}
