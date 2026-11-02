"use client"

/**
 * S-35 상세 내용 편집 — STAR + 회고 및 배운 점. 제목* · 상황(S)* · 과제(T) · 행동(A)* (G-1) ·
 * 결과(R) + 정량 성과 목록(S-11, G-3) · 회고 및 배운 점. G-2 on every free-text field,
 * G-4 examples while 과제·결과·회고 are empty, 2,000자 상한 [가정], `?focus=` (C-02).
 */
import * as React from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/common/basics"
import { DraftBadge, DraftNotice, SaveStatus } from "@/components/common/save-status"
import { InputGuide } from "@/components/common/input-guide"
import type { Achievement, ProjectDetail, ProjectDetailField } from "@/types/db"
import type { ProjectDetailWithAchievements, ProjectWithChildren } from "@/lib/data/career"
import { routes } from "@/lib/routes"
import { saveProjectDetailAction } from "./actions"
import { DangerZone, FormSection, LongTextField, TextField, nn, useRowAutosave } from "./form-parts"
import { AchievementList } from "./achievement-list"

const LIMIT = 2000 // [UI-가정] 필드별 2,000자 (02 S-35 [가정], 04 STAR ≤ 2,000)
const TITLE_LIMIT = 100 // 04 project_details.title ≤ 100
/** UQ-67: never send values over the DB CHECK limits (maxLength also blocks typing/paste) */
const cap = (v: string, n: number) => (v.length > n ? v.slice(0, n) : v)

type Values = Record<ProjectDetailField, string>

// [UI-가정] G-4 field examples (spec: "필드별 한 줄 예시", copy not given)
const G4: Partial<Record<ProjectDetailField, string>> = {
  task: "예: 승인 API 응답 시간을 0.8초 이하로 낮추는 목표를 맡았어요",
  result: "예: 응답 시간이 1.2초에서 0.7초로 줄었고 관련 문의가 줄었어요",
  learnings: "예: 성능 문제는 추측보다 측정에서 시작해야 한다는 것을 배웠어요",
}

function toValues(d: ProjectDetail | null): Values {
  return {
    title: d?.title ?? "",
    situation: d?.situation ?? "",
    task: d?.task ?? "",
    action: d?.action ?? "",
    result: d?.result ?? "",
    learnings: d?.learnings ?? "",
  }
}

export function DetailForm({
  project,
  detail,
  focus,
  openAchievementId,
}: {
  project: ProjectWithChildren
  detail: ProjectDetailWithAchievements | null
  focus?: ProjectDetailField | null
  /** C-02 "원본으로 이동" → open this 정량 성과 in S-11 (`?achievement=`) */
  openAchievementId?: string | null
}) {
  const [values, setValues] = React.useState<Values>(() => toValues(detail))
  const [achievements, setAchievements] = React.useState<Achievement[]>(() => detail?.achievements ?? [])
  const refs = React.useRef<Partial<Record<ProjectDetailField, HTMLTextAreaElement | null>>>({})
  const titleRef = React.useRef<HTMLDivElement>(null)
  const achievementControl = React.useRef<{ openNew: () => void }>(null)
  const { autosave, row, id } = useRowAutosave<Values, ProjectDetail>({
    initialId: detail?.id ?? null,
    initialRow: detail,
    editHref: (detailId) => routes.projectDetail(project.id, detailId),
    save: (rowId, v, opts) =>
      saveProjectDetailAction(
        project.id,
        rowId,
        {
          title: nn(cap(v.title, TITLE_LIMIT)),
          situation: nn(cap(v.situation, LIMIT)),
          task: nn(cap(v.task, LIMIT)),
          action: nn(cap(v.action, LIMIT)),
          result: nn(cap(v.result, LIMIT)),
          learnings: nn(cap(v.learnings, LIMIT)),
        },
        opts,
      ),
  })

  React.useEffect(() => {
    if (!focus) return
    if (focus === "title") titleRef.current?.querySelector("input")?.focus()
    else refs.current[focus]?.focus()
    refs.current[focus]?.scrollIntoView({ block: "center" })
  }, [focus])

  const set = (patch: Partial<Values>) => {
    const next = { ...values, ...patch }
    setValues(next)
    autosave.schedule(next)
  }
  const blur = () => void autosave.flush()
  const status = row?.status ?? detail?.status ?? "draft"
  const affiliation = project.experience?.company_name ?? project.education?.institution_name ?? "기타 프로젝트"
  const resultHasNumber = /\d/.test(values.result)

  const field = (key: Exclude<ProjectDetailField, "title">, props: { label: string; abbr?: string; required?: boolean; guidance: string; extra?: React.ReactNode }) => (
    <LongTextField
      id={`det-${key}`}
      label={props.label}
      abbr={props.abbr}
      required={props.required}
      guidance={props.guidance}
      value={values[key]}
      onChange={(v) => set({ [key]: v } as Partial<Values>)}
      onBlur={blur}
      limit={LIMIT}
      flash={focus === key}
      textareaRef={(el) => {
        refs.current[key] = el
      }}
      guides={
        <>
          {props.extra}
          {G4[key] && !values[key].trim() ? <InputGuide guide="G-4">{G4[key]}</InputGuide> : null}
          <InputGuide guide="G-2" />
        </>
      }
    />
  )

  return (
    <div className="mx-auto max-w-[42rem] space-y-8">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {affiliation} ›{" "}
          <Link href={routes.project(project.id)} className="hover:text-foreground hover:underline">
            {project.name ?? "이름 없는 프로젝트"}
          </Link>
        </p>
        <PageHeader
          title={values.title.trim() || "새 상세 내용"}
          badge={id && status === "draft" ? <DraftBadge /> : null}
          description="제목·상황·행동을 채우면 완료돼요"
          status={<SaveStatus state={autosave.state} savedAt={autosave.savedAt} onRetry={autosave.retry} />}
        />
      </div>
      {id && status === "draft" ? <DraftNotice /> : null}

      <div className="space-y-6">
        <div ref={titleRef}>
          <TextField
            id="det-title"
            label="제목"
            required
            placeholder="예: 결제 API 응답 속도 개선"
            maxLength={TITLE_LIMIT}
            help={<p className="text-right text-xs font-medium text-muted-foreground tabular-nums">{values.title.length} / {TITLE_LIMIT}</p>}
            value={values.title}
            onChange={(v) => set({ title: v })}
            onBlur={blur}
            className={focus === "title" ? "animate-field-flash rounded-md" : undefined}
          />
        </div>
        {field("situation", { label: "상황", abbr: "(S)", required: true, guidance: "배경, 팀 구성, 문제 상황" })}
        {field("task", { label: "과제", abbr: "(T)", guidance: "본인이 맡은 목표·책임" })}
        {field("action", { label: "행동", abbr: "(A)", required: true, guidance: "본인이 직접 한 일", extra: <InputGuide guide="G-1" /> })}
        {field("result", {
          label: "결과",
          abbr: "(R)",
          guidance: "무엇이 달라졌는지",
          extra:
            resultHasNumber && achievements.length === 0 ? (
              <InputGuide
                guide="G-3"
                action={
                  id ? (
                    <Button variant="link" size="sm" className="h-auto px-0" onClick={() => achievementControl.current?.openNew()}>
                      + 정량 성과
                    </Button>
                  ) : null
                }
              />
            ) : null,
        })}
        <section id="det-achievements" className="space-y-2" aria-label="정량 성과">
          <h2 className="text-sm leading-5 font-medium">정량 성과</h2>
          <AchievementList
            items={achievements}
            openId={openAchievementId}
            controlRef={achievementControl}
            onChange={setAchievements}
            link={id ? { project_detail_id: id } : null}
            targetLabel={`상세 내용 '${values.title.trim() || "제목 없음"}'`}
            disabledReason="제목을 입력하면 정량 성과를 추가할 수 있어요"
          />
        </section>
        {field("learnings", {
          label: "회고 및 배운 점",
          guidance: "이 경험에서 얻은 교훈·인사이트를 본인 말로 써 주세요. AI는 이 내용을 사실이 아니라 본인의 회고로 다뤄요",
        })}
      </div>

      <FormSection title="다음 상세 내용">
        <div>
          <Button asChild variant="outline">
            <Link href={routes.projectDetailNew(project.id)}>
              <Plus aria-hidden />같은 프로젝트에 상세 내용 추가
            </Link>
          </Button>
        </div>
      </FormSection>

      <DangerZone
        entityType="project_detail"
        entityId={id}
        label={values.title.trim() || "제목 없음"}
        afterHref={routes.project(project.id)}
        buttonLabel="상세 내용 삭제"
      />
    </div>
  )
}
