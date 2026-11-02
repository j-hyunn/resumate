/**
 * Dev-only preview request marker (W1 wiring). `src/server/auth/proxy-session.ts` sets these request
 * headers; the data layer (`src/lib/data/source.ts`) and the consent gate read them.
 * Production never sets or honors the preview header (`isPreviewEnabled` is false there).
 */
export const PREVIEW_REQUEST_HEADER = "x-resumate-preview";
/** pathname + search of the page request, for `?next=` (a layout can't read its own URL). */
export const REQUEST_PATH_HEADER = "x-resumate-path";

export function isDevPath(pathname: string): boolean {
  return pathname === "/dev" || pathname.startsWith("/dev/");
}

/**
 * A preview request runs entirely on the mock store: `?state=` on any URL (a Server Action POSTs to
 * the page URL, so its actions count too) and the `/dev/` gallery.
 */
export function isPreviewUrl(pathname: string, search: URLSearchParams): boolean {
  return search.has("state") || isDevPath(pathname);
}
