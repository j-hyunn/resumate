# S6 AI 파이프라인 구현 노트 (ai-pipeline-engineer)

> 상태: QA 1라운드(QA-S6-03·04·09) 반영. 이전 상태 — typecheck(src/server/ai 오류 0 — 전체에는 api 쪽 `insights` 타입 미생성 오류가 남아 있음), lint(src/server/ai) 0건, vitest src/server/ai 31파일 579개 통과.

## api-engineer용 시그니처 (먼저 확정)

모듈: `src/server/ai/pipelines/AI-02.ts`

```ts
import {
  AI02_TIER,              // "default"
  AI02_BATCH_SIZE,        // 8
  AI02_PROMPT_VERSION,    // insights.prompt_version / ai_jobs.prompt_version 저장값 (match+synthesize+common 합성 문자열)
  buildInsightContext,
  batchRequirements,
  matchRequirements,
  synthesizeInsight,
  finalizeInsight,
  computeInsightInputHash,
} from "@/server/ai/pipelines/AI-02";

// 1) 컨텍스트: 단계마다 DB 행으로 다시 만든다(결정적, 순수 함수). 같은 행 → 같은 별칭.
export function buildInsightContext(input: {
  careerRows: CareerRows;                 // context-pack/career-rows.ts (S3와 같은 로더)
  asOf?: YearMonth;                       // 테스트용. 기본: 서울 기준 이번 달
  jobDescriptionId: string;
  jobDescriptionUpdatedAt: string | null;
  sentences: readonly JdSentence[];       // job_descriptions.sentences
  requirements: readonly JdRequirementInput[]; // jd_requirements 행 (sort_order 순)
  positionTitle: string | null;           // job_descriptions.position_title
  seniorityLabel: string | null;          // job_descriptions.extraction.seniority.label (없으면 null)
}): InsightContext;
// InsightContext = { pack, jd, requirements(sort_order 순), careerSnapshotHash, requirementsHash, dataSufficiency, ... }

// 2) 배치 분할 (요건 id 배열 또는 행 배열 모두 가능)
export function batchRequirements<T>(requirements: readonly T[], size?: number /* 8 */): T[][];

// 3) 단계 1: 배치 1개 = 호출 1개. 호출 직후 검증까지 끝낸 "직렬화 가능한" 결과를 돌려준다.
export async function matchRequirements(
  input: { context: InsightContext; batchIndex: number; requirementIds: readonly string[] },
  deps: Ai02Deps,
): Promise<MatchBatchResult>;

// 4) 단계 2 — QA-S6-03: 단계 1개 = 논리 호출 1개(V-6 재시도 1회는 안에 포함). 결과는 JSON 그대로 단계 출력에 저장.
export async function synthesizeOnce(
  input: { context: InsightContext; batches: readonly MatchBatchResult[] },
  deps: Ai02Deps,
): Promise<SynthesisAttempt>;                       // kind "first", callKey insight.synthesize
export async function regenerateSynthesis(
  input: { context: InsightContext; batches: readonly MatchBatchResult[]; violations: readonly string[] /* first.violations */ },
  deps: Ai02Deps,
): Promise<SynthesisAttempt>;                       // kind "regen", callKey insight.synthesize.regen. violations가 비면 Error
// 단계 순서: synthesize(synthesizeOnce) → first.violations.length > 0 일 때만 synthesize_regen(regenerateSynthesis) → validate(finalizeInsight + complete_insight)

// 5) 병합 → 검증 → 저장 payload (순수 함수, 호출 없음). 어느 실행에서 불러도 된다(아래 "재매핑").
export function finalizeInsight(input: {
  context: InsightContext;                 // 이 실행에서 다시 만든 것
  batches: readonly MatchBatchResult[];
  first: SynthesisAttempt;                 // kind "first"
  regen: SynthesisAttempt | null;          // 있으면 이것을 쓴다. 남은 위반 숫자는 [수치 확인 필요]로 치환
  snapshot: { careerSnapshotHash: string; requirementsHash: string };  // QA-S6-09: prepare에서 잡은 값. 이 값이 저장·input_hash에 들어간다
  provider: ProviderId; modelTier: ModelTier; connectionTier: ConnectionTier;  // 작업의 고정값
  now: Date;
  logger?: AiLogger; jobId?: string | null;
}): FinalizedInsight;
// FinalizedInsight = { payload /* complete_insight p_payload 그대로 */, summaryCounts, report, usage, inputHash }

export type SynthesisAttempt = {
  v: 1; kind: "first" | "regen";
  promptVersion: string; model: string;
  usage: NormalizedUsage; attempts: number;          // 이 호출(+V-6 재시도) 몫. finalize가 배치·first·regen을 합산
  careerSnapshotHash: string; requirementsHash: string;  // 만들 때의 context
  output: Ai02SynthesisOutput;                       // 그 context의 별칭 형태
  refs: Record<string, { source_type; source_id; sid: string | null }>;  // 출력에 나온 별칭 → 행 id
  violations: string[];                              // V-5 근거 없는 숫자(원문, 중복 제거)
};
// 재매핑: finalize의 context 해시가 attempt와 다르면(단계 사이 커리어·요건 변경) refs로 행 id → 현재 별칭으로 옮긴다.
//         사라진 행을 가리키는 참조·근거는 검증에서 떨어진다. 따라서 finalize는 synthesize와 다른 실행(validate 단계)에서 불러도 된다.

// 요건 목록(id 집합)이 단계 1과 달라지면(추가·삭제) restoreMatches/synthesize*/finalize가
// InsightRequirementsChangedError(code "requirements_changed", AiError 아님)를 던진다. 작업 종료 코드는 api가 정한다.

// 6) input_hash (라우트의 재사용 판정)
export function computeInsightInputHash(parts: {
  provider: ProviderId; model: string /* resolveModel(provider, "default") */;
  careerSnapshotHash: string; requirementsHash: string;
}): string;

// 보조
export function restoreMatches(batches, context): { matches: ValidatedMatch[]; report };   // 단계 1 → 현재 별칭 형태
export function adaptSynthesisOutput(attempt, context): { output; remapped: boolean };

export type Ai02Deps = {
  llm: Llm;
  signal?: AbortSignal;   // abort("canceled") = 사용자 취소, 그 밖의 이유 = timeout
  logger?: AiLogger;
  jobId?: string | null;
};
```

### 단계 1 직렬화 형태 (작업 단계 출력에 그대로 JSON 저장)

`MatchBatchResult`는 JSON.stringify/parse 왕복이 안전한 평범한 객체다(Map·Date·클래스 없음). **별칭이 아니라 UUID로 저장**하므로, 단계 사이에 커리어 데이터가 바뀌어 별칭 번호가 달라져도 안전하다. 단계 2·finalize가 현재 별칭 지도로 다시 풀고, 사라진 근거는 버린 뒤 판정 규칙(V-4, met 강등)을 다시 적용한다.

```ts
export type MatchBatchResult = {
  v: 1;
  batchIndex: number;
  promptVersion: string;            // "ai-02.match.v2+common.v1"
  model: string;
  usage: NormalizedUsage;           // 이 배치의 시도 합계 (insights.usage 합산용)
  attempts: number;                 // 1 또는 2 (V-6 재시도 포함)
  careerSnapshotHash: string;       // 이 배치를 만들 때의 값 (참고용)
  requirementsHash: string;
  matches: StoredMatch[];           // 배치의 요건마다 정확히 1개, 요건 순서
  report: Record<string, number>;   // 개수만 (validation_report 합산용)
};
export type StoredMatch = {
  requirement_id: string;           // jd_requirements.id
  status: "met" | "partial" | "no_evidence";   // 서버 규칙 적용 후
  model_status: "met" | "partial" | "no_evidence" | null; // 모델 원래 판정(빠진 요건은 null)
  rationale: string;
  missing_aspect: string | null;
  evidence: StoredEvidence[];
};
export type StoredEvidence = {
  source_type: EvidenceSourceType;  // jd_requirement/jd_sentence 포함 가능
  source_id: string;                // UUID (jd_sentence는 job_descriptions.id)
  sid: string | null;               // jd_sentence만
  field: string | null;
  quote: string | null;
  quote_adjusted: boolean;
};
```

- 진행 단계 `match`의 `done/total` = 배치 수. 단계 1 부분 결과(S-16)는 `MatchBatchResult.matches`의 `requirement_id`·`status`·`rationale`·`missing_aspect`를 그대로 쓰면 된다(근거 칩은 최종 저장 뒤에만).

### 던지는 오류

| code | 언제 | retryable |
|------|------|-----------|
| C-11 공급자 코드(`rate_limited`, `daily_quota_exhausted`, `billing_required`, `key_invalid`, `key_missing`, `model_not_available`, `provider_unavailable`, `input_too_long`, `safety_blocked`, `timeout`, `canceled`) | `ProviderError` 그대로 전파 | 코드 정책(`retryPolicy`) — 재시도 판단은 실행기 |
| `schema_invalid` | V-6 불일치 2회(파이프라인 안에서 1회 재시도를 이미 씀) | **false** |

- V-5 재생성 호출도 공급자 오류를 그대로 던진다(재생성 실패 = 단계 2 실패).
- `finalizeInsight`는 호출이 없고 AiError를 던지지 않는다. 입력이 잘못되면(배치가 요건을 다 덮지 않음, 다른 context) 일반 `Error`(프로그래밍 오류).
- `matchRequirements`에 빈 `requirementIds` 또는 context에 없는 id → 일반 `Error`.

### 호출 키·요청 메타

- `callKey`: 단계 1 `insight.match.{batchIndex+1}`, 단계 2 `insight.synthesize`, V-5 재생성 `insight.synthesize.regen`
- `feature`(로그): `AI-02.match`, `AI-02.synthesize`
- 등급 `default`, 사고: 단계 1 `low`, 단계 2 `medium`

### complete_insight p_payload

db-engineer 노트의 모양 그대로. 매퍼 `toCompleteInsightPayload` (`src/server/ai/storage/insight.ts`), `finalizeInsight(...).payload`를 그대로 넘기면 된다.

```jsonc
{
  "result": {
    "schema_version": 1,
    "basis_note": "입력된 경력 데이터 기준 분석입니다",
    "data_sufficiency": { "level": "ok" | "thin", "hints": ["…"] },
    "requirement_matches": [ { "item_key": "requirement_matches.<요건uuid>", "requirement_id", "status", "rationale", "missing_aspect" } ],  // 요건 sort_order 순, 요건마다 1개
    "summary_counts": { "met", "partial", "no_evidence" },
    "strengths": [ { "item_key": "strengths.0", "title", "description", "requirement_ids": [uuid] } ],          // ≤ 3
    "gaps": [ { "item_key": "gaps.0", "requirement_ids", "gap_kind", "description",
                "actions": [ { "item_key": "gaps.0.actions.0", "type": "add_data"|"reframe"|"prepare_answer", "text" } ] } ],
    "strategy": { "positioning": "…" | null, "positioning_item_key": "strategy.positioning",
                  "project_priorities": [ { "item_key": "strategy.project_priorities.0", "rank": 1, "project_id", "reason", "requirement_ids" } ] }  // ≤ 5
  },
  "match_stage_result": { "schema_version": 1, "prompt_version": "ai-02.match.v2+common.v1", "batches": 2,
                          "matches": [ { "requirement_id", "status", "model_status", "rationale", "missing_aspect" } ] },
  "hashes": { "requirements_hash", "career_snapshot_hash", "input_hash" },
  "meta": { "schema_version": 1, "prompt_version": "ai-02.match.v2+ai-02.synthesize.v2+common.v1", "provider", "model", "model_tier", "connection_tier",
            "validation_report": { /* 개수만 */ }, "usage": { /* NormalizedUsage 합계: 배치 + 단계 2(재시도·재생성 포함) */ } },
  "evidence": [ /* toEvidenceLinkRows 행. owner 키는 자리값(RPC가 덮어씀). jd_sentence는 source_locator {sid,start,end}, source_id = job_descriptions.id */ ]
}
```

- `result`·`match_stage_result` 어디에도 `evidence`/`positioning_evidence` 키가 없다(테스트로 고정).
- 근거가 붙는 item_key: `requirement_matches.<uuid>`(met/partial만), `strengths.n`, `gaps.n`(JD 문장 근거가 있을 때), `gaps.n.actions.m`(근거가 있을 때), `strategy.positioning`. `strategy.project_priorities.n`은 근거 행이 없다(프로젝트 참조 자체가 근거).
- 화면의 "보완점 → 입력 링크"(F-P2-09)는 `gaps[].requirement_ids`와 `actions[].type = add_data`로 찾는다.

## 만든 것

| 파일 | 내용 |
|------|------|
| `src/server/ai/schemas/AI-02.ts` | 단계 1 `Ai02MatchOutputSchema`, 단계 2 `Ai02SynthesisOutputSchema`(정본 스키마 규칙, 깊이 4). 상태·보완 종류·대응 종류 `as const` 목록 |
| `src/server/ai/prompts/AI-02/index.ts` | `AI02_SYSTEM`(두 단계 공통, 경계 사례 3개, 금지 표현, 대응 3종), `matchUserBlocks`, `synthesizeUserBlocks`(V-5 재생성 피드백 포함). 캐시 지점: AI-02 system, 경력 팩, JD |
| `src/server/ai/validation/insight.ts` | `validateMatchBatch`, `applyMatchRules`, `supportsMet`, `recheckEvidence`, `validateSynthesis`, `synthesisNumberViolations`, 보고서 확장 키 |
| `src/server/ai/pipelines/AI-02.ts` | `buildInsightContext`, `computeDataSufficiency`, `computeInsightInputHash`, `batchRequirements`, `matchRequirements`, `restoreMatches`, `synthesizeInsight`, `finalizeInsight` |
| `src/server/ai/validation/alias-text.ts` | QA-S6-04: `replaceAliasesInText`, `aliasDisplayLabel`, `literalAliasTokens`, `ALIAS_TOKEN_PATTERN` |
| `src/server/ai/storage/insight.ts` | `toCompleteInsightPayload`, `INSIGHT_ITEM_KEYS` |
| `src/server/ai/__fixtures__/AI-02/insight.ts` | 한국어 JD(요건 10개 → 8+2 배치), 영문 JD(요건 1개), 얇은 데이터, 기록형 단계 1·2 출력(모두 가상) |
| 테스트 | `pipelines/AI-02.test.ts`(31), `validation/insight.test.ts`(표 기반 21) |

## 기능별 모델 등급·prompt_version

| 호출 | 등급 | 사고 | 최대 출력 | prompt_version | callKey |
|------|------|------|-----------|----------------|---------|
| 단계 1 (배치마다) | default | low | 8,192 | `ai-02.match.v2+common.v1` | `insight.match.{n}` |
| 단계 2 | default | medium | 12,000 | `ai-02.synthesize.v2+common.v1` | `insight.synthesize` |
| 단계 2 V-5 재생성 | default | medium | 12,000 | 같음 | `insight.synthesize.regen` |

- 저장값(`insights.prompt_version`, input_hash): `ai-02.match.v2+ai-02.synthesize.v2+common.v1`.
- 블록 순서(C-8): system [공통] → [AI-02 공통] / user [경력 팩] → [JD: 포지션·요건 전체·인용 문장·seniority] → [단계 입력]. 배치끼리, 그리고 단계 2까지 앞 4블록이 바이트 단위로 같다(테스트로 고정). 단계 2는 이 위에 `<match_results>` + `<task>`.

## 검증 규칙 적용 범위

단계 1 (`matchRequirements` 안, 호출 직후)
1. `requirement_ref`가 이번 배치 요건이 아니면 판정 버림. 같은 요건 두 번째 판정 버림. 빠진 요건은 `no_evidence`로 채움 `[가정 S6-2]`.
2. 근거마다 V-1(별칭·타입) → V-2(필드) → V-3(인용, 70% 부분 일치는 원문 구간으로 교체 + `quote_adjusted`) → V-8(`learnings`는 AI-02에서 전부 금지, C-9).
3. V-4: met/partial인데 경력 사실 근거(JD 근거·회고 제외)가 0개 → `no_evidence`, 이유 고정 문구.
4. met 규칙: 근거에 상세 내용 `action`/`result` 또는 성과가 없으면 `partial`.
5. `no_evidence` 판정의 근거는 버림(올리지 않음).
6. V-5: 이유·부족한 측면의 근거 없는 숫자 → `[수치 확인 필요]`(재생성 없음, spec-gaps ④).

단계 2 (`synthesizeInsight`에서 V-5 재생성, `finalizeInsight`에서 나머지)
1. 단계 1 결과 복원: UUID → 현재 별칭, 사라진 근거는 버리고 V-4·met 규칙 재적용.
2. V-5: 생성 텍스트 전부에서 근거 없는 숫자가 있으면 위반 숫자 목록을 붙여 1회 재생성. 재생성 결과에 남은 숫자는 finalize에서 치환.
3. 강점: V-1~V-3·V-8 → V-4(경력 사실 근거 0개면 제거) → `requirement_refs`는 met/partial만, 남는 게 없으면 제거 → 최대 3개. 강점 근거 집합이 모두 같으면 `strengths_same_evidence = 1`(품질 신호).
4. 보완점: 요건 참조는 partial/no_evidence만, 없으면 제거, `gap_kind` 재계산. 보완점 근거는 JD만이어도 됨. `reframe`/`prepare_answer`는 경력 사실 근거가 없으면 제거, `add_data`는 근거 없어도 남김.
5. 포지셔닝: 경력 사실 근거가 없으면 `null`.
6. 우선순위: PRJ 별칭이 실재해야 함, 같은 프로젝트 1번, 모델 순위대로 1..n, 최대 5개.
7. `summary_counts`·`data_sufficiency`·`item_key`·UUID 변환은 서버가 만든다.

`validation_report` 키: 공통(`items_total`, `items_dropped`, `items_downgraded`, `evidence_*`, `quotes_adjusted`, `number_violations`, `numbers_replaced`, …) + AI-02 확장(`requirements_total`, `matches_dropped_unknown_ref`, `matches_dropped_duplicate`, `matches_filled_missing`, `met_downgraded_partial`, `evidence_lost_on_restore`, `strengths_dropped_no_match`, `strengths_truncated`, `strengths_same_evidence`, `gaps_dropped_no_requirement`, `gap_kind_corrected`, `actions_dropped`, `positioning_dropped`, `priorities_dropped`, `priorities_truncated`, `requirement_refs_dropped`, `synthesis_regenerated`). 숫자만, 로그도 같다(C-7).

## 이벤트·진행 단계·오류 코드

- 진행 단계는 api가 기록한다: `match`(done/total = 배치 수) → `synthesize`(`synthesizeOnce`) → (위반이 있을 때만) 재생성 단계(`regenerateSynthesis`) → `validate`(`finalizeInsight` + `complete_insight`). QA-S6-03 이후 단계 1개 = 논리 호출 1개.
- 오류: 위 "던지는 오류" 표.

## 테스트·픽스처

- 픽스처 `src/server/ai/__fixtures__/AI-02/insight.ts`: 모델 출력은 context에서 별칭을 찾아 만든다(팩 번호가 바뀌어도 깨지지 않음).
- 계획의 7가지: 충분한 데이터(전체 흐름), 얇은 데이터(`thin`), 스킬 태그만(`met` → `partial`), 회고만(V-8 → `no_evidence`), 수치 위반(단계 1 치환, 단계 2 재생성 성공·실패), 별칭 오류(없는 REQ·DET, 잘못된 필드, 틀린 인용, 없는 PRJ), 영문 JD 요건 1개.
- 그 밖: JSON 왕복 후 결과 동일, 단계 사이 커리어 변경(근거 상실 → 재판정), 배치 누락·중복 거부, V-6 2회 → `schema_invalid`, 공급자 오류 전파, 캐시 프리픽스 동일성, 로그에 본문 없음, 정본 스키마 변환.

## 스펙 차이·가정 (spec-gaps "2026-11-01 · S6 (ai)" ①~⑨)

- 상수: `AI02_BATCH_SIZE = 8`, `INSIGHT_MAX_STRENGTHS = 3`, `INSIGHT_MAX_PRIORITIES = 5`, `THIN_MAX_COMPLETE_PROJECTS = 2` `[가정 S6-4]`, V-3 부분 일치 70%(기존 `QUOTE_PARTIAL_MATCH_THRESHOLD`).
- 두 단계 공통 system 블록(캐시), 빠진 요건 채우기, 강등 시 이유 문구, 단계 1 수치 치환, 저장 키 이름(`*_id(s)`), 참조 정리, hints 문구, 단계 1 UUID 형태, `match_stage_result`에 근거 없음.

## QA 1라운드 반영 (2026-11-01)

| 이슈 | 조치 |
|------|------|
| QA-S6-03 | `synthesizeInsight` 삭제 → `synthesizeOnce` / `regenerateSynthesis` / `finalizeInsight(first, regen)`. 단계당 논리 호출 1개. 단계 2 결과에 `refs`(별칭 → 행 id)를 담아 finalize가 다른 실행에서도 안전하게 재매핑. 테스트: 단계별 JSON 왕복, 재생성 성공·실패 치환, 단계 사이 커리어 변경 재매핑 |
| QA-S6-04 | 프롬프트에 "별칭은 참조 칸에만, 문장에는 이름" 규칙(+예시) 추가 → `ai-02.match.v2`, `ai-02.synthesize.v2`. 서버: 저장되는 모든 문장(단계 1 `rationale`·`missing_aspect`, 단계 2 전체)에 V-5 치환 뒤 별칭 → 표시 이름(프로젝트·상세 제목·요건 내용·문장은 `'…'`로 감싸 40자, 스킬은 이름, 프로필은 "프로필", 모르는 별칭은 삭제 + 빈 괄호 정리). 사용자 데이터에 그대로 있는 토큰(예: "AWS S3")은 두다. 보고서 `aliases_replaced`·`aliases_removed`. 테스트: 표 기반 11 + 파이프라인 3 |
| QA-S6-09 | `finalizeInsight`가 `snapshot`(prepare 시점 `careerSnapshotHash`·`requirementsHash`)을 받아 저장·input_hash에 쓴다 → 작업 중 변경은 조회에서 stale. 검증은 현재 context 기준. 요건 id 집합 변경은 `InsightRequirementsChangedError` |

- 검사: typecheck(src/server/ai 0건), lint 0건, vitest src/server/ai 32파일 598개 통과. api 쪽(`src/server/jobs/insight.ts`)은 `synthesizeInsight` 삭제로 컴파일이 깨지며 api-engineer가 새 단계 구조로 옮긴다.
