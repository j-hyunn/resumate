/**
 * Server-only helper for AI-starting actions: converts a refusal thrown before anything changed
 * into `{ rejected, refusal }` (isAiRejected). Two sources: the mock's validate-first MockAiError,
 * and real 409s — `AppError` from services, or `unwrap(actionResult)` — with a 04 §2.11.7 code.
 * Request-scoped paths ④⑤ answer `key_missing` / `key_invalid` with no refusal code (compat only).
 */
import { AppError, isAppError } from "@/lib/contracts/errors"
import { MockAiError } from "@/lib/mock/ai"
import type { AiGateRefusalCode } from "@/types/db"
import { refusalErrorCode, type AiRejected } from "./ai-errors"

const GATE_REFUSAL_CODES: readonly AiGateRefusalCode[] = [
  "ai_not_connected",
  "ai_consent_required",
  "key_invalid",
  "key_missing",
  "ai_connection_changed",
  "ai_job_not_retryable",
]

function isGateRefusal(err: AppError): boolean {
  return (GATE_REFUSAL_CODES as readonly string[]).includes(err.code)
}

export async function withAiGuard<T>(run: () => Promise<T>): Promise<T | AiRejected> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof MockAiError) return { rejected: e.error_code, refusal: e.refusal }
    if (isAppError(e) && isGateRefusal(e)) {
      const refusal = e.code as AiGateRefusalCode
      return { rejected: refusalErrorCode(refusal), refusal }
    }
    throw e
  }
}
