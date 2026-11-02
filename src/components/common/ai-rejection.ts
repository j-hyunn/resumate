"use client"

/**
 * Client handling of a server refusal (`{ rejected, refusal }`, lib/data/ai-errors isAiRejected):
 * the server changed nothing. Shows the C-20 title as a toast and refetches the AI connection so
 * run buttons turn into C-18 / the invalid badge / the consent-required badge. Screens that render
 * C-20 in place can instead keep `rejected.rejected` in state and pass it to <AiErrorNotice code=… />
 * (key_missing re-reads the connection and shows the consent cause when consent is needed), or
 * return the result from AiRunButton `onRun` so the button handles it (v5.3).
 */
import { toast } from "sonner"
import { isAiRejected, type AiRejected } from "@/lib/data/ai-errors"
import { notifyAiConnectionChanged } from "./ai-connection-context"
import { aiErrorTitle, RETRY_REFUSAL_COPY } from "./ai-error-notice"

export { isAiRejected }

/** Toast text of a refusal (02 C-20 / 2.11.7 codes) */
export function aiRejectedMessage(r: AiRejected): string {
  switch (r.refusal) {
    case "ai_not_connected":
    case "key_missing":
      return "AI 연결하면 사용할 수 있어요"
    case "ai_consent_required":
      // [UI-가정] stale readiness: the next click opens C-21 (the badge turns into 동의 필요형)
      return "AI 사용 동의가 필요해요. 다시 눌러 동의해 주세요"
    case "ai_connection_changed":
    case "ai_job_not_retryable":
      return RETRY_REFUSAL_COPY[r.refusal] ?? aiErrorTitle(r.rejected)
    default:
      return r.rejected === "key_missing" ? "AI 연결하면 사용할 수 있어요" : aiErrorTitle(r.rejected)
  }
}

export function notifyAiRejected(r: AiRejected): void {
  toast.error(aiRejectedMessage(r))
  notifyAiConnectionChanged()
}
