/**
 * S-14 입력 보존 (UX S-14 "입력 보존", QA 17 B-6). Pure, so the rule can be tested alone.
 *
 * The form is kept in the browser session **only** when the user leaves for the key swap / AI 연결
 * (C-20 키 교체, C-18 → S-41: `markAiConnectReturn` points back at this screen). Leaving any other
 * way (취소, 사이드바, 다른 화면) drops it, so a later visit starts empty. Returning (restore) or a
 * successful 만들기 clears it.
 */
export function keepsFormDraftOnLeave(returnHref: string | null | undefined, pathname: string): boolean {
  if (!returnHref) return false
  const path = returnHref.split(/[?#]/, 1)[0]
  return path === pathname
}

/**
 * S-14 ① [다음]의 미리 보기 추출이 **서버에서 거부됐을 때** 무엇을 할지 (UQ-751 · UX S-14 Q53-1 표 ·
 * R15: 409 `key_invalid`·`ai_consent_required`, 그 밖은 C-20). 화면 판정과 서버 판정이 어긋난 경우다
 * (다른 탭에서 키를 지우거나 바꿈 등).
 * - `key_invalid` → ①에 머물고 버튼 아래 C-20 `key_invalid`
 * - `ai_consent_required` → C-21 동의 창, 동의 뒤 그 [다음]을 이어 보낸다
 * - 키 없음(`ai_not_connected`·`key_missing`) → 막지 않고 **AI-01 없이 ②로**(키 없는 경로와 같다, 안내 없음)
 * - 그 밖 → 막지 않고 ②로, ② 머리에 C-20 축약
 */
export type PreviewRefusalAction = "stay_key_invalid" | "consent" | "step2_keyless" | "step2_with_notice"

export function previewRefusalAction(refusal: string | null | undefined): PreviewRefusalAction {
  if (refusal === "key_invalid") return "stay_key_invalid"
  if (refusal === "ai_consent_required") return "consent"
  if (refusal === "ai_not_connected" || refusal === "key_missing") return "step2_keyless"
  return "step2_with_notice"
}
