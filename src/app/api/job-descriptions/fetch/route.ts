import { FetchJobDescriptionInput, jdFetchError } from "@/lib/contracts/jd-fetch";
import { errorResponse } from "@/lib/contracts/errors";
import { requireConsentedUser } from "@/server/auth/session";
import { logJobEvent } from "@/server/jobs/log";
import { fetchJobDescription } from "@/server/services/job-description/fetch";

/** The fetch itself is capped at 10 s (plan 1-C A1); the rest is parsing room. */
export const maxDuration = 60;

/**
 * `POST /api/job-descriptions/fetch` — 공고 URL 가져오기 (CF-10, R15 A1).
 *
 * Request `{ url }` → 200 `{ data: { rawText, companyName, positionTitle } }`.
 * **No AI** (CF-A15: works without a provider key) and **no DB write** — no
 * `ai_jobs`, no `ai_usage_records`, no usage meter (CF-A16).
 *
 * 400 `invalid_source_url` / `fetch_blocked`, 413 `fetch_too_large`,
 * 422 `fetch_too_short`, 429 `too_many_requests`, 502 `fetch_failed`,
 * 504 `fetch_timeout`, 401 unauthenticated.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requireConsentedUser();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw jdFetchError("invalid_source_url");
    }
    const parsed = FetchJobDescriptionInput.safeParse(body);
    if (!parsed.success) throw jdFetchError("invalid_source_url");
    const data = await fetchJobDescription({ url: parsed.data.url, userId: user.id }, { log: logJobEvent });
    return Response.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
