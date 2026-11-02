"use client"

/**
 * S-25 탈퇴 마무리 상태 (02 S-25 v5.3 `account_deletion_incomplete` · 재진입, FL-07, A7;
 * design-system 6 A1 (v3) 카드, G-38).
 *
 * 데이터는 모두 지웠고 계정 정보 삭제만 남은 상태. 삭제 범위 요약·확인 체크·AI 연결 안내는 그리지 않는다.
 * 할 수 있는 일은 "탈퇴 마무리하기"(같은 요청 `confirm: true`를 다시 보냄, 멱등)와 로그아웃뿐 [가정].
 * 성공 → 로그아웃 → `/` (토스트 없음). 또 실패하면 카드는 그대로, 버튼 위에 ST-SAVE-FAILED 제출형 한 줄.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { CircleAlert, Loader2, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { deleteAccountConfirmedAction } from "@/lib/data/actions"
import { WITHDRAW_FAILED_MESSAGE, signOutToLanding } from "./withdraw-form"

export function WithdrawFinalizeCard({ failFinalize = false }: { failFinalize?: boolean }) {
  const router = useRouter()
  const [running, setRunning] = React.useState<"finalize" | "sign-out" | null>(null)
  const [failed, setFailed] = React.useState(false)
  const errorRef = React.useRef<HTMLParagraphElement>(null)
  const titleRef = React.useRef<HTMLHeadingElement>(null)

  // Focus the message on arrival (redirected here from sign-in / the shell / S-25)
  React.useEffect(() => {
    titleRef.current?.focus()
  }, [])

  React.useEffect(() => {
    if (failed) errorRef.current?.focus()
  }, [failed])

  async function finalize() {
    if (running) return
    setRunning("finalize")
    setFailed(false)
    let ok = false
    try {
      const res = await deleteAccountConfirmedAction({ confirm: true }, { fail: failFinalize })
      ok = res.ok
    } catch {
      ok = false
    }
    if (ok) {
      await signOutToLanding(router)
      return
    }
    // [UI-가정] busy / incomplete / 그 밖 오류 모두 같은 한 줄 (design-system 6 A1 (v3))
    setRunning(null)
    setFailed(true)
  }

  async function signOut() {
    if (running) return
    setRunning("sign-out")
    await signOutToLanding(router)
  }

  return (
    <Card className="mx-auto mt-16 max-w-md gap-5 p-8">
      <div className="grid size-10 place-items-center rounded-full bg-warning-subtle">
        <CircleAlert className="size-5 text-warning" aria-hidden />
      </div>
      <div className="space-y-2">
        <h1 ref={titleRef} tabIndex={-1} className="text-lg leading-7 font-semibold outline-none">
          데이터는 모두 지웠지만 계정 정보 삭제를 마치지 못했어요.
        </h1>
        <p className="text-base leading-[1.6] text-muted-foreground">잠시 후 다시 시도해 주세요.</p>
      </div>
      {failed ? (
        <p ref={errorRef} tabIndex={-1} role="alert" className="flex items-start gap-1.5 text-sm text-destructive outline-none">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {WITHDRAW_FAILED_MESSAGE}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button variant="destructive" className="w-full" onClick={() => void finalize()} disabled={running !== null}>
          {running === "finalize" ? <Loader2 className="animate-spin" aria-hidden /> : null}
          탈퇴 마무리하기
        </Button>
        <Button variant="ghost" className="w-full" onClick={() => void signOut()} disabled={running !== null}>
          {running === "sign-out" ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
          로그아웃
        </Button>
      </div>
    </Card>
  )
}
