import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { JdRawEditProvider } from "@/components/applications/jd-raw-edit"
import { JdView } from "@/components/applications/jd-view"
import { parseSentenceParam } from "@/components/applications/jd-highlight"
import { getJobDescription } from "@/lib/data/applications"
import { getPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"

/**
 * S-46 **"채용 공고" 탭** = S-15 규칙 그대로 (v5.20 재정의, CF-7·CF-A12 — ID 유지 · v5.21, JR-1·JR-7·JR-Q1).
 * - 공고 원문 + 근거 문장 하이라이트(`?tab=jd&s=S3,S4`)만 있다 — 요건 목록·"요건 정리하기"·추출 실패 안내는 없다.
 *   AI 진입점이 없어 키 없이 전부 된다(C-18·C-19·C-20 없음).
 * - [공고 내용 수정]은 늘 보이고, 인사이트가 대기·실행 중일 때만 비활성(`rawTextLockedReason = job_in_progress`).
 * - 공고 원문 패널 머리에 `source_url`이 있으면 "원래 공고 열기" (CF-A16).
 * - "돌아가기"는 **{인사이트 / 자소서} 탭으로** 간다(`?from=insight|cover_letter`, CF-A12).
 *
 * 공고 내용 수정의 "저장"/"취소"는 **탭 안의 버튼**이고 상단 바 "저장하기"와 섞지 않는다.
 *
 * `?state=`: `raw-edit` (수정 중) · `raw-save-failed` · `raw-save-refused` (`jd_job_in_progress`) ·
 * `raw-save-no-sentences` (`jd_no_sentences`) · `raw-saved` · `raw-locked` (인사이트 진행 중 — 버튼 비활성)
 */
type SP = Record<string, string | string[] | undefined>

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** "{인사이트 / 자소서} 탭으로 돌아가기" (v5.20, CF-A12) */
function returnLabel(from: string | undefined): string | null {
  if (from === "insight") return "인사이트 탭으로 돌아가기"
  if (from === "cover_letter") return "자소서 탭으로 돌아가기"
  return null
}

const RAW_PREVIEWS = ["raw-edit", "raw-save-failed", "raw-save-refused", "raw-save-no-sentences", "raw-saved", "raw-locked"]

export async function JdTab({ applicationProjectId: id, searchParams: sp }: { applicationProjectId: string; searchParams: SP }) {
  const state = getPreviewState(sp)
  const jd = await getJobDescription(id)
  if (!jd) return <p className="text-sm text-muted-foreground">공고를 찾을 수 없어요</p>

  // 공고 내용 수정 미리 보기는 저장소를 바꾸지 않는다
  const rawPreview = !!state && RAW_PREVIEWS.includes(state)
  const previewSave =
    state === "raw-save-failed" ? "failed" : state === "raw-save-refused" ? "refused" : state === "raw-save-no-sentences" ? "no_sentences" : rawPreview ? "ok" : null
  const locked = rawPreview ? state === "raw-locked" || one(sp.refused) === "1" : !jd.raw_text_editable
  const lockedReason = locked ? (rawPreview ? "job_in_progress" : jd.raw_text_locked_reason) : null
  const back = returnLabel(one(sp.from))

  return (
    <div className="space-y-6">
      {back ? (
        <Button asChild variant="outline" size="sm">
          <Link href={routes.coverLetter(id, one(sp.from) === "insight" ? { tab: "insight" } : undefined)}>
            <ArrowLeft aria-hidden />
            {back}
          </Link>
        </Button>
      ) : null}
      <JdRawEditProvider
        key={state ?? "stored"}
        editable={!locked}
        lockedReason={lockedReason}
        initialEditing={!locked && (state === "raw-edit" || state === "raw-save-failed" || state === "raw-save-refused" || state === "raw-save-no-sentences" || one(sp.edit) === "1")}
        initialSaved={state === "raw-saved"}
      >
        <JdView
          applicationProjectId={id}
          previewSave={previewSave}
          rawText={jd.raw_text}
          sentences={jd.sentences}
          sourceUrl={jd.source_url ?? null}
          highlight={parseSentenceParam(sp.s)}
        />
      </JdRawEditProvider>
    </div>
  )
}
