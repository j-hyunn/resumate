import { z } from "zod";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { StartInsightInput, type InsufficientDataResponse } from "@/lib/contracts/insight";
import { getSiteOrigin } from "@/server/auth/site-url";
import { requireConsentedUser } from "@/server/auth/session";
import { createAppJobRunner } from "@/server/jobs/app-runner";
import { connections } from "@/server/jobs/connections";
import { productionInsightPipeline } from "@/server/jobs/insight";
import { INSUFFICIENT_DATA_MESSAGE, startInsight } from "@/server/services/insight/start";

/** The job's first step may run in this request's after() (prepare → extraction ≤ 30 s, C-6). */
export const maxDuration = 60;

/**
 * `POST /api/application-projects/{id}/insights` — AI-02 insight, async job
 * (C-6 비동기, D-18 user-triggered only, F-P2-04/05/07, D-30).
 * Body `{ regenerate?: boolean }` ("다시 생성" skips input_hash reuse).
 *
 * 200 `{ data: StartInsightResponse }` — `{ reused: true, insightId }` (no job,
 * no tokens) or `{ reused: false, jobId, inProgress }` → poll
 * `GET /api/ai-jobs/{jobId}` (`partial` = stage-1 verdicts), cancel / retry via
 * the existing `/api/ai-jobs/{jobId}/cancel|retry`.
 * 422 `{ error: insufficient_data, readiness }` (C-10), 409 `ai_not_connected` /
 * `key_invalid` / `ai_consent_required` (C-18 / C-20), 404, 401, 400.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/application-projects/[id]/insights">) {
  try {
    const { id } = await ctx.params;
    if (!z.guid().safeParse(id).success) throw new AppError("not_found");
    const text = await request.text();
    let body: unknown = {};
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new AppError("invalid_input");
      }
    }
    const parsed = StartInsightInput.safeParse(body);
    if (!parsed.success) throw new AppError("invalid_input");

    const { supabase, user } = await requireConsentedUser();
    const outcome = await startInsight(
      {
        userId: user.id,
        user: supabase,
        providerContext: connections().context,
        runner: createAppJobRunner(await getSiteOrigin()),
        pipeline: productionInsightPipeline,
      },
      id,
      { regenerate: parsed.data.regenerate },
    );
    if (outcome.kind === "insufficient_data") {
      const body: InsufficientDataResponse = { error: { code: "insufficient_data", message: INSUFFICIENT_DATA_MESSAGE }, readiness: outcome.readiness };
      return Response.json(body, { status: 422 });
    }
    return Response.json({ data: outcome.data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
