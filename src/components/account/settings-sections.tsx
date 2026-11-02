"use client"

/**
 * S-24 설정 sections, shared by the settings dialog (L-01 사이드바 → shadcn sidebar-13 dialog)
 * and the /settings page. 02 명세는 "v3와 같음"(v3 없음) → 매트릭스의 기능(동의 관리·AI 학습
 * 미사용 안내·탈퇴 진입)과 S-04 진입점으로 구성 [UI-가정]. v5: 계정에 "AI 연결" 한 줄, "AI 연결"·"AI 사용량"
 * 섹션(S-40 / S-42 내용 컴포넌트), AI 데이터 처리에 F-COM-03 v4 문구 + 고지 다시 보기(UQ-201).
 * `onNavigate` given = inside the dialog.
 */
import Link from "next/link"
import { ChevronRight, Monitor, Moon, ShieldCheck, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useTheme, type ThemePreference } from "@/components/common/theme"
import type { ConsentStatus } from "@/lib/data/account"
import { routes } from "@/lib/routes"
import { AiConnectionPanel } from "./ai-connection-panel"
import { AiUsagePanel } from "./ai-usage-panel"
import { ConsentSettings } from "./consent-settings"
import { SignOutButton } from "./sign-out-button"
import { AiStatusLine } from "./ai-status-line"
import { AI_TRAINING_NOTICE, CROSS_BORDER_ITEMS, POLICY_TYPES, POLICY_TYPE_LABELS } from "./policy-content"
import { useSettingsDialog } from "@/components/common/shell/settings-dialog"
import type { SettingsSectionId } from "./settings-section-list"

export interface SettingsData {
  email: string
  statuses: ConsentStatus[]
}

/**
 * Body of one section (no card/heading — the page wraps it in a Card, the dialog under its
 * breadcrumb). `onNavigate` closes the dialog when a link leaves it.
 */
export function SettingsSectionBody({
  section,
  data,
  failSave = false,
  onNavigate,
}: {
  section: SettingsSectionId
  data: SettingsData
  failSave?: boolean
  onNavigate?: () => void
}) {
  switch (section) {
    case "account":
      return (
        <div className="space-y-4">
          <dl className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-3">
            <dt className="text-sm leading-5 font-medium text-muted-foreground">이메일</dt>
            <dd className="text-base break-all">{data.email}</dd>
          </dl>
          <AiStatusLine inDialog={!!onNavigate} />
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={routes.profile()} onClick={onNavigate}>
                기본 프로필 편집
                <ChevronRight aria-hidden />
              </Link>
            </Button>
            <SignOutButton />
          </div>
        </div>
      )
    case "ai-connection":
      return <AiConnectionPanel variant={onNavigate ? "section" : "page"} onNavigate={onNavigate} />
    case "ai-usage":
      return <AiUsagePanel variant={onNavigate ? "section" : "page"} onNavigate={onNavigate} />
    case "appearance":
      return <ThemeSetting />
    case "consents":
      return <ConsentSettings statuses={data.statuses} failSave={failSave} />
    case "ai-data":
      return (
        <div className="space-y-3 text-base leading-[1.6]">
          <p className="flex items-start gap-2 font-medium">
            <ShieldCheck className="mt-1 size-4 shrink-0 text-success" aria-hidden />
            {AI_TRAINING_NOTICE}.
          </p>
          <DisclosureLink inDialog={!!onNavigate} />
          <div className="space-y-1">
            <p>AI 키를 연결하고 AI 기능을 실행하면 아래 내용이 연결한 AI 공급자(국외)에게 전송돼요.</p>
            <ul className="list-disc space-y-0.5 pl-5 text-sm leading-5 text-muted-foreground">
              {CROSS_BORDER_ITEMS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      )
    case "policies":
      return (
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {POLICY_TYPES.map((t) => (
            <li key={t}>
              <Link
                href={routes.policies(t)}
                onClick={onNavigate}
                className="text-base underline underline-offset-4 hover:text-foreground max-md:inline-flex max-md:min-h-11 max-md:items-center"
              >
                {POLICY_TYPE_LABELS[t]}
              </Link>
            </li>
          ))}
        </ul>
      )
    case "withdraw":
      return (
        <Button asChild variant="outline">
          <Link href={routes.withdraw()} onClick={onNavigate}>
            회원 탈퇴
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      )
  }
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  { value: "system", label: "시스템 설정", icon: <Monitor aria-hidden /> },
  { value: "light", label: "라이트", icon: <Sun aria-hidden /> },
  { value: "dark", label: "다크", icon: <Moon aria-hidden /> },
]

/** 화면 모드 (Q-2). "시스템 설정" follows the OS light/dark setting. */
function ThemeSetting() {
  const { theme, setTheme } = useTheme()
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={0}
      value={theme}
      onValueChange={(v) => {
        // radix sends "" when the pressed item is clicked again — keep the current choice
        if (v) setTheme(v as ThemePreference)
      }}
      aria-label="화면 모드"
    >
      {THEME_OPTIONS.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="h-10 gap-2 px-3 text-base">
          {o.icon}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** "데이터 사용 고지 다시 보기" (02 S-24 v5 "S-40 고지 다시 보기 링크", UQ-201) → AI 연결 섹션 / S-40 */
function DisclosureLink({ inDialog }: { inDialog: boolean }) {
  const { openSettings } = useSettingsDialog()
  // [UI-가정] 공급자별 고지는 S-40 카드 메뉴 "데이터 사용 고지 다시 보기"에서 읽기 전용으로 연다
  return inDialog ? (
    <Button variant="link" size="sm" className="h-auto px-0 text-base" onClick={() => openSettings("ai-connection")}>
      연결한 공급자의 데이터 사용 고지 다시 보기
      <ChevronRight aria-hidden />
    </Button>
  ) : (
    <Button variant="link" size="sm" className="h-auto px-0 text-base" asChild>
      <Link href={routes.aiConnection()}>
        연결한 공급자의 데이터 사용 고지 다시 보기
        <ChevronRight aria-hidden />
      </Link>
    </Button>
  )
}
