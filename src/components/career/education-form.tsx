"use client"

/**
 * S-34 교육 편집. 교육 명 · 운영 기관* · 기간(시작* / 종료, 진행 중) · 설명(G-2) · 소속 프로젝트 · C-06 · C-05.
 * ED-6·ED-7 (UX v5.10): 라벨은 S-08 모달과 같고, 구분·상태는 입력받지 않는다 — 구분은 새 교육 `course`·수정 땐 유지,
 * 상태는 진행 중 여부와 기간에서 정한다(`education-derive.ts`). 학위 과정은 이 화면에서 만들 수 없다.
 */
import * as React from "react"
import Link from "next/link"
import { ChevronRight, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/common/basics"
import { DraftBadge, DraftNotice, SaveStatus } from "@/components/common/save-status"
import { InputGuide, MonthField } from "@/components/common/input-guide"
import type { Education } from "@/types/db"
import type { EducationWithChildren } from "@/lib/data/career"
import { routes } from "@/lib/routes"
import { saveEducationAction } from "./actions"
import { DangerZone, FormSection, PeriodError, SaveProblemNotice, TextField, useRowAutosave } from "./form-parts"
import { storedPeriod } from "@/lib/data/row-save"
import { Item } from "@/components/ui/item"
import { educationName } from "./education-name"
import { conflictFields, educationPatch, toValues, type EducationValues } from "./education-derive"

type Values = EducationValues

/** UQ-702: "진행 중" clears the end month on save; a reversed period isn't sent. Same shape as `toValues`. */
function storedValues(v: Values, latest: Education): Values {
  return { ...v, ...storedPeriod(v.start_month, v.ongoing ? null : v.end_month, latest) }
}

export function EducationForm({ education }: { education: EducationWithChildren | null }) {
  const [values, setValues] = React.useState<Values>(() => toValues(education))
  /** the latest row this form knows (구분·상태 are kept from it, ED-7) */
  const prevRow = React.useRef<Education | null>(education)
  const { autosave, row, id, problem, keepMine, takeLatest } = useRowAutosave<Values, Education>({
    initialId: education?.id ?? null,
    initialRow: education,
    editHref: routes.education,
    comparable: toValues,
    stored: storedValues,
    save: (rowId, v, opts) => saveEducationAction(rowId, educationPatch(v, prevRow.current), opts),
  })
  React.useEffect(() => {
    if (row) prevRow.current = row
  }, [row])
  const set = (patch: Partial<Values>) => {
    const next = { ...values, ...patch }
    setValues(next)
    autosave.schedule(next)
  }
  const blur = () => void autosave.flush()
  const status = row?.status ?? education?.status ?? "draft"
  // 교육 이름 = 교육 명, 비면 운영 기관 (education-name.ts, ED-2)
  const title = educationName(values) ?? "새 교육"
  const ongoing = values.ongoing

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title={title}
        badge={id && status === "draft" ? <DraftBadge /> : null}
        description="운영 기관·시작월을 채우면 완료돼요"
        status={<SaveStatus state={autosave.state} savedAt={autosave.savedAt} onRetry={autosave.retry} />}
      />
      <SaveProblemNotice
        problem={problem}
        mine={conflictFields(values)}
        latest={(r) => conflictFields(toValues(r))}
        onKeepMine={() => {
          if (problem?.kind === "conflict") prevRow.current = problem.latest
          keepMine()
        }}
        onTakeLatest={() => {
          const latest = takeLatest()
          if (latest) setValues(toValues(latest))
        }}
      />
      {id && status === "draft" ? <DraftNotice /> : null}

      <FormSection title="기본 정보">
        <TextField id="edu-program" label="교육 명" value={values.program_name} onChange={(v) => set({ program_name: v })} onBlur={blur} />
        <TextField id="edu-name" label="운영 기관" required value={values.institution_name} onChange={(v) => set({ institution_name: v })} onBlur={blur} />
        <div className="grid gap-4 sm:grid-cols-2">
          <MonthField id="edu-start" label="시작" required value={values.start_month} onChange={(v) => set({ start_month: v })} describedBy="edu-period-error" />
          <MonthField
            id="edu-end"
            label="종료"
            value={ongoing ? null : values.end_month}
            onChange={(v) => set({ end_month: v })}
            ongoing={{ label: "진행 중", checked: ongoing, onCheckedChange: (checked) => set({ ongoing: checked }) }}
            describedBy="edu-period-error"
          />
        </div>
        <PeriodError id="edu-period-error" start={values.start_month} end={ongoing ? null : values.end_month} />
        <div className="space-y-1.5">
          <Label htmlFor="edu-desc" className="text-sm font-medium">
            설명
          </Label>
          <Textarea
            id="edu-desc"
            className="min-h-24 text-base leading-[1.75]"
            value={values.description}
            onChange={(e) => set({ description: e.target.value })}
            onBlur={blur}
            aria-describedby="edu-desc-guide"
          />
          <InputGuide id="edu-desc-guide" guide="G-2" />
        </div>
      </FormSection>

      <FormSection
        title="소속 프로젝트"
        actions={
          id ? (
            <Button asChild variant="outline" size="sm">
              <Link href={routes.projectPageNew({ education: id })}>
                <Plus aria-hidden />
                프로젝트 추가
              </Link>
            </Button>
          ) : null
        }
      >
        {education?.projects.length ? (
          <ul className="divide-y rounded-md border">
            {education.projects.map((p) => (
              <li key={p.id}>
                <Item asChild variant="row">
                  <Link href={routes.projectPage(p.id)}>
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name ?? "이름 없는 프로젝트"}</span>
                  {p.status === "draft" ? <DraftBadge label="작성 중 — AI 미반영" /> : null}
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">상세 내용 {p.details.length}</span>
                  <ChevronRight aria-hidden />
                </Link>
                </Item>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{id ? "아직 소속 프로젝트가 없어요" : "운영 기관을 입력하면 프로젝트를 추가할 수 있어요"}</p>
        )}
      </FormSection>

      <DangerZone entityType="education" entityId={id} label={title} afterHref={routes.career()} buttonLabel="교육 삭제" />
    </div>
  )
}
