"use client"

import { THEME_SCRIPT } from "./theme"

/**
 * Runs THEME_SCRIPT from the server HTML before first paint. When React creates this element on
 * the client (e.g. the root layout re-mounts) the script would never run anyway, so it renders as
 * a data block there — React warns about executable <script> tags created on the client.
 */
export function ThemeScript() {
  return (
    <script
      suppressHydrationWarning
      type={typeof window === "undefined" ? undefined : "text/plain"}
      dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
    />
  )
}
