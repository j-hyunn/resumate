import { describe, expect, it, vi } from "vitest";
import { isTrustedPreviewMarker, previewMarkerValue } from "./preview-marker";

describe("preview marker (QA-W5-03)", () => {
  it("is a per-process secret: stable within the process, never '1'", () => {
    expect(previewMarkerValue()).toBe(previewMarkerValue());
    expect(previewMarkerValue().length).toBeGreaterThanOrEqual(40);
    expect(isTrustedPreviewMarker(previewMarkerValue())).toBe(true);
  });

  it("rejects anything else a client could send", () => {
    for (const v of [null, undefined, "", "1", "true", previewMarkerValue().toUpperCase(), previewMarkerValue().slice(0, -1)]) {
      expect(isTrustedPreviewMarker(v)).toBe(v === previewMarkerValue());
    }
  });

  it("a fresh module instance (another bundle in the same process) shares the secret via globalThis", async () => {
    const first = previewMarkerValue();
    vi.resetModules();
    const again = await import("./preview-marker");
    expect(again.previewMarkerValue()).toBe(first);
    expect(again.isTrustedPreviewMarker(first)).toBe(true);
  });
});
