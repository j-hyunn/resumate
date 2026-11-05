"use client"

/**
 * C-10 복귀 배너 (02 C-10, design-system 3.9). Rendered by the shell on every 커리어 screen
 * (S-04, S-08~S-12, S-34~S-36). Re-checks readiness after each save:
 * career forms call `notifyCareerSaved()` after a successful save.
 */
import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { CornerUpLeft, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { DataReadiness, ReadinessFeatureKey, ReturnTargetFeature } from "@/types/db"
import { getDataReadinessAction } from "@/lib/data/actions"
import { usePreviewState } from "./preview-state-client"
import { CAREER_SAVED_EVENT, notifyCareerSaved, readCareerReturn, type StoredReturnTarget } from "./return-target"
import { routes } from "@/lib/routes"

export const RETURN_FEATURE_LABELS: Record<ReturnTargetFeature, string> = {
  insight: "인사이트",
  career_description: "경력기술서",
  cover_letter: "자소서 문항 답변", // D-UX-23 (U36-2)
  job_interview: "직무 면접",
}

export const RETURN_FEATURE_READINESS: Record<ReturnTargetFeature, Exclude<ReadinessFeatureKey, "culture_fit_interview">> = {
  insight: "insight",
  career_description: "draft",
  cover_letter: "draft",
  job_interview: "job_interview",
}

/** 으로/로 — // [UI-가정] spec writes "{기능}으로" literally */
function directionParticle(word: string): string {
  const last = word.charCodeAt(word.length - 1)
  if (last < 0xac00 || last > 0xd7a3) return "(으)로"
  const jong = (last - 0xac00) % 28
  return jong === 0 || jong === 8 ? "로" : "으로"
}

const SAVED_EVENT = CAREER_SAVED_EVENT
export { notifyCareerSaved }

/**
 * Next step of the FL-13 loop after a career save (UQ-4), v5.6 routes. Re-judged readiness says
 * `next_action = 'writing_chat'` → the suggested project's S-10 (its Resumate AI 패널 starts the chat; the return
 * target stays in the session), or — a new project — S-10 새 페이지 under the just-saved experience. No suggestion
 * and no experience → null (C-09 offers C-23 소속 선택 instead). Null when ready or still `form`.
 */
export function gateContinuationHref(target: StoredReturnTarget, readiness: DataReadiness | null): string | null {
  const f = readiness?.features[RETURN_FEATURE_READINESS[target.feature]]
  if (!f || f.ready) return null
  // DM §6 v4.4: writing_chat + suggested_project_id → that S-10; create_project → S-10 새 페이지 under the
  // just-saved experience (none known → null, C-09 offers C-23)
  if (f.next_action === "writing_chat" && f.suggested_project_id) return routes.projectPage(f.suggested_project_id, { focus: "star" })
  if (f.next_action === "create_project" || f.next_action === "writing_chat")
    return target.experience_id ? routes.projectPageNew({ experience: target.experience_id }) : null
  return null
}

/** S-10 (`/career/projects/{id}` or `/new`): the page's own panel is the next step — no second link (UQ-24). */
function onProjectPage(pathname: string): boolean {
  return /^\/career\/projects\/[^/]+$/.test(pathname)
}

/**
 * For A2 screens (S-09 save-complete state, S-36 save-complete state): current return
 * target, re-judged readiness and the next step. Call `recheck()` after a save.
 */
export function useGateContinuation() {
  const [target, setTarget] = React.useState<StoredReturnTarget | null>(null)
  const [readiness, setReadiness] = React.useState<DataReadiness | null>(null)
  const recheck = React.useCallback(async () => {
    const t = readCareerReturn()
    setTarget(t)
    if (t) setReadiness(await getDataReadinessAction())
  }, [])
  React.useEffect(() => {
    let alive = true
    const t = readCareerReturn()
    if (t)
      void getDataReadinessAction().then((r) => {
        if (!alive) return
        setTarget(t)
        setReadiness(r)
      })
    return () => {
      alive = false
    }
  }, [])
  const ready = target && readiness ? Boolean(readiness.features[RETURN_FEATURE_READINESS[target.feature]].ready) : false
  return {
    target,
    readiness,
    ready,
    /** "{기능}으로 돌아가기" target when ready */
    returnHref: target?.href ?? null,
    /** S-10 next step when not ready and next_action = writing_chat */
    continueHref: target ? gateContinuationHref(target, readiness) : null,
    recheck,
  }
}

const PREVIEW_TARGET: StoredReturnTarget = {
  application_project_id: "preview",
  feature: "insight",
  application_name: "그린뱅크 – 결제 백엔드 엔지니어",
  href: "/applications",
  created_at: new Date(0).toISOString(),
}

export function ReturnBanner({ target: targetProp, placement }: { target?: StoredReturnTarget | null; placement?: "shell" | "page" }) {
  const pathname = usePathname()
  // L-02 pages (S-10 · S-44, /dev/page-shell) draw the banner in their ShellBanners slot
  const inPageShell = placement ? placement === "page" : /^\/career\/(projects|deliverables)\//.test(pathname) || pathname.startsWith("/dev/page-shell")
  const preview = usePreviewState()
  const [target, setTarget] = React.useState<StoredReturnTarget | null>(null)
  const [readiness, setReadiness] = React.useState<DataReadiness | null>(null)
  const [checking, setChecking] = React.useState(false)

  React.useEffect(() => {
    const load = () => setTarget(targetProp ?? readCareerReturn() ?? (preview === "return-banner" ? PREVIEW_TARGET : null))
    load()
    window.addEventListener("resumate:return-target", load)
    return () => window.removeEventListener("resumate:return-target", load)
  }, [targetProp, preview])

  React.useEffect(() => {
    if (!target) return
    let alive = true
    const check = async () => {
      setChecking(true)
      const r = await getDataReadinessAction()
      if (alive) {
        setReadiness(r)
        setChecking(false)
      }
    }
    void check()
    const onSaved = () => void check()
    window.addEventListener(SAVED_EVENT, onSaved)
    return () => {
      alive = false
      window.removeEventListener(SAVED_EVENT, onSaved)
    }
  }, [target, pathname])

  if (!target) return null
  const label = RETURN_FEATURE_LABELS[target.feature]
  const feature = readiness?.features[RETURN_FEATURE_READINESS[target.feature]]
  const ready = feature?.ready ?? false
  const remaining = feature?.missing?.length ?? 0
  // UQ-24: on S-10 the panel itself is the next step — never offer "AI와 대화하며 채우기" there
  const continueHref = onProjectPage(pathname) ? null : gateContinuationHref(target, readiness)

  return (
    <div
      className={
        inPageShell
          ? // L-02 (UQ-S10-12): a plain banner inside ShellBanners (the card doesn't scroll, no sticky offset)
            "flex flex-wrap items-center gap-3 rounded-lg border border-info/20 bg-info-subtle px-3 py-2 text-sm text-info-subtle-foreground"
          : "sticky top-16 z-10 flex flex-wrap items-center gap-3 border-b border-info/20 bg-info-subtle px-4 py-2.5 text-sm text-info-subtle-foreground lg:px-6"
      }
      role="region"
      aria-label="원래 화면으로 돌아가기"
    >
      <CornerUpLeft className="size-4 shrink-0" aria-hidden />
      <span className="font-medium">
        {target.application_name} · {label}
        {directionParticle(label)} 돌아가기
      </span>
      <span aria-live="polite">
        {checking || !readiness ? (
          <Loader2 className="size-3.5 animate-spin" aria-label="준비 상태 확인 중" />
        ) : ready ? (
          <Badge variant="success">준비됨</Badge>
        ) : (
          <Badge variant="outline">아직 필요 {remaining}개</Badge>
        )}
      </span>
      {continueHref ? (
        <Button asChild size="sm" className="ml-auto">
          <Link href={continueHref}>AI와 대화하며 채우기</Link>
        </Button>
      ) : null}
      <Button asChild size="sm" variant={ready ? "default" : "outline"} className={continueHref ? undefined : "ml-auto"}>
        {/* the destination screen calls consumeReturnParams() to restore settings and clear the target */}
        <Link href={target.href}>
          돌아가기
        </Link>
      </Button>
    </div>
  )
}
