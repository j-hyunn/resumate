import { z } from "zod";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import { createJdExtractionDeps } from "@/server/jobs/jd-extraction";
import { runJdExtraction } from "@/server/services/application/extraction-response";

/** The sync call itself is capped at 30 s (C-6 [가정]); the rest is room for DB writes and usage settle. */
export const maxDuration = 60;

/**
 * `POST /api/application-projects/{id}/jd-extraction` — AI-01 JD requirement
 * extraction, synchronous (C-6 동기, F-AP-01, D-30 "요건 정리하기", retry of a
 * failed extraction). Called right after creation when `shouldExtract`.
 *
 * 200 `{ data: { status: 'succeeded', jobId, jd } }` or
 * 200 `{ data: { status: 'failed', jobId, error, jd } }` (C-11 failure, C-20).
 * 404 not_found, 409 already_extracted / extraction_in_progress, 401.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/application-projects/[id]/jd-extraction">) {
  try {
    const { id } = await ctx.params;
    if (!z.guid().safeParse(id).success) throw new AppError("not_found");
    const { supabase, user } = await requireConsentedUser();
    const data = await runJdExtraction(supabase, createJdExtractionDeps(supabase, user.id), id);
    return Response.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
