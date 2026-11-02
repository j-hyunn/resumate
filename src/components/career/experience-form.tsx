"use client"

/**
 * S-09 경력 편집. 필수: company_name, start_month, end_month | is_current,
 * job_rank | job_position (둘 중 하나). 선택: department, employment_type, summary (G-2).
 * 소속 프로젝트 목록, 경력 단위 성과(S-11), C-06 자동 저장, C-05 삭제.
 * Gate path (UQ-4): with a C-10 return target, a save records the experience
 * (recordGateExperience) before notifyCareerSaved() so C-10 can offer S-36.
 */
import * as React from "react"
import Link from "next/link"
import { ChevronRight, CircleAlert, CircleCheck, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/common/basics"
import { DraftBadge, DraftNotice, SaveStatus } from "@/components/common/save-status"
import { InputGuide, MonthField } from "@/components/common/input-guide"
import { readCareerReturn, recordGateExperience } from "@/components/common/return-target"
import { RETURN_FEATURE_LABELS, notifyCareerSaved, useGateContinuation } from "@/components/common/return-banner"
import type { Achievement, EmploymentType, Experience } from "@/types/db"
import { EMPLOYMENT_TYPE_LABELS, directionParticle } from "@/lib/data/labels"
import type { ExperienceWithChildren } from "@/lib/data/career"
import { routes } from "@/lib/routes"
import { saveExperienceAction } from "./actions"
import { DangerZone, FormSection, PeriodError, RequiredMark, SaveProblemNotice, TextField, monthText, nn, useRowAutosave, type ConflictField } from "./form-parts"
import { periodPatch, storedPeriod } from "@/lib/data/row-save"
import { AchievementList } from "./achievement-list"
import { GateNextStep } from "./gate-next-step"

interface Values {
  company_name: string
  start_month: string | null
  end_month: string | null
  is_current: boolean
  job_rank: string
  job_position: string
  department: string
  employment_type: EmploymentType | ""
  summary: string
}

function conflictFields(v: Values): ConflictField[] {
  return [
    { label: "회사명", value: v.company_name },
    { label: "시작", value: monthText(v.start_month) },
    { label: "종료", value: v.is_current ? "재직 중" : monthText(v.end_month) },
    { label: "직급", value: v.job_rank },
    { label: "직책", value: v.job_position },
    { label: "부서", value: v.department },
    { label: "고용 형태", value: v.employment_type ? EMPLOYMENT_TYPE_LABELS[v.employment_type] : "" },
    { label: "요약", value: v.summary },
  ]
}

function toValues(e: Experience | null): Values {
  return {
    company_name: e?.company_name ?? "",
    start_month: e?.start_month ?? null,
    end_month: e?.end_month ?? null,
    is_current: e?.is_current ?? false,
    job_rank: e?.job_rank ?? "",
    job_position: e?.job_position ?? "",
    department: e?.department ?? "",
    employment_type: e?.employment_type ?? "",
    summary: e?.summary ?? "",
  }
}

/** UQ-702: "재직 중" clears the end month on save; a reversed period isn't sent. Same shape as `toValues`. */
function storedValues(v: Values, latest: Experience): Values {
  return { ...v, ...storedPeriod(v.start_month, v.is_current ? null : v.end_month, latest) }
}

export function ExperienceForm({
  experience,
  openAchievementId,
}: {
  experience: ExperienceWithChildren | null
  /** C-02 "원본으로 이동" → open this 경력 단위 성과 in S-11 (`?achievement=`) */
  openAchievementId?: string | null
}) {
  const [values, setValues] = React.useState<Values>(() => toValues(experience))
  const [touched, setTouched] = React.useState(false)
  const gate = useGateContinuation()
  const { recheck } = gate
  const { autosave, row, id, problem, keepMine, takeLatest } = useRowAutosave<Values, Experience>({
    initialId: experience?.id ?? null,
    initialRow: experience,
    editHref: routes.experience,
    comparable: toValues,
    stored: storedValues,
    save: (rowId, v, opts) =>
      saveExperienceAction(
        rowId,
        {
          company_name: nn(v.company_name),
          ...periodPatch(v.start_month, v.is_current ? null : v.end_month),
          is_current: v.is_current,
          job_rank: nn(v.job_rank),
          job_position: nn(v.job_position),
          department: nn(v.department),
          employment_type: v.employment_type || null,
          summary: nn(v.summary),
        },
        opts,
      ),
    onSaved: (saved) => {
      // UQ-4: C-09 "경력이 없을 때" path → remember this experience for the next S-36 chat
      if (readCareerReturn()) {
        recordGateExperience(saved.id)
        notifyCareerSaved()
        void recheck()
      }
    },
  })

  const set = (patch: Partial<Values>) => {
    const next = { ...values, ...patch }
    setValues(next)
    setTouched(true)
    autosave.schedule(next)
  }
  const blur = () => void autosave.flush()
  const status = row?.status ?? experience?.status ?? "draft"
  const title = values.company_name.trim() || "새 경력"
  const missingRank = touched && !values.job_rank.trim() && !values.job_position.trim()

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title={title}
        badge={id && status === "draft" ? <DraftBadge /> : null}
        description="회사명·기간·직급 또는 직책을 채우면 완료돼요"
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

      {gate.target && id && status === "complete" ? (
        <GateCompletion
          featureLabel={RETURN_FEATURE_LABELS[gate.target.feature]}
          ready={gate.ready}
          returnHref={gate.returnHref}
          continueHref={gate.continueHref}
          experienceId={id}
          loading={gate.readiness === null}
        />
      ) : null}

      <FormSection title="기본 정보">
        <TextField id="exp-company" label="회사명" required value={values.company_name} onChange={(v) => set({ company_name: v })} onBlur={blur} />
        <div className="grid gap-4 sm:grid-cols-2">
          <MonthField id="exp-start" label="시작" required value={values.start_month} onChange={(v) => set({ start_month: v })} describedBy="exp-period-error" />
          <MonthField
            id="exp-end"
            label="종료"
            required={!values.is_current}
            value={values.is_current ? null : values.end_month}
            onChange={(v) => set({ end_month: v })}
            ongoing={{ label: "재직 중", checked: values.is_current, onCheckedChange: (checked) => set({ is_current: checked }) }}
            describedBy="exp-period-error"
          />
        </div>
        <PeriodError id="exp-period-error" start={values.start_month} end={values.is_current ? null : values.end_month} />
        <fieldset className="space-y-2">
          <legend className="text-sm leading-5 font-medium">
            직급 / 직책 (둘 중 하나)
            <RequiredMark />
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="exp-rank" label="직급" value={values.job_rank} onChange={(v) => set({ job_rank: v })} onBlur={blur} invalid={missingRank} describedBy={missingRank ? "exp-rank-error" : undefined} />
            <TextField id="exp-position" label="직책" value={values.job_position} onChange={(v) => set({ job_position: v })} onBlur={blur} invalid={missingRank} describedBy={missingRank ? "exp-rank-error" : undefined} />
          </div>
          {missingRank ? (
            <p id="exp-rank-error" className="flex items-center gap-1.5 text-sm text-destructive" role="status">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              직급이나 직책 중 하나를 입력해 주세요
            </p>
          ) : null}
        </fieldset>
      </FormSection>

      <FormSection title="선택 정보">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="exp-dept" label="부서" value={values.department} onChange={(v) => set({ department: v })} onBlur={blur} />
          <div className="space-y-1.5">
            <Label htmlFor="exp-type" className="text-sm font-medium">
              고용 형태
            </Label>
            <Select value={values.employment_type} onValueChange={(v) => set({ employment_type: v as EmploymentType })}>
              <SelectTrigger id="exp-type" className="w-full">
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {EMPLOYMENT_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="exp-summary" className="text-sm font-medium">
            요약
          </Label>
          <Textarea
            id="exp-summary"
            className="min-h-24 text-base leading-[1.75]"
            value={values.summary}
            onChange={(e) => set({ summary: e.target.value })}
            onBlur={blur}
            aria-describedby="exp-summary-guide"
          />
          <InputGuide id="exp-summary-guide" guide="G-2" />
        </div>
      </FormSection>

      <FormSection
        title="소속 프로젝트"
        actions={
          id ? (
            <Button asChild variant="outline" size="sm">
              <Link href={routes.projectNew({ experience_id: id })}>
                <Plus aria-hidden />
                프로젝트 추가
              </Link>
            </Button>
          ) : null
        }
      >
        {experience?.projects.length ? (
          <ul className="divide-y rounded-md border">
            {experience.projects.map((p) => (
              <li key={p.id}>
                <Link href={routes.project(p.id)} className="flex min-h-11 items-center gap-2 px-3 py-2.5 transition-colors hover:bg-accent">
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name ?? "이름 없는 프로젝트"}</span>
                  {p.status === "draft" ? <DraftBadge label="작성 중 — AI 미반영" /> : null}
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">상세 내용 {p.details.length}</span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{id ? "아직 소속 프로젝트가 없어요" : "회사명을 입력하면 프로젝트를 추가할 수 있어요"}</p>
        )}
      </FormSection>

      <FormSection title="경력 단위 성과" description="연간 평가, 수상처럼 이 경력 전체에 대한 성과">
        <AchievementList
          items={(experience?.achievements ?? []) as Achievement[]}
          openId={openAchievementId}
          link={id ? { experience_id: id } : null}
          targetLabel={`경력 '${title}'`}
          disabledReason="회사명을 입력하면 성과를 추가할 수 있어요"
          addLabel="+ 성과 추가"
        />
      </FormSection>

      <DangerZone entityType="experience" entityId={id} label={title} afterHref={routes.career()} buttonLabel="경력 삭제" />
    </div>
  )
}

/** S-09 save-complete state on the C-09 path (UQ-4): return or continue to S-36 */
function GateCompletion({
  featureLabel,
  ready,
  returnHref,
  continueHref,
  experienceId,
  loading,
}: {
  loading: boolean
  featureLabel: string
  ready: boolean
  returnHref: string | null
  continueHref: string | null
  experienceId: string | null
}) {
  return (
    <Card className="gap-3 border-success/30 p-5" role="status">
      <p className="flex items-center gap-2 font-semibold">
        <CircleCheck className="size-5 text-success" aria-hidden />
        경력이 저장됐어요
        {ready ? <Badge variant="success">준비됨</Badge> : null}
      </p>
      <p className="text-sm text-muted-foreground">
        {ready
          ? `이제 ${featureLabel}${directionParticle(featureLabel)} 돌아갈 수 있어요`
          : "완료된 프로젝트가 아직 필요해요. 이 경력의 프로젝트를 정리해 보세요"}
        {/* [UI-가정] completion copy not in spec */}
      </p>
      <GateNextStep
        featureLabel={featureLabel}
        ready={ready}
        returnHref={returnHref}
        continueHref={continueHref}
        directHref={routes.projectNew(experienceId ? { experience_id: experienceId } : undefined)}
        loading={loading}
      />
    </Card>
  )
}
