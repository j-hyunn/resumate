import { describe, expect, it } from "vitest";
import { toCanonicalJsonSchema } from "../providers/schema";
import { Ai12ExtractOutputSchema, ai12ExtractJsonSchema } from "./AI-12";
import {
  emptyDraftChanges,
  hasValue,
  isApplicable,
  isEmptyDraftChanges,
  isEmptyDraftPatch,
  isPending,
  isProtected,
  parseStructuredDraft,
  toDraftPatch,
  type DraftChanges,
} from "./structured-draft";

const obj = (extra: Record<string, unknown> = {}) => ({ value: "v", origin: "ai", source_message_ids: ["u"], source_quotes: ["q"], review: "ok", reviewed_at: null, applied_at: null, ...extra });

describe("parseStructuredDraft (v3)", () => {
  it("fills the skeleton from the column default '{}'", () => {
    expect(parseStructuredDraft({})).toEqual({ schema_version: 3, project: {}, star: {}, classification: {}, clarifications: [], sensitive_flags_count: 0 });
  });

  it("reads the DM v4.4 stored shape (op, applied_at, classification reason)", () => {
    const draft = parseStructuredDraft({
      schema_version: 3,
      project: { start_month: obj({ value: "2023-03" }) },
      star: { result: obj({ op: "append", review: "needs_review" }) },
      classification: {
        experience_type: { value: "problem_solving", origin: "ai", source_message_ids: [], reason: "이유", review: "ok", reviewed_at: null, applied_at: null },
        competencies: { value: ["analysis", "execution"], origin: "ai", source_message_ids: ["u"], reason: null, review: "ok", reviewed_at: null, applied_at: "2026-11-02T00:00:00Z" },
      },
      clarifications: [{ kind: "actor_ambiguous", field: "action" }],
      sensitive_flags_count: 1,
    });
    expect(draft.star.result).toMatchObject({ op: "append", review: "needs_review", applied_at: null });
    expect(draft.classification.experience_type?.reason).toBe("이유");
    expect(draft.classification.competencies?.value).toEqual(["analysis", "execution"]);
  });

  it("defaults op to set and drops unknown keys (v4.4 details / skills / is_current)", () => {
    const draft = parseStructuredDraft({ star: { action: { value: "a" } }, details: [], skills: [], project: { start_month: { value: "2023-03" } } });
    expect(draft.star.action?.op).toBe("set");
    expect(draft).not.toHaveProperty("details");
    expect(() => parseStructuredDraft({ project: { is_current: { value: "true" } } })).toThrow();
  });

  it("throws on a malformed draft instead of resetting it", () => {
    expect(() => parseStructuredDraft({ star: "nope" })).toThrow();
    expect(() => parseStructuredDraft({ clarifications: [{ kind: "affiliation_unclear" }] })).toThrow();
  });
});

describe("field predicates", () => {
  it.each([
    ["empty", obj({ value: null }), { has: false, pending: false, applicable: false, protected: false }],
    ["blank", obj({ value: "  " }), { has: false, pending: false, applicable: false, protected: false }],
    ["empty array", obj({ value: [] }), { has: false, pending: false, applicable: false, protected: false }],
    ["ok", obj(), { has: true, pending: true, applicable: true, protected: false }],
    ["needs_review", obj({ review: "needs_review" }), { has: true, pending: true, applicable: false, protected: false }],
    ["accepted", obj({ review: "accepted" }), { has: true, pending: true, applicable: true, protected: true }],
    ["user_edit", obj({ origin: "user_edit" }), { has: true, pending: true, applicable: true, protected: true }],
    ["applied user_edit", obj({ origin: "user_edit", applied_at: "t" }), { has: true, pending: false, applicable: false, protected: false }],
  ])("%s", (_name, f, expected) => {
    const field = f as Parameters<typeof hasValue>[0];
    expect({ has: hasValue(field), pending: isPending(field), applicable: isApplicable(field), protected: isProtected(field) }).toEqual(expected);
  });
});

describe("toDraftPatch (RPC op list v3)", () => {
  const src = { source_message_ids: ["u1"], source_quotes: ["q"] };

  it("orders sensitive, period, STAR, classification, clarifications", () => {
    const changes: DraftChanges = {
      period: [{ field: "start_month", value: "2023-03", review: "ok", ...src }],
      star: [
        { field: "action", op: "set", value: "a", review: "ok", ...src },
        { field: "result", op: "append", value: "r", review: "needs_review", ...src },
      ],
      classification: [{ field: "competencies", value: ["analysis"], source_message_ids: ["u1"], reason: null }],
      clarifications: [],
      sensitive_flags_add: 2,
    };
    expect(toDraftPatch(changes).ops).toEqual([
      { op: "add_sensitive_flags", count: 2 },
      { op: "set", target: { section: "project", field: "start_month" }, value: "2023-03", review: "ok", ...src },
      { op: "set", target: { section: "star", field: "action" }, value: "a", review: "ok", ...src },
      { op: "append", target: { section: "star", field: "result" }, value: "r", review: "needs_review", ...src },
      { op: "set", target: { section: "classification", field: "competencies" }, value: ["analysis"], source_message_ids: ["u1"], reason: null },
      { op: "set_clarifications", items: [] },
    ]);
  });

  it("empty changes → no ops; clamps to the RPC limits", () => {
    expect(isEmptyDraftChanges(emptyDraftChanges())).toBe(true);
    expect(isEmptyDraftPatch(toDraftPatch(emptyDraftChanges()))).toBe(true);
    const many = Array.from({ length: 30 }, (_, i) => `q${i}`);
    const patch = toDraftPatch({
      ...emptyDraftChanges(),
      star: [{ field: "action", op: "set", value: "a", review: "ok", source_message_ids: many, source_quotes: many }],
      sensitive_flags_add: 500,
    });
    expect(patch.ops[0]).toEqual({ op: "add_sensitive_flags", count: 100 });
    expect(patch.ops[1]).toMatchObject({ source_message_ids: many.slice(0, 20), source_quotes: many.slice(0, 20) });
  });

  it("QA-S4-07: the sensitive count survives the 100-op cap", () => {
    const patch = toDraftPatch({
      ...emptyDraftChanges(),
      star: Array.from({ length: 150 }, () => ({ field: "action" as const, op: "append" as const, value: "a", review: "ok" as const, ...src })),
      sensitive_flags_add: 3,
    });
    expect(patch.ops).toHaveLength(100);
    expect(patch.ops.filter((o) => o.op === "add_sensitive_flags")).toEqual([{ op: "add_sensitive_flags", count: 3 }]);
  });
});

describe("AI-12 output schema v3 (C-10.2)", () => {
  it("converts to a canonical JSON schema with classification enums", () => {
    const schema = ai12ExtractJsonSchema();
    expect(schema).toMatchObject({ type: "object", additionalProperties: false });
    expect((schema.required as string[]).sort()).toEqual(["clarifications", "classification_suggestions", "project_patches", "schema_version", "sensitive_flags", "star_patches"]);
    expect(JSON.stringify(schema)).toContain('"new_build"');
    expect(JSON.stringify(schema)).toContain('"learning_agility"');
    expect(() => toCanonicalJsonSchema(Ai12ExtractOutputSchema)).not.toThrow();
  });

  it("parses the spec example shape", () => {
    const parsed = Ai12ExtractOutputSchema.safeParse({
      schema_version: 3,
      project_patches: [{ field: "start_month", op: "set", value: "2023-03", source_message_ids: ["M2"], source_quotes: ["23년 3월부터"] }],
      star_patches: [
        { field: "action", op: "set", value: "v", source_message_ids: ["M7"], source_quotes: ["q"] },
        { field: "result", op: "append", value: "r", source_message_ids: ["M9"], source_quotes: ["q"] },
      ],
      classification_suggestions: {
        project_type: { value: "improvement", source_message_ids: ["M7"], reason: "기존 결제 API의 성능을 개선한 작업" },
        experience_type: { value: "problem_solving", source_message_ids: ["M7", "M9"], reason: "병목을 찾아 해결한 경험" },
        competencies: { value: ["problem_solving", "analysis"], source_message_ids: ["M7"], reason: null },
      },
      clarifications: [{ kind: "actor_ambiguous", field: "action", note: "n" }],
      sensitive_flags: [{ category: "health", message_id: "M6" }],
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ["out-of-list classification", { classification_suggestions: { project_type: { value: "rocket", source_message_ids: [], reason: null }, experience_type: null, competencies: null } }],
    ["append on a period", { project_patches: [{ field: "start_month", op: "append", value: "2023-03", source_message_ids: [], source_quotes: [] }] }],
    ["is_current patch", { project_patches: [{ field: "is_current", op: "set", value: "true", source_message_ids: [], source_quotes: [] }] }],
    ["v4.4 field", { star_patches: [{ field: "title", op: "set", value: "t", source_message_ids: [], source_quotes: [] }] }],
  ])("rejects %s (V-6)", (_name, partial) => {
    const base = { schema_version: 3, project_patches: [], star_patches: [], classification_suggestions: { project_type: null, experience_type: null, competencies: null }, clarifications: [], sensitive_flags: [] };
    expect(Ai12ExtractOutputSchema.safeParse({ ...base, ...partial }).success).toBe(false);
  });
});
