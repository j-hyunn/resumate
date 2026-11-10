import { ExtractJdPreviewInput } from "@/lib/contracts/application";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import { createJdPreviewDeps } from "@/server/jobs/jd-preview";
import { extractJdPreview } from "@/server/services/application/preview";

/** QA-W5-05: same ceiling as the other AI routes (the call itself is capped at 30 s). */
export const maxDuration = 60;

/**
 * `POST /api/job-descriptions/extract-preview` — A2 요건 미리 보기 (R15, CF-A17 ★,
 * DM 2.6.2 / 11.10 #5a). Synchronous AI-01 on a 공고 원문 that has no row yet, so
 * S-14 단계 2 can show the company, the position, the deadline and the requirement
 * count before the 자기소개서 is created.
 *
 * 200 `{ data: { previewJobId, companyName, positionTitle, deadline, requirementCount } }` —
 * the requirement text stays in `ai_jobs.output` on the server and
 * `create_application_project` reads it there via `p_preview_job_id` (CF-A17: the screen can
 * never submit requirements as `origin = 'ai'`).
 *
 * 409 `key_invalid` / `ai_consent_required` / `key_missing` (Q53-1 gate — **no job row is
 * created**), 422 `not_a_jd`, 502 for other C-11 failures, 400 `invalid_input`, 401.
 * Not retryable: the screen calls [다음] again, or creates the 자기소개서 without a preview and
 * runs the ordinary "요건 정리하기" (D-30).
 */
export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("invalid_input");
    }
    const parsed = ExtractJdPreviewInput.safeParse(body);
    if (!parsed.success) throw new AppError("invalid_input");
    const { user } = await requireConsentedUser();
    const data = await extractJdPreview(createJdPreviewDeps(user.id), parsed.data.rawText, { signal: request.signal });
    return Response.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
