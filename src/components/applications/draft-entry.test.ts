import { describe, expect, it } from "vitest"
import { initialDraftEntry, markDraftEntered, type DraftEntryFacts } from "./draft-entry"

/**
 * S-17 "새 경력기술서" target (Q53 남은 것, QA 17 B-1). The specs settle which JD shows it:
 * - FL-03 / Q53-4 (확정 2026-10-30): on a JD **without requirements** the press is what allows the
 *   extraction (D-30) → extraction → settings with AI-11 once.
 * - A JD with requirements goes straight to the settings (FL-03 JR → C) with AI-11 on entry (03 AI-11).
 * - 동의 필요·키 무효: settings first, nothing runs until "AI에게 맡기기" (Q53-4).
 * - no key: settings with 직접 고르기, generation is the C-18 lock (FL-03 "키 필요").
 * - `composing` restore (Q53-7): "새 경력기술서" restores the stopped settings, no step.
 */
const base: DraftEntryFacts = { extractFirst: false, resumed: false, gateBlocked: false, locked: false }

describe("initialDraftEntry (S-17 새 경력기술서)", () => {
  it("shows the step only on a JD without requirements", () => {
    expect(initialDraftEntry({ ...base, extractFirst: true })).toBe("entry_step")
    expect(initialDraftEntry(base)).toBe("settings")
  })

  it("never shows the step when a gate, a missing key or a restore applies", () => {
    expect(initialDraftEntry({ ...base, extractFirst: true, gateBlocked: true })).toBe("settings")
    expect(initialDraftEntry({ ...base, extractFirst: true, locked: true })).toBe("settings")
    expect(initialDraftEntry({ ...base, extractFirst: true, resumed: true })).toBe("settings")
  })

  it("is one-way once pressed (UQ-600)", () => {
    expect(markDraftEntered()).toBe("settings")
  })
})
