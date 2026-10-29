import { z } from "zod";
import { CreateCareerDescriptionInput, type DraftInsufficientDataResponse } from "@/lib/contracts/draft";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import { draftSseError, draftSseResponse } from "@/server/drafts-sse";
import { createDraftAiDeps } from "@/server/jobs/drafts";
import { readJsonBody } from "@/server/request-body";
import { prepareCareerDescription, runCareerDescription } from "@/server/services/drafts/career-description";
import { DRAFT_INSUFFICIENT_DATA_MESSAGE } from "@/server/services/drafts/ranking";

export const maxDuration = 60;

/**
 * `POST /api/application-projects/{id}/career-descriptions` — AI-03 경력기술서
 * 생성 (SSE, C-6 스트리밍; F-DOC-01/03). Body `CreateCareerDescriptionInput`
 * (`regeneratedFromId` = "다시 생성": a new draft, the old one stays).
 *
 * Before the stream (JSON): 400, 401, 404 (incl. an unknown `regeneratedFromId`), 409 `extraction_in_progress`
 * / `career_description_in_progress` (`error.details.jobId` = the running job, D-34 one per project),
 * 422 `insufficient_data` (+ readiness) / `empty_selection`.
 * Stream: (`preparing` → D-30 extraction) → `generation_started` →
 * `block_started` / `block_delta` / `block_completed`(+ evidence) → `validated`
 * → `done { draftId }` | `error`. An identical ready draft (C-6 재사용) answers
 * `done { reused: true }` right away. No key → one `error` (key_missing / key_invalid).
 * Closing the page does not stop the run; stop = `POST /api/ai-jobs/{jobId}/cancel`.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/application-projects/[id]/career-descriptions">) {
  try {
    const { id } = await ctx.params;
    if (!z.guid().safeParse(id).success) throw new AppError("not_found");
    const parsed = CreateCareerDescriptionInput.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_input");

    const { supabase, user } = await requireConsentedUser();
    const deps = createDraftAiDeps(supabase, user.id);
    const prepared = await prepareCareerDescription(deps, id, parsed.data);
    if (prepared.kind === "insufficient_data") {
      const body: DraftInsufficientDataResponse = { error: { code: "insufficient_data", message: DRAFT_INSUFFICIENT_DATA_MESSAGE }, readiness: prepared.readiness };
      return Response.json(body, { status: 422 });
    }
    if (prepared.kind === "blocked") return draftSseError(prepared.code);
    return draftSseResponse((emit) => runCareerDescription(deps, prepared, emit));
  } catch (err) {
    return errorResponse(err);
  }
}
