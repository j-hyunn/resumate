import { describe, expect, it } from "vitest";
import { baseInput, emptyProject, filledProject, GREETING, rows } from "../__fixtures__/AI-12/conversations";
import { applyFormSnapshot, buildWritingChatContext, renderDraftForExtract, renderProjectForExtract, type WritingChatTurnInput } from "../context-pack/writing-chat";
import type { Ai12ExtractOutput } from "../schemas/AI-12";
import { parseStructuredDraft, toDraftPatch } from "../schemas/structured-draft";
import { mergedStarLength, pendingInForm, validateExtractOutput } from "./v9";

/**
 * AI-12 v4.6 (PA-3): the form snapshot is "the project's current values"
 * (V-9h, empty-field and classification judgments, C-14 room), and a proposal
 * already filled into the form gets `new_object` on the next patch (DM 2.5 DA-10).
 */

const SAY = "23년 3월부터 했어요. 피크 시간에 결제 승인 API가 느려졌어요. 제가 병목 쿼리를 찾아 인덱스를 다시 설계했어요. 응답 시간이 1.2초에서 0.7초로 줄었어요.";

function ctxFor(extra: Partial<WritingChatTurnInput> = {}) {
  return buildWritingChatContext(baseInput({ messages: rows([["assistant", GREETING], ["user", SAY]]), lastExtractedSequence: 1, ...extra }));
}

function output(partial: Partial<Ai12ExtractOutput>): Ai12ExtractOutput {
  return {
    schema_version: 3,
    project_patches: [],
    star_patches: [],
    classification_suggestions: { project_type: null, experience_type: null, competencies: null },
    clarifications: [],
    sensitive_flags: [],
    ...partial,
  };
}

const star = (field: string, value: string, quotes: string[], op: "set" | "append" = "set") =>
  ({ field, op, value, source_message_ids: ["M2"], source_quotes: quotes }) as Ai12ExtractOutput["star_patches"][number];

const pending = (value: string, extra: Record<string, unknown> = {}) => ({
  value,
  op: "set",
  origin: "ai",
  source_message_ids: ["00000000-0000-4000-8000-000000000002"],
  source_quotes: [],
  review: "ok",
  reviewed_at: null,
  applied_at: null,
  ...extra,
});

describe("applyFormSnapshot", () => {
  it("snapshot keys win; absent keys keep the DB value; null clears", () => {
    const merged = applyFormSnapshot(filledProject({ projectType: "improvement" }), {
      name: "새 이름",
      start_month: null,
      star: { action: "폼에서 고친 행동" },
      competencies: ["analysis"],
    });
    expect(merged.name).toBe("새 이름");
    expect(merged.startMonth).toBeNull();
    expect(merged.action).toBe("폼에서 고친 행동");
    expect(merged.situation).toBe("피크 시간에 결제 승인 API가 느려졌다");
    expect(merged.projectType).toBe("improvement");
    expect(merged.competencies).toEqual(["analysis"]);
  });

  it("a blank snapshot name keeps the DB name (rows always have one)", () => {
    expect(applyFormSnapshot(emptyProject(), { name: "  " }).name).toBe("결제 승인 API 개선");
  });

  it("no snapshot → DB values, valueSource db", () => {
    const ctx = ctxFor({ project: filledProject() });
    expect(ctx.valueSource).toBe("db");
    expect(ctxFor({ formSnapshot: { star: {} } }).valueSource).toBe("form_snapshot");
  });
});

describe("V-9h and empty-field judgments use the snapshot", () => {
  it("a field the user filled in the form (unsaved) takes append only", () => {
    const ctx = ctxFor({ project: emptyProject(), formSnapshot: { star: { action: "병목 쿼리를 찾았다" } } });
    const r = validateExtractOutput(output({ star_patches: [star("action", "인덱스를 다시 설계했다", ["인덱스를 다시 설계했어요"])] }), ctx.v9);
    expect(r.rejections).toEqual([{ check: "V-9h", target: "star.action" }]);
  });

  it("a field the user cleared in the form (DB still has it) takes set", () => {
    const ctx = ctxFor({ project: filledProject(), formSnapshot: { star: { situation: "" } } });
    const r = validateExtractOutput(output({ star_patches: [star("situation", "피크 시간에 결제 승인 API가 느려졌다", ["피크 시간에 결제 승인 API가 느려졌어요"])] }), ctx.v9);
    expect(r.rejections).toEqual([]);
    expect(r.changes.star.map((s) => `${s.field}:${s.op}`)).toEqual(["situation:set"]);
  });

  it("period: snapshot start month blocks a period patch; a cleared one allows it", () => {
    const patch = output({ project_patches: [{ field: "start_month", op: "set", value: "2023-03", source_message_ids: ["M2"], source_quotes: ["23년 3월부터"] }] });
    const blocked = validateExtractOutput(patch, ctxFor({ formSnapshot: { start_month: "2022-01" } }).v9);
    expect(blocked.rejections).toEqual([{ check: "V-9h", target: "project.start_month" }]);
    const allowed = validateExtractOutput(patch, ctxFor({ project: emptyProject({ startMonth: "2022-01-01" }), formSnapshot: { start_month: null } }).v9);
    expect(allowed.changes.period.map((p) => p.value)).toEqual(["2023-03"]);
  });

  it("is_current from the snapshot blocks end_month", () => {
    const patch = output({ project_patches: [{ field: "end_month", op: "set", value: "2023-03", source_message_ids: ["M2"], source_quotes: ["23년 3월부터"] }] });
    const r = validateExtractOutput(patch, ctxFor({ formSnapshot: { is_current: true } }).v9);
    expect(r.rejections).toEqual([{ check: "V-9h", target: "project.end_month" }]);
  });

  it("V-9i: a classification chosen in the form (unsaved) is not recommended", () => {
    const suggestion = output({
      classification_suggestions: {
        project_type: { value: "improvement", source_message_ids: ["M2"], reason: null },
        experience_type: null,
        competencies: { value: ["analysis"], source_message_ids: [], reason: null },
      },
    });
    const ctx = ctxFor({ project: filledProject(), formSnapshot: { project_type: "new_build", competencies: [] } });
    const r = validateExtractOutput(suggestion, ctx.v9);
    expect(r.changes.classification.map((c) => c.field)).toEqual(["competencies"]);
    expect(r.rejections).toEqual([{ check: "V-9i", target: "classification.project_type" }]);
  });

  it("the extract prompt says the values are the form's", () => {
    expect(renderProjectForExtract(ctxFor({ formSnapshot: { star: {} } }))).toContain("화면 폼의 현재 값");
    expect(renderProjectForExtract(ctxFor())).toContain("저장된 값");
  });
});

describe("new_object (proposal already filled into the form, DA-10)", () => {
  const filled = "피크 시간에 결제 승인 API가 느려졌다";

  it("detects a pending proposal whose text is in the form value (normalized)", () => {
    const ctx = ctxFor({ structuredDraft: { star: { situation: pending(filled) } }, formSnapshot: { star: { situation: `기존 배경.\n${filled.replace(/ /g, "  ")}.` } } });
    expect(pendingInForm("situation", ctx.v9.project, ctx.v9.draft)).toBe(true);
    // Not counted twice for C-14.
    expect(mergedStarLength("situation", ctx.v9.project, ctx.v9.draft)).toBe(`기존 배경.\n${filled.replace(/ /g, "  ")}.`.length);
    expect(renderDraftForExtract(ctx)).toContain("situation: (폼에 채워짐");
  });

  it("the next patch for that field is append + new_object, and toDraftPatch passes it through", () => {
    const ctx = ctxFor({ structuredDraft: { star: { situation: pending(filled) } }, formSnapshot: { star: { situation: filled } } });
    const r = validateExtractOutput(output({ star_patches: [star("situation", "응답 시간이 1.2초에서 0.7초로 줄었다", ["응답 시간이 1.2초에서 0.7초로 줄었어요"], "set"), star("situation", "인덱스를 다시 설계했다", ["인덱스를 다시 설계했어요"], "append")] }), ctx.v9);
    // set on a filled form field is V-9h; the append starts a new object.
    expect(r.rejections).toEqual([{ check: "V-9h", target: "star.situation" }]);
    expect(r.changes.star).toHaveLength(1);
    expect(r.changes.star[0]).toMatchObject({ op: "append", new_object: true });
    const op = toDraftPatch(r.changes).ops[0];
    expect(op).toMatchObject({ op: "append", target: { section: "star", field: "situation" }, new_object: true });
  });

  it("only the first patch of the turn carries new_object; later ones append to the new object", () => {
    const ctx = ctxFor({ structuredDraft: { star: { situation: pending(filled) } }, formSnapshot: { star: { situation: filled } } });
    const r = validateExtractOutput(
      output({ star_patches: [star("situation", "인덱스를 다시 설계했다", ["인덱스를 다시 설계했어요"], "append"), star("situation", "응답 시간이 1.2초에서 0.7초로 줄었다", ["응답 시간이 1.2초에서 0.7초로 줄었어요"], "append")] }),
      ctx.v9,
    );
    expect(r.changes.star.map((s) => !!s.new_object)).toEqual([true, false]);
  });

  it("a pending proposal not in the form keeps appending (no new_object)", () => {
    const ctx = ctxFor({ structuredDraft: { star: { situation: pending(filled) } }, formSnapshot: { star: { situation: "" } } });
    const r = validateExtractOutput(output({ star_patches: [star("situation", "인덱스를 다시 설계했다", ["인덱스를 다시 설계했어요"], "append")] }), ctx.v9);
    expect(r.changes.star[0].new_object).toBeUndefined();
  });

  it("a user_edit proposal already in the form is no longer protected", () => {
    const ctx = ctxFor({ structuredDraft: { star: { situation: pending(filled, { origin: "user_edit" }) } }, formSnapshot: { star: { situation: filled } } });
    const r = validateExtractOutput(output({ star_patches: [star("situation", "인덱스를 다시 설계했다", ["인덱스를 다시 설계했어요"], "append")] }), ctx.v9);
    expect(r.rejections).toEqual([]);
    expect(r.changes.star[0]).toMatchObject({ new_object: true });
  });

  it("an append whose sentence is already in the form is a no-op (no double fill)", () => {
    const ctx = ctxFor({ structuredDraft: { star: { situation: pending(filled) } }, formSnapshot: { star: { situation: filled } } });
    const r = validateExtractOutput(output({ star_patches: [star("situation", filled, ["피크 시간에 결제 승인 API가 느려졌어요"], "append")] }), ctx.v9);
    expect(r.changes.star).toEqual([]);
    expect(r.report.unchanged).toBe(1);
  });
});

describe("structured_draft v3 rev", () => {
  it("objects without rev read as 1; rev is kept", () => {
    const d = parseStructuredDraft({ star: { action: pending("a") , result: pending("b", { rev: 4 }) } });
    expect(d.star.action!.rev).toBe(1);
    expect(d.star.result!.rev).toBe(4);
  });
});
