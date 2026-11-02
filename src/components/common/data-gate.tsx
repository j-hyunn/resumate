"use client"

/**
 * C-09 데이터 부족 게이트 (02 C-09, design-system 3.8). Rendered instead of running AI (no tokens
 * used). Decides from features.{feature}.ready / missing / next_action, plus (v5) ai_connection:
 * key invalid or a failed first chat turn → "직접 입력하기" + C-20 한 줄 + "AI 연결 확인".
 * (v5.3 A18) hint `project_fields` + next_action form + suggested_project_id → hint line with the
 * project name and "'{프로젝트명}' 마저 채우기" (PenLine, no C-19 badge, no AI chat) → S-10 with the
 * empty name / role focused (`?focus=fields`) and the return target remembered.
 */
import * as React from "react"
import Link from "next/link"
import { Circle, CircleCheck, ClipboardList, Info, PenLine } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { getProjectFieldsAction } from "@/lib/data/actions"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { AiErrorCode, DataReadiness, ReadinessFeatureKey, ReturnTargetFeature } from "@/types/db"
import { objectParticle } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { useAiConnection } from "./ai-connection-context"
import { markAiConnectReturn } from "./ai-connect-return"
import { AiErrorNotice } from "./ai-error-notice"
import { ProviderBadge } from "./provider-badge"
import { markCareerReturn } from "./return-target"

export function DataInsufficientGate({
  feature,
  featureLabel,
  returnFeature,
  readiness,
  applicationProjectId,
  applicationName,
  returnHref,
  returnParams,
  activeChatId,
  chatFailure,
  directInputHref,
  onSwitchToCultureFit,
  className,
}: {
  feature: Exclude<ReadinessFeatureKey, "culture_fit_interview">
  /** 인사이트 / 경력기술서 / 자기소개서 / 직무 면접 */
  featureLabel: string
  returnFeature: ReturnTargetFeature
  readiness: DataReadiness
  applicationProjectId: string
  /** {회사명 – 포지션명} for the C-10 banner */
  applicationName: string
  /** where C-10 "돌아가기" lands (this screen) */
  returnHref: string
  /** 진행 중 설정 to restore (면접 유형·질문 수, 자소서 문항 …) */
  returnParams?: Record<string, unknown>
  /** existing active writing chat → "이어서 대화하기" stays available when the key is invalid */
  activeChatId?: string | null
  /** v5: the first turn of a writing chat started from here failed (C-20 cause, e.g. key_invalid) */
  chatFailure?: AiErrorCode | null
  /** override for "직접 입력" target */
  directInputHref?: string
  /** S-20 직무 only: "컬처핏 면접은 지금 바로 연습할 수 있어요" */
  onSwitchToCultureFit?: () => void
  className?: string
}) {
  const titleId = React.useId()
  const connection = useAiConnection(readiness.ai_connection)
  const f = readiness.features[feature]
  // v5.3 A18: name / role missing on a project that otherwise counts
  const fieldsProjectId =
    !f.ready && f.next_action === "form" && f.hints?.includes("project_fields") ? (f.suggested_project_id ?? null) : null
  const [fieldsName, setFieldsName] = React.useState<{ id: string; name: string | null; role: string | null } | null>(null)
  React.useEffect(() => {
    if (!fieldsProjectId) return
    let alive = true
    void getProjectFieldsAction(fieldsProjectId).then((p) => {
      if (alive) setFieldsName({ id: fieldsProjectId, ...p })
    })
    return () => {
      alive = false
    }
  }, [fieldsProjectId])
  if (f.ready) return null
  const missing = f.missing ?? []
  const hints = f.hints ?? []
  // v5: key invalid (server already gives next_action = 'form') or the chat start failed
  const keyInvalid = connection?.key_status === "invalid"
  const noKey = connection != null && !connection.active_provider
  const showCause = !fieldsProjectId && (keyInvalid || Boolean(chatFailure))
  const blocked = !fieldsProjectId && (showCause || noKey)
  const nameLoaded = fieldsName && fieldsName.id === fieldsProjectId
  const projectName = nameLoaded ? (fieldsName.name ?? "이름 없는 프로젝트") : null
  // Q53-8 제목: 빈 칸 수는 projects.name·role로 계산, 읽기 전에는 기본 문구 [가정 명세]
  const fieldsTitle = !nameLoaded
    ? "빈 칸만 채우면 바로 쓸 수 있어요"
    : !fieldsName.name && !fieldsName.role
      ? "두 칸만 채우면 바로 쓸 수 있어요"
      : !fieldsName.name || !fieldsName.role
        ? "한 칸만 채우면 바로 쓸 수 있어요"
        : "빈 칸만 채우면 바로 쓸 수 있어요" // 이미 채워짐 (판정 뒤 저장): 칸 수를 말하지 않는다 [UI-가정]
  const blockedCode: AiErrorCode = chatFailure ?? "key_invalid"
  const target = { application_project_id: applicationProjectId, feature: returnFeature, params: returnParams, application_name: applicationName, href: returnHref }
  const remember = () => markCareerReturn(target)

  // [UI-가정] "직접 입력": first draft item edit, else a new form
  const draftIds = readiness.draft_item_ids
  const direct =
    directInputHref ??
    (draftIds.projects[0]
      ? routes.project(draftIds.projects[0])
      : draftIds.experiences[0]
        ? routes.experience(draftIds.experiences[0])
        : missing.includes("complete_experience")
          ? routes.experienceNew()
          : routes.projectNew())

  const chatHref =
    f.next_action === "form"
      ? routes.experienceNew()
      : routes.writingChatNew({
          mode: f.suggested_mode ?? "new_project",
          project_id: f.suggested_mode === "augment_project" ? f.suggested_project_id : undefined,
          application_project_id: applicationProjectId,
          feature: returnFeature,
        })

  return (
    <Card className={cn("max-w-xl gap-4 p-6", className)} role="region" aria-labelledby={titleId}>
      <div className="grid size-10 place-items-center rounded-full bg-primary-subtle">
        <ClipboardList className="size-5 text-primary" aria-hidden />
      </div>
      <h2 id={titleId} className="text-lg leading-7 font-semibold">
        {fieldsProjectId ? (
          fieldsTitle
        ) : (
          <>
            {featureLabel}
            {objectParticle(featureLabel)} 만들려면 커리어가 조금 더 필요해요. AI와 대화하며 바로 채워 볼까요?
          </>
        )}
      </h2>

      <ul className="space-y-2">
        <GateRow
          met={!missing.includes("complete_experience")}
          text="완료된 경력 1건이 필요해요(교육만으로는 부족해요)"
          count={readiness.counts.complete_experiences}
        />
        <GateRow
          met={!missing.includes("complete_project")}
          text="완료된 프로젝트 1건이 필요해요"
          count={readiness.counts.complete_projects}
        />
      </ul>

      {hints.includes("complete_project_detail") ? (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            프로젝트는 있지만 완료된 상세 내용이 없어요(제목·상황·행동)
            <span className="ml-1 text-xs tabular-nums">현재 {readiness.counts.projects_without_complete_detail}건</span>
          </span>
        </p>
      ) : null}

      {fieldsProjectId ? (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {projectName ? (
              <>
                &lsquo;<span className="font-medium text-foreground">{projectName}</span>&rsquo;
              </>
            ) : (
              <Skeleton className="inline-block h-4 w-24 align-middle" />
            )}
            에 이름이나 역할이 비어 있어요. 채우면 바로 쓸 수 있어요
          </span>
        </p>
      ) : null}

      {showCause ? (
        // v5 (02 C-09 "키가 없거나 무효이거나 대화 시작이 실패할 때"): C-20 원인 한 줄 + AI 연결 확인
        <div className="space-y-1">
          <AiErrorNotice code={blockedCode} size="inline" />
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            키를 확인하면 AI와 대화로 채울 수 있어요
            <Button variant="link" size="sm" asChild className="h-auto px-0">
              <Link href={routes.aiConnection(connection?.active_provider ?? undefined)} onClick={() => markAiConnectReturn({ href: returnHref })}>
                AI 연결 확인
              </Link>
            </Button>
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {fieldsProjectId ? (
            <>
              <Button asChild>
                <Link
                  href={routes.project(fieldsProjectId, { focus: "fields", application_project_id: applicationProjectId })}
                  onClick={remember}
                  aria-label={`'${projectName ?? "이름 없는 프로젝트"}' 마저 채우기`}
                >
                  <PenLine aria-hidden />
                  {/* [UI-가정] G-32: only the name part is truncated */}
                  <span>
                    &lsquo;<span className="inline-block max-w-[14em] truncate align-bottom">{projectName ?? "…"}</span>&rsquo; 마저 채우기
                  </span>
                </Link>
              </Button>
              {direct !== routes.project(fieldsProjectId) ? (
                <Button asChild variant="link">
                  <Link href={direct} onClick={remember}>
                    직접 입력
                  </Link>
                </Button>
              ) : null}
            </>
          ) : blocked ? (
            <>
              <Button asChild>
                <Link href={direct} onClick={remember}>
                  직접 입력하기
                </Link>
              </Button>
              {activeChatId ? (
                <Button asChild variant="outline">
                  <Link href={routes.writingChat(activeChatId)} onClick={remember}>
                    이어서 대화하기
                  </Link>
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button asChild>
                <Link href={chatHref} onClick={remember}>
                  {f.next_action === "form" ? "경력 먼저 입력하기" : "AI와 대화하며 채우기"}
                </Link>
              </Button>
              {f.next_action === "writing_chat" ? <ProviderBadge connection={connection} /> : null}
              {/* UQ-16: hide the secondary link when it would go where the primary goes */}
              {direct !== chatHref ? (
                <Button asChild variant="link">
                  <Link href={direct} onClick={remember}>
                    직접 입력
                  </Link>
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {onSwitchToCultureFit ? (
        <>
          <Separator />
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">컬처핏 면접은 지금 바로 연습할 수 있어요</p>
            <Button variant="outline" size="sm" onClick={onSwitchToCultureFit}>
              컬처핏 면접으로 바꾸기
            </Button>
          </div>
        </>
      ) : null}

      <p className="text-sm text-muted-foreground">
        AI 분석은 실행하지 않았어요(토큰을 쓰지 않았어요). 커리어를 채우면 이 화면으로 다시 돌아와요
      </p>
    </Card>
  )
}

function GateRow({ met, text, count }: { met: boolean; text: string; count: number }) {
  return (
    <li className="flex items-start gap-2 text-base">
      {met ? (
        <CircleCheck className="mt-1 size-4 shrink-0 text-success" aria-hidden />
      ) : (
        <Circle className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="flex-1">
        {text}
        <span className="sr-only">{met ? " (충족)" : " (미충족)"}</span>
      </span>
      <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">현재 {count}건</span>
    </li>
  )
}
