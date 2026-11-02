import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { getPreviewState } from "@/lib/preview-state"
import { getProfile } from "@/lib/data/career"
import { routes } from "@/lib/routes"
import { ProfileForm } from "@/components/career/profile-form"
import { careerPreviewView } from "@/components/career/screen-state"

// S-04 기본 프로필 편집
type Props = { params: Promise<Record<string, never>>; searchParams: Promise<Record<string, string | string[] | undefined>> }

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

async function Screen({ searchParams }: Props) {
  const state = getPreviewState(await searchParams)
  const preview = careerPreviewView(state)
  const profile = preview ? null : await getProfile()
  return (
    <>
      <PageCrumbs items={[{ label: "커리어", href: routes.career() }, { label: "기본 프로필" }]} />
      {preview ?? (profile ? <ProfileForm key={profile.updated_at} profile={profile} /> : null)}
    </>
  )
}
