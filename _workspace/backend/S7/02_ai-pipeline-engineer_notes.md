# S7 AI 파이프라인 구현 노트 (ai-pipeline-engineer)

> 상태: 구현 완료. typecheck(src/server/ai 오류 0 — 전체에는 api 쪽 `services/drafts/drafts.test.ts` 오류가 남아 있음), lint(src/server/ai) 0건, vitest src/server/ai 36파일 653개 통과.

## api-engineer용 시그니처 (먼저 확정)

공통
- 파이프라인은 DB·요청·`after()`를 모른다. 행을 받아 컨텍스트를 만들고, 스트리밍 기능은 `AsyncGenerator<S7StreamEvent>`를 돌려준다.
- 저장은 api가 넘기는 `persist` 콜백으로 한다. 파이프라인은 검증이 끝난 **complete_* p_payload**를 만들어 `persist(payload)`를 부르고, 성공하면 `validated` → `done(resultId)`을 낸다. `persist`가 던지면 `error(internal_error)` 하나로 끝난다(`validated` 없음).
- 공급자·등급·연결 등급은 `deps.llm`의 값(`llm.provider`, `llm.tier`, `llm.connectionTier`)을 메타에 쓴다.
- 클라이언트 연결이 끊겨도 api는 제너레이터를 끝까지 소비해야 저장된다(S4 방식).

### AI-11 기본 선택 (동기) — `src/server/ai/pipelines/AI-11.ts`

```ts
export const AI11_TIER = "light";
export const AI11_JOB_TYPE = "draft_source_ranking";
export const AI11_PROMPT_VERSION = "ai-11.rank.v1+common.v1";
export const AI11_MAX_INCLUDED = 8;

export function buildRankingContext(input: {
  careerRows: CareerRows;
  asOf?: YearMonth;
  jobDescriptionId: string;
  requirements: readonly JdRequirementInput[];
}): RankingContext;  // { packText, jdText, aliases, careerSnapshotHash, requirementsHash, projectIdsInPackOrder }

export async function rankDraftSources(
  input: { context: RankingContext },
  deps: { llm: Llm; signal?: AbortSignal; logger?: AiLogger; jobId?: string | null; callKey?: string /* 기본 "draft_source_ranking.rank" */ },
): Promise<DraftSourceRankingResult>;

export type DraftSourceSelection = {
  includedProjectIds: string[];      // ≤ 8, 관련도 순
  projectOrder: string[];            // 팩의 모든 프로젝트: 포함(관련도 순) → 미포함(관련도 순) → 순위에 없는 것(팩 순)
  includedExperienceIds: string[];   // 포함 프로젝트의 소속 경력 (팩 순)
  includedEducationIds: string[];    // 포함 프로젝트의 소속 교육 (팩 순)
};
export type DraftSourceRankingResult = DraftSourceSelection & {
  ranking: RankingItem[];            // { project_id, relevance, include, requirement_ids, reason } — drafts.options.ranking 복사본
  output: DraftSourceRankingOutput;  // ai_jobs.output 에 그대로 저장
  report: Record<string, number>;
  promptVersion: string; model: string; usage: NormalizedUsage; attempts: number;
};

// ai_jobs.output 재사용 경로 (같은 input_hash의 성공 작업)
export const DraftSourceRankingOutputSchema: z.ZodType<DraftSourceRankingOutput>;
export function selectionFromRankingOutput(output: DraftSourceRankingOutput, careerRows: CareerRows, asOf?): DraftSourceSelection & { ranking: RankingItem[] };
// → 지금 팩에 없는 프로젝트(삭제·draft 전환)는 빠진다.

// 인사이트 경로·대체 경로 (호출 없음, 순수 함수)
export function selectionFromInsightPriorities(priorities: readonly { project_id: string; rank: number }[], careerRows, asOf?): DraftSourceSelection;
export function fallbackSelection(careerRows, asOf?): DraftSourceSelection;  // "최신 경력순 전체 선택": 팩 순서, 최대 8개

export function computeDraftSourceRankingInputHash(parts: { provider; model; careerSnapshotHash; requirementsHash }): string;
```

- 유효한 프로젝트 순위가 0개면 V-6과 같은 1회 재시도 후 `AiError("schema_invalid", retryable:false)` → api는 대체 경로(`fallback: true`).

### AI-03 경력기술서 (스트리밍) — `src/server/ai/pipelines/AI-03.ts`

```ts
export const AI03_TIER = "default";
export const AI03_JOB_TYPE = "career_description";
export const AI03_PROMPT_VERSION = "ai-03.generate.v1+common.v1";

export type CareerDescriptionOptionsInput = {
  included_experience_ids: string[]; included_education_ids: string[]; included_project_ids: string[];
  project_order: string[]; selection_origin: "insight" | "ai_ranking" | "user";
  ranking: RankingItem[] | null; tone: "concise" | "detailed" | null;
};

// 1) 계획 (호출 없음): 옵션 정규화 + begin_career_description p_sections
export function planCareerDescription(input: { careerRows: CareerRows; asOf?: YearMonth; options: CareerDescriptionOptionsInput }): CareerDescriptionPlan;
// CareerDescriptionPlan = {
//   (계획·컨텍스트 빌더가 섹션 id와 맞지 않는 입력·빈 계획이면 streamCareerDescription이 동기적으로 Error)
//   options: CareerDescriptionOptionsInput  (drafts.options로 저장할 정규화본: 팩에 없는 id 제거, 포함 프로젝트의 소속 경력·교육 자동 추가,
//                                            프로젝트 8개 초과분 제거(project_order 우선), project_order 정리)
//   sections: Array<{ sort_order: number; section_kind: "experience"|"education"|"standalone_projects";
//                     experience_id: string|null; education_id: string|null; heading: string; project_ids: string[] }>,
//   truncatedProjectIds: string[]
// }
// 포함 경력·프로젝트가 하나도 없으면 sections가 비고 api는 422(선택 없음)로 막는다.

// 2) 컨텍스트 (호출 없음)
export function buildCareerDescriptionContext(input: {
  careerRows: CareerRows; asOf?: YearMonth; plan: CareerDescriptionPlan;
  jobDescriptionId: string; requirements: readonly JdRequirementInput[];
  insightSignal?: { positioning: string | null; projectPriorities: { project_id: string; rank: number; reason: string }[];
                    requirementStatuses: { requirement_id: string; status: "met"|"partial"|"no_evidence" }[] } | null;
}): CareerDescriptionContext;   // careerSnapshotHash(전체 팩 기준), requirementsHash 포함

// 3) 스트림
export function streamCareerDescription(
  input: { context: CareerDescriptionContext; sections: ReadonlyArray<{ section_id: string; sort_order: number }> /* begin_career_description 반환값 그대로 (필수) */ },
  deps: { llm: Llm; persist: (payload: CompleteCareerDescriptionPayload) => Promise<{ resultId: string | null }>;
          signal?: AbortSignal; logger?: AiLogger; jobId?: string | null; now?: () => Date; callKey?: string /* "career_description.generate" */ },
): AsyncGenerator<S7StreamEvent>;

export function computeCareerDescriptionInputHash(parts: { provider; model; careerSnapshotHash; requirementsHash; options: CareerDescriptionOptionsInput }): string;
```

### AI-04 자기소개서 문항 (스트리밍) — `src/server/ai/pipelines/AI-04.ts`

```ts
export const AI04_TIER = "default";
export const AI04_JOB_TYPE = "cover_letter";
export const AI04_PROMPT_VERSION = "ai-04.generate.v1+common.v1";
export const AI04_ADJUST_PROMPT_VERSION = "ai-04.adjust.v1+common.v1";

export function buildCoverLetterContext(input: {
  careerRows: CareerRows; asOf?: YearMonth;
  jobDescriptionId: string; jobDescriptionUpdatedAt: string | null;
  sentences: readonly JdSentence[]; companySids: readonly string[] /* extraction.other_sids */;
  requirements: readonly JdRequirementInput[]; positionTitle: string | null;
  question: { section_id: string; question_text: string; template_key: "motivation"|"job_competency"|"future_plan"|null;
              char_limit: number | null; count_basis: "with_spaces"|"without_spaces"; user_note: string | null;
              user_note_updated_at?: string | null };
  mode: "ai" | "user";
  userSources?: Array<{ experience_id: string|null; education_id: string|null; project_id: string|null;
                        project_detail_ids: string[]; role: "primary"|"supporting" }>;   // mode "user"일 때, sort_order 순
  otherSections?: Array<{ question_text: string; primary_project_ids: string[] }>;
  insightSignal?: { strengths: { title: string; description: string }[]; positioning: string | null } | null;
}): CoverLetterContext;

export function streamCoverLetterSection(
  input: { context: CoverLetterContext },
  deps: { llm; persist: (payload: CompleteCoverLetterSectionPayload) => Promise<{ resultId: string | null }>;
          signal?; logger?; jobId?; now?; callKey?: string /* "cover_letter.generate" */; adjustCallKey?: string /* "cover_letter.adjust" */ },
): AsyncGenerator<S7StreamEvent>;

// 보정 호출만 따로 (스트림 안에서 자동으로 부르므로 api가 직접 부를 일은 없음)
export async function adjustCoverLetterLength(input: { context; paragraphs; charCount; unsupportedNumbers: string[] }, deps): Promise<...>;
export function countChars(text: string, basis: "with_spaces" | "without_spaces"): number;
export function computeCoverLetterInputHash(parts: { provider; model; careerSnapshotHash; requirementsHash;
  question: { question_text; template_key; char_limit; count_basis; user_note }; mode; userSources }): string;
```

## 스트림 이벤트 (`src/server/ai/streaming/events.ts` — `AiStreamEvent`에 2개 추가, 별칭 `S7StreamEvent`)

- `AI_STREAM_EVENT_TYPES`에 `sources_selected`, `adjusting_length`를 더했다. `src/lib/contracts/ai.ts`(api 소유) 미러에도 추가 필요.

```ts
| { type: "sources_selected"; selectionMode: "ai" | "user"; questionClass: QuestionClass | null;
    sources: Array<{ sort_order: number; role: "primary"|"supporting";
                     experience_id: string|null; education_id: string|null; project_id: string|null; project_detail_ids: string[];
                     label: string /* "회사명 › 프로젝트명" */; rationale: string; reuse_reason: string|null; requirement_ids: string[] }> }
| { type: "adjusting_length"; charCount: number; charLimit: number; countBasis: "with_spaces"|"without_spaces";
    reasons: Array<"length" | "numbers"> }
```

- AI-03 순서: `block_started`/`block_delta`/`block_completed`(반복) → `validated` → `done` | `error`.
- AI-04 순서: `sources_selected`(모델의 `sources` 배열이 닫히는 순간, 검증 후 1회) → 문단 블록 이벤트 → (보정 시) `adjusting_length` → `validated` → `done` | `error`.
  - **`validated`는 최종본 1번만** 낸다(보정 후). 계획의 "validated → adjusting_length" 순서와 다르다(spec-gaps 기록). `validated`가 저장된 내용과 같아야 하고, 그 뒤에 오류가 올 수 없어야 하기 때문(QA-S3-02 규칙).
- `block_completed.block` (두 기능 공통):
  `{ block_id, block_kind, project_id, text, requirement_ids, placeholders, flags, evidence: EvidenceChip[] }`
  - `EvidenceChip = { source_type, source_id, source_field, quote, quote_adjusted, source_label, source_locator }` (근거 칩용, UUID)
  - `flags`는 이 시점엔 근거 플래그(`evidence_check_needed`)·스킬명 플래그만. 수치(`number_check_needed`)는 `validated`에서 확정.
  - V-7 범위 밖 / 사용자 모드 목록 밖 근거는 여기서 이미 빠진다.
- `validated.result`: 화면용 최종본 (근거 배열 없는 저장 형태 + 근거 칩 평면 목록)
  - AI-03: `{ kind: "career_description", sections: [{ section_id, sort_order, section_kind, experience_id, education_id, heading, blocks: Block[] }], omitted, notes_for_user, evidence: Array<EvidenceChip & { item_key }> }`
  - AI-04: `{ kind: "cover_letter_section", section_id, char_limit, count_basis, question_class, selection_mode, sources: (sources_selected와 같은 모양), blocks: Block[], ai_char_count, char_adjust_needed, correction_applied, notes_for_user, evidence: Array<EvidenceChip & { item_key }> }`
- `done.meta.resultId` = `persist`가 돌려준 값.
- `error`: 기존과 같음(C-11 코드, `retryable`은 첫 토큰 전만 true, 스키마 불일치 `schema_invalid` retryable true → 화면 "전체 재시도").

## 던지는 오류 / 오류 이벤트

| 상황 | AI-11 (throw) | AI-03·AI-04 (error 이벤트) |
|------|---------------|-----------------------------|
| 공급자 오류 | `ProviderError` 그대로 | `error` (`retryable` = 첫 토큰 전 + 코드 정책) |
| 스키마 불일치 | 1회 재시도 후 `AiError("schema_invalid", retryable:false)` | 스트림 끝에 `error(schema_invalid, retryable:true)` — 재시도 없음(전체 재시도는 화면) |
| 유효 순위 0개 | `schema_invalid` (위와 같음) | — |
| AI-04 보정 호출 실패 | — | 오류로 끝내지 않는다: 보정 전 초안을 저장, `char_adjust_needed = true`, 보고서 `length_adjust_failed = 1` |
| `persist` 실패 | — | `error(internal_error, retryable:true)` |
| 입력 오류(계획에 없는 섹션 등) | 일반 `Error` | 일반 `Error`(제너레이터 시작 전 동기 검사) |

## 호출 키·진행 단계
- AI-11: `draft_source_ranking.rank` / 단계 `rank`
- AI-03: `career_description.generate` / 단계 `generate` → `validate`
- AI-04: `cover_letter.generate`, 보정 `cover_letter.adjust` / 단계 `generate` → (`adjust_length`) → `validate`

## complete_* p_payload (db 노트 모양 그대로 + 최상위 키 2개)

타입: `src/server/ai/storage/drafts.ts` (`CompleteCareerDescriptionPayload`, `CompleteCoverLetterSectionPayload`). 파이프라인이 만들어 `persist`로 넘긴다(api는 그대로 RPC에 전달).

- 경력기술서: `{ sections:[{section_id, blocks, validation_report}], hashes:{input_hash, career_snapshot_hash}, meta, evidence:[{section_id, item_key=block_id, …}], omitted, notes_for_user }`
  - 섹션 순서 = 계획 순서, 모든 섹션 1번씩. 블록: 섹션 머리글(`h<n>`, `generated_by:"server"`, `header` 구조값) → 요약 → (프로젝트마다) 프로젝트 머리글 → 역할 줄 → 불릿 ≤ 4.
  - 근거는 커리어 7종만, `learnings` 없음. 블록 id는 초안 안에서 유일.
- 자소서 문항: `{ question_class, blocks(paragraph, 1~12), ai_char_count, correction_applied, sources(≤ 5, rationale ≤ 300), hashes, meta, evidence(item_key = 블록 id 또는 sources.{n}), char_adjust_needed, notes_for_user }`
  - `user_note` 근거: `source_id` = 문항 id, `source_field` null. `job_competency`에는 `learnings` 근거가 없다.
- `omitted`·`notes_for_user`·`char_adjust_needed`는 db 목록에 없는 최상위 키(RPC가 무시). spec-gaps S7 (ai) ⑤.
- `meta.prompt_version`: AI-03 `ai-03.generate.v1+common.v1`, AI-04 `ai-04.generate.v1+common.v1`(보정했으면 `ai-04.generate.v1+ai-04.adjust.v1+common.v1`). `meta.usage`는 생성 + 보정 호출 합계.

## 만든 것

| 파일 | 내용 |
|------|------|
| `schemas/AI-11.ts`, `AI-03.ts`, `AI-04.ts`, `drafts-common.ts` | 카드 출력 스키마(정본 형식, AI-04 문단 1개 이상), AI-04 보정 스키마 |
| `prompts/AI-11`, `AI-03`, `AI-04`, `drafts-common.ts` | system(공통 → 기능), 데이터 블록, few-shot(가상), 별칭 규칙, tone 화이트리스트 |
| `context-pack/summary-pack.ts` | AI-11 요약 팩(전체 팩 별칭·해시 재사용, 회고 제외, 행동 앞 200자) |
| `context-pack/selection.ts` | 선택 파생(소속 경력·교육), 대체 선택, 인사이트 우선순위 선택, 선택 행 필터, 출처 표시명 |
| `validation/drafts.ts` | 스킬명 가드, 상황·과제뿐 판정, AI-04 V-7 범위, 글자 수 세기·범위·목표 |
| `validation/draft-blocks.ts` | 초안 블록 검사(잠정/최종), 근거 칩, 블록 id 배정, 문장 정리 |
| `storage/drafts.ts` | payload 타입, 근거 행 변환(길이 제한) |
| `pipelines/AI-11.ts`, `AI-03.ts`, `AI-04.ts` | 위 시그니처 |
| `streaming/*` | 감시 경로(`watchPaths`/`onValue`), 부분 루트(`partial()`), `validateBlock(raw, id, {path, root})`, 제너레이터 finalize(보정 이벤트) |

## 기능별 모델 등급·prompt_version

| 호출 | 등급 | 사고 | 최대 출력 | prompt_version | callKey |
|------|------|------|-----------|----------------|---------|
| AI-11 순위 | light | low | 4,096 | `ai-11.rank.v1+common.v1` | `draft_source_ranking.rank` |
| AI-03 생성 | default | low | 16,000 | `ai-03.generate.v1+common.v1` | `career_description.generate` |
| AI-04 생성 | default | low | 8,192 | `ai-04.generate.v1+common.v1` | `cover_letter.generate` |
| AI-04 보정 | default | low | 8,192 | `ai-04.adjust.v1+common.v1` | `cover_letter.adjust` |

- 블록 순서(C-8): AI-04는 [공통] → [AI-04(생성+보정 규칙)] / [팩, cache] → [JD, cache] → [참고] → [문항+메모] → [다른 문항] → [사용자 근거] → [task]. 보정 호출도 같은 앞부분이라 캐시를 읽는다(테스트로 고정).
- input_hash: AI-11 = 해시 둘, AI-03 = 정규화 옵션(포함 id 정렬, project_order, tone), AI-04 = 문항·유형·글자 수·기준·메모·모드·사용자 근거(생성+보정 버전 포함). `career_snapshot_hash`는 언제나 전체 팩 기준(선택 팩 아님).

## 검증 규칙 적용 범위

| 규칙 | AI-11 | AI-03 | AI-04 |
|------|-------|-------|-------|
| V-1 | 프로젝트 ref·요건 ref | 근거·섹션·프로젝트 ref | 근거·sources ref |
| V-2·V-3 | — | 근거 | 근거(선택 이유·문단) |
| V-8 | — | learnings 금지 | motivation·future_plan·experience_story만 회고로 허용(단정 표현은 플래그), job_competency 금지 |
| V-7 | — | 선택 항목(팩 자체가 선택분) + 커리어 출처만 | sources 하위(+detail_refs), 소속 경력, 프로필·JD·메모 |
| V-4 | 유효 순위 0개 → 재시도 | 블록 유지 + `evidence_check_needed` | 문단: 유지 + 플래그 / AI 선택: 제거 |
| V-5 | 이유 문장 치환 | 치환 + `number_check_needed` (재생성 없음) | 치환 + 플래그, 보정 호출 시 함께 지시 |
| C-5 | — | 토큰 6종 유지·목록 재구성 | 같음 |
| 기타 | 별칭 → 이름 | 스킬명 가드, 상황·과제뿐 본인 주장, 불릿 4·프로젝트 8, 머리글 서버 작성 | 스킬명 가드, 상황·과제뿐, 유형별 개수, 사용자 목록 고정, 글자 수 보정 |

보고서 확장 키(개수만): `aliases_replaced`, `aliases_removed`, `skill_terms_flagged`, `self_claim_context_only`, `requirement_refs_dropped`, `block_ids_renamed`, `bullets_truncated`, `projects_out_of_scope`, `projects_duplicate`, `projects_missing`, `projects_truncated`, `sections_out_of_scope`, `education_summary_dropped`, `sources_total`, `sources_dropped_unknown_ref|duplicate|no_evidence|not_in_user_list`, `source_parent_corrected`, `detail_refs_dropped`, `sources_truncated`, `sources_below_minimum`, `reuse_without_reason`, `question_class_overridden`, `selection_mode_corrected`, `user_sources_missing`, `length_adjusted`, `length_adjust_failed`, `char_adjust_needed`, AI-11 `rankings_*`, `included_truncated`.

## 테스트·픽스처

- 픽스처 `__fixtures__/S7/drafts.ts`(가상 인물, AI-02 JD 재사용, 프로젝트 다수 행 생성기).
- `pipelines/AI-11.test.ts`(9): 요약 팩, ref 검증·8개 상한·이유 정리, 0개 → schema_invalid, 재사용 경로, 대체·인사이트 선택, 해시, 정본 스키마.
- `pipelines/AI-03.test.ts`(8): 계획 정규화·섹션 순서·8개 상한, 전체 스트림(머리글, 수치 치환, 키워드 끼워 넣기, 상황뿐 불릿, 불릿 4개, 선택 밖 프로젝트, 섹션 재배치, 블록 id 중복, 별칭 문장, 자리 표시, JD 근거 V-7), 절단 안내, persist 실패, 스키마 불일치, tone 주입 차단.
- `pipelines/AI-04.test.ts`(19): 이벤트 순서, V-7·부모 교정·detail 필터·근거 없는 선택 제거, 메모 근거, 메모 없는 지원 동기 자리 표시·유형 고정·개수 자르기, 회고 허용/금지, 사용자 모드, 글자 수 보정 성공·미달·실패, 수치 치환, 재사용 이유, 문단 0개, 글자 수 표, 해시.
- `validation/drafts.test.ts`(표 기반), `streaming/structured-stream.test.ts`(감시 값·제너레이터 finalize).

## 스펙 차이·가정
spec-gaps "2026-11-02 · S7 (ai)" ①~⑭. 상수: `MAX_DRAFT_PROJECTS = 8`, `AI03_MAX_BULLETS_PER_PROJECT = 4`, `LENGTH_TOLERANCE = 0.1`, `LENGTH_TARGET_RATIO = 0.95`, `PARAGRAPH_SEPARATOR = "\n"`, `SOURCE_COUNT_RULES`, `MAX_DETAIL_REFS = 2`, `SUMMARY_ACTION_MAX = 200`, `GENERIC_LATIN_TERMS`, V-3 70%(기존).

## QA 1라운드 반영

| 이슈 | 조치 |
|------|------|
| QA-S7-04 [Minor] | AI-03 테스트 픽스처를 고쳤다: 회고 근거만 단 불릿을 불릿 4개 상한 안(3번째)으로 옮겨, 상한이 아니라 V-8이 근거를 제거하는지 확인한다. 블록은 남고 `evidence_check_needed`가 붙으며, 근거 행이 없고 `evidence_removed_v8_learnings = 1`인지 본다. `block_completed` 칩이 비어 있는지도 본다. 상한 확인은 5번째 불릿(`prj-1-b6`)으로, 스킬명 가드(Kafka)는 독립 프로젝트 불릿(`side-b2`)으로 옮겼다. AI-04는 기존 테스트("learnings: reflection allowed in future_plan, removed in job_competency")가 같은 경우를 이미 확인한다: future_plan은 회고 근거를 남기고 플래그 없음, job_competency는 V-8로 제거하고 플래그를 단다. 코드 변경 없음. vitest src/server/ai 36파일 653개 통과, typecheck(src/server/ai)·lint 0건. |
