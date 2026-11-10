import { describe, expect, it } from "vitest";
import { KO_BACKEND, KO_DATA_NOISY, KO_WITH_DEADLINE, output } from "../__fixtures__/AI-01/jds";
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

// (v4.15, CF-2·CF-A5) deadline 검증 1~5 — R15 AI1.
describe("deadline (AI-01 CF-2)", () => {
  const sentences = splitJdSentences(KO_WITH_DEADLINE.raw);
  const sentenceText = (sid: string) => sentences.find((s) => s.sid === sid)?.text ?? null;
  const run = (partial: Parameters<typeof output>[0], today?: string | null) =>
    validateJdExtraction(output(partial), new Set(sentences.map((s) => s.sid)), { sentenceText, today });

  it("keeps a dated deadline whose sentence spells out year, month and day", () => {
    const { value, report } = run({ deadline: { value: "2026-12-15", source_sids: ["S4"] } }, "2026-11-09");
    expect(value.deadline).toEqual({ value: "2026-12-15", source_sids: ["S4"], usable: true });
    expect(report.deadline_dropped).toBe(0);
    expect(value.schema_version).toBe(2);
  });

  it("drops the value when a source_sid is outside this JD's split (check 2)", () => {
    const { value, report } = run({ deadline: { value: "2026-12-15", source_sids: ["S99"] } }, "2026-11-09");
    expect(value.deadline).toBeNull();
    expect(report.deadline_dropped).toBe(1);
    expect(report.sids_dropped).toBeGreaterThan(0);
  });

  it("drops the value when source_sids is empty (check 2)", () => {
    expect(run({ deadline: { value: "2026-12-15", source_sids: [] } }, "2026-11-09").value.deadline).toBeNull();
  });

  it("drops a non-calendar date (check 1)", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "0000-01-01", "2026/12/15", "12-15"]) {
      expect(run({ deadline: { value: bad, source_sids: ["S4"] } }, "2026-11-09").value.deadline).toBeNull();
    }
  });

  it("drops a value whose year is not in the cited sentence (check 3)", () => {
    // S5 ("면접은 12월 말에 진행됩니다.") has no year and no day.
    expect(run({ deadline: { value: "2026-12-31", source_sids: ["S5"] } }, "2026-11-09").value.deadline).toBeNull();
  });

  it("reads a two-digit year written with a dot as 20YY (check 3 [가정])", () => {
    const short = splitJdSentences("마감: 26.12.15까지");
    const { value } = validateJdExtraction(output({ deadline: { value: "2026-12-15", source_sids: ["S1"] } }), new Set(short.map((s) => s.sid)), {
      sentenceText: (sid) => short.find((s) => s.sid === sid)?.text ?? null,
      today: "2026-11-09",
    });
    expect(value.deadline?.value).toBe("2026-12-15");
  });

  it("keeps a past deadline but marks it unusable and warns (check 4)", () => {
    const { value, report } = run({ deadline: { value: "2026-12-15", source_sids: ["S4"] } }, "2026-12-20");
    expect(value.deadline).toEqual({ value: "2026-12-15", source_sids: ["S4"], usable: false });
    expect(report.deadline_out_of_range).toBe(1);
    expect(value.warnings).toContain("공고의 마감일(2026-12-15)이 이미 지났어요");
  });

  it("marks a deadline more than 366 days ahead unusable without a warning (check 4)", () => {
    const { value } = run({ deadline: { value: "2026-12-15", source_sids: ["S4"] } }, "2025-01-01");
    expect(value.deadline?.usable).toBe(false);
    expect(value.warnings).toEqual([]);
  });

  it("keeps the day the deadline falls on today", () => {
    expect(run({ deadline: { value: "2026-12-15", source_sids: ["S4"] } }, "2026-12-15").value.deadline?.usable).toBe(true);
  });

  it("passes an older result that has no deadline key (schema_version 1)", () => {
    const old = { ...output({}), schema_version: 1 } as unknown as Parameters<typeof validateJdExtraction>[0];
    delete (old as { deadline?: unknown }).deadline;
    const { value, report } = validateJdExtraction(old, new Set(sentences.map((s) => s.sid)), { sentenceText, today: "2026-11-09" });
    expect(value.deadline).toBeNull();
    expect(report.deadline_dropped).toBe(0);
    expect(value.schema_version).toBe(2);
  });

  it("a null value is not a failure", () => {
    const { value, report } = run({ deadline: { value: null, source_sids: [] } }, "2026-11-09");
    expect(value.deadline).toBeNull();
    expect(report.deadline_dropped).toBe(0);
  });
});
