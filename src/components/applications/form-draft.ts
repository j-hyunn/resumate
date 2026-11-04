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
