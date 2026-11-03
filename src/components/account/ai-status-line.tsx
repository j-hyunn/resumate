"use client"

/**
 * S-24 계정 섹션의 "AI 연결" 한 줄 (02 S-24 v5, design-system 6 A1, UQ-201):
 * "연결 안 됨" 또는 C-19 배지 + "••••1a2b". 다이얼로그에서는 섹션을 바꾸고, /settings 페이지에서는 S-40으로 간다.
 * Outside <Suspense> in the dialog → no `?state=` reads.
 */
import * as React from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import type { AiProviderKeyPublic, AiProviderName } from "@/types/db"
import { getAiConnectionOverviewAction } from "@/lib/data/actions"
import { routes } from "@/lib/routes"
import { useAiConnectionBase } from "@/components/common/ai-connection-context"
import { useSettingsDialog } from "@/components/common/shell/settings-dialog"
import { connectionStatusText } from "@/components/common/provider-badge"
import { KeyMask, StaticConnectionBadge } from "./provider-card"
import { Item } from "@/components/ui/item"

export function AiStatusLine({ inDialog }: { inDialog: boolean }) {
  const { openSettings } = useSettingsDialog()
  // re-fetch when the shell's connection value changes (notifyAiConnectionChanged)
  const connection = useAiConnectionBase()
  const [active, setActive] = React.useState<{ provider: AiProviderName; key: AiProviderKeyPublic } | null | undefined>(undefined)

  React.useEffect(() => {
    let alive = true
    void getAiConnectionOverviewAction()
      .then((o) => {
        const card = o.providers.find((p) => p.is_active && p.key)
        if (alive) setActive(card?.key ? { provider: card.info.provider, key: card.key } : null)
      })
      .catch(() => alive && setActive(null))
    return () => {
      alive = false
    }
  }, [connection?.active_provider, connection?.key_status, connection?.connection_tier])

  // v5.3 R-67: 활성 공급자·등급의 동의가 필요하면 동의 필요형 배지 (G-33)
  const consent =
    !!active && connection?.consent_required === true && connection.active_provider === active.provider

  const content =
    active === undefined ? (
      <span className="text-muted-foreground">불러오는 중</span>
    ) : active ? (
      <span className="flex flex-wrap items-center gap-2">
        <StaticConnectionBadge
          provider={active.provider}
          tier={active.key.connection_tier}
          status={active.key.status}
          consent={consent}
        />
        <span className="text-sm tabular-nums">
          <KeyMask last4={active.key.key_last4} />
        </span>
      </span>
    ) : (
      <span>연결 안 됨</span>
    )

  // UQ-266: 접근 이름에 상태를 넣는다 (C-19 배지와 같은 방식)
  const statusText =
    active === undefined
      ? "불러오는 중"
      : active
        ? `${connectionStatusText({ active_provider: active.provider, connection_tier: active.key.connection_tier, key_status: active.key.status, consent_required: consent })}, 키 끝자리 ${active.key.key_last4}`
        : "연결 안 됨"
  const label = `AI 연결: ${statusText}. AI 연결 설정 열기`

  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:items-center sm:gap-3">
      <span className="text-sm leading-5 font-medium text-muted-foreground">AI 연결</span>
      {inDialog ? (
        <Item size="sm" className="-mx-2 w-auto justify-between" onClick={() => openSettings("ai-connection")} aria-label={label}>
          {content}
          <ChevronRight aria-hidden />
        </Item>
      ) : (
        <Item asChild size="sm" className="-mx-2 w-auto justify-between">
          <Link href={routes.aiConnection()} aria-label={label}>
            {content}
            <ChevronRight aria-hidden />
          </Link>
        </Item>
      )}
    </div>
  )
}
