/**
 * HTTP redirects for retired screens' addresses (02 1장 "폐기 화면은 redirect만"), used by next.config.ts
 * `redirects()` — a 3xx before any page renders, so bookmarks and outside links never draw an empty shell
 * (QA UQ-428). Tested in legacy-redirects.test.ts with Next's own matcher.
 *
 * - S-09 경력 편집 (`/career/experiences/new|{id}`) and S-34 교육 편집 (`/career/educations/new|{id}`) are the S-08
 *   panel / add·edit modal now (UX v5.5, OD-C2): `new` → the add modal (`routes.careerNew`), an id → that item
 *   selected (`routes.careerItem`). The old `?achievement=` (S-11, retired with CR-11) is dropped. S-08 says
 *   "찾을 수 없는 항목이에요" for an unknown id. The id goes into the query encoded (Next formats the query).
 * `new` comes first: rules match in order.
 */
export interface LegacyRedirect {
  source: string
  destination: string
  permanent: boolean
}

export const CAREER_LEGACY_REDIRECTS: LegacyRedirect[] = [
  { source: "/career/experiences/new", destination: "/career?new=experience", permanent: true },
  { source: "/career/experiences/:id", destination: "/career?item=experience::id", permanent: true },
  { source: "/career/educations/new", destination: "/career?new=education", permanent: true },
  { source: "/career/educations/:id", destination: "/career?item=education::id", permanent: true },
]
