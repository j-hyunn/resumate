import { describe, expect, it } from "vitest";
import { toCanonicalJsonSchema } from "../providers/schema";
import { Ai12ExtractOutputSchema, ai12ExtractJsonSchema } from "./AI-12";
import {
  emptyDraftChanges,
  isEmptyDraftPatch,
  parseStructuredDraft,
  toDraftPatch,
  type DraftChanges,
} from "./structured-draft";

describe("parseStructuredDraft", () => {
  it("fills the skeleton from the column default '{}'", () => {
    expect(parseStructuredDraft({})).toEqual({
      schema_version: 1,
      project: {},
      affiliation_suggestion: null,
      details: [],
      skills: [],
      clarifications: [],
      sensitive_flags_count: 0,
    });
  });

  it("reads the RPC's stored shape (achievement_key, existing_detail_id)", () => {
    const draft = parseStructuredDraft({
      schema_version: 1,
      project: { name: { value: "x", origin: "ai", source_message_ids: ["u"], source_quotes: ["q"], review: "ok", reviewed_at: null } },
      details: [
        {
          detail_key: "D1",
          existing_detail_id: null,
          fields: {},
          achievements: [{ achievement_key: "A1", value_after: { value: 3, origin: "user_edit", source_message_ids: [], source_quotes: [], review: "ok", reviewed_at: null } }],
        },
        { detail_key: null, existing_detail_id: "e", fields: { result: { value: "r", origin: "ai", source_message_ids: ["u"], source_quotes: ["q"], review: "needs_review", reviewed_at: null } }, achievements: [] },
      ],
      clarifications: [{ kind: "actor_ambiguous", field: "action", detail_key: "D1", existing_detail_id: null }],
    });
    expect(draft.details[0].achievements[0].achievement_key).toBe("A1");
    expect(draft.details[1].fields.result?.review).toBe("needs_review");
  });

  it("throws on a malformed draft instead of resetting it", () => {
    expect(() => parseStructuredDraft({ details: "nope" })).toThrow();
  });
});

describe("toDraftPatch (RPC op list)", () => {
  const src = { source_message_ids: ["u1"], source_quotes: ["q"] };

  it("orders new_detail first and maps each change to its op", () => {
    const changes: DraftChanges = {
      ...emptyDraftChanges(),
      fields: [
        { target: "detail", detail_key: "D1", existing_detail_id: null, field: "action", value: "a", review: "ok", ...src },
        { target: "detail", detail_key: null, existing_detail_id: "e1", field: "result", value: "r", review: "needs_review", ...src },
        { target: "project", detail_key: null, existing_detail_id: null, field: "team_size", value: 4, review: "ok", ...src },
      ],
      new_details: [{ detail_key: "D1" }],
      achievements: [{ detail_key: "D1", existing_detail_id: null, fields: { value_after: { value: 3, review: "ok", ...src } } }],
      skills: [{ value: "Kafka", ...src }],
      affiliation_suggestion: { type: "experience", id: "x", source_message_ids: ["u1"] },
      clarifications: [],
      sensitive_flags_add: 2,
    };
    expect(toDraftPatch(changes).ops).toEqual([
      { op: "add_sensitive_flags", count: 2 },
      { op: "new_detail", detail_key: "D1" },
      { op: "set", target: { section: "detail", detail_key: "D1", field: "action" }, value: "a", review: "ok", ...src },
      { op: "set", target: { section: "detail", existing_detail_id: "e1", field: "result" }, value: "r", review: "needs_review", ...src },
      { op: "set", target: { section: "project", field: "team_size" }, value: 4, review: "ok", ...src },
      { op: "add_achievement", detail: { detail_key: "D1" }, fields: { value_after: { value: 3, review: "ok", ...src } } },
      { op: "add_skill", value: "Kafka", ...src },
      { op: "set_affiliation_suggestion", type: "experience", id: "x", source_message_ids: ["u1"] },
      { op: "set_clarifications", items: [] },
    ]);
  });

  it("empty changes → no ops; clamps to the RPC limits", () => {
    expect(isEmptyDraftPatch(toDraftPatch(emptyDraftChanges()))).toBe(true);
    const many = Array.from({ length: 30 }, (_, i) => `q${i}`);
    const patch = toDraftPatch({
      ...emptyDraftChanges(),
      skills: [{ value: "Go", source_message_ids: many, source_quotes: many }],
      sensitive_flags_add: 500,
    });
    expect(patch.ops[0]).toEqual({ op: "add_sensitive_flags", count: 100 });
    expect(patch.ops[1]).toMatchObject({ source_message_ids: many.slice(0, 20), source_quotes: many.slice(0, 20) });
  });

  it("QA-S4-07: the sensitive count survives the 100-op cap", () => {
    const src = { source_message_ids: ["u1"], source_quotes: ["q"] };
    const patch = toDraftPatch({
      ...emptyDraftChanges(),
      skills: Array.from({ length: 150 }, (_, i) => ({ value: `S${i}`, ...src })),
      clarifications: [],
      sensitive_flags_add: 3,
    });
    expect(patch.ops).toHaveLength(100);
    expect(patch.ops.filter((o) => o.op === "add_sensitive_flags")).toEqual([{ op: "add_sensitive_flags", count: 3 }]);
  });
});

describe("AI-12 output schema (C-10.2)", () => {
  it("converts to a canonical JSON schema", () => {
    const schema = ai12ExtractJsonSchema();
    expect(schema).toMatchObject({ type: "object", additionalProperties: false });
    expect((schema.required as string[]).sort()).toEqual(
      ["achievements", "affiliation_suggestion", "clarifications", "detail_patches", "new_details", "project_patches", "schema_version", "sensitive_flags", "skills"],
    );
    expect(() => toCanonicalJsonSchema(Ai12ExtractOutputSchema)).not.toThrow();
  });

  it("parses the spec example shape", () => {
    const parsed = Ai12ExtractOutputSchema.safeParse({
      schema_version: 2,
      project_patches: [{ field: "team_size", op: "set", value: 4, source_message_ids: ["M3"], source_quotes: ["저 포함 4명이었어요"] }],
      detail_patches: [{ detail_key: "D1", detail_ref: null, field: "action", op: "set", value: "v", source_message_ids: ["M7"], source_quotes: ["q"] }],
      achievements: [],
      skills: [{ value: "Kafka", source_message_ids: ["M4"], source_quotes: ["Kafka로"] }],
      new_details: [{ detail_key: "D2", source_message_ids: ["M15"] }],
      affiliation_suggestion: { type: "experience", ref: "EXP-1", source_message_ids: ["M1"], source_quotes: ["에이비씨페이 다닐 때"] },
      clarifications: [{ kind: "actor_ambiguous", field: "action", detail_key: "D1", detail_ref: null, note: "n" }],
      sensitive_flags: [{ category: "health", message_id: "M6" }],
    });
    expect(parsed.success).toBe(true);
  });
});
