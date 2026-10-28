# S3a AI 실행 기반 v4 (BYOK) 계획

## 범위와 근거
- 이 슬라이스는 S3 재작업이다. 결정 B-1~B-4(`decisions.md` 2026-10-28)와 모델 매핑 `00_model-mapping.md`(사용자 확정)를 따른다.
- 기획 근거:
  - DM §2.8, §2.9(2.9.1~2.9.5), §5, 부록 A.14~A.16
  - AI C-1~C-13(특히 C-10~C-13)
  - PRD F-AI-07~09
- **유지하는 S3 코드**: 경력 팩, JD 분할, 검증 V-1~V-8, 자리 표시, evidence_links와 삭제 트리거, 증분 JSON 스트리밍, SSE 헬퍼, 실행기의 체크포인트·세대 조건·이어 실행 토큰·취소·멈춤 정리.
- **S3b로 미루는 것**: 키 테이블·암호화·`app_key_reader`·키 RPC·동의·readiness `ai_connection`. S3a는 키와 공급자 문맥을 **인터페이스 + 가짜 구현**으로 받는다.
- **열린 이슈**: QA-S3-10(예약 묶임)은 원장이 없어져 폐기된다. QA-S3-12(진행 중 작업이 있을 때 재시도하면 409)는 새 동시 실행 규칙에서 다시 처리한다.

## 계약 — DB (새 마이그레이션만, B-1)
파일 접두어는 `20261028xxxxxx_s3a_*`이다.

1. **원장 삭제**: 함수 `reserve_usage`, `charge_usage`, `release_usage`, `charge_usage_for_job`, `release_usage_for_job`, `get_usage_summary`와 테이블 `usage_events`, `usage_limits`를 지운다.

2. **`ai_jobs` v4** (DM 2.9.1)
   - 컬럼 추가: `provider` not null CHECK 3값, `model_tier` not null CHECK 3값, `connection_tier` not null CHECK 2값, `next_run_at`, `retry_wait_total_ms int not null default 0`, `quota_resets_at`, `retry_after`.
   - 세대와 재시도 횟수 분리(spec-gaps 2026-10-28):
     - 기존 `attempt_count`(실행 세대)를 `run_generation`으로 이름을 바꾼다.
     - 새 `retry_count int not null default 0`(재시도 합계)을 둔다.
     - 가드 트리거의 "감소 금지"는 `run_generation`에 건다.
   - `job_type` CHECK에 `key_verification`을 추가한다.
   - `error_code` CHECK를 v4 목록으로 교체한다. `error_category` generated 5값과 `failure_cause` generated 7값(나머지는 null)은 C-11.1 표 그대로다.
   - `progress`에 `waiting_retry_until` 키를 허용한다(jsonb라 스키마 변경은 없고, 문서로만 둔다).
   - 동시 실행 제한: `ai_jobs_in_flight_input_key`를 지우고 `unique (user_id, job_type, target_type, target_id) where status in ('queued','running')`로 바꾼다. 이름은 `ai_jobs_in_flight_target_key`다.
   - 재사용 인덱스: `(user_id, application_project_id, job_type, provider, input_hash) where status = 'succeeded'`.
   - `complete_ai_job(p_job_id uuid, p_run_generation int, p_progress jsonb default null) returns void`: 성공 전이만 하고 차감은 없다. 같은 세대에서 이미 succeeded면 멱등으로 처리한다.
   - `sweep_stalled_ai_jobs(p_stalled_before)`: 예약 해제 부분을 뺀다. 반환값은 정리한 작업 수다.
   - **재시도 대상 조회** RPC `claim_due_ai_jobs(p_now timestamptz, p_limit int) returns setof (id, user_id)`. service_role 전용이다. `queued`이고 `next_run_at <= now`인 작업을 크론이 깨울 때 쓴다(B-4).
   - 사용자 컬럼 select 목록에 새 컬럼을 넣는다. `params`, `step_outputs`는 여전히 뺀다.

3. **`ai_usage_records`** (DM 2.9.2)
   - 컬럼·CHECK는 표 그대로다. `feature` 10값, `outcome`, `usage_source`, `estimated_cost_usd numeric(12,6)`.
   - `application_project_id`는 uuid만 두고, FK(set null)는 S5에서 붙인다.
   - 불변: `updated_at` 없음. app_ai_writer는 insert만, 사용자는 select만 한다.
   - 인덱스 `(user_id, period_month, feature)`, `(user_id, period_month, provider)`.
   - `period_month`는 insert 트리거가 `occurred_at` 기준 KST 월 1일로 계산한다.

4. **`ai_price_tables`** (DM 2.9.3)
   - `unique (version, provider, model)`이다. authenticated와 app_ai_writer는 select만, 쓰기는 마이그레이션으로만 한다.
   - **시드**: `00_model-mapping.md` §2의 3개 버전(`v2026-10-28`, `v2026-12-01`, `v2027-01-01`). 버전마다 그 시점의 9개 모델 전체 행을 넣는다. 장문 구간 컬럼도 채운다.
   - 조회 헬퍼 `private.price_for(provider, model, at date)`: `effective_from <= at`인 최신 버전의 행을 돌려준다.

5. **`get_ai_usage_summary(p_period_month date default KST 이번 달, p_include_previous boolean default false) returns jsonb`**: DM 2.9.5의 JSON 모양 그대로, security invoker, authenticated.

6. pgTAP:
   - 원장 객체가 없어졌는지
   - `ai_jobs` 새 CHECK, generated 값, 대상 단위 동시 실행 제한, 가드 트리거
   - `ai_usage_records` 격리와 불변성, 가격표 조회, summary 모양
   - `claim_due_ai_jobs` 권한
   - grants 허용 목록 갱신, 첫 호출 권한 테스트

## 계약 — AI (`src/server/ai/`)

1. **`providers/`** (C-10)
   - 공통 타입은 다음과 같다.
     ```ts
     type ProviderId = 'openai' | 'gemini' | 'anthropic'
     type ModelTier = 'light' | 'default' | 'heavy'
     type ConnectionTier = 'free' | 'paid'
     type ProviderCall = { provider, tier, apiKey, connectionTier }   // apiKey는 호출마다 runner가 넘긴다
     type AiRequest = { systemBlocks, userBlocks, outputSchema | null, stream, maxOutputTokens, reasoningLevel: 'low' | 'medium', signal, jobId, callKey }
     type NormalizedUsage = { inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, reasoningTokens | null, usageSource: 'provider_reported' | 'unavailable' }
     type AiCallResult = { text, model, usage: NormalizedUsage, latencyMs }
     type AiStreamEvent = { type: 'delta', text } | { type: 'done', result: AiCallResult } | { type: 'error', error: ProviderError, usage: NormalizedUsage }
     class ProviderError extends AiError { code: AiErrorCode; retryAfter?: Date; quotaResetsAt?: Date; usage?: NormalizedUsage; beforeFirstToken: boolean }
     ```
   - `models.ts`: 매핑표(00 §1)와 `resolveModel(provider, tier)`.
   - 어댑터 3개 `anthropic.ts`, `openai.ts`, `gemini.ts`. 각각 `complete`, `stream`, `verify`(C-10.5 2단계 → 결과 원인)를 구현한다.
   - SDK: `@anthropic-ai/sdk`(기존), `openai`, `@google/genai`. `pnpm add`는 ai-pipeline-engineer가 하되 `package.json` 다른 항목은 건드리지 않는다.
   - 기존 `anthropic-client.ts`를 어댑터로 옮긴다. 이전 세대 대체(`AI_UNAVAILABLE_FALLBACK`)와 `REFUSAL_FALLBACKS_ENABLED`는 삭제한다(D-31).
   - 정본 스키마 → 공급자 형식 변환기(C-10.2)와 정본 규칙 검사기.
   - 오류 매핑은 C-11.2 표를 공급자별로 테스트 표로 만든다. Gemini 일일 한도 초기화 시각은 다음 `00:00 America/Los_Angeles`를 tz로 계산한다.
   - 공급자 SDK가 자체 재시도를 하지 않게 끈다(재시도는 runner 몫이다).

2. **오류 코드** `errors.ts`: v4 목록으로 바꾼다. `refused`, `model_unavailable`을 지우고 `safety_blocked`, `model_not_available`, `daily_quota_exhausted`, `billing_required`, `key_invalid`, `key_missing`, `provider_unavailable`을 넣는다.
   - 재시도 가능 여부는 C-11.3 표로 정하고, 함수 `retryPolicy(code) → { maxRetries, backoffMs[] }`로 둔다.
   - **분류되지 않은 예외**는 `provider_unavailable`로 본다 `[가정, spec-gaps 73행 재검토 결과]`. 로그에는 `unclassified: true`를 남긴다.

3. **구조화 출력 경로** `structured.ts`: 공급자 중립 `llm`(runner가 만든다)으로 호출하고, zod로 다시 검증한다(V-6). 같은 공급자·모델로 1회 재시도한다.

4. **스트리밍** `streaming/`: 공급자 정규화 delta를 받는다. 첫 토큰 뒤 오류는 `beforeFirstToken = false`로 표시한다.

5. **로그(C-7)**: provider와 tier를 추가한다. 키는 절대 남기지 않는다.

6. 테스트: 공급자별 가짜 SDK·fetch와 녹화 응답을 쓴다(성공, 스트림, usage, C-11.2 각 행). 실제 호출은 하지 않는다.

## 계약 — API (`src/server/jobs/`, 라우트, contracts)

1. **문맥 인터페이스** (S3b가 실제 구현을 붙인다)
   ```ts
   interface ProviderContextSource { forUser(userId): Promise<{ provider, connectionTier, keyStatus } | null> }   // 작업 생성 시 고정
   interface KeySource { forJob(jobId): Promise<string> }   // 단계마다, 없으면 throw ProviderError('key_missing')
   interface KeyStatusReporter { markInvalid(jobId): Promise<void> }   // key_invalid 시
   ```
   S3a에서는 테스트용 가짜와 로컬 개발용 env 기반 구현(`AI_DEV_PROVIDER`, `AI_DEV_API_KEY`, 개발 환경 전용)을 둔다. 개발 환경 구현은 production에서 throw한다.

2. **원장 코드 제거**: `ledger.ts`와 예약·정산 호출. `complete_ai_job`은 새 시그니처를 쓴다.

3. **사용 기록**: 공급자 호출마다(재시도 각 시도, 실패 포함) `ai_usage_records` 1행.
   - 비용은 가격표에서 계산한다. 순수 함수 `estimateCostUsd(usage, priceRow)`이고 장문 구간을 반영한다.
   - 가격표 조회는 요청 단위로 캐시한다.
   - 재사용(input_hash)으로 호출하지 않으면 기록하지 않는다.

4. **재시도 C-11.3**
   - 단계 안에서 `ProviderError`가 나면 `retryPolicy`로 판단한다.
   - 재시도 가능하고 작업 대기 합계가 120초 미만이면 다음 값을 쓰고 종료한다(함수 안에서 기다리지 않음).
     - `status = queued`, `next_run_at`, `progress.waiting_retry_until`
     - `retry_count += 1`, `retry_wait_total_ms += 대기`, `run_generation += 1`
   - 대기 시간은 `Retry-After`가 있으면 그 값, 없으면 백오프 표 + 0~1초 무작위다.
   - 재시도하지 않거나 상한에 닿으면 최종 실패로 끝낸다. `retry_after`(분당 한도와 장애 → 다음 대기, 최소 1분)나 `quota_resets_at`(일일 한도)을 기록한다.
   - `key_invalid`면 `KeyStatusReporter.markInvalid`를 부른다.
   - 스트리밍은 `beforeFirstToken`일 때만 재시도한다.

5. **깨우기 (B-4)**
   - 작업 상태 조회(GET)가 `queued`이고 `next_run_at <= now`인 작업을 발견하면 실행을 이어 간다(기존 지연 이어 실행 경로를 확장).
   - 크론 `/api/cron/ai-jobs`는 `sweep_stalled_ai_jobs`와 `claim_due_ai_jobs`를 부른다. 작업마다 그 사용자의 app_ai_writer 클라이언트로 실행한다. service role은 이 크론 모듈 안에서만 쓴다.

6. **무료 등급 (C-12)**
   - 레지스트리에 순차 모드를 둔다. 병렬 단계를 순차 단계 목록으로 펼칠 수 있게 한다.
   - 호출 간격: 같은 사용자·공급자의 마지막 `ai_usage_records.occurred_at`에서 상수(`FREE_TIER_MIN_INTERVAL_MS = 6000`)가 지나지 않았으면 `next_run_at`으로 미룬다.

7. **작업 생성**
   - `ProviderContextSource`로 provider와 connection_tier를 고정한다. 등급(`model_tier`)은 job type별 레지스트리 값이다.
   - 같은 대상의 진행 중 작업이 있으면 그 작업을 `inProgress: true`로 돌려준다(23505 처리 포함).
   - 수동 재시도에서 진행 중 작업과 충돌하면 그 작업을 돌려준다(QA-S3-12 해소).

8. **상태 응답(useAiJob)** 추가 필드: `failureCause`, `errorCategory`(5값), `retryAfter`, `quotaResetsAt`, `waitingRetryUntil`, `provider`, `modelTier`, `connectionTier`.

9. **사용량 조회 액션**: `get_ai_usage_summary` 기반 `getAiUsageSummary({ periodMonth? })`. 기존 `getUsageSummary`는 삭제한다.

10. **contracts·enums**: v4 목록(`AI_PROVIDERS`, `MODEL_TIERS`, `CONNECTION_TIERS`, `AI_ERROR_CODES`, `ERROR_CATEGORIES` 5값, `FAILURE_CAUSES`, `USAGE_FEATURES` 10값, `USAGE_SOURCES`, `USAGE_OUTCOMES`). 원장 enum은 지운다.

11. **env**: `ANTHROPIC_API_KEY`를 뺀다. 개발용 `AI_DEV_PROVIDER`, `AI_DEV_API_KEY`는 선택이고 production에서는 무시한다. `.env.example`도 고친다.

## 인터페이스 합의 (api ↔ ai)
runner가 단계에 넘기는 `llm`은 다음 모양이다.

`createLlm({ provider, tier, connectionTier, keySource, jobId, onCall(usageRecord) })`

- 호출마다 키를 받아 어댑터를 부르고 `onCall`로 사용 기록을 넘긴다.
- 이 함수는 ai 소유(`src/server/ai/llm.ts`)다.
- 사용 기록 insert와 비용 계산은 api 소유다(`onCall` 구현).

## 진행
- db, ai, api 병렬. ai와 api는 서로의 노트를 읽어 인터페이스를 맞춘다. 충돌하면 리더가 정한다.
- 에이전트 정의는 원래 체크아웃(main) 것을 쓰므로, **이 워크트리의 갱신된 스킬·컨텍스트 파일을 읽으라고 지시한다.**
- QA는 2라운드다. 중점은 Q9(종료 경로·사용 기록·재시도 예약)와 Q8(enum)이다.

## 원격 브랜치 적용: 하지 않음 / 연결: UI 없음
