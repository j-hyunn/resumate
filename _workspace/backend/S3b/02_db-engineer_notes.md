# S3b DB 구현 노트

> 상태: 마이그레이션 6개 적용(`supabase db reset` OK), 타입 재생성 완료(`src/server/db/database.types.ts`), `supabase test db` **PASS(21파일 821개)**, `pnpm test` 692/692. 커밋하지 않음. 원격 적용 없음.

## api-engineer용 계약 요약 (먼저 읽기)

오류: `42501 not_authenticated`(JWT sub 없음), 그 밖은 `P0001` + 아래 message. 생성 타입: `Database['public']['Functions'][name]`.

**bytea 주고받기(PostgREST)**: 타입은 `string`이다. 보낼 때 `'\\x' + buf.toString('hex')`(JSON 문자열 `"\x0a1b…"`), 받을 때도 `"\x…"` hex 문자열 → `Buffer.from(s.slice(2), 'hex')`.

| RPC | 호출 역할 | 인자 | 반환 | 오류(P0001 message) |
|-----|-----------|------|------|----------------------|
| `save_provider_key` | authenticated (definer) | `p_provider`, `p_connection_tier`, `p_key_ciphertext`, `p_key_nonce`, `p_wrapped_dek`, `p_kek_id`, `p_key_last4`(정확히 4자), `p_disclosure_version`, `p_verification_result`(`valid`/`limited`), `p_key_id`(uuid, 필수), `p_failure_cause?`(limited일 때 필수: `rate_limited`/`daily_quota_exhausted`/`provider_unavailable`, valid면 null), `p_encryption_version?`(기본 1) | `Json` = 키 메타 + `replaced` | `invalid_provider`, `invalid_connection_tier`, `invalid_verification_result`, `invalid_failure_cause`, `invalid_key_id`, `consent_required`, `key_id_mismatch`. 그 밖 CHECK 위반 `23514`(예: last4 길이, 빈 bytea), 다른 사용자의 키 id와 충돌 `23505` |
| `record_provider_key_check` | authenticated (definer) | `p_provider`, `p_result_status`(`valid`/`failed`), `p_failure_cause?`(failed일 때 6값 중 하나) | `Json` = 키 메타 | `invalid_provider`, `invalid_result_status`, `invalid_failure_cause`, `key_not_found` |
| `delete_provider_key` | authenticated (invoker) | `p_provider` | `boolean`(지운 행이 있었는지, 멱등) | `invalid_provider` |
| `set_active_ai_provider` | authenticated (definer) | `p_provider` | `undefined` | `invalid_provider`, `key_not_found` |
| `mark_provider_key_invalid` | **app_ai_writer** (definer) | `p_ai_job_id`, `p_failure_cause`(6값) | `boolean`(키 행 갱신 여부, 키가 이미 지워졌으면 false) | `ai_job_not_found`, `invalid_failure_cause` |
| `record_provider_key_success` | **app_ai_writer** (definer) **[S3b 제안 — 아래]** | `p_ai_job_id` | `boolean`(needs_check → valid로 바뀌었는지) | `ai_job_not_found`, `invalid_ai_job_state`(running/succeeded 아님) |
| `check_ai_run_allowed` | **app_ai_writer 전용** (definer) **[QA-S3b-01]** | `p_ai_job_id` | `string \| null`: null = 실행 가능, `key_missing` / `key_invalid` / `consent_required` | `ai_job_not_found`(없음·남의 작업). 암호 컬럼은 읽지 않음 |
| `get_provider_key_secret` | **app_key_reader 전용** (definer) | `p_ai_job_id` | 행 0~1개: `{ key_id, key_ciphertext, key_nonce, wrapped_dek, kek_id, encryption_version }` | `key_not_available`(작업 없음·남의 작업·running 아님·heartbeat null 또는 2분 초과). **작업은 정상인데 키 행이 없으면 오류가 아니라 0행** → 앱이 `ProviderError('key_missing')` |

- 6값(키 실패 원인) = `rate_limited`, `daily_quota_exhausted`, `billing_required`, `key_invalid`, `model_not_available`, `provider_unavailable`. `input_rejected`는 키 원인이 아니라 거부한다.
- **키 메타 JSON**(save / record_check 반환):
  ```json
  { "id": "uuid", "provider": "gemini", "connection_tier": "free", "key_last4": "abcd",
    "status": "valid", "last_verified_at": "…|null", "last_failure_cause": null, "last_failure_at": null,
    "is_active": true, "replaced": false }
  ```
  `replaced`는 `save_provider_key`에만 있다.
- `ai_jobs`에서 `key_verification` 대상: 계획대로 `target_type = 'ai_provider'`, `target_id = uuidv5(provider)`. `target_type`에는 CHECK가 없어 DB 변경 없음.

### 화면·서버가 읽는 테이블
| 대상 | authenticated | anon | app_ai_writer | 비고 |
|------|---------------|------|---------------|------|
| 뷰 `ai_provider_keys_public` | select (본인, RLS) | - | - | 컬럼: `id, provider, connection_tier, key_last4, status, last_verified_at, last_failure_cause, last_failure_at, created_at, updated_at`. **화면은 이 뷰를 쓴다** |
| `ai_provider_keys` | 위 10개 컬럼만 select, delete 본인 | - | - | `select('*')`는 42501(암호 컬럼). `user_id`도 grant 없음(DM 목록대로) |
| `ai_data_use_consents` | select·insert 본인, update `withdrawn_at`만 | - | - | insert 컬럼: `provider, connection_tier, disclosure_version, free_tier_acknowledged`(+`user_id` 생략 가능). `agreed_at`은 서버 시각 |
| `ai_disclosures` | select | select | - | 현재 버전 = `(provider, connection_tier)`에서 `effective_at <= now()` 중 최신 |
| `ai_providers` | select | - | - | `display_order` 순 |
| `profiles.active_ai_provider` | select(기존 테이블 select) | - | **없음** | 직접 update 불가 → `set_active_ai_provider` |

### 동의 insert 오류(트리거, P0001)
`unknown_disclosure_version`(그 공급자·등급에 없는 버전), `disclosure_version_not_current`(현재 버전 아님). 무료 등급인데 `free_tier_acknowledged = false` → `23514`(CHECK `ai_data_use_consents_free_tier_acknowledged_check`).

### readiness (`get_data_readiness`)
S2 형태 그대로 + 최상위 `ai_connection: { active_provider, key_status, connection_tier }`(활성 키 없으면 셋 다 null). 활성 공급자가 없거나 `key_status = 'invalid'`이면 `ready = false`인 기능(`insight`·`draft`·`job_interview`)의 `next_action = 'form'`이고 `suggested_mode`·`suggested_project_id`는 없다. app_ai_writer도 그대로 호출 가능.

### 미결 → 제안: 성공 실행 시 `needs_check → valid` (DM 2.11.3)
- 문제: 사용자 세션 RPC(`record_provider_key_check`)는 실행기(app_ai_writer)가 부를 수 없다.
- **제안(구현해 둠)**: `record_provider_key_success(p_ai_job_id)` — app_ai_writer 전용 definer. 작업이 본인 것이고 `running`/`succeeded`일 때, 그 작업의 공급자 키가 `needs_check`이면 `valid` + `last_verified_at = now()`. 그 밖 상태는 그대로(no-op, false). 암호 컬럼은 읽지 않는다.
- `mark_provider_key_invalid`를 `report_provider_key_status(p_ai_job_id, p_outcome)`로 일반화하는 안은 택하지 않았다: DM에 이름이 있는 RPC를 그대로 두는 편이 추적이 쉽고, 성공 경로는 "needs_check만 바꾼다"는 좁은 권한이라 따로 두는 것이 검토하기 쉽다.
- 호출 시점 권장: 작업 안의 **첫 공급자 호출 성공 직후 1회**(작업 시작 시 읽은 키 상태가 `needs_check`일 때만 불러도 된다). api가 다른 안을 원하면 알려 달라 — 바꾸는 비용은 작다.
- 주의: 키 교체는 같은 id를 유지하므로 `mark_provider_key_invalid`가 "작업이 쓴 바로 그 키"인지 구분하지 못한다(작업 중 교체 직후 옛 키의 401이 새 키를 invalid로 만들 수 있음). 드문 경합이라 그대로 둔다. 필요하면 `updated_at`을 비교 인자로 추가할 수 있다.

### 실행 시점 동의 확인 (api 몫, 알고리즘)
DB는 `save_provider_key`에서 "현재 고지 버전과 정확히 같은 최신 활성 동의"를 강제한다. AI 실행 Route Handler의 재동의 판정(DM 2.11.5: `requires_reconsent = true`인 새 버전이 나오면 다음 실행 전 재동의)은 api가 사용자 세션으로 한다:
1. `ai_data_use_consents`에서 `(provider, connection_tier)`·`withdrawn_at is null` 최신 행(agreed_at desc).
2. 없으면 `ai_consent_required`.
3. 그 행의 `disclosure_version` 이후(`effective_at`이 더 늦고 `<= now()`)에 `requires_reconsent = true`인 `ai_disclosures` 행이 있으면 `ai_consent_required`.

## QA-S3b-01 반영: `check_ai_run_allowed` (2026-10-29)
- 파일: `supabase/migrations/20261029000700_s3b_check_ai_run_allowed.sql`, 테스트 `supabase/tests/check_ai_run_allowed.test.sql`(+ grants 허용 목록, s3b 첫 호출).
- 판정 순서: 작업 소유(`private.current_uid()` = 작업 user_id, 아니면 `ai_job_not_found`) → 작업 공급자의 키 없음 `key_missing` → 키 `invalid`이면 `key_invalid` → **키의 현재 등급** 기준 실행 동의 규칙 실패면 `consent_required` → null. `needs_check`는 허용.
- 동의 규칙(`private.ai_consent_allows_run`, api `mayRunWithConsent`와 같음): 최신 활성 동의가 있다. 그 동의 버전이 유효한(`effective_at <= now()`) 고지 행이다. 그보다 늦게 유효해진 `requires_reconsent = true` 고지가 없다.

## 마이그레이션 파일
| 파일 | 내용 |
|------|------|
| `supabase/migrations/20261029000100_s3b_app_key_reader_role.sql` | 역할 `app_key_reader`(nologin noinherit), authenticator에 grant, `public` 스키마 usage만 |
| `supabase/migrations/20261029000200_s3b_ai_reference_tables.sql` | `ai_providers`(시드 3행), `ai_disclosures`(시드 6행), RLS·grant, `private.current_ai_disclosure_version()` |
| `supabase/migrations/20261029000300_s3b_ai_provider_keys.sql` | `ai_provider_keys` + RLS + 컬럼 grant + 뷰 `ai_provider_keys_public` + `profiles.active_ai_provider`(복합 FK set null) |
| `supabase/migrations/20261029000400_s3b_ai_data_use_consents.sql` | `ai_data_use_consents` + insert·update 가드 트리거 + RLS·grant + `private.has_current_ai_consent()` |
| `supabase/migrations/20261029000500_s3b_provider_key_rpcs.sql` | RPC 7개(위 표) + 헬퍼 `private.is_key_failure_cause`, `private.provider_key_meta` |
| `supabase/migrations/20261029000600_s3b_get_data_readiness_ai_connection.sql` | `get_data_readiness` create or replace(S2 본문 + `ai_connection`) + definer 헬퍼 `private.current_ai_connection()` |

## 테이블·컬럼 (스펙 대비 차이 포함)

### ai_provider_keys (DM 2.11.1)
- DM 컬럼 그대로 + `id`, `user_id`(기본값 `auth.uid()`, cascade), `created_at`, `updated_at`(트리거).
- **`id`에 기본값 없음**: 서버가 암호화 전에 정해서 `p_key_id`로 넘긴다(AAD).
- CHECK: provider 3값, tier 2값, status 3값, `key_last4` 정확히 4자, `encryption_version >= 1`, 암호 bytea·`kek_id` 빈 값 금지, `last_failure_cause` 7값(2.9.1 failure_cause).
- unique `(user_id, provider)`, `(id, user_id)`.

### profiles.active_ai_provider (DM 2.11.4)
- CHECK 3값, FK `(id, active_ai_provider) → ai_provider_keys(user_id, provider) on delete set null (active_ai_provider)`(PG15+ 문법, 로컬 PG17).
- 사용자 update grant 없음 → `set_active_ai_provider` / `save_provider_key`로만 바뀐다.
- app_ai_writer select grant **주지 않음**(계획 3번 판단): 작업 시작 시 공급자는 사용자 세션에서 읽어 `ai_jobs.provider`에 고정하고, readiness는 definer 헬퍼로 읽는다.

### ai_data_use_consents (DM 2.11.5)
- DM 컬럼 + `id`, `user_id`(기본값 `auth.uid()`), `created_at`. `updated_at` 없음(consents와 같은 1동의 1행 기록).
- insert 가드: 그 공급자·등급에 있는 버전(`unknown_disclosure_version`) + 현재 버전(`disclosure_version_not_current`), `agreed_at`은 `clock_timestamp()`, `withdrawn_at` null 강제.
- update 가드: `withdrawn_at`은 서버 시각. RLS가 활성 행만 철회 가능, 되돌리기 불가.
- 인덱스 `(user_id, provider, connection_tier, agreed_at desc)`.

### ai_disclosures / ai_providers (DM 2.11.6)
- `ai_disclosures`: `id`, `created_at` 추가, unique `(provider, connection_tier, version)`, CHECK "free 등급이면 `requires_free_tier_ack = true`". 현재 버전 = `effective_at <= now()` 중 최신.
- 시드: 6행 `v2026-10-29`, `effective_at` 2026-10-28 00:00 KST(배포 즉시 유효), `requires_reconsent = false`, free만 `requires_free_tier_ack = true`, `document_path = /policies/ai/{provider}/{tier}/v2026-10-29`, `terms_checked_at` 2026-10-29.
- `ai_providers`: `provider` PK, unique `display_order`, `created_at`/`updated_at`. 시드: gemini 1(추천) / anthropic 2 / openai 3, 모두 `is_available = true`, `key_guide_version = v2026-10-29`. URL `[가정]`(운영자가 키 가이드와 함께 확인):
  - gemini: `https://aistudio.google.com/usage`, `https://aistudio.google.com/billing`
  - anthropic: `https://platform.claude.com/usage`, `https://platform.claude.com/settings/billing`
  - openai: `https://platform.openai.com/usage`, `https://platform.openai.com/settings/organization/billing/overview`

## RPC 동작 상세 (계약 표 보충)
- `save_provider_key`: 검사 순서 = sub → 인자 → **동의**(p_disclosure_version이 현재 버전이고, 그 공급자·등급의 최신 활성 동의가 그 버전) → profiles 행 잠금 → 기존 키 잠금. 기존 행이 있으면 id가 같아야 하고(아니면 `key_id_mismatch`) 같은 행을 덮어쓴다. valid → `valid`, `last_verified_at = now()`, 실패 필드 null. limited → `needs_check`, `last_verified_at = null`, 원인·시각 기록. **등급이 바뀌면 이전 등급의 활성 동의에 `withdrawn_at`**. 활성 공급자가 null이면 이 공급자로 설정.
- `record_provider_key_check`: 성공 → `valid` + `last_verified_at`(실패 필드는 이력으로 유지). `key_invalid` → `invalid`, 나머지 5원인 → `needs_check`, 모두 `last_failure_*` 기록.
- `mark_provider_key_invalid`: 작업의 사용자(= JWT sub)·공급자 키. `key_invalid`면 `invalid`, 그 밖 5원인은 상태 유지 + `last_failure_*`. 작업 상태는 묻지 않는다.
- `delete_provider_key`: invoker. 행 삭제(RLS로 본인만, `user_id` 컬럼 grant가 없어 provider로만 거름) → FK가 active를 null로 → 그 공급자의 활성 동의(모든 등급) 철회.
- `get_provider_key_secret`: heartbeat 창 2분은 함수 안 상수(`c_heartbeat_window`). 키 `status`는 따지지 않는다(invalid 키로 작업을 시작하지 않는 것은 api의 시작 검사 몫).

## RLS·권한 요약 (DM §5 대비)
| 대상 | anon | authenticated | app_ai_writer | app_key_reader | service_role |
|------|------|---------------|---------------|----------------|--------------|
| ai_provider_keys | - | 메타 10컬럼 select(본인), delete(본인) | - | - | 메타 + `user_id`, `encryption_version` select |
| 암호 4컬럼 | - | - | - | - | - |
| ai_provider_keys_public | - | select | - | - | - |
| ai_data_use_consents | - | select·insert 본인, update(`withdrawn_at`) | - | - | (기본 권한) |
| ai_disclosures | select | select | - | - | (기본) |
| ai_providers | - | select | - | - | (기본) |
| 함수 | - | save / record_check / delete / set_active, readiness | readiness, complete_ai_job, **mark_provider_key_invalid, record_provider_key_success** | **get_provider_key_secret만** | (S3a 그대로) |

- DM §5와 다른 점: app_ai_writer 실행 함수에 `record_provider_key_success` 추가(제안). service_role의 `ai_provider_keys`는 기본 전체 권한을 회수하고 메타 select만 줬다(NFR-KEY-07).
- `pg_read_all_data` 구성원(`supabase_read_only_user`, `supabase_etl_admin`)과 소유자·슈퍼유저는 컬럼 grant를 우회한다 → spec-gaps 기록, 보호 근거는 KMS(KEK가 DB 밖).

## 테스트 (`supabase test db` 결과)
**Files=20, Tests=801, PASS.**
- 신규 `supabase/tests/ai_provider_keys.test.sql`: 구조·CHECK·FK(set null 컬럼 목록), 뷰 invoker, 직접 insert/update 불가, `save_provider_key` 오류 11종과 저장 규칙(R-38: valid / limited / key_invalid·billing_required 거부), 첫 키 활성화, 교체(id 유지·암호문 교체·등급 변경 시 동의 철회·id 불일치 거부·동의 없는 등급 변경 거부 시 기존 키 유지), 메타 컬럼만 select(암호 4컬럼·`*`·user_id 42501), B 격리(조회·삭제·PK 탈취·활성화·check), `record_provider_key_check` 전 분기, `set_active_ai_provider` 전 분기, `delete_provider_key`(FK set null·자동 전환 없음·동의 철회·멱등·비활성 키 삭제 시 active 유지·재등록 시 재활성화), sub 없음, 실행 권한 표, app_ai_writer 키 접근 불가·`mark_provider_key_invalid`/`record_provider_key_success` 전 분기, service_role 메타만, updated_at, 탈퇴 cascade.
- 신규 `supabase/tests/get_provider_key_secret.test.sql`: 정상(공급자는 작업에서, heartbeat 119초 허용, key_id 반환), 키 없음 0행, 거부(다른 사용자 작업 = sub 불일치, 없는 작업, null, queued/succeeded/failed/canceled, heartbeat 121초·null, sub 없음), B 격리, **app_key_reader는 그 밖에 아무것도 못 함**(테이블·뷰·update·delete·heartbeat 갱신·다른 RPC·private), 다른 역할(authenticated, app_ai_writer, anon, service_role) 실행 불가, 역할 속성, 실행 중 키 삭제 → 0행.
- 신규 `supabase/tests/ai_data_use_consents.test.sql`: 참조 테이블 시드·CHECK·현재 버전(미래 버전 제외), anon/authenticated/app_ai_writer 권한, 동의 RLS·가드(무료 체크, 모르는 버전, 미래 버전, 남의 user_id, id·agreed_at 쓰기 불가), 철회(서버 시각·되돌리기 불가·다른 컬럼 불가·삭제 불가), 재동의 새 행, B 격리, cascade.
- 신규 `supabase/tests/s3b_first_call_privileges.test.sql`: anon → authenticated(목록·동의·저장·조회·check·활성 변경·철회) → app_ai_writer(readiness, `key_verification` 작업 `target_type = 'ai_provider'`) → app_key_reader(secret) → app_ai_writer(success·invalid) → authenticated(삭제) 순으로 실제 역할 첫 호출.
- 수정 `supabase/tests/get_data_readiness.test.sql`: S2 케이스는 A에게 유효 키를 두고 실행(형태에 `ai_connection` 포함), 추가로 needs_check(writing_chat 유지)·invalid(form, suggested 없음)·app_ai_writer·키 삭제 후 null·B 격리.
- 수정 `supabase/tests/grants.test.sql`(20개): anon에 `ai_disclosures` select 허용, app_ai_writer 실행 함수 +2, 암호 컬럼 권한 0(앱·API 역할 전부), `pg_read_all_data` 우회 역할 목록 고정, `ai_provider_keys` 테이블 권한 = authenticated DELETE만, authenticated 컬럼 select = 메타 10개, app_key_reader 테이블·컬럼 권한 0 + 실행 함수 = `get_provider_key_secret(uuid)`만, 그 함수는 app_key_reader만.

### `pnpm test` / typecheck
- `pnpm test`: 643/644 통과. 실패 1건 `src/lib/contracts/career.test.ts > DataReadiness > parses the DM §6 example shape` — api가 작업 중인 `src/lib/contracts/career.ts`가 `ai_connection`을 필수로 바꿨는데 테스트 샘플에 아직 없다(api 몫, DB 원인 아님).
- `pnpm typecheck`: `src/server/keys/app.ts`가 없는 모듈 `@/server/jobs/log`를 import(api 작업 중).

## 원격 브랜치 적용 여부
하지 않음(계획대로 로컬 전용). 커밋도 하지 않음.

## 스펙 차이·가정 (spec-gaps.md에 기록한 항목, 2026-10-29)
- `pg_read_all_data` 구성원의 암호 컬럼 열람(컬럼 grant로 못 막음) → KMS 전제.
- `save_provider_key` 인자 추가(`p_key_id` — 리더 기록, `p_failure_cause`, `p_encryption_version`), `record_provider_key_check`의 `result_status` 값, 성공 시 실패 필드 처리, "첫 키" 기준.
- 성공 실행 시 needs_check → valid: `record_provider_key_success` 신설(제안).
- `get_provider_key_secret`: 거부(오류) vs 키 없음(0행), `key_id` 반환.
- readiness `form` 시 `suggested_*` 생략.
- 화면 조회 컬럼에 `user_id` 없음 → delete는 RLS에 맡김, service_role은 메타만.
- 등록 시 재동의 규칙 vs 실행 시 `requires_reconsent` 규칙, 고지 첫 버전 `effective_at`.
