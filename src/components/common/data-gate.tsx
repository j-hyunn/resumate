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
import { SettingsLink } from "@/components/common/shell/settings-dialog"
import { useAiConnection } from "./ai-connection-context"
import { markAiConnectReturn } from "./ai-connect-return"
import { AiErrorNotice } from "./ai-error-notice"
import { ProviderBadge } from "./provider-badge"
import { markCareerReturn } from "./return-target"
import { useChooseProjectAffiliation } from "./choose-project-affiliation"

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
  /** 인사이트 / 경력기술서 / 자소서 문항 답변 / 직무 면접 */
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
  // C-09 v5.6 "form + suggested_project_id" (AI can't be used, DM §6 v4.4 ②·③): hints pick the target —
  // project_fields → S-43 프로젝트 내용 편집, project_star → S-10 빈 STAR 칸. Never a chat.
  const fillProjectId = !f.ready && f.next_action === "form" ? (f.suggested_project_id ?? null) : null
  const fillKind: "fields" | "star" | null = fillProjectId ? (f.hints?.includes("project_fields") ? "fields" : "star") : null
  const [fillName, setFillName] = React.useState<{ id: string; name: string | null } | null>(null)
  React.useEffect(() => {
    if (!fillProjectId) return
    let alive = true
    void getProjectFieldsAction(fillProjectId).then((p) => {
      if (alive) setFillName({ id: fillProjectId, name: p.name })
    })
    return () => {
      alive = false
    }
  }, [fillProjectId])
  // C-23 소속 선택 (before the early return: hooks keep their order)
  const choose = useChooseProjectAffiliation()
  if (f.ready) return null
  const missing = f.missing ?? []
  const hints = f.hints ?? []
  // v5: key invalid (server already gives next_action = 'form') or the chat start failed
  const keyInvalid = connection?.key_status === "invalid"
  const noKey = connection != null && !connection.active_provider
  // the C-20 cause line also sits above "'{이름}' 마저 채우기" when the key is the reason (C-09 키 행)
  const showCause = keyInvalid || Boolean(chatFailure)
  const blocked = !fillProjectId && (showCause || noKey)
  const nameLoaded = fillName && fillName.id === fillProjectId
  const projectName = nameLoaded ? (fillName.name ?? "이름 없는 프로젝트") : null
  const blockedCode: AiErrorCode = chatFailure ?? "key_invalid"
  const target = { application_project_id: applicationProjectId, feature: returnFeature, params: returnParams, application_name: applicationName, href: returnHref }
  const remember = () => markCareerReturn(target)

  // 보조 링크 "직접 입력" (C-09): a draft item → that item (경력·교육 → S-08, 프로젝트 → S-10, which sends a standalone
  // id on to S-43), none → C-23 소속 선택 (`null`) [UI-가정: C-22 대신 C-23 — 이 게이트는 프로젝트가 부족한 경우]
  const draftIds = readiness.draft_item_ids
  const direct: string | null =
    directInputHref ??
    (draftIds.projects[0]
      ? routes.projectPage(draftIds.projects[0], { focus: "star" })
      : draftIds.experiences[0]
        ? routes.careerItem("experience", draftIds.experiences[0])
        : draftIds.educations[0]
          ? routes.careerItem("education", draftIds.educations[0])
          : missing.includes("complete_experience")
            ? routes.experienceNew()
            : null)

  // 주 버튼 (C-09 v5.6): writing_chat + suggested → S-10 (패널이 새 대화), create_project → C-23 (`null`),
  // form without a suggestion → "경력 먼저 입력하기" (S-09 새 경력) when the experience is missing, else 직접 입력
  const chatHref: string | null =
    f.next_action === "writing_chat" && f.suggested_project_id
      ? routes.projectPage(f.suggested_project_id, { focus: "star" })
      : f.next_action === "form"
        ? missing.includes("complete_experience")
          ? routes.experienceNew()
          : direct
        : null
  const chatLabel =
    f.next_action === "form" ? (missing.includes("complete_experience") ? "경력 먼저 입력하기" : "직접 입력하기") : "AI와 대화하며 채우기"
  const go = (href: string | null, label: React.ReactNode, variant?: "outline" | "link") =>
    href ? (
      <Button asChild variant={variant}>
        <Link href={href} onClick={remember}>
          {label}
        </Link>
      </Button>
    ) : (
      <Button
        variant={variant}
        disabled={choose.loading}
        onClick={() => {
          remember()
          choose.open()
        }}
      >
        {label}
      </Button>
    )
  const fillHref = fillProjectId
    ? fillKind === "fields"
      ? routes.careerItem("project", fillProjectId, { edit: "content" })
      : routes.projectPage(fillProjectId, { focus: "star" })
    : null

  return (
    <Card className={cn("max-w-xl gap-4 p-6", className)} role="region" aria-labelledby={titleId}>
      <div className="grid size-10 place-items-center rounded-full bg-primary-subtle">
        <ClipboardList className="size-5 text-primary-text" aria-hidden />
      </div>
      <h2 id={titleId} className="text-lg leading-7 font-semibold">
        {fillKind === "fields" ? (
          // C-09 project_fields 제목 (Q53-8 1칸 문구)
          "한 칸만 채우면 바로 쓸 수 있어요"
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

      {hints.includes("project_star") ? (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            프로젝트는 있지만 STAR의 상황·행동이 비어 있어요
            <span className="ml-1 text-xs tabular-nums">현재 {readiness.counts.projects_without_complete_star}건</span>
          </span>
        </p>
      ) : null}

      {fillKind === "fields" ? (
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
            의 프로젝트 내용이 비어 있어요
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
              <SettingsLink
                section="ai-connection"
                provider={connection?.active_provider ?? null}
                onClick={() => markAiConnectReturn({ href: returnHref })}
              >
                AI 연결 확인
              </SettingsLink>
            </Button>
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {fillProjectId ? (
            <>
              <Button asChild>
                <Link
                  href={fillHref ?? routes.career()}
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
              {direct !== fillHref ? go(direct, "직접 입력", "link") : null}
            </>
          ) : blocked ? (
            <>
              {go(direct, "직접 입력하기")}
              {activeChatId ? (
                <Button asChild variant="outline">
                  <Link href={routes.writingChatRedirect(activeChatId)} onClick={remember}>
                    이어서 대화하기
                  </Link>
                </Button>
              ) : null}
            </>
          ) : (
            <>
              {go(chatHref, chatLabel)}
              {f.next_action === "writing_chat" || f.next_action === "create_project" ? <ProviderBadge connection={connection} /> : null}
              {/* UQ-16: hide the secondary link when it would go where the primary goes */}
              {direct !== chatHref ? go(direct, "직접 입력", "link") : null}
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

      {choose.dialog}
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
