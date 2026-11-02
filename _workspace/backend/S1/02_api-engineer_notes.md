# S1 API 구현 노트

## 엔드포인트 (DM §7 행 ↔ 파일)
DM §7 v3 표에는 S1 행이 없고("그 밖 v2와 같음"), S1 계획(01_plan.md) API 절을 따랐다.

| 작업 | 방식 | 파일 |
|------|------|------|
| 매직 링크 발송·재발송 (F-COM-01, S-02) | Server Action `sendMagicLink({ email, next? })` | `src/server/actions/auth.ts` |
| Google 로그인 시작 (S-02) | Server Action `signInWithGoogle({ next? })` → `{ url }` (클라이언트가 이동) | 같음 |
| 로그아웃 | Server Action `signOut()` | 같음 |
| OAuth·매직 링크 콜백 | Route Handler `GET /auth/callback` (`code` 교환 또는 `token_hash`+`type` 검증) | `src/app/auth/callback/route.ts` |
| 세션 갱신 + 미로그인 보호 경로 리다이렉트 | Next 16 Proxy | `src/proxy.ts` → `src/server/auth/proxy-session.ts` |
| 동의 상태 (S-03, S-24) | Server Action `getConsentStatus()` → RPC `get_consent_status` | `src/server/actions/consent.ts` |
| 동의 제출 (S-03) | Server Action `submitConsents({ items }, next?)` → RPC `record_consents` | 같음 |
| 선택 동의 철회 (S-24) | Server Action `withdrawConsent({ consentType })` → `consents.withdrawn_at` update(RLS) | 같음 |
| 프로필 조회·수정 (S-04) | Server Action `getProfile()`, `updateProfile(patch)` | `src/server/actions/profile.ts` |

- 서비스(Next 비의존, Vitest 대상): `src/server/services/auth/`, `services/consent/`, `services/profile/`.
- 인증 헬퍼 `src/server/auth/session.ts`
  - `requireUser()` → `{ supabase, user }`. `auth.getUser()`로 Auth 서버 검증, 없으면 `AppError('unauthenticated')`(401).
  - `requireConsentedUser()` → 필수 동의 미완이면 `AppError('consent_required')`(403). 프로필 액션이 사용. 이후 슬라이스의 사용자 데이터 액션도 이것을 쓴다.
  - `requireConsentedUserOrRedirect(currentPath)` → 페이지용. 미로그인(`unauthenticated`일 때만) `/login?next=`, 미동의 `/onboarding/consent?next=`. 그 밖의 오류(env·네트워크·Auth 장애, 동의 RPC 실패)는 다시 던져 오류 경계로 보낸다(QA-07). UI 대시보드 레이아웃이 연결 단계에서 호출(Cache Components라 Suspense 경계 안에서 호출해야 함).
- 클라이언트
  - `src/server/db/server.ts` `createSupabaseServerClient()` — `@supabase/ssr` 0.12 `getAll`/`setAll`. Server Component에서는 setAll이 no-op(try/catch), 갱신은 proxy가 담당.
  - `src/server/db/ai-writer.ts` `createAiWriterClient(userId)` — 아래 "app_ai_writer 방식".
  - `src/server/db/types.ts` — 클라이언트 타입(Next 비의존, 서비스가 import).
  - `src/server/db/errors.ts` `mapDbError()` — PostgREST/RPC 오류 → AppError 한 곳 매핑.
- `src/server/auth/site-url.ts` `getSiteOrigin()` — 리다이렉트 URL origin(QA-10 반영). `NEXT_PUBLIC_SITE_URL`이 있으면 항상 그 origin. **production(`VERCEL_ENV=production`, 또는 VERCEL_ENV 없이 `NODE_ENV=production`)에서 없으면 `internal_error`로 실패(fail closed)**. 개발·Vercel Preview에서만 `x-forwarded-host`/`host` 사용. 판단 로직은 순수 함수 `resolveSiteOrigin()`.
- env 분리(QA-06): `getPublicEnv()`(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`만 검증)를 proxy·세션 클라이언트·site-url이 쓴다. `getServerEnv()`(전체)는 ai-writer와 이후 AI·크론만. AI·크론 키가 없어도 페이지·로그인은 동작(빌드 후 `next start`로 공개 env만 주고 `/`, `/career`, `/auth/callback` 확인).
- `server-only`(QA-08): 패키지 추가, `env.ts`, `db/server.ts`, `db/ai-writer.ts`, `auth/session.ts`, `auth/site-url.ts`에 `import "server-only"`. Vitest는 `vitest.config.mts` alias로 빈 모듈(`src/test/server-only-stub.ts`). proxy 경로에서도 정상 동작 확인.

### Proxy (Next 16)
- 위치: `src/proxy.ts` (Next 문서 `01-getting-started/16-proxy.md`: src 구조면 `app`과 같은 수준인 `src/` 안). 런타임은 Node 기본(`runtime` 설정 불가).
- matcher: `_next/static`, `_next/image`, `favicon.ico`, 이미지·txt·xml 확장자 제외 전부.
- 하는 일: `getClaims()`로 토큰 갱신 → 갱신 쿠키 + `@supabase/ssr`이 주는 no-cache 헤더를 응답에 씀. 미로그인 + 보호 경로(`/career`, `/applications`, `/interviews`, `/board`, `/settings`, `/onboarding/consent`)면 `/login?next=<경로+쿼리>` 307. 동의 게이트는 proxy에서 하지 않음(RPC 필요, 서버 쪽에서 판단).
- 인가가 아님: 모든 액션은 `requireUser()`/`requireConsentedUser()`를 직접 부른다(Next 문서도 Server Function은 proxy에 의존하지 말라고 함).

### 매직 링크 이메일 템플릿 (QA-05)
- 문제: `@supabase/ssr`은 PKCE라 기본 링크(`{{ .ConfirmationURL }}` → `?code=`)는 요청한 브라우저의 code verifier 쿠키가 있어야 교환된다. PC에서 요청 → 휴대폰에서 열기 실패.
- 조치: `supabase/templates/magic_link.html`, `supabase/templates/confirmation.html` 추가, `supabase/config.toml`에 `[auth.email.template.magic_link]`, `[auth.email.template.confirmation]`. 링크는 `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`.
  - `{{ .RedirectTo }}` = 앱이 보낸 `emailRedirectTo` = `<origin>/auth/callback?next=<path>`. SiteURL 대신 이것을 쓴 이유: Vercel Preview 등 요청 origin으로 돌아가게 하고, `next`를 그대로 보존하기 위해. 콜백은 이미 `token_hash`+`type`을 `verifyOtp`로 처리한다.
  - 전제: `emailRedirectTo`가 Auth 허용 목록에 있어야 한다. 없으면 GoTrue가 SiteURL로 바꿔 링크가 깨진다(아래 배포 체크리스트).
- 어떤 템플릿이 쓰이나(Supabase 문서 + 로컬 확인): `signInWithOtp`는 magic_link 템플릿. 단 **이메일 확인(Confirm email)이 켜진 프로젝트에서 처음 보는 이메일**은 가입 확인(confirmation) 메일을 받는다(호스팅 기본값). 로컬은 `enable_confirmations = false`라 신규·기존 모두 magic_link가 오는 것을 Mailpit으로 확인. 두 템플릿을 같은 링크 형식으로 맞춰 둠. `type=email`은 `verifyOtp`에서 가입 확인·매직 링크 모두 처리.
- `supabase stop && supabase start`로 반영, Mailpit에서 링크가 `http://localhost:3000/auth/callback?next=%2Fboard&token_hash=…&type=email`인 것 확인.
- 통합 테스트 `src/server/services/auth/magic-link.integration.test.ts`: 기기 A(PKCE 클라이언트)가 발송 → Mailpit에서 링크 추출 → verifier 없는 기기 B 클라이언트로 `completeAuthCallback` → 신규 사용자라 `/onboarding/consent?next=%2Fboard`, 세션 생성 확인.

### 배포 체크리스트 (원격 프로젝트, 출시 전)
- [ ] Vercel production에 `NEXT_PUBLIC_SITE_URL` 설정(없으면 로그인 시작이 실패하도록 막아 둠).
- [ ] Supabase Auth → URL Configuration: Site URL = 운영 origin. Redirect URLs에 `<운영 origin>/auth/callback`(정확한 URL). Preview를 허용한다면 와일드카드는 **우리 팀 Vercel 프로젝트 도메인 범위로만**(예: `https://resumate-*-<team>.vercel.app/auth/callback`). `https://*.vercel.app/**` 같은 넓은 패턴 금지.
- [ ] Email Templates(Magic Link, Confirm signup)에 `supabase/templates/*.html` 내용 복사.
- [ ] Google provider 설정 + Google Cloud 승인 리디렉션 URI = `<supabase url>/auth/v1/callback`.
- [ ] 레거시 JWT secret이 "사용 중"인지 확인(app_ai_writer HS256 서명, 아래 참고). Vercel env `SUPABASE_JWT_SECRET`.
- [ ] SMTP 설정(기본 메일 발송 한도가 매우 낮음).

### 콜백 분기 (`completeAuthCallback`)
- `error` 쿼리(제공자 취소 등) / code·token_hash 없음 / 교환 실패 → `/login?error=auth_callback`
- 성공 + 필수 동의 필요 → `/onboarding/consent?next=<next>`
- 성공 + 동의 완료 → `next` 또는 `/career`(S-08)
- 성공했지만 동의 상태 RPC 실패 → 동의 화면으로 보냄(fail closed — 동의 화면이 다시 판단)
- `next`는 항상 `safeNextPath()` 통과: 같은 출처 상대 경로만, `//host`·`/\host`·제어문자·`/login`·`/auth/callback` 거부, 512자 제한.
- 응답에 `Cache-Control: private, no-store`.

## 계약 (요청·응답·SSE 이벤트, contracts 파일)
- `src/lib/contracts/enums.ts`: `CONSENT_TYPES`(5), `REQUIRED_CONSENT_TYPES`(terms, privacy_required, cross_border_transfer), `OPTIONAL_CONSENT_TYPES`(service_improvement, marketing), `POLICY_TYPES`(terms, privacy, cross_border_transfer) — 마이그레이션 CHECK와 동일.
- `src/lib/contracts/routes.ts`: `ROUTES`(login `/login`, consent `/onboarding/consent`, home `/career`, authCallback `/auth/callback`), `PROTECTED_PREFIXES`, `LOGIN_ERRORS`(`auth_callback`), `safeNextPath`, `withNext`, `isProtectedPath`. 클라이언트에서도 import 가능(순수).
- `src/lib/contracts/auth.ts`: `SendMagicLinkInput { email(trim+소문자, ≤254), next? }` → `{ sent: true }`, `SignInWithGoogleInput { next? }` → `{ url }`, `SignOutResult { signedOut: true }`, `AUTH_ERROR_CODES`: `auth_rate_limited`(429, 재발송 과다), `auth_failed`(502), `consent_required`(403).
- `src/lib/contracts/consent.ts`
  - `ConsentStatus { items: ConsentStatusItem[]; needsRequiredConsent }`, `ConsentStatusItem { consentType, required, currentVersion: string|null, agreedVersion: string|null, needsConsent }` — RPC가 5행 고정 순서로 반환.
  - `SubmitConsentsInput { items: [{ consentType, agreed }] }`: 1~5개, 중복 금지, 보낸 필수 항목은 agreed=true. **필수 3종을 모두 보낼 필요는 없음**(재동의 시 필요한 유형만 제출 — db-engineer 확인). 남은 필수 누락은 RPC가 `required_consent_missing`으로 막음. 버전은 클라이언트가 보내지 않는다(보내도 zod가 제거).
  - `SubmitConsentsResult { status, redirectTo }` — `redirectTo`는 `safeNextPath(next)`.
  - `WithdrawConsentInput { consentType: 선택 2종만 }` → `ConsentStatus`.
- `src/lib/contracts/profile.ts`: `ProfileDto { id, displayName, desiredJobTitle, totalYearsOfExperience, interestedIndustries, careerDataUpdatedAt }`, `UpdateProfileInput`(부분 수정, 빈 patch 거부, 빈 문자열 → null, display_name ≤50, desired_job_title ≤100, 연차 정수 0..50).
- 오류 코드(RPC raise → 한국어 메시지, `src/server/db/errors.ts`): `invalid_consent_items`, `invalid_consent_type`, `duplicate_consent_type`, `required_consent_missing`(400), `policy_version_missing`(503), `unknown_policy_version`·`policy_version_not_current`(409, "약관이 변경되었습니다. 새로고침 후 다시 동의해 주세요." — QA-09), `42501 not_authenticated` → `unauthenticated`. 그 밖: `PGRST116`→not_found, `42501`→forbidden, `23514/22001/22P02/23502`→invalid_input, `23505`→conflict, 나머지→internal_error. 목록에 없는 raise 이름은 internal_error(DB 원문은 응답에 안 나감).
- SSE: S1 해당 없음.

## app_ai_writer 방식 (decisions.md 반영 후보)
- 로컬 스택: 사용자 세션 토큰은 **ES256**(JWKS에 EC 키), anon 레거시 키는 HS256. PostgREST는 **레거시 HS256 JWT secret도 검증**한다.
- 그래서 계획대로 HS256 + `SUPABASE_JWT_SECRET`으로 서명: `{ role: "app_ai_writer", sub: <user uuid>, aud: "authenticated", iss: <url>/auth/v1, iat, exp: +300s(상한), jti }`. 외부 라이브러리 없이 `node:crypto` HMAC. `accessToken` 콜백으로 요청마다 새로 서명(5분 만료 걱정 없음), apikey는 anon 키.
- 통합 테스트로 확인(아래). db-engineer도 같은 결과를 독립 확인함.
- 위험(리더 판단): 호스팅 Supabase에서 레거시 JWT secret을 **폐기(revoke)** 하면 HS256 토큰이 거부된다. 그때는 비대칭 키를 가져와(standby/imported key) ES256으로 서명하도록 `signAiWriterToken`만 바꾸면 된다(호출부 변경 없음). 출시 전 원격 프로젝트에서 레거시 secret이 "사용 중" 상태인지 확인 필요.
- app_ai_writer는 컬럼 단위 grant라 **`select *` 금지**, 컬럼을 나열해야 함(파일 주석에 명시). 정책은 `private.current_uid()`(db 노트 참고).

## 사용량·작업 흐름 (예약 → 확정/해제 경로)
- S1 해당 없음(AI 호출 없음).

## 테스트
- 단위: `src/lib/contracts/routes.test.ts`(safeNextPath 오픈 리다이렉트 케이스 등), `s1-contracts.test.ts`(zod 계약), `src/server/services/auth/auth.test.ts`(발송·재발송 오류 매핑, Google URL, 콜백 분기 10개), `services/consent/consent.test.ts`(매핑, UA 해시, RPC 인자 snake_case·버전 미전송, raise 매핑, 철회), `services/profile/profile.test.ts`, `src/server/db/errors.test.ts`, `src/server/db/ai-writer.test.ts`(토큰 구조·서명·TTL 상한·uuid 검사), `src/server/auth/proxy-session.test.ts`(리다이렉트·쿠키 전달·no-cache, `@supabase/ssr` mock).
- 통합(로컬 스택, 스택이 없거나 마이그레이션 미적용이면 자동 skip; `SKIP_SUPABASE_INTEGRATION=1`로 강제 skip):
  - `src/server/db/ai-writer.integration.test.ts`(7): 본인 행 허용 컬럼 읽기 OK, `display_name` 42501, `select *` 42501, 다른 사용자 안 보임, consents 42501, update 42501, 틀린 secret 거부.
  - `src/server/services/consent/consent.integration.test.ts`(6): 신규 사용자 게이트, `required_consent_missing` 매핑, 기록 후 게이트 해제·서버 버전, 선택 철회, 프로필 읽기·수정(RLS), CHECK 위반 → invalid_input.
  - 자격 증명은 `supabase status -o json`에서 읽고 출력하지 않음(`src/test/local-supabase.ts`). service role 키는 테스트 사용자 생성·삭제에만 사용.
- QA 1차 대응 추가: `src/server/auth/site-url.test.ts`(production fail closed, Preview·개발 Host 사용), `src/server/auth/session.test.ts`(unauthenticated만 로그인 리다이렉트, 다른 오류 재던짐), `env.test.ts` 공개 env 3건, `errors.test.ts` raise 코드 전체, `proxy-session.test.ts`는 비공개 env를 비운 상태로 실행, `magic-link.integration.test.ts`(1).
- 결과(QA 1차 대응 후): `pnpm typecheck` PASS, `pnpm lint` PASS(경고 0), `pnpm test` PASS(15 파일, 147 테스트 — 통합 14건 실제 실행), `pnpm build` PASS, `supabase test db` PASS(5 파일, 80). `next start` 스모크: `/` 200, `/career` → `/login?next=%2Fcareer`, `/auth/callback`(코드 없음·잘못된 코드) → `/login?error=auth_callback`.
- 실행: `pnpm test` (통합은 `supabase start` + `supabase db reset` 상태에서 자동 실행).

## 스펙 차이·가정
- `[가정]` 경로 이름 `/login`, `/onboarding/consent`는 UI 하네스가 정하면 `src/lib/contracts/routes.ts`만 바꾸면 된다. 보호 경로 목록도 같은 파일.
- `[가정]` `interested_industries` 항목 제한(최대 20개, 항목당 1~50자)은 DM A.1에 없어 앱 쪽에서만 정함(DB CHECK 없음).
- 결정: Google 로그인은 서버가 URL만 만들고(`skipBrowserRedirect`) 클라이언트가 이동. PKCE verifier 쿠키는 액션 응답으로 설정됨.
- 결정: 매직 링크는 `shouldCreateUser: true`(S-02가 가입·로그인 겸용).
- 결정: 콜백은 `code`(PKCE) 외에 `token_hash`+`type`도 처리 — 이메일 템플릿을 token_hash 방식으로 바꿔도 동작.
- 계획 대비 변경: 계획의 `AppError('UNAUTHENTICATED')`는 S0 계약의 소문자 코드 `unauthenticated`로 구현. 선택 동의 철회 액션(`withdrawConsent`) 추가(db-engineer 안내 반영, S-24용).
- env: `NEXT_PUBLIC_SITE_URL` 추가(개발·Preview 선택, production 필수), `.env.example` 반영. 의존성 `server-only` 추가.
- 리더 승인 범위 안에서 `supabase/config.toml`(이메일 템플릿 2개 항목)과 `supabase/templates/` 2개 파일을 수정·추가함(QA-05 한정).
- 기획 문서 모순 없음 → `spec-gaps.md` 추가 없음.
- 연결(wiring): UI 화면 없음 → 대기.
