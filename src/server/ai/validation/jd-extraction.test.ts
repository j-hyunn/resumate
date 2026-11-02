import { describe, expect, it } from "vitest";
import { KO_BACKEND, KO_DATA_NOISY, output } from "../__fixtures__/AI-01/jds";
import { splitJdSentences } from "../context-pack/jd";
import { normalizeSid, requirementTextKey, validateJdExtraction } from "./jd-extraction";

const ids = (raw: string) => new Set(splitJdSentences(raw).map((s) => s.sid));
const S = (n: number) => new Set(Array.from({ length: n }, (_, i) => `S${i + 1}`));

describe("normalizeSid", () => {
  it.each([
    ["S4", "S4"],
    ["s4", "S4"],
    ["S-4", "S4"],
    [" S04 ", "S4"],
    ["S0", null],
    ["REQ-1", null],
    ["4", null],
    ["S4a", null],
  ])("%s → %s", (raw, expected) => expect(normalizeSid(raw)).toBe(expected));
});

describe("requirementTextKey", () => {
  it("ignores case, spacing, full-width forms, and trailing punctuation", () => {
    expect(requirementTextKey("SQL 활용  능력.")).toBe(requirementTextKey("ｓｑｌ 활용 능력"));
    expect(requirementTextKey("결제 API")).not.toBe(requirementTextKey("결제 APIs"));
  });
});

describe("validateJdExtraction", () => {
  it("keeps a clean output as is", () => {
    const { value, report } = validateJdExtraction(KO_BACKEND.output, ids(KO_BACKEND.raw));
    expect(value.requirements).toHaveLength(6);
    expect(value.company_name?.value).toBe("에이비씨페이");
    expect(value.seniority?.min_years).toBe(5);
    expect(report).toMatchObject({ requirements_proposed: 6, requirements_kept: 6, sids_dropped: 0, requirements_merged: 0 });
  });

  it("noisy output: unknown sids dropped, same text merged, invented requirements removed", () => {
    expect(ids(KO_DATA_NOISY.raw).size).toBe(5);
    const { value, report } = validateJdExtraction(KO_DATA_NOISY.output, ids(KO_DATA_NOISY.raw));
    expect(value.requirements.map((r) => r.text)).toEqual(["주문 데이터 파이프라인 구축 및 운영", "SQL 활용 능력"]);
    const sql = value.requirements[1];
    expect(sql.source_sids).toEqual(["S3", "S4"]); // "S-3" normalized, merged with S4
    expect(sql.importance).toBe("high"); // any high wins
    expect(sql.keywords).toEqual(["SQL", "쿼리"]); // case-insensitive dedupe
    expect(value.position_title).toBeNull();
    expect(value.company_name?.value).toBe("가나다커머스");
    expect(value.tech_keywords).toEqual([{ keyword: "SQL", source_sids: ["S3", "S4"] }]);
    expect(value.other_sids).toEqual(["S5"]);
    expect(report).toMatchObject({
      requirements_proposed: 5,
      requirements_kept: 2,
      requirements_dropped_no_sid: 2,
      requirements_merged: 1,
      position_title_dropped: 1,
      tech_keywords_dropped: 1,
      tech_keywords_merged: 1,
      other_sids_dropped: 1,
    });
    // S99 (title) + S42 (Spark req) + S42 (Spark kw) + S77 (other)
    expect(report.sids_dropped).toBe(4);
  });

  it("a requirement keeps only its known sids, sorted and unique", () => {
    const { value } = validateJdExtraction(
      output({ requirements: [{ category: "required", text: "A", keywords: [], importance: "normal", source_sids: ["S3", "S9", "S1", "s3"] }] }),
      S(3),
    );
    expect(value.requirements[0].source_sids).toEqual(["S1", "S3"]);
  });

  it("drops blank requirement text and caps keywords at 10", () => {
    const many = Array.from({ length: 10 }, (_, i) => `k${i}`);
    const { value, report } = validateJdExtraction(
      output({
        requirements: [
          { category: "required", text: "   ", keywords: [], importance: "normal", source_sids: ["S1"] },
          { category: "required", text: "B", keywords: many, importance: "normal", source_sids: ["S1"] },
          { category: "preferred", text: "b", keywords: ["extra", " "], importance: "normal", source_sids: ["S2"] },
        ],
      }),
      S(2),
    );
    expect(report.requirements_dropped_empty_text).toBe(1);
    expect(value.requirements).toHaveLength(1);
    expect(value.requirements[0].category).toBe("required"); // first one keeps its category
    expect(value.requirements[0].keywords).toHaveLength(10);
    expect(value.requirements[0].source_sids).toEqual(["S1", "S2"]);
  });

  it.each([
    ["no sid", { min_years: 3, max_years: null, label: "3년 이상", source_sids: ["S9"] }],
    ["min > max", { min_years: 7, max_years: 3, label: "x", source_sids: ["S1"] }],
    ["empty", { min_years: null, max_years: null, label: " ", source_sids: ["S1"] }],
  ])("drops seniority: %s", (_name, seniority) => {
    const { value, report } = validateJdExtraction(output({ seniority }), S(2));
    expect(value.seniority).toBeNull();
    expect(report.seniority_dropped).toBe(1);
  });

  it("company name with a blank value is dropped", () => {
    const { value, report } = validateJdExtraction(output({ company_name: { value: " ", source_sids: ["S1"] } }), S(1));
    expect(value.company_name).toBeNull();
    expect(report.company_name_dropped).toBe(1);
  });

  it.each([
    ["EN", "en"],
    ["ko", "ko"],
    ["zh-Hant", "zh-hant"],
    ["korean language", null],
    [null, null],
  ])("detected_language %s → %s", (raw, expected) => {
    expect(validateJdExtraction(output({ detected_language: raw }), S(1)).value.detected_language).toBe(expected);
  });

  it("dedupes warnings", () => {
    expect(validateJdExtraction(output({ warnings: ["복수 포지션", "복수 포지션 ", ""] }), S(1)).value.warnings).toEqual(["복수 포지션"]);
  });
});
