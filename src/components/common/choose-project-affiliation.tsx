"use client"

/**
 * C-23 소속 선택 진입 (UX v5.9 C-23 — C-09 `create_project` / "직접 입력하기"(작성 중 항목 없음) / S-16 보완점
 * "관련 경험 추가하기"). Loads this user's experiences / educations and opens A2's `AddProjectDialog`:
 * 경력·교육 → "계속" = S-10 새 프로젝트(행 없음), "소속 없음" → "계속" → C-22와 같은 추가 모달(`AddCareerDialog`
 * kind="project", "추가하기" 때 생성 — UX v5.9, D-UX-28) → S-43.
 *
 *   const choose = useChooseProjectAffiliation()
 *   <Button onClick={() => { markCareerReturn(target); choose.open() }}>…</Button>
 *   {choose.dialog}
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AddCareerDialog } from "@/components/career/add-career-dialog"
import { AddProjectDialog, type AffiliationOption } from "@/components/career/add-project-dialog"
import { listProjectAffiliationsAction } from "@/lib/data/career-v45-actions"
import { routes } from "@/lib/routes"

export function useChooseProjectAffiliation(): { open: (opts?: { requirementId?: string | null }) => void; loading: boolean; dialog: React.ReactNode } {
  const router = useRouter()
  const [isOpen, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [options, setOptions] = React.useState<{ affiliations: AffiliationOption[]; defaultId: string | null } | null>(null)
  // S-16 보완점: the requirement travels to the S-10 새 페이지 ("관련 요건" 줄) via AddProjectDialog `requirementId`
  const [requirementId, setRequirementId] = React.useState<string | null>(null)
  // "소속 없음" → the 독립 프로젝트 추가 모달
  const [addingStandalone, setAddingStandalone] = React.useState(false)

  const open = React.useCallback((opts?: { requirementId?: string | null }) => {
    setRequirementId(opts?.requirementId ?? null)
    setLoading(true)
    void listProjectAffiliationsAction()
      .then((r) => {
        setOptions({ affiliations: r.affiliations, defaultId: r.default_id })
        setOpen(true)
      })
      // [UI-가정] the list read failed: say so, nothing opens
      .catch(() => toast("경력·교육 목록을 불러오지 못했어요. 다시 시도해 주세요"))
      .finally(() => setLoading(false))
  }, [])

  const dialog = (
    <>
      {options ? (
        <AddProjectDialog
          open={isOpen}
          onOpenChange={setOpen}
          affiliations={options.affiliations}
          defaultAffiliationId={options.defaultId}
          requirementId={requirementId}
          onStandalone={() => setAddingStandalone(true)}
        />
      ) : null}
      <AddCareerDialog
        kind={addingStandalone ? "project" : null}
        onOpenChange={(o) => !o && setAddingStandalone(false)}
        onCreated={({ id }) => {
          setAddingStandalone(false)
          router.push(routes.careerItem("project", id))
        }}
      />
    </>
  )

  return { open, loading, dialog }
}
