import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { JdLockedNotice, JdRawEditProvider } from "@/components/applications/jd-raw-edit"
import { JdView } from "@/components/applications/jd-view"
import { getJobDescription } from "@/lib/data/applications"
import { isInputCausedJdFailure } from "@/lib/data/jd-raw-text"
import { getPreviewState } from "@/lib/preview-state"
import { routes } from "@/lib/routes"
import type { AiErrorCode } from "@/types/db"

/**
 * S-46 **"채용 공고" 탭** = S-15 규칙 그대로 (v5.20 재정의, CF-7·CF-A12 — ID 유지).
 * 옛 `/applications/{id}/jd` 페이지의 판정을 그대로 옮겼고 바뀐 것은 세 가지다:
 * - 화면 머리(`PageHeader`)·이동 경로를 그리지 않는다 — S-46 머리가 하나뿐이다.
 * - 공고 원문 패널 머리에 `source_url`이 있으면 "원래 공고 열기"가 붙는다 (CF-A16).
 * - "돌아가기"는 **{인사이트 / 자소서} 탭으로** 간다(`?from=insight|cover_letter`, CF-A12).
 *
 * 공고 원문 수정(Q53-2·Q53-11)의 "저장"/"취소"는 **탭 안의 버튼**이고 상단 바 "저장하기"와 섞지 않는다.
 */
type SP = Record<string, string | string[] | undefined>

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** "{인사이트 / 자소서} 탭으로 돌아가기" (v5.20, CF-A12) */
function returnLabel(from: string | undefined): string | null {
  if (from === "insight") return "인사이트 탭으로 돌아가기"
  if (from === "cover_letter") return "자소서 탭으로 돌아가기"
  return null
}

export async function JdTab({ applicationProjectId: id, searchParams: sp }: { applicationProjectId: string; searchParams: SP }) {
  const state = getPreviewState(sp)
  const jd = await getJobDescription(id)
  if (!jd) return <p className="text-sm text-muted-foreground">공고를 찾을 수 없어요</p>

  // Q53-2 미리 보기는 저장소를 바꾸지 않는다
  const rawPreview = state === "raw-editable" || state === "raw-edit" || state === "raw-save-failed" || state === "raw-save-refused" || state === "raw-saved"
  const previewSave = state === "raw-save-failed" ? "failed" : state === "raw-save-refused" ? "refused" : rawPreview ? "ok" : null
  // R17: no requirement extraction — no "요건 정리하기" / 분석 중 / 추출 실패 상태. The tab shows the raw text.
  const editable = rawPreview ? state !== "raw-saved" && one(sp.refused) !== "1" : jd.raw_text_editable
  // Q53-9 "요건이 있는 공고": 입력 원인 실패로 왔는데 요건이 있으면 읽기 전용 + 안내 (R17: legacy JDs with requirement rows)
  const causeParam = one(sp.cause)
  const lockedCause: AiErrorCode | null =
    state === "raw-has-requirements"
      ? "input_too_long"
      : jd.requirements.length > 0 && isInputCausedJdFailure(causeParam as AiErrorCode)
        ? (causeParam as AiErrorCode)
        : null
  const back = !lockedCause ? returnLabel(one(sp.from)) : null

  return (
    <div className="space-y-6">
      {lockedCause ? <JdLockedNotice cause={lockedCause} /> : null}
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
        editable={editable}
        initialEditing={state === "raw-edit" || state === "raw-save-failed" || state === "raw-save-refused" || one(sp.edit) === "1"}
        initialSaved={state === "raw-saved"}
      >
        {/* R17: the legacy requirement / keyword / seniority columns are not shown (JD = raw text) */}
        <JdView
          applicationProjectId={id}
          previewSave={previewSave}
          rawText={jd.raw_text}
          sentences={jd.sentences}
          requirements={[]}
          techKeywords={[]}
          seniority={null}
          sourceUrl={jd.source_url ?? null}
        />
      </JdRawEditProvider>
    </div>
  )
}
