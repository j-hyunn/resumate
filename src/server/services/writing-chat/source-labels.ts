import { EVIDENCE_KIND_LABELS, type EvidenceSourceType } from "@/lib/contracts/evidence";
import type { CoverLetterDraft } from "@/lib/contracts/writing-chat";
import { joinSourceLabel } from "@/server/ai/context-pack/selection";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { educationDisplayName } from "@/server/services/career/education-name";

/**
 * R15 후속 4 (리더 판정): display labels for a reopened 서류 대화's question sources.
 *
 * `structured_draft.document.questions[].draft.sources[]` stores `{source_type, source_id, role}`
 * only (CF-S1 — no label, no rationale). The live turn shows labels through the SSE
 * `sources_selected` card, which is not stored, so after a reload the list was empty. The labels
 * can't come from `evidence_links` either: those rows exist only once a proposal has been
 * [반영]-ed and saved, and an unapplied proposal has none.
 *
 * So the server labels them here, from the rows, with **the same rule as the SSE card**
 * (`joinSourceLabel`: experience `company_name` / education display name (ED-3) › project `name`).
 * The labels go in a separate DTO field — `structuredDraft` stays the stored shape, untouched.
 *
 * - User session, RLS: another user's rows are invisible, which reads exactly like "deleted".
 * - One query per source table (at most four), never one per source.
 * - A source whose row is gone (deleted since the draft) → `label: null`, `deleted: true`, the
 *   same rule as the evidence chip's 원본 삭제됨; never an error.
 * - No rationale: CF-S1 keeps `role`/`rationale` out of storage — labels only.
 */

export type DocumentSourceLabel = {
  sourceType: string;
  sourceId: string;
  /** "부모 › 프로젝트" (= the SSE card's `label`); null when the source row is gone. */
  label: string | null;
  /** The source row no longer exists (or isn't the user's): show 원본 삭제됨. */
  deleted: boolean;
};

type ProjectRow = { id: string; name: string | null; experience_id: string | null; education_id: string | null };
type ExperienceRow = { id: string; company_name: string | null };
type EducationRow = { id: string; program_name: string | null; institution_name: string | null };

async function selectByIds<T>(supabase: UserSupabaseClient, table: "projects" | "experiences" | "educations", columns: string, ids: ReadonlySet<string>): Promise<Map<string, T>> {
  if (ids.size === 0) return new Map();
  const { data, error } = await supabase.from(table).select(columns).in("id", [...ids]);
  if (error) throw mapDbError(error);
  return new Map(((data ?? []) as unknown as Array<T & { id: string }>).map((r) => [r.id, r]));
}

/**
 * Labels for every slot's `draft.sources[]`, keyed by slot, each list in the **same order** as
 * `draft.sources` (so the screen pairs them by index with the stored `role`). Every proposal slot
 * gets an entry; a slot whose proposal chose no source has `[]`.
 */
export async function loadDocumentSourceLabels(supabase: UserSupabaseClient, draft: CoverLetterDraft): Promise<Record<string, DocumentSourceLabel[]>> {
  const projectIds = new Set<string>();
  const experienceIds = new Set<string>();
  const educationIds = new Set<string>();
  for (const q of draft.document.questions) {
    for (const s of q.draft.sources ?? []) {
      if (s.source_type === "project") projectIds.add(s.source_id);
      else if (s.source_type === "experience") experienceIds.add(s.source_id);
      else if (s.source_type === "education") educationIds.add(s.source_id);
    }
  }

  // Projects first: their parents join the experience / education lookups (still one query each).
  const projects = await selectByIds<ProjectRow>(supabase, "projects", "id, name, experience_id, education_id", projectIds);
  for (const p of projects.values()) {
    if (p.experience_id) experienceIds.add(p.experience_id);
    if (p.education_id) educationIds.add(p.education_id);
  }
  const [experiences, educations] = await Promise.all([
    selectByIds<ExperienceRow>(supabase, "experiences", "id, company_name", experienceIds),
    selectByIds<EducationRow>(supabase, "educations", "id, program_name, institution_name", educationIds),
  ]);

  const experienceLabel = (id: string | null) => (id ? (experiences.get(id)?.company_name ?? null) : null);
  const educationLabel = (id: string | null) => {
    const e = id ? educations.get(id) : undefined;
    return e ? educationDisplayName(e.program_name, e.institution_name) : null;
  };

  const labelOf = (sourceType: string, sourceId: string): DocumentSourceLabel => {
    const gone = { sourceType, sourceId, label: null, deleted: true };
    if (sourceType === "project") {
      const p = projects.get(sourceId);
      if (!p) return gone;
      const parent = p.experience_id ? experienceLabel(p.experience_id) : educationLabel(p.education_id);
      return { sourceType, sourceId, label: joinSourceLabel(parent, p.name) || null, deleted: false };
    }
    if (sourceType === "experience") {
      if (!experiences.has(sourceId)) return gone;
      return { sourceType, sourceId, label: joinSourceLabel(experienceLabel(sourceId), null) || null, deleted: false };
    }
    if (sourceType === "education") {
      if (!educations.has(sourceId)) return gone;
      return { sourceType, sourceId, label: joinSourceLabel(educationLabel(sourceId), null) || null, deleted: false };
    }
    // `toStoredSources` only stores project / experience / education today; any other storable type
    // (`user_note`, `jd_requirement`, …) gets the evidence chip's kind label — `user_note` = "내 메모".
    // Untracked types are "current" unless deleted, as on the chip. `[가정]`
    const kind = (EVIDENCE_KIND_LABELS as Record<string, string | undefined>)[sourceType as EvidenceSourceType];
    return { sourceType, sourceId, label: kind ?? null, deleted: false };
  };

  const out: Record<string, DocumentSourceLabel[]> = {};
  for (const q of draft.document.questions) out[q.slot] = (q.draft.sources ?? []).map((s) => labelOf(s.source_type, s.source_id));
  return out;
}
