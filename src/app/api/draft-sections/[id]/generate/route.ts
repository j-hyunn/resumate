import { z } from "zod";
import { GenerateSectionInput, type DraftInsufficientDataResponse } from "@/lib/contracts/draft";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import { draftSseError, draftSseResponse } from "@/server/drafts-sse";
import { createDraftAiDeps } from "@/server/jobs/drafts";
import { readJsonBody } from "@/server/request-body";
import { prepareCoverLetterSection, runCoverLetterSection } from "@/server/services/drafts/cover-letter";
import { DRAFT_INSUFFICIENT_DATA_MESSAGE } from "@/server/services/drafts/ranking";

export const maxDuration = 60;

/**
 * `POST /api/draft-sections/{id}/generate` — AI-04 자기소개서 문항 생성 / 다시
 * 생성 (SSE; F-DOC-02/03/08/09). One question per request: "전체 생성" calls it
 * per question in order [가정 S7-1]. 다시 생성 replaces the AI text and clears
 * the edited text (the screen confirms first, D-DM-06).
 *
 * Before the stream (JSON): 400, 401, 404, 409 `section_in_progress` /
 * `jd_not_extracted` (R1 A13: extract first, no provider call) / `extraction_in_progress`,
 * 422 `insufficient_data` (+ readiness).
 * Stream: `generation_started` → `sources_selected` → paragraph
 * block events → (`adjusting_length`) → `validated` → `done` | `error`.
 * No key → one `error`. Closing the page does not stop the run.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/draft-sections/[id]/generate">) {
  try {
    const { id } = await ctx.params;
    if (!z.guid().safeParse(id).success) throw new AppError("not_found");
    if (!GenerateSectionInput.safeParse(await readJsonBody(request)).success) throw new AppError("invalid_input");

    const { supabase, user } = await requireConsentedUser();
    const deps = createDraftAiDeps(supabase, user.id);
    const prepared = await prepareCoverLetterSection(deps, id);
    if (prepared.kind === "insufficient_data") {
      const body: DraftInsufficientDataResponse = { error: { code: "insufficient_data", message: DRAFT_INSUFFICIENT_DATA_MESSAGE }, readiness: prepared.readiness };
      return Response.json(body, { status: 422 });
    }
    if (prepared.kind === "blocked") return draftSseError(prepared.code);
    return draftSseResponse((emit) => runCoverLetterSection(deps, prepared, emit));
  } catch (err) {
    return errorResponse(err);
  }
}
