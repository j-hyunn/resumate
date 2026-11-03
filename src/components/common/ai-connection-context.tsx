"use client"

/**
 * Client access to `get_data_readiness().ai_connection` (v4 BYOK) for C-18 / C-19 / NavAiStatus /
 * AiRunButton. The dashboard layout mounts <AiConnectionProvider>; components may also take an
 * explicit `connection` prop (server-loaded) which wins over the context.
 *
 * `?state=ai-locked | key-invalid | key-check | consent-required` overrides the value in development
 * (preview switch). After agreeing in C-21 the consent-required preview is lifted for this page
 * session (markPreviewConsentGiven), so the run continues like it would with real data.
 * After any key change call `notifyAiConnectionChanged()` so every consumer refetches.
 */
import * as React from "react"
import type { AiConnection } from "@/types/db"
import { getAiConnectionStateAction } from "@/lib/data/actions"
import { routes } from "@/lib/routes"
import { usePreviewState } from "./preview-state-client"

const EVENT = "resumate:ai-connection-changed"

export function notifyAiConnectionChanged(): void {
  window.dispatchEvent(new Event(EVENT))
}

/**
 * Provider × tier pairs agreed to in C-21 during this page session. Server-loaded `connection`
 * props may still say `consent_required: true` until the next refresh; this keeps a run from
 * reopening C-21 right after the user agreed (and lifts the `?state=consent-required` preview).
 */
const consentGiven = new Set<string>()
export function markConsentGiven(provider: string, tier: string): void {
  consentGiven.add(`${provider}:${tier}`)
  notifyAiConnectionChanged()
}
function withSessionConsent(c: AiConnection | null): AiConnection | null {
  if (!c?.consent_required || !c.active_provider) return c
  return consentGiven.has(`${c.active_provider}:${c.connection_tier}`) ? { ...c, consent_required: false } : c
}

interface AiConnectionContextValue {
  connection: AiConnection | null
  /** any saved key (C-18 destination: none → S-41 공급자 선택, else S-40) */
  hasAnyKey: boolean
  refresh: () => Promise<void>
}

const AiConnectionContext = React.createContext<AiConnectionContextValue | null>(null)

const noopSubscribe = () => () => {}

/**
 * Context value as the server rendered it (no connection, no keys) until this component has
 * hydrated. Suspense boundaries that stream in later (the shell sidebar) can hydrate after the
 * provider's first fetch resolved; reading the live value there would mismatch the server HTML.
 */
function useHydratedContext(): AiConnectionContextValue | null {
  const ctx = React.useContext(AiConnectionContext)
  const hydrated = React.useSyncExternalStore(noopSubscribe, () => true, () => false)
  return hydrated || !ctx ? ctx : { ...ctx, connection: null, hasAnyKey: false }
}

export function AiConnectionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{ connection: AiConnection | null; hasAnyKey: boolean; tick: number }>({
    connection: null,
    hasAnyKey: false,
    tick: 0,
  })
  const refresh = React.useCallback(async () => {
    const s = await getAiConnectionStateAction()
    setState((prev) => ({ connection: s.connection, hasAnyKey: s.has_any_key, tick: prev.tick + 1 }))
  }, [])
  React.useEffect(() => {
    let alive = true
    const load = async () => {
      const s = await getAiConnectionStateAction()
      if (alive) setState((prev) => ({ connection: s.connection, hasAnyKey: s.has_any_key, tick: prev.tick + 1 }))
    }
    void load()
    window.addEventListener(EVENT, load)
    return () => {
      alive = false
      window.removeEventListener(EVENT, load)
    }
  }, [])
  const value = React.useMemo(() => ({ ...state, refresh }), [state, refresh])
  return <AiConnectionContext.Provider value={value}>{children}</AiConnectionContext.Provider>
}

/** Apply the dev `?state=` override (same rules as lib/data/ai-connection previewAiConnection) */
export function applyConnectionPreview(base: AiConnection | null, state: string | null): AiConnection | null {
  if (state === "ai-locked") return { active_provider: null, key_status: null, connection_tier: null, consent_required: null }
  const provider = base?.active_provider ?? "gemini"
  const tier = base?.connection_tier ?? "free"
  if (state === "key-invalid" || state === "key-check") {
    return {
      active_provider: provider,
      key_status: state === "key-invalid" ? "invalid" : "needs_check",
      connection_tier: tier,
      consent_required: false,
    }
  }
  if (state === "consent-required")
    return withSessionConsent({ active_provider: provider, key_status: base?.key_status ?? "valid", connection_tier: tier, consent_required: true })
  return withSessionConsent(base)
}

/** `?state=` values that override ai_connection */
export const CONNECTION_PREVIEW_STATES = ["ai-locked", "key-invalid", "key-check", "consent-required"] as const

/**
 * Current AI connection: explicit prop → context (with ?state= override). `null` while the first
 * fetch is in flight (render the unlocked look; the server re-checks on run).
 * Components using it must sit under <Suspense> (reads ?state=).
 */
export function useAiConnection(explicit?: AiConnection | null): AiConnection | null {
  const ctx = useHydratedContext()
  const state = usePreviewState()
  return applyConnectionPreview(explicit ?? ctx?.connection ?? null, state)
}

/** Context value without the `?state=` override — for components outside <Suspense> (settings dialog). */
export function useAiConnectionBase(): AiConnection | null {
  return React.useContext(AiConnectionContext)?.connection ?? null
}

/** True once the provider has loaded (or an explicit value was given) */
export function useAiConnectionLoaded(explicit?: AiConnection | null): boolean {
  const ctx = useHydratedContext()
  const state = usePreviewState()
  return explicit != null || ctx?.connection != null || (CONNECTION_PREVIEW_STATES as readonly string[]).includes(state ?? "")
}

/**
 * Re-read readiness().ai_connection now (C-20 key_missing: "먼저 readiness를 다시 읽는다").
 * Returns `[refreshing, refresh, fresh]`. `startPending` makes the very first render already
 * "refreshing" (no wrong action flashes before the effect runs, UQ-403). Outside the provider the
 * value is fetched directly and returned as `fresh`.
 */
export function useAiConnectionRefresh(startPending = false): [boolean, () => void, AiConnection | null] {
  const ctx = React.useContext(AiConnectionContext)
  const [pending, setPending] = React.useState(startPending)
  const [fresh, setFresh] = React.useState<AiConnection | null>(null)
  const refresh = React.useCallback(() => {
    setPending(true)
    const run = ctx ? ctx.refresh() : getAiConnectionStateAction().then((s) => setFresh(s.connection))
    void run.finally(() => setPending(false))
  }, [ctx])
  return [pending, refresh, fresh]
}

/**
 * C-18 "AI 연결하기" destination (3.18): no saved key → S-41 공급자 선택, else S-40.
 * `?state=ai-locked` previews treat the account as having no keys.
 */
export function useAiConnectHref(): string {
  const ctx = useHydratedContext()
  const state = usePreviewState()
  const hasKey = state === "ai-locked" ? false : (ctx?.hasAnyKey ?? false)
  return hasKey ? routes.aiConnection() : routes.aiConnect()
}
