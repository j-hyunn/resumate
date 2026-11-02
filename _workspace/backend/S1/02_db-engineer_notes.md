# S1 DB 구현 노트

## 마이그레이션 파일
| 파일 | 내용 |
|------|------|
| `supabase/migrations/20261024000100_s1_common_functions.sql` | `private` 스키마, `private.set_updated_at()`, `private.touch_career_data_updated_at()`(security definer, S2에서 커리어 7개 테이블에 연결), `private.current_uid()` |
| `supabase/migrations/20261024000200_s1_app_ai_writer_role.sql` | `app_ai_writer` (nologin noinherit, 없을 때만 생성), `grant app_ai_writer to authenticator`, public·private 스키마 usage |
| `supabase/migrations/20261024000300_s1_profiles.sql` | `profiles` + RLS + 컬럼 grant + 가입 트리거 `private.handle_new_user()` (`auth.users` after insert) |
| `supabase/migrations/20261024000400_s1_policy_versions.sql` | `policy_versions` + RLS + 초기 3행 `[가정]` |
| `supabase/migrations/20261024000500_s1_consents.sql` | `consents` + insert 가드 트리거 + RLS + 컬럼 grant, 헬퍼 `private.consent_policy_type()`, `private.current_policy_version()` |
| `supabase/migrations/20261024000600_s1_consent_rpcs.sql` | `get_consent_status()`, `record_consents()` |

생성 타입: `src/server/db/database.types.ts` (`supabase gen types typescript --local`, 포맷터 없음 — 손대지 않음). `pnpm typecheck` 통과.

## 테이블·컬럼 (스펙 대비 차이 포함)
- `profiles`: A.1 그대로. 제약 이름 `profiles_display_name_check`(≤50), `profiles_desired_job_title_check`(≤100), `profiles_total_years_of_experience_check`(0..50). `user_id` 없음(id = auth.users.id, cascade).
- `policy_versions`: A.2 + `id`, `created_at`, `updated_at`(트리거). `unique (policy_type, version)`, 인덱스 `(policy_type, effective_at desc)`. 초기 3행: 각 유형 `version = '2026-10-01'`, `effective_at = 2026-10-01 00:00 KST`, `requires_reconsent = true`, `document_path = '/policies/{type}/2026-10-01'`.
- `consents`: A.2 + `id`, `user_id`(default `auth.uid()`, cascade), `created_at`. `updated_at` 없음(append-only 기록) `[가정]`. 추가 제약:
  - `consents_withdrawn_at_check`: 선택 2종만 `withdrawn_at` 가능(DB 레벨 강제).
  - `consents_user_agent_hash_check`: ≤ 128자 (SHA-256 hex = 64자).
  - insert 트리거 `consents_before_insert`: `policy_version`이 매핑된 `policy_type`의 실제 버전이 아니면 `unknown_policy_version`; `agreed_at := clock_timestamp()`, `withdrawn_at := null` 강제(직접 insert 경로도 신뢰 가능하게).
  - 인덱스 `(user_id, consent_type, agreed_at desc)`.
- consent_type → policy_type 매핑: terms→terms, privacy_required→privacy, cross_border_transfer→cross_border_transfer, service_improvement·marketing→privacy `[가정]`.

## RPC 시그니처와 반환 형태
둘 다 `security invoker`, `public`/`anon` execute 회수, `authenticated`만 실행.

### `get_consent_status()`
```
returns table (consent_type text, required boolean, current_version text, agreed_version text, needs_consent boolean)
```
- 항상 5행, 순서 고정: terms, privacy_required, cross_border_transfer, service_improvement, marketing.
- `current_version`: 매핑된 정책의 시행 중 최신 버전(`effective_at <= now()`), 없으면 null.
- `agreed_version`: 그 유형의 사용자 최신 행(agreed_at desc)이 agreed=true이고 미철회이면 그 버전, 아니면 null.
- `needs_consent`: 선택 2종은 항상 false. 필수 3종은 agreed_version이 null이면 true, current와 같으면 false, 더 오래된 버전이면 "동의 버전 이후 ~ 현재 시행 중 버전 중 `requires_reconsent = true`가 하나라도 있으면" true.
- 게이트 판단: `rows.some(r => r.required && r.needs_consent)`.
- 주의: 생성 타입은 `current_version`, `agreed_version`을 `string`으로 표시하지만 실제로는 null 가능(gen types가 RETURNS TABLE 컬럼 nullability를 모름). 앱에서 `string | null`로 다룰 것.

### `record_consents(items jsonb, user_agent_hash text default null)`
- 생성 타입 Args: `{ items: Json; user_agent_hash?: string }`. 반환은 `get_consent_status()`와 같은 형태(기록 후 상태).
- `items`: `[{ "consent_type": "<type>", "agreed": true|false }, ...]`. 항목마다 1행 insert, 버전은 서버가 현재 버전으로 채움.
- 오류 (`errcode` / `message`):
  - `42501` / `not_authenticated`
  - `P0001` / `invalid_consent_items` — 빈 배열·배열 아님·항목이 객체 아님·`agreed`가 boolean 아님
  - `P0001` / `invalid_consent_type`
  - `P0001` / `duplicate_consent_type`
  - `P0001` / `policy_version_missing` — 시행 중 버전 없음
  - `P0001` / `required_consent_missing` — 필수 항목이 agreed=false, 또는 호출 후에도 필수 유형이 needs_consent
  - (트리거) `P0001` / `unknown_policy_version` — RPC 경로에서는 발생하지 않음
- 실패 시 트랜잭션 전체 롤백(부분 기록 없음).
- 계획과 차이: 계획은 "필수 3종 모두 agreed=true가 아니면 예외". 구현은 "보낸 필수 항목은 모두 agreed=true + 호출 후 필수 needs_consent 없음"이다. 첫 가입 때는 결과가 같고(3종 모두 필요), 재동의 때는 필요한 유형만 보내도 된다(3종을 모두 보내도 됨).

### 선택 동의 철회 (RPC 없음, 직접 update)
`update consents set withdrawn_at = now() where id = ...` — 본인 + 선택 2종 + agreed=true + 미철회 행만 대상(그 외는 RLS가 0행으로 걸러냄, 오류 아님). 다시 동의는 `record_consents`로 새 행.

## RLS·권한 요약 (DM §5, A.1–A.2 대비)
| 테이블 | authenticated | anon | app_ai_writer |
|--------|---------------|------|---------------|
| profiles | select 본인(전체 컬럼). update 본인, 컬럼 `display_name`, `desired_job_title`, `total_years_of_experience`, `interested_industries`만. insert/delete 없음(가입 트리거·cascade) | 없음 | select 본인, 컬럼 `id`, `desired_job_title`, `total_years_of_experience`, `interested_industries`, `career_data_updated_at`만 (`display_name` 불가) |
| policy_versions | select 전체 | select 전체 | 없음 |
| consents | select·insert 본인(insert 컬럼 `user_id`, `consent_type`, `policy_version`, `agreed`, `user_agent_hash`). update는 `withdrawn_at`만, 선택 동의 활성 행만. delete 없음 | 없음 | 없음 |

- Supabase 기본 테이블 grant(anon/authenticated all)는 테이블마다 `revoke all` 후 최소 grant로 교체. `service_role`은 기본 grant 유지.
- 정책 이름: `profiles_select_own`, `profiles_update_own`, `profiles_select_ai_writer`, `policy_versions_select_all`, `consents_select_own`, `consents_insert_own`, `consents_update_withdraw_optional_own`.
- **app_ai_writer와 `auth.uid()`**: `auth` 스키마 USAGE는 supabase_admin만 줄 수 있어 `app_ai_writer`가 `auth.uid()`를 못 부른다. 그래서 `private.current_uid()`(security definer, `auth.uid()` 반환만)를 만들고 `app_ai_writer` 정책은 `(select private.current_uid())`를 쓴다. S2 이후 `app_ai_writer` 정책·함수도 같은 방식.
- **app_ai_writer 컬럼 grant 주의**: `select *`는 403(`permission denied for table profiles`). ai-writer 클라이언트는 허용 컬럼을 명시해야 한다.

## JWT 확인 (api-engineer용)
- 로컬 스택(CLI 2.122): GoTrue는 사용자 세션 토큰을 **ES256(비대칭 서명 키)** 으로 서명한다(`GOTRUE_JWT_KEYS` = EC 키, 허용 방식 HS256/RS256/ES256). anon/service_role 레거시 키는 HS256.
- PostgREST의 `PGRST_JWT_SECRET`은 JWKS이며 **EC(ES256) 공개키 + oct(대칭, 레거시 JWT secret) 두 개**를 갖는다 → HS256 토큰도 검증된다.
- 실제 요청으로 확인: `supabase status`의 JWT secret으로 HS256 서명한 `{sub: <user id>, role: "app_ai_writer", aud: "authenticated", exp: +5분}` 토큰 + publishable key(apikey 헤더)로 REST 호출 →
  - `profiles?select=id,desired_job_title` 200 (해당 사용자 행만)
  - `profiles?select=display_name` 403
  - `consents?select=id` 403
  - 같은 방식의 `role: authenticated` 토큰도 200
- 결론: `createAiWriterClient(userId)`는 계획대로 `SUPABASE_JWT_SECRET` HS256 서명을 쓰면 된다. decisions.md에 기록. (비밀값은 노트·로그에 남기지 않았다.)

## 테스트 (`supabase test db` 결과)
`supabase db reset` 성공, `supabase test db` — Files=4, Tests=59, **PASS**.
- `supabase/tests/profiles.test.sql` (17): 가입 트리거, RLS 활성·정책 목록, A/B 격리, 편집 4필드 update, `career_data_updated_at`·`last_active_at` update 거부, insert/delete 거부, 길이 CHECK, anon 거부, app_ai_writer 본인 행만·`display_name` 거부·update 거부.
- `supabase/tests/policy_versions.test.sql` (7): RLS, 초기 3행, anon/authenticated 읽기, 쓰기 거부, CHECK.
- `supabase/tests/consents.test.sql` (30): RLS·정책 목록, 신규 사용자 필수 3종 needs_consent, RPC 오류 분기 6개(+롤백 확인), 정상 기록(서버 버전, 선택 거절/동의), 선택 철회 가능·필수 철회 불가·`withdrawn_at` 외 update 거부·delete 거부, 직접 insert 버전 가드·타인 user_id 거부, 재동의(requires_reconsent 버전은 true, 아닌 버전은 false, 필요한 유형만 재제출 허용), B 격리, app_ai_writer 거부.
- `supabase/tests/common_functions.test.sql` (5): `touch_career_data_updated_at`(임시 테이블), `set_updated_at`, auth.users 삭제 시 profiles·consents cascade.
- 테스트 안에서만 `grant usage on schema extensions to app_ai_writer`(pgTAP 함수 호출용, 롤백됨). 실제 스키마에는 없음.

## 원격 브랜치 적용 여부
하지 않음(계획 "원격 브랜치 적용: 하지 않음"). 로컬 전용.

## 스펙 차이·가정 (spec-gaps.md에 기록한 항목)
- (기존 항목) 초기 정책 버전 값, 선택 동의의 정책 버전 매핑 — 계획대로 구현.
- (추가) 재동의 판단: 선택 동의는 needs_consent 항상 false, 필수는 동의 버전 이후 시행 버전 중 하나라도 requires_reconsent면 재동의.
- 구현 결정(스펙 침묵): `private` 스키마에 헬퍼, `private.current_uid()`, consents insert 가드 트리거, `consents_withdrawn_at_check`, 철회 정책에 `agreed = true` 조건 추가, `user_agent_hash` ≤ 128자, `seed.sql`은 S1에서 비워 둠(테스트가 사용자를 직접 만든다).

## QA 라운드 1 반영 (2026-10-24)
새 마이그레이션 2개(기존 파일은 수정하지 않음):
- `supabase/migrations/20261024000700_s1_consents_guard_hardening.sql`
  - QA-02: `private.consents_before_insert()` 교체. 직접 insert도 ① 매핑된 정책의 **시행 중 최신 버전만**(아니면 `P0001 policy_version_not_current`, 존재하지 않는 버전은 기존대로 `unknown_policy_version`) ② 필수 3종은 `agreed = true`만(아니면 `P0001 required_consent_missing`). insert 경로(A.2 "insert 본인")는 유지하고 트리거로 RPC와 같은 규칙을 강제하는 쪽을 택함. `record_consents`는 항상 현재 버전을 쓰므로 RPC 경로에서는 새 오류가 나지 않는다.
  - QA-01: `private.consents_before_update()` + `consents_before_update` 트리거. `withdrawn_at`이 null이 아닌 값으로 바뀌면 `clock_timestamp()`로 덮어씀(클라이언트는 아무 non-null 값이나 보내면 됨).
- `supabase/migrations/20261024000800_s1_default_privileges.sql` (QA-04)
  - `postgres`가 public 스키마에 만드는 테이블·시퀀스·함수의 기본 권한에서 anon·authenticated 제거, 함수 EXECUTE to PUBLIC 기본값은 전역으로 제거(스키마 단위로는 회수 불가). service_role 기본 권한은 유지.
  - **S2부터 영향**: 새 테이블은 `revoke` 없이도 anon·authenticated 권한이 없다 → 필요한 grant를 명시해야 한다. 새 함수(public·private 모두)도 `grant execute ... to authenticated`(정책·invoker RPC가 부르는 헬퍼 포함)를 명시해야 한다. supabase_admin이 만드는 객체는 범위 밖(postgres가 바꿀 수 없음).

테스트 추가(총 5파일 80개, PASS):
- `consents.test.sql` (41): 직접 insert로 필수 거절 불가, 시행 전 버전 동의 불가, 선택 동의 현재 버전 직접 insert 가능, 과거 `withdrawn_at`이 서버 시각으로 바뀜, B가 A의 선택 동의 철회 시도 0행, app_ai_writer consents insert 거부, anon·app_ai_writer의 두 RPC execute 거부(`has_function_privilege` + anon 실제 호출 42501).
- `profiles.test.sql` (22): 가입 경로(QA-03) — 테스트에서 postgres는 `supabase_auth_admin`으로 `set role`이 안 되므로, 트리거 부착·활성, `handle_new_user`의 security definer·`search_path=""`·소유자 postgres를 단언해서 "삽입 역할과 무관하게 동작"을 보장하는 방식으로 대체.
- `grants.test.sql` (5, 신규): 전역 가드 — anon 테이블 권한은 `policy_versions:SELECT`뿐, anon 컬럼 권한 없음, anon이 실행 가능한 public 함수 없음, app_ai_writer 테이블 단위 권한 없음(컬럼 단위만), postgres 기본 권한에 anon·authenticated·PUBLIC 없음. 허용 목록은 DM §5와 함께만 갱신.

확인: `supabase db reset` OK, `supabase test db` PASS(80), 타입 재생성 결과 변경 없음(파일 그대로), `pnpm typecheck` 통과, `pnpm test` 12파일 123개 통과(consent·ai-writer 통합 테스트 포함, skip 없음).
