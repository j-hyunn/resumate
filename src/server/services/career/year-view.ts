import type { CareerListItem, CareerListYear } from "@/lib/contracts/career";

/**
 * DM §2.4 v4.4 / UX S-08 career list (CR-4, D-22 개정). Not stored; computed on every read.
 *
 * - Items = experiences, educations, standalone projects. Each one appears ONCE, under the year of
 *   its own `start_month` (no repetition across active years; affiliated projects are not list rows).
 * - Latest year first. Inside a year: start_month desc, then created_at desc [가정], kinds mixed.
 * - No start_month → the "연도 미정" bucket (`year: null`), always last.
 */

/** The calendar year in Asia/Seoul (the service's users are in Korea). */
export function currentYearInSeoul(now: Date): number {
  const year = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric" }).format(now);
  return Number(year);
}

function yearOf(month: string | null): number | null {
  if (!month) return null;
  const y = Number(month.slice(0, 4));
  return Number.isInteger(y) ? y : null;
}

/** Descending by month string; nulls last. `'YYYY-MM'` strings compare lexicographically. */
function compareMonthDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

export function compareListItems(a: CareerListItem, b: CareerListItem): number {
  return compareMonthDesc(a.startMonth, b.startMonth) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}

export function groupCareerByYear(items: readonly CareerListItem[]): CareerListYear[] {
  const buckets = new Map<number | null, CareerListItem[]>();
  for (const item of items) {
    const year = yearOf(item.startMonth);
    const list = buckets.get(year) ?? [];
    list.push(item);
    buckets.set(year, list);
  }
  const years = [...buckets.keys()].sort((a, b) => (a === null ? 1 : b === null ? -1 : b - a));
  return years.map((year) => ({ year, items: [...buckets.get(year)!].sort(compareListItems) }));
}
