/**
 * 로그아웃·탈퇴 때 브라우저에 남은 사용자별 미저장 입력을 지운다 (U40-1, 2026-11-05, QA P-40-1).
 * Called before the redirect to S-01 (or the 탈퇴 마무리 page). Every storage access is wrapped: a
 * blocked / private-mode storage must never stop the sign-out.
 *
 * Cleared:
 * - localStorage `resumate:l02:*` — L-02 입력 보존 (S-10 프로젝트 · S-44 산출물 원문)
 * - sessionStorage `resumate.a3.new-application.*` — S-14 새 자기소개서 입력 (JD 원문 등)
 * - sessionStorage return targets (`resumate.return-target`, `resumate.nav-origin`, `resumate.ai-*`) — the
 *   user's row ids and in-progress choices
 * Kept: per-browser display preferences (theme, AI panel open/width, outage notice dismissal).
 */

const LOCAL_PREFIXES = ["resumate:l02:"]
const SESSION_PREFIXES = ["resumate.a3.new-application.", "resumate.ai-"]
const SESSION_KEYS = ["resumate.return-target", "resumate.nav-origin"]

interface KeyedStorage {
  readonly length: number
  key(index: number): string | null
  removeItem(key: string): void
}

function clearFrom(get: () => KeyedStorage | null | undefined, prefixes: string[], keys: string[] = []): void {
  try {
    const s = get()
    if (!s) return
    const doomed: string[] = []
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k && (keys.includes(k) || prefixes.some((p) => k.startsWith(p)))) doomed.push(k)
    }
    for (const k of doomed) {
      try {
        s.removeItem(k)
      } catch {
        // keep going with the rest
      }
    }
  } catch {
    // storage unavailable (private mode, blocked): nothing to clear
  }
}

export function clearUserUnsavedInput(
  storages: { local?: () => KeyedStorage | null; session?: () => KeyedStorage | null } = {
    local: () => (typeof window === "undefined" ? null : window.localStorage),
    session: () => (typeof window === "undefined" ? null : window.sessionStorage),
  },
): void {
  if (storages.local) clearFrom(storages.local, LOCAL_PREFIXES)
  if (storages.session) clearFrom(storages.session, SESSION_PREFIXES, SESSION_KEYS)
}
