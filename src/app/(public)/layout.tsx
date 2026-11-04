import { Suspense } from "react"
import Link from "next/link"
import { DeletionIncompleteGuard } from "@/components/common/shell/deletion-guard"
import { LogoMark, LogoWordmark } from "@/components/common/shell/logo-mark"
import { routes } from "@/lib/routes"

/** 셸 밖 화면 (S-01~S-03, S-30): 상단 h-14 로고만 (design-system 6 A1) */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="flex h-14 items-center border-b px-4 lg:px-6">
        <Link
          href={routes.landing()}
          aria-label="Resumate 처음 화면으로 가기"
          className="flex items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <LogoMark className="size-7" />
          <LogoWordmark />
        </Link>
      </header>
      <main>{children}</main>
      {/* v5.3 A7 (UQ-407): S-03 must not come before S-25 탈퇴 마무리 */}
      <Suspense fallback={null}>
        <DeletionIncompleteGuard paths={["/consent"]} />
      </Suspense>
    </div>
  )
}
