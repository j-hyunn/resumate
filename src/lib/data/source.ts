import "server-only"
/**
 * The wiring pattern of every data function (`_workspace/backend/W1/02_api_notes.md`):
 *
 *   export async function getThing(id: string): Promise<Thing> {
 *     return previewOr(
 *       async () => { const db = await mockRequest(); return clone(db.things.find(...)) }, // the old mock body
 *       async () => toThing(unwrap(await serverAction({ id }))),                           // real: action + camelCase → snake_case
 *     )
 *   }
 *
 * Previews never touch real rows: a `?state=` / `/dev/` request takes the first branch for reads and
 * writes. Server Actions in src/server/actions already do auth → validate → service; call those.
 * mock-isolation.test.ts fails if a store call escapes this.
 */
import { headers } from "next/headers"
import { AppError, type ActionResult } from "@/lib/contracts/errors"
import { PREVIEW_REQUEST_HEADER } from "@/lib/contracts/preview"
import { isPreviewEnabled } from "@/lib/preview-state"
import { isTrustedPreviewMarker } from "@/server/auth/preview-marker"

/**
 * Always false in a production build: `isPreviewEnabled` comes first, so the header isn't even read.
 * In development the header must carry the proxy's per-process secret (QA-W5-03): a client-sent
 * value is never trusted, also on paths the proxy matcher skips.
 */
export async function isPreviewRequest(): Promise<boolean> {
  if (!isPreviewEnabled) return false
  return isTrustedPreviewMarker((await headers()).get(PREVIEW_REQUEST_HEADER))
}

export async function previewOr<T>(preview: () => Promise<T>, real: () => Promise<T>): Promise<T> {
  return (await isPreviewRequest()) ? preview() : real()
}

/** ActionResult → value; an error result goes back to a thrown AppError (code, Korean message, details kept). */
export function unwrap<T>(result: ActionResult<T>): T {
  if ("error" in result) {
    throw new AppError(result.error.code, result.error.message, result.error.details ? { details: result.error.details } : undefined)
  }
  return result.data
}

/**
 * For mock functions returning `{ refused: code }` (spec-gaps ⑰): listed 409 codes become the screen's
 * refusal value (`map` renames or adds fields), anything else throws like `unwrap`.
 *
 *   const r = refusalOf(await actions.update(input), JD_RAW_TEXT_REFUSAL_CODES)
 *   if ("refused" in r) return r
 */
export function refusalOf<T, C extends string>(result: ActionResult<T>, codes: readonly C[]): { data: T } | { refused: C; details: Record<string, unknown> | null } {
  if ("error" in result && (codes as readonly string[]).includes(result.error.code)) {
    return { refused: result.error.code as C, details: result.error.details ?? null }
  }
  return { data: unwrap(result) }
}
