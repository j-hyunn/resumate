import type { EvidenceSourceType } from "../evidence-rules";

/**
 * One alias the model may cite (C-1 "짧은 별칭", C-2 문장 ID). Built per call;
 * validators (V-1..V-3, V-7) and storage (alias → UUID) read it.
 */
export type AliasEntry = {
  alias: string;
  sourceType: EvidenceSourceType;
  /** UUID of the source row; for JD sentences the job_descriptions row id. */
  id: string;
  /**
   * Text of each citable field as the model saw it (V-3 compares quotes to
   * these). Field-less sources use WHOLE_SOURCE_FIELD ("") as the key.
   */
  fields: Readonly<Record<string, string | null>>;
  /** Source row `updated_at` → evidence_links.source_snapshot_at. */
  snapshotAt: string | null;
  /** Short label kept after the source is deleted → evidence_links.source_label. */
  label: string | null;
  /** evidence_links.source_locator (e.g. JD sentence offsets). */
  locator?: Record<string, unknown> | null;
  /** Aliases of ancestors (PRJ → its EXP/EDU; DET → its PRJ; ACH → its DET or EXP). V-7 scope. */
  parents: readonly string[];
};

export class AliasMap {
  private readonly entries = new Map<string, AliasEntry>();

  add(entry: AliasEntry): void {
    if (this.entries.has(entry.alias)) throw new Error(`AliasMap: duplicate alias ${entry.alias}`);
    this.entries.set(entry.alias, entry);
  }

  get(alias: string): AliasEntry | undefined {
    return this.entries.get(alias);
  }

  has(alias: string): boolean {
    return this.entries.has(alias);
  }

  values(): IterableIterator<AliasEntry> {
    return this.entries.values();
  }

  get size(): number {
    return this.entries.size;
  }

  /** Alias for a UUID of a given type (reverse lookup for selections). */
  aliasOf(sourceType: EvidenceSourceType, id: string): string | undefined {
    for (const entry of this.entries.values()) {
      if (entry.sourceType === sourceType && entry.id === id) return entry.alias;
    }
    return undefined;
  }

  /** Combines maps built for one call (career pack + JD context + answers …). */
  static merge(...maps: AliasMap[]): AliasMap {
    const merged = new AliasMap();
    for (const map of maps) for (const entry of map.values()) merged.add(entry);
    return merged;
  }

  /** Resolves an alias to its UUID, or null when unknown (callers drop the reference). */
  resolveId(alias: string, expectedType?: EvidenceSourceType): string | null {
    const entry = this.entries.get(alias);
    if (!entry) return null;
    if (expectedType && entry.sourceType !== expectedType) return null;
    return entry.id;
  }
}
