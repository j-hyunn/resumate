import {
  EVIDENCE_KIND_LABELS,
  EVIDENCE_SOURCE_TYPES,
  PROJECT_DETAIL_FIELD_LABELS,
  type EvidenceChip,
  type EvidenceOwnerType,
  type EvidenceSourceState,
  type EvidenceSourceType,
  type EvidenceTarget,
} from "@/lib/contracts/evidence";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/**
 * Shared C-01 evidence chip read (S6; reused by S7 drafts and S8 interviews).
 *
 * Reads `evidence_links` of the given owners through the user session (RLS =
 * ownership), then looks up each source's current `updated_at` to decide the
 * chip state (C-01):
 * - `deleted`: `source_deleted_at` is set (D-AI-04 (b) trigger), or the source
 *   row is gone (defensive: a source type without a deletion trigger yet).
 * - `changed`: source `updated_at` > `source_snapshot_at` (DM §2.8; for
 *   `project_detail` the row's updated_at, so any STAR edit counts [가정]).
 * - `current`: otherwise. `jd_sentence` is always current (C-01).
 *
 * C-7: nothing here is logged.
 */

export type EvidenceLinkRow = {
  id: string;
  owner_type: string;
  owner_id: string;
  item_key: string;
  sort_order: number;
  source_type: string;
  source_id: string;
  source_field: string | null;
  source_locator: Json | null;
  source_label: string | null;
  quote: string | null;
  quote_adjusted: boolean;
  source_snapshot_at: string | null;
  source_deleted_at: string | null;
};

const LINK_COLUMNS =
  "id, owner_type, owner_id, item_key, sort_order, source_type, source_id, source_field, source_locator, source_label, quote, quote_adjusted, source_snapshot_at, source_deleted_at";

/** Source tables whose `updated_at` decides "변경됨". */
const SOURCE_TABLES = {
  profile: "profiles",
  experience: "experiences",
  education: "educations",
  project: "projects",
  project_detail: "project_details",
  achievement: "achievements",
  skill: "skills",
  jd_requirement: "jd_requirements",
} as const satisfies Partial<Record<EvidenceSourceType, string>>;
type TrackedSourceType = keyof typeof SOURCE_TABLES;

/** Current state of one source row (what the chip needs besides the link). */
export type SourceInfo = {
  updatedAt: string;
  /** Navigation parents (C-02 "원본으로 이동"). */
  projectId?: string | null;
  projectDetailId?: string | null;
  experienceId?: string | null;
};

/** `${source_type}:${source_id}` → current source info (absent = row not found). */
export type SourceLookup = Map<string, SourceInfo>;

const key = (type: string, id: string) => `${type}:${id}`;

function isSourceType(value: string): value is EvidenceSourceType {
  return (EVIDENCE_SOURCE_TYPES as readonly string[]).includes(value);
}

function isTracked(type: EvidenceSourceType): type is TrackedSourceType {
  return type in SOURCE_TABLES;
}

/** C-01 label: kind, plus the STAR field for project details ("상세 내용 · 행동"); learnings → "회고 및 배운 점". */
export function evidenceKindLabel(sourceType: EvidenceSourceType, field: string | null): string {
  if (sourceType === "project_detail") {
    if (field === "learnings") return PROJECT_DETAIL_FIELD_LABELS.learnings!;
    const fieldLabel = field ? PROJECT_DETAIL_FIELD_LABELS[field] : undefined;
    return fieldLabel ? `${EVIDENCE_KIND_LABELS.project_detail} · ${fieldLabel}` : EVIDENCE_KIND_LABELS.project_detail;
  }
  return EVIDENCE_KIND_LABELS[sourceType];
}

function locatorOf(value: Json | null): { sid: string | null; start: number | null; end: number | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { sid: null, start: null, end: null };
  const v = value as Record<string, unknown>;
  return {
    sid: typeof v.sid === "string" ? v.sid : null,
    start: typeof v.start === "number" ? v.start : null,
    end: typeof v.end === "number" ? v.end : null,
  };
}

/** Pure: link row + source lookup → chip. Exported for unit tests. */
export function toEvidenceChip(row: EvidenceLinkRow, sources: SourceLookup): EvidenceChip | null {
  if (!isSourceType(row.source_type)) return null;
  const type = row.source_type;
  const info = isTracked(type) ? sources.get(key(type, row.source_id)) : undefined;

  let state: EvidenceSourceState;
  if (row.source_deleted_at) state = "deleted";
  else if (type === "jd_sentence") state = "current";
  else if (isTracked(type) && !info) state = "deleted";
  else if (info && row.source_snapshot_at && Date.parse(info.updatedAt) > Date.parse(row.source_snapshot_at)) state = "changed";
  else state = "current";

  return {
    id: row.id,
    itemKey: row.item_key,
    sortOrder: row.sort_order,
    sourceType: type,
    sourceId: row.source_id,
    sourceField: row.source_field,
    kindLabel: evidenceKindLabel(type, row.source_field),
    sourceLabel: row.source_label,
    quote: state === "deleted" ? null : row.quote,
    quoteAdjusted: row.quote_adjusted,
    isReflection: type === "project_detail" && row.source_field === "learnings",
    state,
    sourceSnapshotAt: row.source_snapshot_at,
    sourceDeletedAt: row.source_deleted_at,
    target: state === "deleted" ? null : targetOf(row, type, info),
  };
}

function targetOf(row: EvidenceLinkRow, type: EvidenceSourceType, info: SourceInfo | undefined): EvidenceTarget {
  switch (type) {
    case "profile":
      return { type: "profile" };
    case "experience":
      return { type: "experience", experienceId: row.source_id };
    case "education":
      return { type: "education", educationId: row.source_id };
    case "project":
      return { type: "project", projectId: row.source_id };
    case "project_detail":
      return info?.projectId
        ? { type: "project_detail", projectId: info.projectId, projectDetailId: row.source_id, field: row.source_field }
        : { type: "other", sourceId: row.source_id };
    case "achievement":
      return {
        type: "achievement",
        achievementId: row.source_id,
        projectDetailId: info?.projectDetailId ?? null,
        projectId: info?.projectId ?? null,
        experienceId: info?.experienceId ?? null,
      };
    case "skill":
      return { type: "skill", skillId: row.source_id };
    case "jd_requirement":
      return { type: "jd_requirement", requirementId: row.source_id };
    case "jd_sentence":
      return { type: "jd_sentence", jobDescriptionId: row.source_id, ...locatorOf(row.source_locator) };
    default:
      return { type: "other", sourceId: row.source_id };
  }
}

async function selectIn<T>(supabase: UserSupabaseClient, table: string, columns: string, ids: readonly string[]): Promise<T[]> {
  if (ids.length === 0) return [];
  // Table names come from SOURCE_TABLES (fixed), never from input.
  const { data, error } = await (supabase.from(table as "projects").select(columns) as unknown as {
    in: (column: string, values: readonly string[]) => Promise<{ data: unknown; error: Parameters<typeof mapDbError>[0] | null }>;
  }).in("id", ids);
  if (error) throw mapDbError(error);
  return (data ?? []) as T[];
}

/** Current `updated_at` (+ navigation parents) of every tracked source the links point to. */
export async function loadSourceLookup(supabase: UserSupabaseClient, rows: readonly EvidenceLinkRow[]): Promise<SourceLookup> {
  const idsByType = new Map<TrackedSourceType, Set<string>>();
  for (const r of rows) {
    if (!isSourceType(r.source_type) || !isTracked(r.source_type) || r.source_deleted_at) continue;
    const set = idsByType.get(r.source_type) ?? new Set<string>();
    set.add(r.source_id);
    idsByType.set(r.source_type, set);
  }
  const lookup: SourceLookup = new Map();
  await Promise.all(
    [...idsByType].map(async ([type, set]) => {
      const ids = [...set];
      if (type === "project_detail") {
        const found = await selectIn<{ id: string; updated_at: string; project_id: string }>(supabase, SOURCE_TABLES[type], "id, updated_at, project_id", ids);
        for (const r of found) lookup.set(key(type, r.id), { updatedAt: r.updated_at, projectId: r.project_id });
        return;
      }
      if (type === "achievement") {
        const found = await selectIn<{ id: string; updated_at: string; project_detail_id: string | null; experience_id: string | null }>(
          supabase,
          SOURCE_TABLES[type],
          "id, updated_at, project_detail_id, experience_id",
          ids,
        );
        const detailIds = [...new Set(found.flatMap((r) => (r.project_detail_id ? [r.project_detail_id] : [])))];
        const details = await selectIn<{ id: string; project_id: string }>(supabase, "project_details", "id, project_id", detailIds);
        const projectOf = new Map(details.map((d) => [d.id, d.project_id]));
        for (const r of found) {
          lookup.set(key(type, r.id), {
            updatedAt: r.updated_at,
            projectDetailId: r.project_detail_id,
            projectId: r.project_detail_id ? (projectOf.get(r.project_detail_id) ?? null) : null,
            experienceId: r.experience_id,
          });
        }
        return;
      }
      const found = await selectIn<{ id: string; updated_at: string }>(supabase, SOURCE_TABLES[type], "id, updated_at", ids);
      for (const r of found) lookup.set(key(type, r.id), { updatedAt: r.updated_at });
    }),
  );
  return lookup;
}

/**
 * Evidence chips of the given owners, grouped by `owner_id` → `item_key`,
 * each list in `sort_order`. Owners the user can't read yield nothing (RLS).
 */
export async function loadEvidenceChips(
  supabase: UserSupabaseClient,
  owner: { ownerType: EvidenceOwnerType; ownerIds: readonly string[] },
): Promise<Map<string, Map<string, EvidenceChip[]>>> {
  const out = new Map<string, Map<string, EvidenceChip[]>>();
  if (owner.ownerIds.length === 0) return out;
  const { data, error } = await supabase
    .from("evidence_links")
    .select(LINK_COLUMNS)
    .eq("owner_type", owner.ownerType)
    .in("owner_id", [...owner.ownerIds])
    .order("item_key", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw mapDbError(error);
  const rows = (data ?? []) as EvidenceLinkRow[];
  const sources = await loadSourceLookup(supabase, rows);
  for (const row of rows) {
    const chip = toEvidenceChip(row, sources);
    if (!chip) continue;
    const byItem = out.get(row.owner_id) ?? new Map<string, EvidenceChip[]>();
    const list = byItem.get(row.item_key) ?? [];
    list.push(chip);
    byItem.set(row.item_key, list);
    out.set(row.owner_id, byItem);
  }
  return out;
}
