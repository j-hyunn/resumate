"use client"

/**
 * S-14 모달을 여는 자리 — 주 버튼과 `?new=1` 주소 상태를 잇는다 (UX v5.20 S-14, CF-8).
 *
 * `?new=1[&from=board]`로 들어오면 모달을 **연 채로** S-13을 연다(옛 `/applications/new`의
 * 도착지, A0 리다이렉트). 닫으면 `new`·`from`을 주소에서 지운다(`replace` — 히스토리를 늘리지
 * 않는다) `[UI-가정]`. 입력 내용은 절대 주소에 넣지 않는다.
 *
 * 보드(S-39)의 "지원 전 +"는 **이 화면을 거치지 않는다** — 보드가 `BoardAddButton`으로
 * `<AddApplicationDialog fromBoard />`를 직접 띄운다(UQ-742). `?new=1&from=board`로 이 화면에 오는 것은
 * 옛 주소 `/applications/new?from=board`(북마크 등)뿐이고, 그때는 닫거나 만든 뒤 **보드로 돌려보낸다**
 * (UX S-14 "출발 화면 그대로" · "보드에서 왔을 때 생성 뒤 S-39") `[UI-가정]`.
 */
import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { routes } from "@/lib/routes"
import { AddApplicationDialog } from "./add-application-dialog"

function useModalUrl() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  return React.useCallback(
    (open: boolean) => {
      const next = new URLSearchParams(params.toString())
      if (open) next.set("new", "1")
      else {
        next.delete("new")
        next.delete("from")
      }
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, params],
  )
}

export function AddApplicationLauncher({
  open,
  fromBoard,
  previewState,
}: {
  open: boolean
  fromBoard: boolean
  previewState?: string | null
}) {
  const setOpen = useModalUrl()
  const router = useRouter()
  const onOpenChange = (next: boolean) => {
    // 옛 보드 주소에서 왔으면 닫을 때(생성 뒤 포함) 출발 화면인 보드로 돌아간다
    if (!next && fromBoard) router.replace(routes.board())
    else setOpen(next)
  }
  return <AddApplicationDialog open={open} onOpenChange={onOpenChange} fromBoard={fromBoard} previewState={open ? previewState : null} />
}

/** 머리·빈 상태의 주 버튼 — 누르면 `?new=1`을 켠다 */
function LauncherButton() {
  const setOpen = useModalUrl()
  return (
    <Button onClick={() => setOpen(true)}>
      <Plus aria-hidden />
      자기소개서 작성
    </Button>
  )
}

AddApplicationLauncher.Button = LauncherButton
