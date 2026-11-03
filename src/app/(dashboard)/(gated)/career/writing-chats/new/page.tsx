import { redirect } from "next/navigation"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { routes } from "@/lib/routes"

/**
 * Retired S-36 새 대화 (v5.5 CR-5 · v5.6 PA-3). `project_id` → that project's S-10 (the panel starts a new chat
 * there); `experience_id` / `education_id` → S-10 새 프로젝트; otherwise S-08. The C-09 return target stays in the
 * browser session (return-target.ts), which S-10 reads.
 */
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

async function Redirect({ searchParams }: Props): Promise<null> {
  const sp = await searchParams
  const projectId = one(sp.project_id)
  const experience = one(sp.experience_id)
  const education = one(sp.education_id)
  // S-16 관련 요건 carries over (QA UQ-S10-9)
  const requirementId = one(sp.requirement_id)
  const req = (href: string) => (requirementId ? `${href}${href.includes("?") ? "&" : "?"}requirement_id=${encodeURIComponent(requirementId)}` : href)
  if (projectId) redirect(routes.projectPage(projectId, { requirement_id: requirementId }))
  if (experience) redirect(req(routes.projectPageNew({ experience })))
  if (education) redirect(req(routes.projectPageNew({ education })))
  redirect(routes.career())
}

export default function Page({ searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Redirect searchParams={searchParams} />
    </ScreenSuspense>
  )
}
