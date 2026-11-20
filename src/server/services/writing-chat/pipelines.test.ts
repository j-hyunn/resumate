import { describe, expect, it } from "vitest";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import { fakeSupabase } from "@/test/fake-supabase";
import { loadGateGaps } from "./pipelines";

/**
 * AI-12 게이트 진입 (DM v4.16 2.7.0, 4.24 #14 / #19): the gate gaps come from the insight the chat was
 * opened from (`return_target.params.insight_id` / `insight_item_key`), else the project's latest
 * ready schema-2 insight — never the JD.
 */

const AP = "00000000-0000-4000-8000-0000000000a1";
const INS_OLD = "00000000-0000-4000-8000-0000000000b1";
const INS_LATEST = "00000000-0000-4000-8000-0000000000b2";

const result = (label: string) => ({
  schema_version: 2,
  requirement_matches: [
    { match_key: "MT-1", requirement_text: `${label} 요건 1`, status: "partial", missing_aspect: null },
    { match_key: "MT-2", requirement_text: `${label} 요건 2`, status: "no_evidence", missing_aspect: null },
  ],
  strengths: [],
  gaps: [
    { item_key: "gaps.0", match_keys: ["MT-1"], gap_kind: "partial", description: `${label} 보완 0` },
    { item_key: "gaps.1", match_keys: ["MT-2"], gap_kind: "no_evidence", description: `${label} 보완 1` },
  ],
  strategy: { positioning: null, project_priorities: [] },
});

function db(rows: Array<Record<string, unknown>>) {
  return fakeSupabase({ insights: rows, job_descriptions: [{ application_project_id: AP, sentences: "never read" }] }).client as AiWriterSupabaseClient;
}

const base = { application_project_id: AP, status: "ready", career_snapshot_hash: "c", raw_text_hash: "r" };
const OLD = { ...base, id: INS_OLD, is_latest: false, schema_version: 2, result: result("이전") };
const LATEST = { ...base, id: INS_LATEST, is_latest: true, schema_version: 2, result: result("최신") };
const target = (params: Record<string, unknown>) => ({ application_project_id: AP, feature: "insight" as const, params, created_at: "2026-11-16T00:00:00Z" });

describe("loadGateGaps", () => {
  it("insight_id + insight_item_key → that insight's one gap", async () => {
    const gaps = await loadGateGaps(db([OLD, LATEST]), target({ insight_id: INS_OLD, insight_item_key: "gaps.1" }));
    expect(gaps).toEqual([{ requirementTexts: ["이전 요건 2"], gapKind: "no_evidence", description: "이전 보완 1" }]);
  });

  it("insight_id only → every gap of that insight", async () => {
    const gaps = await loadGateGaps(db([OLD, LATEST]), target({ insight_id: INS_OLD }));
    expect(gaps.map((g) => g.description)).toEqual(["이전 보완 0", "이전 보완 1"]);
  });

  it("no keys → the latest ready schema-2 insight's gaps", async () => {
    const gaps = await loadGateGaps(db([OLD, LATEST]), target({}));
    expect(gaps.map((g) => g.description)).toEqual(["최신 보완 0", "최신 보완 1"]);
  });

  it("an insight_id that is gone falls back to the latest one [가정 R17b-api-3]", async () => {
    const gaps = await loadGateGaps(db([LATEST]), target({ insight_id: INS_OLD, insight_item_key: "gaps.0" }));
    expect(gaps).toEqual([{ requirementTexts: ["최신 요건 1"], gapKind: "partial", description: "최신 보완 0" }]);
  });

  it("only a schema-1 insight (or none) → no gate gaps", async () => {
    await expect(loadGateGaps(db([{ ...LATEST, schema_version: 1 }]), target({}))).resolves.toEqual([]);
    await expect(loadGateGaps(db([]), target({}))).resolves.toEqual([]);
  });
});
