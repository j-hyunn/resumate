"use client"

/**
 * S-24 ① 계정 탭 (UX v5.17a S-24 ①, design-system 5.11.1): 계정(이메일 읽기 전용) · 내 정보 · 위험 구역.
 * 열 때마다 이메일 + 내 정보를 다시 읽는다(임시 보존 없음).
 *
 * preview (`?state=` the dialog was opened with): loading · error · empty (내 정보 전부 빈 상태) ·
 * save-failed · stale-write · invalid-option · duplicate-interest (첫 저장이 그 결과)
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { ProfileBasicsViewDto } from "@/lib/contracts/profile"
import { routes } from "@/lib/routes"
import { useGuardedAction } from "@/components/common/shell/settings-guard"
import { getAccountTabDataAction } from "./actions"
import { SignOutButton } from "./sign-out-button"
import { ProfileBasicsForm } from "./profile-basics-form"
import { SETTINGS_ANCHORS } from "./settings-section-list"

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; email: string; view: ProfileBasicsViewDto }

function emptyView(view: ProfileBasicsViewDto): ProfileBasicsViewDto {
  return {
    options: view.options,
    profile: {
      updatedAt: view.profile.updatedAt,
      displayName: null,
      jobSearchStatus: null,
      interestedCompanyType: null,
      interestedIndustry: null,
      highestEducation: { schoolName: null, degree: null, status: null, startMonth: null, endMonth: null, major: null, gpa: null },
      jobInterests: [],
    },
  }
}

async function loadAccount(preview: string | null): Promise<Load> {
  if (preview === "loading") return { status: "loading" }
  if (preview === "error") return { status: "error" }
  const res = await getAccountTabDataAction()
  if (!res.ok) return { status: "error" }
  return { status: "ready", email: res.email, view: preview === "empty" ? emptyView(res.view) : res.view }
}

export function AccountTab({
  onNavigate,
  scrollTo = null,
  preview = null,
}: {
  /** closes the dialog (leaving it for S-25) */
  onNavigate: () => void
  /** `#settings-danger-zone` when opened from the old `withdraw` section id */
  scrollTo?: string | null
  preview?: string | null
}) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" })

  React.useEffect(() => {
    let alive = true
    void loadAccount(preview).then((l) => alive && setLoad(l))
    return () => {
      alive = false
    }
  }, [preview])

  const ready = load.status === "ready"
  React.useEffect(() => {
    if (ready && scrollTo) document.getElementById(scrollTo)?.scrollIntoView({ block: "start" })
  }, [ready, scrollTo])

  if (load.status === "loading")
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">계정 정보를 불러오는 중</span>
        <Skeleton className="h-6 w-16" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-8 w-52" />
          </div>
        ))}
        <Skeleton className="h-[4.5rem] w-full" />
      </div>
    )
  if (load.status === "error")
    return (
      <div role="alert" className="space-y-3 py-6 text-center">
        {/* 확정 2026-11-06 (사용자, UI42-1): 계정 탭 불러오기 실패는 기존(v5.10) 문구 (design-system 5.11, P-24) */}
        <p className="text-base">설정을 불러오지 못했어요</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoad({ status: "loading" })
            void loadAccount(preview === "error" ? null : preview).then(setLoad)
          }}
        >
          <RotateCcw aria-hidden />
          다시 시도
        </Button>
      </div>
    )

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="settings-account-heading" className="space-y-3">
        <h3 id="settings-account-heading" className="text-base leading-6 font-semibold">
          계정
        </h3>
        {/* v5.12: 라벨 왼쪽 회색 6rem 열 · 값 진한 글자 (SettingsFieldRow와 같은 열) */}
        <dl className="grid gap-1.5 @md/settings:grid-cols-[6rem_minmax(0,1fr)] @md/settings:items-center @md/settings:gap-0">
          <dt className="text-base leading-6 text-muted-foreground">이메일</dt>
          <dd className="text-base leading-6 break-all">{load.email}</dd>
        </dl>
      </section>

      <ProfileBasicsForm key={load.view.profile.updatedAt} view={load.view} preview={preview} />

      <DangerZone onNavigate={onNavigate} />
    </div>
  )
}

/** 위험 구역 (SD-A7): 로그아웃(확인 없이 즉시) · 회원 탈퇴(미저장이면 확인 → S-25) */
function DangerZone({ onNavigate }: { onNavigate: () => void }) {
  const router = useRouter()
  const guarded = useGuardedAction()
  return (
    <section id={SETTINGS_ANCHORS.dangerZone} aria-labelledby="settings-danger-heading" className="scroll-mt-4 space-y-3">
      <h3 id="settings-danger-heading" className="text-base leading-6 font-semibold">
        위험 구역
      </h3>
      <div className="flex flex-wrap gap-2">
        <SignOutButton />
        {/* v5.12: 화면의 채운 버튼 모양·크기·배치, 색은 파괴적 (SD-A7 — 화면의 초록은 자리표시자). 아이콘 없음 */}
        <Button
          variant="destructive"
          onClick={() =>
            guarded(() => {
              onNavigate()
              router.push(routes.withdraw())
            })
          }
        >
          회원 탈퇴
        </Button>
      </div>
    </section>
  )
}
