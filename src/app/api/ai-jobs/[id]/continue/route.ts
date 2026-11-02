import { after } from "next/server";
import { AiJobIdSchema } from "@/lib/contracts/ai";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { getSiteOrigin } from "@/server/auth/site-url";
import { getServerEnv } from "@/server/env";
import { createAppJobRunner } from "@/server/jobs/app-runner";
import { verifyContinueToken } from "@/server/jobs/continue-token";

/** One continuation = one fresh invocation with its own 60 s budget (C-6). */
export const maxDuration = 60;

/**
 * `POST /api/ai-jobs/{id}/continue` — internal self-invoke of the runner for a
 * yielded job. No user cookie: authorized by the HMAC continue token.
 * Answers 202 at once and runs the job in after().
 */
export async function POST(request: Request, ctx: RouteContext<"/api/ai-jobs/[id]/continue">) {
  try {
    const { id } = await ctx.params;
    if (!AiJobIdSchema.safeParse(id).success) throw new AppError("not_found");
    const auth = request.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    const ref = verifyContinueToken(token, id, getServerEnv().SUPABASE_JWT_SECRET);
    if (!ref) throw new AppError("unauthenticated");
    const runner = createAppJobRunner(await getSiteOrigin());
    after(async () => {
      await runner.runJob(ref);
    });
    return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
