"use client"

/**
 * S-24 동의 관리 (F-COM-02, NFR-PRV-02; 04 A.2). Required consents are read-only (agreed date +
 * version); optional ones toggle immediately: agree = new consents row, withdraw = withdrawn_at.
 * A failed change reverts the checkbox and shows a toast with 다시 시도 (ST-SAVE-FAILED).
 */
import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Check, CircleDashed, Loader2 } from "lucide-react"
import type { ConsentType } from "@/types/db"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { formatDate } from "@/lib/data/labels"
import { setOptionalConsentAction } from "./actions"
import { CONSENT_ITEMS } from "./policy-content"
import type { ConsentStatus } from "@/lib/data/account"
import { routes } from "@/lib/routes"

export function ConsentSettings({ statuses, failSave }: { statuses: ConsentStatus[]; failSave: boolean }) {
  const [state, setState] = React.useState<Record<string, ConsentStatus>>(() =>
    Object.fromEntries(statuses.map((s) => [s.consent_type, s])),
  )
  const [pending, setPending] = React.useState<ConsentType | null>(null)
  const [announce, setAnnounce] = React.useState("")

  async function change(consentType: ConsentType, agree: boolean, label: string) {
    const prev = state[consentType]
    setPending(consentType)
    setState((s) => ({ ...s, [consentType]: { ...prev, active: agree } }))
    const res = await setOptionalConsentAction(consentType, agree, { fail: failSave })
    setPending(null)
    if (!res.ok) {
      setState((s) => ({ ...s, [consentType]: prev }))
      // [UI-가정] failure copy
      toast.error("변경하지 못했어요", {
        description: `${label} 설정이 그대로예요`,
        action: { label: "다시 시도", onClick: () => void change(consentType, agree, label) },
      })
      return
    }
    setState((s) => ({ ...s, [consentType]: res.status }))
    // [UI-가정] success announcement copy
    setAnnounce(agree ? `${label}에 동의했어요` : `${label} 동의를 철회했어요`)
  }

  const required = CONSENT_ITEMS.filter((c) => c.required)
  const optional = CONSENT_ITEMS.filter((c) => !c.required)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-base leading-6 font-semibold">필수 동의</h3>
        <ul className="divide-y rounded-md border">
          {required.map((item) => {
            const s = state[item.consent_type]
            return (
              <li key={item.consent_type} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                {s?.active ? (
                  <Check className="size-4 text-success" aria-hidden />
                ) : (
                  <CircleDashed className="size-4 text-muted-foreground" aria-hidden />
                )}
                <span className="flex-1 text-base">{item.label}</span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {s?.active && s.latest
                    ? `${formatDate(s.latest.agreed_at)} 동의 · 버전 ${s.latest.policy_version}`
                    : "동의 기록 없음"}
                </span>
                <Link
                  href={routes.policies(item.policy_type)}
                  className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground sm:min-h-0"
                >
                  보기<span className="sr-only"> — {item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
        {/* [UI-가정] required consents can only be withdrawn by deleting the account */}
        <p className="text-sm leading-5 text-muted-foreground">필수 동의는 회원 탈퇴로만 철회할 수 있어요.</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-base leading-6 font-semibold">선택 동의</legend>
        <ul className="divide-y rounded-md border">
          {optional.map((item) => {
            const s = state[item.consent_type]
            const id = `setting-consent-${item.consent_type}`
            const busy = pending === item.consent_type
            return (
              <li key={item.consent_type} className="flex items-start gap-3 px-3 py-2.5">
                <Checkbox
                  id={id}
                  className="mt-1"
                  checked={s?.active ?? false}
                  disabled={busy}
                  aria-describedby={`${id}-desc`}
                  onCheckedChange={(v) => void change(item.consent_type, v === true, item.label)}
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={id} className="text-base font-normal">
                      {item.label}
                    </Label>
                    <Badge variant="secondary">선택</Badge>
                    {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="저장 중" /> : null}
                  </div>
                  <p id={`${id}-desc`} className="text-sm leading-5 text-muted-foreground">
                    {item.description}
                    {s?.latest ? (
                      <span className="tabular-nums">
                        {" "}
                        ·{" "}
                        {s.active
                          ? `${formatDate(s.latest.agreed_at)} 동의`
                          : s.latest.withdrawn_at
                            ? `${formatDate(s.latest.withdrawn_at)} 철회`
                            : null}
                      </span>
                    ) : null}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      </fieldset>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  )
}
