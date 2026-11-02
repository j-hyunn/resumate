"use client"

/**
 * S-25 회원 탈퇴 확인 (02 S-25 v5.3, FL-07, A7; design-system 6 A1 (v3)).
 *
 * - 확인 체크 "모든 데이터가 즉시 삭제되고 되돌릴 수 없다는 것을 이해했어요" → "탈퇴하기"(destructive) 활성.
 *   요청은 `deleteAccountConfirmedAction({ confirm: true })` (문구 입력 방식은 쓰지 않는다).
 * - 성공 → 즉시 로그아웃 → S-01(`/`). 토스트 없음 (G-38).
 * - `account_deletion_busy` → 버튼 위 Alert warning + Hourglass, "지운 것은 없어요."만 굵게. 요약·체크는 그대로,
 *   다시 시도 = "탈퇴하기"를 다시 누름 (Alert 안 버튼 없음, G-38).
 * - `account_deletion_incomplete` → 탈퇴 마무리 상태 (셸 밖 경로로 이동, 요약·체크 숨김).
 * - 그 밖 오류 → ST-SAVE-FAILED 제출형 "탈퇴를 처리하지 못했어요. 잠시 후 다시 시도해 주세요".
 *
 * `simulate` (preview `deletion-busy`) makes the first request answer busy; `failDelete`
 * (preview `save-failed`) makes it fail. Mock controls in /dev/states drive the same paths with data.
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CircleAlert, Hourglass, Loader2 } from "lucide-react"
import type { AccountDeletionErrorCode } from "@/types/db"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { deleteAccountConfirmedAction } from "@/lib/data/actions"
import { routes } from "@/lib/routes"
import { signOutAction } from "./actions"

export const WITHDRAW_CONFIRM_LABEL = "모든 데이터가 즉시 삭제되고 되돌릴 수 없다는 것을 이해했어요"
/** 02 S-25 "그 밖 오류" (also the 탈퇴 마무리 retry failure line) */
export const WITHDRAW_FAILED_MESSAGE = "탈퇴를 처리하지 못했어요. 잠시 후 다시 시도해 주세요"

/** Sign out, then S-01. The session is treated as ended even if sign-out fails. */
export async function signOutToLanding(router: ReturnType<typeof useRouter>) {
  try {
    await signOutAction()
  } catch {
    // [UI-가정] sign-out failure is not surfaced (same as S-24 로그아웃)
  }
  router.replace(routes.landing())
}

export function WithdrawForm({
  failDelete,
  simulate = null,
  previewState = null,
}: {
  failDelete: boolean
  simulate?: AccountDeletionErrorCode | null
  /** carried to the 탈퇴 마무리 page when a preview produced `account_deletion_incomplete` */
  previewState?: string | null
}) {
  const router = useRouter()
  const [confirmed, setConfirmed] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [error, setError] = React.useState<"busy" | "failed" | null>(null)
  const pendingSimulate = React.useRef(simulate)
  const errorRef = React.useRef<HTMLDivElement>(null)

  // UQ-102: the submit button is disabled while running, so bring focus back to the error
  React.useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!confirmed || running) return
    setRunning(true)
    setError(null)
    const sim = pendingSimulate.current
    pendingSimulate.current = null
    let res: Awaited<ReturnType<typeof deleteAccountConfirmedAction>>
    try {
      res = await deleteAccountConfirmedAction({ confirm: true }, { fail: failDelete, simulate: sim })
    } catch {
      res = { ok: false, error: "failed" }
    }
    if (res.ok) {
      // 02 S-25: 성공 → 즉시 로그아웃 → S-01. No toast (G-38)
      await signOutToLanding(router)
      return
    }
    if (res.error === "account_deletion_incomplete") {
      // 탈퇴 마무리 상태 — 셸 밖 경로 (A7, G-38)
      router.replace(routes.withdrawFinalize(sim ? "deletion-incomplete" : previewState))
      return
    }
    setRunning(false)
    setError(res.error === "account_deletion_busy" ? "busy" : "failed")
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {/* 확인 체크 (design-system 6 A1 (v3)): rounded-md border border-input p-4 */}
      <div className="flex items-start gap-3 rounded-md border border-input p-4">
        <Checkbox
          id="withdraw-confirm"
          checked={confirmed}
          onCheckedChange={(v) => setConfirmed(v === true)}
          disabled={running}
          className="mt-0.5"
        />
        <label htmlFor="withdraw-confirm" className="text-base leading-6">
          {WITHDRAW_CONFIRM_LABEL}
        </label>
      </div>

      {error === "busy" ? (
        <Alert variant="warning" ref={errorRef} tabIndex={-1} role="alert" className="outline-none">
          <Hourglass aria-hidden />
          <AlertDescription>
            <p>
              다른 작업과 겹쳐 탈퇴를 마치지 못했어요. <span className="font-semibold">지운 것은 없어요.</span> 잠시 후 다시
              시도해 주세요.
            </p>
          </AlertDescription>
        </Alert>
      ) : error === "failed" ? (
        <div ref={errorRef} tabIndex={-1} role="alert" className="flex items-start gap-1.5 text-sm text-destructive outline-none">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {WITHDRAW_FAILED_MESSAGE}
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {running ? (
          <Button type="button" variant="outline" disabled>
            취소
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href={routes.settings()}>취소</Link>
          </Button>
        )}
        <Button type="submit" variant="destructive" disabled={!confirmed || running}>
          {running ? <Loader2 className="animate-spin" aria-hidden /> : null}
          탈퇴하기
        </Button>
      </div>
    </form>
  )
}
