# S3a DB 구현 노트

> 상태: 마이그레이션 5개 적용(`supabase db reset` OK), 타입 재생성 완료(`src/server/db/database.types.ts`), `supabase test db` **PASS(16파일 543개)**. 커밋하지 않음.
> 결정 B-1: S1~S3 마이그레이션은 건드리지 않았다. 모두 `20261028xxxxxx_s3a_*` 새 파일이다.

## 마이그레이션 파일
| 파일 | 내용 |
|------|------|
| `supabase/migrations/20261028000100_s3a_drop_usage_ledger.sql` | 원장 삭제: `reserve_usage`, `charge_usage`, `release_usage`, `charge_usage_for_job`, `release_usage_for_job`, `get_usage_summary`, 옛 4인자 `complete_ai_job`, `private.transition_usage_event`, 테이블 `usage_events`, `usage_limits`. `private.current_usage_period()`(KST 월 1일)는 남김 |
| `supabase/migrations/20261028000200_s3a_ai_jobs_v4.sql` | ai_jobs v4: `attempt_count` → `run_generation`(integer), 새 컬럼 8개, CHECK 교체, `error_category` 재정의, `failure_cause` 신설, 인덱스 교체, 가드 트리거 갱신, grant |
| `supabase/migrations/20261028000300_s3a_ai_usage_records.sql` | ai_usage_records + period_month 트리거 + RLS + grant + 인덱스 |
| `supabase/migrations/20261028000400_s3a_ai_price_tables.sql` | ai_price_tables + 시드 27행(3버전 × 9모델) + `private.price_for` |
| `supabase/migrations/20261028000500_s3a_ai_job_rpcs_v4.sql` | `complete_ai_job` v4, `sweep_stalled_ai_jobs` v4, `claim_due_ai_jobs`, `get_ai_usage_summary` |

## 테이블·컬럼 (스펙 대비 차이 포함)

### ai_jobs (DM 2.9.1, A.15)
- **이름 변경** `attempt_count` → `run_generation` (smallint → integer). 실행 세대 = 좀비 실행기 차단용 내부 컬럼(spec-gaps 2026-10-28). 감소 금지 가드는 이 컬럼에 건다(`P0001 invalid_ai_job_transition`, detail `run_generation a -> b`).
- **새 컬럼**
  | 컬럼 | 타입 | 비고 |
  |------|------|------|
  | `provider` | text not null, CHECK `openai`/`gemini`/`anthropic` | **기본값 없음** — insert 때 반드시 넣는다 |
  | `model_tier` | text not null, CHECK `light`/`default`/`heavy` | 기본값 없음 |
  | `connection_tier` | text not null, CHECK `free`/`paid` | 기본값 없음 |
  | `retry_count` | integer not null default 0, `>= 0` | 자동 재시도 합계(명세 컬럼) |
  | `next_run_at` | timestamptz null | 다음 실행 예약 |
  | `retry_wait_total_ms` | integer not null default 0, `>= 0` | 재시도 대기 누적 |
  | `quota_resets_at` | timestamptz null | daily_quota_exhausted 초기화 시각 |
  | `retry_after` | timestamptz null | 최종 실패 시 안내 시각 |
  | `failure_cause` | generated stored | 아래 표 |
- 기존 행 이전(로컬엔 없음, 원격 대비): provider `anthropic`, connection_tier `paid`, model_tier는 model 이름(haiku → light, opus → heavy, 그 외 default). error_code `model_unavailable` → `model_not_available`, `refused` → `safety_blocked`(DM 2.9.1 표기대로).
- `job_type` CHECK: + `key_verification` (11값).
- `error_code` CHECK v4 15값: `rate_limited`, `daily_quota_exhausted`, `billing_required`, `key_invalid`, `model_not_available`, `provider_unavailable`, `input_too_long`, `safety_blocked`, `key_missing`, `schema_invalid`, `timeout`, `stalled`, `canceled`, `insufficient_data`, `not_a_jd`.
- generated 값 (C-11.1 표 그대로):
  | error_code | error_category | failure_cause |
  |------------|----------------|---------------|
  | rate_limited | provider_limit | rate_limited |
  | daily_quota_exhausted | provider_limit | daily_quota_exhausted |
  | billing_required | user_account | billing_required |
  | key_invalid | user_account | key_invalid |
  | key_missing | user_account | null |
  | model_not_available | user_account | model_not_available |
  | provider_unavailable | transient | provider_unavailable |
  | input_too_long, safety_blocked | input | input_rejected |
  | insufficient_data, not_a_jd | input | null |
  | schema_invalid, timeout, stalled, canceled | system | null |
- **가드 트리거 변경**: `failed → queued`(수동 재시도) 때 `error_code`, `finished_at`, `cancel_requested_at`에 더해 **`retry_after`, `quota_resets_at`도 비운다**. `retry_count`, `retry_wait_total_ms`, `next_run_at`은 건드리지 않는다(수동 재시도 때 초기화할지는 api가 정해서 쓰면 된다 — 감소 금지 없음).
- **인덱스**
  - `ai_jobs_in_flight_target_key` unique `(user_id, job_type, target_type, target_id) where status in ('queued','running')` — 옛 `ai_jobs_in_flight_input_key` 삭제. 충돌 시 `23505`. **target_type 또는 target_id가 null인 작업은 제한되지 않는다**(NULL은 서로 다름). api는 모든 작업에 대상을 넣을 것(예: insight → `target_type='application_project'`, `target_id=지원 프로젝트 id`).
  - `ai_jobs_reuse_idx` `(user_id, application_project_id, job_type, provider, input_hash) where status='succeeded'` (재생성).
  - `ai_jobs_due_idx` `(next_run_at) where status='queued' and next_run_at is not null` (깨우기).
- `progress.waiting_retry_until`: jsonb라 스키마 변경 없음(`progress`는 object CHECK만).

### ai_usage_records (DM 2.9.2)
- 컬럼은 DM 표 그대로 + `id`, `user_id`(기본값 `private.current_uid()` — 생략 가능, 탈퇴 cascade), `created_at`. `updated_at` 없음.
- `occurred_at` default `now()`(넘기면 그 값). **`period_month`는 insert 트리거가 항상 계산**(`occurred_at`의 KST 월 1일). app_ai_writer insert grant에 `period_month` 없음 → 넣으면 42501.
- (api 요청 반영) `period_month`에 default(KST 이번 달 1일)를 두어 생성 타입 `TablesInsert<'ai_usage_records'>`에서 선택 항목이 되게 했다. 트리거가 항상 덮어쓴다. 같은 이유로 `user_id`(`private.current_uid()`), `occurred_at`, `created_at`, `id`, 토큰 4개도 Insert 타입에서 선택이다. ai_jobs의 `provider`·`model_tier`·`connection_tier`는 **일부러 기본값이 없어 필수**다.
- CHECK: feature 10값, provider, model_tier, connection_tier, usage_source, outcome, error_code(ai_jobs와 같은 15값), **`job_type`도 ai_jobs와 같은 11값**[구현 결정 — "같은 값" 강제], `outcome='succeeded'`이면 `error_code is null`, 토큰 `>= 0`, **`usage_source='unavailable'`이면 토큰 4개 0 + reasoning null**(C-13), `estimated_cost_usd >= 0`(numeric(12,6)).
- `application_project_id`: uuid만, FK(set null)는 S5.
- 인덱스: `(user_id, period_month, feature)`, `(user_id, period_month, provider)`(DM) + `(user_id, provider, occurred_at desc)`(C-12 호출 간격 조회) + `(ai_job_id)`, `(application_project_id)` 부분 인덱스.

### ai_price_tables (DM 2.9.3)
- DM 컬럼 + `id`, `created_at` + **`long_context_cached_input_usd_per_mtok`, `long_context_cache_write_usd_per_mtok`**(spec-gaps 2026-10-28 [가정] — 매핑표의 장문 구간 캐시 단가를 담을 곳이 DM에 없음). 모두 null 허용.
- CHECK: provider, 단가 `>= 0`, 장문 구간은 threshold·input·output이 함께 있거나 장문 컬럼 전부 null.
- 시드 27행 = `00_model-mapping.md` §2와 대조 완료(psql로 27행 출력해 확인). `version` / `effective_from`: `v2026-10-28`/2026-10-28, `v2026-12-01`/2026-12-01(argon 4.00/0.20/20.00), `v2027-01-01`/2027-01-01(3.8-flash 1.50/0.15/7.50, argon은 12-01 값 유지). 장문 기준: OpenAI 272000, Haiku 100000. `source_checked_at` 전부 2026-10-28.

## RPC 시그니처와 반환 형태
오류는 `errcode` / `message`. 생성 타입: `Database['public']['Functions'][name]`.

### `complete_ai_job(p_job_id uuid, p_run_generation integer, p_progress jsonb default null) returns void`
- **security invoker**(app_ai_writer 본인 RLS + 컬럼 grant), 실행: app_ai_writer만.
- 타입: `Args: { p_job_id: string; p_run_generation: number; p_progress?: Json }; Returns: undefined`.
- running이고 `run_generation = p_run_generation` → `succeeded`, `finished_at = now()`, `next_run_at = null`, `p_progress`가 있으면 progress 교체.
- 이미 succeeded + 같은 세대 → 변경 없이 성공(멱등).
- 오류: `42501 not_authenticated`(sub 없음), `P0001 ai_job_not_found`(없음·남의 것), `P0001 invalid_ai_job_transition`(세대 불일치·null, 또는 queued/failed/canceled).

### `sweep_stalled_ai_jobs(p_stalled_before timestamptz) returns integer`
- security definer, service_role만. 예약 해제 부분 삭제.
- 대상: `running`, 그리고 **`queued`이면서 `next_run_at is null`**인 작업 중 `coalesce(heartbeat_at, created_at) < p_stalled_before` → `failed` / `stalled`. 반환 = 처리한 작업 수.
- **`next_run_at`이 있는 queued 작업은 멈춤으로 보지 않는다**(재시도 대기·무료 등급 간격. B-4로 크론이 하루 1회일 수 있어 next_run_at이 한참 지났을 수 있음 → `claim_due_ai_jobs`가 맡는다) [구현 결정].
- 오류: `P0001 invalid_stalled_before`(null).

### `claim_due_ai_jobs(p_now timestamptz, p_limit integer) returns table (id uuid, user_id uuid)`
- security definer, service_role만. **조회만 한다**(상태를 바꾸지 않음). `status='queued' and next_run_at <= p_now`, `next_run_at` 오래된 순, 최대 `p_limit`.
- 타입: `Args: { p_now: string; p_limit: number }; Returns: { id: string; user_id: string }[]`.
- 동시에 폴링이 같은 작업을 깨워도 실행기의 조건부 `queued → running`(run_generation 조건) update가 한쪽만 이기게 한다.
- 오류: `P0001 invalid_now`(null), `P0001 invalid_limit`(null 또는 < 1).
- 크론 순서 권장: `sweep_stalled_ai_jobs` → `claim_due_ai_jobs` → 작업마다 그 사용자의 app_ai_writer로 실행.

### `get_ai_usage_summary(p_period_month date default null, p_include_previous boolean default false) returns jsonb`
- security invoker, stable. 실행: **authenticated만**(app_ai_writer 불가).
- 타입: `Args: { p_period_month?: string; p_include_previous?: boolean }; Returns: Json`.
- `p_period_month` 생략·null = KST 이번 달. 아무 날짜나 넘기면 그 달 1일로 맞춘다.
- 반환(DM 2.9.5 키 그대로):
```json
{
  "period_month": "2026-10-01",
  "as_of": "2026-10-28T09:00:00.123456+00:00",
  "totals": { "input_tokens": 0, "cached_input_tokens": 0, "cache_write_tokens": 0, "output_tokens": 0,
              "estimated_cost_usd": 0, "calls": 0, "failed_calls": 0 },
  "by_feature": [ { "feature": "insight", "input_tokens": 0, "output_tokens": 0, "estimated_cost_usd": 0.0123, "calls": 0 } ],
  "by_provider": [ { "provider": "gemini", "connection_tier": "free", "input_tokens": 0, "output_tokens": 0, "estimated_cost_usd": 0, "calls": 0 } ],
  "price_table_versions": [ { "version": "v2026-10-28", "source_checked_at": "2026-10-28" } ],
  "previous_month": { "period_month": "2026-09-01", "estimated_cost_usd": 0, "input_tokens": 0, "output_tokens": 0 }
}
```
  - `previous_month`는 `p_include_previous = true`일 때만 있다.
  - 기록이 없으면 합계 0, 배열은 `[]`.
  - 정렬: by_feature는 feature 이름순, by_provider는 provider·connection_tier순, versions는 version순.
  - `estimated_cost_usd`는 JSON number(numeric 합계, 소수 6자리까지).
- 오류: `42501 not_authenticated`.

### `private.price_for(p_provider text, p_model text, p_at date default KST 오늘) returns public.ai_price_tables`
- SQL 헬퍼(stable). `effective_from <= p_at`이고 그 모델이 있는 최신 버전 행. 없으면 null 행.
- **private 스키마라 PostgREST(`db.rpc`)로는 못 부른다.** 앱(api)은 같은 조건으로 테이블을 직접 읽는다:
  ```ts
  db.from("ai_price_tables").select("*")
    .eq("provider", p).eq("model", m).lte("effective_from", kstDate)
    .order("effective_from", { ascending: false }).order("version", { ascending: false }).limit(1).maybeSingle()
  ```
  app_ai_writer는 ai_price_tables select 권한이 있다.

## RLS·권한 요약 (DM §5 대비)
| 테이블 | authenticated | app_ai_writer | anon |
|--------|---------------|---------------|------|
| ai_jobs | select 본인, 컬럼 단위(`params`, `step_outputs` 제외). 새 컬럼 9개 추가(`provider`, `model_tier`, `connection_tier`, `retry_count`, `next_run_at`, `retry_wait_total_ms`, `failure_cause`, `quota_resets_at`, `retry_after`). `run_generation`은 이름만 바뀌어 그대로 보인다 | select·insert·update 본인. insert에 새 컬럼 8개(generated 제외), update에 `retry_count`, `next_run_at`, `retry_wait_total_ms`, `quota_resets_at`, `retry_after` 추가. **`provider`·`model_tier`·`connection_tier`는 update 불가**(작업 중 고정). `run_generation`은 insert·update 가능(이름 변경으로 grant 유지) | 없음 |
| ai_usage_records | select 본인 | **insert 본인**(컬럼: `period_month`, `created_at` 제외 전부) + **select 본인**. update·delete 없음 | 없음 |
| ai_price_tables | select 전체 | select 전체 | 없음 |

- **DM §5와 다른 점**: app_ai_writer의 ai_usage_records **select 본인**을 더했다. C-12 호출 간격(같은 사용자·공급자의 마지막 `occurred_at`)을 실행기가 읽어야 하고, `insert ... returning`에도 필요하다. 남의 행은 RLS로 안 보인다.
- app_ai_writer가 실행할 수 있는 public 함수: `get_data_readiness`, `complete_ai_job` 두 개뿐.
- service_role: `sweep_stalled_ai_jobs`, `claim_due_ai_jobs`.

## 원장 삭제로 깨지는 앱 코드 (api·ai 몫)
`pnpm typecheck`는 api/ai 작업이 끝날 때까지 실패한다(예상). 타입 재생성 직후(2026-10-28) 결과 중 **DB 객체 삭제·변경이 원인인 것**은 다음과 같다.
- `src/server/jobs/ledger.ts`: `reserve_usage`, `release_usage`, `release_usage_for_job` RPC 없음 → 파일 삭제 대상(계획 API-2).
- `src/server/services/usage/index.ts`: `get_usage_summary` 없음 → `get_ai_usage_summary`로 교체(계획 API-9).
- `src/server/jobs/app-runner.ts`: `Ledger` 타입 의존(ledger 삭제 여파).
- `supabase-store.ts`의 `attempt_count` / 옛 `complete_ai_job` 인자는 타입체크 목록에 나오지 않았다(api가 이미 고친 것으로 보임). `runner.integration.test.ts`, `src/test/job-fakes.ts`는 `attempt_count`·원장 픽스처를 써서 실패한다.
- 그 밖(`anthropic-client.ts`의 `refused`·`mapSdkError`, `status.ts`의 error_category 5값·`attemptCount`, `actions/usage.ts`의 `UsageSummary`, `sse.ts`)은 api/ai가 contracts·errors를 v4로 바꾸는 중이라 생기는 것이다(DB 원인 아님).

## 테스트 (`supabase test db` 결과)
**Files=16, Tests=543, PASS.**
- 삭제: `supabase/tests/usage_ledger.test.sql`(원장 테스트).
- `supabase/tests/ai_jobs.test.sql`(다시 씀, 104개): v4 컬럼 목록, `attempt_count` 없음, `run_generation` integer, provider·tier 3개 필수(23502)·CHECK, retry 카운터 CHECK, `key_verification`, 재시도 예약(running → queued + next_run_at + waiting_retry_until) → 다시 점유, provider·tier update 불가, **15개 error_code 전부의 error_category·failure_cause**(C-11.1 표 대조), v3 `model_unavailable`·`refused` 거부, 수동 재시도 때 retry_after·quota_resets_at 초기화(retry_count 유지), run_generation 감소 거부, 대상 단위 동시 실행 제한(같은 대상 다른 입력 23505, 다른 job_type·다른 대상·다른 사용자·null 대상 허용, 종료 후 허용, 수동 재시도가 진행 중 작업과 충돌하면 23505), sweep v4(예약된 queued는 건너뜀), claim_due(전체 사용자, 정렬, limit, p_now, 상태 불변, 오류 3종, 권한), 취소, 격리, cascade.
- `supabase/tests/complete_ai_job.test.sql`(다시 씀): 반환 void, 옛 시그니처 없음, invoker, 권한, 세대 불일치·null 거부, 성공 + next_run_at 비움 + progress, 멱등, queued/failed 거부, 없음·남의 것·sub 없음.
- `supabase/tests/ai_usage_records.test.sql`(신규): 원장 테이블·함수 삭제 확인, RLS·정책, updated_at 없음, 인덱스, period_month KST 경계(10-31 15:30Z → 11월), CHECK 11종, 남의 user_id 거부, update/delete 불가, app_ai_writer 본인 select, 사용자 격리, anon, cascade.
- `supabase/tests/ai_price_tables.test.sql`(신규): 3버전 × 9모델, v2026-10-28 단가 전체를 매핑표 값과 대조, argon·3.8-flash 버전별 변경, 나머지 불변, unique·CHECK, `private.price_for`(경계일, 최신, 없음 → null, 기본 날짜), 읽기 전용 권한.
- `supabase/tests/ai_usage_summary.test.sql`(신규): invoker·권한, 키 목록, 합계·by_feature·by_provider(등급별)·versions 정확값, 달 정규화, previous_month(있음·0), 빈 달, 기본·null = 이번 KST 달, B 격리, sub 없음.
- `supabase/tests/grants.test.sql`(13개): app_ai_writer 테이블 SELECT 허용 목록(+ai_usage_records, ai_price_tables / −usage_*), 컬럼 쓰기 허용 목록(ai_jobs 새 컬럼, ai_usage_records insert 22컬럼), 실행 가능 함수 = `get_data_readiness`, `complete_ai_job`, sweep·claim_due는 service_role 전용.
- `supabase/tests/s3_first_call_privileges.test.sql`: 실제 역할로 첫 호출 — authenticated(summary, 가격표, 읽기, 취소, 삭제 트리거), app_ai_writer(가격 조회, price_for, 작업 insert, 점유, 사용 기록 insert, 마지막 호출 조회, 재시도 예약·재개, 근거, complete), service_role(sweep, claim_due).

## 원격 브랜치 적용 여부
하지 않음(계획대로 로컬 전용). 커밋도 하지 않음.

## 스펙 차이·가정 (spec-gaps.md에 기록한 항목)
- ai_price_tables 장문 구간 캐시 단가 컬럼 2개 추가 [가정].
- (노트에만, 구현 결정) ai_usage_records `job_type` CHECK, `unavailable` 토큰 0 CHECK, 성공 행 error_code null CHECK, app_ai_writer select, sweep이 next_run_at 있는 queued 작업 제외, in-flight 유니크의 NULL 대상 비제한, 수동 재시도 시 retry_after·quota_resets_at 초기화.
