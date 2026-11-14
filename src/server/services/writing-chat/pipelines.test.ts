import { describe, expect, it } from "vitest";
import { insightSignalOf } from "./pipelines";

describe("insightSignalOf (AI-02 result → AI-04 soft signal)", () => {
  it("reads positioning from strategy.positioning, where the stored result keeps it", () => {
    const signal = insightSignalOf({
      strengths: [{ title: "결제 성능 개선", description: "응답 시간 단축" }],
      strategy: { positioning: "결제 도메인 백엔드 경험을 앞세운다", positioning_item_key: "strategy.positioning", project_priorities: [] },
    });
    expect(signal).toEqual({
      strengths: [{ title: "결제 성능 개선", description: "응답 시간 단축" }],
      positioning: "결제 도메인 백엔드 경험을 앞세운다",
    });
  });

  it("returns a positioning-only signal when there are no strengths", () => {
    expect(insightSignalOf({ strengths: [], strategy: { positioning: "포지셔닝" } })).toEqual({ strengths: [], positioning: "포지셔닝" });
  });

  it("treats a blank or null strategy.positioning as absent", () => {
    expect(insightSignalOf({ strengths: [], strategy: { positioning: "  " } })).toBeNull();
    expect(insightSignalOf({ strengths: [], strategy: { positioning: null } })).toBeNull();
  });

  it("falls back to a top-level positioning", () => {
    expect(insightSignalOf({ positioning: "옛 형태" })).toEqual({ strengths: [], positioning: "옛 형태" });
  });

  it("returns null for non-objects", () => {
    expect(insightSignalOf(null)).toBeNull();
    expect(insightSignalOf([])).toBeNull();
  });
});
