import { describe, expect, it } from "vitest";
import { AI02_MATCH_PROMPT_VERSION, AI02_PROMPT_VERSION, AI02_SYNTHESIZE_PROMPT_VERSION, AI02_SYSTEM } from "./AI-02";
import {
  AI04_ADJUST_PROMPT_VERSION,
  AI04_EXTRACT_PROMPT_VERSION,
  AI04_EXTRACT_SYSTEM,
  AI04_PROMPT_VERSION,
  AI04_REPLY_PROMPT_VERSION,
  AI04_REPLY_SYSTEM,
  AI04_SYSTEM,
} from "./AI-04";
import { AI12_EXTRACT_PROMPT_VERSION, AI12_EXTRACT_SYSTEM, AI12_REPLY_PROMPT_VERSION, AI12_REPLY_SYSTEM } from "./AI-12";
import { AI13_COMPOSE_PROMPT_VERSION, AI13_EXTRACT_PROMPT_VERSION, AI13_REPLY_PROMPT_VERSION } from "./AI-13";
import { COMMON_PROMPT_VERSION, COMMON_SYSTEM_PROMPT } from "./common";
import { PLACEHOLDER_TOKENS } from "../validation/placeholders";

/**
 * (v4.12, SD-6 / AI spec 0.v412) No profile value may appear in any prompt
 * text, and the prompt versions of R13 are pinned here: `input_hash` reuse
 * depends on the exact strings.
 */
describe("prompt text carries no profile value (SD-6)", () => {
  const SYSTEMS: Array<[string, string]> = [
    ["common", COMMON_SYSTEM_PROMPT],
    ["AI-02", AI02_SYSTEM],
    ["AI-04", AI04_SYSTEM],
    ["AI-04 extract", AI04_EXTRACT_SYSTEM],
    ["AI-04 reply", AI04_REPLY_SYSTEM],
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

  it("AI-02 judges the 연차 요건 against the JD sentences, not a seniority line (R17)", () => {
    expect(AI02_SYSTEM).not.toContain("seniority");
  });

  it("AI-04 future_plan grounds 성장 방향 in the JD (SD-6)", () => {
    expect(AI04_SYSTEM).toContain("성장 방향은 <jd>의 주요 업무 문장(S 번호)과 스킬 근거로 씁니다");
  });

});

/** (R14, AI spec v4.14 RM-1) The mock interview is gone from every prompt. */
describe("prompt text carries no mock-interview rule (R14)", () => {
  const SYSTEMS: Array<[string, string]> = [
    ["common", COMMON_SYSTEM_PROMPT],
    ["AI-02", AI02_SYSTEM],
    ["AI-04", AI04_SYSTEM],
    ["AI-04 extract", AI04_EXTRACT_SYSTEM],
    ["AI-04 reply", AI04_REPLY_SYSTEM],
  ];

  it.each(SYSTEMS)("%s system never names the removed placeholder or <answer> block", (_, system) => {
    expect(system).not.toContain("[사례 입력 필요]");
    expect(system).not.toContain("<answer>");
  });

  it("the common block lists exactly the five C-5 tokens", () => {
    expect(COMMON_SYSTEM_PROMPT).toContain("자리 표시 (이 5개만 사용)");
    for (const token of PLACEHOLDER_TOKENS) expect(COMMON_SYSTEM_PROMPT).toContain(token);
    expect(PLACEHOLDER_TOKENS).toHaveLength(5);
  });
});

/**
 * (R17, JD AI 처리 제거) AI-01 is gone — its prompt name is never reused.
 * `common.v4` → `common.v5` (REQ-1 dropped from the alias examples), so every
 * stored string moves. AI-02 v5 → v6 (raw sentences, one-call stage 1, M-n),
 * AI-04 generate/adjust v6 → v7 and extract/reply v1 → v2 (shared data rules:
 * no REQ-n, no requirement_refs, no no_requirements notice), AI-12 v7 → v8
 * (<gate_requirements> removed). AI-13 keeps its call versions.
 */
describe("prompt versions (R17)", () => {
  it("bumps the common suffix", () => {
    expect(COMMON_PROMPT_VERSION).toBe("common.v5");
  });

  it.each<[string, string, string]>([
    ["AI-02 match", AI02_MATCH_PROMPT_VERSION, "ai-02.match.v6+common.v5"],
    ["AI-02 synthesize", AI02_SYNTHESIZE_PROMPT_VERSION, "ai-02.synthesize.v6+common.v5"],
    ["AI-02 stored", AI02_PROMPT_VERSION, "ai-02.match.v6+ai-02.synthesize.v6+common.v5"],
    ["AI-04 generate", AI04_PROMPT_VERSION, "ai-04.generate.v7+common.v5"],
    ["AI-04 adjust", AI04_ADJUST_PROMPT_VERSION, "ai-04.adjust.v7+common.v5"],
    ["AI-04 extract", AI04_EXTRACT_PROMPT_VERSION, "ai-04.extract.v2+common.v5"],
    ["AI-04 reply", AI04_REPLY_PROMPT_VERSION, "ai-04.reply.v2+common.v5"],
    ["AI-12 extract", AI12_EXTRACT_PROMPT_VERSION, "ai-12.extract.v8+common.v5"],
    ["AI-12 reply", AI12_REPLY_PROMPT_VERSION, "ai-12.reply.v8+common.v5"],
  ])("%s is bumped", (_, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it.each<[string, string, string]>([
    ["AI-13 extract", AI13_EXTRACT_PROMPT_VERSION, "ai-13.extract.v3+common.v5"],
    ["AI-13 reply", AI13_REPLY_PROMPT_VERSION, "ai-13.reply.v3+common.v5"],
    ["AI-13 compose", AI13_COMPOSE_PROMPT_VERSION, "ai-13.compose.v2+common.v5"],
  ])("%s keeps its call version (only the common suffix moves)", (_, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it("never reuses the ai-01 / ai-03 / ai-11 prompt names (CF-1, R17)", () => {
    for (const v of [
      AI02_PROMPT_VERSION,
      AI04_PROMPT_VERSION,
      AI04_ADJUST_PROMPT_VERSION,
      AI04_EXTRACT_PROMPT_VERSION,
      AI04_REPLY_PROMPT_VERSION,
      AI12_EXTRACT_PROMPT_VERSION,
      AI12_REPLY_PROMPT_VERSION,
    ]) {
      expect(v).not.toMatch(/ai-(01|03|11)\./);
    }
  });
});

/** (R17) No prompt names a JD requirement alias or the removed blocks. */
describe("prompt text carries no AI-01 requirement artifact (R17)", () => {
  it.each<[string, string]>([
    ["common", COMMON_SYSTEM_PROMPT],
    ["AI-02", AI02_SYSTEM],
    ["AI-04", AI04_SYSTEM],
    ["AI-04 extract", AI04_EXTRACT_SYSTEM],
    ["AI-04 reply", AI04_REPLY_SYSTEM],
    ["AI-12 extract", AI12_EXTRACT_SYSTEM],
    ["AI-12 reply", AI12_REPLY_SYSTEM],
  ])("%s", (_, system) => {
    expect(system).not.toMatch(/REQ-?\d|REQ 번호|gate_requirements|other_sids|seniority/);
  });

  it("AI-04 has no requirement_refs field any more; AI-02 refs point at M-n", () => {
    for (const system of [AI04_SYSTEM, AI04_EXTRACT_SYSTEM, AI04_REPLY_SYSTEM]) expect(system).not.toContain("requirement_refs");
    expect(AI02_SYSTEM).toContain("requirement_refs에 관련 M 번호");
  });
});
