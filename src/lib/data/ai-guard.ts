/**
 * Server-only helper for AI-starting actions: converts the mock's validate-first rejection
 * (MockAiError thrown by assertAiRunnable before any mutation) into `{ rejected: error_code }`.
 */
import { MockAiError } from "@/lib/mock/ai"
import type { AiRejected } from "./ai-errors"

export async function withAiGuard<T>(run: () => Promise<T>): Promise<T | AiRejected> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof MockAiError) return { rejected: e.error_code, refusal: e.refusal }
    throw e
  }
}
