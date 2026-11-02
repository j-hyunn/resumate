/** Time helpers for fixtures. Dates are relative to "now" so D-day and "N일 뒤 자동 삭제" stay meaningful. */

export function nowIso(): string {
  return new Date().toISOString()
}

export function daysAgo(days: number, hours = 0): string {
  return new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString()
}

export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

/** 'YYYY-MM-DD' n days from today (negative = past) */
export function dateFromToday(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000)
  return d.toISOString().slice(0, 10)
}

/** month column value ('YYYY-MM-01') */
export function month(year: number, m: number): string {
  return `${year}-${String(m).padStart(2, "0")}-01`
}

/** KST month (day 1) for usage_events.period_month */
export function currentPeriodMonth(): string {
  const kst = new Date(Date.now() + 9 * 3_600_000)
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-01`
}
