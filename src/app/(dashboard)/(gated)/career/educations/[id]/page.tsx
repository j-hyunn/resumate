import { redirect } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { routes } from "@/lib/routes"

/**
 * Retired S-34 교육 편집 page (UX v5.5: S-34 is the S-08 panel / add·edit modal, OD-C2). Old links land on S-08:
 * `/career/educations/new` → the 새 교육 modal, `/career/educations/{id}` → that education selected. S-08 says
 * "찾을 수 없는 항목이에요" for an unknown id.
 */
type Props = { params: Promise<{ id: string }> }

async function Redirect({ params }: Props): Promise<null> {
  const { id } = await params
  redirect(id === "new" ? routes.careerNew("education") : routes.careerItem("education", id))
}

export default function Page({ params }: Props) {
  return (
    <ScreenSuspense>
      <Redirect params={params} />
    </ScreenSuspense>
  )
}
