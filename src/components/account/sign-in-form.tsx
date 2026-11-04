"use client"

/**
 * S-02 가입/로그인 (F-COM-01, D-09 v5.7 개정 2026-11-04): Google 로그인만.
 * design-system 6 A1: "Google로 계속하기"(outline, 전체 폭, Google 로고 공식 색 예외).
 * 누르면 Google 동의 화면으로 이동하고, 이동하는 동안 스피너 + 비활성(중복 클릭 막음).
 * 시작 실패 → 버튼 아래 `role="alert"` 한 줄 / 콜백 실패(`?error=auth_callback`) → 상단 destructive Alert.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { CircleAlert, Loader2 } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { signInWithGoogleAction } from "./actions"

export type SignInPreview = "error" | "login-error" | "new-user" | "deletion-incomplete" | null

/**
 * Renders the whole S-02 card body so the callback Alert can sit first in the card (UQ-725)
 * and be cleared when the button is pressed again (UQ-726). `intro` = 제목 묶음, `footnote` = 약관 안내.
 */
export function SignInForm({
  next,
  preview,
  intro,
  footnote,
}: {
  next: string | null
  preview: SignInPreview
  intro: React.ReactNode
  footnote: React.ReactNode
}) {
  const router = useRouter()
  const fail = preview === "error"
  const forceNewUser = preview === "new-user"
  // v5.3 A7: sign in as an account whose deletion did not finish → S-25 탈퇴 마무리 first
  const deletionIncomplete = preview === "deletion-incomplete"

  const [busy, setBusy] = React.useState(false)
  const [startFailed, setStartFailed] = React.useState(false)
  // design-system 6 A1 S-02: callback-failure Alert is cleared once the user presses the button again
  const [callbackFailed, setCallbackFailed] = React.useState(preview === "login-error")
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const refocus = React.useRef(false)

  // UQ-731: Back from Google may restore this page from bfcache with the busy state frozen
  React.useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) setBusy(false)
    }
    window.addEventListener("pageshow", onPageShow)
    return () => window.removeEventListener("pageshow", onPageShow)
  }, [])

  // UQ-730: focus drops to <body> while the button is disabled; give it back after a start failure
  React.useEffect(() => {
    if (!busy && refocus.current) {
      refocus.current = false
      buttonRef.current?.focus()
    }
  }, [busy])

  async function google() {
    setBusy(true)
    setStartFailed(false)
    setCallbackFailed(false)
    const res = await signInWithGoogleAction(next, { fail, forceNewUser, deletionIncomplete })
    if (!res.ok) {
      refocus.current = true
      setBusy(false)
      setStartFailed(true)
      return
    }
    // stays busy while the browser leaves for Google (or the next screen in previews)
    router.push(res.href)
  }

  return (
    <>
      {callbackFailed ? (
        <Alert variant="destructive" className="mb-6">
          <CircleAlert aria-hidden />
          {/* [가정] 취소와 실패를 나누지 않는다 (02 S-02 v5.7 상태 "콜백 실패") */}
          <AlertTitle>로그인을 마치지 못했어요</AlertTitle>
          <AlertDescription>다시 시도해 주세요</AlertDescription>
        </Alert>
      ) : null}

      {intro}

      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="lg"
        className="mt-8 w-full"
        onClick={google}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <GoogleLogo />}
        Google로 계속하기
      </Button>

      {startFailed ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Google 로그인을 시작하지 못했어요. 다시 시도해 주세요
        </p>
      ) : null}

      {footnote}
    </>
  )
}

/** Google "G" mark — brand colours allowed here (design-system 6 A1 exception). */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 18 18" className="size-5" aria-hidden focusable="false">
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
