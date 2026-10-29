import { describe, expect, it } from "vitest";
import {
  applicationDisplayName,
  CreateApplicationProjectInput,
  jdInputWarnings,
  JD_LONG_WARNING_CHARS,
  MoveApplicationStageInput,
  SetApplicationOutcomeInput,
  UpdateApplicationProjectInput,
} from "./application";

const ID = "00000000-0000-4000-8000-0000000000a1";

describe("S5 application contracts", () => {
  it("create: raw text required (not blank, ≤ 50,000); empty optional fields become undefined", () => {
    expect(CreateApplicationProjectInput.safeParse({ id: ID, rawText: "   " }).success).toBe(false);
    expect(CreateApplicationProjectInput.safeParse({ id: ID, rawText: "a".repeat(50_001) }).success).toBe(false);
    const ok = CreateApplicationProjectInput.parse({ id: ID, rawText: " 공고 ", companyName: " ", name: "", deadline: "" });
    expect(ok).toEqual({ id: ID, rawText: " 공고 " });
    expect(CreateApplicationProjectInput.safeParse({ id: ID, rawText: "x", deadline: "2026-13-01" }).success).toBe(false);
    expect(CreateApplicationProjectInput.safeParse({ id: ID, rawText: "x", name: "a".repeat(101) }).success).toBe(false);
  });

  it("warnings: short < 200, long > 24,000 (never blocking)", () => {
    expect(jdInputWarnings("짧음")).toEqual(["short_jd"]);
    expect(jdInputWarnings("a".repeat(500))).toEqual([]);
    expect(jdInputWarnings("a".repeat(JD_LONG_WARNING_CHARS + 1))).toEqual(["long_jd"]);
  });

  it("update: empty name refused, nothing-to-update refused, blank memo → null", () => {
    expect(UpdateApplicationProjectInput.safeParse({ id: ID, name: "  " }).success).toBe(false);
    expect(UpdateApplicationProjectInput.safeParse({ id: ID }).success).toBe(false);
    expect(UpdateApplicationProjectInput.parse({ id: ID, memo: "  " }).memo).toBeNull();
    expect(UpdateApplicationProjectInput.safeParse({ id: ID, memo: "a".repeat(2001) }).success).toBe(false);
  });

  it("stage / outcome inputs", () => {
    expect(MoveApplicationStageInput.safeParse({ id: ID, toStage: "offer" }).success).toBe(false);
    expect(MoveApplicationStageInput.safeParse({ id: ID, toStage: "closed", outcome: "passed" }).success).toBe(true);
    expect(SetApplicationOutcomeInput.safeParse({ id: ID, outcome: null }).success).toBe(true);
    expect(SetApplicationOutcomeInput.safeParse({ id: ID, outcome: "withdrawn" }).success).toBe(false);
  });

  it("display name: name → 회사명 – 포지션명 → 새 기업 JD", () => {
    expect(applicationDisplayName("내 이름", "A", "B")).toBe("내 이름");
    expect(applicationDisplayName(null, "A", "B")).toBe("A – B");
    expect(applicationDisplayName(null, "A", null)).toBe("새 기업 JD");
  });
});
