"use client"

/**
 * C-11 사용한 경력·프로젝트 (F-DOC-08 / F-DOC-01, design-system 3.10).
 * - SectionSources: 자소서 문항별 목록(role · origin · rationale · 관련 요건 · reuse_reason · 원본 삭제됨)
 *   + 변경 트리(프로젝트 → 상세 내용) → source_selection_mode = 'user', sources_modified_at →
 *   "변경 사항으로 다시 생성"(AiRunButton rerun + 편집본 덮어씀 확인). 모두 제외 경고.
 * - CareerDescriptionSources: 경력기술서 포함 항목 + selection_origin 배지, 변경 → 전체 다시 생성.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { Info, Loader2, Sparkles, TriangleAlert, Unlink, UserRound } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AiRunButton } from "@/components/common/ai-run-button"
import { usePreviewWriteGuard } from "@/components/common/preview-write-guard"
import type { DraftOptions, DraftSection, DraftSectionSource } from "@/types/db"
import { SELECTION_ORIGIN_LABELS, SOURCE_ORIGIN_LABELS, SOURCE_ROLE_LABELS } from "./labels"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { DraftTone } from "@/types/db"
import { SourceCheckTree, type TreeSelection } from "./source-tree"
import type { SourceTree } from "@/lib/data/drafts"
import { setSectionSourcesAction } from "@/app/(dashboard)/(gated)/applications/_lib/actions"


/** v5.3 C-11: 자소서 문항당 직접 고를 수 있는 근거 5개, 경력기술서 프로젝트 8개 (구현 값 [가정]) */
const MAX_SECTION_SOURCES = 5
const MAX_CD_PROJECTS = 8

export interface RegenerateGuard {
  /** readiness.draft.ready (false → C-09 shown at top; regenerate disabled) */
  ready: boolean
  busy: boolean
}

/**
 * "다시 생성" 확인 — copy follows what the code does (A3 UQ-64, 기획 확인 P-A3-1 대기):
 * - cover_letter: 같은 섹션 덮어쓰기, 이전 생성본 보관 없음 (D-DM-06)
 * - career_description: 새 drafts 행을 만들고 지금 초안은 S-17 목록에 남김 (AI-03 "이전 행 보존")
 * // [UI-가정] 두 문구 모두
 */
export function OverwriteConfirm({
  open,
  onOpenChange,
  onConfirm,
  variant,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onConfirm: () => void
  variant: "cover_letter" | "career_description"
}) {
  const career = variant === "career_description"
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{career ? "새 경력기술서 초안을 만들까요?" : "이 문항을 다시 생성할까요?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {career
              ? "바꾼 포함 항목으로 새 초안을 만들어요. 지금 초안은 서류 초안 목록에 그대로 남아요. 다시 하면 공급자 토큰을 다시 써요"
              : "지금 문항 본문과 직접 고친 내용이 새 초안으로 바뀌어요. 이전 본문은 보관되지 않아요. 다시 하면 공급자 토큰을 다시 써요"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{career ? "새 초안 만들기" : "다시 생성"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function SourceRow({ src, requirementLabel }: { src: DraftSectionSource; requirementLabel: (id: string) => string }) {
  const deleted = !!src.source_deleted_at
  return (
    <li className="space-y-1 border-b py-2 last:border-0">
      <p className={deleted ? "flex items-start gap-1.5 text-sm font-medium text-muted-foreground" : "text-sm font-medium"}>
        {deleted ? <Unlink className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : null}
        {src.source_label}
        {deleted ? <span className="font-normal"> · 원본 삭제됨</span> : null}
      </p>
      <div className="flex flex-wrap gap-1">
        <Badge variant={src.role === "primary" ? "secondary" : "outline"}>{SOURCE_ROLE_LABELS[src.role]}</Badge>
        {src.origin === "ai" ? (
          <Badge variant="ai">
            <Sparkles aria-hidden />
            {SOURCE_ORIGIN_LABELS.ai}
          </Badge>
        ) : (
          <Badge variant="outline">
            <UserRound aria-hidden />
            {SOURCE_ORIGIN_LABELS.user}
          </Badge>
        )}
      </div>
      {src.rationale ? <p className="text-sm text-muted-foreground">{src.rationale}</p> : null}
      {src.requirement_ids.length ? (
        <p className="text-sm text-muted-foreground">관련 요건: {src.requirement_ids.map(requirementLabel).join(" · ")}</p>
      ) : null}
      {src.reuse_reason ? <p className="text-sm text-muted-foreground">다른 문항과 같은 프로젝트: {src.reuse_reason}</p> : null}
    </li>
  )
}

export function SectionSources({
  section,
  sources,
  tree,
  requirementLabel,
  guard,
  onRegenerate,
  idPrefix,
}: {
  section: DraftSection
  sources: DraftSectionSource[]
  tree: SourceTree
  requirementLabel: (id: string) => string
  guard: RegenerateGuard
  onRegenerate: () => void
  idPrefix: string
}) {
  const router = useRouter()
  const previewWrite = usePreviewWriteGuard()
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [confirm, setConfirm] = React.useState(false)
  const initial = React.useMemo<TreeSelection>(
    () => ({ projects: Object.fromEntries(sources.filter((s) => s.project_id && !s.source_deleted_at).map((s) => [s.project_id!, s.project_detail_ids])) }),
    [sources],
  )
  const [selection, setSelection] = React.useState<TreeSelection>(initial)
  const modified = !!section.sources_modified_at
  const allExcluded = section.source_selection_mode === "user" && sources.length === 0
  const editingEmpty = editing && Object.keys(selection.projects).length === 0

  const apply = async () => {
    if (previewWrite.stop()) return
    setSaving(true)
    await setSectionSourcesAction(
      section.id,
      Object.entries(selection.projects).map(([project_id, project_detail_ids]) => ({ project_id, project_detail_ids })),
    )
    setSaving(false)
    setEditing(false)
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base leading-6 font-semibold">사용한 경력·프로젝트</h3>
        {!editing ? (
          <Button variant="outline" size="sm" onClick={() => { setSelection(initial); setEditing(true) }} disabled={guard.busy}>
            바꾸기
          </Button>
        ) : null}
      </div>
      {!editing ? (
        sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">{section.generation_no > 0 ? "근거 없이 메모·공고 내용만으로 작성했어요" : "생성할 때 AI가 먼저 골라요"}</p>
        ) : (
          <ul>
            {sources.map((s) => (
              <SourceRow key={s.id} src={s} requirementLabel={requirementLabel} />
            ))}
          </ul>
        )
      ) : (
        <div className="space-y-3">
          {Object.keys(selection.projects).length >= MAX_SECTION_SOURCES ? (
            // v5.3 C-11 자소서 사용자 근거 개수 (명세 문구)
            <p className="text-sm text-muted-foreground">한 문항에 {MAX_SECTION_SOURCES}개까지 고를 수 있어요</p>
          ) : null}
          <SourceCheckTree tree={tree} selection={selection} onChange={setSelection} withDetails idPrefix={idPrefix} maxProjects={MAX_SECTION_SOURCES} />
          {editingEmpty ? (
            <Alert variant="warning">
              <TriangleAlert aria-hidden />
              <AlertTitle className="font-normal">근거 없이 메모·공고 내용만으로 작성돼요</AlertTitle>
            </Alert>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              취소
            </Button>
            <Button size="sm" onClick={apply} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
              적용
            </Button>
          </div>
        </div>
      )}
      {allExcluded && !editing ? (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertTitle className="font-normal">근거 없이 메모·공고 내용만으로 작성돼요</AlertTitle>
        </Alert>
      ) : null}
      {modified && !editing ? (
        <Alert variant="info">
          <Info aria-hidden />
          <AlertTitle>근거를 바꿨어요</AlertTitle>
          <AlertDescription className="space-y-2">
            <AiRunButton lock={{ entry: "draft", feature: "cover_letter" }} size="sm" rerun onRun={() => setConfirm(true)} disabled={guard.busy || !guard.ready}>
              변경 사항으로 다시 생성
            </AiRunButton>
          </AlertDescription>
        </Alert>
      ) : null}
      <OverwriteConfirm open={confirm} onOpenChange={setConfirm} onConfirm={onRegenerate} variant="cover_letter" />
    </div>
  )
}

export function CareerDescriptionSources({
  options,
  tree,
  guard,
  onRegenerate,
}: {
  options: DraftOptions
  tree: SourceTree
  guard: RegenerateGuard
  onRegenerate: (projectIds: string[], tone: DraftTone) => void
}) {
  const initial = React.useMemo<TreeSelection>(() => ({ projects: Object.fromEntries((options.included_project_ids ?? []).map((i) => [i, []])) }), [options])
  const [selection, setSelection] = React.useState<TreeSelection>(initial)
  const [confirm, setConfirm] = React.useState(false)
  // v5.3 A17: null (이전 초안) = 간결. 바꾸면 전체 다시 생성 대상 (근거 변경과 같은 안내 [UI-가정] G-39)
  const savedTone: DraftTone = options.tone ?? "concise"
  const [tone, setTone] = React.useState<DraftTone>(savedTone)
  const ids = Object.keys(selection.projects)
  const before = new Set(options.included_project_ids ?? [])
  const sourcesChanged = ids.length !== before.size || ids.some((i) => !before.has(i))
  const changed = sourcesChanged || tone !== savedTone
  const origin = sourcesChanged ? "user" : (options.selection_origin ?? "user")
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base leading-6 font-semibold">포함한 경력·프로젝트</h3>
        <Badge variant={origin === "insight" ? "info" : origin === "ai_ranking" ? "ai" : "outline"}>{SELECTION_ORIGIN_LABELS[origin]}</Badge>
      </div>
      <div className="space-y-1.5">
        <p id="cds-tone" className="text-sm font-medium">
          문체
        </p>
        <ToggleGroup
          type="single"
          variant="outline"
          value={tone}
          disabled={guard.busy}
          onValueChange={(v) => {
            if (v === "concise" || v === "detailed") setTone(v)
          }}
          aria-labelledby="cds-tone"
        >
          <ToggleGroupItem value="concise" className="h-9 px-4 text-sm">
            간결
          </ToggleGroupItem>
          <ToggleGroupItem value="detailed" className="h-9 px-4 text-sm">
            상세
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {ids.length >= MAX_CD_PROJECTS ? (
        // [UI-가정] 문구 (G-39)
        <p className="text-sm text-muted-foreground">프로젝트는 {MAX_CD_PROJECTS}개까지 고를 수 있어요</p>
      ) : null}
      <SourceCheckTree tree={tree} selection={selection} onChange={setSelection} disabled={guard.busy} idPrefix="cds" maxProjects={MAX_CD_PROJECTS} />
      {changed ? (
        <Alert variant="info">
          <Info aria-hidden />
          <AlertTitle>근거를 바꿨어요</AlertTitle>
          <AlertDescription className="space-y-2">
            <AiRunButton lock={{ entry: "draft" }} size="sm" rerun onRun={() => setConfirm(true)} disabled={guard.busy || !guard.ready || ids.length === 0}>
              변경 사항으로 다시 생성
            </AiRunButton>
          </AlertDescription>
        </Alert>
      ) : null}
      <OverwriteConfirm open={confirm} onOpenChange={setConfirm} onConfirm={() => onRegenerate(ids, tone)} variant="career_description" />
    </div>
  )
}
