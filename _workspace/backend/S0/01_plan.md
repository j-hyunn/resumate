# S0 bootstrap 계획

## 범위
- UI 하네스 실행 이력 없음(`package.json`, `docs/ui/` 없음) → 백엔드가 Next.js 앱 골격을 처음 만든다.
- 테이블·RPC·엔드포인트·AI 기능 없음.

## 작업
### api-engineer (선행)
- Next.js (App Router, TypeScript strict, `src/` 디렉터리, ESLint, Tailwind) 골격을 저장소 루트에 생성. pnpm 사용. 기존 파일(`docs/`, `_workspace/`, `.claude/`, `CLAUDE.md`, `README.md`)은 건드리지 않는다.
  - Tailwind는 UI 하네스가 쓰는 스택이므로 포함하되, `shadcn init`은 하지 않는다(UI 소관).
- 스크립트: `dev`, `build`, `start`, `lint`, `typecheck`(`tsc --noEmit`), `test`(`vitest run`), `test:watch`.
- Vitest 설정(`vitest.config.ts`, node 환경, `@/` 별칭).
- `src/server/env.ts`: zod 기반 env 로더(서버 전용). 키: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`(S1 app_ai_writer JWT용), `ANTHROPIC_API_KEY`, `CRON_SECRET`. 값은 로그에 찍지 않는다. 테스트 포함.
- `.env.example`(더미 값), `.gitignore`에 `.env*.local` 확인.
- backend-context.md 디렉터리 골격(`src/server/{actions,services,db,ai,jobs}`, `src/lib/contracts`, `src/app/api`) — 빈 디렉터리는 `.gitkeep`.
- `src/lib/contracts/errors.ts`: `AppError`(code, message) + `{ error: { code, message } }` 매핑 헬퍼, 테스트 포함.
- `src/lib/contracts/enums.ts`: 빈 자리(이후 슬라이스에서 CHECK 목록 미러).
- 의존성: `zod`, `@supabase/supabase-js`, `@supabase/ssr`, `@anthropic-ai/sdk`; dev: `vitest`, `supabase`(CLI).

### db-engineer (api-engineer 이후)
- `pnpm exec supabase init` → `supabase/config.toml`. 프로젝트 id `resumate`.
- `config.toml` auth: site_url `http://localhost:3000`, 매직 링크 활성, Google provider 자리(비활성, env 참조).
- `supabase/migrations/`, `supabase/tests/`, `supabase/seed.sql`(빈 파일, 주석만).
- Docker가 없어 `supabase start`/타입 생성은 하지 않는다. `src/server/db/database.types.ts`는 S1에서 생성.

### backend-qa
- `run-checks.sh` 실행. typecheck / lint / vitest PASS, pgTAP SKIP 예상. `pnpm build`도 한 번 확인.

## 원격 브랜치 적용: 하지 않음
## 연결(wiring): 해당 없음
