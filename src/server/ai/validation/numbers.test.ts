import { describe, expect, it } from "vitest";
import { careerRowsFixture } from "../__fixtures__/career-rows";
import { buildCareerPack } from "../context-pack/career-pack";
import { buildAllowedNumbers, extractNumbers, findUnsupportedNumbers, guardNumbers, NUMBER_CHECK_TOKEN } from "./numbers";
import { PLACEHOLDER_TOKENS } from "./placeholders";

describe("extractNumbers", () => {
  it.each<[string, string[], string[]]>([
    ["응답 시간 30% 단축", ["30%"], ["30"]],
    ["처리량 3배 향상", ["3배"], ["3"]],
    ["1,200명 대상", ["1,200명"], ["1200"]],
    ["2년 6개월 근무", ["2년", "6개월"], ["2", "6"]],
    ["1.2초 → 0.7초", ["1.2초", "0.7초"], ["1.2", "0.7"]],
    ["월 1.2만 건", ["1.2만"], ["12000"]],
    ["300ms 이하", ["300ms"], ["300"]],
  ])("%s", (text, raws, values) => {
    const mentions = extractNumbers(text);
    expect(mentions.map((m) => m.raw)).toEqual(raws);
    expect(mentions.map((m) => m.value)).toEqual(values);
  });

  it("ignores aliases and digits inside names (EC2, B2B, K8s, OAuth2, 3D)", () => {
    expect(extractNumbers("PRJ-3과 REQ-12, S4 근거로 EC2·B2B·K8s·OAuth2·3D 사용")).toEqual([]);
  });

  it("placeholders contain no numbers", () => {
    for (const token of [...PLACEHOLDER_TOKENS, NUMBER_CHECK_TOKEN]) expect(extractNumbers(token)).toEqual([]);
  });
});

describe("V-5 number guard", () => {
  const pack = buildCareerPack(careerRowsFixture(), { asOf: { year: 2026, month: 10 } });
  const allowed = buildAllowedNumbers({
    texts: [...pack.numberSources.factualTexts, "경력 3년 이상"],
    numbers: pack.numberSources.computedNumbers,
  });

  it.each<[string, string[]]>([
    ["응답 시간을 1.2초에서 0.7초로 단축", []],
    ["분당 1,200건 처리", []], // source says 1200 / 1,200건
    ["4인 팀 리드", []], // team_size 4
    ["5년 8개월간 결제 개발", []], // computed duration
    ["3년 이상 요건 충족", []], // JD text
    ["응답 시간 41% 단축", ["41%"]], // derived percentage not in any source
    ["팀원 99% 동의", ["99%"]], // only in learnings (C-9: not a fact)
    ["월 2만 건", ["2만"]], // 20000, not the bare 2
    ["1.2천 건", []], // 1200 written with a magnitude suffix
  ])("%s → unsupported %j", (text, bad) => {
    expect(findUnsupportedNumbers(text, allowed).map((m) => m.raw)).toEqual(bad);
  });

  it("replaces unsupported number + unit with [수치 확인 필요] and keeps placeholders", () => {
    expect(guardNumbers("처리 시간 [수치 입력 필요] 단축, 응답 41% 개선, 1.2초 기준", allowed)).toEqual({
      text: `처리 시간 [수치 입력 필요] 단축, 응답 ${NUMBER_CHECK_TOKEN} 개선, 1.2초 기준`,
      replaced: 1,
    });
  });
});
