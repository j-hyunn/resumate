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

/**
 * 자기소개서 관리 흐름 재설계 (UX v5.20, CF-1·CF-7·CF-8 — decisions 4.23 UI 4). 한 자기소개서의
 * 모든 옛 주소가 **S-46 `/applications/{id}/cover-letter`**로 간다 (308, 안내 없음):
 *
 * | 옛 주소 | 화면 | 간 곳 |
 * |---|---|---|
 * | `/applications/new` | S-14 전체 페이지 | `/applications?new=1` — S-13 위에 모달을 연 채로 (`[가정]`) |
 * | `/applications/{id}` | S-31 허브 (폐기) | S-46 |
 * | `/applications/{id}/jd` | S-15 | S-46 `?tab=jd` |
 * | `/applications/{id}/insight` | S-16 | S-46 `?tab=insight` |
 * | `/applications/{id}/drafts[/…]` | S-17 · S-19 · 옛 문항 설정 | S-46 (서류 종류 판정 불필요 — CF-1) |
 * | `/applications/{id}/career-description` | S-45 경력기술서 (폐기) | S-46 |
 * | `/applications/{id}/cover-letter/questions` | v5.18 문항 설정 | S-46 (한 주소 두 상태) |
 * | `/applications/{id}/interview…` | S-20 · S-33 · S-22 (RM-1 폐기) | S-46 — R14가 보내던 S-31이 폐기됐다 (MRG-UX-1 `[가정]`) |
 * | `/interviews[/…]` | S-37 (RM-1 폐기) | S-13 `/applications` (그대로) |
 *
 * 지원 프로젝트가 없으면 S-46이 ST-NOTFOUND → S-13으로 보낸다.
 * `:rest*` also matches the bare prefix. [UI-가정] Next keeps the request's query string on a config
 * redirect; the targets ignore unknown keys, so nothing changes on screen. `/applications/new` comes
 * first because `/applications/:id` would match "new" (rules match in order).
 */
export const APPLICATION_LEGACY_REDIRECTS: LegacyRedirect[] = [
  { source: "/applications/new", destination: "/applications?new=1", permanent: true },
  { source: "/applications/:id/jd", destination: "/applications/:id/cover-letter?tab=jd", permanent: true },
  { source: "/applications/:id/insight", destination: "/applications/:id/cover-letter?tab=insight", permanent: true },
  { source: "/applications/:id/drafts/:rest*", destination: "/applications/:id/cover-letter", permanent: true },
  { source: "/applications/:id/career-description", destination: "/applications/:id/cover-letter", permanent: true },
  { source: "/applications/:id/cover-letter/questions", destination: "/applications/:id/cover-letter", permanent: true },
  // S-20 · S-33 · S-22 (v5.19, RM-1) — 도착지였던 S-31이 폐기되어 S-46으로 (MRG-UX-1 `[가정]`)
  { source: "/applications/:id/interview/:rest*", destination: "/applications/:id/cover-letter", permanent: true },
  { source: "/interviews/:rest*", destination: "/applications", permanent: true },
  // S-31 허브 — 마지막: 위의 더 긴 경로들이 먼저 걸러진 뒤에만 맞는다
  { source: "/applications/:id", destination: "/applications/:id/cover-letter", permanent: true },
]

/** Every retired-screen redirect, in match order (next.config.ts). */
export const LEGACY_REDIRECTS: LegacyRedirect[] = [...CAREER_LEGACY_REDIRECTS, ...APPLICATION_LEGACY_REDIRECTS]
