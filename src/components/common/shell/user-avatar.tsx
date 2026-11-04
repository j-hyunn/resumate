"use client"

/**
 * 계정 아바타 — L-01 NavUser와 L-02 ShellBar 계정 버튼이 같이 쓴다. Google 프로필 사진
 * (CurrentUser.avatar_url)이 있으면 사진, 없거나 못 불러오면 이름(없으면 이메일)의 첫 글자.
 *
 * L-02는 페이지마다 PageShell을 직접 그려서 레이아웃이 사용자 정보를 props로 넘길 수 없다. 그래서
 * `(page)/layout.tsx`의 서버 슬롯이 `ShellUserPublisher`로 값을 올리고 ShellBar는 `useShellUser()`로 읽는다
 * (page-shell-outage.tsx와 같은 방식).
 */
import * as React from "react"
import type { CurrentUser } from "@/lib/data/shell"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

let current: CurrentUser | null = null
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function ShellUserPublisher({ user }: { user: CurrentUser | null }) {
  React.useEffect(() => {
    current = user
    listeners.forEach((fn) => fn())
  }, [user])
  return null
}

export function useShellUser(): CurrentUser | null {
  return React.useSyncExternalStore(subscribe, () => current, () => null)
}

/** 화면에 보일 이름: Google 이름, 없으면 이메일 앞부분 */
export function displayName(user: Pick<CurrentUser, "name" | "email"> | null): string {
  return user?.name ?? user?.email.split("@")[0] ?? ""
}

export function UserAvatar({ name, avatarUrl, className }: { name: string; avatarUrl: string | null; className?: string }) {
  const initial = name.slice(0, 1).toUpperCase() || "?"
  return (
    <Avatar className={cn("size-8 rounded-lg", className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" referrerPolicy="no-referrer" className="rounded-lg" /> : null}
      <AvatarFallback className="rounded-lg">{initial}</AvatarFallback>
    </Avatar>
  )
}
