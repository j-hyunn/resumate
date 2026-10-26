# S0 bootstrap 요약

## 만든 것
- Next.js 16.4.2 (App Router, TS strict, `src/`, ESLint, Tailwind 4). shadcn은 UI 하네스 몫으로 남겨 둠
- pnpm 12 스크립트: dev / build / start / lint / typecheck / test / test:watch / db:reset / db:test / db:types
- Vitest 5 (`vitest.config.mts`), zod env 로더 `src/server/env.ts`, `AppError`와 오류 매핑 `src/lib/contracts/errors.ts`, 빈 `enums.ts`
- backend-context 디렉터리 골격 (`.gitkeep`)
- `supabase init` (project_id `resumate`), auth 리다이렉트 URL, Google provider는 비활성, seed는 주석만
- `.env.example` 키 7개 (더미)

## 검사
typecheck / lint / vitest / build PASS, pgTAP SKIP (Docker 없음)

## 다음 슬라이스 전 참고
- Next 16은 `middleware.ts` 대신 `proxy.ts` 파일 규칙을 쓴다. 하네스 문서(backend-context.md, nextjs-server-api)에는 아직 `middleware.ts`로 적혀 있다.
- `next.config.ts`에 `cacheComponents: true`가 켜져 있다. S1부터 `cookies()`나 `after()`를 쓰는 라우트는 Cache Components 규칙을 따라야 한다.
- S1부터 pgTAP을 돌려야 하므로 Docker가 필요하다.

## spec-gaps 추가: 없음 / 사용한 [가정]: 없음
