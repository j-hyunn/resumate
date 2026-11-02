/**
 * Career form autosave: what a save action answers and how the form reads a conflict (W2-①②③).
 * Client- and server-safe. A thrown error loses its code on the way through a Server Action in production,
 * so the outcomes a form has to tell apart come back as values (`guardRowSave`).
 */

export type RowSaveResult<R> =
  | { ok: true; row: R }
  /** `latest`: the row as it is now (another tab or device saved first) */
  | { ok: false; reason: "conflict"; latest: R }
  /** the row, or the parent it points at, no longer exists */
  | { ok: false; reason: "gone" }
  /** the server refused the values; trying again won't help */
  | { ok: false; reason: "invalid" }

/** Ignores what the contract normalizes: surrounding spaces, 'YYYY-MM' vs 'YYYY-MM-01'. */
export function fingerprint(values: unknown): string {
  return JSON.stringify(values, (_key, value: unknown) =>
    typeof value === "string" ? value.trim().replace(/^(\d{4}-\d{2})-01$/, "$1") : value,
  )
}

export type ConflictDecision =
  /** The row already holds what was sent: the response of an earlier try was lost. Not a conflict. */
  | "already_saved"
  /** Nothing the form shows changed (a child's save bumps the parent's `updated_at`). Send again on the new version. */
  | "rebase"
  /** Someone else changed what the form shows: the user decides. */
  | "conflict"

export function decideConflict<T, R>(input: {
  base: R | null
  latest: R
  sent: T
  comparable?: (row: R) => unknown
  /**
   * The form's values as a save of them would leave the row on top of `latest` (UQ-702): a cleared end month while
   * "재직 중" is on, a reversed period that stays out of the patch. Default: the values as they are.
   */
  stored?: (values: T, latest: R) => unknown
  /**
   * First save only (`base` null): the values of earlier tries with the same `client_id` whose responses were lost.
   * Only this form knows that id, so a row holding one of them is our own write (QA-W5-06).
   */
  earlierTries?: readonly T[]
}): ConflictDecision {
  const { base, latest, sent, comparable, stored, earlierTries } = input
  if (!comparable) return "conflict"
  const now = fingerprint(comparable(latest))
  const asStored = (values: T) => fingerprint(stored ? stored(values, latest) : values)
  if (now === asStored(sent)) return "already_saved"
  if (base !== null) return now === fingerprint(comparable(base)) ? "rebase" : "conflict"
  return earlierTries?.some((t) => asStored(t) === now) ? "rebase" : "conflict"
}

function monthKey(month: string | null | undefined): string | null {
  return month ? month.slice(0, 7) : null
}

/** W2-③: the contract and the DB CHECK refuse an end month before the start month. */
export function isPeriodReversed(start: string | null | undefined, end: string | null | undefined): boolean {
  const s = monthKey(start)
  const e = monthKey(end)
  return s !== null && e !== null && e < s
}

/**
 * The period part of a save patch. A reversed period stays out of the patch: the other fields keep saving (UX-7)
 * and the stored period stays as it was until the form's inline error is fixed. Keys are left out, not undefined,
 * because the mock assigns the patch as it is.
 */
export function periodPatch(start: string | null, end: string | null): { start_month?: string | null; end_month?: string | null } {
  return isPeriodReversed(start, end) ? {} : { start_month: start, end_month: end }
}

/**
 * The period a save leaves on `latest` (for `decideConflict`'s `stored`): `end` already cleared by the form's
 * "재직 중" / "재학 중"; a reversed period isn't sent (`periodPatch`), so the stored one stays.
 */
export function storedPeriod(
  start: string | null,
  end: string | null,
  latest: { start_month: string | null; end_month: string | null },
): { start_month: string | null; end_month: string | null } {
  return isPeriodReversed(start, end) ? { start_month: latest.start_month, end_month: latest.end_month } : { start_month: start, end_month: end }
}

/** The new row's id, generated once by the form and sent with every try of the first save (contract: client-generated id). */
export function newRowId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  // `randomUUID` exists only in secure contexts (e.g. not over plain http on a LAN address)
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
