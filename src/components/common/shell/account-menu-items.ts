/**
 * 계정 메뉴 항목 (UX 1.3 L-01 메뉴 하단 / 1.3a L-02 상단 바 오른쪽): 기본 프로필 · 설정 · AI 연결 · 처리방침 ·
 * 로그아웃, this order. Shared so both shells can list the same items (design-system 5.8).
 * // [UI-가정] L-01 NavUser still shows 설정 · 로그아웃 only (leader Q-10: L-01 unchanged this run).
 */
import { routes } from "@/lib/routes"

export type AccountMenuItem =
  | { key: "profile" | "settings" | "ai" | "policies"; label: string; href: string }
  | { key: "sign_out"; label: string }

export const ACCOUNT_MENU_ITEMS: readonly AccountMenuItem[] = [
  { key: "profile", label: "기본 프로필", href: routes.profile() },
  { key: "settings", label: "설정", href: routes.settings() },
  { key: "ai", label: "AI 연결", href: routes.aiConnection() },
  { key: "policies", label: "처리방침", href: routes.policies() },
  { key: "sign_out", label: "로그아웃" },
]
