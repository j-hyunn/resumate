/**
 * S-24 설정 section list. Plain module (not "use client") so both the /settings server page and
 * the client settings dialog can read the array.
 */
import { FileText, Gauge, PlugZap, ShieldCheck, Sparkles, UserRound, UserX, type LucideIcon } from "lucide-react"

export type SettingsSectionId = "account" | "ai-connection" | "ai-usage" | "consents" | "ai-data" | "policies" | "withdraw"

export interface SettingsSection {
  id: SettingsSectionId
  label: string
  description?: string
  icon: LucideIcon
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "account", label: "계정", icon: UserRound },
  // v2 BYOK (design-system 5.1): right below 계정 [가정]. Content = S-40 / S-42 shared components (A1)
  { id: "ai-connection", label: "AI 연결", icon: PlugZap },
  { id: "ai-usage", label: "AI 사용량", icon: Gauge },
  // 화면 모드 (Q-2) moved to the account menu dark-mode switch (shell/nav-user.tsx)
  {
    id: "consents",
    label: "동의 관리",
    description: "가입할 때 동의한 항목과 날짜예요. 선택 항목은 바로 바꿀 수 있어요.",
    icon: ShieldCheck,
  },
  { id: "ai-data", label: "AI 데이터 처리", icon: Sparkles },
  { id: "policies", label: "처리방침·약관", icon: FileText },
  {
    id: "withdraw",
    label: "회원 탈퇴",
    description: "탈퇴하면 커리어와 기업 JD를 포함한 모든 데이터가 바로 삭제돼요.",
    icon: UserX,
  },
]
