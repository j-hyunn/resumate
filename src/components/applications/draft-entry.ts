/**
 * S-17 "새 경력기술서" 진입 단계 (Q53-4, FL-03 요건 없는 JD). Pure, so the rule can be tested alone.
 *
 * Decided once when the panel mounts and only ever goes entry_step → settings. The facts that fed the
 * decision change on the way (동의, 키 교체, 키 연결); re-deriving from them would bring the step back
 * over a settings screen the user is already on (UQ-600).
 */
export type DraftEntry = "entry_step" | "settings"

export interface DraftEntryFacts {
  /** the JD has no requirements yet: "새 경력기술서" is what allows the extraction (D-30) */
  extractFirst: boolean
  /** Q53-7 `composing` restore */
  resumed: boolean
  /** 동의 필요 · 키 무효: nothing runs until "AI에게 맡기기" is pressed */
  gateBlocked: boolean
  /** no key: 직접 고르기 */
  locked: boolean
}

export function initialDraftEntry(f: DraftEntryFacts): DraftEntry {
  return f.extractFirst && !f.resumed && !f.gateBlocked && !f.locked ? "entry_step" : "settings"
}

/** Any run through the settings or the step: one-way */
export function markDraftEntered(): DraftEntry {
  return "settings"
}
