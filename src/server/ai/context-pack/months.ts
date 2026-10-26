/**
 * Year-month helpers for the pack. DB stores months as 'YYYY-MM-01' (DM-4);
 * the pack shows 'YYYY-MM' (C-1).
 */

export type YearMonth = { year: number; month: number };

export function parseMonth(value: string | null | undefined): YearMonth | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function formatMonth(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, "0")}`;
}

function index(ym: YearMonth): number {
  return ym.year * 12 + (ym.month - 1);
}

/** Inclusive month count: 2021-03 … 2021-03 = 1. Null when end < start. */
export function monthsInclusive(start: YearMonth, end: YearMonth): number | null {
  const n = index(end) - index(start) + 1;
  return n >= 1 ? n : null;
}

/** "3년 2개월" / "8개월" / "2년". */
export function formatDuration(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest}개월`;
  if (rest === 0) return `${years}년`;
  return `${years}년 ${rest}개월`;
}

/** Current month in Asia/Seoul (C-1 durations of ongoing roles). */
export function currentMonthInSeoul(now: Date = new Date()): YearMonth {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return { year, month };
}

/** Total months covered by intervals, overlaps counted once. */
export function mergedMonths(intervals: ReadonlyArray<{ start: YearMonth; end: YearMonth }>): number {
  const sorted = intervals
    .map((i) => [index(i.start), index(i.end)] as const)
    .filter(([s, e]) => e >= s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -2;
  for (const [s, e] of sorted) {
    if (s > curEnd + 1) {
      if (curEnd >= curStart && curStart >= 0) total += curEnd - curStart + 1;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  if (curStart >= 0) total += curEnd - curStart + 1;
  return total;
}
