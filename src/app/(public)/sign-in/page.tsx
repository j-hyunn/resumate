import Link from "next/link"
import type { Metadata } from "next"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { FormSkeleton } from "@/components/common/state-views"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { SignInForm, type SignInPreview } from "@/components/account/sign-in-form"
import { safeNextPath } from "@/lib/routes"
import { getPreviewState } from "@/lib/preview-state"
import { isLoginError } from "@/lib/contracts/routes"
import { routes } from "@/lib/routes"

/**
 * S-02 가입/로그인 (F-COM-01, FL-09). 로그인 후 S-08 또는 원래 URL(`?next=`), 신규면 S-03.
 * v5.3 A7: 탈퇴 미완료 계정은 S-03·원래 URL·S-08보다 먼저 S-25 탈퇴 마무리(/settings/withdraw/finalize).
 * v5.7 (D-09 변경 2026-11-04): Google 로그인만. `?error=auth_callback`(Google 취소·로그인 처리 실패)은
 * 상단 경고 "로그인을 마치지 못했어요"를 보여 준다 (운영 포함).
 * ?state= : loading · error(Google 로그인 시작 실패) · login-error(콜백 실패 경고) · new-user ·
 *           deletion-incomplete(로그인하면 탈퇴 마무리 상태로)
 */
export const metadata: Metadata = { title: "가입/로그인" }

type SearchParams = Record<string, string | string[] | undefined>
type Props = { searchParams: Promise<SearchParams> }

const PREVIEWS: ReadonlyArray<NonNullable<SignInPreview>> = ["error", "login-error", "new-user", "deletion-incomplete"]

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
      <FormSkeleton fields={1} className="mx-auto mt-16 max-w-md" />
    </div>
  )
}

async function Screen({ searchParams }: Props) {
  const sp = await searchParams
  const state = getPreviewState(sp)
  if (state === "loading") return <Fallback />
  const preview = (PREVIEWS as readonly string[]).includes(state ?? "")
    ? (state as SignInPreview)
    : // the auth callback failed (canceled Google consent or sign-in failure): QA-W0-01
      isLoginError(sp.error)
      ? "login-error"
      : null
  const next = safeNextPath(sp.next)

  return (
    <div className="px-4 pb-16">
      <Card className="mx-auto mt-16 max-w-md gap-0 p-8">
        <SignInForm
          next={next}
          preview={preview}
          intro={
            <header>
              <h1 className="text-2xl leading-8 font-bold">가입/로그인</h1>
              {/* [UI-가정] sub copy (02 S-02 v5.7: 처음이면 바로 가입되고, Google 계정으로 들어온다는 한 줄) */}
              <p className="mt-2 text-base leading-[1.6] text-muted-foreground">
                처음이면 바로 가입돼요. Google 계정으로 들어와요.
              </p>
            </header>
          }
          footnote={
            <p className="mt-6 text-center text-sm leading-5 text-muted-foreground">
              가입할 때 다음 화면에서 약관과 개인정보 처리에 동의를 받아요.{" "}
              {/* [UI-가정] max-md:h-auto: keep the inline link on the text line (default size adds max-md:h-11) */}
              <Button variant="link" asChild className="h-auto p-0 text-sm max-md:h-auto">
                <Link href={routes.policies()}>처리방침·약관 보기</Link>
              </Button>
            </p>
          }
        />
      </Card>
    </div>
  )
}
