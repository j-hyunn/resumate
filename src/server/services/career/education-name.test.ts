import { describe, expect, it } from "vitest";
import { educationDisplayName } from "./education-name";

describe("educationDisplayName (UI32-1)", () => {
  it("uses program_name when present", () => {
    expect(educationDisplayName("데이터 분석 부트캠프", "가상대학교")).toBe("데이터 분석 부트캠프");
  });

  it("trims the chosen value", () => {
    expect(educationDisplayName("  컴퓨터공학  ", "가상대학교")).toBe("컴퓨터공학");
    expect(educationDisplayName(null, "  가상대학교 ")).toBe("가상대학교");
  });

  it("falls back to institution_name when program_name is null, empty, or blank", () => {
    expect(educationDisplayName(null, "가상대학교")).toBe("가상대학교");
    expect(educationDisplayName(undefined, "가상대학교")).toBe("가상대학교");
    expect(educationDisplayName("", "가상대학교")).toBe("가상대학교");
    expect(educationDisplayName("   ", "가상대학교")).toBe("가상대학교");
  });

  it("returns null when both are empty", () => {
    expect(educationDisplayName(null, null)).toBeNull();
    expect(educationDisplayName(" ", "")).toBeNull();
    expect(educationDisplayName(undefined, undefined)).toBeNull();
  });
});
