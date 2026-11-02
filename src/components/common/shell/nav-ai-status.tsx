"use client"

/**
 * L-01 AI 연결 상태 한 줄 (NavAiStatus, design-system 5.1, F-AI-09). First NavSecondary item, right
 * above 설정. Opens the settings dialog at "AI 연결". Expanded: icon + C-19 text + status dot;
 * icon rail: icon + corner dot, full text in the tooltip.
 */
import * as React from "react"
import { CircleHelp, PlugZap, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import type { AiConnection } from "@/types/db"
import { AI_PROVIDER_LABELS } from "@/lib/mock/ai-providers"
import { connectionLabel } from "../provider-badge"

export function aiStatusText(c: AiConnection | null): string {
  // [UI-가정] null = not loaded yet (client fetch / prerendered shell) → neutral label, no dot
  if (!c) return "AI 연결"
  if (!c.active_provider) return "AI 연결 안 됨"
  const p = AI_PROVIDER_LABELS[c.active_provider]
  if (c.key_status === "invalid") return `${p} · 키를 확인해 주세요`
  if (c.key_status === "needs_check") return `${p} · 확인 필요`
  return connectionLabel(c)
}

export function NavAiStatus({ connection, onSelect }: { connection: AiConnection | null; onSelect: () => void }) {
  const status = connection?.active_provider ? connection.key_status : null
  const Icon = status === "invalid" ? TriangleAlert : status === "needs_check" ? CircleHelp : PlugZap
  const dot = status === "valid" ? "bg-success" : status === "invalid" || status === "needs_check" ? "bg-warning" : null
  const text = aiStatusText(connection)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        tooltip={`AI 연결: ${text}`}
        className="relative max-lg:h-11"
        onClick={onSelect}
        aria-label={`AI 연결: ${text}. AI 연결 설정 열기`}
      >
        <Icon aria-hidden className={cn(status === "invalid" || status === "needs_check" ? "text-warning" : undefined)} />
        <span className={cn("truncate", connection && !status && "text-muted-foreground")}>{text}</span>
        {dot ? (
          <span
            aria-hidden
            className={cn(
              "ml-auto size-2 shrink-0 rounded-full ring-2 ring-sidebar",
              dot,
              // icon rail: corner dot on the icon
              "group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:top-1.5 group-data-[collapsible=icon]:right-1.5",
            )}
          />
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
