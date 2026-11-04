/**
 * profiles.last_active_at upkeep (privacy policy 2026-11-04 §4: 1 year without access → deletion; a sign-in keeps
 * the account). The proxy calls `touch_last_active` for a signed-in request at most once per
 * LAST_ACTIVE_COOKIE_MAX_AGE per browser and user: a small cookie holding the user id marks a recent touch.
 * The RPC itself also skips writes within an hour, and clears a pending inactivity notice.
 * A failure never blocks the page: no cookie is set, so the next request tries again.
 */

export const LAST_ACTIVE_COOKIE = "rm_last_active";
/** 6 hours: a daily cron only needs day precision. */
export const LAST_ACTIVE_COOKIE_MAX_AGE = 6 * 60 * 60;

type CookieReader = { get(name: string): { value: string } | undefined };
type CookieWriter = {
  set(name: string, value: string, options: { httpOnly: boolean; sameSite: "lax"; secure: boolean; path: string; maxAge: number }): unknown;
};
type TouchRpc = { rpc(fn: "touch_last_active"): PromiseLike<{ error: unknown }> };

export async function touchLastActiveIfDue(
  supabase: TouchRpc,
  userId: string,
  requestCookies: CookieReader,
  responseCookies: () => CookieWriter,
  secure: boolean,
): Promise<"skipped" | "touched" | "failed"> {
  if (requestCookies.get(LAST_ACTIVE_COOKIE)?.value === userId) return "skipped";
  try {
    const { error } = await supabase.rpc("touch_last_active");
    if (error) return "failed";
  } catch {
    return "failed";
  }
  responseCookies().set(LAST_ACTIVE_COOKIE, userId, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: LAST_ACTIVE_COOKIE_MAX_AGE });
  return "touched";
}
