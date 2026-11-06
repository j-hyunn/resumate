"use client"

/**
 * S-24 ③ 약관 탭 (UX v5.17 S-24 ③ SD-A13·A14·A15, design-system 5.11.3):
 * Resumate 약관 4개 [전문 확인](새 탭) · 선택 동의 토글 2개(즉시 저장) · AI 데이터 처리 원칙 줄.
 * 필수 동의 기록(동의 항목·날짜 목록)은 그리지 않는다 (SD-Q3 (다) 확정).
 *
 * preview: loading · error · save-failed (토글 저장 실패)
 */
import * as React from "react"
import { CircleAlert, ExternalLink, Loader2, RotateCcw, ShieldCheck } from "lucide-react"
import type { ConsentType, PolicyType } from "@/types/db"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import type { ConsentStatus } from "@/lib/data/account"
import { POLICY_DOCUMENT_TYPES } from "@/lib/data/consent-items"
import { objectParticle } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { getConsentStatusesAction, setOptionalConsentAction } from "./actions"
import { CONSENT_ITEMS } from "./policy-content"

/** 약관 탭의 문서 이름 (UX S-24 ③ — 화면 문구는 피그마 그대로, 문서 페이지 제목은 S-30 표) */
const TAB_DOCUMENT_LABELS: Record<PolicyType, string> = {
  privacy: "개인정보 처리방침",
  terms: "이용 약관",
  cross_border_transfer: "국외 이전 약관",
  ai_data_use: "AI 데이터 처리",
}

/**
 * 선택 동의 화면 라벨 (UX S-24 ③ SD-A15 — 피그마 문구 `[가정]`). S-03 가입 동의 라벨은 그대로 두고
 * 이 탭에서만 바꾼다 [UI-가정]. 설명 한 줄은 현행(CONSENT_ITEMS) 그대로.
 */
const OPTIONAL_LABELS: Partial<Record<ConsentType, string>> = {
  service_improvement: "이용 패턴 기록 활용",
  marketing: "기능 업데이트, 소식 받기",
}

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; statuses: ConsentStatus[] }

async function loadStatuses(preview: string | null): Promise<Load> {
  if (preview === "loading") return { status: "loading" }
  if (preview === "error") return { status: "error" }
  const res = await getConsentStatusesAction()
  return res.ok ? { status: "ready", statuses: res.statuses } : { status: "error" }
}

export function PoliciesTab({ preview = null }: { preview?: string | null }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" })

  React.useEffect(() => {
    let alive = true
    void loadStatuses(preview).then((l) => alive && setLoad(l))
    return () => {
      alive = false
    }
  }, [preview])

  if (load.status === "loading")
    return (
      <div className="space-y-2" aria-busy="true">
        <span className="sr-only">약관 설정을 불러오는 중</span>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  if (load.status === "error")
    return (
      <div role="alert" className="space-y-3 py-6 text-center">
        <p className="text-base">약관 설정을 불러오지 못했어요</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoad({ status: "loading" })
            void loadStatuses(preview === "error" ? null : preview).then(setLoad)
          }}
        >
          <RotateCcw aria-hidden />
          다시 불러오기
        </Button>
      </div>
    )

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="settings-policy-docs" className="space-y-4">
        <h3 id="settings-policy-docs" className="text-base leading-6 font-semibold">
          Resumate 약관
        </h3>
        <ul className="divide-y rounded-lg border bg-card">
          {POLICY_DOCUMENT_TYPES.map((t) => (
            <li key={t} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
              <span className="text-base">{TAB_DOCUMENT_LABELS[t]}</span>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={routes.policies(t)}
                  target="_blank"
                  rel="noopener"
                  aria-label={`${TAB_DOCUMENT_LABELS[t]} 전문 확인 (새 탭)`}
                >
                  전문 확인
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="settings-optional-consents" className="space-y-4">
        <h3 id="settings-optional-consents" className="text-base leading-6 font-semibold">
          선택 동의
        </h3>
        <OptionalConsents statuses={load.statuses} failSave={preview === "save-failed"} />
      </section>

      {/* AI 데이터 처리 원칙 줄 (SD-A9 — AI 연결 탭에서 옮겨 왔다) */}
      <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-4">
        <ShieldCheck className="mt-1 size-4 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-base">Resumate는 내 데이터를 AI 학습에 쓰지 않아요. 키는 서버에 암호화해 저장하고 화면에는 마지막 4자리만 보여요</p>
          <p className="text-sm text-muted-foreground">공급자 데이터 사용은 연결한 공급자·등급 정책을 따라요</p>
        </div>
        <Button variant="link" size="sm" className="h-auto shrink-0 px-0" asChild>
          <a href={routes.policies("ai_data_use")} target="_blank" rel="noopener" aria-label="AI 데이터 처리 전문 확인 (새 탭)">
            전문 확인
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </Button>
      </div>
    </div>
  )
}

function OptionalConsents({ statuses, failSave }: { statuses: ConsentStatus[]; failSave: boolean }) {
  const [state, setState] = React.useState<Record<string, ConsentStatus>>(() =>
    Object.fromEntries(statuses.map((s) => [s.consent_type, s])),
  )
  const [pending, setPending] = React.useState<ConsentType | null>(null)
  const [failed, setFailed] = React.useState<{ type: ConsentType; agree: boolean } | null>(null)
  const [announce, setAnnounce] = React.useState("")
  const optional = CONSENT_ITEMS.filter((c) => !c.required)

  async function change(consentType: ConsentType, agree: boolean, label: string) {
    const prev = state[consentType]
    setPending(consentType)
    setFailed(null)
    setState((s) => ({ ...s, [consentType]: { ...prev, active: agree } }))
    const res = await setOptionalConsentAction(consentType, agree, { fail: failSave })
    setPending(null)
    if (!res.ok) {
      // 실패하면 토글을 되돌리고 오류 줄 (ST-SAVE-FAILED)
      setState((s) => ({ ...s, [consentType]: prev }))
      setFailed({ type: consentType, agree })
      return
    }
    setState((s) => ({ ...s, [consentType]: res.status }))
    // [UI-가정] success announcement copy (screen reader only)
    setAnnounce(`${label}${objectParticle(label)} ${agree ? "켰어요" : "껐어요"}`)
  }

  return (
    <>
      <ul className="divide-y rounded-lg border bg-card">
        {optional.map((item) => {
          const s = state[item.consent_type]
          const id = `settings-consent-${item.consent_type}`
          const busy = pending === item.consent_type
          const label = OPTIONAL_LABELS[item.consent_type] ?? item.label
          return (
            <li key={item.consent_type} className="space-y-2 px-4 py-3">
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <Label htmlFor={id} className="text-base font-medium">
                    {label}
                  </Label>
                  {item.description ? (
                    <p id={`${id}-desc`} className="text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 pt-0.5">
                  {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="저장 중" /> : null}
                  <Switch
                    id={id}
                    checked={s?.active ?? false}
                    disabled={busy}
                    aria-describedby={item.description ? `${id}-desc` : undefined}
                    onCheckedChange={(v) => void change(item.consent_type, v, label)}
                  />
                </div>
              </div>
              {failed?.type === item.consent_type ? (
                <p role="alert" className="flex flex-wrap items-center gap-1.5 text-sm text-destructive">
                  <CircleAlert className="size-4 shrink-0" aria-hidden />
                  변경하지 못했어요 · {label} 설정이 그대로예요 ·
                  <Button
                    variant="destructive-link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() => void change(item.consent_type, failed.agree, label)}
                  >
                    다시 시도
                  </Button>
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </>
  )
}
