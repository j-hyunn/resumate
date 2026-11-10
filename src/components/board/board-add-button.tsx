"use client"

/**
 * S-39 "지원 전" 열 "+" · 좁은 화면 탭 버튼 · 빈 상태 버튼 → **보드 위에서** S-14 2단계 모달을 연다
 * (UQ-742 · UX v5.20 S-14 "이탈: 닫기(×)·Esc → 출발 화면 그대로" · "보드에서 왔을 때: 생성 뒤 S-39에
 * 남아 '지원 전' 열 맨 위에 카드 + '열기' 토스트" · design-system 5.5·5.6.2).
 *
 * 예전에는 `routes.applicationNew({ from: "board" })`로 **S-13으로 이동한 뒤** 모달을 열어, 닫거나 만들어도
 * S-13에 남았다. 이제 보드가 모달을 직접 들고 있어 주소가 바뀌지 않는다. 모달은 `fromBoard`면 ② 주 버튼이
 * "추가하기"이고, 만든 뒤 `router.refresh()`로 **이 보드를** 다시 그려 새 카드가 "지원 전" 열 맨 위에 온다.
 */
import * as React from "react"
import { Button } from "@/components/ui/button"
import { AddApplicationDialog } from "@/components/applications/add-application-dialog"

export function BoardAddButton({
  children,
  ...button
}: Omit<React.ComponentProps<typeof Button>, "onClick" | "asChild"> & { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button {...button} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <AddApplicationDialog open={open} onOpenChange={setOpen} fromBoard />
    </>
  )
}
