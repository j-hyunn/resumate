"use client"

/**
 * S-04 기본 프로필 편집. profiles.display_name, desired_job_title,
 * total_years_of_experience, interested_industries. Autosave (C-06).
 */
import * as React from "react"
import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/common/basics"
import { SaveStatus } from "@/components/common/save-status"
import type { Profile } from "@/types/db"
import { saveProfileAction } from "./actions"
import { FormSection, TextField, nn, useRowAutosave } from "./form-parts"

interface Values {
  display_name: string
  desired_job_title: string
  total_years_of_experience: string
  interested_industries: string[]
}

export function ProfileForm({ profile }: { profile: Profile }) {
  const [values, setValues] = React.useState<Values>({
    display_name: profile.display_name ?? "",
    desired_job_title: profile.desired_job_title ?? "",
    total_years_of_experience: profile.total_years_of_experience === null ? "" : String(profile.total_years_of_experience),
    interested_industries: profile.interested_industries,
  })
  const [industry, setIndustry] = React.useState("")
  const { autosave } = useRowAutosave<Values, Profile & { status?: string }>({
    initialId: profile.id,
    initialRow: profile,
    save: (_id, v, opts) => {
      const years = Number(v.total_years_of_experience)
      return saveProfileAction(
        {
          display_name: nn(v.display_name),
          desired_job_title: nn(v.desired_job_title),
          total_years_of_experience: v.total_years_of_experience.trim() && Number.isInteger(years) && years >= 0 && years <= 50 ? years : null,
          interested_industries: v.interested_industries,
        },
        opts,
      )
    },
  })
  const set = (patch: Partial<Values>, now = false) => {
    const next = { ...values, ...patch }
    setValues(next)
    autosave.schedule(next)
    if (now) void autosave.flush()
  }
  const blur = () => void autosave.flush()
  const addIndustry = () => {
    const v = industry.trim()
    setIndustry("")
    if (v && !values.interested_industries.includes(v)) set({ interested_industries: [...values.interested_industries, v] }, true)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="기본 프로필"
        description="커리어 화면 상단 요약과 AI 분석에 쓰여요"
        status={<SaveStatus state={autosave.state} savedAt={autosave.savedAt} onRetry={autosave.retry} />}
      />
      <FormSection title="프로필">
        <TextField id="pf-name" label="이름" value={values.display_name} onChange={(v) => set({ display_name: v })} onBlur={blur} />
        <TextField id="pf-job" label="희망 직무" value={values.desired_job_title} onChange={(v) => set({ desired_job_title: v })} onBlur={blur} />
        <TextField
          id="pf-years"
          label="총 경력(년)"
          inputMode="numeric"
          className="sm:w-40"
          maxLength={2}
          help={<p className="text-sm text-muted-foreground">0~50 사이 정수</p>}
          value={values.total_years_of_experience}
          // UQ-73: smallint 0..50 — digits only, clamped
          onChange={(v) => {
            const digits = v.replace(/[^\d]/g, "")
            set({ total_years_of_experience: digits === "" ? "" : String(Math.min(50, Number(digits))) })
          }}
          onBlur={blur}
        />
        <div className="space-y-1.5">
          <Label htmlFor="pf-industry" className="text-sm font-medium">
            관심 산업
          </Label>
          {values.interested_industries.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="관심 산업">
              {values.interested_industries.map((s) => (
                <li key={s}>
                  <Badge variant="secondary" className="h-8 gap-1 pr-1 pl-3 text-sm">
                    {s}
                    <Button
                      variant="ghost"
                      size="icon-xs" className="size-11 lg:size-7"
                      aria-label={`${s} 빼기`}
                      onClick={() => set({ interested_industries: values.interested_industries.filter((x) => x !== s) }, true)}
                    >
                      <X aria-hidden />
                    </Button>
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Input
              id="pf-industry"
              placeholder="예: 핀테크 (입력 후 Enter)"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  addIndustry()
                }
              }}
            />
            <Button variant="outline" onClick={addIndustry} disabled={!industry.trim()}>
              추가
            </Button>
          </div>
        </div>
      </FormSection>
    </div>
  )
}
