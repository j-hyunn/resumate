import { DeliverableRoute } from "@/components/career/deliverable/deliverable-route"

// S-44 산출물 상세 (L-02). ?chat= opens that panel chat. ?state= see DeliverableRoute.
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default function Page({ params, searchParams }: Props) {
  return <DeliverableRoute target={params.then((p) => ({ kind: "existing" as const, id: p.id }))} searchParams={searchParams} />
}
