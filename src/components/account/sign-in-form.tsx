"use client"

/**
 * S-02 가입/로그인 (F-COM-01, D-09): 이메일 매직 링크 + 재발송, Google.
 * design-system 6 A1: 이메일 Input + "로그인 링크 받기"(default, 전체 폭) / "또는" 구분선 /
 * "Google로 계속하기"(outline, 전체 폭, Google 로고 공식 색 예외). 재발송 후 Alert info.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { CircleAlert, FlaskConical, Loader2, MailCheck, RotateCcw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { isPreviewEnabled } from "@/lib/preview-state"
import { openMagicLinkAction, sendMagicLinkAction, signInWithGoogleAction } from "./actions"

// [UI-가정] resend cooldown (Supabase default OTP rate limit is 60s)
const RESEND_COOLDOWN_S = 60

const schema = z.object({
  email: z.string().trim().min(1, "이메일을 입력해 주세요").email("이메일 형식을 확인해 주세요"),
})
type FormValues = z.infer<typeof schema>

export type SignInPreview = "error" | "sent" | "link-expired" | "new-user" | "deletion-incomplete" | null

export function SignInForm({ next, preview }: { next: string | null; preview: SignInPreview }) {
  const router = useRouter()
  const fail = preview === "error"
  const forceNewUser = preview === "new-user"
  // v5.3 A7: sign in as an account whose deletion did not finish → S-25 탈퇴 마무리 first
  const deletionIncomplete = preview === "deletion-incomplete"

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: preview === "sent" ? "jiwoo.kim@example.com" : "" },
  })

  const [sentTo, setSentTo] = React.useState<string | null>(preview === "sent" ? "jiwoo.kim@example.com" : null)
  const [resent, setResent] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [googleBusy, setGoogleBusy] = React.useState(false)
  const [opening, setOpening] = React.useState(false)
  const [error, setError] = React.useState<"send" | "google" | "open" | null>(null)
  const [cooldown, setCooldown] = React.useState(preview === "sent" ? RESEND_COOLDOWN_S : 0)
  const [sentVersion, setSentVersion] = React.useState(0)
  const [emailFocusVersion, setEmailFocusVersion] = React.useState(0)
  const sentAlertRef = React.useRef<HTMLDivElement>(null)

  // move focus to the "link sent" notice after each (re)send
  React.useEffect(() => {
    if (sentVersion > 0) sentAlertRef.current?.focus()
  }, [sentVersion])

  // UQ-96: "다른 이메일로 받기" removes the focused button; put focus back on the email field
  React.useEffect(() => {
    if (emailFocusVersion > 0) form.setFocus("email")
  }, [emailFocusVersion, form])

  React.useEffect(() => {
    if (cooldown <= 0) return
    const t = window.setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
  }, [cooldown])

  async function send(email: string, isResend: boolean) {
    setSending(true)
    setError(null)
    const res = await sendMagicLinkAction(email, { fail })
    setSending(false)
    if (!res.ok) {
      setError("send")
      return
    }
    setSentTo(email)
    setResent(isResend)
    setCooldown(RESEND_COOLDOWN_S)
    setSentVersion((v) => v + 1)
  }

  const onSubmit = form.handleSubmit((values) => send(values.email.trim(), false))

  async function google() {
    setGoogleBusy(true)
    setError(null)
    const res = await signInWithGoogleAction(next, { fail, forceNewUser, deletionIncomplete })
    if (!res.ok) {
      setGoogleBusy(false)
      setError("google")
      return
    }
    router.push(res.href)
  }

  async function openLink() {
    if (!sentTo) return
    setOpening(true)
    const res = await openMagicLinkAction(sentTo, next, { forceNewUser, deletionIncomplete })
    if (!res.ok) {
      setOpening(false)
      setError("open")
      return
    }
    router.push(res.href)
  }

  function useOtherEmail() {
    setSentTo(null)
    setResent(false)
    setCooldown(0)
    form.reset({ email: "" })
    setEmailFocusVersion((v) => v + 1)
  }

  const busy = sending || googleBusy || opening

  return (
    <div className="space-y-6">
      {preview === "link-expired" && !sentTo ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          {/* [UI-가정] expired / invalid link copy (auth callback error) */}
          <AlertTitle>로그인 링크가 만료됐어요</AlertTitle>
          <AlertDescription>링크는 한 번만 쓸 수 있고 시간이 지나면 만료돼요. 이메일을 입력해 새 링크를 받아 주세요.</AlertDescription>
        </Alert>
      ) : null}

      {sentTo ? (
        <div className="space-y-4">
          <Alert variant="info" ref={sentAlertRef} tabIndex={-1} role="status" className="outline-none">
            <MailCheck aria-hidden />
            {/* [UI-가정] link-sent copy */}
            <AlertTitle>{resent ? "로그인 링크를 다시 보냈어요" : "로그인 링크를 보냈어요"}</AlertTitle>
            <AlertDescription>
              <span>
                <strong className="font-semibold break-all">{sentTo}</strong>의 메일함에서 링크를 눌러 주세요. 메일이 안 보이면
                스팸함도 확인해 주세요.
              </span>
            </AlertDescription>
          </Alert>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy || cooldown > 0}
            onClick={() => send(sentTo, true)}
          >
            {sending ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
            <span className="tabular-nums">{cooldown > 0 ? `재발송 (${cooldown}초 뒤 가능)` : "링크 재발송"}</span>
          </Button>
          <Button type="button" variant="link" className="w-full" onClick={useOtherEmail} disabled={busy}>
            다른 이메일로 받기
          </Button>

          {isPreviewEnabled && preview ? (
            <div className="space-y-2 rounded-md border border-dashed p-3">
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <FlaskConical className="size-4" aria-hidden />
                개발용: 메일 없이 링크를 연 것처럼 진행해요
              </p>
              <Button type="button" variant="secondary" size="sm" onClick={openLink} disabled={busy}>
                {opening ? <Loader2 className="animate-spin" aria-hidden /> : null}
                메일의 로그인 링크 열기
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field data-invalid={form.formState.errors.email ? true : undefined}>
            <FieldLabel htmlFor="sign-in-email">이메일</FieldLabel>
            <Input
              id="sign-in-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="name@example.com"
              aria-invalid={form.formState.errors.email ? true : undefined}
              aria-describedby={form.formState.errors.email ? "sign-in-email-error" : undefined}
              {...form.register("email")}
            />
            <FieldError id="sign-in-email-error" errors={[form.formState.errors.email]} />
          </Field>
          <Button type="submit" className="w-full" disabled={busy}>
            {sending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            로그인 링크 받기
          </Button>
        </form>
      )}

      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {/* [UI-가정] error copy */}
          {error === "send"
            ? "로그인 링크를 보내지 못했어요. 잠시 후 다시 시도해 주세요"
            : error === "google"
              ? "Google 로그인을 마치지 못했어요. 다시 시도해 주세요"
              : "로그인하지 못했어요. 링크를 다시 받아 주세요"}
        </p>
      ) : null}

      <div className="flex items-center gap-3" role="separator" aria-label="또는">
        <span className="h-px flex-1 bg-border" />
        <span className="text-sm text-muted-foreground" aria-hidden>
          또는
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button type="button" variant="outline" className="w-full" onClick={google} disabled={busy}>
        {googleBusy ? <Loader2 className="animate-spin" aria-hidden /> : <GoogleLogo />}
        Google로 계속하기
      </Button>
    </div>
  )
}

/** Google "G" mark — brand colours allowed here (design-system 6 A1 exception). */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 18 18" className="size-[18px]" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}
