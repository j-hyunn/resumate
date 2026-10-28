# S3a AI 파이프라인 구현 노트 (BYOK 공급자 계층)

> 완료(2026-10-28). **맨 위 "공개 인터페이스"는 확정본**이다. api-engineer는 이 절을 기준으로 코딩한다. 바뀌면 이 절에 날짜와 함께 고친다.

## 0-QA. QA 1차 대응 합의 계약 (2026-10-28, api-engineer 확인 필요)
**QA-S3a-03 사용 기록 전달**
- `Llm.settle(timeoutMs = LLM_SETTLE_TIMEOUT_MS /* 3000 */): Promise<void>` 추가. **runner는 `runJob`의 모든 종료 경로(성공·실패·취소·deadline yield)에서 반환 전에 `await llm.settle()`** 한다.
  - 이 `Llm`으로 시작한 호출의 사용 기록이 끝날 때까지 기다린다(상한 timeoutMs).
  - 상한 뒤에도 열려 있는 호출(소비가 멈춘 스트림, deadline에 잘린 호출)은 `failed` + `canceled`/`timeout`(signal reason, 없으면 canceled) + usage `unavailable`로 **그 자리에서 기록**한다.
  - 호출마다 기록은 정확히 1행이다. 강제 기록 뒤 늦게 도착한 종료는 버린다.
  - (QA-S3a-10) 상한 시점에 **이미 기록 중인 호출**(느린 insert)과 방금 강제 기록한 호출은 `LLM_SETTLE_GRACE_MS`(2000)만큼 더 기다린다. 시그니처 `settle(timeoutMs = 3000, graceMs = 2000)`, 최악 대기 5초. runner의 함수 예산(55초)에 이 5초를 포함해야 한다.
- `complete()`는 `onCall`이 끝난 뒤에야 resolve/reject한다. `stream()`은 `onCall`이 끝난 뒤에 terminal 이벤트를 yield한다. 소비자가 중간에 `break`하면 generator `finally`가 실패 1행을 기록한다.
- `createLlm({ …, signal })` 추가: 실행 단위 signal(단계 deadline·취소)을 모든 호출에 `AbortSignal.any([run, request])`로 건다. 단계가 `request.signal`을 빠뜨려도 멈춘다.

**QA-S3a-01 스트림 오류 시각**
- 파이프라인 `error` 이벤트(`streaming/events.ts`)에 `retryAfter: string | null`, `quotaResetsAt: string | null`(ISO)을 추가했다. `runStructuredStream`이 `ProviderError`에서 채운다. `sse.ts normalizeErrorEvent`가 읽는 이름과 같다. `failureCause`·`category`는 SSE 층(api)이 코드에서 계산한다(ai는 넣지 않음).

**QA-S3a-05 키 누출 차단**
- `ProviderError`는 SDK 오류를 `cause`로 **보관하지 않는다**. 클래스 이름만 `sdkErrorName`에 남는다. `toJSON()`은 분류 필드만 내보낸다.
- 세 어댑터 모두 "메시지·JSON·`util.inspect`·stack에 키와 끝 4자리 없음" 테스트가 있다.

**QA-S3a-06**: `providers/models.test.ts`가 시드 마이그레이션(`insert into public.ai_price_tables`가 있는 파일)을 읽는다. 버전 × 모델 교차를 풀어 `allMappedModels()` 9개가 모든 버전에 있는지 확인한다. 시드가 `versions cross join base` 모양이 아니면 실패한다.

## 0. 공개 인터페이스 (api-engineer 합의용, 2026-10-28 확정)

### 0.1 파일
| 파일 | 내용 |
|------|------|
| `src/server/ai/providers/types.ts` | `ProviderId`, `ModelTier`, `ConnectionTier`, `ReasoningLevel`, `AiTextBlock`, `NormalizedUsage`, `AiCallResult`, `LlmStreamEvent`, `ProviderAdapter`, `ProviderCallRequest` |
| `src/server/ai/providers/models.ts` | `MODEL_MAP`, `resolveModel(provider, tier)` |
| `src/server/ai/providers/{anthropic,openai,gemini}.ts` | 어댑터 3개 (`complete` / `stream` / `verify`) |
| `src/server/ai/providers/schema.ts` | 정본 스키마 검사 `assertCanonicalSchema`, 공급자 변환 |
| `src/server/ai/errors.ts` | `AiError`, `ProviderError`, `retryPolicy`, `retryDelayMs`, `finalRetryAfter`, `RETRY_WAIT_TOTAL_CAP_MS` |
| `src/server/ai/llm.ts` | `createLlm`, `Llm`, `LlmRequest`, `LlmCallRecord`, `KeySource`, `verifyProviderKey` |
| `src/server/ai/fake-llm.ts` | 테스트용 `createFakeLlm` (기존 `fake-client.ts` 대체) |

**삭제**: `client.ts`, `anthropic-client.ts`, `fake-client.ts`, 루트 `models.ts`(`AI_UNAVAILABLE_FALLBACK`, `REFUSAL_FALLBACKS_ENABLED` 포함, D-31), `errors.ts`의 `mapSdkError`·`retryableAiErrorCodes`. → `src/server/jobs/*`, `src/server/sse.ts`의 import를 api-engineer가 바꿔야 한다(아래 0.6).

### 0.2 공통 타입
```ts
type ProviderId = "openai" | "gemini" | "anthropic";
type ModelTier = "light" | "default" | "heavy";
type ConnectionTier = "free" | "paid";
type ReasoningLevel = "low" | "medium";
type AiTextBlock = { text: string; cache?: boolean };   // cache: Claude 어댑터만 캐시 지점으로 씀 (C-8)

type NormalizedUsage = {
  inputTokens: number;        // 캐시되지 않은 입력 (C-13 input_tokens)
  cachedInputTokens: number;  // 캐시 읽기
  cacheWriteTokens: number;   // 캐시 쓰기 (Claude만, 나머지 0)
  outputTokens: number;       // 사고 토큰 포함
  reasoningTokens: number | null; // 따로 보고될 때만 (OpenAI, Gemini). Claude는 null
  usageSource: "provider_reported" | "unavailable";
};
type AiCallResult = { text: string; model: string; usage: NormalizedUsage; latencyMs: number };
type LlmStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; result: AiCallResult }
  | { type: "error"; error: ProviderError; usage: NormalizedUsage };
```

### 0.3 `createLlm` (runner가 단계마다 만들어 단계 ctx에 넘김)
```ts
type KeySource = { forJob(jobId: string): Promise<string> };   // 키가 없으면 throw new ProviderError("key_missing")
type LlmCallRecord = {
  jobId: string; callKey: string; feature: string; promptVersion: string;
  provider: ProviderId; model: string; modelTier: ModelTier; connectionTier: ConnectionTier;
  outcome: "succeeded" | "failed"; errorCode: AiErrorCode | null;
  usage: NormalizedUsage; latencyMs: number; occurredAt: Date;
};
function createLlm(options: {
  provider: ProviderId; tier: ModelTier; connectionTier: ConnectionTier;
  keySource: KeySource; jobId: string;
  onCall: (record: LlmCallRecord) => void | Promise<void>;
  logger?: AiLogger; now?: () => number;
  adapters?: Partial<Record<ProviderId, ProviderAdapter>>;   // 테스트 주입
}): Llm;

type LlmRequest = {
  feature: string;          // 로그용 "AI-02.match"
  promptVersion: string;
  callKey: string;          // ai_usage_records.call_key, 예 "insight.match.2"
  tier?: ModelTier;         // 생략 시 createLlm의 tier (AI-12처럼 한 작업에서 등급을 섞을 때만 지정)
  systemBlocks: readonly AiTextBlock[];
  userBlocks: readonly AiTextBlock[];
  outputSchema: Record<string, unknown> | null;   // 정본 JSON Schema (toCanonicalJsonSchema)
  maxOutputTokens?: number;
  reasoningLevel?: ReasoningLevel;                // 기본 "low"
  signal?: AbortSignal;     // abort("canceled") = 사용자 취소, 그 밖의 reason = timeout
};
interface Llm {
  readonly provider: ProviderId; readonly tier: ModelTier; readonly connectionTier: ConnectionTier;
  modelFor(tier?: ModelTier): string;
  complete(request: LlmRequest): Promise<AiCallResult>;      // 실패는 throw ProviderError
  stream(request: LlmRequest): AsyncIterable<LlmStreamEvent>; // delta* → done | error 정확히 하나. throw하지 않음(키 조회 실패 제외)
  settle(timeoutMs?: number): Promise<void>;                  // 0-QA 참고
}
```
- **호출마다**: `keySource.forJob(jobId)` → 어댑터 호출 → `onCall(record)`를 **await**. 성공·실패(재시도 각 시도) 모두 1행. 키 조회에서 실패하면(공급자 호출 없음) `onCall`을 부르지 않는다.
- `onCall`이 throw하면 AI 호출 결과는 그대로 두고 로그 `usage_record_failed`만 남긴다(기록 실패로 이미 쓴 토큰을 다시 쓰게 재시도시키지 않기 위해) `[구현 결정]`. 반드시 남겨야 한다면 api 쪽에서 재시도·경보를 붙인다.
- 실패 응답에 토큰이 없으면 `usage` = 0 + `usageSource: "unavailable"` (C-13).
- `cost`는 계산하지 않는다(api의 `estimateCostUsd`).
- 키는 `createLlm` 밖으로 나가지 않는다. 로그·오류·레코드에 키가 없다(NFR-KEY-05).

### 0.4 `ProviderError` / 재시도 정책
```ts
class AiError extends AppError { code: AiErrorCode; retryable: boolean }
class ProviderError extends AiError {
  provider: ProviderId | null;
  retryAfter?: Date;        // Retry-After 헤더 / Gemini RetryInfo.retryDelay
  quotaResetsAt?: Date;     // daily_quota_exhausted (Gemini: 다음 00:00 America/Los_Angeles)
  usage?: NormalizedUsage;  // 실패 응답이 보고한 토큰
  beforeFirstToken: boolean;// 스트리밍에서 첫 delta 전 오류면 true (complete는 항상 true)
  unclassified: boolean;    // C-11.2 표에 없는 예외 → provider_unavailable [가정]
}
function retryPolicy(code: AiErrorCode): { maxRetries: number; backoffMs: readonly number[]; jitterMs: number };
//  rate_limited 4 [2000,4000,8000,16000] +0~1000 / provider_unavailable 2 [2000,4000] +0~1000
//  schema_invalid·timeout 1 [0] / 그 밖 0
const RETRY_WAIT_TOTAL_CAP_MS = 120_000;          // 원인 1·6 합산 (C-11.3)
const FINAL_RETRY_AFTER_MIN_MS = 60_000;
function retryDelayMs(error: AiError, retryIndex: number /*0부터*/, opts?: { now?: number; random?: () => number }): number;
//  retryAfter가 있으면 그 시각까지, 없으면 backoff[i] + floor(random()*jitter)
function finalRetryAfter(error: AiError, retryIndex: number, now?: number): Date | null;
//  rate_limited·provider_unavailable 최종 실패 시 ai_jobs.retry_after (최소 1분). 그 밖 null
```
- runner 판단식: `err.retryable && retryCount(code) < retryPolicy(code).maxRetries && (스트리밍이면 err.beforeFirstToken)`.
- `err.retryable`은 기본 `retryPolicy(code).maxRetries > 0`. **`generateStructured`가 내부 V-6 재시도(같은 공급자·모델 1회)까지 쓴 뒤 던지는 `schema_invalid`는 `retryable: false`** — runner가 한 번 더 돌리지 않게 한다(C-11.3 "1회"를 이중으로 쓰지 않음).
- `key_invalid` → runner가 `KeyStatusReporter.markInvalid`.
- SSE 쪽: `isRetryableAiErrorCode(code)`는 유지(= `retryPolicy(code).maxRetries > 0`).

### 0.5 키 검증 (C-10.5)
```ts
function verifyProviderKey(options: { provider; apiKey: string; signal?; adapters?; now? }): Promise<KeyVerificationResult>;
type KeyVerificationResult = {
  decision: "valid" | "limited" | "rejected";   // save_provider_key의 valid / limited, rejected = 저장 안 함
  stage: 1 | 2;                                 // 끝난 단계
  model: string;                                // 기본 등급 모델
  error: ProviderError | null;
  usage: NormalizedUsage | null;                // 2단계 생성 호출의 토큰 (key_verification 미터 기록용). 1단계는 null
  latencyMs: number;
};
```
- 1단계 모델 조회(토큰 없음), 2단계 기본 등급 모델 최소 생성. 재시도 없음.
- `limited` = 2단계에서 `rate_limited` / `daily_quota_exhausted` / `provider_unavailable`. 1단계 장애는 `rejected`(잠시 후 다시).

### 0.6 api-engineer에게 요청 (contracts·jobs는 api 소유)
1. `src/lib/contracts/errors.ts` `AI_ERROR_CODES` v4 목록(C-11.1):
   `rate_limited, daily_quota_exhausted, billing_required, key_invalid, key_missing, model_not_available, provider_unavailable, input_too_long, safety_blocked, insufficient_data, not_a_jd, schema_invalid, timeout, stalled, canceled` (15개). `refused`, `model_unavailable` 삭제. `src/server/ai/errors.ts`가 이 타입에 `Record<AiErrorCode, …>`로 의존한다.
2. `src/server/jobs/app-runner.ts`: `createAnthropicAiClient` → 단계마다 `createLlm({...})`. 단계 ctx의 `ai: AiClient` → `llm: Llm`.
3. `runner.ts`: `mapSdkError` 삭제됨. 분류되지 않은 예외(ProviderError 아님)는 `provider_unavailable` + `unclassified` 로그로(spec-gaps 2026-10-28).
4. 테스트: `createFakeAiClient` → `createFakeLlm` (0.7).

### 0.7 `createFakeLlm` (테스트 전용, 네트워크 없음)
```ts
type FakeLlmResponse =
  | { json: unknown } | { text: string }
  | { error: AiErrorCode; retryAfterMs?: number; usage?: Partial<NormalizedUsage> }
  | { errorAfterChunks: AiErrorCode; json: unknown; chunks: number };
function createFakeLlm(responses: FakeLlmResponse[], options?: { chunkSize?; provider?; tier?; connectionTier?; onCall? }): Llm & { requests: LlmRequest[]; records: LlmCallRecord[]; remaining(): number };
```

---

## 1. 등급·모델·prompt_version
- 매핑(`providers/models.ts`, 00_model-mapping §1 그대로, 자동 대체 없음 D-31):

  | 등급 | openai | gemini | anthropic |
  |------|--------|--------|-----------|
  | light | `gpt-6-luna` | `gemini-3.5-flash-lite` | `claude-haiku-5-5` |
  | default | `gpt-6.1-terra` | `gemini-3.8-flash` | `claude-sonnet-5-5` |
  | heavy | `gpt-6.1-sol` | `gemini-4-argon` | `claude-opus-5-5` |
- `AiCallResult.model`·사용 기록의 `model`은 **매핑된 모델 ID**다. 공급자가 돌려주는 스냅샷 이름(`gpt-6.1-terra-2026-09-01`, Gemini `modelVersion`)은 쓰지 않는다. 가격표 조회 키가 어긋나지 않게 하려는 것이다 `[구현 결정]`.
- 사고 설정(C-4): `reasoningLevel` → Claude `output_config.effort`, OpenAI `reasoning.effort`, Gemini `thinkingConfig.thinkingLevel`(LOW/MEDIUM) `[가정]`. 기본 `low`. Claude thinking 파라미터는 보내지 않는다(5.5 계열은 생략 = adaptive).
- 기능이 아직 없어 기능별 `prompt_version`은 없다. 규칙은 S3와 같다(`<기능>.<단계>.vN+common.v1`). 공급자별 프롬프트 변형이 생기면 접미사를 붙인다(C-10.4).
- `input_hash`에 `provider`를 추가했다(C-6 v4). `INPUT_HASH_VERSION` 1 → 2.
- 삭제(D-31): `AI_UNAVAILABLE_FALLBACK`(이전 세대 모델 대체), `REFUSAL_FALLBACKS_ENABLED`·서버 측 거절 대체 베타. 거절은 곧바로 `safety_blocked`.

## 2. 공급자 어댑터 확인 내용 (SDK 타입 + 공식 문서, 2026-10-28)
| 항목 | OpenAI (`openai` 7.45, Responses API) | Gemini (`@google/genai` 2.31) | Claude (`@anthropic-ai/sdk` 1.1.0) |
|------|------|------|------|
| 호출 | `responses.create({stream:true})`, `instructions` = system, user 블록 = `input_text`, `store:false` | `models.generateContentStream`, `systemInstruction`, `contents` | `messages.create({stream:true})` (beta 아님) |
| 구조화 출력 | `text.format = {type:"json_schema", name:"output", schema, strict:true}` | `responseMimeType: application/json` + `responseJsonSchema`(+ `propertyOrdering`) | `output_config.format = {type:"json_schema", schema}`, 도구 없음 |
| 스트림 | `response.output_text.delta` / 종료 `response.completed·incomplete·failed` / `error` / `response.refusal.*` | 조각마다 `candidates[0].content.parts`(thought 부분 제외), `finishReason`, `promptFeedback.blockReason` | `content_block_delta.text_delta`, `message_delta.stop_reason` |
| usage | 종료 이벤트의 `response.usage`(스트림에서도 옴, 별도 옵션 불필요). `input_tokens`가 캐시 포함 → input = input − cached. `reasoning_tokens` | `usageMetadata`: prompt(캐시 포함) − cached, output = candidates + thoughts, reasoning = thoughts | `message_start`·`message_delta`의 usage(마지막 값). input은 이미 캐시 제외. `output_tokens_details.thinking_tokens` → reasoning |
| SDK 재시도 | `maxRetries: 0` | `retryOptions` 없으면 재시도 없음. `attempts: 1`로 고정 | `maxRetries: 0` |
| 키 검증 | `models.retrieve` → `responses.create` 16토큰 | `models.get` → `generateContent` 5토큰 | `models.retrieve` → `messages.create` 5토큰, effort low |
- OpenAI `cache_write_tokens`(입력 세부)는 가격표에 OpenAI 캐시 쓰기 단가가 없어 입력 토큰에 그대로 둔다(cacheWrite = 0) `[구현 결정]`.
- Gemini는 `responseSchema`(OpenAPI 부분집합) 대신 SDK가 문서화한 `responseJsonSchema`를 쓴다. 정본 JSON Schema(`anyOf`, `enum`, `additionalProperties`)를 변환 없이 받고 `propertyOrdering`도 허용한다. C-10.2의 "responseSchema"와 표기만 다르다.
- 명시적 컨텍스트 캐시(Gemini)·캐시 예열은 쓰지 않는다. 캐시 지점(`cache: true`)은 Claude 어댑터만 반영한다.

## 3. 오류 매핑 (C-11.2 → `error_code`, 테스트 표 = `providers/*.test.ts`)
| 원인 | OpenAI | Gemini | Claude |
|------|--------|--------|--------|
| `rate_limited` | 429 `rate_limit_exceeded`(분당), stream `error`/`failed` `rate_limit_exceeded`. Retry-After → retryAfter | 429 `RESOURCE_EXHAUSTED` + `PerMinute`, 또는 상세 없음(애매한 429 → 1). `RetryInfo.retryDelay` → retryAfter | 429 `rate_limit_error`, Retry-After |
| `daily_quota_exhausted` | 429 + 메시지 per day/RPD/TPD, 또는 `quota_exceeded`. 초기화 시각 = Retry-After(있을 때만) | 429 + `PerDay`, 또는 `quota_exceeded`. `quotaResetsAt` = 다음 00:00 America/Los_Angeles(tz 계산, `nextMidnightIn`) | 해당 없음 |
| `billing_required` | 429 `insufficient_quota`·`credit_balance_exhausted`·spend/usage limit, 403 지역 미지원 `[가정]` | 400 `FAILED_PRECONDITION`, 402 | 402 `billing_error`, 400 + 크레딧·사용 한도 메시지 |
| `key_invalid` | 401, 403(모델 접근 제외) | `API_KEY_INVALID`, 401, 403 `PERMISSION_DENIED` | 401, 403 |
| `model_not_available` | 404, 403 모델 접근 | 404, 429 + 무료 한도 0(`quotaValue "0"` / `limit: 0`) | 404 |
| `provider_unavailable` | 5xx, 연결 오류, `server_error` | 5xx(500/503/504), fetch `TypeError` | 5xx, 529, 연결 오류, 스트림 중 `overloaded_error`·`api_error` |
| `input_too_long` | 400 `context_length_exceeded`, 413 | 400 + 토큰 수 초과 메시지 | 413, 400 프롬프트 길이, `stop_reason: model_context_window_exceeded` |
| `safety_blocked` | `refusal` 내용, `incomplete: content_filter`, `invalid_prompt`·`bio_policy` 등, 400 `content_policy_violation` | `blockReason`, `finishReason` SAFETY/PROHIBITED_CONTENT/BLOCKLIST/SPII/RECITATION/LANGUAGE | `stop_reason: refusal` |
| `schema_invalid` | `incomplete: max_output_tokens`(구조화 출력일 때) | `MAX_TOKENS`(구조화) | `stop_reason: max_tokens`(구조화) |
| `canceled` / `timeout` | 우리 signal: reason `"canceled"` → canceled, 그 밖 → timeout. SDK 연결 타임아웃 → timeout | 같음, `AbortError` → timeout | 같음 |
| 분류 안 됨 | 그 밖의 400 등 → `provider_unavailable` + `unclassified: true` `[가정, spec-gaps]` | 같음 | 같음 |
- 공급자 오류 메시지 원문은 `ProviderError` 메시지·로그에 넣지 않는다(C-7). `cause`에만 남고 로그로 직렬화하지 않는다.
- 최신 문서와 C-11.2가 다른 부분은 spec-gaps(2026-10-28 · C-11.2 공급자 오류 표)에 기록했다.

## 4. 출력 스키마 ↔ 저장 / 정본 스키마 (C-10.2)
- `toCanonicalJsonSchema(zod)`(`providers/schema.ts`, 기존 `toOutputJsonSchema` 대체): 루트 object, 루트 oneOf/anyOf 금지, 모든 객체 `additionalProperties:false` + 모든 키 required, 깊이 ≤ 5(`CANONICAL_MAX_DEPTH`), `$ref` 금지. 길이·개수·범위 키워드는 지우고 zod가 파싱 뒤 검사(V-6). `const` → 한 값 `enum`. zod `.nullable()`의 `type: [T,"null"]` → `anyOf: [{type:T},{type:"null"}]`(Claude 문서의 지원 목록에 type 배열이 없어 세 공급자 공통인 anyOf로).
- 규칙 위반 스키마는 `CanonicalSchemaError`로 즉시 실패한다(기능 개발 중 잡히게).
- **`ModelEvidenceSchema`의 `field`·`quote`**: `.nullable().optional()` → `.nullable().default(null)`. JSON Schema에서는 required + nullable(OpenAI strict 조건), 파싱은 키가 없어도 받아 null로 채운다(Gemini는 required를 강제하지 않음). 검증기 입력 타입 `ModelEvidence`는 `z.input`으로 바꿔 기존 검증기 동작·테스트는 그대로다. 저장 매핑(C-3)은 변경 없음.

## 5. 검증 규칙 적용 범위
- V-1~V-8, C-5, 증분 JSON 파서, 블록 이벤트는 S3 그대로다(테스트 그대로 통과).
- V-6: `generateStructured(llm, request, schema)` — 같은 공급자·모델로 1회 재요청, 그다음 `schema_invalid(retryable:false)`. 시도마다 사용 기록 1행.
- 스트리밍(`runStructuredStream({ llm, … })`): `LlmStreamEvent` `error`를 받으면 SSE `error` 하나로 끝낸다. 공급자 오류가 첫 토큰 뒤면 `retryable:false`(C-11.3). 스트림 종료 후 스키마 불일치는 S3처럼 `schema_invalid, retryable:true`(전체 재생성).

## 6. 이벤트·진행 단계·오류 코드 (api 합의)
- SSE 이벤트 이름·모양은 S3와 같다(`streaming/events.ts`). error 코드는 v4 15개 + `internal_error`.
- api-engineer 구현(`src/server/jobs/app-runner.ts`, `retry.ts`, `src/test/job-fakes.ts`)이 0절 인터페이스(`createLlm`, `ProviderError`, `retryPolicy`, `retryDelayMs`, `finalRetryAfter`, `RETRY_WAIT_TOTAL_CAP_MS`, `isProviderError`, `beforeFirstToken`)를 그대로 쓰는 것을 확인했다.
- 비용 계산(api) 참고: `NormalizedUsage.inputTokens`는 캐시 제외 값이다. 장문 구간 판정(`long_context_threshold_tokens`)은 공급자 기준대로 **전체 프롬프트 = input + cachedInput + cacheWrite**로 비교해야 한다.

## 7. 테스트·픽스처
- 실제 공급자 호출 없음. 공급자별 가짜 SDK(`createClient` 주입)와 녹화 형태 이벤트·오류 본문(`Anthropic.APIError.generate`, `OpenAI.APIError.generate`, `new ApiError({status, message: JSON 본문})`)을 쓴다. 키는 가짜 문자열.
- 새 테스트 파일: `providers/anthropic.test.ts`, `providers/openai.test.ts`, `providers/gemini.test.ts`(요청 모양, 스트림·usage 정규화, 종료 사유, C-11.2 각 행, Retry-After/retryDelay, 일일 초기화 시각, 취소·시간 초과, 키 검증 2단계), `providers/schema.test.ts`(정본 규칙·변환), `providers/shared.test.ts`(LA 자정 DST 경계 6건, Retry-After 파싱, 매핑 9개), `errors.test.ts`(C-11.3 표, 메시지·상태, 대기 계산, 최종 retry_after), `llm.test.ts`(키 호출마다 조회, 등급 해석, 사용 기록 성공·실패·종료 이벤트 없음, key_missing 시 기록 없음, onCall 실패, 로그에 키·본문 없음, 키 검증 결정 표).
- 수정: `structured.test.ts`, `streaming/structured-stream.test.ts`(가짜 Llm, 첫 토큰 뒤 재시도 불가, safety_blocked). 삭제: `anthropic-client.test.ts`.
- 결과(2026-10-28): `pnpm vitest run src/server/ai` 18파일 266건 통과, `pnpm eslint src/server/ai` 통과, `pnpm typecheck`의 `src/server/ai` 오류 0건.
- QA 2차 대응 후(2026-10-28): `src/server/ai` 19파일 278건, 전체 42파일 631건 통과, lint·typecheck 통과. 느린 insert 대기·무한 대기 상한 테스트 2건 추가.
- QA 1차 대응 후(2026-10-28): `src/server/ai` 19파일 276건, 전체 `pnpm test` 42파일 626건 통과, `pnpm lint`·`pnpm typecheck` 전체 통과. 추가 테스트: `llm.test.ts` 중단·버림·settle 5건, 어댑터 키 누출(OpenAI·Gemini 신규, Anthropic 강화), `providers/models.test.ts`, 스트림 오류 시각.

## 8. 스펙 차이·가정·상수
| 항목 | 값 / 처리 | 근거 |
|------|-----------|------|
| 분류 안 된 예외 | `provider_unavailable` + `unclassified` 로그 | spec-gaps 2026-10-28 (73행 재검토) |
| `CANONICAL_MAX_DEPTH` | 5 (객체 중첩 수, 루트 = 1) | C-10.2 |
| 재시도 표 | 1: 4회 2/4/8/16초 / 6: 2회 2/4초 (+0~1초) / schema·timeout 1회 / 합계 120초 / 최종 retry_after ≥ 1분 | C-11.3 |
| Gemini 사고 설정 | `thinkingLevel` LOW/MEDIUM (budget 대신) | C-4 `[가정]`, gemini-3.x는 level 방식 |
| Gemini 구조화 출력 | `responseJsonSchema` | SDK 문서 |
| OpenAI 키 검증 출력 | 16토큰(API 최솟값) | spec-gaps C-11.2 항목 |
| OpenAI 일일 한도 | 메시지 per day/RPD/TPD 또는 `quota_exceeded`. 초기화 시각은 Retry-After 있을 때만 | C-11.2 `[가정]` |
| OpenAI 403 지역 미지원 | `billing_required` | `[가정]`, spec-gaps |
| `onCall` 실패 | 호출은 성공 처리, `usage_record_failed` 로그 | 구현 결정 |
| 결과 `model` | 매핑된 ID(스냅샷 이름 무시) | 구현 결정(가격표 키) |
| `DEFAULT_MAX_OUTPUT_TOKENS` | 16,000 (기능 카드가 정하면 그 값) | S3 유지 |
