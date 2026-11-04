"use client"

/**
 * C-18 / C-20 "AI 연결하기" link (3.18): no saved key → S-41 공급자 선택 (`/settings/ai/connect`),
 * else the settings dialog's "AI 연결" section (S-40). Reads `?state=` (useHasAnyAiKey) → sits under
 * <Suspense> like its callers.
 */
import Link from "next/link"
import { routes } from "@/lib/routes"
import { useHasAnyAiKey } from "./ai-connection-context"
import { SettingsLink } from "./shell/settings-dialog"

export function AiConnectLink(props: Omit<React.ComponentProps<typeof Link>, "href">) {
  const hasKey = useHasAnyAiKey()
  return hasKey ? <SettingsLink section="ai-connection" {...props} /> : <Link href={routes.aiConnect()} {...props} />
}
