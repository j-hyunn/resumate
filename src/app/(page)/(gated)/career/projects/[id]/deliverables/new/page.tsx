import { DeliverableRoute } from "@/components/career/deliverable/deliverable-route"

// S-44 새 산출물 (L-02, 행 없음 — 첫 저장 또는 첫 AI 메시지 때 생성). `[id]` = 부모 독립 프로젝트.
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default function Page({ params, searchParams }: Props) {
  return <DeliverableRoute target={params.then((p) => ({ kind: "new" as const, projectId: p.id }))} searchParams={searchParams} />
}
