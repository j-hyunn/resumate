# S5 AI 파이프라인 구현 노트 (ai-pipeline-engineer)

> 상태: QA 1라운드 반영 완료. typecheck 전체 오류 0, lint(src/server/ai) 0건, vitest src/server/ai 29파일 527개 통과.

## api-engineer용 시그니처 (먼저 확정)

### AI-01 JD 요건 추출 — `src/server/ai/pipelines/AI-01.ts`

```ts
import { extractJdRequirements, AI01_TIER, AI01_CALL_KEY } from "@/server/ai/pipelines/AI-01";

export type Ai01Input = {
  /** job_descriptions.sentences (splitJdSentences 결과 그대로) */
  sentences: readonly JdSentence[];
  /** 사용자 입력값(*_source = 'user')만. AI가 채운 값은 넘기지 않는다. 없으면 null */
  companyName: string | null;
  positionTitle: string | null;
};

export type Ai01Deps = {
  llm: Llm;                 // createLlm(... tier: "light" ...) — 파이프라인이 tier "light"를 요청에 명시함
  callKey?: string;         // 기본 "jd_extraction" (ai_usage_records.call_key)
  signal?: AbortSignal;     // 30초 타임아웃: abort("timeout"), 사용자 취소: abort("canceled")
  logger?: AiLogger;
  jobId?: string | null;
};

export async function extractJdRequirements(input: Ai01Input, deps: Ai01Deps): Promise<JdExtractionResult>;

export type JdExtractionResult = {
  output: Ai01NormalizedOutput;       // 검증·정규화된 결과 (스펙 키 그대로)
  requirementsHash: string;           // computeRequirementsHash(output.requirements)
  report: Ai01ValidationReport;       // 개수만
  payload: ApplyJdExtractionResult;   // apply_jd_extraction 의 p_result 그대로 넘기면 됨
  promptVersion: string;              // ai_jobs.prompt_version
  meta: AiCallResult;                 // model, usage(시도 합계), latency
  attempts: number;                   // 1 또는 2
};
```

호출 측 순서: `begin_jd_extraction` → `extractJdRequirements` → `apply_jd_extraction(p_result = result.payload, p_provider = llm.provider, p_model = result.meta.model)`.

던지는 오류 (모두 `AiError` 하위, `code`로 분기):

| code | 언제 | retryable |
|------|------|-----------|
| C-11 공급자 코드 (`rate_limited`, `daily_quota_exhausted`, `billing_required`, `key_invalid`, `key_missing`, `model_not_available`, `provider_unavailable`, `input_too_long`, `safety_blocked`, `timeout`, `canceled`) | `ProviderError` 그대로 전파 | 코드 정책(`retryPolicy`) — 재시도 판단은 호출 측 |
| `schema_invalid` | V-6 불일치 또는 "검증 후 요건 0개 + `is_likely_jd = true`"가 2회 연속(1회 재시도는 파이프라인 안에서 이미 씀) | **false** (다시 재시도하지 않는다) |
| `not_a_jd` | 문장이 0개(호출 없이), 또는 검증 후 요건 0개 + `is_likely_jd = false` | false |

- 요건이 1개 이상이면 `is_likely_jd = false`여도 성공으로 반환한다(경고만, F-P2-01). 화면 경고는 `output.is_likely_jd`/`output.warnings`로.
- 사용 기록은 `createLlm`의 `onCall`이 호출마다 남긴다(실패·재시도 포함).

### `p_result` (`apply_jd_extraction`) — db-engineer 모양으로 확정 (리더 결정 2026-10-28)

db-engineer 노트 "p_result 모양"을 그대로 따른다. `result.payload`를 그대로 `p_result`로 넘기면 된다.

```jsonc
{
  "schema_version": 1, "prompt_version": "ai-01.extract.v1+common.v1",   // DB는 읽지 않음
  "detected_language": "ko",                                            // null 가능
  "is_likely_jd": true,
  "company_name":   { "value": "…", "source_sids": ["S1"] } | null,
  "position_title": { "value": "…", "source_sids": ["S1"] } | null,
  "seniority": { "min_years": 5, "max_years": null, "label": "…", "source_sids": ["S9"] } | null,
  "requirements": [ { "category", "content", "keywords", "importance", "source_sids", "sort_order": 0 } ],
  "tech_keywords": [ { "keyword": "Kafka", "source_sids": ["S12"] } ],
  "other_sids": ["S2"], "warnings": [],
  "requirements_hash": "<sha256 hex>",
  "extraction": { /* 검증된 모델 출력(스펙 키) + validation_report */ }
}
```

- `requirements`는 1개 이상, `sort_order`는 **0부터** 출력 순서(DB도 배열 순서로 씀), `source_sids` 1개 이상·중복 없음·번호순·모두 실재 sid, `content` ≤ 300자(DB 1~500보다 엄격, 호환), `keywords` ≤ 10개·각 ≤ 60자.
- 매퍼: `toApplyJdExtractionPayload` (`src/server/ai/storage/jd-extraction.ts`), 모양 테스트 `storage/jd-extraction.test.ts`.

### R-31 게이트 요건 — `src/server/ai/context-pack/gate-requirements.ts`

```ts
selectGateRequirements(requirements: readonly GateRequirementRow[], signals: CareerSignals, max = 8): GateRequirement[];
// GateRequirementRow = { id, category, content, keywords, importance, sort_order }  (jd_requirements 행)
// CareerSignals = { skillNames: readonly string[] /* skills.normalized_name ?? name */, texts: readonly string[] /* 프로젝트·상세 내용 텍스트 */ }
```

- 결과를 `WritingChatTurnInput.gateRequirements`(새 선택 필드)에 넣으면 응답(reply) 호출에만 `<gate_requirements>` 블록이 붙는다. 게이트가 아니거나 빈 배열이면 블록 없음.

## 만든 것

| 파일 | 내용 |
|------|------|
| `src/server/ai/schemas/AI-01.ts` | 출력 zod 스키마(`schema_version: 1`, 카드 키 그대로, nullable은 필수+null). 카테고리·중요도는 `@/lib/contracts/enums` 목록 재사용 |
| `src/server/ai/prompts/AI-01/index.ts` | `AI01_PROMPT_VERSION = "ai-01.extract.v1+common.v1"`. 공통 system → 기능 system(경계 사례 2개) / `<jd>`(`S번호: 문장`) → `<reference>`(사용자 입력 회사명·포지션명, 있을 때만) → `<task>` |
| `src/server/ai/validation/jd-extraction.ts` | `validateJdExtraction(output, sentenceIds)` 순수 함수 + `normalizeSid`, `requirementTextKey` |
| `src/server/ai/pipelines/AI-01.ts` | `extractJdRequirements` (경량 등급, 사고 낮음, 구조화 출력, 최대 출력 8192) |
| `src/server/ai/storage/jd-extraction.ts` | `toApplyJdExtractionPayload`, `toApplyJdRequirements` (p_result 매퍼) |
| `src/server/ai/context-pack/jd.ts` | `computeRequirementsHash` 추가, `buildJdContext.requirementsHash`도 이것을 씀 |
| `src/server/ai/structured.ts` | `generateStructured(…, { accept })` 선택 인자 추가: 기능 수준 거부도 같은 1회 재시도 예산을 씀 |
| `src/server/ai/context-pack/gate-requirements.ts` | `selectGateRequirements`, `hasWeakEvidence`, `signalKey` |
| `src/server/ai/context-pack/writing-chat.ts` | `WritingChatTurnInput.gateRequirements?` 추가 |
| `src/server/ai/prompts/AI-12/index.ts` | 응답 `ai-12.reply.v2+common.v1`(v1→v2), `<gate_requirements>` 블록·주제 전용 지시. 정리 `ai-12.extract.v2+common.v1`(QA-S5-04로 공통 데이터 블록 목록 변경, 요건 블록은 여전히 받지 않음) |
| `src/server/ai/__fixtures__/AI-01/jds.ts` | 한국어 2(정상, 잡음 섞인 출력), 영문 1, JD 아님 1, 인젝션 1 — 모두 가상 |

## 서버 검증 규칙 (AI-01)

1. sid 정규화(`S-3`, `s03` → `S3`) 후 JD 문장에 없는 sid 제거. 요건의 sid는 중복 제거·번호순.
2. sid가 0개가 된 요건, 텍스트가 빈 요건은 버림.
3. 같은 텍스트(NFKC·대소문자·공백·끝 문장부호 무시) 요건은 합침: 먼저 나온 요건의 위치·카테고리 유지, sid 합집합, 키워드 합집합(대소문자 무시, 최대 10), 하나라도 high면 high.
4. `company_name`/`position_title`: 값이 비었거나 유효 sid가 없으면 null.
5. `seniority`: 유효 sid 없음, `min_years > max_years`, 값이 전혀 없음 → null.
6. `tech_keywords`: 유효 sid 없으면 버림, 같은 키워드(대소문자 무시)는 합침. `other_sids`도 거름.
7. `detected_language`: 소문자화, ISO 형식(`ko`, `en`, `zh-hant`)이 아니면 null. `warnings` 중복·빈 값 제거.
8. 요건 0개: `is_likely_jd = false` → `not_a_jd`(재시도 없음), 아니면 1회 재시도 후 `schema_invalid`(retryable false).
9. 검증 보고서(`extraction.validation_report`)와 로그는 개수만 남긴다(C-7). 키: `requirements_proposed/kept/dropped_no_sid/dropped_empty_text/merged`, `sids_dropped`, `company_name_dropped`, `position_title_dropped`, `seniority_dropped`, `tech_keywords_dropped/merged`, `other_sids_dropped` (+ 로그에만 `not_a_jd`, `empty_requirements`).

## requirements_hash 규칙 (TS 한 곳: `computeRequirementsHash`)

- `sort_order` 순서의 `{category, content, importance, source_sids(번호순)}` 배열 + 규칙 버전 `v: 1`의 `hashCanonical`. 행 id는 넣지 않는다.
- 추출 직후(p_result)와 이후 기능의 `buildJdContext`(DB 행에서 계산)가 같은 값을 낸다(테스트로 고정). 이전 `buildJdContext`는 행 id를 포함해 추출 시 값과 달라질 수 있었다 → 이번에 통일.
- 계획은 `category·content·source_sids`였지만 `importance`도 넣었다. 프롬프트에 "중요"로 렌더링되어 출력에 영향을 주기 때문이다(편차, 아래 참고).

## R-31 게이트 요건

- `selectGateRequirements(rows, { skillNames, texts }, max = 8)`: `sort_order` 순으로 high 전부 먼저, 남은 자리를 "근거 약함" normal 요건으로. 결과는 JD 순서로 다시 정렬. 반환 필드는 `id, category, content, importance, reason`만(키워드·sid 없음).
- 근거 약함 [가정 S5-7]: 요건 키워드를 `signalKey`(NFKC, 소문자, 공백·`.`·`-`·`_`·`/`·`·` 제거)로 바꿔 스킬 이름과 정확히 같거나 프로젝트·상세 텍스트에 포함되면 "근거 있음". 2글자 미만 키워드는 스킬 정확 일치만 본다. 키워드 0개 요건은 약함으로 본다.
- `replyUserBlocks`: `ctx.input.gate`가 있고 목록이 비어 있지 않을 때만, 공유 프리픽스(sharedBlocks) 바로 뒤에 `<gate_requirements>` 블록(카테고리·중요·내용만, 태그 이스케이프).
- 응답 system에 "질문 주제·순서 선택에만 쓰고, 기술명·도구명·수치를 사용자 경험처럼 묻지 않는다, 요건 문구를 옮기지 않는다, 경험을 만들도록 유도하지 않는다" 지시 추가.
- 정리(extract) 호출에는 들어가지 않고, V-9 컨텍스트는 사용자 발화만으로 만든다 — `AI-12.gate.test.ts`가 고정: 유효한 사용자 인용을 달아도 요건의 "Kafka"가 skill·action 패치로 들어가지 못함(V-9 거부), extract 요청 전체에 요건 문구 없음.

### api-engineer 연결 방법
`return_target.application_project_id`가 있는 게이트 턴에서 `jd_requirements`(id, category, content, keywords, importance, sort_order)와 커리어 신호(스킬 `normalized_name ?? name`, complete 프로젝트·상세의 name/summary/role/situation/task/action/result 텍스트)를 읽어 `selectGateRequirements` 결과를 `WritingChatTurnInput.gateRequirements`에 넣는다. 요건이 없거나 프로젝트가 삭제됐으면 `[]` 또는 생략.

## 테스트·픽스처

- `validation/jd-extraction.test.ts`: sid 정규화, 텍스트 키, 정상/잡음 출력, 합치기, 키워드 상한, seniority 3가지 버림, 언어 코드, 경고 중복.
- `pipelines/AI-01.test.ts`: 픽스처 5종, 등급·사고·호출 키·prompt_version, 요건 0개 재시도 성공/실패, V-6 2회 실패, 키워드 11개 → 재시도, 문장 0개 → 호출 없이 `not_a_jd`, 공급자 오류 전파, 취소, `<jd>`/`<reference>` 렌더링·이스케이프·커리어 데이터 없음, 로그 개수만, 해시가 저장 행 기준 재계산과 같음.
- `storage/jd-extraction.test.ts`: db-engineer `p_result` 모양(키 목록, `{value, source_sids}`, `sort_order` 0부터, content 1~500, sid 실재, keyword 1~100자, JSON 왕복).
- `context-pack/gate-requirements.test.ts`, `pipelines/AI-12.gate.test.ts`.

## 편차·[가정]·스펙 차이

1. **prompt_version 표기**: 계획은 `AI-01@1`, 구현은 기존 규칙(C-4 예시 `ai-02.match.v1`, S4 `ai-12.reply.v1+common.v1`)에 맞춰 `ai-01.extract.v1+common.v1`.
2. **파이프라인 인자**: 계획은 `(input, llm, signal)`, 구현은 AI-12와 같이 `(input, { llm, signal, callKey, logger, jobId })`. api-engineer `src/server/jobs/jd-extraction.ts`는 이미 이 형태로 호출 중.
3. **requirements_hash에 importance 포함**(위 참고). 행 id 제외로 `buildJdContext` 값도 바뀜 — 아직 저장된 해시가 없으므로 영향 없음.
4. **[가정] 길이 상한**: text ≤ 300, keywords ≤ 10(각 ≤ 60), 요건 ≤ 100, tech_keywords ≤ 60, other_sids ≤ 1000, warnings ≤ 5(각 ≤ 200), 회사명·포지션명 ≤ 200. 상한 초과는 V-6 실패 → 1회 재시도.
5. **[가정 S5-4]** 요건 0개 + `is_likely_jd = false` → `not_a_jd`. 문장 0개(기호만 있는 원문)도 호출 없이 `not_a_jd`.
6. **[가정 S5-7]** 근거 약함 판정(위). 키워드 0개 요건 = 약함.
7. **seniority 수치 가드 없음**: 카드에 규칙이 없어 `min_years`가 인용 문장에 숫자로 있는지는 보지 않는다(sid 존재만). 필요하면 후속으로 추가 가능(영문 "five years" 같은 표기 때문에 보류).
8. **p_result 모양**: 리더 결정대로 db-engineer 노트를 따름(`company_name`/`position_title` 객체, `sort_order` 0부터). DB가 읽지 않는 `schema_version`, `prompt_version` 키가 더 있다 — DB 모양 검사가 추가 키를 거부하지 않는지 db-engineer 확인 요청.
9. **`structured.ts` 공용 변경**: `accept` 선택 인자 추가(기존 호출 영향 없음).

## 다른 담당에게 요청

- db-engineer: (1) `p_result`의 추가 키(`schema_version`, `prompt_version`, `seniority`, `other_sids`, `warnings`, 요건의 `sort_order`)를 허용하는지 확인. (2) sid는 항상 정규형 `S<n>`으로 보낸다.
- api-engineer: 게이트 턴에서 `gateRequirements` 채우기(위 "연결 방법"). AI-12 응답 prompt_version이 v2로 바뀌었으므로 응답 관련 스냅샷 테스트가 있으면 갱신.

## QA 1라운드 반영 (2026-10-31)

- **QA-S5-01** `splitJdSentences`: 내용 판정을 `/[\p{L}\p{N}]/u`로 바꿔 키릴·아랍·태국 문자도 문장이 된다. 기호만 있는 원문(`----`, `• • •`)은 여전히 0개 → DB가 `[]`를 받고 AI-01은 호출 없이 `not_a_jd`(사용 기록 0). 테스트: `jd.test.ts`(키릴·아랍·태국·유니코드 숫자, 기호만), `AI-01.test.ts`(기호만 → 호출 없음, 키릴 JD → 정상 추출).
- **QA-S5-04** AI-12 SHARED_RULES 데이터 블록 목록에 `<gate_requirements>` 추가. 공통 문구가 바뀌어 정리 버전도 `extract.v1 → v2`로 올림(응답은 출시 전 v2 유지). 테스트: 두 system 모두 이 블록을 지시 무시 규칙에 포함하는지 확인.
- 스펙 차이는 `_workspace/backend/spec-gaps.md` "2026-10-31 · S5 (ai)"에 ①~⑦로 기록.
- api-engineer 참고: AI-12 정리 prompt_version도 v2로 바뀌었다.
