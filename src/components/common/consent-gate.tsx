"use client"

/**
 * C-18 `consent_required` gate (02 C-18 R-67, design-system 3.18 / 3.21): before **any** AI run —
 * new job, same-row retry, request-scoped work (requirement extraction, documents), writing-chat
 * turn — when the active provider × tier needs (re)consent, the request is held and C-21 opens for
 * the active provider and tier. Agreeing re-reads the connection and continues the held run (the
 * user's own click, not an auto-run). Closing sends nothing.
 *
 *   const consent = useAiConsentGate()
 *   <Button onClick={() => consent.guard(send)}>보내기</Button>
 *   {consent.dialog}
 *
 *   consent.open(retry)   // retry refusal ai_consent_required / C-20 key_missing consent cause
 *
 * AiRunButton and AiErrorNotice use it internally; screens with their own run buttons (S-36 보내기,
 * 요건 정리하기 …) use the hook directly.
 */
import * as React from "react"
import type { AiConnection } from "@/types/db"
import { useAiConnection } from "./ai-connection-context"
import { DataUseConsentDialog } from "./data-use-consent"

export interface AiConsentGate {
  /** the active provider × tier needs consent now */
  required: boolean
  /** run now, or hold it and open C-21 when consent is required. Returns true when it ran. */
  guard: (run: () => void) => boolean
  /** open C-21 regardless of the cached flag (server said consent is needed); `then` runs after agreeing */
  open: (then?: () => void) => void
  /** render once near the trigger */
  dialog: React.ReactNode
}

export function useAiConsentGate(explicit?: AiConnection | null, opts?: { confirmLabel?: string }): AiConsentGate {
  const connection = useAiConnection(explicit)
  const [isOpen, setOpen] = React.useState(false)
  const held = React.useRef<(() => void) | null>(null)
  const required = Boolean(connection?.active_provider && connection.key_status !== "invalid" && connection.consent_required)

  const guard = React.useCallback(
    (run: () => void) => {
      if (required) {
        held.current = run
        setOpen(true)
        return false
      }
      run()
      return true
    },
    [required],
  )
  const open = React.useCallback((then?: () => void) => {
    held.current = then ?? null
    setOpen(true)
  }, [])

  const provider = connection?.active_provider ?? null
  const tier = connection?.connection_tier ?? "paid"
  const dialog = provider ? (
    <DataUseConsentDialog
      open={isOpen}
      // closing keeps nothing running; a later guard() / open() replaces the held run
      onOpenChange={setOpen}
      provider={provider}
      tier={tier}
      confirmLabel={opts?.confirmLabel}
      onConsented={() => {
        const run = held.current
        held.current = null
        run?.()
      }}
    />
  ) : null

  return { required, guard, open, dialog }
}
