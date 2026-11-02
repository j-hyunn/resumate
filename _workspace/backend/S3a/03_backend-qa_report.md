# S3a 백엔드 QA 리포트 (라운드 2 · 최종)

> 라운드 1 내용은 아래에 그대로 두었다. 라운드 2 재확인 결과는 이 절에 적었다.

## 판정 (라운드 2)
**S3a `done` 가능.**
- Major 3건(01~03)과 Minor 6건 중 5건(04~07, 09)의 수정을 확인했다.
- 08은 규칙 문서화로 S5에 넘긴다.
- 수정에서 생긴 회귀를 찾다가 새 Minor 1건(QA-S3a-10)을 발견했다. 사용 기록이 잘릴 수 있는 좁은 경로이며, 리더에게 넘긴다.
- 사용자 결정 2건(QA-S3a-02 분리, 수동 재시도 예산 새로 시작)은 `decisions.md` 2026-10-28에 반영된 것을 확인했다.

## 라운드 2 검사 실행 결과 (최종)
`run-checks.sh --build`, 로컬 스택 실행 중

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | |
| lint | 통과 | |
| vitest | 통과 | 42파일 629개, skip 0. 통합 테스트 포함(라운드 1 대비 +19, 회귀 테스트) |
| build | 통과 | |
| pgTAP | 통과 | Files=16, Tests=543 |

## 라운드 2 이슈 상태
| ID | 심각도 | 담당 | 상태 | 확인 근거 |
|----|--------|------|------|-----------|
| QA-S3a-01 | Major | ai, api | 수정됨(확인 완료) | 확인 내용은 아래 |
| QA-S3a-02 | Major | api | 수정됨(확인 완료) | 확인 내용은 아래 |
| QA-S3a-03 | Major | ai, api | 수정됨(확인 완료) | 남은 틈은 QA-S3a-10 |
| QA-S3a-04 | Minor | api | 수정됨(확인 완료) | 확인 내용은 아래 |
| QA-S3a-05 | Minor | ai | 수정됨(확인 완료) | 확인 내용은 아래 |
| QA-S3a-06 | Minor | ai | 수정됨(확인 완료) | 확인 내용은 아래 |
| QA-S3a-07 | Minor | api | 수정됨(확인 완료) | 확인 내용은 아래 |
| QA-S3a-08 | Minor | api | 문서화 → S5 확인 | `registry.ts` 머리 주석에 규칙이 있다(병렬 호출별 결과 저장, 또는 호출 1개 = 단계 1개). 실행기는 바뀌지 않았다 |
| QA-S3a-09 | Minor | api | 수정됨(확인 완료) | grep 결과 `ANTHROPIC_API_KEY`는 `env.test.ts`(버려지는지 검사)에만 남았다 |
| **QA-S3a-10** | Minor | ai | **열림(신규) → 리더** | 아래 |

### 수정 확인 내용

**QA-S3a-01**
- 파이프라인 `error` 이벤트에 `retryAfter`·`quotaResetsAt`(ISO)이 생겼다(`streaming/events.ts`).
- `structured-stream.ts:100-115` `toErrorEvent`가 이 값을 `ProviderError`에서 채운다.
- `sse.ts:37-47`이 같은 이름으로 읽는다.
- 실제 경로 테스트가 있다: `createFakeLlm` → `runStructuredStream` → `createSseResponse`.

**QA-S3a-02**
- `runner.ts:113-122`:
  - `AiError`·`ProviderError`는 그대로 둔다. 공급자 호출 안의 미분류 오류는 llm이 `provider_unavailable`(unclassified)로 바꾸며, 2회 재시도한다.
  - 그 밖의 예외는 `AiError("stalled", retryable:false)`로 바꾸고 로그에 `unclassified`를 남긴다.
- 회귀 확인:
  - abort가 먼저 판정된다. `AppError`(DB 매핑 오류)도 `stalled`로 간다.
  - 테스트 `runner.test.ts:435`가 있다(`retryCount 0`, `retryAfter null`).

**QA-S3a-03**
- `createLlm({ signal })`이 `AbortSignal.any([run, request])`로 모든 호출에 signal을 건다. 단계가 `request.signal`을 빠뜨려도 멈춘다.
- 실행기는 단계 시도마다 llm을 만들고, `runJob`의 `try/finally`(`runner.ts:312-323`)에서 모든 llm에 `settle(3초)`를 기다린다. 성공·실패·취소·yield·lost 경로가 모두 포함된다.
- 상한을 넘기면 남은 호출을 `failed` + `canceled`/`timeout` + `unavailable` 1행으로 강제 기록한다. 늦게 온 종료는 버린다.
- 회귀 확인:
  - 중복 기록이 없다(`recorded` 플래그).
  - yield 경로는 진행 중 호출이 없어 바로 끝난다.
  - 마지막 settle까지 합쳐도 60초를 넘지 않는다(55 + 3).

**QA-S3a-04**
- 실패 처리에서 재시도 판단 전에 heartbeat로 취소를 확인한다(`runner.ts:433-440`).
- 취소가 있으면 `canceled`, 세대가 바뀌었으면 `lost`다.
- `key_invalid` 표시는 취소와 무관하게 먼저 한다.
- 즉시형·예약형 재시도 모두 테스트가 있다.
- 의도된 동작 변화: 재시도 불가 실패(예: 일일 한도)와 취소가 겹치면 결과는 `canceled`다(사용자 요청 우선).

**QA-S3a-05**
- `ProviderError`가 SDK 오류를 `cause`로 갖지 않는다. 클래스 이름만 `sdkErrorName`에 남고, `toJSON`은 분류 필드만 내보낸다.
- 세 어댑터 모두 메시지·JSON·`inspect`·stack에 키와 끝 4자리가 없음을 테스트한다(`openai.test.ts:196-206`, `gemini.test.ts:202-208`).

**QA-S3a-06**: `providers/models.test.ts`가 시드 마이그레이션을 읽어, 3개 버전 모두에 `allMappedModels()` 9개가 있는지 확인한다.

**QA-S3a-07**
- `startJob`의 `inputHash`가 `(ctx) => string | null`도 받는다.
- 공급자를 고정하고 `model = resolveModel(provider, 등급)`을 구한 뒤 호출한다(`runner.ts:162-166`). 진행 중·재사용 조회가 같은 해시를 쓴다.

### QA-S3a-10 [Minor] `settle()` 상한이 지났을 때 "기록 중"인 호출의 insert를 기다리지 않음
- 담당: ai-pipeline-engineer
- 근거:
  - `llm.ts` `finish()`는 `recorded = true`를 먼저 세운 뒤 `onCall`(가격 조회 + insert, 2회 시도)을 기다리고, `finally`에서야 `open`에서 뺀다.
  - `settle()`은 상한(3초)이 지나면 `open`에 남은 것마다 `finish(t, abandoned)`를 부른다. 그런데 이미 기록 중인 호출에는 이 `finish`가 아무것도 하지 않고 바로 돌아간다.
  - 결과적으로 insert가 3초 넘게 걸리면(DB 지연·1회 재시도) `settle`은 insert가 끝나기 전에 끝나고, `after()` 종료로 그 행이 잘릴 수 있다. 원래 QA-S3a-03의 틈이 좁게 남은 것이다.
  - 부수 사항: 상한 뒤 강제 기록된 호출은 실제 토큰이 보고되어도 0(`unavailable`)으로 남는다. 의도된 선택이며 문서에 있다.
- 수정 제안:
  - 상한 뒤에는 `recorded` 호출의 `t.settled`도 짧은 추가 상한(예 2초)으로 기다린다.
  - 또는 강제 기록 대상을 `!t.recorded`로 한정하고, 나머지는 `settled`를 기다린다.
  - "느린 onCall + 상한 초과" 테스트를 하나 추가한다.
- 상태: 열림 → 리더(수정 라운드 한도 도달)

### 참고 (이슈 아님)
- SSE 경로의 `rate_limited`는 Retry-After 헤더가 없으면 `retryAfter`가 null이다. 작업 경로는 `finalRetryAfter`로 계산한다.
- SSE 자동 재시도·안내 규칙은 S4에서 정한다(spec-gaps 2026-10-28 "SSE 첫 토큰 전 자동 재시도 주체").

---

# 라운드 1 (원문)

> 범위: DB(마이그레이션 5개·pgTAP), AI(공급자 어댑터·`createLlm`·오류·스키마), API(실행기·재시도·사용 기록·크론·상태 응답). 코드는 고치지 않았다.
> 기준: DM §2.9.1~2.9.5, §5, A.15~A.16 / AI C-6, C-10~C-13 / `S3a/00_model-mapping.md` / `decisions.md` 2026-10-28 / `spec-gaps.md` 2026-10-28.

## 판정
**조건부 통과 — Major 3건을 고치면 `done` 가능.** 검사는 전부 통과했다.
- 경계면 대부분이 맞는다.
  - DB CHECK ↔ TS enum ↔ C-11.1 표가 15/5/7값 모두 일치한다.
  - 가격 시드 27행이 매핑표와 행 단위로 일치한다.
  - 원장 객체는 DB·코드에서 모두 사라졌다.
  - 실행기의 모든 출구가 종료 상태이거나 `next_run_at`으로 예약된다. 함수 안에서 기다리는 경로는 없다.
- Major 3건:
  1. SSE 오류 이벤트에서 `retryAfter`·`quotaResetsAt`가 빠진다(QA-S3a-01).
  2. 단계 안의 우리 쪽 버그가 "공급자 장애"로 보이고 재시도된다(QA-S3a-02).
  3. 중단·시간 초과된 호출의 사용 기록이 함수 종료로 잘릴 수 있다(QA-S3a-03).
- 이전 열린 이슈:
  - QA-S3-06은 수정을 확인했다(`career-rows.ts:14` `updated_at`).
  - QA-S3-12는 해소됐다(`runner.ts:216-228`, 테스트 있음).
  - QA-S3-10·11은 원장이 없어져 폐기한다.

## 검사 실행 결과
`run-checks.sh --build`, 로컬 스택 실행 중(colima)

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | `next typegen && tsc --noEmit` |
| lint | 통과 | |
| vitest | 통과 | 41파일 610개, skip 0. `runner.integration.test.ts`(로컬 스택) 포함 |
| build | 통과 | Next 16.4.2 |
| pgTAP | 통과 | Files=16, Tests=543 |
| 생성 타입 | 통과 | `database.types.ts`에 `run_generation`, `failure_cause`, 장문 캐시 컬럼 2개, `claim_due_ai_jobs`, 3인자 `complete_ai_job`이 있다. `usage_events`, `attempt_count`는 0건 |
| Gemini LA 자정 계산 | 통과 | QA 임시 테스트로 DST 경계 7건을 확인한 뒤 파일은 지웠다(예: 11-01 07:30Z → 11-02 08:00Z, 03-14 10:00Z → 03-15 07:00Z) |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM 2.9 ↔ 마이그레이션 | 통과(편차는 기록됨) | — |
| Q2 | 마이그레이션 ↔ 타입 ↔ 쿼리 | 통과 | — |
| Q3 | RPC ↔ 호출부 | 통과 | QA-S3a-07(설계) |
| Q4 | raise 코드 ↔ 오류 매핑 | 통과 | — |
| Q5 | 계약 ↔ 핸들러 | 통과 | — |
| Q6 | SSE 이벤트 | **이슈** | QA-S3a-01 |
| Q7 | AI 출력 ↔ 저장 | 해당 없음 | — |
| Q8 | enum DB ↔ TS | 통과 | — |
| Q9 | 작업 종료 경로·사용 기록 | **이슈** | QA-S3a-02, 03, 04, 08 |
| Q10 | 보안·개인정보 | 통과(테스트 보강 필요) | QA-S3a-05, 06 |
| Q11 | UI ↔ 백엔드 | 해당 없음 | — |

Q7은 기능 출력이 아직 없다. 근거 필드 기본값 변경은 기존 검증기 테스트가 그대로 통과한다.
Q11은 UI 화면이 아직 없다. 단, UI 패턴 문서가 v3이다(스펙 차이 절 참조).

### Q1/Q2/Q8 세부
**`ai_jobs` 컬럼**
- `provider`, `model_tier`, `connection_tier`는 not null·CHECK이고 기본값이 없다(`…000200:56-80`).
- `retry_count`, `next_run_at`, `retry_wait_total_ms`, `quota_resets_at`, `retry_after`가 있다.
- `job_type`은 11값(+`key_verification`)이다.

**`error_code` 15값 → 범주·원인 (`…000200:89-118`)**
DB generated 컬럼, `ai.ts:26-52`(TS), C-11.1 표 세 곳이 모두 같다. pgTAP는 15개 전부를 검사하고, `support.test`와 통합 테스트도 DB 값과 대조한다.

| error_code | error_category | failure_cause |
|------------|----------------|---------------|
| rate_limited, daily_quota_exhausted | provider_limit | 코드와 같은 값 |
| billing_required, key_invalid, model_not_available | user_account | 코드와 같은 값 |
| key_missing | user_account | null |
| provider_unavailable | transient | provider_unavailable |
| input_too_long, safety_blocked | input | input_rejected |
| insufficient_data, not_a_jd | input | null |
| schema_invalid, timeout, stalled, canceled | system | null |

**인덱스·RPC**
- 동시 실행 제한 `(user_id, job_type, target_type, target_id) where queued/running`은 DM과 같다.
- 재사용 인덱스에 provider가 들어 있다.
- `complete_ai_job(p_job_id, p_run_generation, p_progress)`는 생성 타입·`supabase-store` 호출과 일치한다.
- `sweep_stalled_ai_jobs`는 `next_run_at`이 있는 queued 작업을 제외하며, 실행기 `isStalled`(`runner.ts:562-567`)와 같은 규칙이다.

**`ai_usage_records` (`…000300`)**
- DM 2.9.2 컬럼·CHECK와 일치한다.
  - feature 10값은 `USAGE_FEATURES`와 같다.
  - `usage_source`·`outcome`이 있다.
  - 토큰 `unavailable` → 0 CHECK가 있다.
  - `period_month`는 트리거가 KST로 계산한다.
- FK(set null)는 S5로 미뤘다(계획대로).

**`get_ai_usage_summary`**: JSON 모양이 DM 2.9.5와 같다. `services/usage` 매핑도 키별로 대조했다.

**원장 삭제**
- 함수 7개와 테이블 2개를 지웠다(`…000100`). pgTAP가 부재를 검사한다.
- 코드 grep 결과: `usage_events`, `reserve_usage`, `attempt_count`, `REFUSAL_FALLBACK`, `ANTHROPIC_API_KEY`, `model_unavailable`가 운영 코드에서 0건이다. 남은 것은 테스트 잔재 2건(QA-S3a-09)뿐이다.

**가격 시드 (`…000400:52-…`) ↔ `00_model-mapping.md` §2**
- 9모델 × 단가 4종 × 장문 구간을 행 단위로 대조했다. 모두 일치한다.
- 버전별로 바뀌는 값도 일치한다.
  - `v2026-12-01`: argon 4.00 / 0.20 / 20.00
  - `v2027-01-01`: 3.8-flash 1.50 / 0.15 / 7.50, argon은 12-01 값 유지
- 숫자 정밀도(`numeric(10,4)`)는 0.075를 그대로 담는다.

**비용 함수 `cost.ts:20-41`**
- 장문 판정은 프롬프트 전체(입력 + 캐시 읽기 + 캐시 쓰기)가 기준값을 넘을 때다.
- 장문 캐시 단가가 null이면 일반 캐시 단가를 쓰고, 캐시 단가가 없으면 그 구간의 입력 단가를 쓴다(과소 추정 방지).
- 마이크로달러로 반올림한다.
- 가격은 `effective_from <= KST 오늘` 중 최신 버전이며, 실행 단위로 캐시한다.

### Q9 종료 경로 대조표 (`runner.ts`, `retry.ts`, `errors.ts`)
| 경로 | 결과 | 사용 기록 | 테스트 |
|------|------|-----------|--------|
| 성공 | `complete_ai_job` 2회 시도. 실패하면 `failed/stalled`, 거절되면 lost | 호출당 1행 | 있음 |
| `rate_limited` | 4회(2/4/8/16초 + 지터) → queued + `next_run_at` + `waiting_retry_until`. 최종 실패 시 `retry_after` = 지금 + max(다음 대기, 1분) | 시도당 1행 | 있음 |
| `provider_unavailable` | 2회(2/4초) → 최종 실패 시 `retry_after` = 지금 + 1분 | 시도당 1행 | 있음 |
| Retry-After | 공급자 값을 대기로 쓴다. `대기 합계 + 다음 대기 > 120초`면 최종 실패 | 시도당 1행 | 있음 |
| `schema_invalid` / `timeout` | 같은 실행에서 즉시 1회(세대 + 1). `generateStructured`가 V-6 재시도를 쓴 뒤 던진 오류는 재시도하지 않음 | 시도당 1행 | 있음 |
| 일일 한도 | 재시도 0회. `quota_resets_at` = 공급자 값(Gemini는 LA 자정) | 1행 | 있음 |
| `key_invalid` | 재시도 0회. `markInvalid` 호출 | 1행 | 있음 |
| `key_missing` | 키 조회에서 실패. 공급자 호출 없음 | **0행** | 있음 |
| billing / model / input / safety | 재시도 0회 | 1행 | 있음 |
| 취소: queued(시작 전) | 그 자리에서 canceled | 0행 | 있음 |
| 취소: 재시도 대기 중 | `ignoreNextRunAt`으로 점유 → canceled | 0행 | 있음 |
| 취소: running | heartbeat abort → canceled | 1행. 단, QA-S3a-03 | 있음 |
| 멈춤 | 상태 조회 지연 감지 + sweep. 예약 대기 queued는 제외 | — | 있음 |
| 좀비 실행기 | 모든 쓰기가 `run_generation` 조건 → lost | — | 있음 |
| 미분류 예외 | `provider_unavailable` + `unclassified` → 2회 재시도 | 0행(공급자 호출이 아님) | 있음 · **QA-S3a-02** |
| 첫 토큰 뒤 스트림 끊김 | 재시도하지 않음(`beforeFirstToken = false`) | 마지막 usage 1행 | 있음 |
| 사용 기록 insert 실패 | 2회 시도 후 로그. 작업은 성공 유지 | 손실 가능(가정) | 있음 |
| 무료 등급 간격 | 6초 이내면 queued + `next_run_at`. 재시도 횟수·세대는 그대로 | — | 있음 |
| 60초 예산 | 55초 / 단계 45초 → yield + continue 자기 호출. 실패하면 폴링 대체(10초) | — | 있음 |
| 수동 재시도 | `failed → queued` 조건부(세대). 호출당 횟수·대기 예산은 새로 시작. 같은 대상에 진행 중 작업이 있으면 그 작업 반환 | — | 있음 |
| 깨우기 | 상태 GET(`isDue` → `after`)이 주 경로, 크론 `claim_due_ai_jobs` → continue가 안전망 | — | 있음 |

### 어댑터 (C-10.2, C-11.2)
**SDK 재시도 끔**
- OpenAI·Anthropic: `maxRetries: 0`
- Gemini: `retryOptions.attempts: 1` — SDK 타입 주석상 "0 또는 1이면 재시도 없음"을 확인했다.

**자동 대체 없음**: `fallbacks`·`betas`가 없음을 테스트가 검사한다.

**정본 스키마**
- 루트는 object이고, 모든 객체는 `additionalProperties:false`, 모든 키가 required다.
- nullable은 `anyOf [T, null]`이다.
- `const`는 `enum`으로 바꾼다.
- 깊이는 5 이하이고 `$ref`는 금지한다.
- Gemini `responseJsonSchema`는 SDK 주석상 `anyOf`, `enum`, `additionalProperties`, `propertyOrdering`을 지원한다. C-10.2의 "Gemini는 anyOf 미사용"과는 다르다(스펙 차이 절).

**오류 매핑**: C-11.2 표의 각 행과 spec-gaps에 기록한 새 코드를 세 어댑터에서 대조했다.
- OpenAI 잔액·지출 한도 → `billing_required`
- OpenAI 403 지역 → `billing_required`
- Gemini 402 → `billing_required`, `quota_exceeded` → `daily_quota_exhausted`, 한도 0 → `model_not_available`
- Claude 402·529·스트림 중 `overloaded_error`

**스트리밍 usage**
- OpenAI는 종료 이벤트에서 받는다. 중간에 끊기면 `unavailable`이며, C-13과 같다.
- Claude는 `message_start`·`message_delta`를 누적한다.
- Gemini는 조각마다 받는다.

**키 검증**: 1·2단계, `limited` / `rejected` 판정이 R-38과 같다.

## 이슈

### QA-S3a-01 [Major] SSE 스트림 오류 이벤트에서 `retryAfter`·`quotaResetsAt`이 빠짐
- 담당: ai-pipeline-engineer(이벤트 타입·`toErrorEvent`), api-engineer(테스트)
- 근거:
  - `src/server/ai/streaming/events.ts:24`의 파이프라인 `error` 이벤트 타입은 `{ code, message, retryable }`뿐이다.
  - `structured-stream.ts:86,100-106`은 `ProviderError`를 잡아 이 모양으로 바꾸므로 시각 정보가 사라진다.
  - 반대편 `src/server/sse.ts:37-47` `normalizeErrorEvent`는 `e.retryAfter`·`e.quotaResetsAt`을 읽지만 늘 없으니 null을 보낸다.
  - `sse.test.ts:31`은 "throw" 경로만 검사한다. 실제 파이프라인은 throw하지 않고 `error` 이벤트를 yield한다.
- 영향: 스트리밍 기능(AI-03·04·12)에서 일일 한도 초기화 시각(F-AI-08 (2))과 "N분 후 다시 시도"(원인 1·6)를 화면에 보일 수 없다.
- 수정 제안:
  - 파이프라인 `error` 이벤트에 `retryAfter?: string | null`, `quotaResetsAt?: string | null`을 더한다.
  - `toErrorEvent`가 `ProviderError`이면 이 값을 채운다.
  - `runStructuredStream` → `createSseResponse` 경로 테스트를 하나 추가한다(일일 한도 → `quotaResetsAt` ISO).
- 상태: 열림

### QA-S3a-02 [Major] 단계 안의 비 AI 예외(우리 버그·DB 오류)가 `provider_unavailable`로 분류되어 2회 재시도되고 "공급자 장애"로 표시됨
- 담당: api-engineer(규칙은 사용자 확인 필요)
- 근거:
  - `src/server/jobs/runner.ts:99-108` `classifyStepError`는 `AiError`가 아닌 모든 예외를 `ProviderError("provider_unavailable", { unclassified: true })`로 바꾼다.
  - 여기에는 경력 팩 조회 실패, 검증기 TypeError, Supabase 오류가 모두 들어간다.
  - 같은 실행기가 단계 밖 오류는 `stalled`로 끝낸다(`runner.ts:316-318, 442-446`). 근거로 든 spec-gaps "실행기 자체 오류" 항목의 이유가 "`provider_unavailable`로 두면 화면에 '공급자 장애'가 잘못 보이기 때문"이다. 두 결정이 서로 어긋난다.
- 영향:
  - 사용자는 F-AI-08 (6) "공급자 장애"를 보고 공급자나 키를 의심한다(공급자를 바꿔도 같은 실패).
  - PRD 6.6 실패율에서 `transient`로 잡힌다.
  - 아무 효과 없는 재시도가 2회(약 6초 이상) 생긴다.
  - 어댑터의 미분류 공급자 오류(400 invalid_request 등, `shared.ts:66-69`)도 같은 문제다. 우리 요청이 잘못된 400을 재시도한다.
- 수정 제안:
  - `ProviderError`(어댑터가 만든 것, 미분류 포함)만 `provider_unavailable`로 둔다.
  - 단계 안의 그 밖의 예외는 `stalled`(system, 재시도 0, `unclassified` 로그)로 둔다.
  - 어댑터 미분류 400은 재시도하지 않는 쪽(`retryable: false`)을 검토한다.
  - spec-gaps 73행 재검토 항목과 함께 사용자 확인을 받는다.
- 상태: 열림

### QA-S3a-03 [Major] 중단·시간 초과된 단계의 진행 중 호출에 대한 사용 기록이 `after()` 종료로 잘릴 수 있음
- 담당: api-engineer(+ ai-pipeline-engineer: `createLlm`)
- 근거:
  - `runner.ts:538-540`은 `Promise.race([running, aborted])`로 단계를 기다리지 않고 바로 돌아간다.
  - 그 뒤 `finish()`를 거쳐 `runJob`이 끝나면 `after()` 콜백이 끝난다.
  - 중단된 호출의 `error` 이벤트 → `llm.finish` → `onCall`(가격 조회·insert, `usage-recorder.ts`)은 떠 있는 promise로 남는다. Vercel의 `after()`/`waitUntil`은 등록된 promise만 기다리므로, 함수가 멈추면 insert가 사라질 수 있다.
  - 단계가 `signal`을 llm 요청에 넘기지 않으면(LlmRequest.signal은 선택값) 호출은 끝까지 진행되고, 기록은 거의 확실히 잃는다.
  - 테스트(`runner.test.ts:388, 469`)는 가짜 환경이라 이 경쟁을 재현하지 못한다.
- 영향: C-13 / Q9 "공급자 호출 1회 = 사용 기록 1행"이 취소·시간 초과 경로에서 깨질 수 있다. 실패 호출도 토큰이 보고되면 미터에 넣어야 한다(F-AI-07 (7)).
- 수정 제안(택1):
  - (a) `createLlm`이 진행 중인 `onCall` promise를 모아 `settle(): Promise<void>`를 노출하고, 실행기가 `runJob` 종료 전(모든 return 경로) 짧은 상한(예 3초)으로 기다린다.
  - (b) 중단 후 `running`을 상한 시간 동안 기다린다.
  - 추가로 단계 ctx의 `signal`이 llm 호출에 자동으로 걸리도록 실행 단위 llm에 기본 signal을 주입하는 방법도 검토한다.
- 상태: 열림

### QA-S3a-04 [Minor] 실행 중 취소 요청 뒤 단계 실패가 먼저 오면 재시도가 예약·실행됨
- 담당: api-engineer
- 근거:
  - `runner.ts:381-420`은 실패 처리에서 `cancel_requested_at`을 다시 보지 않는다. 취소는 heartbeat(10초)나 claim 때만 확인한다.
  - 취소 RPC 시점에 상태가 running이면 cancel 라우트의 `settleCancelIfQueued`는 아무것도 하지 않는다(`cancel/route.ts:25-29`).
  - 그 사이 `retry_now`면 새 공급자 호출(사용자 토큰)이 나간다. `retry_at`이면 `next_run_at`까지 queued + 취소 요청 상태로 남는다.
- 수정 제안: `decideRetry` 전에 `store.heartbeat`(이미 `cancelRequested`를 돌려준다)로 확인하고, 취소 요청이 있으면 `finish("canceled")`로 끝낸다. 테스트도 추가한다.
- 상태: 열림

### QA-S3a-05 [Minor] OpenAI·Gemini 어댑터에 "오류에 키가 섞이지 않음" 테스트가 없음. `ProviderError.cause`에 SDK 오류(키 일부가 들어 있을 수 있음)가 남음
- 담당: ai-pipeline-engineer
- 근거:
  - Anthropic에는 있다(`anthropic.test.ts:185-189`). `openai.test.ts`, `gemini.test.ts`에는 같은 테스트가 없다.
  - OpenAI 401 본문은 "Incorrect API key provided: sk-…abcd" 형태로 키 일부를 담는다.
  - 지금 `cause`를 직렬화하는 곳은 없다(`errorResponse`, 실행기·AI 로그 모두 필드만 쓴다). 하지만 S4의 SSE `onFinish` 등에서 `error`를 로그로 남기면 바로 샌다.
- 수정 제안: 두 어댑터에 같은 테스트(메시지·직렬화에 키·last4가 없음)를 넣는다. `ProviderError`에 `toJSON()`을 두어 `cause`를 빼거나, 직렬화 금지를 문서·린트로 막는다(NFR-KEY-05).
- 상태: 열림

### QA-S3a-06 [Minor] 매핑 모델 ↔ 가격표 시드의 연결을 지키는 테스트가 없음
- 담당: api-engineer(또는 db-engineer)
- 근거:
  - `ai_price_tables.test.sql`은 SQL 상수로 9모델을 검사한다.
  - TS `MODEL_MAP`(`providers/models.ts:10`)과 DB를 잇는 검사가 없다.
  - 매핑만 바꾸고 가격을 넣지 않으면 `unpriced` / 0달러가 조용히 기록된다(가정 항목).
- 수정 제안: 통합 테스트에서 `allMappedModels()` 각각에 대해 오늘 기준 `priceFor`가 null이 아닌지 확인한다.
- 상태: 열림

### QA-S3a-07 [Minor · S4 주의] `input_hash`에 provider·model이 들어가는데, 해시는 `startJob` 밖에서 provider를 모른 채 만들어짐
- 담당: api-engineer
- 근거:
  - `input-hash.ts:15-38`은 해시 재료에 `provider`·`model`을 요구한다.
  - `runner.ts:133-161`은 활성 공급자를 `startJob` 안에서 읽는데, `inputHash`는 호출자가 미리 계산해 넘긴다.
  - 기능 라우트가 해시를 만들려면 공급자 문맥을 따로 읽어야 한다. 그 사이 공급자를 바꾸면 해시의 공급자와 작업 행의 공급자가 달라질 수 있다.
- 수정 제안: `startJob`이 `hashParts`(또는 `(ctx) => hash` 콜백)를 받아 `context.provider`와 `resolveModel(provider, def.modelTier)`로 계산한다.
- 상태: 열림(S4 전)

### QA-S3a-08 [Minor · S5 주의] 재시도 단위가 "단계"라서, 유료 등급 병렬 단계에서 호출 하나가 실패하면 이미 성공한 호출까지 다시 부름
- 담당: api-engineer
- 근거:
  - `runner.ts:363, 383-401`의 재시도 카운트 키가 `meta.retries[stage][code]`다.
  - 단계 결과는 성공할 때만 저장된다(`:365-372`).
  - C-11.3은 "호출당", C-6은 "완료된 단계 결과 보존"이고, NFR-AI-08은 불필요한 호출을 금지한다.
- 수정 제안: 레지스트리 문서에 "병렬 호출은 호출별로 체크포인트를 남기거나, 실패 호출만 다시 부르는 단계 구현"을 규칙으로 적는다. S5(AI-02)에서 반영을 확인한다.
- 상태: 열림

### QA-S3a-09 [Minor] 지운 서비스 키의 테스트 잔재
- 담당: api-engineer
- 근거: `src/server/auth/proxy-session.test.ts:26`, `src/server/db/ai-writer.integration.test.ts:50`이 아직 `vi.stubEnv("ANTHROPIC_API_KEY", …)`를 쓴다. 동작에는 영향이 없다.
- 수정 제안: 두 줄을 지운다.
- 상태: 열림

## 오늘 추가된 `[가정]` 판단
| 가정 | 판단 | 사용자에게 올릴지 |
|------|------|-------------------|
| 120초 상한 = "합계 + 다음 대기 ≤ 120초", 넘으면 그 원인으로 최종 실패 + `retry_after` | 타당하다. 백오프만으로는 30초 남짓이라, 상한은 긴 Retry-After에서만 걸린다 | 아니오 |
| 수동 재시도는 호출당 횟수·대기 예산을 새로 시작하고 컬럼은 누계 | 타당하다. 다만 DM 2.9.1 문구("작업 전체 누적 … 120초 이상이면 더 재시도하지 않고")와 글자상 다르다 | **예** — DM 문구를 "실행 단위"로 고칠지 확인 |
| 실행기 자체 오류 → `stalled` | 타당하다 | 예 — QA-S3a-02와 함께(단계 안 예외도 같은 규칙으로 할지) |
| 분류 안 된 예외 → `provider_unavailable` (73행 재검토) | 공급자 SDK의 미지 응답에만 타당하다. 우리 코드 예외까지 덮으면 안 된다 | **예** (QA-S3a-02) |
| 가격 없는 모델 → `unpriced` / 0 | 안전망으로는 타당하다. 테스트로 막아야 한다(QA-S3a-06) | 아니오 |
| 시작 거부 409 `ai_not_connected` / `key_invalid` | 타당하다. 화면 문구·처리(UX C-19)가 이 두 코드를 알아야 한다 | 예(정보 공유) — UI 연결 때 반영 |
| 근거 `field`·`quote` `.nullable().default(null)` | 타당하다. 저장 매핑·검증기 동작이 같다(테스트 통과) | 아니오 |
| 내부 V-6 재시도 뒤 `schema_invalid`는 재시도 불가 | C-10.2·C-11.3 "1회"와 맞다 | 아니오 |
| 사용 기록 insert 실패는 삼킴(2회 시도 + 로그) | 토큰 재소비를 막는 쪽이 낫다. 미터가 드물게 덜 보일 수 있으므로 로그 알림을 운영 항목에 넣기를 권한다 | 아니오(운영 메모) |
| C-11.2 새 코드: OpenAI 지역 403·잔액 계열 → `billing_required`, OpenAI 일일 한도는 Retry-After 있을 때만 초기화 시각 | 매핑은 일관된다. OpenAI 일일 한도에서 `quota_resets_at`이 null일 수 있으니 화면에 대체 문구가 필요하다 | 예(화면 문구) |

## 스펙 차이 (`spec-gaps.md`로 넘긴 항목)
- C-10.2 "Gemini는 `responseSchema`(OpenAPI 부분집합), anyOf 미사용" ↔ 구현은 `responseJsonSchema` + nullable `anyOf`. SDK 주석상 지원되지만, 실제 키로 스모크 확인이 필요하다.
- DM §5 ↔ 구현: `app_ai_writer`에 `ai_usage_records` select(본인)을 더했다(C-12 호출 간격 조회). db 노트에만 있고 spec-gaps에는 없었다.
- 수동 재시도와 공급자 변경(F-AI-03 (2)): 실패 작업의 재시도는 작업 행에 고정된 옛 공급자로 돈다. 사용자가 그 사이 활성 공급자를 바꾸거나 키를 지웠다면 `key_missing`으로 끝난다. "다음 실행"에 수동 재시도가 포함되는지 정해야 한다.
- 스트리밍(SSE) 기능의 "첫 토큰 전 오류 자동 재시도"(C-11.3)를 누가 하는지(작업 실행기 밖, 대기를 함수 안에서 할지) S4 전에 정해야 한다. S3a에는 SSE 경로 재시도가 없다.
- UI 하네스 `ui-implementation/references/patterns.md:38,43`가 v3 기준이다(범주 4값, "사용량은 차감되지 않았다" 문구). v4는 범주 5값 + `failureCause`이고 차감이 없다. UI 연결 전에 하네스 문서 갱신이 필요하다(리더 몫).

## 라운드 후 조치 (리더, 2026-10-28)
- QA-S3a-10 → **해결**. ai-pipeline-engineer가 `settle()`에 유예 대기(`LLM_SETTLE_GRACE_MS = 2000`)를 넣었다. 기록 중인 insert는 강제 기록하지 않고 최대 5초까지 기다린다. 리더가 `run-checks.sh --build`를 다시 실행해 5종 모두 PASS를 확인했다.
- QA-S3a-11 (신규, Minor, api, S3b에서 처리) → **열림**. `INVOCATION_BUDGET_MS = 55_000`은 "새 단계를 시작하지 않는 시점"이다. 여기에 `settle` 최악 대기 5초와 진행 중 단계의 남은 시간이 더해지면 `maxDuration = 60`을 넘을 수 있다. 예산에서 settle 대기와 단계 마감 시간을 빼도록 고친다.
- QA-S3a-08 → S5 확인 사항(병렬 단계 재시도 규칙)으로 넘긴다.
