# R6 백엔드 QA 리포트 (라운드 1) — 로그인 Google 단일화

검토 대상: 커밋 안 된 작업 트리 diff (`src/**`, `supabase/config.toml`, `supabase/templates/*` 삭제), 01_plan.md, 02_api-engineer_notes.md, 02_db-engineer_notes.md, decisions.md 4.5.

## 검사 실행 결과

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | `run-checks.sh --build` |
| lint | 통과 | 경고·오류 없음 |
| vitest | 통과 | 125 파일 / 1967 테스트. 로컬 스택이 떠 있어 통합 테스트도 실행됨(signInWithPassword 경로 정상 → 이메일 공급자 유지 판단과 일치) |
| build (`pnpm build`) | 통과 (조건부) | 스크립트 실행은 실패: 이 worktree에 `.env.local`이 없어 prerender 중 `EnvValidationError: NEXT_PUBLIC_SUPABASE_URL is missing` (R6와 무관한 환경 문제). 더미 env 값(로컬 URL, 가짜 키)을 주고 다시 돌리면 `✓ Compiled successfully`, exit 0. UI(`sign-in-form.tsx`, `components/account/actions.ts`)가 바뀐 `lib/data/account.ts`를 import한 상태로 컴파일됨 |
| pgTAP (`supabase test db`) | 실패 2건 — R6 무관 | 비파괴 실행(트랜잭션 롤백, `db reset` 안 함). 53 파일 / 2500 테스트 중 `ai_provider_keys.test.sql` #35, `drafts_qa1.test.sql` #14 실패 — db-engineer 노트의 기존 잔여 데이터 원인과 동일(`0c734ddf…` job). R6는 마이그레이션·pgTAP 변경 없음, config.toml은 pgTAP에 영향 없음 |
| 새 config로 auth 컨테이너 재기동 확인 | SKIP | 공유 로컬 스택이라 `supabase stop/start` 안 함. 현재 컨테이너 env: `GOTRUE_EXTERNAL_EMAIL_ENABLED=true`, `GOTRUE_DISABLE_SIGNUP=false`, `GOTRUE_EXTERNAL_GOOGLE_ENABLED=false` (R6 config 값과 같으므로 재기동해도 변화 없음) |

## 경계면 검사

| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | 데이터 모델 ↔ 마이그레이션 | 해당 없음 (스키마 변경 없음) | |
| Q2 | 마이그레이션 ↔ 타입 ↔ 쿼리 | 해당 없음 | |
| Q3 | RPC ↔ 호출부 | 해당 없음 (콜백의 동의·계정 상태 조회는 변경 없음) | |
| Q4 | raise 코드 ↔ 오류 매핑 | 통과 | `auth_rate_limited` 제거 — src 전체 grep 사용처 0 (UI 포함) |
| Q5 | 계약 ↔ 액션 ↔ 서비스 ↔ 콜백 라우트 | 통과 | 아래 상세 |
| Q6 | SSE | 해당 없음 | |
| Q7 | AI 출력 ↔ 저장 | 해당 없음 | |
| Q8 | enum DB ↔ TS | 해당 없음 (`AUTH_ERROR_CODES`는 DB CHECK 없음) | |
| Q9 | AI job 종료·사용량 | 해당 없음 | |
| Q10 | 보안·개인정보 | 통과, 메모 1건 | QA-02 (호스팅 설정 의존) |
| Q11 | UI ↔ 백엔드 | 통과 | 미리보기 경로 유지, 실제 경로 안전 실패, build 통과 |

### Q5 상세 (양쪽 대조)
- 계약 `src/lib/contracts/auth.ts`: `SignInWithGoogleInput`, `SignInWithGoogleResult`, `SignOutResult`, `AUTH_ERROR_CODES = auth_failed, consent_required` ↔ 액션 `src/server/actions/auth.ts:15-22`(`signInWithGoogle` → `auth.startGoogleSignIn`), `signOut` ↔ 서비스 `src/server/services/auth/index.ts:35-52`. 제거된 export(`SendMagicLinkInput`, `sendMagicLink`)를 참조하는 서버 코드 없음.
- `CallbackParams`(`index.ts:54-59`: `code`, `next`, `providerError`) ↔ 라우트 `src/app/auth/callback/route.ts:15-19`(`code`, `next`, `error`) 일치.
- `?error=` 경로: provider 오류(OAuth 취소) → `index.ts:85` → `/sign-in?error=auth_callback`; code 없음 → `:87`; 교환 실패 → `:89`. 테스트 `auth.test.ts:127`(교환 오류), `:134`(token_hash만 옴, 교환·RPC 호출 없음), `:142`(provider 오류·파라미터 없음) 존재·통과.
- `next` 안전성: `safeNextPath`를 `:84`에서 먼저 적용(변경 없음), `buildCallbackUrl`도 그대로. 테스트 `:115` 통과.
- 순서: provider 오류 → code 교환 → `deletion_incomplete`(S-25) → `profile_missing` → 동의 게이트 → `next` — 변경 전과 동일. 테스트 `:90`, `:96`, `:108`, `:122` 통과.
- `mapAuthError`: 이제 모든 Auth 오류 → `auth_failed`(502, 한국어 메시지, 원문 비노출). Google 시작 실패에 429 구분이 필요하다는 스펙 근거 없음 → 문제 없음.

### Q11 상세 (`src/lib/data/account.ts`)
- `sendMagicLink`(`:107-119`): 미리보기는 mock 그대로, 실제 경로는 `AccountRequestError` throw → `components/account/actions.ts:43-50`이 잡아 `{ ok: false }` → 폼 일반 오류. 서버 호출·메일 발송 없음.
- `completeSignIn`(`:128-141`): 비미리보기면 즉시 throw (변경 전과 같은 가드, 문구만 변경).
- `signInWithGoogle`: `nextFromSignInUrl` 사용 유지, 실제 경로 `authActions.signInWithGoogle` 그대로.

### 남은 매직 링크 흔적 grep (`signInWithOtp|verifyOtp|token_hash|sendMagicLink|SendMagicLink|auth_rate_limited|magic_link|templates/`)
- 서버(`src/server`, `src/app/auth`, `src/lib/contracts`): 설명 주석 `services/auth/index.ts:69`과 회귀 테스트 `auth.test.ts:134,137`뿐 — 의도된 것.
- `supabase/`: `config.toml:266,272`의 CLI 기본 주석 예시(invite, password_changed)뿐. `supabase/templates/` 폴더 없음.
- UI 소유 파일(예상된 UI 후속, 이슈 아님 — decisions.md 4.5 UI 행):
  - `src/components/account/sign-in-form.tsx:19,73` (`sendMagicLinkAction`, `openMagicLinkAction`)
  - `src/components/account/actions.ts:14,43,45,59` (`sendMagicLink`, `completeSignIn({ method: "magic_link" })`)
  - `src/app/(public)/sign-in/page.tsx:15-16,24` — `?error=auth_callback`를 "링크 만료 안내"로 보여 줌, `sent`·`link-expired` 미리보기. 이제 OAuth 취소·교환 실패에도 같은 화면이 나오므로 문구 교체 필요(4.5 "콜백 실패 문구 교체"에 이미 있음).
  - 연결 계층 `src/lib/data/account.ts:107,125,129` — UI 재작업 때 함께 제거(노트에 기록됨).

### `[auth.email] enable_signup = true` 유지 판단 (db-engineer 근거 검증)
- 근거 확인: 실행 중인 auth 컨테이너 env에서 `GOTRUE_EXTERNAL_EMAIL_ENABLED=true`(= `[auth.email] enable_signup`)와 `GOTRUE_DISABLE_SIGNUP=false`(= `[auth] enable_signup`)가 따로 있음을 확인. CLI(v2.122.0)는 `[auth.email] enable_signup`을 이메일 공급자 전체 on/off로 넘기고, GoTrue는 공급자가 꺼지면 `grant_type=password`를 "Email logins are disabled"로 거절한다. `signInWithPassword` 사용 파일 15개(노트는 17개라고 적었으나 grep 결과 15개 — 결론에 영향 없음). 이번 vitest 실행에서 이 통합 테스트들이 실제로 돌고 통과함.
- `[auth] enable_signup = false`는 Google 첫 로그인(신규 사용자 생성)을 막으므로 대안이 아님 — 동의.
- 결론: 근거 타당, 유지 동의. 남는 노출은 로컬 anon 키로 GoTrue `/signup`·`/otp`를 직접 부르는 경로뿐이고 로컬 전용. 다만 config 주석 하나가 이 결정과 모순됨(QA-01), 그리고 호스팅에서는 대시보드 조치 전까지 이메일 로그인이 GoTrue 수준에서 살아 있음(QA-02).

## 이슈

### QA-01 [Minor] `[auth]` 주석이 실제 설정과 모순
- 담당: db-engineer
- 근거: `supabase/config.toml:182-183` "Blocking email self-signup is done in [auth.email] below." ↔ `supabase/config.toml:229-238` 이메일 공급자를 의도적으로 켜 두고 `enable_signup = true`. 로컬에서 이메일 자가 가입은 막히지 않는다.
- 수정 제안: `:183` 문장을 "Email self-signup is not blocked locally ([auth.email] stays on for integration tests); the hosted project turns the Email provider off in the dashboard." 정도로 교체.
- 상태: 열림

### QA-02 [Minor] 호스팅 이메일 공급자가 꺼지기 전까지 이메일 로그인이 콜백으로 통과 가능
- 담당: 리더 → 사용자 할 일 (코드 변경 아님)
- 근거: `src/server/services/auth/index.ts:87-89`는 출처를 가리지 않고 모든 PKCE `code`를 교환한다. 호스팅 Email 공급자가 켜져 있으면 anon 키로 GoTrue `/otp`(code_challenge 포함)를 직접 불러 받은 메일 링크 → `/auth/callback?code=…`로 로그인·가입이 된다. 앱 UI·액션 경로는 없으므로 제품 경로는 닫혀 있음. 코드로 막을 방법은 사실상 없고(교환 후 identity provider 검사는 과함) 대시보드 조치가 정답.
- 수정 제안: db-engineer 노트 "사용자가 호스팅 대시보드에서 직접 할 일" 1번(Email 공급자 끄기)과 2번(전체 가입 허용은 켜 둠)을 R6 완료 조건으로 사용자에게 명확히 전달. 커밋 전/배포 전 체크리스트에 포함.
- 상태: 열림 (사용자 조치 대기)

## 스펙 차이 (spec-gaps.md로 넘길 항목 — 리더 판단)
- decisions.md 4.5 "Supabase 설정" 행의 "Auth 이메일 공급자 끄기(가입 차단)"는 로컬에서는 지킬 수 없음(통합 테스트의 비밀번호 로그인). "호스팅은 대시보드에서 끔, 로컬은 테스트용으로 유지"로 문구를 고치는 것이 맞음.
- 하네스 문서가 아직 "magic link + Google"로 적혀 있음(코드 아님, 리더 몫): `.claude/skills/resumate-backend/references/backend-context.md:30`, `.claude/skills/resumate-backend/references/slice-catalog.md:10`, `.claude/skills/nextjs-server-api/SKILL.md:3,62`, `.claude/agents/api-engineer.md:13`.

## 결론
Critical·Major 없음. Minor 2건(주석 모순 1, 호스팅 설정 의존 1). 서버 경로에서 이메일 OTP·매직 링크는 완전히 제거됐고, 콜백의 오류·`next`·탈퇴 미완료·동의 게이트 순서는 그대로다.
