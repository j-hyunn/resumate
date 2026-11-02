# S8 AI 파이프라인 구현 노트 (ai-pipeline-engineer)

> 상태: **구현 완료 + QA 1차 반영(QA-S8-01)**. typecheck(전체 오류 0), lint(`src/server/ai`) 0건, vitest `src/server/ai` 40파일 702개 통과. payload는 db 노트 "Payload 모양"에 맞춤. QA-S7-10 수정 포함.

## QA-S8-01 반영: AI-06 단계 분리 (api는 이것을 쓴다)

`src/server/ai/pipelines/AI-06.ts` — 함수 하나 = 공급자 논리 호출 1회(V-6 재시도는 안에 남음). S6 `synthesizeOnce`/`regenerateSynthesis`/`finalizeInsight`와 같은 방식.

```ts
/** JSON 직렬화 가능(savePartial에 그대로 저장). */
export type AnswerEvaluationAttempt = {
  v: 1; kind: "first" | "regen"; promptVersion: string; model: string;
  usage: NormalizedUsage;        // 이 호출(+V-6 재시도) 합
  attempts: number;
  answerId: string; careerSnapshotHash: string; requirementsHash: string;
  output: Ai06Output;            // 만든 시점 컨텍스트의 별칭 형태
  refs: Record<string, { source_type; source_id; sid: string | null }>;  // 별칭 → 행 id (단계 사이 데이터 변경 대비)
  violations: string[];          // 개선 답변 예시의 근거 없는 숫자. "first"에서 비어 있지 않으면 재생성 단계를 돌릴 수 있음
};

export async function evaluateAnswerOnce(input: { context }, deps: Ai06Deps): Promise<AnswerEvaluationAttempt>;            // callKey 그대로
export async function regenerateModelAnswer(input: { context; violations: readonly string[] }, deps: Ai06Deps): Promise<AnswerEvaluationAttempt>;  // callKey `${callKey}.regen`, violations 빈 배열이면 Error
export function finalizeAnswerEvaluation(input: {
  context; first: AnswerEvaluationAttempt; regen: AnswerEvaluationAttempt | null;
  provider: ProviderId; connectionTier: ConnectionTier;   // 작업 값
  now: Date; logger?; jobId?;
}): AnswerEvaluationResult;     // 호출 없음. { payload: SaveAnswerEvaluationPayload, report, usage(first+regen), model, attempts, regenerated }
export function adaptEvaluationOutput(attempt, context): Ai06Output;   // finalize가 내부에서 씀
export async function evaluateAnswer(...)                             // 편의 래퍼(테스트용). 실행기는 쓰지 않는다
```
- 권장 실행: 답변마다 `first`(savePartial) → `first.violations.length > 0`이면 별도 실행 단위로 `regen`(무료는 STEP_CONTINUE로 간격 적용, 재시도 때 first 재호출 없음) → `finalize` → `save_answer_evaluation`. 재생성을 건너뛰려면 `regen: null`로 finalize → `[수치 확인 필요]` 치환.
- finalize는 **오늘의 컨텍스트**로 다시 검증한다. 단계 사이 커리어 데이터가 바뀌어 해시가 다르면 별칭을 행 id로 옮겨 맞추고, 없어진 행의 근거는 V-1로 빠진다. `answerId`가 다르면 Error.
- 던지는 오류: once/regen은 `ProviderError`, `AiError("canceled"|"timeout"|"schema_invalid", retryable:false)`. finalize는 호출자 버그(순서·답변 불일치)일 때만 `Error`.

## api-engineer용 시그니처 (확정)

공통
- 파이프라인은 DB·요청·`after()`를 모른다. api가 행을 읽어 컨텍스트를 만들고, 파이프라인은 검증이 끝난 **RPC p_payload**를 돌려주거나(AI-06, AI-07) 콜백으로 넘긴다(AI-05 `onQuestion`).
- 공급자·연결 등급은 `deps.llm` 값(`llm.provider`, `llm.connectionTier`)을 메타에 쓴다. `model_tier`는 세 기능 모두 `default`.
- 취소는 `signal.abort("canceled")`, 그 밖의 abort 이유는 timeout(기존 규칙).
- 공용 상수: `src/server/ai/schemas/interview-common.ts`
  - `INTERVIEW_TYPES`, `JOB_SOURCE_KINDS`, `CULTURE_SOURCE_KINDS`, `INTERVIEW_SOURCE_KINDS`(9값, DM A.13 CHECK 순서), `INTERVIEW_ANCHORS`, `DATA_SUFFICIENCY_LEVELS`, `CRITERIA_KEYS`(4), `CRITERIA_GRADES`(5), `NEXT_PRACTICE_TYPES`(3), `QUESTION_COUNTS`
  - `pendingScore()` → `{ status: "pending_method", value: null, max: null, method_version: null, rationale: null }`
  - `src/lib/contracts/enums.ts`에 같은 목록이 생기면 QA가 대조한다(ai는 `src/lib`을 고치지 않음).
- payload 타입: `src/server/ai/storage/interview.ts` (`SaveInterviewQuestionPayload`, `CompleteInterviewQuestionsPayload`, `SaveAnswerEvaluationPayload`, `SaveSessionFeedbackPayload`, `StoredAnswerEvaluation`, `StoredSessionFeedback`, `hasEvidenceKey`)

### AI-05 질문 생성 — `src/server/ai/pipelines/AI-05.ts`

```ts
export const AI05_TIER = "default";
export const AI05_JOB_TYPE = "interview_questions";
export const AI05_PROMPT_VERSION = "ai-05.generate.v1+common.v1";
export const AI05_CALL_KEY = "interview_questions.generate";   // attempt n(≥1): "interview_questions.generate.<n+1>"
export const AI05_MAX_ATTEMPTS = 2;                            // 첫 호출 + 남은 개수 재생성 1회

export function buildInterviewQuestionContext(input: {
  interviewType: "job" | "culture_fit";
  questionCount: 3 | 5 | 7;
  dataSufficiency: "ok" | "thin" | "none";        // 세션 값(서버 판정). 모델 출력값은 쓰지 않음
  careerRows: CareerRows | null;                   // 컬처핏 none이면 null 가능(빈 팩)
  asOf?: YearMonth;
  jobDescriptionId: string;
  jobDescriptionUpdatedAt: string | null;
  sentences: readonly JdSentence[];
  cultureSids: readonly string[];                  // job_descriptions.extraction.other_sids (컬처핏만 사용)
  requirements: readonly JdRequirementInput[];
  positionTitle: string | null;
  insightSignal?: { insightId: string; matches: ReadonlyArray<{ requirement_id: string; status: "met"|"partial"|"no_evidence"; missing_aspect: string | null }> } | null; // 직무만
  recentQuestions?: readonly string[];             // 같은 프로젝트·같은 유형 최근 2세션 question_text
}): InterviewQuestionContext;   // .insightId = 실제로 프롬프트에 넣었을 때만(직무 + partial/no_evidence 요건 1개 이상)

export type ExistingInterviewQuestion = {         // begin_interview_questions.existing_questions 그대로
  sequence: number; source_kind; anchor; question_text: string;
  target_requirement_ids: readonly string[]; target_gap_requirement_ids: readonly string[];
  evidence_sources?: ReadonlyArray<{ source_type: string; source_id: string }>;   // 선택
};

export async function generateInterviewQuestions(
  input: { context; existingQuestions?: readonly ExistingInterviewQuestion[]; attempt?: number; unsupportedNumbers?: readonly string[] },
  deps: { llm: Llm; onQuestion: (p: SaveInterviewQuestionPayload) => Promise<void>; signal?; logger?; jobId?; now?: () => Date; callKey? },
): Promise<InterviewQuestionsAttempt>;
// { attempt, saved[], totalSaved, remaining, weakRequirementIds, dropped, unsupportedNumbers, missingKinds, report, model, usage, promptVersion }

export function emptySequences(count: number, existing: readonly { sequence: number }[]): number[];
export function toExistingQuestion(p: SaveInterviewQuestionPayload): ExistingInterviewQuestion;
export async function runInterviewQuestions(input: { context; existingQuestions? }, deps): Promise<InterviewQuestionsRun>;  // 편의 함수
export function buildCompleteInterviewQuestionsPayload(input: {
  context; weakRequirementIds: readonly string[]; existingWeakRequirementIds?: readonly string[];
  model: string; usage?: NormalizedUsage | null; report?: Record<string, number> | null;
  provider: ProviderId; connectionTier: ConnectionTier;
}): CompleteInterviewQuestionsPayload;   // { weak_requirement_ids, insight_id, career_snapshot_hash, meta }
```

- **sequence (리더 결정)**: 새 질문은 1..questionCount 중 **비어 있는 번호를 작은 것부터** 쓴다(5문항 중 1·2·4 저장 → 3, 5). db `next_sequence`와 같은 규칙. 범위 밖 sequence의 existing은 무시.
- **api 호출 방식**: 단계마다 `generateInterviewQuestions` 1번 — `attempt: 0`, 모자라면 다음 단계(STEP_CONTINUE)에서 `attempt: 1` + 앞 결과의 `unsupportedNumbers`. `attempt ≥ 1`은 세트 구성 규칙을 완화(경고 후 진행). 두 번째도 `remaining > 0`이면 api가 `AiError("schema_invalid", { retryable: false })`로 끝낸다(저장된 질문 유지 → "남은 질문 다시 만들기").
- `weakRequirementIds`는 attempt마다 나온다(직무만). api는 attempt들의 값을 합쳐 `buildCompleteInterviewQuestionsPayload`에 넘긴다. existing의 gap 대상 요건은 자동 포함. 이 프로젝트 요건이 아닌 id는 걸러진다.
- 진행 표시: `onQuestion`에서 저장한 뒤 `{stage:"generate", done, total}` 갱신.
- 잘린·깨진 JSON 스트림은 오류가 아니다: 닫힌 질문만 저장되고 나머지는 `remaining`(`report.stream_incomplete`).
- 던지는 오류: `ProviderError`(스트림 도중 포함, 그 전 질문은 이미 저장됨), `AiError("canceled"|"timeout")`, `onQuestion`이 던진 오류. `runInterviewQuestions`만 끝까지 모자랄 때 `schema_invalid`.

### AI-06 답변 평가 — `src/server/ai/pipelines/AI-06.ts`

```ts
export const AI06_TIER = "default";
export const AI06_PROMPT_VERSION = "ai-06.evaluate.v1+common.v1";
export const AI06_CALL_KEY = "interview_evaluation.evaluate";   // V-5 재생성은 `${callKey}.regen`. 답변별 callKey 권장: "interview_evaluation.evaluate.<sequence>"

export function buildAnswerEvaluationContext(input: {
  interviewType; dataSufficiency; careerRows: CareerRows | null; asOf?;
  jobDescriptionId; jobDescriptionUpdatedAt; sentences; cultureSids; requirements; positionTitle;
  question: {
    id; sequence; question_text; source_kind; anchor; intent: string | null;
    focus_criteria: readonly string[]; good_answer_signals: readonly string[]; target_requirement_ids: readonly string[];
    evidence: ReadonlyArray<{ source_type: string; source_id: string; source_field: string | null; sid?: string | null }>; // jd_sentence는 source_locator.sid 필요
  };
  answer: { id: string; answer_text: string; updated_at: string | null };
}): AnswerEvaluationContext;

export async function evaluateAnswer(
  input: { context: AnswerEvaluationContext; numberRegeneration?: boolean /* 기본 true */ },
  deps: { llm; signal?; logger?; jobId?; now?; callKey? },
): Promise<AnswerEvaluationResult>;  // { payload: SaveAnswerEvaluationPayload, report, usage(재생성 합산), model, attempts, regenerated }
```
- 같은 세션 답변들은 pack·JD 블록이 같아 캐시를 공유한다(C-8). 다른 답변은 넣지 않는다.
- V-5 재생성은 호출 1회를 더 쓴다(최대 2 논리 호출 × V-6 재시도). 무료 등급·시간 예산이 빠듯하면 `numberRegeneration: false` → 바로 `[수치 확인 필요]` 치환.
- 던지는 오류: `ProviderError`, `AiError("canceled"|"timeout")`, `AiError("schema_invalid", retryable:false)`(zod 불일치 또는 criteria 4키 규칙 위반, 1회 재시도 후).

### AI-07 세션 종합 — `src/server/ai/pipelines/AI-07.ts`

```ts
export const AI07_TIER = "default";
export const AI07_PROMPT_VERSION = "ai-07.summarize.v1+common.v1";
export const AI07_CALL_KEY = "interview_evaluation.summarize";

export async function summarizeSession(
  input: {
    interviewType; dataSufficiency;
    questions: ReadonlyArray<{
      id; sequence; question_text; source_kind; anchor; intent: string | null; target_requirement_ids: readonly string[];
      answer_status: "submitted" | "unanswered";
      evaluation: Pick<StoredAnswerEvaluation, "criteria" | "strengths" | "improvements"> | null;  // succeeded 평가 result. 실패면 null
    }>;
    requirements: ReadonlyArray<{ id: string; content: string }>;   // 세션 weak + 질문 target 요건
    weakRequirementIds: readonly string[];
    careerSnapshotHash: string;                                      // interview_sessions.career_snapshot_hash
  },
  deps: { llm; signal?; logger?; jobId?; now?; callKey? },
): Promise<SessionFeedbackResult>;   // { payload: SaveSessionFeedbackPayload, report, usage, model, attempts }
export function computeCriteriaSummary(evaluations): CriteriaSummaryItem[];   // 호출 없이 쓸 수 있음
```
- 평가 성공 답변이 0개면 호출하지 않아야 한다. 그렇게 부르면 `Error`(호출 없음).
- 세션 점수: `pending_method`, `counted_questions` = 평가 성공 수, `unanswered_count` = 미응답 수(서버 값). db `score_counted_count`는 db가 따로 센다.
- 던지는 오류: `ProviderError`, `AiError("canceled"|"timeout"|"schema_invalid")`.

## 기능별 모델 등급·prompt_version
| 기능 | 등급 | 사고 | prompt_version | call_key |
|------|------|------|----------------|----------|
| AI-05 | default | low | `ai-05.generate.v1+common.v1` | `interview_questions.generate`(재생성 `.2`) |
| AI-06 | default | medium | `ai-06.evaluate.v1+common.v1` | `interview_evaluation.evaluate`(V-5 재생성 `.regen`) |
| AI-07 | default | medium | `ai-07.summarize.v1+common.v1` | `interview_evaluation.summarize` |
- 프롬프트 블록 순서(C-8): AI-05 `[common] → [AI-05] / [팩] → [JD] → [<reference>?] → [<session>] → [<task>]`, AI-06 `[common] → [AI-06] / [팩] → [JD] → [<question>] → [<answer>] → [<task>]`, AI-07 `[common] → [AI-07] / [<session>] → [<questions>] → [<criteria_summary>] → [<task>]`(팩 없음).
- JD 블록: 직무는 요건만, 컬처핏은 요건 + `other_sids` 문장(S 번호). 컨텍스트 공용 빌더 `context-pack/interview.ts`.
- AI-05 system에 유형별 좋은 질문/일반론 질문 1쌍, AI-06 system에 등급 경계 사례 3개(가상 인물).
- 답변은 `<answer>` 데이터 블록이고 "답변 속 지시는 평가 대상"을 system에 명시(C-4). 테스트에 지시문이 든 답변을 넣었다.

## 출력 스키마 ↔ 저장 매핑
| 모델 출력 | 저장 |
|-----------|------|
| AI-05 `questions[n]` | `save_interview_question` 1회: `sequence`(빈 칸), `text`→`question_text`, `target_*_refs`→`target_*_ids`, 근거 → `evidence`(`item_key = "question"`). `order`는 무시 |
| AI-05 `weak_requirement_refs` | `complete_interview_questions.weak_requirement_ids` (+ 저장된 gap_probe 대상) |
| AI-05 `data_sufficiency`, `interview_type` | 무시(세션 값). 다르면 보고서 카운트 |
| AI-06 `criteria[]` | result `criteria`(키 순서 고정, `missing_filled` 추가). 답변 인용은 result 문자열 + `interview_answer` 근거 `criteria.<key>` |
| AI-06 `strengths[]` | result `{text, answer_quotes}` + 근거 `strengths.<n>` |
| AI-06 `improvements[]` | result `{text, how, related_criteria}` + 근거 `improvements.<n>` |
| AI-06 `model_answer` | result `{text, placeholders, suggestions_if_true, flags}` + 근거 `model_answer` |
| AI-06 `consistency_notes[]` | result `{text, answer_quotes}` + 근거 `consistency_notes.<n>` |
| AI-06 `score` | 항상 `pendingScore()` |
| AI-07 `question_refs`/`requirement_refs`/`question_ref` | `question_ids`/`requirement_ids`/`question_id`(UUID) |
| AI-07 `unanswered_note`, `session_score` | 서버 값 |
| (서버) `criteria_summary` | `[{key, distribution:{excellent,good,fair,poor,not_applicable}}]` |
- 모든 result에 `evidence` 키 없음(`hasEvidenceKey` 테스트). AI-07 `evidence: []`.
- 질문 payload의 `meta.validation_report`는 그 질문 하나의 카운트. 세트 단위 보고서는 attempt `report`(로그용, db는 저장하지 않음).

## 검증 규칙 적용 범위
- **AI-05** (질문 단위, 위반 질문 폐기 → 남은 개수 재생성)
  - 유형별 source_kind, 앵커(직무 experience|jd, none 데이터는 experience 불가)
  - V-1~V-3, V-8(직무: learnings 제거 / 컬처핏 experience: 회고 인용 표현일 때만 learnings 유지)
  - 앵커 근거(experience → 경력 근거, 직무는 사실 근거만 / 컬처핏 jd → S 문장 / general → 근거 삭제)
  - 종류 근거(pdd: action·result·성과, rf: 요건 + 사실 경력, gap: gap 요건)
  - 컬처핏 비 experience: 경력 고유명사 금지, 숫자는 JD 것만
  - V-5(질문 문장: 위반 시 폐기), C-7 금지 주제, 별칭 → 이름
  - 중복(문장, 최근 세션 문장, 같은 프로젝트 ≤ 2, 상세 내용 1, 요건 1 — 직무)
  - 세트 구성: 받을 때마다 가능성 검사(`canAccept`), 재생성 attempt에서 완화
- **AI-06**: V-6(+ criteria 4키·not_applicable), 답변 인용 V-3, 강점 V-4 drop, 개선 답변 예시 V-1~V-5·V-8·C-5·V-4 flag, 일관성 메모(허용 조건 + 사실 근거), 문장 별칭·Q-n 정리, V-5 치환(이유·개선점 문장)
- **AI-07**: 질문 ref V-1(평가된 질문만), V-4(ref 0개 항목 폐기), 미응답 언급 폐기, 요건 ref → UUID, 서버 note·summary·점수

## 이벤트·진행 단계·오류 코드
- 새 SSE 이벤트 없음(비동기 작업). 진행 단계는 api가 `generate`/`evaluate`/`summarize`로 갱신.
- 오류 코드는 기존 C-11 그대로. 새 코드 없음.

## 테스트·픽스처
- `__fixtures__/S8/interview.ts`: KO JD + 팀 문화 2줄(컬처핏 S 문장), `thinCultureRows`, 출력 빌더 `q()`/`ai05Output()`.
- `pipelines/AI-05.test.ts` (14): 직무 5문항 정상(sequence·근거 UUID·weak·C-8 순서), 금지 주제·수치 날조·회고 전제·없는 ref 폐기, 중복 4종, 구성 규칙 엄격/완화, **빈 칸 1·2·4 → 3·5**, 재생성(기존 질문·V-5 피드백)·끝까지 부족 → schema_invalid, 스트림 중 공급자 오류, 잘린 JSON, onQuestion 실패, 별칭 → 이름, 컬처핏 none(사실 가정 금지), 컬처핏 고유명사·회고 인용, 주제 중복.
- `pipelines/AI-06.test.ts` (12): 분리 단계 3개(JSON 왕복 저장 → 다음 단계 재생성 → finalize, 재생성 재시도 때 첫 평가 재호출 없음, 재생성 없이 finalize 치환·순서 오류, 단계 사이 데이터 변경 시 별칭 재매핑·삭제된 근거 제거) + 정상 payload·점수 덮어쓰기·답변 속 지시문, 인용 불일치·missing 채움·강점 폐기, criteria V-6 재시도·실패, 개선 답변 수치 날조(재생성 성공/실패 치환/재생성 끔), 답변 속 숫자 허용, 직무 V-8·일관성 메모, 컬처핏 ok 회고 마무리, 컬처핏 none(일관성 메모 폐기, `[사례 입력 필요]`).
- `pipelines/AI-07.test.ts` (4): ref 정리·미응답 언급 폐기·서버 문구·점수·summary, 응답 1개/0개, 헬퍼.
- `validation/interview.test.ts` (18): 금지 주제 표(직무어 오탐 없음), 구성 규칙 3/5/7·컬처핏, 고유명사·회고 인용.
- `pipelines/AI-04.test.ts`: **QA-S7-10** — 보정 호출 전 간격 대기 중 취소(`AiError("canceled")`, ProviderError 아님) → `error(canceled)`, 저장 없음.

## QA-S7-10 수정
- `pipelines/AI-04.ts` 보정 실패 처리: `isProviderError(err) && err.code === "canceled"` → `isAiError(err) && err.code === "canceled"`. 무료 등급 `spaceCall`의 취소도 실행을 끝낸다.

## 스펙 차이·가정 (spec-gaps "2026-11-03 · S8 (ai)" ①~⑫)
- 상수: `AI05_MAX_ATTEMPTS = 2`, `MAX_PER_PROJECT = 2`, `MAX_PER_DETAIL = 1`, `MAX_PER_REQUIREMENT = 1`, `MISSING_FALLBACK`, `FORBIDDEN_TOPIC_PATTERNS`, `REFLECTION_CITATION`(규칙 기반 `[가정]`), V-3 부분 일치 70%(기존 `QUOTE_PARTIAL_MATCH_THRESHOLD`).
- 질문 V-5는 치환 대신 폐기, 세트 구성은 가능성 검사로 질문 단위화, 재생성 attempt에서 완화.
- AI-06 `consistency_notes` 원소 `{text, answer_quotes, evidence}` `[가정]`, 답변 인용도 `interview_answer` 근거 행으로 저장, improvements는 근거 없어도 유지.
- AI-07 저장 키 `*_ids`, 미응답 문구 서버 생성.
