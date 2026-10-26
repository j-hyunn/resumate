import type { CareerAffiliationRef, CareerYearAffiliation, CareerYearGroup } from "@/lib/contracts/career";

/**
 * DM §2.4 / UX S-08 year view (D-22 (b)). Not stored; computed on every read.
 *
 * - Experience / education: every year from start_month to coalesce(end_month, this month)
 *   (재직·재학 중이면 올해까지). No start_month → the "연도 미정" bucket.
 * - Project: the single year of coalesce(projects.start_month, affiliation.start_month).
 *   Under its experience/education header in that year; independent → "기타 프로젝트".
 *   No year at all → "연도 미정" (year: null), always last.
 * - Latest year first.
 *
 * Implementation decision: if a project's year falls outside its affiliation's
 * active years (e.g. project dated before the job started), the affiliation
 * header is added to that year too, so the hierarchy stays intact.
 */

export type YearViewExperience = { id: string; startMonth: string | null; endMonth: string | null; isCurrent: boolean };
export type YearViewEducation = { id: string; startMonth: string | null; endMonth: string | null };
export type YearViewProject = {
  id: string;
  experienceId: string | null;
  educationId: string | null;
  startMonth: string | null;
  createdAt: string;
};

export type YearViewInput = {
  experiences: readonly YearViewExperience[];
  educations: readonly YearViewEducation[];
  projects: readonly YearViewProject[];
};

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

/** Inclusive list of active years, or [] when the start is unknown. */
function activeYears(start: string | null, end: string | null, ongoing: boolean, currentYear: number): number[] {
  const from = yearOf(start);
  if (from === null) return [];
  const endYear = ongoing ? currentYear : (yearOf(end) ?? currentYear);
  const to = Math.max(from, endYear);
  const years: number[] = [];
  for (let y = from; y <= to; y += 1) years.push(y);
  return years;
}

type Affiliation = CareerAffiliationRef & { startMonth: string | null };
type Bucket = { affiliations: Map<string, CareerYearAffiliation>; other: string[] };

const key = (ref: CareerAffiliationRef) => `${ref.type}:${ref.id}`;

/** Descending by month string; nulls last. `'YYYY-MM'` strings compare lexicographically. */
function compareMonthDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

export function groupCareerByYear(input: YearViewInput, currentYear: number): CareerYearGroup[] {
  const buckets = new Map<number | null, Bucket>();
  const bucket = (year: number | null): Bucket => {
    let b = buckets.get(year);
    if (!b) {
      b = { affiliations: new Map(), other: [] };
      buckets.set(year, b);
    }
    return b;
  };
  const addHeader = (year: number | null, aff: Affiliation): CareerYearAffiliation => {
    const b = bucket(year);
    const k = key(aff);
    let entry = b.affiliations.get(k);
    if (!entry) {
      entry = { type: aff.type, id: aff.id, projectIds: [] };
      b.affiliations.set(k, entry);
    }
    return entry;
  };

  const affiliations = new Map<string, Affiliation>();
  for (const e of input.experiences) {
    const aff: Affiliation = { type: "experience", id: e.id, startMonth: e.startMonth };
    affiliations.set(key(aff), aff);
    const years = activeYears(e.startMonth, e.endMonth, e.isCurrent, currentYear);
    if (years.length === 0) addHeader(null, aff);
    for (const y of years) addHeader(y, aff);
  }
  for (const ed of input.educations) {
    const aff: Affiliation = { type: "education", id: ed.id, startMonth: ed.startMonth };
    affiliations.set(key(aff), aff);
    const years = activeYears(ed.startMonth, ed.endMonth, false, currentYear);
    if (years.length === 0) addHeader(null, aff);
    for (const y of years) addHeader(y, aff);
  }

  // Projects: newest effective start first, then oldest-created first (stable for same month).
  const placed = input.projects.map((p) => {
    const parentRef: CareerAffiliationRef | null = p.experienceId
      ? { type: "experience", id: p.experienceId }
      : p.educationId
        ? { type: "education", id: p.educationId }
        : null;
    const parent = parentRef ? (affiliations.get(key(parentRef)) ?? null) : null;
    const effectiveStart = p.startMonth ?? parent?.startMonth ?? null;
    return { project: p, parent, effectiveStart, year: yearOf(effectiveStart) };
  });
  placed.sort(
    (a, b) =>
      compareMonthDesc(a.effectiveStart, b.effectiveStart) ||
      a.project.createdAt.localeCompare(b.project.createdAt) ||
      a.project.id.localeCompare(b.project.id),
  );
  for (const { project, parent, year } of placed) {
    if (parent) addHeader(year, parent).projectIds.push(project.id);
    else bucket(year).other.push(project.id);
  }

  const startOf = (ref: CareerAffiliationRef) => affiliations.get(key(ref))?.startMonth ?? null;
  const years = [...buckets.keys()].sort((a, b) => (a === null ? 1 : b === null ? -1 : b - a));
  return years.map((year) => {
    const b = buckets.get(year)!;
    const affs = [...b.affiliations.values()].sort(
      (x, y) =>
        compareMonthDesc(startOf(x), startOf(y)) ||
        (x.type === y.type ? 0 : x.type === "experience" ? -1 : 1) ||
        x.id.localeCompare(y.id),
    );
    return { year, affiliations: affs, otherProjectIds: b.other };
  });
}
