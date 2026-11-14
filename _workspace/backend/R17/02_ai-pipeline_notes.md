# R17 AI 파이프라인 구현 노트 (ai-pipeline-engineer)

## 인터페이스 (api-engineer가 부르는 시그니처 — 이 절이 계약)

모든 경로는 `src/server/ai/` 기준. 바뀌지 않은 export(`splitJdSentences`, `JdSentence`, `AliasMap`, `Llm` 등)는 생략.

### 1. JD 컨텍스트 — `context-pack/jd.ts`

```ts
export type JdContext = {
  text: string;            // "<jd>\nposition_title: …\n<sentences>\nS1: …\n…\n</sentences>\n</jd>" (로그 금지)
  aliases: AliasMap;       // S1…Sn → source_type "jd_sentence", id = jobDescriptionId, locator {sid,start,end}
  jdTextHash: string;      // = 입력 rawTextHash 그대로 (job_descriptions.raw_text_hash)
  numberTexts: string[];   // V-5 원천: position_title + 모든 문장
  sentenceCount: number;
};

export function buildJdContext(input: {
  jobDescriptionId: string;
  jobDescriptionUpdatedAt?: string | null;
  sentences: readonly JdSentence[];      // job_descriptions.sentences 전체
  positionTitle?: string | null;         // application_projects / job_descriptions 의 사용자 입력 직무명
  rawTextHash: string;                   // job_descriptions.raw_text_hash
}): JdContext;
```

- 삭제: `JdRequirementInput`, `computeRequirementsHash`, `REQUIREMENTS_HASH_VERSION`, `includeSentences` 옵션, `requirementsHash` 필드.
  → `services/insight/{db,job}.ts`, `job.test.ts`가 `JdRequirementInput`를 import 중 — 제거 필요(과거 v1 표시용 `jd_requirements` 행 타입은 서비스 쪽에서 직접 정의).
- 문장이 0개여도 던지지 않는다(`<sentences>` 블록 생략, `sentenceCount: 0`). 문장 0개 공고로 인사이트를 시작할지는 서비스가 막는다(아래 [가정 R17-AI-3]).

### 2. 입력 해시 — `input-hash.ts`

```ts
export type InputHashParts = { feature; promptVersion; provider; model; careerSnapshotHash: string | null; jdTextHash: string | null; params? };
export const INPUT_HASH_VERSION = 3;   // canonical 키도 requirements_hash → jd_text_hash
```

### 3. AI-02 인사이트 v2 — `pipelines/AI-02.ts`

단계: `buildInsightContext`(매 단계) → `matchRequirements`(1단계, **호출 1회**) → `synthesizeOnce` → (위반 숫자 있으면) `regenerateSynthesis` → `finalizeInsight`(호출 없음).
삭제: `AI02_BATCH_SIZE`, `batchRequirements`, `MatchBatchResult`, `InsightContext.requirements`, `seniorityLabel`.

```ts
export type InsightContextInput = {
  careerRows: CareerRows;
  asOf?: YearMonth;
  jobDescriptionId: string;
  jobDescriptionUpdatedAt: string | null;
  sentences: readonly JdSentence[];
  positionTitle: string | null;
  rawTextHash: string;                 // job_descriptions.raw_text_hash
};
export type InsightContext = {
  pack: CareerPack; jd: JdContext; jdText: string; aliases: AliasMap;
  careerSnapshotHash: string;
  jdTextHash: string;                  // = rawTextHash
  sentenceCount: number;
  allowedNumbers: ReadonlySet<string>; textGuard: TextGuard; dataSufficiency: InsightDataSufficiency;
};
export function buildInsightContext(input: InsightContextInput): InsightContext;

export function computeInsightInputHash(parts: {
  provider: ProviderId; model: string; careerSnapshotHash: string; jdTextHash: string;
}): string;

// ---- 1단계 (단일 호출, 결과는 JSON-safe → job step output 그대로 저장) ----
export type StoredEvidence = { source_type; source_id; sid: string | null; field: string | null; quote: string | null; quote_adjusted: boolean }; // 변화 없음
export type StoredMatch = {
  requirement_id: string;              // "M1" … "Mn" (서버가 남은 순서대로 부여)
  requirement: {
    content: string;                   // ≤ 200자, 숫자·별칭 가드 적용 후
    category: "responsibility" | "required" | "preferred";
    importance: "high" | "normal";
    sentence_ids: string[];            // ["S3", …] ≥ 1, 컨텍스트에 있는 문장만
  };
  status: "met" | "partial" | "no_evidence";
  model_status: "met" | "partial" | "no_evidence";
  rationale: string;
  missing_aspect: string | null;
  evidence: StoredEvidence[];          // 커리어 근거만(UUID 형태). JD 문장 근거는 sentence_ids에서 finalize가 만든다
};
export type MatchStageResult = {
  v: 2;
  promptVersion: string; model: string; usage: NormalizedUsage; attempts: number;
  careerSnapshotHash: string; jdTextHash: string;
  matches: StoredMatch[];              // 0개일 수 있음 ([가정 R17-AI-3])
  report: Record<string, number>;
};
export function matchRequirements(input: { context: InsightContext }, deps: Ai02Deps): Promise<MatchStageResult>;

// ---- 2단계 ----
export type SynthesisAttempt = { v: 2; kind: "first" | "regen"; promptVersion; model; usage; attempts;
  careerSnapshotHash: string; jdTextHash: string; output: Ai02SynthesisOutput; refs: Record<string, StoredRef>; violations: string[] };
export function synthesizeOnce(input: { context: InsightContext; match: MatchStageResult }, deps: Ai02Deps): Promise<SynthesisAttempt>;
export function regenerateSynthesis(input: { context: InsightContext; match: MatchStageResult; violations: readonly string[] }, deps: Ai02Deps): Promise<SynthesisAttempt>;

// ---- 마무리 (순수 함수) ----
export function finalizeInsight(input: {
  context: InsightContext;
  match: MatchStageResult;
  first: SynthesisAttempt;
  regen: SynthesisAttempt | null;
  snapshot: { careerSnapshotHash: string; jdTextHash: string };   // prepare 시점 값 (저장·input_hash에 쓰임)
  provider: ProviderId; modelTier: ModelTier; connectionTier: ConnectionTier;
  now: Date; logger?: AiLogger; jobId?: string | null;
}): { payload: CompleteInsightPayload; summaryCounts: InsightSummaryCounts; report: Ai02ValidationReport; usage: NormalizedUsage; inputHash: string };

export class InsightRequirementsChangedError extends Error { readonly code = "requirements_changed" } // 이름·code 유지
```

- `InsightRequirementsChangedError`: **의미만 바뀜** — 1단계 결과의 `jdTextHash` ≠ 현재 컨텍스트의 `jdTextHash`(JD 원문이 잡 도중 바뀜)일 때 synthesize/finalize가 던진다. 러너의 `isRequirementsChanged` 매핑은 그대로 쓰면 된다.
- 진행 단계 제안: `prepare → match → synthesize → synthesize_regen → validate` (match의 done/total은 1/1). 부분 결과(S-16 partial)는 `MatchStageResult.matches`에서 읽는다(형태가 배치 → 단일로 바뀜).
- 비용: 1단계 `maxOutputTokens` 16,000, reasoning low / 2단계 12,000, medium. tier `default` 그대로.

### 4. `complete_insight(p_payload)` — `storage/insight.ts` (`CompleteInsightPayload`)

```ts
{
  result: {
    schema_version: 2,
    basis_note, data_sufficiency,
    requirement_matches: Array<{
      item_key: "requirement_matches.M1",
      requirement_id: "M1",
      requirement: { content, category, importance, sentence_ids: string[] },
      status, rationale, missing_aspect,
    }>,
    summary_counts: { met, partial, no_evidence },
    strengths: Array<{ item_key: "strengths.n", title, description, requirement_ids: string[] /* "M{n}" */ }>,
    gaps: Array<{ item_key: "gaps.n", requirement_ids, gap_kind, description, actions: Array<{ item_key: "gaps.n.actions.m", type, text }> }>,
    strategy: { positioning: string | null, positioning_item_key: "strategy.positioning",
                project_priorities: Array<{ item_key, rank, project_id /* UUID */, reason, requirement_ids }> },
  },
  match_stage_result: {
    schema_version: 2, prompt_version: string /* match prompt version */,
    matches: Array<{ requirement_id: "M1", requirement: {…}, status, model_status, rationale, missing_aspect }>,
  },                                   // `batches` 키 삭제
  hashes: { jd_text_hash: string, career_snapshot_hash: string, input_hash: string },   // requirements_hash 없음
  meta: { schema_version: 2, prompt_version, provider, model, model_tier, connection_tier, validation_report, usage },
  evidence: EvidenceLinkInsert[],      // item_key "requirement_matches.M{n}": 커리어 근거 + 인용 문장마다 jd_sentence 1행
                                       //   (source_id = job_descriptions.id, quote = 문장 원문, source_locator {sid,start,end}, source_field null)
}
```

- 새 결과는 `jd_requirement` 근거를 만들지 않는다(R17-1).
- 읽기 쪽(v2 판별): `result.schema_version === 2` 이면 `requirement_matches[].requirement`로 요건 목록을 만든다. v1은 보존된 `jd_requirements` 행.

### 5. 자소서 작성 대화(AI-04) 컨텍스트 — `context-pack/cover-letter-chat.ts`

```ts
export type CoverLetterJdInput = {
  jobDescriptionId: string;
  jobDescriptionUpdatedAt: string | null;
  sentences: readonly JdSentence[];   // 원문 문장 전체
  positionTitle: string | null;
  rawTextHash: string;                // job_descriptions.raw_text_hash
};
// CoverLetterChatContext: requirementsHash 삭제 → jdTextHash: string
```

- 삭제: `companySids`(= `extraction.other_sids`), `requirements`. `loadInsightRequirements`·`other_sids` 로딩은 서비스에서 지운다.
- `ReplyNotice`(prompts/AI-04)에서 `"no_requirements"` 삭제 → 서비스가 이 알림을 보내던 분기도 삭제.
- 모델 스키마에서 `requirement_refs` 삭제(sources·paragraphs). 서버가 내보내는 `SelectedSourceView.requirement_ids`, 블록 `requirement_ids`는 **항상 `[]`** (계약 유지, [가정 R17-10]).
- `AI04_OUTPUT_SCHEMA_VERSION` 4 → 5 (모델 출력 모양이 바뀜; 저장되는 structured_draft 모양은 그대로).

### 6. AI-12 (프로젝트 AI 작성 대화) — `context-pack/writing-chat.ts`

- `WritingChatTurnInput.gateRequirements` 필드 삭제. `context-pack/gate-requirements.ts`(`selectGateRequirements`, `GateRequirement`, `GateRequirementRow`) 파일 삭제 → `services/writing-chat/pipelines.ts`의 `loadGateRequirements` 삭제.
- `prompts/AI-12`의 `renderGateRequirements` 삭제, reply 블록에 `<gate_requirements>` 없음.

### 7. 오류 코드 — `errors.ts`

- `not_a_jd` 메시지·상태 항목 삭제. `AI_ERROR_MESSAGES`/`AI_ERROR_STATUS` 타입은 `Record<Exclude<AiErrorCode, "not_a_jd">, …>` 로 두었다 — `lib/contracts/errors.ts`에서 `not_a_jd`를 지운 뒤에도 그대로 컴파일된다(그 뒤 `Exclude`는 정리해도 됨). 계약에 남아 있는 동안 `new AiError("not_a_jd")`는 일반 메시지(`stalled` 문구)로 떨어진다.

### 8. api-engineer가 고칠 곳 (src/server/ai 밖, 컴파일 깨짐 목록)

- `services/insight/pipeline.ts`: `batchSize`·`requirementIds`·`match(batchIndex…)` 제거 → `match({context})` 1회, `synthesize/regenerate/finalize`에 `match` 전달, `hashes` = `{careerSnapshotHash, jdTextHash}`, `inputHash({…, jdTextHash})`.
- `services/insight/job.ts`·`job.test.ts`·`partial.ts`: `InsightBatch`/`MatchOutput<B>{batches}` → 단일 `MatchStageResult`; `PrepareOutput.requirements` 삭제, `snapshot.jdTextHash`; `not_a_jd`(요건 0개) 분기 삭제 → 문장 0개 처리 결정([가정 R17-AI-3]).
- `services/insight/db.ts`: `loadInsightInputs`가 `raw_text_hash`·`sentences`·`position_title`만 읽게(요건·`extraction.seniority` 불필요).
- `services/insight/insight.integration.test.ts`: `Ai02MatchOutput` 모양 v2(`requirement`, `category`, `importance`, `sentence_refs`), `schema_version: 2`.
- `services/writing-chat/pipelines.ts`: `gate-requirements` import·`loadGateRequirements` 삭제, `CoverLetterJdInput`을 `{…, rawTextHash}`로, `no_requirements` 알림 분기 삭제.
- `jobs/jd-extraction.ts`, `jobs/jd-preview.ts`, `test/jd-extraction-fakes.ts`, `services/application/preview*`, `document-chat.integration.test.ts`: `pipelines/AI-01` import → 파일 삭제 또는 해당 부분 삭제.

---

# R17 AI 파이프라인 구현 노트 (본문)

## 삭제한 것

| 파일 | 내용 |
|------|------|
| `pipelines/AI-01.ts`, `AI-01.test.ts` | JD 요건 추출 파이프라인·미리 보기 요약 |
| `prompts/AI-01/index.ts` | AI-01 프롬프트 (`ai-01.extract.v2`) |
| `schemas/AI-01.ts` | 추출 출력 스키마 (`RequirementCategory`는 `schemas/AI-02.ts`로 옮김 + `RequirementImportance`) |
| `validation/jd-extraction.ts`(+test) | AI-01 검증 |
| `storage/jd-extraction.ts`(+test) | `apply_jd_extraction` payload 매핑 |
| `__fixtures__/AI-01/jds.ts` | AI-01 픽스처 (밖에서 7곳이 import — api-engineer 정리 대상) |
| `context-pack/gate-requirements.ts`(+test) | R-31 게이트 요건 선택 |
| `pipelines/AI-12.gate.test.ts` | `<gate_requirements>` 블록 테스트 |
| `context-pack/jd.ts` 일부 | `JdRequirementInput`, `computeRequirementsHash`, `REQUIREMENTS_HASH_VERSION`, `includeSentences`, `<requirements>` 블록 |
| `errors.ts` 일부 | `not_a_jd` 메시지·상태 (`Exclude` 타입 처리, §7) |
| `prompts/AI-04` 일부 | `no_requirements` 알림, 요건(REQ)·`requirement_refs` 문구 |
| `schemas/AI-04.ts` 일부 | `requirement_refs` (sources·paragraphs) |
| `validation/{cover-letter,draft-blocks}.ts` 일부 | `requirement_refs` → `jd_requirement` 해석 (출력은 항상 `[]`) |
| `prompts/AI-12` 일부 | `<gate_requirements>` 블록·규칙, `renderGateRequirements` |
| `context-pack/writing-chat.ts` 일부 | `gateRequirements` 입력 |

남긴 것: `evidence-rules.ts`의 `jd_requirement`(REQ-n) 소스 타입 — DB 허용 목록·과거 근거 행 때문에 legacy로 유지(R17-1). 어떤 컨텍스트 빌더도 REQ-n을 만들지 않으므로 모델이 쓰면 V-1에서 떨어진다. `alias-text`/`numbers`의 별칭 패턴에 REQ가 남아 있는 것은 산문에서 지우기 위함.

## 기능별 모델 등급·prompt_version

| 호출 | 등급 | prompt_version (이전 → 현재) |
|------|------|------------------------------|
| 공통 | — | `common.v4` → `common.v5` (별칭 예시에서 REQ-1 삭제) |
| AI-02 match (1회) | default, low | `ai-02.match.v5` → `ai-02.match.v6+common.v5` |
| AI-02 synthesize | default, medium | `ai-02.synthesize.v5` → `ai-02.synthesize.v6+common.v5` |
| AI-02 저장값 | — | `ai-02.match.v6+ai-02.synthesize.v6+common.v5` |
| AI-04 generate / adjust | (변화 없음) | v6 → `v7+common.v5` |
| AI-04 extract / reply | (변화 없음) | v1 → `v2+common.v5` |
| AI-12 extract / reply | (변화 없음) | v7 → `v8+common.v5` |
| AI-13 extract / reply / compose | (변화 없음) | 호출 번호 유지, 접미사만 `common.v5` |

- `INPUT_HASH_VERSION` 2 → 3 (`requirements_hash` 키 → `jd_text_hash`). 공통 접미사가 바뀌었으므로 모든 기능의 과거 결과는 재사용되지 않는다(의도).
- `AI02_OUTPUT_SCHEMA_VERSION` 1 → 2 (모델 출력 + 결과 jsonb + meta). `AI04_OUTPUT_SCHEMA_VERSION` 4 → 5 (모델 출력만).

## 출력 스키마 ↔ 저장 매핑 (AI-02 v2)

- 모델 1단계: `matches[] = {requirement, category, importance, sentence_refs[S-n], status, rationale, missing_aspect, evidence[]}`.
- 서버: 남은 순서대로 `M1…Mn`(모델 쪽 별칭 `M-n`). 2단계 `requirement_refs: ["M-3"]` → 저장 `requirement_ids: ["M3"]`.
- 결과 `requirement_matches[].requirement = {content, category, importance, sentence_ids}`; 근거 행 = 커리어 근거 + 인용 문장마다 `jd_sentence`(quote = 문장, locator). 자세한 모양은 인터페이스 §4.
- 산문 가드: 2단계 산문의 `M-n`은 요건 문구(`'…'`, 40자)로 바꾸고, 모르는 `M-n`·`REQ-n`은 지운다.

## 검증 규칙 적용 범위 (AI-02 1단계 v2, `validation/insight.ts` `validateMatchStage`)

1. `requirement` 공백 → 버림 (`matches_dropped_empty`)
2. `sentence_refs`: 이 JD의 S-n만(V-1), 중복 제거 (`sentence_refs_dropped`); 0개면 그 항목 버림 (`matches_dropped_no_sentence`)
3. 앞에서부터 `AI02_MAX_MATCHES`(20)개 (`matches_truncated`)
4. evidence V-1/V-2/V-3/V-8 → JD 근거는 match evidence에서 제외(`match_jd_evidence_dropped`) → V-4·met 규칙(기존 그대로)
5. requirement·rationale·missing_aspect: V-5 치환 + 별칭→라벨, requirement는 200자 자름
- 복원(`restoreMatches`): `jdTextHash`가 다르면 `InsightRequirementsChangedError`; 사라진 문장 제거(0개면 버림), 사라진 커리어 근거 제거 후 V-4·met 규칙 재적용.
- 2단계(`validateSynthesis`)는 v1과 같다. 키가 `M-n`으로 바뀌었을 뿐.
- AI-04: `requirement_ids`는 블록·선택 근거 모두 `[]` 고정. 나머지 V-* 그대로.

## 테스트·픽스처

- `pnpm vitest run src/server/ai` → **40 files, 1151 tests 통과**.
- `pnpm exec tsc --noEmit` → `src/server/ai` 안 오류 **0**. (밖의 오류는 §8 목록 — api-engineer 몫)
- `pnpm exec eslint src/server/ai` → 경고·오류 없음.
- 바꾼/새 테스트: `pipelines/AI-02.test.ts`(전면 재작성: 단일 호출, 문장 ref 검증, 20개 상한, 0개 결과, v2 payload·jd_sentence 근거 행, hashes, JD 변경 오류, M-n 산문 라벨), `context-pack/jd.test.ts`(원문 문장 블록·`jdTextHash`), `prompts/prompt-versions.test.ts`(R17 버전 표, REQ/gate/other_sids/seniority 부재), `pipelines/AI-04.test.ts`(`requirement_ids: []`), `context-pack/cover-letter-chat.test.ts`(문장 전체·`jdTextHash`), `pipelines/AI-12.test.ts`·`AI-13.test.ts`(버전), `structured.test.ts`(input_hash가 jd_text_hash에 반응), `validation/evidence.test.ts`·`storage/evidence-links.test.ts`(legacy REQ 별칭은 손으로 만든 항목으로).
- 픽스처: `__fixtures__/AI-02/insight.ts` — `KO_REQS`(모델이 읽어낼 요건 정의), `match(ctx, def, …)`, `koMatchOutput`(1개), `KO_JD_HASH`/`EN_JD_HASH`(합성 해시 문자열). 모두 가상 데이터.

## 스펙 차이·가정

- `[가정 R17-AI-1]` 1단계 요건 상한 `AI02_MAX_MATCHES = 20` (plan §3 "≤ 20 [가정]"). 초과분은 버리고 `matches_truncated`로 센다. zod는 40개까지 받는다(V-6 여유).
- `[가정 R17-AI-2]` 저장 요건 문구 `REQUIREMENT_CONTENT_MAX = 200`자(넘으면 199자+"…").
- `[가정 R17-AI-3]` 모델이 요건을 0개 냈거나 모두 검증에서 떨어져도 오류가 아니다 — 빈 `requirement_matches`로 2단계·저장까지 간다(`not_a_jd` 제거에 따름). 문장 0개 공고에서 인사이트를 시작할지는 서비스/DB 게이트(`begin_insight`) 결정.
- `[가정 R17-AI-4]` 1단계 match evidence에 모델이 `jd_sentence`를 넣으면 버린다(문장은 `sentence_refs`로만). 2단계 gaps의 `jd_sentence` 근거는 기존처럼 허용.
- `[가정 R17-AI-5]` `InsightRequirementsChangedError`의 이름·`code: "requirements_changed"`는 러너 호환을 위해 유지하고 의미만 "JD 원문 해시가 1단계와 다름"으로 바꿈.
- `[가정 R17-AI-6]` 공통 프롬프트를 `common.v5`로 올림(REQ-1 예시 삭제). plan에 명시되진 않았으나 프롬프트 문구가 바뀌면 버전을 올린다는 규칙에 따름 → AI-13도 저장 문자열이 바뀐다.
- `[가정 R17-10]`(plan) AI-04 `requirement_ids`는 항상 `[]`.
- `[가정 R17-4]`(plan) AI-12 `<gate_requirements>` 제거, 원문 대체 없음.
- AI-04 프롬프트의 job_competency 규칙 "중요 표시된 요건" → "공고에서 필수·우선으로 강조된 요건 문장"으로 문구만 바꿈(요건 목록이 없으므로).
