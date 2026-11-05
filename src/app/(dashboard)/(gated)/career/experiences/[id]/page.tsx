import { redirect } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { routes } from "@/lib/routes"

/**
 * Retired S-09 경력 편집 page (UX v5.5: S-09 is the S-08 panel / add·edit modal, OD-C2). Old links land on S-08:
 * `/career/experiences/new` → the 새 경력 modal, `/career/experiences/{id}` → that experience selected. The old
 * `?achievement=` (S-11, retired with CR-11) is dropped. S-08 says "찾을 수 없는 항목이에요" for an unknown id.
 */
type Props = { params: Promise<{ id: string }> }

async function Redirect({ params }: Props): Promise<null> {
  const { id } = await params
  redirect(id === "new" ? routes.careerNew("experience") : routes.careerItem("experience", id))
}

export default function Page({ params }: Props) {
  return (
    <ScreenSuspense>
      <Redirect params={params} />
    </ScreenSuspense>
  )
}
