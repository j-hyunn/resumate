import { notFound } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { getPreviewState } from "@/lib/preview-state"
import { getApplicationProject } from "@/lib/data/applications"
import { applicationDisplayName } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { loadChatView } from "@/components/career/actions"
import { ChatScreen } from "@/components/career/writing-chat/chat-screen"
import { careerPreviewView } from "@/components/career/screen-state"

// S-36 AI 작성 대화 (진행 / 이어 하기 / 저장 완료 / 폼 전환 완료).
// ?state= loading | error | not-found | ai-failed | ai-failed-input | ai-failed-timeout
//         | save-failed | message-limit | ai-locked | key-invalid | key-check | key-missing | ai-failed-*(C-20 7 causes)
//         | v5.3: request-wait (A14 바로 실패 + 카운트다운; ai-waiting = 같은 값의 별칭) | consent-required (보내기 → C-21)
//         그만둔 대화 = fixture wc 4 (status abandoned)
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ params, searchParams }: Props) {
  const { id } = await params
  const state = getPreviewState(await searchParams)
  const preview = careerPreviewView(state, "chat")
  const crumbs = <PageCrumbs items={[{ label: "커리어", href: routes.career() }, { label: "AI 작성 대화" }]} />
  if (preview)
    return (
      <>
        {crumbs}
        {preview}
      </>
    )
  const [view] = await Promise.all([loadChatView(id)])
  if (!view) notFound()
  const target = view.chat.return_target
  const ap = target ? await getApplicationProject(target.application_project_id) : null
  return (
    <>
      {crumbs}
      <ChatScreen
        key={`${view.chat.id}-${view.chat.updated_at}-${view.chat.message_count}`}
        initialView={view}
        applicationName={ap ? applicationDisplayName(ap.name, ap.name_source, ap.created_at) : null}
      />
    </>
  )
}
