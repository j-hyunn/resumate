"use client"

/**
 * Small A3 client helpers: polling refresh, C-03 축약형 for a job id, C-05 기업 JD 삭제 hook,
 * return-param restore on entry (C-10 → original screen).
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AiProgressInline, useAiJob } from "@/components/common/ai-progress"
import { DeleteConfirmDialog } from "@/components/common/delete-confirm-dialog"
import { consumeReturnParams } from "@/components/common/return-target"
import type { ReturnTargetFeature } from "@/types/db"
import { deleteApplicationAction } from "@/app/(dashboard)/applications/_lib/actions"

/** Re-render the server page every `intervalMs` while `active` (mock stand-in for Realtime). */
export function AutoRefresh({ active, intervalMs = 2_000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter()
  React.useEffect(() => {
    if (!active) return
    const t = setInterval(() => router.refresh(), intervalMs)
    return () => clearInterval(t)
  }, [active, intervalMs, router])
  return null
}

/** C-03 축약형 bound to a running job; refreshes the page when it finishes. */
export function JobInline({ jobId, label, className }: { jobId: string; label?: string; className?: string }) {
  const router = useRouter()
  const { progress, status, job } = useAiJob(jobId, { onDone: () => router.refresh() })
  React.useEffect(() => {
    if (status === "failed" || status === "canceled") router.refresh()
  }, [status, router])
  // v5.3 C-03: job-dependent stage copy (prepare "공고 요건 정리 중" / "채점 준비 중", 질문 n/N, complete)
  return <AiProgressInline progress={progress} jobType={job?.job_type ?? null} label={label} className={className} />
}

/** C-05 기업 JD 삭제 (FL-06): impact counts + 확인 체크 → delete → toast → `after()` */
export function useDeleteApplication({ after }: { after?: () => void } = {}) {
  const router = useRouter()
  const [target, setTarget] = React.useState<{ id: string; name: string } | null>(null)
  const dialog = (
    <DeleteConfirmDialog
      open={target !== null}
      onOpenChange={(o) => !o && setTarget(null)}
      target={target ? { kind: "application_project", entity_id: target.id, label: target.name } : null}
      onConfirm={async () => {
        if (!target) return
        await deleteApplicationAction(target.id)
        // [UI-가정] 삭제 완료 토스트 문구
        toast.success(`${target.name} 기업 JD를 삭제했어요`)
        setTarget(null)
        if (after) after()
        else router.refresh()
      }}
    />
  )
  return { open: (id: string, name: string) => setTarget({ id, name }), dialog }
}

/**
 * C-10 → original screen: restore in-progress settings once on entry (clears the return target).
 * `onRestore` receives the stored params (경력기술서 포함 항목 등).
 */
export function useRestoreReturnParams(
  applicationProjectId: string,
  feature: ReturnTargetFeature,
  onRestore?: (params: Record<string, unknown>) => void,
) {
  const done = React.useRef(false)
  const cb = React.useRef(onRestore)
  React.useEffect(() => {
    cb.current = onRestore
  })
  React.useEffect(() => {
    if (done.current) return
    done.current = true
    const params = consumeReturnParams(applicationProjectId, feature)
    if (params && cb.current) cb.current(params)
  }, [applicationProjectId, feature])
}
