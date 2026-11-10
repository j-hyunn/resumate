import { describe, expect, it } from "vitest";
import { AliasMap } from "./aliases";
import { joinSourceLabel, sourceLabel } from "./selection";

/**
 * R15 후속 4: `sourceLabel` was refactored to call `joinSourceLabel` so the reopened 서류 대화's
 * `sourceLabels` and the SSE `sources_selected` card share one rule. `sourceLabel` also feeds the
 * AI-04 prompt (`renderUserSources`), so this pins that the output is **byte-identical** to the
 * pre-refactor body — no change to model input, `prompt_version` or `input_hash`.
 */
const before = (parent: string | null | undefined, project: string | null | undefined) =>
  [parent, project].filter((v): v is string => !!v && v.trim() !== "").join(" › ");

describe("joinSourceLabel / sourceLabel (R15 후속 4)", () => {
  const cases: Array<[string | null | undefined, string | null | undefined]> = [
    ["알파", "결제 개선"],
    ["알파", null],
    [null, "결제 개선"],
    [undefined, undefined],
    ["", "결제 개선"],
    ["   ", "결제 개선"],
    ["알파", "   "],
    [" 알파 ", " 결제 개선 "],
    ["데이터 분석 과정", "추천 모델"],
  ];

  it.each(cases)("joinSourceLabel(%j, %j) equals the pre-refactor rule", (parent, project) => {
    expect(joinSourceLabel(parent, project)).toBe(before(parent, project));
  });

  it("sourceLabel over pack aliases gives the same string as before", () => {
    const aliases = new AliasMap();
    aliases.add({ alias: "EXP-1", sourceType: "experience", id: "e1", fields: {}, snapshotAt: null, label: "알파", parents: [] });
    aliases.add({ alias: "PRJ-1", sourceType: "project", id: "p1", fields: {}, snapshotAt: null, label: "결제 개선", parents: ["EXP-1"] });
    aliases.add({ alias: "EDU-1", sourceType: "education", id: "d1", fields: {}, snapshotAt: null, label: null, parents: [] });
    expect(sourceLabel(aliases, { projectAlias: "PRJ-1", parentAlias: "EXP-1" })).toBe("알파 › 결제 개선");
    expect(sourceLabel(aliases, { projectAlias: "PRJ-1", parentAlias: null })).toBe("결제 개선");
    expect(sourceLabel(aliases, { projectAlias: null, parentAlias: "EXP-1" })).toBe("알파");
    // A null label (unnamed education) is dropped, exactly as before.
    expect(sourceLabel(aliases, { projectAlias: "PRJ-1", parentAlias: "EDU-1" })).toBe("결제 개선");
    expect(sourceLabel(aliases, { projectAlias: null, parentAlias: null })).toBe("");
  });
});
