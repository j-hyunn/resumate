"use client"

/**
 * C-05 삭제 확인 다이얼로그 (02 C-05, design-system 3.5).
 * Loads impact counts itself (get_deletion_impact etc.) and returns the chosen options.
 * Never delete without it (patterns.md §8).
 */
import { actionFailedMessage } from "@/lib/data/labels"
import * as React from "react"
import { Info, Loader2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { readPreviewState } from "@/lib/preview-state"
import type { AffiliationMode, AiProviderName, DeletionEntityType, DeletionImpact, ResultMode } from "@/types/db"
import {
  getApplicationDeletionImpactAction,
  getDeletionImpactAction,
  getDraftDeletionImpactAction,
  getInterviewSessionDeletionImpactAction,
  getRunningAiJobCountAction,
} from "@/lib/data/actions"
import { AI_PROVIDER_LABELS, AI_PROVIDERS } from "@/lib/mock/ai-providers"
import { ExternalProviderLink } from "./ai-error-notice"
import type { ApplicationDeletionImpact } from "@/lib/data/deletion"

export type DeleteTarget =
  | { kind: "career"; entity_type: Exclude<DeletionEntityType, "writing_chat">; entity_id: string; label: string }
  | { kind: "writing_chat"; entity_id: string; label?: string }
  | { kind: "application_project"; entity_id: string; label: string }
  | { kind: "draft"; entity_id: string; label: string }
  | { kind: "interview_session"; entity_id: string; label: string }
  /** v5 C-05 "API 키 삭제" (S-40, D-36, NFR-KEY-06·09). `entity_id` = provider */
  | { kind: "api_key"; entity_id: AiProviderName; label?: string; is_active: boolean }

export interface DeleteOptions {
  result_mode?: ResultMode
  affiliation_mode?: AffiliationMode
}

const ENTITY_NAMES: Record<Exclude<DeletionEntityType, "writing_chat">, string> = {
  experience: "경력",
  education: "교육",
  project: "프로젝트",
  project_detail: "상세 내용",
  achievement: "정량 성과",
  skill: "스킬",
}

function targetName(t: DeleteTarget): string {
  switch (t.kind) {
    case "career":
      return ENTITY_NAMES[t.entity_type]
    case "writing_chat":
      return "AI 작성 대화"
    case "application_project":
      return "기업 JD"
    case "draft":
      return "서류 초안"
    case "interview_session":
      return "면접 세션"
    case "api_key":
      return "API 키"
  }
}

type Impact =
  | { kind: "career"; data: DeletionImpact }
  | { kind: "writing_chat"; data: DeletionImpact }
  | { kind: "application_project"; data: ApplicationDeletionImpact }
  | { kind: "draft"; data: { sections: number } }
  | { kind: "interview_session"; data: { questions: number; answers: number } }
  | { kind: "api_key"; data: { running_jobs: number } }

function CardRadio({ value, id, title, description }: { value: string; id: string; title: string; description?: string }) {
  return (
    <Label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-base font-normal has-[:checked]:border-primary has-[:checked]:bg-primary-subtle has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-subtle"
    >
      <RadioGroupItem value={value} id={id} className="mt-1" />
      <span className="space-y-1">
        <span className="block font-medium">{title}</span>
        {description ? <span className="block text-sm text-muted-foreground">{description}</span> : null}
      </span>
    </Label>
  )
}

interface DeleteConfirmDialogProps {
  target: DeleteTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** perform the delete; throw to keep the dialog open */
  onConfirm: (options: DeleteOptions) => Promise<void>
}

export function DeleteConfirmDialog(props: DeleteConfirmDialogProps) {
  // remount per target/open so selections reset to the spec defaults
  return <DeleteConfirmDialogInner key={`${props.target?.entity_id ?? "none"}-${props.open}`} {...props} />
}

function DeleteConfirmDialogInner({ target, open, onOpenChange, onConfirm }: DeleteConfirmDialogProps) {
  const [loaded, setLoaded] = React.useState<{ key: string; impact: Impact } | null>(null)
  const [resultMode, setResultMode] = React.useState<ResultMode>("keep_results")
  const [affiliationMode, setAffiliationMode] = React.useState<AffiliationMode>("keep_projects")
  const [acknowledged, setAcknowledged] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    if (!open || !target) return
    let alive = true
    const key = `${target.entity_id}-${affiliationMode}`
    const load = async (): Promise<Impact> => {
      switch (target.kind) {
        case "career":
          return { kind: "career", data: await getDeletionImpactAction(target.entity_type, target.entity_id, affiliationMode) }
        case "writing_chat":
          return { kind: "writing_chat", data: await getDeletionImpactAction("writing_chat", target.entity_id) }
        case "application_project":
          return { kind: "application_project", data: await getApplicationDeletionImpactAction(target.entity_id) }
        case "draft":
          return { kind: "draft", data: await getDraftDeletionImpactAction(target.entity_id) }
        case "interview_session":
          return { kind: "interview_session", data: await getInterviewSessionDeletionImpactAction(target.entity_id) }
        case "api_key":
          return { kind: "api_key", data: { running_jobs: await getRunningAiJobCountAction(target.entity_id) } }
      }
    }
    void load().then((impact) => {
      if (alive) setLoaded({ key, impact })
    })
    return () => {
      alive = false
    }
  }, [open, target, affiliationMode])

  const impact = target && loaded?.key === `${target.entity_id}-${affiliationMode}` ? loaded.impact : null
  if (!target) return null
  const name = targetName(target)
  const hasAffiliation = target.kind === "career" && (target.entity_type === "experience" || target.entity_type === "education")
  const needsAck = target.kind === "application_project"
  const disabled = running || !impact || (needsAck && !acknowledged)

  const confirm = async () => {
    // `?state=` previews don't write. Read at click time: this dialog also opens outside <Suspense> (settings)
    if (readPreviewState(new URLSearchParams(window.location.search))) {
      toast("미리보기라 실제로 저장하거나 실행하지 않았어요")
      onOpenChange(false)
      return
    }
    setRunning(true)
    setFailed(false)
    try {
      await onConfirm({
        result_mode: target.kind === "career" ? resultMode : undefined,
        affiliation_mode: hasAffiliation ? affiliationMode : undefined,
      })
      onOpenChange(false)
    } catch {
      setFailed(true)
    } finally {
      setRunning(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <AlertDialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg" onEscapeKeyDown={(e) => running && e.preventDefault()}>
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle className="text-lg leading-7 font-semibold">{name} 삭제</AlertDialogTitle>
          <AlertDialogDescription className="text-base text-foreground">
            {target.kind === "application_project"
              ? "이 기업 JD를 삭제할까요?"
              : target.kind === "api_key"
                ? `${AI_PROVIDER_LABELS[target.entity_id]} 키를 삭제할까요? 즉시 영구 삭제되고 되돌릴 수 없어요.`
              : // [UI-가정] first-line copy is not in the spec
                `${target.label ? `'${target.label}' ` : ""}${name}을(를) 삭제할까요?`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          {impact === null ? (
            <div className="space-y-2 rounded-md bg-muted p-3" aria-busy="true">
              <span className="sr-only">삭제 영향 확인 중</span>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : (
            <ImpactSummary target={target} impact={impact} />
          )}

          {target.kind === "api_key" ? (
            <p className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
              공급자 사이트에서도 키를 폐기하려면 →
              <ExternalProviderLink href={AI_PROVIDERS[target.entity_id].dashboard_url}>{`${AI_PROVIDER_LABELS[target.entity_id]} 대시보드`}</ExternalProviderLink>
            </p>
          ) : null}

          {hasAffiliation ? (
            <fieldset className="space-y-2">
              <legend className="text-sm leading-5 font-medium">소속 프로젝트 처리</legend>
              <RadioGroup value={affiliationMode} onValueChange={(v) => setAffiliationMode(v as AffiliationMode)} className="gap-2">
                <CardRadio id="affiliation-keep" value="keep_projects" title="독립 프로젝트로 남기기" />
                <CardRadio id="affiliation-delete" value="delete_projects" title="함께 삭제" />
              </RadioGroup>
            </fieldset>
          ) : null}

          {target.kind === "career" ? (
            <fieldset className="space-y-2">
              <legend className="text-sm leading-5 font-medium">결과 처리</legend>
              <RadioGroup value={resultMode} onValueChange={(v) => setResultMode(v as ResultMode)} className="gap-2">
                <CardRadio id="result-keep" value="keep_results" title="결과는 남기고 근거만 '원본 삭제됨'으로" />
                <CardRadio
                  id="result-delete"
                  value="delete_results"
                  title="관련 결과도 함께 삭제"
                  description="인사이트는 해당 버전, 경력기술서는 문서 전체, 자기소개서는 해당 문항의 생성 결과만(문항·글자 수·메모는 남음), 모의 면접은 세션 전체가 삭제돼요"
                />
              </RadioGroup>
              <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                어느 쪽이든 인용문은 지워져요. 결과를 남기면 AI가 쓴 본문에는 내용이 남을 수 있어요
              </p>
            </fieldset>
          ) : null}

          {needsAck ? (
            <Label className="flex items-start gap-2 text-base font-normal">
              <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} className="mt-1" />
              {/* [UI-가정] 확인 체크 문구 없음 (design-system P-1) */}
              삭제된 내용은 되돌릴 수 없어요를 확인했어요
            </Label>
          ) : null}

          {failed ? (
            <p className="text-sm text-destructive" role="alert">
              {actionFailedMessage("삭제")}
            </p>
          ) : null}
        </div>

        <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel disabled={running}>취소</AlertDialogCancel>
          <Button variant="destructive" disabled={disabled} onClick={confirm}>
            {running ? <Loader2 className="animate-spin" aria-hidden /> : null}
            삭제
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ImpactSummary({ target, impact }: { target: DeleteTarget; impact: Impact }) {
  const lines: string[] = []
  let byAp: DeletionImpact["affected_results"]["by_application_project"] = []

  if (impact.kind === "career" && target.kind === "career") {
    const c = impact.data.cascade
    if (target.entity_type === "project_detail") lines.push(`붙어 있는 정량 성과 ${c.achievements}건도 삭제돼요`)
    if (target.entity_type === "project") {
      lines.push(`상세 내용 ${c.project_details}건, 정량 성과 ${c.achievements}건이 함께 삭제돼요.`)
      if (c.writing_chats > 0) lines.push("이 프로젝트의 AI 작성 대화도 삭제돼요")
    }
    if (target.entity_type === "experience" || target.entity_type === "education") {
      // [UI-가정] cascade line copy for 경력·교육 is not in the spec
      if (c.projects > 0) lines.push(`프로젝트 ${c.projects}건, 상세 내용 ${c.project_details}건, 정량 성과 ${c.achievements}건이 함께 삭제돼요`)
      else if (c.achievements > 0) lines.push(`정량 성과 ${c.achievements}건이 함께 삭제돼요`)
    }
    byAp = impact.data.affected_results.by_application_project
  }
  if (impact.kind === "writing_chat") {
    lines.push(
      `대화 메시지 ${impact.data.writing_chat?.message_count ?? 0}개와 저장 전 정리 결과가 삭제돼요. 저장한 프로젝트는 그대로예요(출처 대화 연결만 끊겨요)`,
    )
  }
  if (impact.kind === "application_project") {
    const d = impact.data
    lines.push(
      `JD·요건, 인사이트 ${d.insights}, 서류 초안 ${d.drafts}, 면접 세션 ${d.interview_sessions}, 전형 이력이 함께 삭제돼요. 커리어 데이터는 그대로예요`,
    )
  }
  // [UI-가정] 초안 / 면접 세션: spec says "하위 개수" only
  if (impact.kind === "draft") lines.push(`섹션 ${impact.data.sections}개가 함께 삭제돼요`)
  if (impact.kind === "interview_session")
    lines.push(`질문 ${impact.data.questions}개와 작성한 답변 ${impact.data.answers}개가 함께 삭제돼요`)
  if (impact.kind === "api_key" && target.kind === "api_key") {
    if (impact.data.running_jobs > 0)
      lines.push(`진행 중인 AI 작업 ${impact.data.running_jobs}건은 실패로 끝나고 입력(답변·대화·문항)은 그대로 남아요`)
    lines.push("지금까지 만든 AI 결과는 그대로 볼 수 있어요")
    if (target.is_active) lines.push("삭제하면 AI 기능이 잠겨요. 다른 키가 있으면 활성 공급자를 직접 골라 주세요")
  }

  if (lines.length === 0 && byAp.length === 0) return null
  return (
    <div className="space-y-1 rounded-md bg-muted p-3 text-sm tabular-nums">
      {lines.length > 0 ? (
        <ul className="list-disc space-y-1 pl-4">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
      {byAp.length > 0 ? (
        <div className="space-y-1 pt-1">
          <p className="font-medium">영향을 받는 기업 JD</p>
          <ul className="list-disc space-y-1 pl-4">
            {byAp.map((ap) => (
              <li key={ap.application_project_id}>
                {ap.name ?? "새 기업 JD"} — 인사이트 {ap.insights} · 초안 {ap.drafts} · 면접 {ap.interview_sessions}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
