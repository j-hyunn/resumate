import Link from "next/link"
import { Wrench } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { PageCrumbs } from "@/components/common/shell/breadcrumbs"
import { PageHeader } from "@/components/common/basics"
import { EmptyState } from "@/components/common/state-views"
import { Button } from "@/components/ui/button"
import { getPreviewState } from "@/lib/preview-state"
import { listSkills } from "@/lib/data/career"
import { routes } from "@/lib/routes"
import { SkillAdd } from "@/components/career/skill-add"
import { careerPreviewView } from "@/components/career/screen-state"

// S-12 스킬 목록 (skills.name, 연결 프로젝트 수, is_manual)
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
  const preview = careerPreviewView(state, "list")
  const skills = preview || state === "empty" ? [] : await listSkills()
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageCrumbs items={[{ label: "커리어", href: routes.career() }, { label: "스킬" }]} />
      {preview ?? (
        <>
          <PageHeader title="스킬" description="프로젝트의 사용 기술 태그와 직접 추가한 스킬이에요" />
          <SkillAdd />
          {skills.length === 0 ? (
            // [UI-가정] S-12 empty copy ("v3와 같음")
            <EmptyState
              icon={Wrench}
              title="아직 스킬이 없어요"
              description="프로젝트에 사용 기술을 붙이거나 직접 추가해 보세요"
              actions={
                <Button asChild variant="outline">
                  <Link href={routes.career()}>커리어로 가기</Link>
                </Button>
              }
            />
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label="스킬 목록">
              {skills.map((s) => (
                <li key={s.id}>
                  <Badge variant="secondary" className="h-8 gap-2 px-3 text-sm">
                    {s.name}
                    <span className="text-xs font-medium text-muted-foreground tabular-nums">프로젝트 {s.project_count}</span>
                    {s.is_manual ? <span className="text-xs text-muted-foreground">· 직접 추가</span> : null}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
