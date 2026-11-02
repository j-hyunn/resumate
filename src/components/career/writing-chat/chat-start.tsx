"use client"

/**
 * S-36 시작 영역 (새 대화). 안내 + 보관 안내 · 소속 선택(새 프로젝트 모드만, 기본값 =
 * 쿼리의 experience_id — UQ-4) · "대화 시작"(AiRunButton: C-18 when no key, C-19 badge; v4 no count).
 * Gate entry: return_target = { application_project_id, feature, params } with params
 * from the C-09 session target (UQ-5, 영역 규칙 4).
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { Archive, Info, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageHeader } from "@/components/common/basics"
import { AiRunButton } from "@/components/common/ai-run-button"
import { consumeAiReturnParams } from "@/components/common/ai-connect-return"
import { AiLock } from "@/components/common/ai-lock"
import { notifyAiConnectionChanged, useAiConnection } from "@/components/common/ai-connection-context"
import { markCareerReturn, readCareerReturn } from "@/components/common/return-target"
import type { DataReadiness, Education, Experience, ReturnTargetFeature, WritingChatMode } from "@/types/db"
import type { ProjectWithChildren } from "@/lib/data/career"
import { routes } from "@/lib/routes"
import { startWritingChatAction } from "../actions"
import { chatLock } from "../gate-next-step"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { featureHref, GateBanner } from "./gate"

// [UI-가정] "없음"과 "대화하면서 정할게요"는 모두 experience_id/education_id = null 로 시작(구분 컬럼 없음)
type AffiliationChoice = "experience" | "education" | "none" | "later"

export function ChatStart({
  mode,
  project,
  experiences,
  educations,
  defaultExperienceId,
  defaultEducationId,
  gate,
  readiness,
}: {
  mode: WritingChatMode
  project: ProjectWithChildren | null
  experiences: Pick<Experience, "id" | "company_name">[]
  educations: Pick<Education, "id" | "institution_name">[]
  defaultExperienceId?: string
  defaultEducationId?: string
  gate: { application_project_id: string; feature: ReturnTargetFeature; application_name: string } | null
  readiness: DataReadiness
}) {
  const router = useRouter()
  const [choice, setChoice] = React.useState<AffiliationChoice>(
    defaultExperienceId ? "experience" : defaultEducationId ? "education" : "later",
  )
  const [experienceId, setExperienceId] = React.useState(defaultExperienceId ?? experiences[0]?.id ?? "")
  const [educationId, setEducationId] = React.useState(defaultEducationId ?? educations[0]?.id ?? "")
  const [pending, setPending] = React.useState(false)
  // UQ-352: FL-19 "설정 복원" — the affiliation chosen before going to AI 연결
  const returnParams = { affiliation: choice, experience_id: experienceId, education_id: educationId }
  React.useEffect(() => {
    const restore = () => {
      const back = consumeAiReturnParams()
      if (!back) return
      const c = back.affiliation
      if (c === "experience" || c === "education" || c === "none" || c === "later") setChoice(c)
      if (typeof back.experience_id === "string" && experiences.some((e) => e.id === back.experience_id)) setExperienceId(back.experience_id)
      if (typeof back.education_id === "string" && educations.some((e) => e.id === back.education_id)) setEducationId(back.education_id)
    }
    restore()
  }, [experiences, educations])
  const connection = useAiConnection()
  // 02 S-36 시작: 키 없음 → 이 영역 전체가 C-18 (영역형, D-UX-15 — 기존 결과 없음)
  const locked = connection !== null && !connection.active_provider
  // UQ-292: the form alternative keeps the gate's affiliation (C-09 "완료 경력이 있으면 소속 미리 선택")
  const directHref =
    mode === "augment_project" && project
      ? routes.projectDetailNew(project.id)
      : routes.projectNew(
          defaultExperienceId ? { experience_id: defaultExperienceId } : defaultEducationId ? { education_id: defaultEducationId } : undefined,
        )
  const keyInvalid = connection?.key_status === "invalid"

  const start = async () => {
    setPending(true)
    let returnTarget = null
    if (gate) {
      const stored = readCareerReturn()
      // UQ-66: params only when both the 기업 JD and the feature match
      const params =
        stored && stored.application_project_id === gate.application_project_id && stored.feature === gate.feature ? (stored.params ?? {}) : {}
      returnTarget = { application_project_id: gate.application_project_id, feature: gate.feature, params }
      if (!stored)
        markCareerReturn({ ...returnTarget, application_name: gate.application_name, href: featureHref(gate.feature, gate.application_project_id, params) })
    }
    const result = await startWritingChatAction({
      mode,
      project_id: mode === "augment_project" ? project?.id : null,
      experience_id: mode === "new_project" && choice === "experience" ? experienceId || null : null,
      education_id: mode === "new_project" && choice === "education" ? educationId || null : null,
      return_target: returnTarget,
    })
    if (!result.ok) {
      // key removed elsewhere → refresh the connection so the button turns into C-18
      toast.error("AI 연결하면 사용할 수 있어요")
      notifyAiConnectionChanged()
      setPending(false)
      return
    }
    router.replace(routes.writingChat(result.id))
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="AI 작성 대화"
        description={mode === "augment_project" ? `'${project?.name ?? "프로젝트"}'에 상세 내용 추가` : "새 프로젝트 정리"}
      />
      {gate ? <GateBanner feature={gate.feature} applicationName={gate.application_name} readiness={readiness} readyToReturn={false} /> : null}

      {locked ? (
        <AiLock
          entry="writing_chat"
          size="area"
          featureLabel="AI 작성 대화"
          alternativeLabel="직접 입력"
          alternativeHref={directHref}
          returnParams={returnParams}
        />
      ) : (
      <>
      <Card className="gap-4 p-5">
        <p className="flex items-start gap-2 text-base leading-[1.75]">
          <Sparkles className="mt-1.5 size-4 shrink-0 text-ai" aria-hidden />
          질문에 답하면 AI가 프로젝트와 상세 내용(상황·과제·행동·결과·회고 및 배운 점)으로 정리해요. 말하지 않은 내용은 쓰지 않아요. 저장 전에 직접 확인하고 고칠 수 있어요
        </p>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Archive className="mt-0.5 size-4 shrink-0" aria-hidden />
          저장한 대화는 프로젝트와 함께 계속 보관돼요. 대화만 따로 삭제할 수 있어요. 저장하지 않은 대화는 마지막 활동 후 90일 뒤 자동 삭제돼요
        </p>
      </Card>

      {mode === "new_project" ? (
        <Card className="gap-4 p-5">
          <fieldset className="space-y-3">
            <legend className="text-base leading-6 font-semibold">소속</legend>
            <RadioGroup value={choice} onValueChange={(v) => setChoice(v as AffiliationChoice)} className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  { value: "experience", label: "경력", disabled: experiences.length === 0 },
                  { value: "education", label: "교육", disabled: educations.length === 0 },
                  { value: "none", label: "없음 (기타 프로젝트)", disabled: false },
                  { value: "later", label: "대화하면서 정할게요", disabled: false },
                ] as const
              ).map((o) => (
                <Label
                  key={o.value}
                  htmlFor={`aff-${o.value}`}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-4 text-base font-normal has-[:checked]:border-primary has-[:checked]:bg-primary-subtle has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
                >
                  <RadioGroupItem id={`aff-${o.value}`} value={o.value} disabled={o.disabled} />
                  {o.label}
                </Label>
              ))}
            </RadioGroup>
            {choice === "experience" ? (
              <Select value={experienceId} onValueChange={setExperienceId}>
                <SelectTrigger aria-label="경력 선택" className="w-full sm:w-80">
                  <SelectValue placeholder="경력 선택" />
                </SelectTrigger>
                <SelectContent>
                  {experiences.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.company_name ?? "회사명 없음"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {choice === "education" ? (
              <Select value={educationId} onValueChange={setEducationId}>
                <SelectTrigger aria-label="교육 선택" className="w-full sm:w-80">
                  <SelectValue placeholder="교육 선택" />
                </SelectTrigger>
                <SelectContent>
                  {educations.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.institution_name ?? "기관명 없음"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              여기서 고른 소속으로 저장돼요. 나중에 정해도 돼요
            </p>
          </fieldset>
        </Card>
      ) : null}

      <AiRunButton
        lock={{ ...chatLock("대화 시작", directHref), returnParams }}
        onRun={() => void start()}
        pending={pending}
        disabled={mode === "augment_project" && !project}
        footer={
          keyInvalid ? (
            // UQ-292: 키 무효 → C-20(누르면) + 폼 경로 (FL-13 v5)
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              키를 확인하는 동안 직접 입력으로 채울 수도 있어요
              <Button asChild variant="link" size="sm" className="h-auto px-0">
                <Link href={directHref}>직접 입력</Link>
              </Button>
            </p>
          ) : connection?.connection_tier === "free" ? (
            // D-37 무료 등급 순차 모드
            <p className="text-sm text-muted-foreground">무료 등급은 응답이 조금 느릴 수 있어요</p>
          ) : null
        }
      >
        대화 시작
      </AiRunButton>
      </>
      )}
    </div>
  )
}
