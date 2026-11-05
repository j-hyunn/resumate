"use client"

/**
 * S-04 기본 프로필 편집 — `profiles.display_name`만 남았다.
 *
 * R13 (DM v4.12 2.1.1, SD-2·SD-A4·SD-A17): `desired_job_title`·`total_years_of_experience`·
 * `interested_industries` 컬럼이 삭제되어 희망 직무·총 경력·관심 산업 입력을 뺐다(백엔드 최소 수정).
 * **S-04 자체는 폐기**(UX v5.17, SD-A2)이고 같은 값은 S-24 ① 계정 탭 "내 정보"에서 고친다 —
 * 화면 폐기와 `/career/profile` 리다이렉트는 `resumate-ui` 후속이다.
 */
import * as React from "react"
import { PageHeader } from "@/components/common/basics"
import { SaveStatus } from "@/components/common/save-status"
import type { Profile } from "@/types/db"
import { saveProfileAction } from "./actions"
import { FormSection, TextField, nn, useRowAutosave } from "./form-parts"

interface Values {
  display_name: string
}

export function ProfileForm({ profile }: { profile: Profile }) {
  const [values, setValues] = React.useState<Values>({ display_name: profile.display_name ?? "" })
  const { autosave } = useRowAutosave<Values, Profile & { status?: string }>({
    initialId: profile.id,
    initialRow: profile,
    // The profile has no `updated_at` in its contract: last write wins, and the row always exists (one per user)
    save: async (_id, v, opts) => {
      const saved = await saveProfileAction({ display_name: nn(v.display_name) }, { fail: opts.fail })
      return { ok: true, row: saved }
    },
  })
  const set = (patch: Partial<Values>) => {
    const next = { ...values, ...patch }
    setValues(next)
    autosave.schedule(next)
  }
  const blur = () => void autosave.flush()

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="기본 프로필"
        description="커리어 화면 상단 요약에 쓰여요"
        status={<SaveStatus state={autosave.state} savedAt={autosave.savedAt} onRetry={autosave.retry} />}
      />
      <FormSection title="프로필">
        <TextField id="pf-name" label="이름" value={values.display_name} onChange={(v) => set({ display_name: v })} onBlur={blur} />
      </FormSection>
    </div>
  )
}
