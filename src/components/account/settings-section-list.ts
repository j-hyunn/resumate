/**
 * S-24 설정 다이얼로그 탭 목록 (UX v5.17 S-24 SD-A1, design-system 5.11). Plain module (not "use client")
 * so routes.ts and the client dialog can both read it.
 *
 * 탭 4개(순서 고정): 계정 · AI 연결 · 약관 · 개선 요청. v5.10까지의 섹션 ID는 URL·링크 호환으로만 받는다
 * (`resolveSettingsSection`): withdraw → 계정(위험 구역), ai-usage → AI 연결(사용량 블록), consents · ai-data → 약관.
 */
export type SettingsTabId = "account" | "ai-connection" | "policies" | "feedback"

/** v5.10 섹션 ID — `?settings=` 로 들어오면 아래 표대로 바꿔 연다 (design-system 5.11 호환표). */
export type LegacySettingsSectionId = "ai-usage" | "consents" | "ai-data" | "withdraw"

export interface SettingsTab {
  id: SettingsTabId
  label: string
}

export const SETTINGS_TABS: ReadonlyArray<SettingsTab> = [
  // v5.12: 탭은 글자만 (원본 화면) — 아이콘 없음
  { id: "account", label: "계정" },
  { id: "ai-connection", label: "AI 연결" },
  { id: "policies", label: "약관" },
  { id: "feedback", label: "개선 요청" },
]

/** Scroll anchors inside a tab body (5.11). */
export const SETTINGS_ANCHORS = {
  dangerZone: "settings-danger-zone",
  aiUsage: "settings-ai-usage",
} as const

const TAB_IDS = new Set<string>(SETTINGS_TABS.map((t) => t.id))

const LEGACY: Record<LegacySettingsSectionId, { tab: SettingsTabId; anchor?: string }> = {
  withdraw: { tab: "account", anchor: SETTINGS_ANCHORS.dangerZone },
  "ai-usage": { tab: "ai-connection", anchor: SETTINGS_ANCHORS.aiUsage },
  consents: { tab: "policies" },
  "ai-data": { tab: "policies" },
}

export function isSettingsTabId(value: unknown): value is SettingsTabId {
  return typeof value === "string" && TAB_IDS.has(value)
}

/** `?settings=` value → tab (+ scroll anchor). Anything unknown opens 계정 (5.11). */
export function resolveSettingsSection(value: string | null | undefined): { tab: SettingsTabId; anchor?: string } {
  if (isSettingsTabId(value)) return { tab: value }
  if (value && value in LEGACY) return LEGACY[value as LegacySettingsSectionId]
  return { tab: "account" }
}
