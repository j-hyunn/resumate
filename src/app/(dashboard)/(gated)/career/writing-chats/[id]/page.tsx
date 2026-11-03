import { redirect } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { getWritingChat } from "@/lib/data/career-v45"
import { routes } from "@/lib/routes"

/**
 * Retired S-36 AI 작성 대화 (v5.5 CR-5): a chat now lives in its project's S-10 panel. Old links go to
 * S-10 `?chat={id}`; a chat that is gone (or has no project) goes to S-08.
 */
type Props = { params: Promise<{ id: string }> }

async function Redirect({ params }: Props): Promise<null> {
  const { id } = await params
  const chat = await getWritingChat(id).catch(() => null)
  if (chat?.project_id && !chat.project_deliverable_id) redirect(routes.projectPage(chat.project_id, { chat: chat.id }))
  if (chat?.project_deliverable_id) redirect(routes.deliverable(chat.project_deliverable_id, { chat: chat.id }))
  redirect(routes.career())
}

export default function Page({ params }: Props) {
  return (
    <ScreenSuspense>
      <Redirect params={params} />
    </ScreenSuspense>
  )
}
