import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * QA-W5-03: the dev-only preview header (`x-resumate-preview`) is trusted only
 * when it carries this process's secret, which only `src/proxy.ts` writes. A
 * client-sent value — "1" or anything else — never matches, including on the
 * paths the proxy matcher skips (`*.png` etc.), where nothing strips it.
 *
 * Node.js proxy runs in-process with the renderer (next-server.js "Node.js
 * middleware runs in-process"), so one `globalThis` slot is shared across the
 * proxy bundle and the app bundle. The secret is random per process and never
 * leaves the request headers the proxy forwards inward.
 *
 * No `server-only` import: the proxy bundle doesn't run with the react-server condition.
 */
const SLOT = Symbol.for("resumate.previewMarker.v1");

type Slot = { [SLOT]?: string };

function processSecret(): string {
  const g = globalThis as Slot;
  g[SLOT] ??= randomBytes(32).toString("base64url");
  return g[SLOT];
}

/** The value the proxy sets on a preview request. */
export function previewMarkerValue(): string {
  return processSecret();
}

/** True only for the value the proxy set in this process. */
export function isTrustedPreviewMarker(value: string | null | undefined): boolean {
  if (!value) return false;
  const expected = Buffer.from(processSecret());
  const got = Buffer.from(value);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
