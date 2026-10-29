# S8 모의 면접 (AI-05, AI-06, AI-07) 계획

## 범위와 근거
- 기획 근거
  - DM
    - A.12 `interview_sessions`(v4.1 `question_provider`·`question_model`·`evaluation_provider`·`evaluation_model`)
    - A.13 `interview_questions`, `interview_answers`, `answer_evaluations`, `session_feedbacks`
    - §0 AI 메타, §2.7, §4.1·§4.2(면접 세션 결과 단위), §6.1
  - AI: §4.0~4.3, AI-05, AI-06, AI-07, C-3, C-5, C-6, C-7(금지 주제), C-9, C-11~C-13
  - UX: S-20, S-33, S-22(C-17 점수 표시), S-37, C-14(보드 팝업의 작성 중 세션)
  - PRD: F-P3-01~04, 06, 07, 13, 15, D-14(점수 산식 대기), D-15, D-16, D-36
- 앞 슬라이스 위에 쌓는다
  - S3a 비동기 실행기: S6에서 단계 부분 저장, 이어 실행, 호출 없는 단계 간격 생략을 확장했다.
  - S5: `move_application_stage`의 `interview_prompt`, `loadProgress`, `ensureJdExtracted`
  - S6: 근거 칩 공용 서비스, 인사이트 참고 신호, 재시도 때 행 다시 열기(`run_generation`), `skip locked` 작업 종료 트리거
  - S7: 무료 등급 호출 간격 방식, 별칭 정리
- **이번에 함께 하는 것**: QA-S7-10. AI-04가 보정 대기 중 취소(`AiError("canceled")`)를 다시 던지게 하고 테스트를 추가한다.
- **이번에 하지 않는 것**: 재응시(F-P3-08, Should), 꼬리 질문, 점수 산식(D-14 대기 → 모든 점수는 `pending_method`)
- 연결: UI 없음 → A4 interview "연결 대기"

## 계약 — DB (새 마이그레이션 `20261103xxxxxx_s8_*`)

1. **`interview_sessions`** (A.12)
   - 컬럼은 표 그대로이고 복합 FK cascade다. `unique (application_project_id) where status = 'in_progress'`.
   - 점수 슬롯 컬럼, `answered_count`, `unanswered_count`, `last_activity_at`, 공급자 4개 컬럼을 둔다.
   - RLS
     - select·delete 본인. 그만둔 세션을 포함해 삭제할 수 있다(F-P3-15).
     - insert는 사용자 RPC `create_interview_session(p_application_project_id, p_interview_type, p_question_count, p_data_sufficiency, p_session_id)`만 쓴다.
       - 작성 중 세션이 이미 있으면 `interview_in_progress`(+ 그 세션 id)를 돌려준다.
       - 생성 시 `status = 'in_progress'`, `generation_status = 'generating'`.
     - 사용자 상태 변경은 RPC만 쓴다
       - `abandon_interview_session`: 생성 중이면 진행 중 작업에 취소를 요청한다.
       - `mark_interview_result_viewed`
       - `submit_interview_session`(아래)
   - `answered_count`·`last_activity_at`은 답변 트리거가 유지한다.

2. **`interview_questions`**
   - 컬럼은 표 그대로이고 `sequence`는 세션 안에서 unique다.
   - **비공개 컬럼**(`intent`, `good_answer_signals`)은 클라이언트에 grant하지 않는다.
     - `intent`는 제출 후 결과 화면에서 공개한다. 서버 조회 함수 `get_interview_question_reveals(p_session_id)`(definer, 본인, `submitted_at is not null`일 때만)로 준다.
     - `good_answer_signals`는 사용자에게 보이지 않는다.
   - 질문 근거: `evidence_links`(`owner_type = 'interview_question'`)

3. **`interview_answers`**
   - 질문 저장 시 빈 행(`draft`)을 함께 만든다.
   - 사용자 update는 `answer_text`(≤ 5,000)만 허용한다. 조건: `status = 'draft'`이고, 세션 `submitted_at is null`이고, `generation_status = 'ready'`. RLS나 트리거로 강제한다.
   - 점수 슬롯 5개 컬럼은 사용자가 쓸 수 없다.

4. **`answer_evaluations`, `session_feedbacks`**
   - 표 그대로이고 공통 AI 메타를 둔다.
   - `result`에는 근거 배열을 넣지 않는다. 근거는 `evidence_links`(`answer_evaluation`, `session_feedback`)에 넣는다.

5. **RPC**
   - **사용자**
     - `create_interview_session`, `abandon_interview_session`, `mark_interview_result_viewed`
     - `submit_interview_session(p_session_id) returns jsonb` — 1회만 가능하고 한 트랜잭션에서 한다.
       - 공백뿐인 답변은 `unanswered` + `score_status = 'unanswered'`, 나머지는 `submitted`로 둔다.
       - 세션: `submitted_at`, `unanswered_count`, `answered_count`, `status = 'evaluating'`. 응답이 0개면 바로 `completed` + `score_status = 'not_scored'`.
       - 반환: 응답된 답변 id 목록
   - **app_ai_writer** (소유·세대 검사, S6/S7 방식)
     - 질문 생성
       - `begin_interview_questions(p_session_id, p_ai_job_id)`
       - `save_interview_question(p_session_id, p_ai_job_id, p_run_generation, p_payload)`: 질문 1개, 근거, 빈 답변을 넣고 멱등이다(`sequence` 기준).
       - `complete_interview_questions(…, p_payload)`: `weak_requirement_ids`, `question_provider`·`question_model`, 공통 메타, `generation_status = 'ready'`, `insight_id`, `career_snapshot_hash`
       - `fail_interview_questions`: `generation_status = 'failed'`. 저장된 질문은 유지한다.
     - 채점
       - `begin_interview_evaluation(p_session_id, p_ai_job_id, p_provider, p_model)`: `evaluation_provider`·`evaluation_model`을 기록하고, 다시 채점하면 덮어쓴다.
       - `save_answer_evaluation(p_answer_id, p_ai_job_id, p_run_generation, p_payload)`: 평가와 근거를 넣고, 답변 `score_status = 'pending_method'`. 다시 채점하면 교체한다.
       - `fail_answer_evaluation(p_answer_id, p_ai_job_id)`: `not_scored`
       - `save_session_feedback(…)`
       - `complete_interview_evaluation(…)`
         - 세션 `completed`, 세션 점수 `pending_method`, `score_counted_count`.
         - 모든 답변의 평가가 실패했으면 `evaluation_failed`.
         - 종합 피드백만 실패했으면 `evaluation_failed` `[가정]`.
   - 작업 종료 트리거(`skip locked`)
     - 질문 생성이 성공하지 못하고 끝나면 `generation_status = 'failed'`.
     - 채점이 성공하지 못하고 끝나면 `status = 'evaluation_failed'`. 이미 저장된 답변 평가는 보존한다.
   - 재시도 때 실패 행을 다시 여는 규칙은 S6 `run_generation` 방식을 따른다.
   - **S5 확장**: `move_application_stage`의 `interview_prompt.in_progress_session_id`를 채운다. 작성 중 세션이 있으면 그 id와 유형, `answered_count`/`question_count`를 넣는다.

6. **`ai_jobs`**: `interview_questions`·`interview_evaluation`은 `target_type = 'interview_session'`이다. 기존 CHECK가 허용하는지 확인한다.

7. **커리어 삭제 영향 (§4.2)**
   - `by_application_project[].interview_sessions`를 채운다. 집계는 질문·평가·피드백 근거(`evidence_links`)를 통해 한다.
   - `delete_career_item`의 `delete_results`는 해당 면접 세션을 삭제한다(결과 단위 "면접 세션"). 진행 중 작업에는 취소를 요청한다.

8. **grants·pgTAP**
   - 허용 목록, RLS 교차 사용자, 비공개 컬럼 grant 없음과 제출 후에만 공개
   - 작성 중 세션 1개, 답변 편집 조건, 제출(미응답·0개)
   - 생성·채점 begin/save/complete/fail과 세대, 트리거
   - 보드 팝업 `in_progress_session_id`, 삭제 영향, 첫 호출 권한

## 계약 — AI (`src/server/ai/`)

1. **AI-05** `pipelines/AI-05.ts` `streamInterviewQuestions({ type, count, dataSufficiency, pack, requirements, cultureSentences, insightSignal?, recentQuestions, existingQuestions? }, deps)`
   - 기본 등급이고, 질문이 완성될 때마다 `onQuestion(payload)`를 부른다(서버가 바로 저장).
   - **검증**
     - 유형별 구성 규칙(4.1 표: `source_kind` 최소 개수, 컬처핏 주제 중복 규칙, `motivation_career` 포함)
     - 중복 규칙(같은 프로젝트 최대 2, 같은 상세 내용 1, 같은 요건 1)
     - V-1~V-3, V-5(질문 문장 속 수치)
     - V-8: 회고를 직무 질문의 사실 전제로 쓰지 않는다. 컬처핏 `experience` 앵커에서는 회고 인용 형태로만 쓴다.
     - 금지 주제(C-7)
     - 컬처핏 `anchor` 검증
       - `experience` 앵커는 경력 근거가 필수이고, `jd` 앵커는 `jd_sentence`가 필수다.
       - 앵커가 `experience`가 아니면 질문 문장에 경력 팩의 고유명사·숫자를 쓰지 않는다.
       - 직무 질문의 앵커는 `experience` 또는 `jd`만 쓴다.
     - 별칭 정리
   - 규칙 위반: 질문 단위로 판정할 수 있으면 그 질문만 버리고 남은 개수를 다시 생성한다. 세트 구성 위반은 1회 재생성하고, 그래도 위반이면 경고 로그를 남기고 진행한다(카드 `[가정]`).
   - **남은 질문 다시 만들기**: `existingQuestions`를 입력에 넣어 중복을 막고 남은 개수만 만든다.
   - `weak_requirement_refs`는 UUID로 바꾼다.
   - `data_sufficiency`는 서버가 판정한다(readiness).
2. **AI-06** `pipelines/AI-06.ts` `evaluateAnswer({ type, dataSufficiency, pack, requirements, cultureSentences, question(+근거), answer }, deps)`
   - 기본 등급, 중간 사고 설정, 구조화 출력.
   - **검증**
     - `criteria` 4키가 모두 있어야 한다. `not_applicable`은 `job_relevance`에만 허용한다.
     - 등급마다 `answer_quotes` 1개 이상 또는 `missing`이 있어야 한다.
     - `answer_quotes`는 답변의 부분 문자열이어야 한다(V-3 정규화, 실패한 인용은 제거).
     - 개선 답변 예시
       - V-5를 적용한다.
       - 데이터 밖 사실은 `suggestions_if_true`로 분리한다.
       - 근거 검증을 거친다.
       - 컬처핏 데이터 부족 시 `[사례 입력 필요]` 규칙을 따른다.
     - `consistency_notes`는 직무, 그리고 데이터가 `ok`인 컬처핏에서만 남긴다.
     - `score`는 항상 `pending_method`로 서버가 덮어쓴다.
   - 근거 `item_key`: `criteria.<key>`, `improvements.n`, `model_answer`
3. **AI-07** `pipelines/AI-07.ts` `summarizeSession({ questions, evaluations(개선 답변 예시 제외), unansweredRefs, type, dataSufficiency, weakRequirements, criteriaSummary }, deps)`
   - `question_refs`는 이 세션 질문만 남긴다(V-1).
   - 미응답 질문의 내용 언급을 막는다(미응답 ref는 강점·약점에 쓸 수 없다).
   - `criteria_summary`는 서버가 계산한다.
   - 세션 점수는 `pending_method`, `counted_questions`·`unanswered_count`는 서버 값이다.
4. **프롬프트**
   - `ai-05.generate.v1`(직무·컬처핏 역할 분리, 유형별 few-shot 1쌍), `ai-06.evaluate.v1`(유형별 루브릭), `ai-07.summarize.v1`
   - 답변은 데이터 블록으로 넣고, 답변 속 지시는 따르지 않는다.
5. **QA-S7-10**: `AI-04.ts`의 보정 오류 처리에서 `isAiError(err) && err.code === 'canceled'`도 다시 던진다. 테스트를 추가한다.
6. **fixtures·테스트**
   - 직무 5문항(구성 규칙)
   - 컬처핏 `none`(사실 가정 금지)
   - 금지 주제가 섞인 출력
   - 인용 불일치
   - 수치 날조 개선 답변
   - 답변 속 지시문
   - 응답 0개·1개 종합

## 계약 — API

1. **작업 정의**
   - `interview_questions` (`target_type = 'interview_session'`, 기본 등급)
     - 단계
       - `prepare`: 필요하면 `ensureJdExtracted`를 먼저 하고(D-30), `begin_interview_questions`를 부른다.
       - `generate`: 스트림으로 질문을 저장할 때마다 진행 `{generate, done, total}`을 갱신한다. 실패하면 저장된 질문을 유지하고, 재시도는 남은 개수만 만든다.
       - `complete`
     - 함수 한 번이 60초를 넘지 않게 한다. 7문항이 넘을 수 있으면 남은 개수 이어 실행을 쓴다.
   - `interview_evaluation`
     - 단계
       - `prepare`: `begin_interview_evaluation`
       - `evaluate`: 유료 등급은 응답된 답변을 병렬로 평가하고, 성공하는 대로 저장한다(S6 QA 교훈). 무료 등급은 답변 1개 = 단계 1개이고 6초 간격이다.
       - `summarize`: AI-07
       - `score`: D-14 전이라 아무것도 하지 않는다.
       - `complete`
     - 답변 일부가 끝내 실패하면 그 답변은 `not_scored`로 두고 AI-07은 나머지로 진행한다.
2. **라우트**
   - `POST /api/application-projects/[id]/interview-sessions` — 입력 `{ interviewType, questionCount }`
     - readiness
       - 직무: `job_interview.ready`가 아니면 422 + readiness
       - 컬처핏: 항상 허용하고 `data_sufficiency`를 저장한다.
     - 실행 게이트 → 작성 중 세션이 있으면 409 `interview_in_progress` + `details.sessionId` → 세션 생성 → 질문 작업 시작 → `{ sessionId, jobId }`
   - `POST /api/interview-sessions/[id]/questions/retry`: 남은 질문 다시 만들기. 생성 실패 상태일 때만.
   - `POST /api/interview-sessions/[id]/submit`: 실행 게이트(키 필요) → `submit_interview_session` → 응답이 1개 이상이면 채점 작업 시작 → `{ jobId | null }`
   - `POST /api/interview-sessions/[id]/evaluation/retry`: 다시 채점. 채점 실패, 또는 `not_scored` 답변이 있을 때만이고, 실패한 답변과 종합만 다시 한다.
   - 상태 조회·취소는 기존 `/api/ai-jobs/[id]`를 쓴다.
3. **Server Actions (키 불필요)**: `saveInterviewAnswer`(자동 저장), `abandonInterviewSession`, `deleteInterviewSession`, `markInterviewResultViewed`
4. **조회**
   - `getInterviewPrep(applicationProjectId)` (S-20): 작성 중 세션 배너, 이 프로젝트 세션 목록, readiness, 연결 상태
   - `getAnswerSheet(sessionId)` (S-33): 질문(비공개 컬럼 제외), 답변, 편집 가능 여부, 생성 진행·실패
   - `getInterviewResult(sessionId)` (S-22)
     - C-17 점수 슬롯, 답변별 평가, 공개된 `intent`, 근거 칩, 종합
     - "다룬 보완 요건" 내용, 채점 공급자 배지, 채점 실패 답변
     - 처음 열면 `mark_interview_result_viewed`
   - `listInterviewSessions(filters)` (S-37)
     - 필터: 기업 JD·유형·상태·실행 공급자
     - 정렬: 작성 중은 맨 위, 그만둠은 아래 묶음
     - 실행 공급자 표시 규칙: 채점이 시작됐으면 `evaluation_*`, 아니면 `question_*`. 둘이 다르면 둘 다 보인다.
   - "생성 중·채점 중인데 작업이 끝난 행"은 실패로 본다(S6·S7 규칙).
5. **진행 표시**: `loadProgress`의 `interviewCount`, `interviewInProgress`
6. **테스트**
   - 단위: 질문 스트림 저장과 진행, 생성 일부 실패 → 남은 개수, 제출 0개, 유료 병렬과 무료 순차 채점, 답변 일부 실패, 다시 채점, 키 삭제 후 답변 보존(D-36), 취소
   - 로컬 DB 통합: 생성 → 답변 → 제출 → 채점 → 결과 공개, 보드 팝업 세션 id, 삭제 영향, 프로젝트 삭제 연쇄

## 팀 작업과 의존
| 담당 | 작업 | 의존 |
|------|------|------|
| db-engineer | 마이그레이션 1~8, pgTAP, 타입, 노트(시그니처·payload 먼저) | 없음 |
| ai-pipeline-engineer | AI-05·06·07 스키마·프롬프트·파이프라인·검증·payload 매퍼·fixtures, QA-S7-10 | payload는 db 노트 |
| api-engineer | 작업 2종, 라우트 4개, 액션, 조회, 진행 표시, 테스트 | ai·db 노트, 타입 |
| backend-qa | 점진 → 전체(최대 2라운드) | 각 모듈 |

## 원격 브랜치
적용하지 않는다.

## `[가정]` (spec-gaps에 기록)
1. 종합 피드백(AI-07)만 실패하면 세션을 `evaluation_failed`로 두고, 다시 채점은 종합만 다시 한다.
2. 답변 일부만 실패하면 세션은 `completed`이고, 그 답변은 `not_scored` + "다시 채점"이다.
3. 질문 단위 규칙 위반은 그 질문만 버리고 남은 개수를 다시 생성한다. 세트 구성 위반은 1회 재생성 후 경고하고 진행한다.
4. 세션은 그만둔 것을 포함해 하나씩 삭제할 수 있다.
5. 작성 중 세션이 있으면 새 세션을 만들 수 없다(409, 이어 쓰기 안내). 지원 프로젝트당 작성 중 세션은 1개다.
