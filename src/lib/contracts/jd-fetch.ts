import { z } from "zod";
import { AppError } from "./errors";

/**
 * R15 A1 — `POST /api/job-descriptions/fetch` (CF-10, DM 11.10 (7), PRD F-AP-01).
 *
 * The server fetches a job posting page and returns its text so S-14 단계 1 can
 * fill 공고 원문 without the user copying it. **No AI is involved** (CF-A15), so
 * it works with no provider key, and **nothing is written** — no `ai_jobs`, no
 * `ai_usage_records`, no usage meter (CF-A16).
 */

/** DM 11.10 #1: `job_descriptions_source_url_check` — `^https?://` and ≤ 2,048 chars. */
export const JD_SOURCE_URL_MAX = 2048;
/** DM A.6: `raw_text` 1~50,000 — the fetched text is truncated to fit the create RPC. */
export const JD_FETCH_RAW_TEXT_MAX = 50_000;
/** Plan 1-C A1: under this many extracted characters the page is not usable as 공고 원문. */
export const JD_FETCH_MIN_CHARS = 200;
/** Plan 1-C A1: response body cap; reading stops here. */
export const JD_FETCH_MAX_BYTES = 2 * 1024 * 1024;
/** Plan 1-C A1: whole-request budget across every redirect hop. */
export const JD_FETCH_TIMEOUT_MS = 10_000;
/** Plan 1-C A1: at most 3 redirects, each re-checked by the SSRF guard. */
export const JD_FETCH_MAX_REDIRECTS = 3;

/**
 * [가정: 수치] DM 2.9.4 "서버 남용 방지 요청 제한 — DB 밖(앱·엣지 미들웨어),
 * 사용자에게 '한도'로 노출하지 않음". In-process sliding window per user.
 */
export const JD_FETCH_RATE_LIMIT = { max: 10, windowMs: 60_000 } as const;

/** Failure codes of this endpoint only (plan 1-C A1 `[가정]`). */
export const JD_FETCH_ERROR_CODES = [
  "invalid_source_url",
  "fetch_blocked",
  "fetch_timeout",
  "fetch_too_large",
  "fetch_too_short",
  "fetch_failed",
] as const;
export type JdFetchErrorCode = (typeof JD_FETCH_ERROR_CODES)[number];

/** `[가정]` code → HTTP status + Korean user-facing message. */
const JD_FETCH_ERRORS: Record<JdFetchErrorCode, { status: number; message: string }> = {
  invalid_source_url: { status: 400, message: "공고 주소를 확인해 주세요. http 또는 https로 시작하는 주소만 가져올 수 있어요." },
  fetch_blocked: { status: 400, message: "가져올 수 없는 주소예요. 채용 공고 페이지 주소를 다시 확인해 주세요." },
  fetch_timeout: { status: 504, message: "공고를 가져오는 데 너무 오래 걸렸어요. 공고 내용을 직접 붙여 넣어 주세요." },
  fetch_too_large: { status: 413, message: "공고 페이지가 너무 커서 가져오지 못했어요. 공고 내용을 직접 붙여 넣어 주세요." },
  fetch_too_short: { status: 422, message: "이 주소에서 공고 내용을 찾지 못했어요. 공고 내용을 직접 붙여 넣어 주세요." },
  fetch_failed: { status: 502, message: "공고를 가져오지 못했어요. 공고 내용을 직접 붙여 넣어 주세요." },
};

/** Builds the `AppError` for a fetch failure (one place for the status / copy). */
export function jdFetchError(code: JdFetchErrorCode): AppError {
  const { status, message } = JD_FETCH_ERRORS[code];
  return new AppError(code, message, { status });
}

/** `[가정]` Abuse limiter refusal — not a product limit, so it is not one of the codes above. */
export function jdFetchTooManyRequests(): AppError {
  return new AppError("too_many_requests", "요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.", { status: 429 });
}

export const FetchJobDescriptionInput = z.object({
  url: z.string().trim().min(1).max(JD_SOURCE_URL_MAX),
});
export type FetchJobDescriptionInput = z.infer<typeof FetchJobDescriptionInput>;

/** 200 body: `{ data: FetchJobDescriptionResult }`. `null` = not found on the page. */
export type FetchJobDescriptionResult = {
  rawText: string;
  companyName: string | null;
  positionTitle: string | null;
};
