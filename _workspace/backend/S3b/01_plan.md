# S3b BYOK 키·동의 계획

## 범위와 근거
- 기획 근거
  - DM: DM-16, DM-17, §2.11(2.11.1~2.11.6), §5(`app_key_reader`), §6(readiness `ai_connection`), 부록 A.16
  - AI: C-10.5(키 검증), C-11(키 상태 변경)
  - PRD: F-AI-01~06, F-AI-09, NFR-KEY-01~09, NFR-PRV-03·04
  - UX: S-40 AI 연결, S-41 키 연결 단계
- 결정: B-2(KMS 어댑터 인터페이스 + 출시 전 임시 환경 변수 마스터 키). S3a 노트의 인터페이스(`ProviderContextSource`, `KeySource`, `KeyStatusReporter`)에 실제 구현을 붙인다.
- S3a에서 넘어온 것
  - QA-S3a-11: 함수 시간 예산에서 settle 대기와 단계 마감 시간을 뺀다.
  - `key_verification` 작업의 대상(target)을 정한다.
- AI 쪽 새 작업은 없다. 어댑터 `verify()`는 S3a에서 이미 만들었다. 필요하면 api가 요청한다.
- 연결: UI 화면이 없으므로 "연결 대기"(S-40, S-41, S-42, 모든 AI 진입점의 잠금 상태)로 둔다.

## 계약 — DB (새 마이그레이션 `20261029xxxxxx_s3b_*`)

1. **역할 `app_key_reader`**: `nologin noinherit`, authenticator에 grant한다. 테이블 권한은 0이다. `get_provider_key_secret` 실행 권한만 준다.

2. **`ai_provider_keys`** (2.11.1)
   - 컬럼·CHECK는 표 그대로다. `unique (user_id, provider)`와 `unique (id, user_id)`를 둔다.
   - RLS: 본인 select. insert·update는 RPC로만 한다. delete는 본인(사용자 세션, `delete_provider_key`가 security invoker이므로 필요).
   - **암호 컬럼 4개에는 authenticated, anon, app_ai_writer 누구에게도 grant를 주지 않는다.** 메타 컬럼(`id`, `provider`, `connection_tier`, `key_last4`, `status`, `last_verified_at`, `last_failure_cause`, `last_failure_at`, `created_at`, `updated_at`)만 select grant한다.
   - 뷰 `ai_provider_keys_public`: security invoker, 위 컬럼만.
   - `updated_at` 트리거.

3. **`profiles.active_ai_provider`** (2.11.4)
   - 복합 FK `(id, active_ai_provider) → ai_provider_keys(user_id, provider) on delete set null (active_ai_provider)`.
   - 사용자 직접 update grant는 주지 않는다. `set_active_ai_provider` RPC로만 바꾼다.
   - app_ai_writer select 목록에 넣을지 판단한다(작업 시작 시점의 공급자 문맥은 사용자 세션으로 읽으므로 필요 없을 수 있다).

4. **`ai_data_use_consents`** (2.11.5)
   - CHECK 그대로다. `free_tier_acknowledged` CHECK도 포함한다.
   - RLS: select·insert는 본인, update는 `withdrawn_at`만(사용자 세션), delete 없음.
   - insert 가드: `disclosure_version`이 `ai_disclosures`에 있는 현재 버전이어야 하고, `agreed_at`은 서버 시각으로 정한다(S1 `consents` 가드와 같은 방식).

5. **참조 테이블 `ai_disclosures` / `ai_providers`** (2.11.6)
   - `ai_disclosures`는 anon과 authenticated 모두 select. 시드는 공급자 3 × 등급 2의 첫 버전 `v2026-10-29`이고, `document_path`는 `/policies/ai/{provider}/{tier}/{version}`이다 `[가정 → spec-gaps]`.
   - `ai_providers`는 authenticated select. 시드는 3행이다: `display_order` gemini 1 / anthropic 2 / openai 3, `is_available = true`(UB-3: 출시 때 세 공급자 모두 열림), `is_recommended`는 gemini, `dashboard_url`·`billing_url`은 공급자 공식 콘솔 URL.

6. **RPC** (2.11.3)
   - `save_provider_key(p_provider, p_connection_tier, p_key_ciphertext, p_key_nonce, p_wrapped_dek, p_kek_id, p_key_last4, p_disclosure_version, p_verification_result)`
     - security definer + `auth.uid()` 검사.
     - 유효한 동의 행(공급자·등급·현재 고지 버전)이 없으면 `consent_required`로 거부한다.
     - insert 또는 같은 행 교체를 한다. 교체는 id를 유지해 AAD가 그대로 맞게 한다. → **AAD에 행 id를 쓰므로, 서버는 저장 전에 id를 알아야 한다.** 새 키는 서버가 id를 만들어 넘기는 `p_key_id` 인자를 추가한다 `[구현 결정]`.
     - `valid` / `limited` 규칙(R-38)을 따른다.
     - 첫 키면 `active_ai_provider`를 설정한다.
     - 등급이 바뀌면 이전 등급 동의에 `withdrawn_at`을 기록한다.
   - `record_provider_key_check(p_provider, p_result_status, p_failure_cause)`: definer, 사용자 세션. v4.1 규칙.
   - `mark_provider_key_invalid(p_ai_job_id, p_failure_cause)`: definer, app_ai_writer 전용. 암호 컬럼을 읽지 않는다.
   - `delete_provider_key(p_provider)`: security invoker. hard delete 후 해당 공급자의 현재 동의 행에 `withdrawn_at`을 기록한다.
   - `set_active_ai_provider(p_provider)`: definer + 소유 검사, 키가 있는 공급자만 허용한다.
   - `get_provider_key_secret(p_ai_job_id) returns table(key_ciphertext, key_nonce, wrapped_dek, kek_id, encryption_version, key_id)`
     - security definer, `app_key_reader` 전용.
     - 작업이 `running`이고 `heartbeat_at`이 2분 이내(상수)이며, 작업의 `user_id`·`provider`와 같은 키 행이 있을 때만 돌려준다. 그 외에는 `key_not_available`.
     - `key_id`를 같이 돌려주는 이유는 AAD 계산이다.
     - JWT의 `sub`가 작업의 `user_id`와 같아야 한다(격리).

7. **`get_data_readiness` 갱신** (§6 v4): 최상위에 `ai_connection: { active_provider, key_status, connection_tier }`를 넣는다. 활성 공급자가 없거나 `invalid`면 각 기능의 `next_action = 'form'`.

8. **탈퇴 cascade**: 키·동의 행은 `auth.users` 삭제 시 함께 지워진다(DM-1).

9. **pgTAP**
   - 암호 컬럼 grant 0(전 역할)
   - `get_provider_key_secret` 거부 경우: 다른 사용자, 다른 공급자, 끝난 작업, 오래된 heartbeat, app_key_reader가 아닌 역할
   - app_key_reader는 그 밖에 아무것도 못 한다
   - RPC 분기 전부, 동의 가드, FK set null, readiness `ai_connection`
   - grants 허용 목록 갱신, 첫 호출 권한

## 계약 — API

1. **`src/server/keys/`**
   - `envelope.ts`: AES-256-GCM. DEK는 무작위 32바이트, nonce는 12바이트. AAD = `${userId}|${provider}|${keyId}`(UTF-8). 사용한 원문과 DEK 버퍼는 즉시 0으로 채운다.
   - `kms.ts`: 인터페이스 `wrap(dek) → { wrappedDek, kekId }`, `unwrap(wrappedDek, kekId) → dek`.
     - 구현은 `EnvKms`다. env `AI_KEY_KEK_BASE64`(32바이트)와 `AI_KEY_KEK_ID`(예: `env-v1`)를 쓰고, KEK로 DEK를 AES-256-GCM으로 감싼다. `kek_id`가 다르면 거부한다.
     - B-2의 출시 전 임시안이다. 출시 전 KMS로 바꿔야 한다는 경고를 코드 주석과 노트에 남긴다.
   - `key-reader.ts` 클라이언트(`src/server/db/`): `app_key_reader` 단명 JWT. 이 클라이언트로는 RPC 하나만 부른다.

2. **실제 인터페이스 구현** (S3a의 `connections()`)
   - `ProviderContextSource.forUser`: 사용자 세션에서 `profiles.active_ai_provider`와 키 메타를 읽는다. 동의가 현재 고지 버전인지도 확인한다. 재동의가 필요하면 작업 시작을 409 `ai_consent_required`로 거부한다.
   - `KeySource.forJob(jobId)`: app_key_reader로 `get_provider_key_secret`을 부르고 → unwrap → decrypt해 원문을 넘긴다. 행이 없으면 `ProviderError('key_missing')`.
   - `KeyStatusReporter.markInvalid`: app_ai_writer로 `mark_provider_key_invalid`를 부른다.
   - 작업이 성공하면 `needs_check` 키를 `valid`로 되돌린다(DM 2.11.3 "다음 성공 실행 시"). 방법은 사용자 세션 RPC가 아니라 app_ai_writer 경로가 필요하므로, db에 요청할지 `mark_provider_key_invalid`를 일반화할지 db와 합의한다.
   - 개발용 env 구현(`AI_DEV_*`)은 로컬 전용으로 남긴다.

3. **키 등록·교체** `registerProviderKey({ provider, connectionTier, apiKey, disclosureVersion })` (Server Action)
   1. 형식 검사(공급자별 접두어와 길이, 느슨하게)와 동의 확인.
   2. `ai_jobs`(`key_verification`)를 만든다. 대상은 `target_type = 'ai_provider'`, `target_id = uuidv5(공급자)`라서 사용자·공급자당 진행 중 1개다.
   3. 어댑터 `verify()`를 **동기로** 실행한다(목표 5초, 무료 10초). 재시도는 없다. 호출마다 `ai_usage_records`(`feature = key_verification`)를 남긴다.
   4. `valid` / `limited`면 암호화 후 `save_provider_key`를 부른다. 그 외 원인이면 저장하지 않고 원인을 돌려준다. 교체 실패 시 기존 키를 그대로 둔다.
   5. 작업 행을 종료 상태로 둔다.
   6. 응답은 `{ status, failureCause?, quotaResetsAt?, keyLast4 }`다. **키 원문은 어떤 응답·로그·오류에도 넣지 않는다.**
4. **다시 확인** `recheckProviderKey({ provider })`: 저장된 키로 같은 검증을 한다. 키는 `KeySource` 경로로 받으므로 작업이 running이어야 한다. 결과는 `record_provider_key_check`로 기록한다.
5. **기타 액션**
   - `deleteProviderKey`, `setActiveAiProvider`
   - `getAiConnection()`: 공급자 목록(`ai_providers`), 키 메타, 활성 공급자, 각 공급자의 현재 고지 버전과 동의 상태
   - `getAiDisclosure({ provider, tier })`
   - `recordAiDataUseConsent({ provider, tier, disclosureVersion, freeTierAcknowledged })`
   - `withdrawAiDataUseConsent`
6. **readiness 계약**: `src/lib/contracts`의 readiness 타입에 `ai_connection`을 넣는다.
7. **QA-S3a-11**: `INVOCATION_BUDGET_MS`를 다음 단계 시작 판단에 쓸 때, 단계 마감 시간과 settle 최악 대기(5초)를 함께 고려한다. 예: 시작 가능 조건 = 경과 + 단계 마감 + 5초 ≤ 58초.
8. **env·문서**: `.env.example`에 `AI_KEY_KEK_BASE64`, `AI_KEY_KEK_ID`(더미)를 넣는다. 배포 체크리스트에 KMS 전환을 추가한다.
9. **테스트**
   - 암호화 왕복, AAD 변조·키 행 바꿔치기·다른 KEK id 실패
   - 키가 응답·로그·오류·작업 행·`step_outputs`에 없음(키 문자열과 끝 4자리 외 부분 검색)
   - 검증 결과별 저장 여부(R-38 표 전체)
   - 교체 실패 시 기존 키 유지
   - 로컬 스택 통합: 등록 → AI 작업 실행 시 `get_provider_key_secret` → 복호화(가짜 어댑터) → 키 삭제 후 `key_missing`

## 진행
- db와 api 병렬. api는 `src/server/keys/`와 계약부터 시작하고, 타입이 나오면 RPC에 연결한다.
- 에이전트 정의가 main 체크아웃의 옛 버전이므로 **이 워크트리의 하네스 파일을 읽으라고 지시한다.**
- QA 중점: Q10 키 격리·마스킹(Critical 기준), Q9 키 관련 종료 경로(`key_invalid`, `key_missing`).

## 원격 브랜치 적용: 하지 않음 / 연결: UI 없음(연결 대기)
