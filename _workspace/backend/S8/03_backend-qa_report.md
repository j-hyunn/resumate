# S8 백엔드 QA 리포트 (라운드 1)

> 대상: HEAD(e4035af) 대비 작업 트리 diff 전체(마이그레이션 7개, pgTAP 2개 + 기존 4개 수정, AI-05/06/07, 작업 2종, 라우트 4개, 액션·조회, 실행기 `wouldRetry`, QA-S7-10).
> 코드는 고치지 않았고 커밋하지 않았다.

## 검사 실행 결과
`supabase db reset`(S8 마이그레이션 7개 포함, 성공) 뒤 `bash .claude/skills/backend-integration-qa/scripts/run-checks.sh --build`.

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | |
| lint | 통과 | |
| vitest | 통과 | 84파일 1,319개. 로컬 스택 통합(`interview.integration.test.ts` 8개 포함) 실행됨, skip 없음 |
| build (`--build`) | 통과 | 새 라우트 4개가 빌드 출력에 있음 |
| pgTAP | 통과 | 41파일 1,960개(`interviews.test.sql`, `interviews_career_deletion.test.sql` 포함) |
| 생성 타입 최신 여부 | 통과 | `supabase gen types typescript --local` 출력과 `src/server/db/database.types.ts` 차이 없음 |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM A.12·A.13·§2.7 v4.1·§0 AI 메타 ↔ 마이그레이션 | 통과. 5개 테이블 컬럼·CHECK 값·partial unique `(application_project_id) where status='in_progress'`·공급자 4컬럼·점수 슬롯이 DM과 같다. 추가 컬럼(작업 id·실행 세대)은 spec-gaps db ①에 기록 | — |
| Q2 | 마이그레이션 ↔ 타입 ↔ 쿼리 | 통과. 사용자 경로의 `interview_questions` select는 `USER_QUESTION_COLUMNS`(read.ts:60)로 나열하고, grant 목록(tables.sql:507-510) 안에 있다. `select('*')` 없음 | — |
| Q3 | RPC 시그니처 ↔ 호출부 | 통과. `db.ts:266-363`의 RPC 9개, 사용자 RPC 5개 모두 `p_*` 이름이 SQL과 같다(생성 타입으로 typecheck). 반환 jsonb 키(`answers_to_evaluate`, `existing_questions`, `applied`/`reason`, `not_scored_answer_ids` 등)가 파서와 같다 | — |
| Q4 | raise 코드 ↔ 오류 매핑 | 통과. S8 SQL의 `message = '...'` 30종이 모두 `errors.ts`에 매핑되어 있다. 서버가 만든 인자 오류는 500 `internal_error`, 없음은 404 | — |
| Q5 | 계약 ↔ 핸들러 ↔ 화면 | 통과(UI 미연결). 시작 422/409(`details.sessionId`), 제출 `jobId: null`(응답 0개), 다시 채점·남은 질문 409 코드가 계약 주석·서비스와 같다 | — |
| Q6 | SSE | 해당 없음(새 SSE 없음, 비동기 작업만) | — |
| Q7 | AI 출력 ↔ 저장 | 통과. payload 키가 SQL 검사와 같고, result 어느 깊이에도 `evidence` 키가 없다(SQL `lax $.**.evidence` + `hasEvidenceKey` 테스트). `interview_answer` 근거는 `source_field = null`. 점수는 항상 `pending_method`(AI-06 `pendingScore()` + `save_answer_evaluation`) | — |
| Q8 | enum DB ↔ TS | 통과. 세션 상태 5·생성 상태 3·source_kind 9·anchor 3·답변 상태 3·점수 상태(세션 3/답변 4)·결과 상태 3·문항 수 3/5/7이 CHECK ↔ `enums.ts` ↔ `interview-common.ts` 순서까지 같다 | — |
| Q9 | 작업 종료·사용 기록·재시도 | 이슈. 질문 생성은 실행 1번 = 호출 1번(STEP_CONTINUE로 재생성, 무료 간격 적용), 채점 유료 병렬은 성공하는 대로 저장, 무료는 답변 1개 = 실행 1번. 단 AI-06 V-5 재생성이 같은 단계 안의 두 번째 호출이다 | QA-S8-01 |
| Q10 | 보안·개인정보 | 통과(테스트 보강 1건). 비공개 컬럼은 사용자 grant 없음, `intent`는 제출 후 definer RPC로만, `good_answer_signals`는 어떤 사용자 경로에도 없다. 작업 partial·output에도 없다. 로그에 답변 본문 없음(로그 필드는 jobId·코드·개수·sequence뿐, 통합 테스트가 확인). definer 함수 전부 `search_path = ''` + 소유 검사 | QA-S8-02 |
| Q11 | UI ↔ 백엔드 | 해당 없음(S-20/S-33/S-22/S-37 화면 없음, A4 "연결 대기"). UI build 통과 | — |

### 포커스 항목별 확인
| 항목 | 결과 | 근거 |
|------|------|------|
| 답변 편집 조건 | 통과 | RLS `interview_answers_update_own`(tables.sql:480-487): draft + 세션 in_progress + 미제출 + ready. 0행이면 `whyNotEditable`(write.ts:48-58)이 409/404로 이유를 돌려준다. 그만둔 세션 편집 금지는 spec-gaps db ④ |
| 제출 1회·미응답·응답 0개 | 통과 | `submit_interview_session`(user_rpcs.sql:225-298): 공백뿐(`!~ '\S'`) → unanswered, 0개 → completed + not_scored + 작업 없음. 서비스는 `evaluation_needed`일 때만 작업 시작(start.ts:187) |
| D-36 키 삭제 후 답변 보존 | 통과 | 자동 저장은 키가 필요 없는 액션. `job.test.ts` 키 삭제 → `key_missing`, 평가 보존 |
| 날조 방지 | 통과(스펙 차이 1건) | 직무 질문 learnings 근거는 AI(`learnings: "forbidden"`)와 DB(question_rpcs.sql:432-437) 양쪽에서 막는다. project_deep_dive는 action/result/성과만(AI-05.ts:333-337). 컬처핏 비 experience 앵커는 경력 고유명사 금지 + JD 숫자만. 금지 주제는 질문 폐기. 개선 답변 예시는 V-1~V-5·C-5, 데이터 밖은 `suggestions_if_true`. 답변 인용은 `matchQuote`로 답변의 실제 부분 문자열로 바꾸고 실패는 제거. AI-07은 미응답 언급 항목 폐기, 개선 답변 예시는 보내지 않음 |
| 빈 칸 채우기·남은 질문 다시 만들기 | 통과 | AI `emptySequences` ↔ DB `next_sequence` 같은 규칙, sequence 멱등. 새 작업은 `begin`이 실패 세션을 다시 연다 |
| 실행기 `wouldRetry` 회귀 | 통과 | `runner.ts:485-496`이 실행 후 판단(`runner.ts:541-547`)과 같은 `decideRetry` 입력을 쓴다. 다른 작업 종류는 이 필드를 쓰지 않으며 전체 vitest 통과 |
| 채점 부분 실패·`evaluation_failed`·다시 채점 범위 | 통과 | 실패 답변만 `not_scored` 후 종합은 나머지로. 전부 실패면 종합 호출 없이 `evaluation_failed` + 작업 실패. 다시 채점은 성공 평가가 없는 답변 + 종합만(evaluation_rpcs.sql:149-163) |
| `evaluation_provider` 덮어쓰기·실행 공급자 표시 | 통과 | `begin_interview_evaluation`이 매번 기록(evaluation_rpcs.sql:232-234, 263-265). `executionProviderOf`(view.ts:106-115)가 DM 2.7 규칙과 같다 |
| 보드 팝업 | 통과 | `move_application_stage` → `in_progress_session_id` + `in_progress_session` ↔ `toInterviewPrompt`(write.ts) 키가 같다 |
| 프로젝트당 작성 중 세션 1개 | 통과 | partial unique + RPC `interview_in_progress`(detail = 세션 id) → 409 `details.sessionId` |
| 삭제 영향·`delete_results`·연쇄 | 통과 | `interviews_career_deletion.test.sql` 13개, 세션 삭제 트리거가 진행 작업 취소 요청 |
| 남은 generating/evaluating 행 = 실패 | 통과 | `resolveSessionRun`(view.ts:180-204) + `view.test.ts` |
| QA-S7-10 | **수정 확인** | `AI-04.ts:643` `isAiError(err) && err.code === "canceled"`면 다시 던짐. 테스트 `AI-04.test.ts`("QA-S7-10 …") 통과. 다른 파이프라인에 같은 `isProviderError … canceled` 패턴 남지 않음 |

## 이슈

### QA-S8-01 [Major] AI-06 개선 답변 V-5 재생성이 채점 단계 안의 두 번째 공급자 호출이다 (무료 등급 간격 없음, 재시도 때 첫 평가 재호출)
- 담당: api-engineer(주), ai-pipeline-engineer(분리 함수가 필요하면)
- 근거
  - `src/server/ai/pipelines/AI-06.ts:371-378`: 첫 평가에 근거 없는 수치가 있으면 `call(...)`을 한 번 더 한다(`numberRegeneration` 기본 true).
  - `src/server/jobs/interview.ts:115`: `evaluateAnswer`에 `numberRegeneration`을 넘기지 않는다 → 무료 등급에서도 재생성한다.
  - `src/server/services/interview/job.ts:543-553`: 무료 등급은 "실행 1번 = 답변 1개"인데, 그 안에서 AI-06이 호출 2번(V-6 재시도까지 최대 4번)을 간격 없이 연속으로 한다. 실행기의 C-12 간격은 단계 경계에서만 적용된다(`runner.ts:436`).
  - 유료 등급도 재생성 호출이 재시도 가능한 오류로 실패하면 첫 평가가 저장되지 않아 단계 재시도가 첫 호출부터 다시 한다(호출·사용 기록 낭비). 답변 7개 병렬 × 순차 2호출은 60초 예산도 빠듯하다.
  - S6 선례 QA-S6-03(종합 V-5 재생성을 `synthesize_regen` 단계로 분리)과 같은 문제다. ai 노트 ⑧("함수 예산이 빠듯하면 api가 `numberRegeneration: false`로 끌 수 있다")을 api가 반영하지 않았다.
- 수정 제안
  - 최소: 무료 등급(`ctx.sequential`)에서는 `numberRegeneration: false`(바로 `[수치 확인 필요]` 치환)로 부른다.
  - 권장(S6 방식): ai가 "첫 평가"와 "재생성"을 나눠 부를 수 있게 하고(예: 첫 결과를 받아 재생성만 하는 함수), api는 첫 결과를 `savePartial`에 두고 재생성을 별도 실행 단위로 돌린다(무료는 STEP_CONTINUE로 간격 적용, 유료도 재시도 때 첫 결과 재사용).
  - 테스트: 무료 등급에서 재생성이 있는 답변의 모든 호출 사이 간격 ≥ 6초, 재생성 재시도 때 첫 평가 재호출 0회.
- 상태: 열림

### QA-S8-02 [Minor] 교차 사용자 pgTAP이 질문·답변 평가·종합 테이블의 사용자 세션 select를 확인하지 않는다
- 담당: db-engineer
- 근거: `supabase/tests/interviews.test.sql:270-284` — 사용자 B(authenticated)로 `interview_sessions`·`interview_answers` select/update/delete와 사용자 RPC만 확인한다. `interview_questions`는 app_ai_writer 역할로만 확인했고, `answer_evaluations`·`session_feedbacks`는 B 확인이 없다(그 시점에 A의 평가·종합 행이 없음). 정책 자체는 맞다(tables.sql:472-499).
- 수정 제안: A의 평가·종합이 저장된 뒤(채점 블록 이후) B(authenticated)로 `interview_questions`·`answer_evaluations`·`session_feedbacks`의 count = 0, B(app_ai_writer)로 평가·종합 count = 0을 더한다.
- 상태: 열림

### QA-S8-03 [Minor] 진행 단계 목록 `AI_PROGRESS_STAGES`에 `complete`가 없다
- 담당: api-engineer
- 근거: 두 면접 작업이 `stage: "complete"`를 진행 단계로 쓴다(`job.ts:392-394`, `job.ts:609-611`). 실행기는 마지막 단계 이름을 `progress.stage`로 저장한다. 그런데 `src/lib/contracts/enums.ts:139-155`에는 `complete`가 없다(같은 목록에 `synthesize`가 두 번 들어 있음, S6부터). 지금은 이 목록을 검사하는 코드가 없어 동작은 한다. 하지만 UI 연결 때 진행 문구 매핑이 빠진다.
- 수정 제안: `complete`를 추가하고 중복 `synthesize`를 지운다. 진행 단계 값 추가는 S6 ⑫처럼 spec-gaps에 C-6 반영 요청으로 남긴다.
- 상태: 열림

### QA-S8-04 [Minor] 질문 생성 `complete` 단계가 컨텍스트를 다시 만들어 `insight_id`·`career_snapshot_hash`를 완료 시점 값으로 저장한다
- 담당: api-engineer
- 근거: `src/server/services/interview/job.ts:392-406`. `complete` 단계가 `contextFor(ctx)`(job.ts:302-322)로 커리어 행·인사이트 신호·최근 질문을 다시 읽어 `buildCompleteInterviewQuestionsPayload`에 넘긴다. 질문을 만든 뒤 완료 전에 커리어를 고치거나 인사이트를 다시 만들면, 세션의 `career_snapshot_hash`·`insight_id`가 질문을 만들 때 쓴 값과 달라진다. AI-07은 이 세션 해시를 `hashes`로 쓴다. 호출이 없는 단계인데 커리어 전체를 다시 읽는 비용도 든다.
- 수정 제안: `generate` 단계 출력(또는 partial)에 그 호출에서 쓴 `context.insightId`·`context.base.careerSnapshotHash`를 넣고, `complete`는 그 값으로 payload를 만든다. 그러려면 ai의 `buildCompleteInterviewQuestionsPayload`가 컨텍스트 대신 이 두 값을 받을 수 있어야 한다.
- 상태: 열림

## 스펙 차이 (spec-gaps.md로 넘길 항목)
- **직무 질문의 사실 전제 범위**: AI 명세 03 line 1075 "(v3) 직무 질문의 사실 전제(수치·행동)는 `action`/`result`/성과에서만". 구현은 `project_deep_dive`에만 이 제한을 적용한다(AI-05.ts:333-337). `requirement_fit`은 사실 경력 근거면 상황·과제·프로젝트 요약도 받는다(AI-05.ts:339). 숫자는 팩의 사실 텍스트 전체에서 허용한다. ai 노트 spec-gaps ai ⑤에 `[구현 결정]`으로 적혀 있으므로 코드 이슈로 두지 않았다. 리더가 기획에 "requirement_fit도 action/result/성과만인지" 확인을 요청하길 권한다.
- 그 밖의 `[가정]`·`[구현 결정]`(db ①~⑭, ai ①~⑫, api ①~⑪)은 계획서 `[가정]` 1~5와 맞고 코드와도 일치한다. 새로 넘길 항목은 없다.

## 라운드 요약
- 열린 이슈: Critical 0, Major 1(QA-S8-01, api 주 담당), Minor 3(QA-S8-02 db, QA-S8-03 api, QA-S8-04 api)
- 검사: typecheck·lint·vitest·build·pgTAP 모두 통과(SKIP 없음)

---

# S8 백엔드 QA 리포트 (라운드 2, 최종)

> 대상: 각 담당자의 "QA 1차 반영"(db·api·ai 노트)과 spec-gaps S8 (api) ⑫·⑬. 코드는 고치지 않았고 커밋하지 않았다.

## 검사 실행 결과
`supabase db reset`(성공) 뒤 `run-checks.sh --build`.

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | |
| lint | 통과 | |
| vitest | 통과 | 84파일 1,326개(1차 1,319 → +7). 로컬 스택 통합 포함, skip 없음 |
| build | 통과 | |
| pgTAP | 통과 | 41파일 1,966개(1차 1,960 → +6) |
| 생성 타입 최신 여부 | 통과 | `supabase gen types` 출력과 같음(스키마 변경 없음) |

## 이슈 재확인
| 이슈 | 상태 | 확인 내용 |
|------|------|-----------|
| QA-S8-01 [Major] | **수정됨(확인 완료)** | AI-06이 `evaluateAnswerOnce` / `regenerateModelAnswer` / `finalizeAnswerEvaluation`(호출 없음)으로 나뉘었다. 채점 단계는 답변마다 끝난 호출을 `partial.calls[answerId] = {first, regen}`에 `savePartial`로 둔다(`job.ts:557-599`). **무료**: 실행 1번 = 호출 1번이다. 첫 평가에 위반이 있으면 저장 후 `STEP_CONTINUE`로 끝나고, 재생성은 다음 실행에서 한다(`job.ts:628-639`). 실행기의 6초 간격·단계별 재시도 예산이 호출마다 적용된다. **유료**: 답변별 병렬은 그대로다. 답변 안에서 첫 평가 → 저장 → 재생성 → finalize → `save_answer_evaluation` 순서로 가고, 단계 재시도는 저장된 첫 평가를 다시 부르지 않는다. 재생성이 최종 실패하면 첫 평가로 finalize한다(`[수치 확인 필요]` 치환, spec-gaps api ⑬). 단 재시도 가능 오류와 키·한도 범주는 기존 분류(재시도·작업 실패)로 간다(`job.ts:588-595`). 테스트 `job.test.ts:538-592`: 무료 호출 순서·모든 호출 간격 ≥ 6초·사용 기록 5행, 유료·무료 재생성 재시도 때 첫 평가 재호출 0회(`evaluate.1` 사용 기록 1행), 재생성 최종 실패 → 성공 저장(`not_scored` 아님) |
| QA-S8-02 [Minor] | **수정됨(확인 완료)** | `interviews.test.sql:420-437`: A의 질문 3·평가 1·종합 1이 있는지 먼저 확인(고정값)한 뒤, B(authenticated)는 질문·평가·종합 0행, B(app_ai_writer)는 평가·종합 0행. 6개 추가, 통과 |
| QA-S8-03 [Minor] | **수정됨(확인 완료)** | `enums.ts:139-156`에 `complete`가 추가됐고 중복 `synthesize`가 지워졌다. C-6 반영 요청은 spec-gaps api ⑫ |
| QA-S8-04 [Minor] | **수정됨(확인 완료)** | `generate`가 첫 호출의 컨텍스트로 `QuestionsSnapshot {interviewType, insightId, careerSnapshotHash, requirementIds}`를 만들어 partial(재생성 실행도 첫 값 유지)과 단계 출력에 둔다(`job.ts:389-416`). `complete`는 컨텍스트를 다시 만들지 않는다(`job.ts:424-446`) |

## 수정이 건드린 경계 확인
| 경계 | 결과 | 근거 |
|------|------|------|
| partial ↔ 실행기 | 통과 | 실행기는 이번 라운드에 바뀌지 않았다(`runner.ts`·`types.ts` 수정 시각이 1차 그대로). `STEP_CONTINUE`는 단계 재시도 횟수만 비우고 partial은 유지한다. 재시도(`retry_now`/`retry_at`)는 partial과 함께 저장한다. 단계가 성공하면 partial을 지운다(유료 테스트 `meta.partials` undefined). `regen: null`(포기)은 JSON 왕복 뒤에도 null, 시도 전은 키 없음(undefined)으로 구분된다. 병렬 답변의 `persist()`는 실행기의 `partialChain`이 직렬화하고, 같은 `partial` 객체 전체를 쓰므로 서로 덮어써서 빠지는 일이 없다 |
| partial 개인정보 | 통과 | partial에 AI-06 출력(답변 인용·개선 답변 예시)이 들어가지만, `ai_jobs.step_outputs`는 사용자 세션에 grant가 없다(QA-S3-08, `20261028000200_s3a_ai_jobs_v4.sql:143`). `GET /api/ai-jobs/{id}`도 읽지 않는다. 비공개 컬럼(`intent`·`good_answer_signals`) 경로는 1차와 같다 |
| 호출마다 사용 기록(재생성 포함) | 통과 | 재생성은 `${callKey}.regen`로 호출되고 실행기 `onCall`이 1행씩 남긴다. 무료 테스트: 평가 2 + 재생성 2 + 종합 1 = 5행. 재시도된 재생성의 실패 호출도 기록된다(기존 동작) |
| 어댑터 `snapshotContext` ↔ `buildCompleteInterviewQuestionsPayload` | 통과(참고 1건) | 빌더는 `context.aliases.values()`의 `jd_requirement` id, `context.interviewType`, `context.insightId`, `context.base.careerSnapshotHash`만 읽는다(`AI-05.ts:694-699`). 어댑터(`jobs/interview.ts`)가 이 넷을 준다. 통합 테스트가 운영 어댑터로 `complete_interview_questions`까지 통과했다. **참고**: `as unknown as InterviewQuestionContext` 형 변환이라, ai가 빌더에서 다른 필드를 읽기 시작하면 typecheck가 잡지 못한다. api 노트대로 ai가 스냅숏을 직접 받는 함수를 내면 교체하길 권한다(동작 문제가 아니어서 이슈로 열지 않음) |
| 다른 작업 종류 회귀 | 통과 | 실행기·`StepContext`가 이번 라운드에 바뀌지 않았다. 바뀐 파일은 `services/interview/job.ts`, `job.test.ts`, `jobs/interview.ts`, `enums.ts`, `AI-06.ts`(+테스트), `interviews.test.sql`이다. 전체 vitest·pgTAP 통과, S6 insight 작업 테스트 포함 |
| AI-06 분리 함수 계약 | 통과 | `AnswerEvaluationAttempt`가 JSON 직렬화 가능하다(테스트: 왕복 저장 → 다음 단계 재생성). finalize는 오늘의 컨텍스트로 다시 검증하고, 별칭 → 행 id를 다시 매핑한다. 삭제된 근거는 V-1로 빠지고, `answerId`가 다르면 Error를 던진다(`AI-06.test.ts` 분리 단계 3개). 저장 payload 모양은 1차와 같다(통합 테스트의 실제 RPC가 통과) |

## 라운드 요약
- 열린 이슈 없음: Critical 0, Major 0, Minor 0. QA-S8-01~04 모두 수정을 확인했다.
- 검사: typecheck·lint·vitest·build·pgTAP 모두 통과(SKIP 없음).
- 남은 참고 사항(이슈 아님)
  - `snapshotContext` 형 변환 결합: ai가 스냅숏용 빌더를 내면 교체한다.
  - 1차 스펙 차이: `requirement_fit`의 사실 전제 범위(AI 명세 line 1075)는 기획 확인이 필요하다(리더).
