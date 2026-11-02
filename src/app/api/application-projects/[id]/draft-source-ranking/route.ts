import { z } from "zod";
import { DraftSourceRankingInput, type DraftInsufficientDataResponse } from "@/lib/contracts/draft";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import { createDraftAiDeps } from "@/server/jobs/drafts";
import { DRAFT_INSUFFICIENT_DATA_MESSAGE, rankDraftSourcesForProject } from "@/server/services/drafts/ranking";
import { readJsonBody } from "@/server/request-body";

/** AI-11 (≤ 25 s); no extraction inside this request (R1 A13). */
export const maxDuration = 60;

/**
 * `POST /api/application-projects/{id}/draft-source-ranking` — 경력기술서 기본
 * 선택 (AI-11, C-6 동기; F-DOC-01). Body `{ refresh?: boolean }` (empty = `{}`).
 *
 * 200 `{ data: DraftSourceRankingResponse }` — `selectionOrigin` insight /
 * ai_ranking, or on any AI-11 failure (key missing, provider, schema, JD not
 * extracted or being extracted) `failed: true` with empty lists and
 * `selectionOrigin: 'user'` (R1 A23: no substitute selection, never an error
 * screen). 422 `{ error: insufficient_data, readiness }` (F-AP-06; no AI), 404, 401, 400.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/application-projects/[id]/draft-source-ranking">) {
  try {
    const { id } = await ctx.params;
    if (!z.guid().safeParse(id).success) throw new AppError("not_found");
    const parsed = DraftSourceRankingInput.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new AppError("invalid_input");

    const { supabase, user } = await requireConsentedUser();
    const outcome = await rankDraftSourcesForProject(createDraftAiDeps(supabase, user.id), id, { refresh: parsed.data.refresh });
    if (outcome.kind === "insufficient_data") {
      const body: DraftInsufficientDataResponse = { error: { code: "insufficient_data", message: DRAFT_INSUFFICIENT_DATA_MESSAGE }, readiness: outcome.readiness };
      return Response.json(body, { status: 422 });
    }
    return Response.json({ data: outcome.data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
