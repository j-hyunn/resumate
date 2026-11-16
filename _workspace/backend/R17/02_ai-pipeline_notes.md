# R17 AI 파이프라인 구현 노트 (ai-pipeline-engineer)

## 정렬 인터페이스 (2026-11-16)

기획 PR #77(decisions 3.29·4.24 #18~#21, AI v4.16 0.v416, DM v4.16 2.7.0·2.8·11.11)에 맞춘 **2차 계약**이다. 이 절이 아래 "인터페이스(1차)"보다 우선한다. 경로는 `src/server/ai/` 기준.

### A. AI-02 인사이트 — `pipelines/AI-02.ts`

단계·호출: `buildInsightContext`(매 단계) → `matchRequirements`(단계 1, `call_key` **`insight.match.1`**) → `synthesizeOnce`(**`insight.synthesize`**) → (V-5 위반 시) `regenerateSynthesis`(`insight.synthesize.regen`, 이름 그대로) → `finalizeInsight`(호출 없음). 진행 단계 값은 그대로 `prepare → match(0/1→1/1) → synthesize → synthesize_regen → validate`.

```ts
// 입력은 1차와 같다
export type InsightContextInput = {
  careerRows: CareerRows; asOf?: YearMonth;
  jobDescriptionId: string; jobDescriptionUpdatedAt: string | null;
  sentences: readonly JdSentence[];      // job_descriptions.sentences 전부
  positionTitle: string | null;
  rawTextHash: string;                   // job_descriptions.raw_text_hash
};
export type InsightContext = { …; careerSnapshotHash: string; rawTextHash: string; sentenceCount: number; … };   // jdTextHash → rawTextHash
export function buildInsightContext(input: InsightContextInput): InsightContext;

export function computeInsightInputHash(parts: { provider: ProviderId; model: string; careerSnapshotHash: string; rawTextHash: string }): string;

export type Ai02Deps = { llm: Llm; signal?: AbortSignal; logger?: AiLogger; jobId?: string | null;
  clock?: () => number };                // 지연 측정용 (기본 Date.now)

// ---- 단계 1 (JSON-safe → step output 그대로 저장) ----
export type StoredMatchItem = {
  match_key: string;                     // "MT-1" … (첫 sid 번호 오름차순)
  requirement_text: string;              // 1~120자
  sids: string[];                        // 1~5개, 이번 JD의 Sn
  status: "met" | "partial" | "no_evidence";
  model_status: "met" | "partial" | "no_evidence";
  rationale: string;
  missing_aspect: string | null;
  evidence: StoredEvidence[];            // 커리어 근거만(UUID 형태)
};
export type MatchStageResult = {
  v: 3;                                  // step output 판. 3이 아니면 옛 checkpoint → 처음부터
  promptVersion: string; model: string; usage: NormalizedUsage;
  attempts: number;                      // 공급자 호출 수(V-6 재시도·0개 재시도 포함)
  calls: number;                         // 논리 호출 수: 1, 0개라서 다시 부르면 2
  latencyMs: number;                     // ★ 단계 1 실측(벽시계, 재시도 포함) — 4.24 #18 기록용
  careerSnapshotHash: string; rawTextHash: string;
  items: StoredMatchItem[];              // ≥ 1 (0개면 던진다)
  report: Record<string, number>;
};
export function matchRequirements(input: { context: InsightContext }, deps: Ai02Deps): Promise<MatchStageResult>;
//  - 검증 뒤 0개 → 단계 1을 1회 더 부르고, 그래도 0개면 AiError("schema_invalid", retryable: false) (AI-02 "단계 1 서버 검증" 6)
//  - 로그: 기존 ai_call(callKey insight.match.1, latencyMs) + 새 이벤트 ai_stage_timing {jobId, feature "AI-02.match", callKey, promptVersion, latencyMs, calls, attempts}
//    → 서비스는 MatchStageResult.latencyMs를 step output으로 남기면 실측값이 DB(ai_jobs.step_outputs.match)에도 남는다

// ---- 단계 2 ----
export type SynthesisAttempt = { v: 3; kind: "first" | "regen"; promptVersion; model; usage; attempts;
  careerSnapshotHash: string; rawTextHash: string; output: Ai02SynthesisOutput; refs: Record<string, StoredRef>; violations: string[] };
export function synthesizeOnce(input: { context: InsightContext; match: MatchStageResult }, deps: Ai02Deps): Promise<SynthesisAttempt>;
export function regenerateSynthesis(input: { context: InsightContext; match: MatchStageResult; violations: readonly string[] }, deps: Ai02Deps): Promise<SynthesisAttempt>;

// ---- 마무리 (순수) ----
export function finalizeInsight(input: {
  context: InsightContext; match: MatchStageResult; first: SynthesisAttempt; regen: SynthesisAttempt | null;
  snapshot: { careerSnapshotHash: string; rawTextHash: string };   // prepare 시점 값
  provider: ProviderId; modelTier: ModelTier; connectionTier: ConnectionTier; now: Date; logger?: AiLogger; jobId?: string | null;
}): { payload: CompleteInsightPayload; summaryCounts: InsightSummaryCounts; report: Ai02ValidationReport; usage: NormalizedUsage; inputHash: string };

export class InsightRequirementsChangedError extends Error { readonly code = "requirements_changed" }
//  이름·code 유지. 단계 1의 rawTextHash ≠ 현재 컨텍스트 rawTextHash면 synthesize/finalize가 던진다.
```

**`CompleteInsightPayload`** (`storage/insight.ts`, `complete_insight(p_payload)`):

```ts
{
  result: {
    schema_version: 2, basis_note: string, data_sufficiency: { level: "ok" | "thin", hints: string[] },
    requirement_matches: Array<{ item_key: "requirement_matches.MT-1", match_key: "MT-1",
      requirement_text: string, sids: string[], status, rationale: string, missing_aspect: string | null }>,
    summary_counts: { met, partial, no_evidence },
    strengths: Array<{ item_key: "strengths.0", title, description, match_keys: string[] }>,
    gaps: Array<{ item_key: "gaps.0", match_keys, gap_kind: "partial" | "no_evidence", description,
      actions: Array<{ item_key: "gaps.0.actions.0", type: "add_data" | "reframe" | "prepare_answer", text }> }>,
    strategy: { positioning: string | null, positioning_item_key: "strategy.positioning",
      project_priorities: Array<{ item_key: "strategy.project_priorities.0", rank, project_id /* uuid */, reason, match_keys }> },
  },
  match_stage_result: { prompt_version: string /* ai-02.match.v6+common.v5 */,
    items: Array<{ match_key, requirement_text, sids, status, model_status, rationale, missing_aspect }> },
  hashes: { raw_text_hash: string, career_snapshot_hash: string, input_hash: string },     // jd_text_hash·requirements_hash 없음
  meta: { schema_version: 2, prompt_version /* ai-02.match.v6+ai-02.synthesize.v6+common.v5 */, provider, model, model_tier, connection_tier, validation_report, usage },
  evidence: EvidenceLinkInsert[],
}
```

- 없어진 키: `requirement_id`, `requirement_ids`, `requirement{content, category, importance, sentence_ids}`, `match_stage_result.schema_version`·`matches`, `hashes.jd_text_hash`.
- 근거 행: `requirement_matches.MT-n` = **커리어 근거만**(DM 2.8 — 요건 행의 "공고 원문" 링크는 근거 행이 아니라 `sids`로 강조). 1차의 "인용 문장마다 `jd_sentence` 1행"은 **삭제**. `jd_sentence` 행은 단계 2 항목(`strengths.n`·`gaps.n` 등)에 모델이 단 것만 남는다(`source_id` = `job_descriptions.id`, `source_locator {sid,start,end}`, `source_label` = 문장 앞 40자). `jd_requirement` 행은 없다.
- 재사용(서비스): `computeInsightInputHash`가 같아도 **latest `ready` + `schema_version = 2`** 행만 재사용한다. `input_hash` 식의 JD 키는 `raw_text_hash`(`INPUT_HASH_VERSION` 3, canonical 키 이름 `raw_text_hash`).

### B. AI-04 자소서 대화 컨텍스트 — `context-pack/cover-letter-chat.ts`

```ts
export type CoverLetterApplicationMeta = { companyName: string | null; positionTitle: string | null };  // job_descriptions.company_name·position_title (사용자 입력)
export type CoverLetterInsightInput = {
  insightId: string;
  schemaVersion: number;            // insights.schema_version — 2가 아니면 "없음"으로 다룬다
  result: unknown;                  // insights.result (schema 2 모양, 조립기가 관대하게 읽는다)
  careerSnapshotHash: string;       // insights.career_snapshot_hash
  rawTextHash: string;              // insights.raw_text_hash
  currentRawTextHash: string;       // job_descriptions.raw_text_hash (현재)
};
export type CoverLetterChatTurnInput = {
  …(그대로: messages, structuredDraft, lastExtractedSequence, questions, formSnapshot, careerRows, asOf, requestedSlot, requestedAction, requestedSlots, style, isFinalReply, now),
  application: CoverLetterApplicationMeta;      // 신설 (jd 대체)
  insight: CoverLetterInsightInput | null;      // 신설 (insightSignal 대체)
};
// CoverLetterChatContext 변경: jdText·jdTextHash·referenceText 삭제 →
//   applicationText: string | null;   // <application> 블록
//   insightText: string | null; insightId: string | null;
//   insightState: "ready" | "stale" | "none";
//   staleReasons: { career: boolean; rawText: boolean } | null;     // career = insight.career_snapshot_hash ≠ 이번 팩 해시, rawText = insight.raw_text_hash ≠ currentRawTextHash
```

- **서비스가 읽을 것**: 그 지원 건의 `insights where is_latest and status = 'ready' and schema_version = 2` 한 행(`id, result, career_snapshot_hash, raw_text_hash, schema_version`) + `job_descriptions.raw_text_hash, company_name, position_title`. **`job_descriptions.sentences`·`raw_text`는 읽지 않는다.** 행이 없으면 `insight: null`.
- 프롬프트 블록 순서(C-8): `<career_data>` → `<application>`(기업명·포지션명, 둘 다 없으면 생략) → `<insight>`(있을 때만, 캐시) → 문항·사실·대화. stale이면 `<insight>` 첫 줄에 "이전 공고·경력 기준일 수 있다". 없으면 블록 없이 reply/compose `<task>`에 "인사이트 없음 — 공고 요건을 추측하지 않는다" 한 줄.
- 근거 허용 목록: **커리어 5종 + `user_note`**(`AI04_EVIDENCE_SOURCE_TYPES`). `jd_sentence`·`jd_requirement` 근거는 V-1로 제거(별칭도 없고, 허용 목록 검사도 따로 한다).
- V-5 원천에 인사이트 `requirement_text`가 더해진다(다른 인사이트 문장은 아님). 스킬명·용어 가드 원천에는 넣지 않는다.
- 시작 인사의 인사이트 안내 줄은 DB 인사 함수(#14) 몫 — AI 쪽은 `insightState`·`staleReasons`만 준다.
- 삭제: `CoverLetterJdInput`, `CoverLetterInsightSignal`, `insightSignal`, `jd`, `<jd>`·`<reference>` 블록.

### C. AI-12 게이트 진입 — `context-pack/gate-gaps.ts`(신설) + `WritingChatTurnInput.gateGaps`

```ts
export type GateGap = { requirementTexts: string[]; gapKind: "partial" | "no_evidence"; description: string };
export const GATE_GAPS_MAX = 5;
/** insights.result(schema 2) → 게이트 보완점. key(gaps.{n})가 맞으면 그 하나, 없거나 못 찾으면 gaps[] 앞 5개. schema ≠ 2·모양 불일치 → []. */
export function selectGateGaps(input: { schemaVersion: number; result: unknown; insightItemKey?: string | null }): GateGap[];

// context-pack/writing-chat.ts
export type WritingChatTurnInput = { …; gate: {…} | null; gateGaps?: readonly GateGap[]; … };   // 응답 호출에만, gate가 있을 때만
```

- 서비스: `return_target.params.insight_id`가 있으면 그 인사이트(내 것·그 지원 건·`ready`), 없으면 `return_target.application_project_id`의 latest ready `schema_version = 2` 인사이트 → `selectGateGaps({schemaVersion, result, insightItemKey: return_target.params.insight_item_key})`. 없으면 `gateGaps` 생략(블록 없음). `job_descriptions`는 읽지 않는다.
- 프롬프트: 응답 호출만 `<gate_gaps>` 블록(요건 문구·판정·설명). 출처가 아니다 — extract·V-9는 보지 않는다(V-9d 통과 근거도 아님).

### D. 없어진 것 (이 판)

- AI-02: `StoredMatch`(→ `StoredMatchItem`), `MatchStageResult.matches`·`jdTextHash`, `RequirementCategory`·`RequirementImportance`·`REQUIREMENT_CATEGORIES`·`REQUIREMENT_IMPORTANCES`, `InsightRequirement`, 요건 원소의 `category`·`importance`, 요건 키 `M{n}`/`M-n`, 요건 행 `jd_sentence` 근거, `REQUIREMENT_CONTENT_MAX`(200, → `REQUIREMENT_TEXT_MAX` 120).
- `input-hash.ts`: `InputHashParts.jdTextHash` → **`rawTextHash`**.
- `context-pack/jd.ts`: `JdContext.jdTextHash` → **`rawTextHash`** (AI-02 전용 — AI-04는 더 이상 이 빌더를 부르지 않는다).
- `evidence-rules.ts`: 근거 출처 `jd_requirement`(`REQ-n`) — 4.24 #5에서 DB CHECK도 빠진다. `EvidenceSourceType`에서 제거.
- AI-04: 위 B의 삭제 목록. AI-12: 없음(신설만).


### E. 정렬 결과 (2026-11-16)

#### decisions 4.24 AI #18~#21

| # | 할 일 | 상태 | 구현 위치 |
|---|-------|------|-----------|
| 18 | AI-02 단계 1 한 호출, `requirement_text` ≤ 120·`sids` 1~5, 최대 15, `MT-n`/`match_key`/`match_keys`, `match_stage_result {prompt_version, items}`, `call_key` `insight.match.1`·`insight.synthesize`, 결과 `schema_version` 2, `hashes.raw_text_hash`, 단계 1 지연 실측 | **완료** (AI 쪽) | `schemas/AI-02.ts`, `prompts/AI-02`, `validation/insight.ts`(카드 "단계 1 서버 검증" 1~5), `pipelines/AI-02.ts`(6: 0개 → 1회 재호출 → `schema_invalid`, `latencyMs`·`ai_stage_timing`), `storage/insight.ts`, `input-hash.ts`. **재사용을 schema 2로 거르는 조회와 `latencyMs`를 step output으로 남기는 일은 서비스(api-engineer) 몫** |
| 19 | AI-04 원문 블록 삭제 → 최신 ready 인사이트(schema 2) 블록(팩 뒤 캐시) + 지원 건 메타 + 문항·메모, 없으면 커리어만 + 안내 줄, stale이어도 사용 + 안내 줄, `jd_sentence` 근거 거부 / AI-12 게이트 = 보완점 항목 / 프롬프트 0.v416 표 | **완료** (AI 쪽) | `context-pack/cover-letter-chat.ts`·`insight-result.ts`, `prompts/AI-04`, `validation/evidence.ts`(`allowedSourceTypes`), `context-pack/gate-gaps.ts`, `context-pack/writing-chat.ts`(`gateGaps`), `prompts/AI-12`(`<gate_gaps>`). **인사이트 행·`return_target` 키를 읽어 넘기는 일은 서비스 몫**, 시작 인사의 안내 줄은 DB 인사 함수(4.24 #14) |
| 20 | 자동 시작도 사용량 기록, 무료 등급 순차 그대로 | 해당 없음(AI 쪽) | 파이프라인은 수동·자동을 구분하지 않는다. 사용량은 러너의 `onCall` 그대로 — api-engineer |
| 21 | 평가 세트에서 AI-01 항목 삭제 | **완료 — 할 일 없음** | `src/server/ai`에 AI-01 평가 항목·픽스처가 없다(1차에서 `__fixtures__/AI-01` 삭제, 평가 세트 골격은 `__fixtures__/AI-13/eval-set.ts` 하나) |

#### 프롬프트 버전 (AI v4.16 0.v416 표 그대로)

| 호출 | prompt_version |
|------|----------------|
| 공통 | `common.v5` |
| AI-02 판정 / 종합 / 저장값 | `ai-02.match.v6+common.v5` / `ai-02.synthesize.v6+common.v5` / `ai-02.match.v6+ai-02.synthesize.v6+common.v5` |
| AI-04 초안 / 보정 / 정리 / 응답 | `ai-04.generate.v7` / `ai-04.adjust.v7` / `ai-04.extract.v2` / `ai-04.reply.v2` (+`common.v5`) |
| AI-12 정리 / 응답 | `ai-12.extract.v7` / `ai-12.reply.v8` (+`common.v5`) — 1차의 extract v8은 되돌림 |
| AI-13 | 호출 번호 그대로, 접미사 `common.v5` |

- 스키마 버전: `AI02_OUTPUT_SCHEMA_VERSION` 2(단계 1 출력·결과·meta), `AI04_OUTPUT_SCHEMA_VERSION` 5(그대로). step output 판 `MatchStageResult.v`·`SynthesisAttempt.v` = **3**. `INPUT_HASH_VERSION` 3(키 이름만 `raw_text_hash`).
- 1차 R17 판(같은 번호, 다른 문구)은 원격·운영에 나간 적이 없어 번호를 더 올리지 않았다 → 저장된 `prompt_version`이 같은 다른 문구는 없다.

#### 가정 (R17b)

- `[가정 R17b-AI-1]` 단계 1 `sids`는 서버가 S 번호 오름차순으로 정렬해 저장하고, "첫 `sid`" = 가장 작은 번호로 원소를 정렬한다(카드 5 "첫 sid 번호 오름차순"). 6개 이상이면 **모델이 준 순서의 앞 5개**를 남긴 뒤 정렬한다.
- `[가정 R17b-AI-2]` 중복 판정(카드 3)은 공백 정리·별칭 라벨 치환·소문자화한 `requirement_text` + 정렬된 `sids`가 모두 같을 때. V-5 치환으로 문구가 첫 문장으로 바뀐 원소도 이 판정을 다시 받는다(바뀐 결과가 같으면 뒤의 것을 버림).
- `[가정 R17b-AI-3]` 카드 6 "단계 1을 1회 재시도"는 파이프라인 안의 **두 번째 논리 호출**(같은 `call_key` `insight.match.1`, V-6 재시도와 별개)로 구현했다. 두 호출의 사용량을 합쳐 `MatchStageResult.usage`/`attempts`에 넣고, 러너의 사용량 기록은 호출마다 1행이다. 재시도 결과도 0개면 `AiError("schema_invalid", retryable: false)`.
- `[가정 R17b-AI-4]` AI-12 정리(extract) 프롬프트는 0.v416 표대로 **v7 유지**. 공유 규칙의 데이터 블록 목록에서 `<gate_requirements>` 자리가 `<gate_gaps>`로 바뀌었으나(정리 호출은 이 블록을 받지 않는다) 표가 "변경 없음"으로 정했으므로 번호를 올리지 않았다. 재사용 해시가 없는 기능이라 영향 없음.
- `[가정 R17b-AI-5]` V-5 재생성 호출의 `call_key`는 `insight.synthesize.regen` 그대로(DM 2.7.0은 `insight.synthesize`(·`synthesize_regen`)로만 적었다).
- `[가정 R17b-AI-6]` AI-04 `<insight>` 블록에는 키(`MT-n`)·문장 번호·판정 이유·근거를 넣지 않고, 어필 프로젝트는 팩에 있는 프로젝트만 `PRJ-n '이름'`으로 적는다(팩에 없는 `project_id`는 생략). 상한: 요건 15·강점 3·보완점 8·우선순위 5. 비어 있는 인사이트(목록이 모두 비었음)는 "없음"으로 다룬다.
- `[가정 R17b-AI-7]` "인사이트 없음" 안내는 모델 지시 한 줄(reply·compose `<task>`)로 넣었다 — 사용자에게 보이는 안내는 시작 인사(DB) 몫이라 매 턴 응답에서 되풀이하지 않게. stale 안내는 `<insight>` 블록 첫 줄.
- `[가정 R17b-AI-8]` 요건 행(`requirement_matches.MT-n`)의 근거 행은 커리어 근거만 만든다(DM 2.8 "요건 행의 공고 원문 링크는 근거 행이 아니라 `sids`"). 1차의 문장별 `jd_sentence` 행은 없앴다 → `private.insight_payload_valid`가 요건 항목에 `jd_sentence` 행을 요구하지 않아야 한다(db-engineer 확인 필요).
- `[가정 R17b-AI-9]` `evidence-rules.ts`에서 `jd_requirement`를 지웠다(4.24 #5로 DB CHECK에서도 빠짐). 모델이 그 값을 내면 V-6(스키마 불일치)로 잡힌다. `src/types/db.ts`(생성 타입)는 db-engineer가 다시 만든다.
- 1차 가정 `[가정 R17-AI-1]`(≤ 20)·`[R17-AI-2]`(200자)·`[R17-AI-3]`(0개 허용)·`[R17-AI-6]`(common.v5 판단)은 기획 확정값(15·120·재시도 후 실패·0.v416 표)으로 **대체**됐다. `[R17-AI-4]`(단계 1 JD 근거 버림)·`[R17-AI-5]`(오류 이름 유지)는 그대로.

#### 테스트

- `pnpm exec vitest run src/server/ai` → **41 files, 1175 tests 통과**.
- `pnpm exec tsc --noEmit` → `src/server/ai` 안 오류 **0**. 밖의 오류 10줄(`services/insight/pipeline.ts` 4, `services/insight/insight.integration.test.ts` 2, `jobs/insight.ts` 1, `services/writing-chat/pipelines.ts` 3)은 위 A·B·C 계약에 맞출 api-engineer 몫.
- `pnpm exec eslint src/server/ai` → 경고·오류 없음.
- 새/바꾼 테스트: `pipelines/AI-02.test.ts`(카드 1~6 각 분기, `insight.match.1`, 지연 측정·`ai_stage_timing`, v2 payload 키·없어진 키, 요건 행 근거, `raw_text_hash`), `context-pack/cover-letter-chat.test.ts`(`<application>`·`<insight>` 블록, none/stale/schema 1, V-5 원천, 허용 목록), `pipelines/AI-04.test.ts`(`jd_sentence` 근거 거부, `<insight>` 위치, 없음 안내 줄), `pipelines/AI-12.gate.test.ts`(신설: `selectGateGaps`·`<gate_gaps>`·출처 아님), `validation/evidence.test.ts`(`allowedSourceTypes`), `prompts/prompt-versions.test.ts`(0.v416 표·문구 검사).
- 픽스처: `__fixtures__/AI-02/insight.ts`(`ReqDef {content, needle}`, `MT-n`), `__fixtures__/S7/cover-letter-chat.ts`(`insightResultV2()`·`insightInput()`·`application` 기본값, `jdParts` 삭제). 모두 가상 데이터.

- **QA-08 (2026-11-16, 정렬 라운드 1)**: `pipelines/AI-02.readers.test.ts` 신설 — 실제 저장 경로(`finalizeInsight` → `toCompleteInsightPayload`)의 `result`를 JSON 왕복해 `readInsightResultV2`·AI-04 `<insight>` 블록(`지원 방향:` 포함)·AI-12 `selectGateGaps`에 넣어, 쓰는 쪽과 읽는 쪽의 키 모양이 어긋나면 실패하게 했다. `vitest run src/server/ai` → 42 files, 1178 tests 통과, tsc(`src/server/ai`) 0, eslint 깨끗.

---

## (기록) 1차 R17 노트 — 2026-11-14, 위 정렬 인터페이스로 대체된 부분이 있다


### 인터페이스 (1차 — 위 정렬 인터페이스가 우선)

모든 경로는 `src/server/ai/` 기준. 바뀌지 않은 export(`splitJdSentences`, `JdSentence`, `AliasMap`, `Llm` 등)는 생략.

#### 1. JD 컨텍스트 — `context-pack/jd.ts`

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

#### 2. 입력 해시 — `input-hash.ts`

```ts
export type InputHashParts = { feature; promptVersion; provider; model; careerSnapshotHash: string | null; jdTextHash: string | null; params? };
export const INPUT_HASH_VERSION = 3;   // canonical 키도 requirements_hash → jd_text_hash
```

#### 3. AI-02 인사이트 v2 — `pipelines/AI-02.ts`

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

#### 4. `complete_insight(p_payload)` — `storage/insight.ts` (`CompleteInsightPayload`)

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

#### 5. 자소서 작성 대화(AI-04) 컨텍스트 — `context-pack/cover-letter-chat.ts`

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

#### 6. AI-12 (프로젝트 AI 작성 대화) — `context-pack/writing-chat.ts`

- `WritingChatTurnInput.gateRequirements` 필드 삭제. `context-pack/gate-requirements.ts`(`selectGateRequirements`, `GateRequirement`, `GateRequirementRow`) 파일 삭제 → `services/writing-chat/pipelines.ts`의 `loadGateRequirements` 삭제.
- `prompts/AI-12`의 `renderGateRequirements` 삭제, reply 블록에 `<gate_requirements>` 없음.

#### 7. 오류 코드 — `errors.ts`

- `not_a_jd` 메시지·상태 항목 삭제. `AI_ERROR_MESSAGES`/`AI_ERROR_STATUS` 타입은 `Record<Exclude<AiErrorCode, "not_a_jd">, …>` 로 두었다 — `lib/contracts/errors.ts`에서 `not_a_jd`를 지운 뒤에도 그대로 컴파일된다(그 뒤 `Exclude`는 정리해도 됨). 계약에 남아 있는 동안 `new AiError("not_a_jd")`는 일반 메시지(`stalled` 문구)로 떨어진다.

#### 8. api-engineer가 고칠 곳 (src/server/ai 밖, 컴파일 깨짐 목록)

- `services/insight/pipeline.ts`: `batchSize`·`requirementIds`·`match(batchIndex…)` 제거 → `match({context})` 1회, `synthesize/regenerate/finalize`에 `match` 전달, `hashes` = `{careerSnapshotHash, jdTextHash}`, `inputHash({…, jdTextHash})`.
- `services/insight/job.ts`·`job.test.ts`·`partial.ts`: `InsightBatch`/`MatchOutput<B>{batches}` → 단일 `MatchStageResult`; `PrepareOutput.requirements` 삭제, `snapshot.jdTextHash`; `not_a_jd`(요건 0개) 분기 삭제 → 문장 0개 처리 결정([가정 R17-AI-3]).
- `services/insight/db.ts`: `loadInsightInputs`가 `raw_text_hash`·`sentences`·`position_title`만 읽게(요건·`extraction.seniority` 불필요).
- `services/insight/insight.integration.test.ts`: `Ai02MatchOutput` 모양 v2(`requirement`, `category`, `importance`, `sentence_refs`), `schema_version: 2`.
- `services/writing-chat/pipelines.ts`: `gate-requirements` import·`loadGateRequirements` 삭제, `CoverLetterJdInput`을 `{…, rawTextHash}`로, `no_requirements` 알림 분기 삭제.
- `jobs/jd-extraction.ts`, `jobs/jd-preview.ts`, `test/jd-extraction-fakes.ts`, `services/application/preview*`, `document-chat.integration.test.ts`: `pipelines/AI-01` import → 파일 삭제 또는 해당 부분 삭제.

---

### 1차 본문

#### 삭제한 것

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

#### 기능별 모델 등급·prompt_version

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

#### 출력 스키마 ↔ 저장 매핑 (AI-02 v2)

- 모델 1단계: `matches[] = {requirement, category, importance, sentence_refs[S-n], status, rationale, missing_aspect, evidence[]}`.
- 서버: 남은 순서대로 `M1…Mn`(모델 쪽 별칭 `M-n`). 2단계 `requirement_refs: ["M-3"]` → 저장 `requirement_ids: ["M3"]`.
- 결과 `requirement_matches[].requirement = {content, category, importance, sentence_ids}`; 근거 행 = 커리어 근거 + 인용 문장마다 `jd_sentence`(quote = 문장, locator). 자세한 모양은 인터페이스 §4.
- 산문 가드: 2단계 산문의 `M-n`은 요건 문구(`'…'`, 40자)로 바꾸고, 모르는 `M-n`·`REQ-n`은 지운다.

#### 검증 규칙 적용 범위 (AI-02 1단계 v2, `validation/insight.ts` `validateMatchStage`)

1. `requirement` 공백 → 버림 (`matches_dropped_empty`)
2. `sentence_refs`: 이 JD의 S-n만(V-1), 중복 제거 (`sentence_refs_dropped`); 0개면 그 항목 버림 (`matches_dropped_no_sentence`)
3. 앞에서부터 `AI02_MAX_MATCHES`(20)개 (`matches_truncated`)
4. evidence V-1/V-2/V-3/V-8 → JD 근거는 match evidence에서 제외(`match_jd_evidence_dropped`) → V-4·met 규칙(기존 그대로)
5. requirement·rationale·missing_aspect: V-5 치환 + 별칭→라벨, requirement는 200자 자름
- 복원(`restoreMatches`): `jdTextHash`가 다르면 `InsightRequirementsChangedError`; 사라진 문장 제거(0개면 버림), 사라진 커리어 근거 제거 후 V-4·met 규칙 재적용.
- 2단계(`validateSynthesis`)는 v1과 같다. 키가 `M-n`으로 바뀌었을 뿐.
- AI-04: `requirement_ids`는 블록·선택 근거 모두 `[]` 고정. 나머지 V-* 그대로.

#### 테스트·픽스처

- `pnpm vitest run src/server/ai` → **40 files, 1151 tests 통과**.
- `pnpm exec tsc --noEmit` → `src/server/ai` 안 오류 **0**. (밖의 오류는 §8 목록 — api-engineer 몫)
- `pnpm exec eslint src/server/ai` → 경고·오류 없음.
- 바꾼/새 테스트: `pipelines/AI-02.test.ts`(전면 재작성: 단일 호출, 문장 ref 검증, 20개 상한, 0개 결과, v2 payload·jd_sentence 근거 행, hashes, JD 변경 오류, M-n 산문 라벨), `context-pack/jd.test.ts`(원문 문장 블록·`jdTextHash`), `prompts/prompt-versions.test.ts`(R17 버전 표, REQ/gate/other_sids/seniority 부재), `pipelines/AI-04.test.ts`(`requirement_ids: []`), `context-pack/cover-letter-chat.test.ts`(문장 전체·`jdTextHash`), `pipelines/AI-12.test.ts`·`AI-13.test.ts`(버전), `structured.test.ts`(input_hash가 jd_text_hash에 반응), `validation/evidence.test.ts`·`storage/evidence-links.test.ts`(legacy REQ 별칭은 손으로 만든 항목으로).
- 픽스처: `__fixtures__/AI-02/insight.ts` — `KO_REQS`(모델이 읽어낼 요건 정의), `match(ctx, def, …)`, `koMatchOutput`(1개), `KO_JD_HASH`/`EN_JD_HASH`(합성 해시 문자열). 모두 가상 데이터.

#### 스펙 차이·가정

- `[가정 R17-AI-1]` 1단계 요건 상한 `AI02_MAX_MATCHES = 20` (plan §3 "≤ 20 [가정]"). 초과분은 버리고 `matches_truncated`로 센다. zod는 40개까지 받는다(V-6 여유).
- `[가정 R17-AI-2]` 저장 요건 문구 `REQUIREMENT_CONTENT_MAX = 200`자(넘으면 199자+"…").
- `[가정 R17-AI-3]` 모델이 요건을 0개 냈거나 모두 검증에서 떨어져도 오류가 아니다 — 빈 `requirement_matches`로 2단계·저장까지 간다(`not_a_jd` 제거에 따름). 문장 0개 공고에서 인사이트를 시작할지는 서비스/DB 게이트(`begin_insight`) 결정.
- `[가정 R17-AI-4]` 1단계 match evidence에 모델이 `jd_sentence`를 넣으면 버린다(문장은 `sentence_refs`로만). 2단계 gaps의 `jd_sentence` 근거는 기존처럼 허용.
- `[가정 R17-AI-5]` `InsightRequirementsChangedError`의 이름·`code: "requirements_changed"`는 러너 호환을 위해 유지하고 의미만 "JD 원문 해시가 1단계와 다름"으로 바꿈.
- `[가정 R17-AI-6]` 공통 프롬프트를 `common.v5`로 올림(REQ-1 예시 삭제). plan에 명시되진 않았으나 프롬프트 문구가 바뀌면 버전을 올린다는 규칙에 따름 → AI-13도 저장 문자열이 바뀐다.
- `[가정 R17-10]`(plan) AI-04 `requirement_ids`는 항상 `[]`.
- `[가정 R17-4]`(plan) AI-12 `<gate_requirements>` 제거, 원문 대체 없음.
- AI-04 프롬프트의 job_competency 규칙 "중요 표시된 요건" → "공고에서 필수·우선으로 강조된 요건 문장"으로 문구만 바꿈(요건 목록이 없으므로).
