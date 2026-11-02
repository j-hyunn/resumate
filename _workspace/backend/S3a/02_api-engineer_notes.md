# S3a API 구현 노트

> 상태: 완료. `pnpm typecheck`, `pnpm lint`, `pnpm test`(41 파일 610개, 로컬 스택 통합 10개 포함), `pnpm build` 통과.
> 원장(예약·차감·해제) 코드는 모두 지웠다(D-34). 재시도는 함수 안에서 기다리지 않고 `next_run_at`으로 예약한다(C-11.3, B-4).

## 다른 담당자 요청과 결과
| 요청 | 결과 |
|------|------|
| db: sweep이 `next_run_at` 있는 queued를 건드리지 않음 | 반영됨(db 노트). 실행기의 지연 멈춤 감지도 같은 규칙 |
| db: `claim_due_ai_jobs` 조회 전용 | 반영됨 |
| db: app_ai_writer의 `ai_usage_records` select(호출 간격) | 반영됨 |
| db: 새 컬럼 insert/update grant, `failed → queued` 때 `retry_after`·`quota_resets_at` 비움 | 반영됨 |
| db: `period_month` 기본값(생성 타입에서 insert 선택 항목) | 반영됨 → 캐스트 제거 |
| ai: `retryPolicy`, `retryDelayMs`, `finalRetryAfter`, `RETRY_WAIT_TOTAL_CAP_MS` | ai 것을 그대로 쓴다(표 중복 없음, `src/server/jobs/retry.ts`) |
| ai: `createLlm`의 `onCall` await | 반영됨. 실행기 `onCall`은 throw하지 않는다(아래) |

## 엔드포인트 (파일)
| 작업 | 방식 | 파일 |
|------|------|------|
| 작업 상태 (`useAiJob`, 2초 폴링) | `GET /api/ai-jobs/{id}` → `{ data: AiJobStatusResponse }`. **due 작업 깨우기(B-4 주 경로)**, 지연 멈춤 감지, 끊긴 이어 실행 대체 | `src/app/api/ai-jobs/[id]/route.ts` |
| 중단 | `POST /api/ai-jobs/{id}/cancel` → 사용자 RPC `request_ai_job_cancel`. queued(재시도 대기 포함, `next_run_at` 무시)면 그 자리에서 canceled | `.../[id]/cancel/route.ts` |
| 다시 시도 | `POST /api/ai-jobs/{id}/retry` → 202 `StartAiJobResponse`. 같은 대상에 진행 중 작업이 있으면 그 작업(`inProgress: true`, QA-S3-12 해소) | `.../[id]/retry/route.ts` |
| 이어 실행(내부) | `POST /api/ai-jobs/{id}/continue` — HMAC 토큰, 202 후 `after()` | `.../[id]/continue/route.ts` |
| 크론 (안전망) | `GET /api/cron/ai-jobs` (`Bearer CRON_SECRET`): `sweep_stalled_ai_jobs` → `claim_due_ai_jobs(now, 50)` → 작업마다 continue 자기 호출(그 사용자의 app_ai_writer로 실행) | `src/app/api/cron/ai-jobs/route.ts`, `src/server/jobs/cron.ts` |
| 사용량 미터 | Server Action `getAiUsageSummary({ periodMonth?, includePrevious? })` → RPC `get_ai_usage_summary` | `src/server/actions/usage.ts`, `src/server/services/usage/index.ts` |

- 옛 `/api/cron/stalled-jobs`는 `/api/cron/ai-jobs`로 바꿨다(`vercel.json`은 배포 범위라 아직 없음).
- service role은 `src/server/jobs/cron.ts` 한 곳, RPC 2개만 부른다(테이블 직접 접근 없음).
- 기능 라우트(S4~)의 작업 시작: `createAppJobRunner(origin).startJob({ userId, jobType, target, applicationProjectId, inputHash, params, regenerate })`. **대상(target)을 반드시 넣는다**(DB 동시 실행 제한이 대상 기준).

## 계약 (`src/lib/contracts/`)
- `errors.ts` `AI_ERROR_CODES` v4 15개(C-11.1). `refused`, `model_unavailable` 삭제.
- `enums.ts`: `AI_JOB_TYPES`(+`key_verification`), `AI_PROVIDERS`, `MODEL_TIERS`, `CONNECTION_TIERS`, `ERROR_CATEGORIES` 5값, `FAILURE_CAUSES` 7값, `USAGE_FEATURES` 10값, `USAGE_SOURCES`, `USAGE_OUTCOMES`. 원장 enum(`USAGE_STATUSES`, `USAGE_REASONS`) 삭제.
- `ai.ts`
  - `errorCategoryOf`, `failureCauseOf` — DB generated 컬럼과 같은 표(단위 테스트 + 통합 테스트로 DB 값과 대조).
  - `isManuallyRetryable(code)` = input 범주와 `canceled`가 아니면 true(키·결제 원인은 연결을 고친 뒤 다시 시도).
  - `AI_ERROR_MESSAGES`는 코드별 한국어 문구. "사용량은 차감되지 않았습니다" 문구는 뺐다(BYOK에선 실패 호출도 토큰을 쓸 수 있음).
  - `AiJobStatusResponse` = `{ jobId, jobType, status, progress{stage,done,total}, partial, error{code,category,failureCause,message}|null, errorCategory, failureCause, retryAfter, quotaResetsAt, waitingRetryUntil, provider, modelTier, connectionTier, retryCount, cancelRequested, canRetry, updatedAt }`. `attemptCount`는 없앴다(내부 세대는 노출하지 않음). `retryAfter`·`quotaResetsAt`은 failed일 때만, `waitingRetryUntil`은 queued일 때만 값이 있다.
  - `StoredAiJobProgressSchema`(DB 형태, `waiting_retry_until` 포함)와 `AiJobProgressSchema`(응답 형태) 분리.
  - SSE `error` 이벤트: `{ code, category, failureCause, message, retryable, retryAfter, quotaResetsAt }`. `internal_error`는 system 범주. 알 수 없는 코드(예: v3 `refused`)는 `internal_error`로 바꾼다. `ProviderError`를 던지면 시각 정보가 이벤트에 실린다.
  - `AiUsageSummary`(DM 2.9.5 camelCase) + `GetAiUsageSummaryInputSchema`. 옛 `UsageSummary` 삭제.
- 화면 훅 영향: `useAiJob`의 `error.category` 값이 5값으로 바뀌었다(UI 패턴 문서는 v3 4값). 연결 단계에서 UI가 맞춰야 한다.

## 작업 흐름 (`src/server/jobs/`)
| 파일 | 역할 |
|------|------|
| `types.ts` | `JobStore`, `UsageStore`, `LlmCallRecord`, `LlmFactoryInput`, `StepContext`(`llm`, `provider`, `modelTier`, `connectionTier`, `sequential`, `callKeyPrefix`), `JobTypeDefinition`(`modelTier`, `freeTierSteps`), `RunnerDeps` |
| `provider-context.ts` | `ProviderContextSource`, `KeySource`, `KeyStatusReporter` 인터페이스 + 테스트 가짜 + 개발 env 구현(`AI_DEV_PROVIDER`, `AI_DEV_API_KEY`, `AI_DEV_CONNECTION_TIER`; production이면 throw) |
| `runner.ts` | 시작·실행·재시도 예약·깨우기·멈춤·취소 |
| `retry.ts` | `decideRetry` 순수 함수(ai의 정책 표 사용) |
| `cost.ts` | `estimateCostUsd`, job type → feature 표, KST 날짜 |
| `usage-recorder.ts` | `onCall` 구현: 가격 조회(실행 단위 캐시) → 비용 → insert(2회 시도, 실패 시 로그만) |
| `supabase-store.ts` / `supabase-usage.ts` | app_ai_writer로 ai_jobs / ai_usage_records·ai_price_tables |
| `app-runner.ts` | 운영 연결(`createLlm`, 개발 env 연결, `after()`, 자기 호출) |
| `cron.ts` | 크론 전용 service role |
| 삭제 | `ledger.ts`, `stalled-sweep.ts` |

### 수명 주기
1. `startJob`: `ProviderContextSource.forUser` → 없으면 409 `ai_not_connected`, 키 `invalid`면 409 `key_invalid`(작업 행 없음, `needs_check`는 허용) → 같은 대상 진행 중이면 그 작업(`inProgress`) → `input_hash` 재사용(같은 provider) → insert(`provider`, `model_tier` = 레지스트리 값(기본 `default`), `connection_tier`, `run_generation 1`) → 23505면 이긴 작업을 따라간다 → `after(runJob)`.
2. `runJob`: claim(`queued`이고 due — `next_run_at` 없거나 지남 → running, `next_run_at = null`) → 무료 등급이면 `freeTierSteps(params)` → 단계마다:
   - 60초 예산 확인(넘으면 queued + 이어 실행 자기 호출)
   - **무료 등급 호출 간격**: 같은 사용자·공급자의 마지막 `ai_usage_records.occurred_at` + 6초(`FREE_TIER_MIN_INTERVAL_MS`)가 아직이면 queued + `next_run_at`, 종료(`scheduled`). 재시도 횟수·세대는 바꾸지 않는다.
   - 단계 실행(마감·heartbeat·취소 감시는 S3과 같음). `llm`은 실행 단위로 한 번 만들고, 공급자 호출마다 `onCall` → 사용 기록 1행.
3. 실패 처리(C-11.3):
   - 분류: signal abort → canceled/timeout/lost, `AiError`·`ProviderError`는 그대로(공급자 호출 안의 미지 오류는 llm이 `provider_unavailable` + `unclassified`로 만든다), 그 밖 예외 → `stalled`, 재시도 없음(QA-S3a-02 사용자 확정). 둘 다 로그 `ai_job.step_error unclassified:true`.
   - `decideRetry`: `retryable` 아님(예: generateStructured가 V-6 재시도를 쓴 `schema_invalid`) / 스트림 첫 토큰 뒤(`beforeFirstToken = false`) / 호출당 한도 도달 → 최종 실패.
   - 대기 0(`schema_invalid`, `timeout`) → 같은 실행에서 즉시 재시도(`retry_count + 1`, `run_generation + 1`).
   - 대기 > 0 → `이번 실행 대기 합계 + 대기 ≤ 120초`면 `status = queued`, `next_run_at`, `progress.waiting_retry_until`, `retry_count + 1`, `retry_wait_total_ms + 대기`, `run_generation + 1`을 쓰고 종료. 넘으면 최종 실패.
   - 호출당 횟수는 `step_outputs._meta.retries[stage][code]`(단계 = 호출 단위, 무료 등급 단계는 호출 1회).
   - 최종 실패: `failed` + `error_code` + `retry_after`(rate_limited: 지금 + max(다음 대기, 1분), provider_unavailable: 지금 + 1분) / `quota_resets_at`(daily_quota_exhausted, 공급자 값) + `next_run_at = null`. `key_invalid`면 `KeyStatusReporter.markInvalid(jobId)`.
4. 성공: (draft_source_ranking만) output 저장 → `complete_ai_job(p_job_id, p_run_generation, p_progress)` 2회 시도. 둘 다 오류면 `failed / stalled`, 거절(`invalid_ai_job_transition`)이면 `lost`.
5. 단계 밖 실행기 오류(체크포인트 저장 실패, 정의 없음) → `failed / stalled` [가정, spec-gaps].
6. 깨우기(B-4): 상태 GET이 `queued && next_run_at <= now`를 보면 `after()`로 실행. 크론이 안전망. `next_run_at`이 있는 queued 작업은 멈춤으로 보지 않는다(사용자가 떠나면 다음 크론까지 대기).
7. 수동 재시도: `failed → queued` 조건부(run_generation), 새 실행 meta `{ runBase: gen+1, waitBase: 현재 retry_wait_total_ms, retries: {} }` → 완료 단계는 건너뛴다. 입력 범주는 409 `ai_job_not_retryable`.
8. 취소: queued(재시도 대기 포함)면 `ignoreNextRunAt`으로 점유해 canceled, running이면 heartbeat가 abort.

### 사용 기록 (C-13)
- `ai_usage_records` 1행 = 공급자 호출 1회(재시도 각 시도·실패 호출 포함). 행 값: feature(job type 표: `draft_source_ranking → career_description`, `writing_chat_turn → writing_chat`), job_type, ai_job_id, call_key, application_project_id, provider/model_tier/connection_tier(작업 값), model(실제 호출 모델 = 매핑 ID), 토큰 4종 + reasoning, usage_source, outcome, error_code(failed만), price_table_version, estimated_cost_usd. `occurred_at`은 llm이 준 호출 완료 시각.
- 키 조회 실패(`key_missing`)처럼 공급자 호출이 없으면 기록하지 않는다. `input_hash` 재사용도 기록 없음.
- 가격: `ai_price_tables`에서 `provider, model, effective_from <= KST 오늘` 최신 버전. 실행(invocation) 단위 캐시.
- 비용: `estimateCostUsd` — 장문 기준은 프롬프트 전체(입력 + 캐시 읽기 + 캐시 쓰기). 장문 캐시 단가가 없으면 일반 캐시 단가, 캐시 단가가 없으면 그 구간 입력 단가. 소수 6자리 반올림.
- 기록 실패: insert 2회 시도 후 로그 `ai_usage.record_failed`. 작업은 실패시키지 않는다(이미 쓴 토큰을 다시 쓰게 하지 않음). 가격 없음 → `unpriced` / 0.
- 키는 작업 행·단계 결과·사용 기록·로그·오류 어디에도 들어가지 않는다(테스트로 확인).

### env
- `ANTHROPIC_API_KEY` 삭제. `AI_DEV_PROVIDER`(enum), `AI_DEV_API_KEY`, `AI_DEV_CONNECTION_TIER`(free/paid) 선택값. `NODE_ENV=production`이면 파싱 전에 버린다. `.env.example` 갱신.
- `src/server/db/errors.ts`: 원장 RAISE 이름 삭제, `invalid_now`·`invalid_limit`(claim_due) → `internal_error`.

## 테스트
- `src/server/jobs/runner.test.ts`(45): 실제 `createLlm` + 각본 어댑터(`src/test/job-fakes.ts`). 모든 경우 작업 상태·예약 필드·호출 수 = 사용 기록 수를 검사.
  - 시작: 미연결, 키 무효/needs_check, 공급자·등급 고정, 같은 대상 중복(경쟁 포함), 재사용(기록 없음)·다시 생성, 공급자별 재사용.
  - 성공: 호출별 기록·비용·가격 캐시·키 비노출, draft_source_ranking feature.
  - 재시도: rate_limited 예약 → 폴링 깨우기, rate_limited 4회 후 실패(retry_after), provider_unavailable 2회 후 실패, Retry-After 사용 + 120초 상한, 호출별 횟수, schema_invalid 즉시 1회, retryable:false schema_invalid, timeout(멈춘 호출) 1회, daily quota, key_invalid(키 무효 표시), key_missing(기록 0), billing/model/input/safety(재시도 0), 미분류 예외, 스트림 첫 토큰 뒤 끊김, 첫 토큰 전 오류 재시도.
  - 취소(실행 중·재시도 대기 중·시작 전), 멈춤(대기 작업은 제외·깨우기), 좀비 실행기, complete 실패, 체크포인트 실패, 기록 insert 실패(작업 성공 유지)·1회 실패 재시도, 가격 없음, 무료 등급(순차 단계·6초 간격·작업 간 간격·유료는 병렬), 수동 재시도(완료 단계 유지·예산 재시작·입력 범주 409·대상 충돌·동시 재시도), 60초 예산 yield.
- `src/server/jobs/support.test.ts`(35): 상태 응답 계약, DB generated 값 대조표, feature 표, SSE 오류 이벤트, 비용(장문·대체 단가), KST 경계, insert 행 모양, `decideRetry` 표, 개발 env 구현(production throw·키 비노출), 사용량 요약 매핑.
- `src/server/jobs/runner.integration.test.ts`(10, 로컬 스택 — 없으면 skip): 실제 ai_jobs / ai_usage_records(시드 가격으로 비용) / generated 컬럼 / 동시 실행 인덱스 / 사용자 취소 RPC / sweep이 대기 작업을 건너뜀 / claim_due 조회 전용 / 수동 재시도 가드 / 무료 등급 간격(실제 기록 조회) / `get_ai_usage_summary`.
- `src/server/sse.test.ts`, `src/server/env.test.ts` v4로 갱신.

## 스펙 차이·가정 (spec-gaps.md 2026-10-28 S3a 항목)
- 120초 상한은 "합계 + 다음 대기 ≤ 120초"일 때만 예약.
- 수동 재시도는 호출당 횟수·대기 예산을 새로 시작(컬럼은 누계 유지).
- 실행기 자체 오류는 `stalled`.
- 가격 없는 모델은 `unpriced` / 0.
- 시작 거부 코드 `ai_not_connected` / `key_invalid`(409).
- 대상 없는 작업은 DB 보장이 없음 → 기능 슬라이스는 대상 필수. `key_verification` 대상은 S3b에서 정한다.

## 남은 일 (S3b 이후)
- S3b: `ProviderContextSource`(profiles.active_ai_provider + ai_provider_keys), `KeySource`(app_key_reader → `get_provider_key_secret` → 복호화), `KeyStatusReporter`(`mark_provider_key_invalid`)를 `app-runner.ts`의 `connections()`에 붙인다. 동의(`ai_data_use_consents`) 확인도 시작 단계에 추가.
- 수동 재시도 때 사용자의 연결 상태(키 삭제·무효)를 미리 확인하지 않는다 — 지금은 실행 단계에서 `key_missing`으로 끝난다. S3b에서 시작과 같은 검사를 넣을지 정한다.
- `vercel.json` 크론 등록(배포 범위). Hobby 플랜은 하루 1회.
- UI 연결 때 `useAiJob`의 범주 5값·`failureCause`·`waitingRetryUntil` 반영.

## QA 1차 반영 (2026-10-28, `03_backend-qa_report.md`)
| 이슈 | 반영 |
|------|------|
| QA-S3a-01 (api 쪽) | `sse.ts` `normalizeErrorEvent`가 파이프라인 `error` 이벤트의 `retryAfter`·`quotaResetsAt`을 ISO로 싣고, `failureCause`·`category`는 코드에서 계산한다. ai가 같은 이름으로 내보내는 것을 **실제 경로 테스트**(`createFakeLlm` → `runStructuredStream` → `createSseResponse`, 일일 한도·분당 한도)로 확인했다 |
| QA-S3a-02 | **사용자 확정 반영**: `classifyStepError` — `AiError`/`ProviderError`는 그대로, 그 밖의 예외(우리 버그·DB 오류)는 `stalled`(재시도 0, 로그 `unclassified`). 공급자 호출 안의 미지 오류는 llm이 `ProviderError("provider_unavailable", { unclassified })`로 바꾸므로 2회 재시도 유지. 테스트 양쪽 |
| QA-S3a-03 | ai의 `Llm.settle(timeoutMs)` + `createLlm({ signal })` 하나로 정리했다. 실행기는 **단계 시도마다** 그 시도의 마감·취소 signal을 건 `Llm`을 만들고(단계가 `request.signal`을 빠뜨려도 멈춤), `runJob`의 모든 종료 경로(`try/finally`)에서 만든 `Llm` 전부에 `settle(USAGE_SETTLE_GRACE_MS = 3초)`를 기다린다. 상한을 넘기면 llm이 남은 호출을 실패 1행으로 강제 기록하고, 실행기는 로그 `ai_job.usage_settle_timeout`을 남긴다. 실행기 쪽 중복 추적은 지웠다. `RunnerDeps.settleLlm` 추가. 테스트: 신호 무시 단계의 늦은 호출 기록, 대기 상한, signal 없이 멈춘 호출의 timeout |
| QA-S3a-04 | 단계 실패 처리에서 재시도 판단 전에 `heartbeat`로 취소 요청을 확인한다. 요청이 있으면 `canceled`로 끝내고 재시도(즉시·예약)를 하지 않는다. 세대가 바뀌었으면 `lost`. `key_invalid`면 취소와 무관하게 키 무효 표시는 한다. 테스트: rate_limited(예약형), schema_invalid(즉시형) |
| QA-S3a-07 | `startJob`의 `inputHash`가 함수도 받는다: `({ provider, model, modelTier, connectionTier }) => string \| null`. 실행기가 공급자를 고정하고 `model = resolveModel(provider, 등급)`을 구한 뒤 호출한다. `ai_jobs.model`도 기본값으로 이 모델을 넣는다. 기능 라우트 사용 예: `inputHash: ({ provider, model }) => computeInputHash({ feature, promptVersion, provider, model, careerSnapshotHash, requirementsHash, params })` |
| QA-S3a-08 | 규칙만 문서화(`registry.ts` 머리 주석): 유료 등급 병렬 단계는 호출별 결과를 스스로 저장하고 재시도 때 건너뛰거나, 호출 1개 = 단계 1개로 나눈다. S5(AI-02, AI-06)에서 확인. 실행기 변경 없음 |
| QA-S3a-09 | `proxy-session.test.ts`, `ai-writer.integration.test.ts`의 `ANTHROPIC_API_KEY` stub 삭제(`env.test.ts`의 것은 "버려지는지" 검사라 유지) |

- 수동 재시도의 대기 예산·횟수 새로 시작은 **사용자 확정**(spec-gaps 문구 갱신).
- 검사: typecheck, lint, test(통합 포함), build 통과.
