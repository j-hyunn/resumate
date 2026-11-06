"use client"

/**
 * S-24 미저장 확인의 연결부 (UX v5.17 S-24 ①, design-system 5.11 "미저장 확인"). 계정 탭 "내 정보"가
 * guard를 등록하고, 설정 다이얼로그가 닫기 · 탭 전환 · [회원 탈퇴] 전에 `runGuarded`로 묻는다.
 * 선택 동의 토글·AI 연결은 각자 즉시 저장이라 guard를 등록하지 않는다.
 */
import * as React from "react"

export interface SettingsGuard {
  /** 마지막 저장값(조회 또는 저장 응답) 대비 바뀐 값이 있는가 */
  isDirty: () => boolean
  /** "저장하고 닫기": 저장 성공이면 true. 검증 오류·실패면 false (폼이 첫 오류 칸·실패 줄로 포커스) */
  save: () => Promise<boolean>
  /** "저장하지 않고 닫기": 폼을 마지막 저장값으로 되돌린다 */
  discard: () => void
}

export interface SettingsGuardContextValue {
  register: (guard: SettingsGuard | null) => void
  /** dirty면 확인 창을 띄우고, 아니면 바로 `action`을 실행한다 */
  runGuarded: (action: () => void) => void
}

export const SettingsGuardContext = React.createContext<SettingsGuardContextValue | null>(null)

/** Registers `guard` while the calling component is mounted (latest closure via ref). */
export function useSettingsGuard(guard: SettingsGuard): void {
  const ctx = React.useContext(SettingsGuardContext)
  const ref = React.useRef(guard)
  React.useEffect(() => {
    ref.current = guard
  })
  React.useEffect(() => {
    if (!ctx) return
    ctx.register({
      isDirty: () => ref.current.isDirty(),
      save: () => ref.current.save(),
      discard: () => ref.current.discard(),
    })
    return () => ctx.register(null)
  }, [ctx])
}

/** `run(action)` — goes through the unsaved-changes confirm when inside the settings dialog. */
export function useGuardedAction(): (action: () => void) => void {
  const ctx = React.useContext(SettingsGuardContext)
  return React.useCallback((action: () => void) => (ctx ? ctx.runGuarded(action) : action()), [ctx])
}
