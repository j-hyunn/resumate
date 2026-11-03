"use client"

/**
 * S-34 교육 편집. 기관명* · 구분*(degree/course) · 전공/과정명 · 기간(시작* / 종료) ·
 * 상태(enrolled면 종료월 비활성) · 설명(G-2) · 소속 프로젝트 · C-06 · C-05.
 */
import * as React from "react"
import Link from "next/link"
import { ChevronRight, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/common/basics"
import { DraftBadge, DraftNotice, SaveStatus } from "@/components/common/save-status"
import { InputGuide, MonthField } from "@/components/common/input-guide"
import type { Education, EducationType, EnrollmentStatus } from "@/types/db"
import { EDUCATION_TYPE_LABELS, ENROLLMENT_STATUS_LABELS } from "@/lib/data/labels"
import type { EducationWithChildren } from "@/lib/data/career"
import { routes } from "@/lib/routes"
import { saveEducationAction } from "./actions"
import { DangerZone, FormSection, PeriodError, RequiredMark, SaveProblemNotice, TextField, monthText, nn, useRowAutosave, type ConflictField } from "./form-parts"
import { periodPatch, storedPeriod } from "@/lib/data/row-save"
import { Item } from "@/components/ui/item"

interface Values {
  institution_name: string
  education_type: EducationType | ""
  program_name: string
  start_month: string | null
  end_month: string | null
  enrollment_status: EnrollmentStatus | ""
  description: string
}

function toValues(e: Education | null): Values {
  return {
    institution_name: e?.institution_name ?? "",
    education_type: e?.education_type ?? "",
    program_name: e?.program_name ?? "",
    start_month: e?.start_month ?? null,
    end_month: e?.end_month ?? null,
    enrollment_status: e?.enrollment_status ?? "",
    description: e?.description ?? "",
  }
}

function conflictFields(v: Values): ConflictField[] {
  return [
    { label: "기관명", value: v.institution_name },
    { label: "구분", value: v.education_type ? EDUCATION_TYPE_LABELS[v.education_type] : "" },
    { label: "전공/과정명", value: v.program_name },
    { label: "시작", value: monthText(v.start_month) },
    { label: "종료", value: monthText(v.end_month) },
    { label: "상태", value: v.enrollment_status ? ENROLLMENT_STATUS_LABELS[v.enrollment_status] : "" },
    { label: "설명", value: v.description },
  ]
}

const TYPE_HELP: Record<EducationType, string> = {
  degree: "대학·대학원 등",
  course: "부트캠프·사내외 교육",
}

/** UQ-702: "재학 중" clears the end month on save; a reversed period isn't sent. Same shape as `toValues`. */
function storedValues(v: Values, latest: Education): Values {
  return { ...v, ...storedPeriod(v.start_month, v.enrollment_status === "enrolled" ? null : v.end_month, latest) }
}

export function EducationForm({ education }: { education: EducationWithChildren | null }) {
  const [values, setValues] = React.useState<Values>(() => toValues(education))
  const { autosave, row, id, problem, keepMine, takeLatest } = useRowAutosave<Values, Education>({
    initialId: education?.id ?? null,
    initialRow: education,
    editHref: routes.education,
    comparable: toValues,
    stored: storedValues,
    save: (rowId, v, opts) =>
      saveEducationAction(
        rowId,
        {
          institution_name: nn(v.institution_name),
          education_type: v.education_type || null,
          program_name: nn(v.program_name),
          ...periodPatch(v.start_month, v.enrollment_status === "enrolled" ? null : v.end_month),
          enrollment_status: v.enrollment_status || null,
          description: nn(v.description),
        },
        opts,
      ),
  })
  const set = (patch: Partial<Values>) => {
    const next = { ...values, ...patch }
    setValues(next)
    autosave.schedule(next)
  }
  const blur = () => void autosave.flush()
  const status = row?.status ?? education?.status ?? "draft"
  const title = values.institution_name.trim() || "새 교육"
  const enrolled = values.enrollment_status === "enrolled"

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title={title}
        badge={id && status === "draft" ? <DraftBadge /> : null}
        description="기관명·구분·시작월을 채우면 완료돼요"
        status={<SaveStatus state={autosave.state} savedAt={autosave.savedAt} onRetry={autosave.retry} />}
      />
      <SaveProblemNotice
        problem={problem}
        mine={conflictFields(values)}
        latest={(r) => conflictFields(toValues(r))}
        onKeepMine={keepMine}
        onTakeLatest={() => {
          const latest = takeLatest()
          if (latest) setValues(toValues(latest))
        }}
      />
      {id && status === "draft" ? <DraftNotice /> : null}

      <FormSection title="기본 정보">
        <TextField id="edu-name" label="기관명" required value={values.institution_name} onChange={(v) => set({ institution_name: v })} onBlur={blur} />
        <fieldset className="space-y-2">
          <legend className="text-sm leading-5 font-medium">
            구분
            <RequiredMark />
          </legend>
          <RadioGroup
            value={values.education_type}
            onValueChange={(v) => set({ education_type: v as EducationType })}
            className="grid gap-2 sm:grid-cols-2"
          >
            {(Object.keys(EDUCATION_TYPE_LABELS) as EducationType[]).map((t) => (
              <Label
                key={t}
                htmlFor={`edu-type-${t}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-base font-normal has-[:checked]:border-primary has-[:checked]:bg-primary-subtle"
              >
                <RadioGroupItem id={`edu-type-${t}`} value={t} className="mt-1" />
                <span className="space-y-0.5">
                  <span className="block font-medium">{EDUCATION_TYPE_LABELS[t]}</span>
                  <span className="block text-sm text-muted-foreground">{TYPE_HELP[t]}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </fieldset>
        <TextField id="edu-program" label="전공/과정명" value={values.program_name} onChange={(v) => set({ program_name: v })} onBlur={blur} />
        <div className="grid gap-4 sm:grid-cols-2">
          <MonthField id="edu-start" label="시작" required value={values.start_month} onChange={(v) => set({ start_month: v })} describedBy="edu-period-error" />
          <MonthField id="edu-end" label="종료" value={enrolled ? null : values.end_month} disabled={enrolled} onChange={(v) => set({ end_month: v })} describedBy="edu-period-error" />
        </div>
        <PeriodError id="edu-period-error" start={values.start_month} end={enrolled ? null : values.end_month} />
        <div className="space-y-1.5">
          <Label htmlFor="edu-status" className="text-sm font-medium">
            상태
          </Label>
          <Select value={values.enrollment_status} onValueChange={(v) => set({ enrollment_status: v as EnrollmentStatus })}>
            <SelectTrigger id="edu-status" className="w-full sm:w-60">
              <SelectValue placeholder="선택" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ENROLLMENT_STATUS_LABELS) as EnrollmentStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {ENROLLMENT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {enrolled ? <p className="text-sm text-muted-foreground">재학·수강 중이면 종료월은 비워 둬요</p> : null}
        </div>
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
          <p className="text-sm text-muted-foreground">{id ? "아직 소속 프로젝트가 없어요" : "기관명을 입력하면 프로젝트를 추가할 수 있어요"}</p>
        )}
      </FormSection>

      <DangerZone entityType="education" entityId={id} label={title} afterHref={routes.career()} buttonLabel="교육 삭제" />
    </div>
  )
}
