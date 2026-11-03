import { redirect } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { routes } from "@/lib/routes"

/**
 * Retired S-35 상세 내용 (v5.5 CR-2: one STAR per project, on S-10). `/career/projects/{id}/details/…` → S-10;
 * a STAR `?focus=` (C-02 "원본으로 이동") is kept so S-10 focuses that 칸.
 */
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }
const STAR_FIELDS = ["situation", "task", "action", "result", "learnings"] as const
const STAR: readonly string[] = STAR_FIELDS

async function Redirect({ params, searchParams }: Props): Promise<null> {
  const { id } = await params
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const focus = one(sp.focus)
  // known queries carry over (QA UQ-S10-9): STAR focus (C-02), S-16 관련 요건, the open chat
  redirect(
    routes.projectPage(id, {
      focus: focus && STAR.includes(focus) ? (focus as (typeof STAR_FIELDS)[number]) : undefined,
      requirement_id: one(sp.requirement_id),
      chat: one(sp.chat),
    }),
  )
}

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Redirect params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}
