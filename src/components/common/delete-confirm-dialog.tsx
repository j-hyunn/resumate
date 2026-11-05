"use client"

/**
 * C-05 삭제 확인 다이얼로그 (02 C-05, design-system 3.5).
 * Loads impact counts itself (get_deletion_impact etc.) and returns the chosen options.
 * Never delete without it (patterns.md §8).
 */
import { actionFailedMessage, applicationObjectPhrase, objectParticle } from "@/lib/data/labels"
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

export type CareerDeleteEntityType = Exclude<DeletionEntityType, "writing_chat" | "project_detail" | "achievement">

export type DeleteTarget =
  | {
      kind: "career"
      /** 상세 내용·정량 성과 (DM v4.4 폐기, CR-2·CR-11) are no longer deletable items */
      entity_type: CareerDeleteEntityType
      entity_id: string
      label: string
      /** project only (C-05 v5.6 lines): affiliated = STAR + chats, standalone = deliverables + their chats */
      scope?: "affiliated" | "standalone"
      /** S-10 / S-44 with unsaved edits → "저장하지 않은 수정도 함께 사라져요" */
      unsavedChanges?: boolean
    }
  | { kind: "writing_chat"; entity_id: string; label?: string }
  | { kind: "application_project"; entity_id: string; label: string }
  /** K-3 (v5.13): the title follows the draft type; `label` = the draft's name */
  | { kind: "draft"; entity_id: string; label: string; draft_type: "career_description" | "cover_letter" }
  | { kind: "interview_session"; entity_id: string; label: string }
  /** v5 C-05 "API 키 삭제" (S-40, D-36, NFR-KEY-06·09). `entity_id` = provider */
  | { kind: "api_key"; entity_id: AiProviderName; label?: string; is_active: boolean }

export interface DeleteOptions {
  result_mode?: ResultMode
  affiliation_mode?: AffiliationMode
}

const ENTITY_NAMES: Record<CareerDeleteEntityType, string> = {
  experience: "경력",
  education: "교육",
  project: "프로젝트",
  project_deliverable: "산출물",
  skill: "스킬",
}

function targetName(t: DeleteTarget): string {
  switch (t.kind) {
    case "career":
      return ENTITY_NAMES[t.entity_type]
    case "writing_chat":
      return "AI 작성 대화"
    case "application_project":
      return "자기소개서" // K-2 (v5.13, CR-23)
    case "draft":
      return t.draft_type === "cover_letter" ? "자소서 문항 답변" : "경력기술서" // K-3 (v5.13, D-UX-23)
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
  // The impact read failed (e.g. the item is already gone): say so instead of an endless skeleton.
  const [loadFailedKey, setLoadFailedKey] = React.useState<string | null>(null)
  const [resultMode, setResultMode] = React.useState<ResultMode>("keep_results")
  // CR-15: an experience / education delete always removes its projects (no "keep" choice)
  const affiliationMode: AffiliationMode = "delete_projects"
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
    load().then(
      (impact) => {
        if (alive) setLoaded({ key, impact })
      },
      () => {
        if (alive) setLoadFailedKey(key)
      },
    )
    return () => {
      alive = false
    }
  }, [open, target, affiliationMode])

  const impact = target && loaded?.key === `${target.entity_id}-${affiliationMode}` ? loaded.impact : null
  const loadFailed = !!target && loadFailedKey === `${target.entity_id}-${affiliationMode}`
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
        <AlertDialogHeader>
          <AlertDialogTitle>{name} 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            {target.kind === "application_project"
              ? `${applicationObjectPhrase(target.label, { quoted: true })} 삭제할까요?` // K-2 (v5.13) + U36-7 overlap rule
              : target.kind === "draft"
                ? `'${target.label}'${objectParticle(target.label)} 삭제할까요?` // K-3 (v5.13)
              : target.kind === "interview_session"
                ? `'${target.label}' 면접 세션을 삭제할까요?` // K-3 (v5.13): particle fixed
              : target.kind === "api_key"
                ? `${AI_PROVIDER_LABELS[target.entity_id]} 키를 삭제할까요? 즉시 영구 삭제되고 되돌릴 수 없어요.`
              : target.kind === "career" && target.entity_type === "project_deliverable"
                ? `'${target.label}'을 삭제할까요?` // C-05 산출물 삭제 (spec copy)
              : // [UI-가정] first-line copy is not in the spec
                `${target.label ? `'${target.label}' ` : ""}${name}을(를) 삭제할까요?`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          {impact === null && loadFailed ? (
            // [UI-가정] copy not in the spec (C-05 has no impact-load failure state)
            <p className="rounded-md bg-muted p-3 text-sm text-destructive" role="alert">
              삭제할 항목을 불러오지 못했어요. 이미 삭제됐을 수 있어요. 새로고침 후 다시 확인해 주세요
            </p>
          ) : impact === null ? (
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

          {/* C-05: a deliverable offers the result choice only when results cite it */}
          {/* UQ-S44-16: a deliverable shows the choice only after the impact says results cite it (no jump) */}
          {target.kind === "career" &&
          (target.entity_type !== "project_deliverable" || (impact?.kind === "career" && impact.data.affected_results.by_application_project.length > 0)) ? (
            <fieldset className="space-y-2">
              <legend className="text-sm leading-5 font-medium">결과 처리</legend>
              <RadioGroup value={resultMode} onValueChange={(v) => setResultMode(v as ResultMode)} className="gap-2">
                <CardRadio id="result-keep" value="keep_results" title="결과는 남기고 근거만 '원본 삭제됨'으로" />
                <CardRadio
                  id="result-delete"
                  value="delete_results"
                  title="관련 결과도 함께 삭제"
                  description="인사이트는 해당 버전, 경력기술서는 문서 전체, 자소서 문항 답변은 해당 문항의 생성 결과만(문항·글자 수·메모는 남음), 모의 면접은 세션 전체가 삭제돼요"
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
              {/* K-2 (v5.13, OD-D1) */}
              삭제한 내용은 되돌릴 수 없다는 것을 확인했어요
            </Label>
          ) : null}

          {failed ? (
            <p className="text-sm text-destructive" role="alert">
              {actionFailedMessage("삭제")}
            </p>
          ) : null}
        </div>

        <AlertDialogFooter>
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
  const name = targetName(target)
  const lines: string[] = []
  let byAp: DeletionImpact["affected_results"]["by_application_project"] = []

  if (impact.kind === "career" && target.kind === "career") {
    const c = impact.data.cascade
    // C-05 v5.6 프로젝트 삭제: affiliated → STAR + its chats / standalone → deliverables + their chats (PA-1)
    if (target.entity_type === "project") {
      const standalone = target.scope ? target.scope === "standalone" : (c.project_deliverables ?? 0) > 0
      lines.push(standalone ? `산출물 ${c.project_deliverables ?? 0}개와 산출물의 AI 대화 ${c.writing_chats}개가 함께 삭제돼요` : `STAR 내용과 이 프로젝트의 AI 대화 ${c.writing_chats}개가 함께 삭제돼요`)
    }
    // C-05 산출물 삭제: "(대화가 있으면) 이 산출물의 AI 대화 {N}개도 함께 삭제돼요"
    if (target.entity_type === "project_deliverable" && c.writing_chats > 0) lines.push(`이 산출물의 AI 대화 ${c.writing_chats}개도 함께 삭제돼요`)
    if (target.unsavedChanges) lines.push("저장하지 않은 수정도 함께 사라져요")
    if (target.entity_type === "experience" || target.entity_type === "education") {
      // K-3 (v5.13, CR-15): same line as the C-05 career row ②
      if (c.projects > 0)
        lines.push(
          `이 ${name}의 프로젝트 ${c.projects}개와 그 ${c.writing_chats > 0 ? `STAR·AI 대화 ${c.writing_chats}개가` : "STAR가"} 함께 삭제돼요`,
        )
    }
    // OD-I6 / R-OD-5: completed sessions left after their 자기소개서 was deleted (0 → no line)
    const detached = impact.data.affected_results.detached_interview_sessions
    if (detached > 0) lines.push(`삭제된 자기소개서의 면접 기록 ${detached}개`)
    byAp = impact.data.affected_results.by_application_project
  }
  if (impact.kind === "writing_chat") {
    // C-05 v5.6 AI 대화만 삭제 (S-10: STAR, S-44: 본문)
    lines.push(`대화 메시지 ${impact.data.writing_chat?.message_count ?? 0}개가 삭제돼요. 이미 반영해 저장한 내용은 그대로예요`)
  }
  if (impact.kind === "application_project") {
    const d = impact.data
    // K-2 / OD-I6 (v5.13): only unfinished sessions go; completed ones stay as read-only records
    lines.push(
      `JD·요건, 인사이트 ${d.insights}, 서류 초안 ${d.drafts}, 작성 중인 면접 ${d.interview_sessions}, 전형 이력이 함께 삭제돼요. 커리어 데이터는 그대로예요`,
    )
    if (d.kept_interview_sessions > 0) lines.push(`끝난 모의 면접 ${d.kept_interview_sessions}개는 기록에 남아요`)
  }
  // K-3 (v5.13): a cover-letter draft's sections are its questions
  if (impact.kind === "draft" && target.kind === "draft")
    lines.push(
      target.draft_type === "cover_letter"
        ? `문항 ${impact.data.sections}개와 그 답변이 함께 삭제돼요`
        : "작성한 블록과 직접 고친 내용이 함께 삭제돼요",
    )
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
          <p className="font-medium">영향을 받는 자기소개서</p>
          <ul className="list-disc space-y-1 pl-4">
            {byAp.map((ap) => (
              <li key={ap.application_project_id}>
                {ap.name ?? "새 자기소개서"} — 인사이트 {ap.insights} · 초안 {ap.drafts} · 면접 {ap.interview_sessions}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
