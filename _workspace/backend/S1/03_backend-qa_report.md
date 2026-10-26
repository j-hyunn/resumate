# S1 백엔드 QA 리포트 (라운드 2 — 최종)

라운드 1: DB 모듈 → API 모듈 순으로 점검(아래 각 절). 라운드 2: 두 담당자의 수정 완료 후 QA-01~10 재확인과 회귀 점검, 전체 검사 재실행.

## 최종 판정
**S1 done 가능.** 라운드 1에서 나온 10건(모두 Minor, Critical·Major 0)이 라운드 2에서 전부 해결 확인됐고, 수정으로 생긴 회귀는 찾지 못했다. 남은 열린 이슈 없음.

출시 전 확인 사항(이슈 아님, 원격 프로젝트 작업): 이메일 템플릿 2종 복사, Auth 허용 목록(와일드카드는 팀 Vercel 도메인 범위로만), production `NEXT_PUBLIC_SITE_URL`, 레거시 JWT secret "사용 중" 여부(app_ai_writer HS256) — api-engineer 노트의 배포 체크리스트에 있음.

## 검사 실행 결과 (라운드 2, `run-checks.sh --build`, 로컬 스택 실행 중)
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | |
| lint | 통과 | 경고 0 |
| vitest | 통과 | 15 파일, 147 테스트(로컬 스택 통합 테스트 포함 — ai-writer, consent, magic link) |
| build | 통과 | Proxy 인식, `/auth/callback` 동적 |
| pgTAP | 통과 | 5 파일, 80 테스트(`grants.test.sql` 신규) |
| 생성 타입 최신 여부 | 통과 | 라운드 1에서 재생성 결과와 동일 확인. 라운드 2 마이그레이션은 함수·트리거·기본 권한만 바꿔 타입 영향 없음 |
| `next start` 스모크 (공개 env만) | 통과 | `/` 200, `/career`·`/career?x=1` → `/login?next=…` 307, `/auth/callback`(빈 요청, 잘못된 token_hash + `next=//evil.com`, `error=access_denied`) → `/login?error=auth_callback` 307 |

### 라운드 1 실행 기록
| 검사 | 결과 | 비고 |
|------|------|------|
| pgTAP (DB 모듈 점검 시) | 통과 | Files=4, Tests=59 |
| `run-checks.sh --build` (API 모듈 점검 시) | 통과 | Vitest 12 파일 123, pgTAP 59 |

## 이슈 상태 요약
| ID | 심각도 | 담당 | 내용 | 상태 |
|----|--------|------|------|------|
| QA-01 | Minor | db-engineer | 철회 시각 조작 가능 | 해결 |
| QA-02 | Minor | db-engineer | 직접 insert로 RPC 규칙 우회 | 해결 |
| QA-03 | Minor | db-engineer | pgTAP 빈칸 | 해결 |
| QA-04 | Minor | db-engineer | 기본 권한으로 새 객체가 anon에 열림 | 해결 |
| QA-05 | Minor | api-engineer | 다른 기기에서 매직 링크 실패 | 해결 |
| QA-06 | Minor | api-engineer | proxy가 전체 서버 env 요구 | 해결 |
| QA-07 | Minor | api-engineer | 모든 예외를 로그인 리다이렉트로 처리 | 해결 |
| QA-08 | Minor | api-engineer | `server-only` 가드 없음 | 해결 |
| QA-09 | Minor | api-engineer | `policy_version_not_current` 매핑 없음 | 해결 |
| QA-10 | Minor | api-engineer | production에서 Host 헤더 origin 사용 | 해결 |

## DB 모듈

### 확인한 항목 (카탈로그 조회와 롤백 트랜잭션 안에서의 실제 시도로 확인)
| 항목 | 결과 | 근거 |
|------|------|------|
| 테이블을 만드는 마이그레이션에서 바로 RLS 활성화 | 통과 | `..._s1_profiles.sql:20`, `..._s1_policy_versions.sql:18`, `..._s1_consents.sql:24` |
| CHECK 목록 ↔ A.2 (Q1) | 통과 | `consent_type` 5종(`..._s1_consents.sql:15-17`), `policy_type` 3종(`..._s1_policy_versions.sql:13-14`)이 A.2와 같음. A.1 길이·범위 CHECK(`..._s1_profiles.sql:14-17`)도 같음 |
| DM-1 cascade | 통과 | `profiles.id`, `consents.user_id` 모두 `auth.users on delete cascade`. pgTAP `common_functions.test.sql:33-37` |
| 테이블 grant 최소화 | 통과 | `information_schema` 조회: anon = `policy_versions` select만. authenticated = profiles select + 4개 컬럼 update, consents select + 5개 컬럼 insert + `withdrawn_at` update, policy_versions select. Supabase 기본 grant(anon/authenticated 전체 권한)는 세 테이블 모두 회수됨 |
| app_ai_writer 한계 (DM-13, A.1) | 통과 | 컬럼 grant는 profiles의 `id, desired_job_title, total_years_of_experience, interested_industries, career_data_updated_at`뿐. `display_name` select, profiles update, consents select/insert, policy_versions select, 두 RPC execute 모두 `permission denied`(직접 시도로 확인). 역할 속성 `nologin noinherit nobypassrls`, 멤버는 `authenticator`(와 생성자 postgres)뿐 |
| 가입 트리거 안전성 | 통과 | `private.handle_new_user()` security definer + `search_path = ''`, 스키마 한정 이름 사용, `revoke all from public`(`..._s1_profiles.sql:52-65`). GoTrue가 쓰는 `supabase_auth_admin` 역할로 `auth.users`에 insert해서 profiles 행이 생기는 것을 직접 확인(pgTAP은 postgres로만 확인함 → QA-03) |
| security definer 함수 전체 | 통과 | `pg_proc` 조회: definer 3개(`current_uid`, `handle_new_user`, `touch_career_data_updated_at`) 모두 `search_path=""`. 9개 함수 모두 `search_path` 고정 |
| RPC 보안·execute grant | 통과 | `get_consent_status`, `record_consents` 둘 다 security invoker, execute는 postgres·authenticated·service_role만(`..._s1_consent_rpcs.sql:154-157`). anon 호출 시 `permission denied` 확인. `private` 스키마는 PostgREST 노출 목록(`config.toml` `[api].schemas`)에 없음 |
| 재동의 로직 | 통과(가정 범위 안에서) | `..._s1_consent_rpcs.sql:53-68`. 동의 버전 이후 ~ 현재 시행 버전 사이에 `requires_reconsent`가 하나라도 있으면 true. 버전 건너뛰기 포함. pgTAP `consents.test.sql:81-96`. 기준 자체는 spec-gaps.md(2026-10-24 재동의 판단)에 이미 `[가정]`으로 올라가 있음 |
| `record_consents` 원자성 | 통과 | 오류 시 전체 롤백 — pgTAP `consents.test.sql:45` |
| 교차 사용자 격리 (Q10) | 통과(테스트 일부 빈칸 → QA-03) | pgTAP: profiles A/B select·update(`profiles.test.sql:27-36, 66-68`), consents B select(`consents.test.sql:98-100`), A가 B 명의 insert 거부(`:77-79`). 직접 확인: B가 A의 선택 동의 철회 시도 → 0행, B가 A의 profile update → 0행, B의 `get_consent_status`는 B 기준(필수 3종 needs_consent) |

### 경계면 검사 (DB 모듈 해당분)
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | 데이터 모델 ↔ 마이그레이션 | 통과 | — |
| Q2 | 마이그레이션 ↔ 생성 타입 | 통과 (쿼리 쪽은 다음 라운드) | — |
| Q3 | RPC 시그니처 ↔ 호출부 | 다음 라운드 | 아래 "API 라운드로 넘길 확인 사항" |
| Q4 | RPC raise 코드 ↔ 앱 오류 매핑 | 다음 라운드 | 〃 |
| Q8 | enum DB ↔ TS | 다음 라운드 (`src/lib/contracts/enums.ts` 작업 중) | — |
| Q10 | 보안 (RLS·app_ai_writer·definer) | 통과, 단 Minor 3건 | QA-01, QA-02, QA-03 |

### 이슈

#### QA-01 [Minor] 선택 동의 철회 시 `withdrawn_at`에 임의 시각을 넣을 수 있음
- 담당: db-engineer
- 근거: `supabase/migrations/20261024000500_s1_consents.sql:103-115`(정책은 `withdrawn_at is not null`만 확인), `:121`(`withdrawn_at` update grant). 롤백 트랜잭션에서 `update public.consents set withdrawn_at = '1990-01-01' where consent_type = 'marketing'` → 성공, `agreed_at`(2026-10-24)보다 이른 철회 시각이 저장됨. insert 쪽은 트리거가 시각을 서버 값으로 강제하는데(`:82-83`) update 쪽은 그렇지 않다.
- 영향: 동의·철회 기록은 개인정보 처리 근거(NFR-PRV-02)라 시각을 사용자가 조작할 수 있으면 안 된다. 다른 사용자 데이터나 게이트 판단에는 영향 없음.
- 수정 제안: `before update` 트리거로 `new.withdrawn_at := clock_timestamp()`를 강제(클라이언트는 아무 non-null 값이나 보내면 됨). pgTAP에 "과거 시각을 보내도 서버 시각으로 저장" 1건 추가.
- 상태: 해결(확인 완료) — `20261024000700_s1_consents_guard_hardening.sql:43-60` before update 트리거가 `withdrawn_at`을 `clock_timestamp()`로 바꾼다. 직접 시도: 1990년 값을 보내도 `withdrawn_at > agreed_at`. pgTAP `consents.test.sql` "client-supplied withdrawn_at is replaced by server time"

#### QA-02 [Minor] 직접 insert로 `record_consents`의 규칙을 우회할 수 있음 (시행 전 버전 동의, 필수 동의 거절 행)
- 담당: db-engineer
- 근거: insert 가드 `supabase/migrations/20261024000500_s1_consents.sql:73-80`는 "그 정책 유형에 존재하는 버전"인지만 본다. 정책 `:99-101`은 본인 여부만 본다. 롤백 트랜잭션에서 확인:
  1. `effective_at = now() + 30일`, `requires_reconsent = true`인 terms `2027-01-01` 버전을 넣고, 사용자가 `insert into consents (consent_type, policy_version, agreed) values ('terms', '2027-01-01', true)` → 성공. `get_consent_status()`: `current_version = 2026-10-01`, `agreed_version = 2027-01-01`, `needs_consent = false`. 이 버전이 시행된 뒤에도 `:57-67`의 비교 기준이 "동의 버전의 effective_at 이후"라서 재동의를 묻지 않는다 — 시행 전, 화면에 보여준 적 없는 문서에 "동의"한 것으로 남는다.
  2. `insert ... ('privacy_required', '2026-10-01', false)` → 성공, 해당 유형이 다시 needs_consent = true. A.2는 필수 동의의 철회를 허용하지 않는데, 직접 insert로 사실상 "거절" 기록을 만들 수 있다(RPC는 `:131-134`에서 막음).
- 영향: 본인 데이터에만 영향, 일반 앱 경로(RPC)에서는 생기지 않는다. 다만 RPC가 "서버가 현재 버전을 채운다, 필수는 agreed=true만"이라고 보장하는 규칙을 PostgREST 직접 insert가 우회한다.
- 수정 제안: (권장) authenticated의 consents insert grant·정책을 없애고 `record_consents`만 쓰는 경로로 좁힌다 — 이 경우 RPC를 security definer + `auth.uid()` 고정으로 바꾸거나, 트리거에서 아래 두 조건을 강제. (대안) insert 트리거에 ① `new.policy_version = private.current_policy_version(...)`(시행 중 최신 버전만), ② 필수 3종은 `agreed = true`만 허용을 추가. 어느 쪽이든 pgTAP에 두 경우를 추가.
- 상태: 해결(확인 완료) — `..._000700...sql:24-32` insert 가드가 시행 중 최신 버전만 허용(`policy_version_not_current`)하고 필수 유형은 `agreed = true`만 허용(`required_consent_missing`). 직접 시도: 시행 전 버전 동의·필수 거절 insert 모두 거부, 선택 동의 거절 insert와 `record_consents` 정상 경로·철회 뒤 재동의는 그대로 동작. pgTAP `consents.test.sql:81-95`

#### QA-03 [Minor] pgTAP 빈칸 — 실제 가입 경로, B의 철회 시도, RPC execute 거부
- 담당: db-engineer
- 근거: 아래는 이번 QA에서 직접 확인했지만(모두 기대대로 동작) 회귀 테스트가 없다.
  - 가입 트리거를 GoTrue 역할(`supabase_auth_admin`)로 실행: `profiles.test.sql:8-14`, `common_functions.test.sql:6-7`은 postgres로만 insert. 트리거 함수가 `private` 스키마에 있어서 권한 회귀가 생기면 실제 가입만 깨진다.
  - B가 A의 선택 동의를 철회(update) 시도 → 0행: `consents.test.sql:98-100`은 select 격리만 본다.
  - anon / app_ai_writer의 `get_consent_status`·`record_consents` execute 거부, app_ai_writer의 consents insert 거부: `consents.test.sql:102-106`은 app_ai_writer select만 본다.
- 수정 제안: 위 세 경우를 pgTAP에 추가. 가입 경로는 `set local role supabase_auth_admin`이 postgres로는 안 되므로(`permission denied to set role`), `supabase_auth_admin`의 `auth.users` insert 권한을 가정하는 대신 `has_function_privilege`/트리거 존재·`prosecdef`·`proconfig` 단언으로 대체하거나, 테스트를 supabase_admin 연결로 돌리는 방법 중 하나를 노트에 적어 둔다.
- 상태: 해결(확인 완료) — 가입 트리거는 `trigger_is`·`prosecdef`·`proconfig`·소유자 단언으로 대체(`profiles.test.sql:70-79`, 방법은 db 노트에 기록). B의 철회 시도, anon·app_ai_writer RPC execute 거부, app_ai_writer consents insert 거부 추가(`consents.test.sql`). `supabase_auth_admin`으로 실제 insert해 profiles 생성되는 것을 이번에도 직접 확인

#### QA-04 [Minor] S2부터의 위험: Supabase 기본 권한이 새 테이블·함수를 anon/authenticated에 전부 연다
- 담당: db-engineer
- 근거: `pg_default_acl`: `postgres`/`supabase_admin` 소유의 public 스키마 새 테이블(r)은 anon·authenticated에 `arwdDxtm`, 함수(f)는 execute가 기본으로 붙는다. S1은 테이블마다 `revoke all ... from anon, authenticated`(`..._s1_profiles.sql:42`, `..._s1_policy_versions.sql:31`, `..._s1_consents.sql:117`)와 RPC `revoke ... from public, anon`(`..._s1_consent_rpcs.sql:154-155`)으로 막았다. S2에서 테이블 10개 이상이 늘면 한 곳만 빠져도 anon에 열린다(RLS가 막아 주지만 grant 최소화 원칙이 깨지고, security definer RPC면 바로 노출).
- 수정 제안: 전역 가드 pgTAP 1개 추가 — "public 스키마에서 anon이 가진 테이블 권한은 `policy_versions` select뿐", "public 함수 중 anon execute 가능한 것은 허용 목록뿐". 또는 S1에 `alter default privileges ... revoke` 마이그레이션 추가(이 경우 기존 grant 흐름에 영향 없는지 확인).
- 상태: 해결(확인 완료) — `20261024000800_s1_default_privileges.sql`: postgres 소유 public 객체의 anon/authenticated 기본 권한과 함수 PUBLIC execute 기본값 회수. 전역 가드 `supabase/tests/grants.test.sql`(5건). 회귀 확인: S1 함수 10개 ACL이 의도대로이고(RLS·트리거·RPC가 쓰는 헬퍼는 authenticated 명시 grant 유지), pgTAP·통합 테스트 모두 PASS. S2부터는 새 RPC·RLS 헬퍼마다 `grant execute`를 명시해야 한다(마이그레이션 주석에 있음)

### API 라운드로 넘길 확인 사항 (이슈 아님)
- `get_consent_status`·`record_consents`의 `current_version`, `agreed_version`은 생성 타입에서 `string`이지만 실제로는 null 가능(RETURNS TABLE). 호출부가 `string | null`로 다루는지 확인(Q3).
- `record_consents` 오류 코드 7종(`not_authenticated`, `invalid_consent_items`, `invalid_consent_type`, `duplicate_consent_type`, `policy_version_missing`, `required_consent_missing`, 트리거의 `unknown_policy_version`)과, `user_agent_hash` 128자 초과 시 `23514`가 앱 오류 매핑에 있는지 확인(Q4).
- ai-writer 클라이언트가 profiles를 `select *`가 아니라 허용 5개 컬럼으로 조회하는지 확인(`select *`는 403).

## API 모듈

대상 파일: `src/proxy.ts`, `src/app/auth/callback/route.ts`, `src/server/{auth,actions,db,services}/**`, `src/server/env.ts`, `src/lib/contracts/**`, `.env.example`. `02_api-engineer_notes.md`와 `01_plan.md`를 대조했다.

### 확인한 항목
| 항목 | 결과 | 근거 |
|------|------|------|
| Q8 enum ↔ DB CHECK | 통과 | `src/lib/contracts/enums.ts:9-15` `CONSENT_TYPES` 5종 = `..._s1_consents.sql:15-17`. `POLICY_TYPES` 3종(`:25`) = `..._s1_policy_versions.sql:13-14`. 필수 3종 / 선택 2종 = `get_consent_status`의 `required`(`..._s1_consent_rpcs.sql:24-31`) 및 `consents_withdrawn_at_check` |
| Q3 RPC 인자·반환 | 통과 | `record_consents` 인자 `items`(snake_case `consent_type`, `agreed`), `user_agent_hash`(선택)가 생성 타입·SQL과 같음(`services/consent/index.ts:66-69`). 반환 5컬럼 매핑 `:26-42`. 버전은 보내지 않음 |
| nullable 버전 (DB 라운드 후속) | 통과 | `ConsentStatusRow.current_version/agreed_version: string \| null`(`services/consent/index.ts:17-18`), 계약 `ConsentStatusItem`도 `string \| null`(`contracts/consent.ts:11-13`) |
| Q4 raise 코드 ↔ 오류 매핑 (DB 라운드 후속) | 통과, 단 새 코드 1건 누락 → QA-09 | `src/server/db/errors.ts:12-21`에 `record_consents`의 6개 + `unknown_policy_version` + `42501 not_authenticated`(`:33`). `23514`(user_agent_hash 길이 등)·`22001`·`22P02`·`23502` → `invalid_input`(`:36-38`). 목록 밖 코드는 `internal_error`로 DB 원문을 숨김 |
| ai-writer 컬럼 목록 (DB 라운드 후속) | 통과 | S1에는 ai-writer로 조회하는 운영 코드가 없다. `ai-writer.ts:16-17` 주석으로 `select *` 금지 명시, 통합 테스트 `ai-writer.integration.test.ts`가 허용 컬럼 200 / `display_name`·`select *` 42501을 확인(이번 실행에서 PASS). S2부터 Career Context Pack 쿼리에서 다시 본다 |
| app_ai_writer 토큰 | 통과 | `ai-writer.ts:41-61`: HS256, `role=app_ai_writer`, `sub`는 uuid 검사, TTL 300초 상한, `accessToken` 콜백으로 요청마다 재서명. 서비스 롤 키는 운영 코드에 없음(`src/test/local-supabase.ts` 테스트 전용) |
| getUser vs getSession | 통과 | `requireUser()`는 `auth.getUser()`(`session.ts:15-20`). proxy는 `getClaims()`(`proxy-session.ts:36`, 서명 검증 포함 — 인가가 아닌 낙관적 리다이렉트로만 사용). `getSession()` 사용 없음(grep) |
| `next` 오픈 리다이렉트 | 통과 | `safeNextPath`(`contracts/routes.ts:42-56`): 절대 URL, `//host`, `/\host`, 모든 역슬래시·제어문자, 512자 초과, `/login`·`/auth/callback` 거부, 고정 origin으로 파싱 후 origin 비교. 사용처 4곳 모두 통과시킴: 콜백(`services/auth/index.ts:99`), 매직 링크·OAuth `redirectTo`(`:13-17`), 동의 제출 `redirectTo`(`actions/consent.ts:29`). proxy는 요청 자신의 경로만 `next`로 넣는다(`proxy-session.ts:42`). 콜백은 항상 같은 출처 상대 경로를 반환하고 `new URL(target, origin)`으로 조립(`route.ts:21`). 단위 테스트 `routes.test.ts` 존재 |
| 동의 게이트 | 통과 | 콜백: 교환 성공 후 필수 미동의 → `/onboarding/consent?next=`, RPC 실패도 동의 화면으로(fail closed, `services/auth/index.ts:112-119`). 프로필 액션은 `requireConsentedUser()`(403 `consent_required`). 동의 조회·제출·철회는 `requireUser()`만(동의 전에도 호출 가능해야 하므로 맞음). 페이지용 `requireConsentedUserOrRedirect()` 제공. 게이트 판단은 `rows.some(required && needs_consent)`로 DB 노트와 같음 |
| 로그·비밀값 | 통과 | `src/server`, `src/lib`, `src/app/auth`, `src/proxy.ts`에 `console.*`·logger 호출 없음. `env.ts`는 검증 오류에 키 이름만 남김(`:50-56`). `.env.example`은 더미 값뿐, `.gitignore`가 `.env*`(예시 제외)를 막음, 추적되는 env 파일 없음 |
| Cache Components | 통과 | `pnpm build` PASS. 쿠키·헤더 접근은 요청 시점 코드(Server Action, Route Handler, proxy)에만 있고 `'use cache'` 사용 없음. 페이지용 헬퍼는 Suspense 경계 안에서 호출하라는 주석·노트가 있음(연결 단계에서 UI 빌드로 재확인) |
| 계획 ↔ 구현 | 통과 | 차이 3건 모두 노트에 기록됨: 오류 코드 소문자(`unauthenticated`), `withdrawConsent` 추가(S-24), 재동의 시 필요한 필수 유형만 제출 허용(DB 구현과 일치, `contracts/consent.ts:40-46`) |
| Q5 계약 ↔ 화면 | 해당 없음 | UI 화면 미구현(연결 대기). `/login`, `/onboarding/consent` 경로명은 `[가정]`으로 `routes.ts` 한 곳에 모여 있음 |

### 이슈

#### QA-05 [Minor] 매직 링크를 다른 기기·브라우저에서 열면 로그인 실패 (PKCE 코드 검증값 쿠키 없음)
- 담당: api-engineer
- 근거: `@supabase/ssr` 클라이언트는 PKCE 흐름이라 `signInWithOtp`(`src/server/services/auth/index.ts:42-45`)가 code verifier를 **요청한 브라우저의 쿠키**에 저장한다. 메일의 기본 링크(`{{ .ConfirmationURL }}`)는 `?code=`로 돌아오고, 콜백은 `exchangeCodeForSession`(`:102-104`)이 verifier를 못 찾으면 `/login?error=auth_callback`. 콜백은 `token_hash` 경로(`:105-107`)를 이미 지원하지만 `supabase/config.toml`에 매직 링크 이메일 템플릿 설정(`[auth.email.template.magic_link]`)이 없어 쓰이지 않는다.
- 영향: PC에서 요청하고 휴대폰 메일 앱에서 여는 흔한 경우에 F-COM-01 로그인이 실패한다.
- 수정 제안: 매직 링크(및 signup 확인) 템플릿을 `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=...` 형태로 바꾸고(`config.toml` + 템플릿 파일, 원격 프로젝트는 출시 전 같은 설정), 콜백 단위 테스트에 token_hash 성공 경로가 있는지 확인. `next` 전달 방식은 `{{ .RedirectTo }}`를 쓰는 방법 등으로 정한다.
- 상태: 해결(확인 완료) — `supabase/templates/magic_link.html`, `confirmation.html`이 `{{ .RedirectTo }}&token_hash=…&type=email` 링크를 쓰고 `config.toml:258-265`에 연결. 통합 테스트 `magic-link.integration.test.ts`가 Mailpit 메일의 링크를 verifier 없는 다른 클라이언트로 완료(→ `/onboarding/consent?next=%2Fboard`)하며 이번 실행에서 PASS. 참고: 링크는 `RedirectTo`에 `?next=`가 있다는 전제(`buildCallbackUrl`이 항상 붙임)라, 허용 목록 밖 redirect로 GoTrue가 Site URL로 대체하면 링크가 깨진다 — 실패 방향(로그인 오류)이라 이슈로 두지 않고 배포 체크리스트(허용 목록) 항목으로 충분

#### QA-06 [Minor] proxy가 전체 서버 env를 요구 — AI·크론 키 하나만 빠져도 모든 페이지 요청이 실패
- 담당: api-engineer
- 근거: `src/server/auth/proxy-session.ts:17` `getServerEnv()`는 `ANTHROPIC_API_KEY`, `CRON_SECRET`, `SUPABASE_JWT_SECRET`까지 검증(`src/server/env.ts:10-22`)한다. proxy는 정적 자산을 뺀 모든 요청에서 돈다(`src/proxy.ts:9-13`). 사용자 세션 클라이언트(`src/server/db/server.ts:17`)도 같다.
- 영향: Preview 환경에서 `ANTHROPIC_API_KEY`가 없으면 로그인 화면까지 전부 500이 된다. 세션 갱신에 필요 없는 비밀값이 모든 요청 경로에 묶인다.
- 수정 제안: Supabase 공개 값(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`)만 검증하는 `getPublicSupabaseEnv()`를 두고 proxy·세션 클라이언트·site-url은 그것을 쓴다. AI·크론·ai-writer만 전체 env를 쓴다.
- 상태: 해결(확인 완료) — `env.ts:15-33` `PublicEnvSchema`/`getPublicEnv()` 분리, proxy(`proxy-session.ts:17`)·세션 클라이언트(`db/server.ts:18`)·site-url이 공개 env만 사용, ai-writer만 `getServerEnv()`. `next start` 스모크를 공개 env 3개만 주고 실행: `/` 200, `/career` → `/login?next=%2Fcareer` 307

#### QA-07 [Minor] `requireConsentedUserOrRedirect()`가 모든 예외를 "미로그인"으로 처리
- 담당: api-engineer
- 근거: `src/server/auth/session.ts:43-47` `catch {}`가 `requireUser()`의 모든 오류(env 누락, Supabase 클라이언트 생성 실패 등)를 잡아 `/login?next=`로 보낸다.
- 영향: 장애가 로그인 반복으로 보이고 오류 경계·관측에 잡히지 않는다(보안 문제는 아님 — fail closed).
- 수정 제안: `isAppError(e) && e.code === 'unauthenticated'`일 때만 리다이렉트하고 나머지는 다시 던진다.
- 상태: 해결(확인 완료) — `session.ts:46-50` `unauthenticated`만 리다이렉트, 나머지는 다시 던짐. `session.test.ts` 추가

#### QA-08 [Minor] 서버 전용 모듈에 `server-only` 가드 없음
- 담당: api-engineer
- 근거: `src/server/db/ai-writer.ts`(JWT secret으로 서명), `src/server/env.ts`, `src/server/db/server.ts`에 `import "server-only"`가 없다(grep 결과 프로젝트 전체에 없음).
- 영향: 지금은 비공개 env가 클라이언트 번들에 인라인되지 않아 누출은 없다. 다만 UI 연결 단계에서 클라이언트 컴포넌트가 실수로 import해도 빌드가 막지 않고 런타임 오류로만 드러난다.
- 수정 제안: `server-only` 패키지를 추가하고 위 세 파일과 `src/server/services/**`의 진입점(또는 최소한 ai-writer·env)에 `import "server-only"`. Vitest에서는 alias로 빈 모듈 처리.
- 상태: 해결(확인 완료) — `server-only`가 `env.ts`, `db/server.ts`, `db/ai-writer.ts`, `auth/session.ts`, `auth/site-url.ts`에 있음, Vitest는 `vitest.config.mts:8-9` alias. 회귀 확인: proxy가 `server-only`를 가진 `env.ts`를 import하지만 `pnpm build`와 `next start` 스모크에서 proxy 정상 동작

#### QA-09 [Minor] 새 raise 코드 `policy_version_not_current` 매핑 없음
- 담당: api-engineer
- 근거: db-engineer가 QA-02 대응으로 추가한 `supabase/migrations/20261024000700_s1_consents_guard_hardening.sql:26` `message = 'policy_version_not_current'`가 `src/server/db/errors.ts:12-21` `RAISE_MESSAGES`에 없어 `internal_error`(500)로 나간다. 같은 파일 `:31`의 `required_consent_missing`은 매핑돼 있다.
- 영향: 앱 경로(`record_consents`)는 서버가 현재 버전을 채우므로 정상적으로는 나오지 않는다. Q4 원칙(SQL의 모든 raise 코드에 매핑)상 누락.
- 수정 제안: `policy_version_not_current`를 `unknown_policy_version`과 같은 메시지·503(또는 409)으로 추가하고 `errors.test.ts`에 1건.
- 상태: 해결(확인 완료) — `errors.ts:21-22` `unknown_policy_version`·`policy_version_not_current` → 409, `errors.test.ts:8-9`. SQL의 raise 코드 전체(`..._000600`, `..._000700`)가 매핑에 있음

#### QA-10 [Minor] `NEXT_PUBLIC_SITE_URL` 미설정 시 인증 리다이렉트 origin을 `x-forwarded-host`에서 가져옴
- 담당: api-engineer
- 근거: `src/server/auth/site-url.ts:9-17`. 요청 헤더로 `emailRedirectTo`/`redirectTo`의 origin을 정한다. 최종 방어는 Supabase Auth 허용 목록(`supabase/config.toml:164-169`, 로컬은 정확한 URL만 — 문제 없음).
- 영향: 원격 프로젝트에서 Vercel Preview용으로 허용 목록에 와일드카드를 넣으면, 위조된 Host로 만든 매직 링크가 다른 허용 도메인으로 향할 수 있다.
- 수정 제안: production에서는 `NEXT_PUBLIC_SITE_URL`을 필수로(`env.ts`에서 `VERCEL_ENV === 'production'`이면 required) 하고, 헤더 기반 origin은 Preview·로컬에서만 쓴다. 원격 허용 목록 와일드카드 범위는 배포 체크리스트에 남긴다.
- 상태: 해결(확인 완료) — `site-url.ts:31-46` `resolveSiteOrigin`: 설정값 우선, production(Vercel production 또는 VERCEL_ENV 없는 NODE_ENV=production)에서 미설정이면 실패, 개발·Preview만 헤더 사용. `site-url.test.ts` 추가. 원격 허용 목록 와일드카드 범위는 api 노트 배포 체크리스트에 기록됨

### 경계면 검사 (API 모듈 해당분)
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q2 | 쿼리 ↔ 생성 타입 | 통과 (`profiles` select/update 컬럼, RPC 이름 모두 존재) | — |
| Q3 | RPC 시그니처 ↔ 호출부 | 통과 | — |
| Q4 | raise 코드 ↔ 오류 매핑 | 이슈 | QA-09 |
| Q5 | 계약 ↔ 핸들러 ↔ 화면 | 해당 없음(UI 미구현) | — |
| Q6 | SSE | 해당 없음(S1) | — |
| Q8 | enum DB ↔ TS | 통과 | — |
| Q9 | 사용량 원장 | 해당 없음(S1 AI 호출 없음) | — |
| Q10 | 보안·로그 | 통과, 단 Minor | QA-05, QA-07, QA-08, QA-10 |
| Q11 | UI ↔ 백엔드 | 해당 없음(연결 대기) | — |
| — | 운영 안정성 | 이슈 | QA-06 |

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
이번 라운드에서 새로 넘긴 항목 없음. 재동의 판단 기준·초기 정책 버전·선택 동의 버전 매핑은 db-engineer가 이미 `spec-gaps.md`에 `[가정]`으로 기록했고, 구현이 그 기록과 같음을 확인했다.
