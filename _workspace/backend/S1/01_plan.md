# S1 foundation 계획

## 범위
- 기획 근거: DM §0(DM-1, DM-3, DM-13), §2.1, 부록 A.1–A.2, §5 / PRD F-COM-01(매직 링크 + 재발송, Google, D-09), F-COM-02(필수·선택 동의, 국외 이전), NFR-PRV-02·03 / UX S-02·S-03(로그인 후 S-08 또는 원래 URL, 동의 완료 후 S-08)
- 테이블: `profiles`, `consents`, `policy_versions`
- 공통: `set_updated_at()` 트리거 함수, `touch_career_data_updated_at()` 함수(커리어 7개 테이블 트리거는 S2에서 연결)
- 역할: `app_ai_writer` (nologin, authenticator에 grant), S1 단계 권한 골격
- 인증: 매직 링크(재발송), Google OAuth, `/auth/callback`, 세션 갱신 proxy, 동의 게이트
- AI 기능 없음 → ai-pipeline-engineer 호출 안 함

## 계약 초안
### DB
- `profiles`: A.1 그대로. 가입 트리거 `handle_new_user()`(security definer, `auth.users` after insert) → `profiles(id)` insert. RLS select/update 본인, insert는 트리거만, delete 없음. `career_data_updated_at`·`last_active_at`·`inactivity_notice_sent_at`은 사용자 update 불가(컬럼 grant로 `display_name`, `desired_job_title`, `total_years_of_experience`, `interested_industries`만 update).
- `policy_versions`: A.2. `policy_type` CHECK (`terms`, `privacy`, `cross_border_transfer`), unique(policy_type, version). select 전체(anon, authenticated). 쓰기 없음(마이그레이션으로만). 초기 버전 행 3개(`version = '2026-10-01'` 같은 날짜형 문자열, `document_path`는 `/policies/{type}/{version}`) [가정] — spec-gaps에 기록.
- `consents`: A.2. `consent_type` CHECK 5개, `policy_version` text not null, `agreed` boolean, `agreed_at` timestamptz default now(), `withdrawn_at`, `user_agent_hash` text. RLS select/insert 본인, update는 선택 동의(`service_improvement`, `marketing`)의 `withdrawn_at`만(컬럼 grant `withdrawn_at` + 정책 using `consent_type in (...)` 그리고 기존 `withdrawn_at is null`). delete 없음. `consents`는 근거 원본이 아니므로 `updated_at` 없음 [가정, A.2 컬럼 목록 기준].
- RPC `get_consent_status()` returns table(consent_type text, required boolean, current_version text, agreed_version text, needs_consent boolean) — security invoker. 필수 = `terms`, `privacy_required`, `cross_border_transfer`. 필요 판단: 해당 유형의 최신 policy_version(`effective_at <= now()` 중 최신)에 대해 withdrawn 안 된 agreed=true 행이 없고, `requires_reconsent`이거나 이전 동의가 아예 없을 때. consent_type ↔ policy_type 매핑: terms→terms, privacy_required→privacy, cross_border_transfer→cross_border_transfer, 선택 2종은 privacy 버전을 따른다 [가정].
- RPC `record_consents(items jsonb, user_agent_hash text)` — security invoker, 항목마다 1행 insert, 서버가 현재 버전을 채움(클라이언트 버전 신뢰 안 함). 필수 3종이 모두 agreed=true가 아니면 예외.
- `app_ai_writer`: `create role app_ai_writer nologin noinherit; grant app_ai_writer to authenticator; grant usage on schema public`. S1 권한: `profiles` select(컬럼: `id`, `desired_job_title`, `total_years_of_experience`, `interested_industries`, `career_data_updated_at` — `display_name`은 AI에 보내지 않음, A.1). 정책 `to app_ai_writer using (id = auth.uid())`. consents/policy_versions 권한 없음.
- pgTAP: RLS 교차 사용자 격리(A가 B의 profile·consents 못 봄/못 고침), 가입 트리거, 컬럼 grant(사용자가 `career_data_updated_at` 못 고침), consents update 제한(필수 동의 withdrawn 불가), `record_consents` 필수 누락 예외, `get_consent_status` 재동의 판단, app_ai_writer가 display_name 못 읽고 consents 못 읽음, anon이 policy_versions만 읽음.
- 타입: `supabase gen types typescript --local > src/server/db/database.types.ts`.

### API
- `src/server/db/server.ts`: `createSupabaseServerClient()` (@supabase/ssr, cookies). `requireUser()` → `auth.getUser()`, 없으면 `AppError('UNAUTHENTICATED')`.
- `src/server/db/ai-writer.ts`: `createAiWriterClient(userId)` — 짧은 수명(≤ 5분) JWT, `role: 'app_ai_writer'`, `sub: userId`, `aud: 'authenticated'`, 서명 키는 `SUPABASE_JWT_SECRET`(HS256). 서버 전용. 로컬 스택이 이 서명을 받아들이는지 pgTAP이 아닌 Vitest 통합 테스트(로컬 스택이 떠 있을 때만, 아니면 skip)로 확인. 현재 Supabase가 비대칭 JWT 서명 키를 기본으로 쓰면 그 방식에 맞추고 decisions에 기록.
- proxy(Next 16 `proxy.ts`): 세션 갱신 + 보호 경로(`/(dashboard)` 그룹 경로들, 일단 `/career`, `/applications`, `/interviews`, `/board`, `/settings`, `/onboarding/consent`) 미로그인 시 `/login?next=` 리다이렉트. 동의 게이트는 proxy가 아니라 서버 쪽(`requireConsentedUser()`)에서 `get_consent_status`로 확인 → 미동의면 `/onboarding/consent?next=`.
- Server Actions `src/server/actions/auth.ts`: `sendMagicLink({ email, next })`(재발송도 같은 액션, 레이트 리밋 오류는 한국어 메시지로 매핑), `signInWithGoogle({ next })` → OAuth URL 반환, `signOut()`.
- Route `src/app/auth/callback/route.ts`: code 교환 → 동의 필요 시 `/onboarding/consent?next=…`, 아니면 `next`(같은 출처 상대 경로만 허용, 기본 `/career`). 실패 시 `/login?error=auth_callback`.
- Server Actions `src/server/actions/consent.ts`: `getConsentStatus()`, `submitConsents({ items })` → `record_consents` RPC, `user_agent_hash`는 서버에서 UA를 SHA-256 해시.
- Server Action `src/server/actions/profile.ts`: `getProfile()`, `updateProfile(patch)` (S-04 필드 4개, zod로 A.1 길이·범위 검사).
- contracts: `src/lib/contracts/auth.ts`, `consent.ts`, `profile.ts`, `enums.ts`에 `CONSENT_TYPES`, `REQUIRED_CONSENT_TYPES`, `POLICY_TYPES`.
- 페이지·컴포넌트는 만들지 않는다(UI 소관). `/login`, `/onboarding/consent` 경로 이름은 UI 하네스가 정하면 맞춘다 [가정].

## 작업 순서
- db-engineer와 api-engineer 병렬. api-engineer는 생성 타입이 나오기 전에는 계약·클라이언트·proxy·콜백부터, 타입이 나오면 RPC 호출부를 연결.
- QA: 모듈별 → 전체 `run-checks.sh` + pgTAP.

## 원격 브랜치 적용: 하지 않음
## 연결(wiring): UI 화면 없음 → "연결 대기" (A1 account)
