import { describe, expect, it } from "vitest";
import { AI01_PROMPT_VERSION, AI01_SYSTEM } from "./AI-01";
import { AI02_MATCH_PROMPT_VERSION, AI02_PROMPT_VERSION, AI02_SYNTHESIZE_PROMPT_VERSION, AI02_SYSTEM } from "./AI-02";
import { AI03_PROMPT_VERSION, AI03_SYSTEM } from "./AI-03";
import { AI04_ADJUST_PROMPT_VERSION, AI04_PROMPT_VERSION, AI04_SYSTEM } from "./AI-04";
import { AI05_PROMPT_VERSION, AI05_SYSTEM } from "./AI-05";
import { AI06_PROMPT_VERSION, AI06_SYSTEM } from "./AI-06";
import { AI11_PROMPT_VERSION } from "./AI-11";
import { COMMON_PROMPT_VERSION, COMMON_SYSTEM_PROMPT, PROFILE_PREFERENCE_RULE } from "./common";

/** R1 A10 / A11: the rule text is in every V-4 feature's system block and their versions moved (input_hash reuse). */
describe("R1 prompt rules", () => {
  it.each<[string, string]>([
    ["AI-02", AI02_SYSTEM],
    ["AI-03", AI03_SYSTEM],
    ["AI-04", AI04_SYSTEM],
    ["AI-05", AI05_SYSTEM],
    ["AI-06", AI06_SYSTEM],
  ])("%s system says profile wishes are context, not evidence (A10)", (_, system) => {
    expect(system).toContain(PROFILE_PREFERENCE_RULE);
  });

  it("the common block and AI-01 carry no V-4 profile rule (no V-4 judgment there)", () => {
    expect(COMMON_SYSTEM_PROMPT).not.toContain(PROFILE_PREFERENCE_RULE);
    expect(AI01_SYSTEM).not.toContain(PROFILE_PREFERENCE_RULE);
    // R4 (v4.5): the common block changed (aliases, <classification>, <deliverable>) → common.v2 everywhere.
    expect(COMMON_PROMPT_VERSION).toBe("common.v2");
    expect(AI01_PROMPT_VERSION).toBe("ai-01.extract.v1+common.v2");
  });

  it("R4 common block: v4.5 aliases, classification and deliverable rules", () => {
    expect(COMMON_SYSTEM_PROMPT).toContain("DLV-3");
    expect(COMMON_SYSTEM_PROMPT).not.toMatch(/DET-\d|ACH-\d/);
    expect(COMMON_SYSTEM_PROMPT).toContain("<classification>");
    expect(COMMON_SYSTEM_PROMPT).toContain("<deliverable>");
  });

  it("bumped prompt versions", () => {
    expect(AI02_MATCH_PROMPT_VERSION).toBe("ai-02.match.v4+common.v2");
    expect(AI02_SYNTHESIZE_PROMPT_VERSION).toBe("ai-02.synthesize.v4+common.v2");
    expect(AI02_PROMPT_VERSION).toBe("ai-02.match.v4+ai-02.synthesize.v4+common.v2");
    expect(AI03_PROMPT_VERSION).toBe("ai-03.generate.v3+common.v2");
    expect(AI04_PROMPT_VERSION).toBe("ai-04.generate.v3+common.v2");
    expect(AI04_ADJUST_PROMPT_VERSION).toBe("ai-04.adjust.v3+common.v2");
    expect(AI05_PROMPT_VERSION).toBe("ai-05.generate.v3+common.v2");
    expect(AI06_PROMPT_VERSION).toBe("ai-06.evaluate.v3+common.v2");
    expect(AI11_PROMPT_VERSION).toBe("ai-11.rank.v2+common.v2");
  });

  it("AI-05 states the fact-premise rule for every job question kind (A11)", () => {
    expect(AI05_SYSTEM).toContain("모든 직무 질문(project_deep_dive, requirement_fit, gap_probe)");
    expect(AI05_SYSTEM).toContain("사실을 전제하지 않고 묻습니다");
  });
});
