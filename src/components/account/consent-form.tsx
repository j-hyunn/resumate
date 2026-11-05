"use client"

/**
 * S-03 약관·개인정보 동의 (F-COM-02 v4, NFR-PRV-02, D-35). 서비스 이용 동의(필수/선택)만 받는다.
 * design-system v2 6 A1: 동의 항목 Checkbox 목록 + 필수 표시, AI 고지는 한 줄 meta + Info.
 * 동의 완료 → S-08 또는 원래 URL.
 */
import { submitFailedMessage } from "@/lib/data/labels"
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CircleAlert, Info, Loader2 } from "lucide-react"
import type { ConsentType } from "@/types/db"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { routes } from "@/lib/routes"
import { recordConsentsAction, signOutAction } from "./actions"
import { CONSENT_ITEMS } from "./policy-content"
import type { PolicyType, PolicyVersion } from "@/types/db"

type Agreed = Record<ConsentType, boolean>

const MISSING_ERROR_ID = "consent-missing-error"
const AGE_ID = "consent-age-14"
/** 이용약관 제4조·처리방침: 만 14세 미만은 가입 불가 (확정 2026-11-04 (사용자)). 화면 확인만, 별도 동의 행은 저장하지 않음. */
const AGE_LABEL = "만 14세 이상이에요"

const NONE: Agreed = {
  terms: false,
  privacy_required: false,
  cross_border_transfer: false,
  service_improvement: false,
  marketing: false,
}

export function ConsentForm({
  next,
  failSave,
  versions,
}: {
  next: string | null
  failSave: boolean
  /** policy_versions from getPolicyVersions() (server) */
  versions: Record<PolicyType, PolicyVersion>
}) {
  const router = useRouter()
  const [agreed, setAgreed] = React.useState<Agreed>(NONE)
  const [ageOk, setAgeOk] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [showMissing, setShowMissing] = React.useState(false)
  const [leaving, setLeaving] = React.useState(false)

  // UQ-107: declining ends the (signed-in, not yet consented) session before leaving
  async function decline() {
    setLeaving(true)
    try {
      await signOutAction()
    } finally {
      router.replace(routes.landing())
    }
  }

  const all = ageOk && CONSENT_ITEMS.every((c) => agreed[c.consent_type])
  const some = ageOk || CONSENT_ITEMS.some((c) => agreed[c.consent_type])
  const missing = [
    ...(ageOk ? [] : [AGE_LABEL]),
    ...CONSENT_ITEMS.filter((c) => c.required && !agreed[c.consent_type]).map((c) => c.label),
  ]
  const ageMissing = showMissing && !ageOk

  function setAll(value: boolean) {
    setAgeOk(value)
    setAgreed(Object.fromEntries(CONSENT_ITEMS.map((c) => [c.consent_type, value])) as Agreed)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (missing.length > 0) {
      setShowMissing(true)
      return
    }
    setSaving(true)
    setFailed(false)
    const res = await recordConsentsAction(agreed, next, { fail: failSave })
    if (!res.ok) {
      setSaving(false)
      setFailed(true)
      return
    }
    router.push(res.href)
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="sr-only">동의 항목</legend>
        {/* "모두 동의" row (02 S-03 v5.8 PT-5 — 만 14세 확인 포함) */}
        <Label className="flex items-center gap-3 rounded-md border p-3 text-base font-semibold">
          <Checkbox
            checked={all ? true : some ? "indeterminate" : false}
            onCheckedChange={(v) => setAll(v === true)}
          />
          모두 동의
        </Label>

        <ul className="space-y-1">
          <li className="flex items-start gap-3 rounded-md px-3 py-2">
            <Checkbox
              id={AGE_ID}
              className="mt-1"
              checked={ageOk}
              onCheckedChange={(v) => setAgeOk(v === true)}
              aria-describedby={ageMissing ? MISSING_ERROR_ID : undefined}
              aria-invalid={ageMissing || undefined}
            />
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              <Label htmlFor={AGE_ID} className="text-base font-normal">
                {AGE_LABEL}
              </Label>
              <Badge variant="info">필수</Badge>
            </div>
          </li>
          {CONSENT_ITEMS.map((item) => {
            const id = `consent-${item.consent_type}`
            const isMissing = showMissing && item.required && !agreed[item.consent_type]
            const describedBy =
              [item.description ? `${id}-desc` : null, isMissing ? MISSING_ERROR_ID : null].filter(Boolean).join(" ") ||
              undefined
            return (
              <li key={item.consent_type} className="flex items-start gap-3 rounded-md px-3 py-2">
                <Checkbox
                  id={id}
                  className="mt-1"
                  checked={agreed[item.consent_type]}
                  onCheckedChange={(v) => setAgreed((a) => ({ ...a, [item.consent_type]: v === true }))}
                  aria-describedby={describedBy}
                  aria-invalid={isMissing || undefined}
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Label htmlFor={id} className="text-base font-normal">
                      {item.label}
                    </Label>
                    {item.required ? (
                      <Badge variant="info">필수</Badge>
                    ) : (
                      <Badge variant="secondary">선택</Badge>
                    )}
                  </div>
                  {item.description ? (
                    <p id={`${id}-desc`} className="text-sm leading-5 text-muted-foreground">
                      {item.description}
                    </p>
                  ) : null}
                </div>
                <Link
                  href={routes.policies(item.policy_type)}
                  target="_blank"
                  className="-my-2.5 inline-flex min-h-11 shrink-0 items-center px-1 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  보기<span className="sr-only"> — {item.label} 내용 (새 탭)</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </fieldset>

      {/* 02 S-03 v5 (F-COM-02 v4, D-35): AI 공급자 국외 이전·데이터 사용 동의는 키 연결 때(C-21) 받는다. 여기서는 한 줄 고지만. */}
      <div className="space-y-1">
        <p className="flex items-start gap-1.5 text-sm leading-5 text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          AI 기능은 선택이에요. 쓰려면 나중에 본인 AI 키를 연결하고, 그때 공급자별 데이터 사용에 동의해요
        </p>
        <p className="pl-5.5 text-xs leading-4 text-muted-foreground tabular-nums">약관 버전 {versions.terms.version}</p>
      </div>

      {showMissing && missing.length > 0 ? (
        <p id={MISSING_ERROR_ID} role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {/* 오류 문구 (02 S-03 v5.8 PT-5) */}
          필수 항목에 모두 동의해야 시작할 수 있어요 ({missing.join(", ")})
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {submitFailedMessage("동의 내용")}
        </p>
      ) : null}

      <div className="space-y-2">
        {/* Not disabled while required items are missing: pressing explains what is missing. */}
        <Button type="submit" className="w-full" disabled={saving || leaving} aria-disabled={missing.length > 0 || undefined}>
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
          동의하고 시작하기
        </Button>
        <Button type="button" variant="link" className="w-full" onClick={decline} disabled={saving || leaving}>
          {leaving ? <Loader2 className="animate-spin" aria-hidden /> : null}
          동의하지 않고 나가기
        </Button>
      </div>
    </form>
  )
}
