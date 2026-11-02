import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { FormSkeleton } from "@/components/common/state-views"
import { WithdrawFinalizeCard } from "@/components/account/withdraw-finalize-card"
import { getAccountDeletionState } from "@/lib/data/account"
import { getPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"

/**
 * S-25 탈퇴 마무리 상태 (02 S-25 v5.3 · FL-07 · A7; design-system 6 A1 (v3), G-38).
 * 셸 사이드바·메뉴 없이 S-02·S-03과 같은 셸 밖 배치, 약관 동의 게이트 밖. 다른 메뉴로 갈 수 없다 [가정].
 * 들어오는 길: S-25 "탈퇴하기"가 `account_deletion_incomplete`를 받음 / 미완료 계정으로 로그인(S-02) /
 * 셸 가드(대시보드 어디서든) → /settings/withdraw → 여기.
 * `get_account_deletion_state()`가 deletion_incomplete가 아니면 S-25 정상 화면으로 돌려보낸다.
 * ?state= : loading · deletion-incomplete(실데이터 없이 카드) · save-failed(마무리 요청 실패 한 줄)
 */
export const metadata: Metadata = { title: "회원 탈퇴" }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

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
  const state = getPreviewState(await searchParams)
  if (state === "loading") return <Fallback />
  // only these dev previews render the card without the real state (UQ-453)
  const isPreview = state === "deletion-incomplete" || state === "save-failed"
  if (!isPreview && (await getAccountDeletionState()) !== "deletion_incomplete") redirect(routes.withdraw())
  return (
    <div className="px-4 pb-16">
      <WithdrawFinalizeCard failFinalize={state === "save-failed"} />
    </div>
  )
}
