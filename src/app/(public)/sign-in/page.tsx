import Link from "next/link"
import type { Metadata } from "next"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { FormSkeleton } from "@/components/common/state-views"
import { Card } from "@/components/ui/card"
import { SignInForm, type SignInPreview } from "@/components/account/sign-in-form"
import { safeNextPath } from "@/lib/routes"
import { getPreviewState } from "@/lib/preview-state"
import { isLoginError } from "@/lib/contracts/routes"
import { routes } from "@/lib/routes"

/**
 * S-02 가입/로그인 (F-COM-01, FL-09). 로그인 후 S-08 또는 원래 URL(`?next=`), 신규면 S-03.
 * v5.3 A7: 탈퇴 미완료 계정은 S-03·원래 URL·S-08보다 먼저 S-25 탈퇴 마무리(/settings/withdraw/finalize).
 * `?error=auth_callback` (로그인 콜백 실패)는 링크 만료 안내를 보여 준다 (운영 포함).
 * ?state= : loading · error(발송·Google 실패) · sent(링크 보냄 + 재발송) · link-expired · new-user ·
 *           deletion-incomplete(로그인하면 탈퇴 마무리 상태로)
 */
export const metadata: Metadata = { title: "가입/로그인" }

type SearchParams = Record<string, string | string[] | undefined>
type Props = { searchParams: Promise<SearchParams> }

const PREVIEWS: ReadonlyArray<NonNullable<SignInPreview>> = ["error", "sent", "link-expired", "new-user", "deletion-incomplete"]

export default function Page({ searchParams }: Props) {
  return (
    <ScreenSuspense fallback={<Fallback />}>
      <Screen searchParams={searchParams} />
    </ScreenSuspense>
  )
}

function Fallback() {
  return (
    <div className="px-4">
      <FormSkeleton fields={2} className="mx-auto mt-16 max-w-md" />
    </div>
  )
}

async function Screen({ searchParams }: Props) {
  const sp = await searchParams
  const state = getPreviewState(sp)
  if (state === "loading") return <Fallback />
  const preview = (PREVIEWS as readonly string[]).includes(state ?? "")
    ? (state as SignInPreview)
    : // the auth callback failed (expired or used link, canceled OAuth): QA-W0-01
      isLoginError(sp.error)
      ? "link-expired"
      : null
  const next = safeNextPath(sp.next)

  return (
    <div className="px-4 pb-16">
      <Card className="mx-auto mt-16 max-w-md gap-6 p-8">
        <header className="space-y-1">
          <h1 className="text-2xl leading-8 font-bold">가입/로그인</h1>
          {/* [UI-가정] sub copy */}
          <p className="text-sm leading-5 text-muted-foreground">
            처음이면 바로 가입돼요. 비밀번호 없이 이메일 링크나 Google 계정으로 들어와요.
          </p>
        </header>
        <SignInForm next={next} preview={preview} />
        <p className="text-sm leading-5 text-muted-foreground">
          가입할 때 다음 화면에서 약관과 개인정보 처리에 동의를 받아요.{" "}
          <Link href={routes.policies()} className="font-medium text-foreground underline underline-offset-4">
            처리방침·약관 보기
          </Link>
        </p>
      </Card>
    </div>
  )
}
