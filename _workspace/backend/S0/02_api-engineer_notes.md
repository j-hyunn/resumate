# S0 API 구현 노트

## 엔드포인트 (DM §7 행 ↔ 파일)
- S0에는 엔드포인트가 없다. `src/app/api/`는 `.gitkeep`만 둔다.
- 화면은 create-next-app 기본 `src/app/page.tsx`, `layout.tsx`만 있다(UI 하네스 소관이라 손대지 않음).

## 스캐폴드
- 명령: `pnpm dlx create-next-app@latest scaffold --ts --app --src-dir --eslint --tailwind --use-pnpm --import-alias "@/*" --disable-git --skip-install --no-react-compiler --no-agent-feedback --yes`(스크래치패드에 생성 → 저장소 루트로 복사, 기존 파일은 덮어쓰지 않음)
  - git 끄는 플래그는 `--no-git`이 아니라 `--disable-git`이다.
  - 복사하지 않은 파일: `README.md`(기존 유지). 새로 들어온 파일: `AGENTS.md`(Next.js 에이전트 규칙 블록 — `next dev`가 다시 만들어 넣으므로 그대로 둠). `CLAUDE.md`는 변경 없음.
- 설치 버전(정확한 값)

| 패키지 | 버전 |
|--------|------|
| next / eslint-config-next | 16.4.2 |
| react / react-dom | 19.3.0 |
| typescript | 5.9.3 |
| tailwindcss / @tailwindcss/turbopack | 4.3.3 |
| eslint | 9.39.5 (pnpm이 deprecated 경고 — 스캐폴드 기본값이라 유지) |
| @types/node | 24.19.2 (스캐폴드 기본 ^20 → ^24로 올림, 아래 참고) |
| @types/react / @types/react-dom | 19.3.0 |
| zod | 4.6.7 |
| @supabase/supabase-js | 2.118.0 |
| @supabase/ssr | 0.12.7 |
| @anthropic-ai/sdk | 1.1.0 |
| vitest | 5.0.5 |
| supabase (CLI) | 2.121.0 — `pnpm exec supabase --version` 확인 |

- 런타임: Node v26.3.0, pnpm 12.15.0 (`packageManager: pnpm@12.15.0`).
- 빌드 스크립트 승인: pnpm 12는 `pnpm-workspace.yaml`의 `allowBuilds`를 쓴다. 스캐폴드 기본값(`sharp: false`, `unrs-resolver: false`)을 그대로 둠. `supabase` CLI는 플랫폼별 optional 패키지(`@supabase/cli-darwin-arm64`)로 바이너리를 받아 postinstall이 필요 없고, `pnpm ignored-builds`에도 다른 항목이 없다. `esbuild`는 vitest 5(vite + rolldown)가 쓰지 않아 해당 없음.
- create-next-app 16.4 기본 `next.config.ts`에 `cacheComponents: true`, `partialPrefetching: true`가 켜져 있다. 그대로 둠. S1 이후 `cookies()`/`after()`를 쓰는 라우트는 Cache Components 규칙(동적 API는 Suspense 경계 또는 동적 라우트)에 맞춰야 한다.
- Next.js 16에서 `middleware.ts`는 `proxy.ts`로 이름이 바뀌었다(backend-context.md는 `middleware.ts`라고 씀). S1 인증 작업 때 `node_modules/next/dist/docs/`에서 확인 후 결정.

## 스크립트 (package.json)
- `dev`, `build`, `start`, `lint`(`eslint`) — 스캐폴드 기본
- `typecheck`: `next typegen && tsc --noEmit` — Next 16의 `layout.tsx`가 전역 `LayoutProps` 타입을 쓰는데, 이 타입은 `.next/types`에 생성되므로 `tsc`만 돌리면 실패한다. typegen을 먼저 돌린다.
- `test`: `vitest run`, `test:watch`: `vitest`
- `db:reset`: `supabase db reset`, `db:test`: `supabase test db`, `db:types`: `supabase gen types typescript --local > src/server/db/database.types.ts` (Docker 필요 — 현재 미실행)

## 계약 (요청·응답·SSE 이벤트, contracts 파일)
- `src/lib/contracts/errors.ts`
  - `AppError(code, message?, { status?, cause? })` — 일반 코드는 한국어 기본 메시지·HTTP 상태를 갖는다. 알 수 없는 코드(예: RPC `raise` 이름)는 상태 400, 메시지는 직접 넘긴다.
  - 코드 목록: `APP_ERROR_CODES`(`unauthenticated`, `forbidden`, `not_found`, `invalid_input`, `conflict`, `limit_reached`, `internal_error`), `AI_ERROR_CODES`(AI 명세 C-6 `error_code` 10개). `ErrorCode`는 이 둘 + 임의 문자열.
  - `ActionResult<T> = { data: T } | { error: { code, message } }`, 헬퍼 `ok`, `fail`, `invalid(zodError)`, `runAction(fn)`, `toErrorBody(err)`, `errorResponse(err)`(Route Handler용 JSON Response), `isErrorResult`.
  - 알 수 없는 예외는 항상 `internal_error` + 일반 메시지로 바뀌어 내부 정보가 응답에 새지 않는다.
  - `invalid()`는 현재 필드별 상세를 응답에 넣지 않는다. 필드 단위 오류가 필요한 화면이 생기면 그 슬라이스에서 `ErrorBody`를 명시적으로 확장한다.
- `src/lib/contracts/enums.ts`: 빈 자리(`export {}`).
- SSE 이벤트: S0 해당 없음.

## env 로더
- `src/server/env.ts`: `ServerEnvSchema`(zod) — `NEXT_PUBLIC_SUPABASE_URL`(URL), `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`(32자 이상), `ANTHROPIC_API_KEY`, `CRON_SECRET`(16자 이상).
  - `parseServerEnv(source)`: 순수 함수. 빈 문자열/공백은 누락으로 처리. 실패 시 `EnvValidationError`(`keys`, 메시지에는 키 이름과 zod 일반 메시지만 — 값은 절대 포함 안 함).
  - `getServerEnv()`: 처음 호출 때 `process.env`를 한 번 파싱하고 캐시. 지연 평가라 env 없이도 `next build`와 단위 테스트가 돈다. `resetServerEnvCache()`는 테스트용.
  - 클라이언트 컴포넌트는 이 모듈을 import하지 않는다(`process.env.NEXT_PUBLIC_*` 리터럴 접근으로 인라인).
  - `server-only` 패키지는 쓰지 않았다(Vitest에서 import 시 throw). 서버 전용임은 경로(`src/server/`)와 주석으로 표시.
- `.env.example`: 위 5개 키, 더미 값. `.gitignore`는 `.env*` 무시 + `!.env.example` 예외(스캐폴드 기본 `.env*`가 `.env.example`까지 무시하던 것을 보정), `supabase/.temp`, `supabase/.branches` 추가.

## 디렉터리 골격
- `src/server/{actions,services,db,ai,jobs}/.gitkeep`, `src/app/api/.gitkeep`, `src/lib/contracts/`(errors.ts, enums.ts).
- `vitest.config.mts`: node 환경, `@` → `src` 별칭, `src/**/*.test.ts`, `unstubEnvs: true`. `.ts` 대신 `.mts`인 이유: package.json에 `"type": "module"`이 없어 vite가 ESM 설정 파일 경고를 띄움.

## 사용량·작업 흐름 (예약 → 확정/해제 경로)
- S0 해당 없음.

## 테스트
- `src/server/env.test.ts` (9개): 정상 파싱, 스키마 밖 키 제거, 전체 누락 보고, 빈 문자열/공백 = 누락, 잘못된 URL, 짧은 JWT secret, 오류 메시지에 값 미포함, `getServerEnv` 캐시, 불완전한 env에서 throw.
- `src/lib/contracts/errors.test.ts` (15개): AppError 기본 메시지·상태·cause, 미지 코드 기본값, toErrorBody의 내부 정보 은닉, ok/fail/invalid/isErrorResult, runAction 성공·AppError·예상 밖 예외, errorResponse 상태·JSON.
- 결과: `pnpm typecheck` PASS, `pnpm lint` PASS(경고 0), `pnpm test` PASS(2 파일, 24 테스트), `pnpm build` PASS(`/`, `/_not-found` 정적).

## 스펙 차이·가정
- 기획 문서와의 차이 없음(`spec-gaps.md` 추가 없음).
- 계획 대비 변경: `@types/node` ^20 → ^24 (vitest 5의 peer 요구 `^22 || >=24` 충족, `pnpm peers check` 통과). `typecheck` 스크립트에 `next typegen` 선행.
- 참고(backend-context.md 갱신 후보, 리더 판단): Next 16의 `middleware.ts` → `proxy.ts` 이름 변경.
