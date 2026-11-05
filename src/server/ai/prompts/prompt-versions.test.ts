import { describe, expect, it } from "vitest";
import { AI01_PROMPT_VERSION, AI01_SYSTEM } from "./AI-01";
import { AI02_MATCH_PROMPT_VERSION, AI02_PROMPT_VERSION, AI02_SYNTHESIZE_PROMPT_VERSION, AI02_SYSTEM } from "./AI-02";
import { AI03_PROMPT_VERSION, AI03_SYSTEM } from "./AI-03";
import { AI04_ADJUST_PROMPT_VERSION, AI04_PROMPT_VERSION, AI04_SYSTEM } from "./AI-04";
import { AI05_PROMPT_VERSION, AI05_SYSTEM } from "./AI-05";
import { AI06_PROMPT_VERSION, AI06_SYSTEM } from "./AI-06";
import { AI07_PROMPT_VERSION } from "./AI-07";
import { AI11_PROMPT_VERSION } from "./AI-11";
import { AI12_EXTRACT_PROMPT_VERSION, AI12_REPLY_PROMPT_VERSION } from "./AI-12";
import { AI13_COMPOSE_PROMPT_VERSION, AI13_EXTRACT_PROMPT_VERSION, AI13_REPLY_PROMPT_VERSION } from "./AI-13";
import { COMMON_PROMPT_VERSION, COMMON_SYSTEM_PROMPT } from "./common";

/**
 * (v4.12, SD-6 / AI spec 0.v412) No profile value may appear in any prompt
 * text, and the prompt versions of R13 are pinned here: `input_hash` reuse
 * depends on the exact strings.
 */
describe("prompt text carries no profile value (SD-6)", () => {
  const SYSTEMS: Array<[string, string]> = [
    ["common", COMMON_SYSTEM_PROMPT],
    ["AI-01", AI01_SYSTEM],
    ["AI-02", AI02_SYSTEM],
    ["AI-03", AI03_SYSTEM],
    ["AI-04", AI04_SYSTEM],
    ["AI-05", AI05_SYSTEM],
    ["AI-06", AI06_SYSTEM],
  ];

  it.each(SYSTEMS)("%s system never names a profile field or the PROFILE alias", (_, system) => {
    expect(system).not.toMatch(/desired_job_title|interested_industries|total_years_of_experience|display_name|PROFILE/);
    expect(system).not.toContain("희망 직무");
    expect(system).not.toContain("프로필");
  });

  it("R4 common block keeps the v4.5 alias, classification and deliverable rules", () => {
    expect(COMMON_SYSTEM_PROMPT).toContain("DLV-3");
    expect(COMMON_SYSTEM_PROMPT).not.toMatch(/DET-\d|ACH-\d/);
    expect(COMMON_SYSTEM_PROMPT).toContain("<classification>");
    expect(COMMON_SYSTEM_PROMPT).toContain("<deliverable>");
  });

  it("AI-02 judges the 연차 요건 on computed_total_months alone (SD-2)", () => {
    expect(AI02_SYSTEM).toContain("computed_total_months");
    expect(AI02_SYSTEM).toContain("computed_open_ended_experiences");
    expect(AI02_SYSTEM).toContain("등록된 경력 기간 합계 기준");
  });

  it("AI-04 future_plan grounds 성장 방향 in the JD (SD-6)", () => {
    expect(AI04_SYSTEM).toContain("성장 방향은 <jd>의 주요 업무 문장(S 번호)과 스킬 근거로 씁니다");
  });

  it("AI-05 culture-fit questions take their job vocabulary from the JD (SD-6)", () => {
    expect(AI05_SYSTEM).toContain("직무 어휘는 <jd>의 직무명·요건 문장에서 가져옵니다");
  });

  it("AI-05 states the fact-premise rule for every job question kind (A11)", () => {
    expect(AI05_SYSTEM).toContain("모든 직무 질문(project_deep_dive, requirement_fit, gap_probe)");
    expect(AI05_SYSTEM).toContain("사실을 전제하지 않고 묻습니다");
  });
});

/** AI spec v4.12 0.v412 프롬프트 버전 표 (R13). The common suffix changes every stored string. */
describe("prompt versions (R13)", () => {
  it("bumps the common suffix", () => {
    expect(COMMON_PROMPT_VERSION).toBe("common.v3");
  });

  it.each<[string, string, string]>([
    ["AI-02 match", AI02_MATCH_PROMPT_VERSION, "ai-02.match.v5+common.v3"],
    ["AI-02 synthesize", AI02_SYNTHESIZE_PROMPT_VERSION, "ai-02.synthesize.v5+common.v3"],
    ["AI-02 stored", AI02_PROMPT_VERSION, "ai-02.match.v5+ai-02.synthesize.v5+common.v3"],
    ["AI-03", AI03_PROMPT_VERSION, "ai-03.generate.v4+common.v3"],
    ["AI-04 generate", AI04_PROMPT_VERSION, "ai-04.generate.v4+common.v3"],
    ["AI-04 adjust", AI04_ADJUST_PROMPT_VERSION, "ai-04.adjust.v4+common.v3"],
    ["AI-05", AI05_PROMPT_VERSION, "ai-05.generate.v4+common.v3"],
    ["AI-06", AI06_PROMPT_VERSION, "ai-06.evaluate.v4+common.v3"],
    ["AI-12 reply", AI12_REPLY_PROMPT_VERSION, "ai-12.reply.v7+common.v3"],
    ["AI-13 reply", AI13_REPLY_PROMPT_VERSION, "ai-13.reply.v3+common.v3"],
  ])("%s is bumped", (_, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it.each<[string, string, string]>([
    ["AI-01 extract", AI01_PROMPT_VERSION, "ai-01.extract.v1+common.v3"],
    ["AI-07", AI07_PROMPT_VERSION, "ai-07.summarize.v1+common.v3"],
    ["AI-11", AI11_PROMPT_VERSION, "ai-11.rank.v2+common.v3"],
    ["AI-12 extract", AI12_EXTRACT_PROMPT_VERSION, "ai-12.extract.v7+common.v3"],
    ["AI-13 extract", AI13_EXTRACT_PROMPT_VERSION, "ai-13.extract.v3+common.v3"],
    ["AI-13 compose", AI13_COMPOSE_PROMPT_VERSION, "ai-13.compose.v2+common.v3"],
  ])("%s keeps its call version (only the common suffix moves)", (_, actual, expected) => {
    expect(actual).toBe(expected);
  });
});
