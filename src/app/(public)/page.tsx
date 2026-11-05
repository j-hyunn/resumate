import Link from "next/link"
import { KanbanSquare, Layers, Sparkles, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { routes } from "@/lib/routes"

/**
 * S-01 랜딩 (FL-09 시작). design-system 6 A1: display 제목 + 가치 제안 3줄(아이콘 + 문구,
 * md 3열) + 주 버튼 "시작하기". 일러스트·스크린샷 없음(G-12). Static, no data.
 */

// 02 S-01 v5: "커리어를 정리하고 / 자기소개서를 모아 지원 현황 보드로 관리하고 / 원하면 내 AI 키를 연결해 인사이트·서류·면접까지"
const VALUE_PROPS: ReadonlyArray<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Layers,
    title: "커리어를 정리하고",
    // [UI-가정] supporting line under each value prop
    body: "경력·교육·프로젝트를 STAR로 정리해요. 키 없이 폼으로 바로 쓸 수 있어요",
  },
  {
    icon: KanbanSquare,
    title: "자기소개서를 모아 지원 현황 보드로 관리하고",
    body: "지원한 공고를 모아 두고, 전형 단계를 보드에서 옮기며 한눈에 관리해요",
  },
  {
    // [UI-가정] icon for the AI line (design-system lists Layers/Briefcase/KanbanSquare for the v1 lines)
    icon: Sparkles,
    title: "원하면 내 AI 키를 연결해 인사이트·서류·면접까지",
    body: "내 커리어를 근거로 강점·보완점, 서류 초안, 모의 면접을 준비해요",
  },
]

export default function Page() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 lg:px-6 lg:py-24">
      <section className="mx-auto max-w-2xl space-y-4 text-center">
        {/* [UI-가정] headline copy (spec gives the value-prop lines only) */}
        <h1 className="text-[1.75rem] leading-9 font-bold">
          한 번 정리한 커리어로
          <br />
          지원마다 근거 있게 준비하세요
        </h1>
        <p className="text-base leading-[1.6] text-muted-foreground">
          Resumate는 내가 입력한 커리어만 근거로 써요. 없는 경험은 만들지 않아요.
        </p>
        {/* 02 S-01 v5 */}
        <p className="text-sm leading-5 text-muted-foreground">
          AI는 본인 키(OpenAI·Gemini·Claude)로 쓰고, Gemini는 무료 키로 시작할 수 있어요
        </p>
        <div className="pt-2">
          <Button asChild size="lg">
            <Link href={routes.signIn()}>시작하기</Link>
          </Button>
        </div>
      </section>

      <ul className="mt-16 grid gap-4 md:grid-cols-3" aria-label="Resumate로 할 수 있는 일">
        {VALUE_PROPS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="space-y-2 rounded-lg border bg-card p-5">
            <div className="grid size-10 place-items-center rounded-full bg-muted">
              <Icon className="size-5 text-muted-foreground" aria-hidden />
            </div>
            <h2 className="text-base leading-6 font-semibold">{title}</h2>
            <p className="text-base leading-[1.6] text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>

      <footer className="mt-16 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <span>이미 계정이 있나요?</span>
        <Link href={routes.signIn()} className="font-medium text-foreground underline-offset-4 hover:underline">
          로그인
        </Link>
        <span aria-hidden>·</span>
        <Link href={routes.policies("terms")} className="underline-offset-4 hover:underline">
          이용약관
        </Link>
        <span aria-hidden>·</span>
        <Link href={routes.policies("privacy")} className="underline-offset-4 hover:underline">
          개인정보 처리방침
        </Link>
      </footer>
    </div>
  )
}
