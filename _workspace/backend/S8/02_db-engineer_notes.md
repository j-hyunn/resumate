# S8 DB 구현 노트 (db-engineer)

> 상태: **구현 완료**. `supabase db reset` 통과, `supabase test db` 41파일 1966개 모두 통과(QA-S8-02 반영), `database.types.ts` 재생성. 커밋·원격 적용 없음.
> 아래 시그니처·payload는 작업 중 먼저 공개한 내용과 같다(바뀐 것 없음).

## RPC 시그니처와 반환 형태 (api·ai 먼저 볼 것)

공통
- 오류는 `errcode = 'P0001'`, `message` = 소문자 코드. 미인증은 `42501 not_authenticated`.
- 사용자 RPC는 **authenticated 전용**, security definer + `auth.uid()` 소유 검사. 키 불필요(AI 호출 없음).
- AI RPC는 **app_ai_writer 전용**, security definer + `private.current_uid()` 소유 검사.
- 잠금 순서: 지원 프로젝트 → (제출만: 답변) → `interview_sessions` → 질문·답변·평가. 작업 종료 트리거는 프로젝트·세션을 `skip locked`.
- `interview_session_not_found` / `interview_answer_not_found`는 세션(또는 프로젝트) 삭제도 뜻한다 → api는 canceled처럼 처리.
- 작업 모양: 질문 생성 `job_type = 'interview_questions'`, 채점 `job_type = 'interview_evaluation'`. 둘 다 `target_type = 'interview_session'`, `target_id` = 세션 id, `application_project_id` = 세션의 지원 프로젝트. `ai_jobs`는 `target_type` CHECK가 없어 그대로 허용된다. 동시 실행 1개는 기존 `ai_jobs_in_flight_target_key`(같은 세션·같은 작업 종류)가 막는다(23505).

### 1. 사용자 RPC (authenticated)

```sql
create_interview_session(p_application_project_id uuid, p_interview_type text, p_question_count integer,
                         p_data_sufficiency text, p_session_id uuid default null) returns jsonb
-- {session_id, application_project_id, interview_type, question_count, data_sufficiency,
--  status:'in_progress', generation_status:'generating', created:boolean}
```
- `p_interview_type` ∈ `job`/`culture_fit`, `p_question_count` ∈ 3/5/7(null → 5), `p_data_sufficiency` ∈ `ok`/`thin`/`none`(서버가 readiness로 판정한 값).
- 이 프로젝트에 작성 중(`in_progress`) 세션이 있으면 **`interview_in_progress`, `detail` = 그 세션 id(uuid 문자열)** → api 409 + `details.sessionId`.
- `p_session_id`(선택, 멱등): 같은 id의 본인 세션이 이 프로젝트에 이미 있으면 그대로 돌려준다(`created:false`). 다른 사용자·프로젝트 것이면 `session_id_conflict`.
- 지원 프로젝트 `last_activity_at = now()`.
- 오류: `application_project_not_found`, `invalid_interview_type`, `invalid_question_count`, `invalid_data_sufficiency`, `interview_in_progress`, `session_id_conflict`.

```sql
abandon_interview_session(p_session_id uuid) returns jsonb
-- {session_id, status:'abandoned', abandoned_at, changed:boolean, cancel_requested:integer}
```
- `in_progress`(생성 중·생성 실패·답변 작성 중 모두)만. 이미 `abandoned`면 `changed:false`.
- 이 세션의 queued/running `interview_questions` 작업에 `cancel_requested_at = now()`(숫자 = 표시한 작업 수). 생성 상태는 작업 종료 트리거가 `failed`로 바꾼다.
- 오류: `interview_session_not_found`, `interview_not_in_progress`(제출 후).

```sql
mark_interview_result_viewed(p_session_id uuid) returns jsonb
-- {session_id, result_viewed_at (timestamptz|null), changed:boolean}
```
- `status = 'completed'`이고 `result_viewed_at is null`일 때만 기록(`changed:true`). 그 밖은 아무것도 안 함(오류 아님). 다시 채점이 시작되면 `begin_interview_evaluation`이 `result_viewed_at = null`로 되돌린다(새 결과 표식) `[가정]`.
- 오류: `interview_session_not_found`.

```sql
submit_interview_session(p_session_id uuid) returns jsonb
-- {session_id, status:'evaluating'|'completed', submitted_at, answered_count, unanswered_count,
--  answered_answer_ids: uuid[], evaluation_needed:boolean}
```
- 조건: `status = 'in_progress'`, `generation_status = 'ready'`, `submitted_at is null`. 1회만.
- 한 트랜잭션: 공백뿐인 답변(`answer_text !~ '\S'`) → `status = 'unanswered'`, `score_status = 'unanswered'` / 나머지 → `status = 'submitted'`(`score_status`는 null, 평가 저장 때 채움).
- 세션: `submitted_at`, `answered_count`, `unanswered_count`, `last_activity_at`, `status = 'evaluating'`. 응답 0개면 `status = 'completed'`, `completed_at`, `score_status = 'not_scored'`, `score_counted_count = 0`, `evaluation_needed:false`(채점 작업을 만들지 않는다).
- 지원 프로젝트 `last_activity_at = now()`.
- 오류: `interview_session_not_found`, `interview_already_submitted`, `interview_not_in_progress`(그만둔 세션), `interview_not_ready`(생성 중·생성 실패).

```sql
get_interview_question_reveals(p_session_id uuid) returns table (question_id uuid, sequence integer, intent text)
```
- 제출 후(`submitted_at is not null`) 본인 세션의 질문 `intent`를 `sequence` 순으로. `good_answer_signals`는 어떤 사용자 경로로도 나가지 않는다.
- 오류: `interview_session_not_found`, `interview_not_submitted`.

직접 쓰기 (RLS·column grant)
- `interview_sessions`: delete 본인(어느 상태든, F-P3-15). 삭제하면 그 세션 대상 queued/running 작업(질문·채점)에 `cancel_requested_at`이 기록된다(트리거).
- `interview_answers`: update(`answer_text`)만, ≤ 5000자. **조건(RLS)**: 답변 `status = 'draft'` + 세션 `status = 'in_progress'` + `submitted_at is null` + `generation_status = 'ready'`. 조건 밖이면 RLS가 행을 걸러 **0행 update(오류 아님)** → api는 0행이면 세션 상태를 읽어 이유를 돌려준다.
  - 답변 수정 트리거가 세션 `answered_count`(공백 아닌 답변 수)·`last_activity_at`을 갱신한다.
- `interview_questions`: 사용자 select는 **`intent`, `good_answer_signals`를 뺀 컬럼만** 가능하다 → `select('*')` 금지, 컬럼을 나열해야 한다(아래 목록).
  - 사용자 select 가능 컬럼: `id, user_id, session_id, sequence, source_kind, anchor, question_text, focus_criteria, target_requirement_ids, target_gap_requirement_ids, copied_from_question_id, ai_job_id, schema_version, prompt_version, provider, model, model_tier, connection_tier, created_at, updated_at`.

### 2. 질문 생성 — app_ai_writer RPC

```sql
begin_interview_questions(p_session_id uuid, p_ai_job_id uuid) returns jsonb
-- {session_id, application_project_id, interview_type, question_count, data_sufficiency,
--  generation_status:'generating', reopened:boolean, saved_count, remaining, next_sequence,
--  existing_questions:[{question_id, sequence, source_kind, anchor, question_text,
--                       target_requirement_ids, target_gap_requirement_ids}]}
```
- 세션 `generation_status = 'generating'`, `question_job_id`·실행 세대 기록. 이미 저장된 질문은 그대로 둔다 → `existing_questions`를 AI-05 입력(`existingQuestions`)에 넣고 `remaining`개만 만든다. 새 질문은 비어 있는 sequence(1..question_count)를 쓴다(`next_sequence` = 비어 있는 가장 작은 번호).
- 같은 작업이 이미 열었으면 그대로(멱등). 같은 작업의 `failed` + 작업 queued/running + 세션의 질문 실행 세대 < 작업 세대면 다시 연다(`reopened:true`, S6 QA-S6-01). 생성 실패 세션에 새 작업(남은 질문 다시 만들기)이 오면 다시 연다(`reopened:true`).
- 다른 작업이 생성 중: 그 작업이 queued/running이면 `interview_generation_in_progress`, 끝났거나 없으면 인계.
- 오류: `interview_session_not_found`, `invalid_ai_job`(작업 모양·상태), `jd_not_extracted`, `interview_not_in_progress`(그만둠·제출됨), `interview_questions_ready`(이미 생성 완료), `interview_generation_in_progress`.

```sql
save_interview_question(p_session_id uuid, p_ai_job_id uuid, p_run_generation integer, p_payload jsonb) returns jsonb
-- 반영: {applied:true, created:boolean, question_id, answer_id, sequence, saved_count, question_count}
-- 무시: {applied:false, reason:'stale_run'}
```
- 질문 1개 + 근거(`evidence_links` owner_type `interview_question`) + 빈 답변 행(`draft`, `answer_text = ''`)을 한 트랜잭션에.
- **멱등(sequence 기준)**: 같은 sequence의 질문이 이미 있으면 아무것도 쓰지 않고 그 행을 돌려준다(`created:false`).
- `stale_run`: 작업이 `running`이 아님, 세대 불일치, 세션이 `generating`이 아니거나 `question_job_id`가 다른 작업. 단 세션이 이 작업의 `failed`이고 질문 실행 세대 < `p_run_generation`이면 다시 열고 반영(S6 QA-S6-01 — 재시도가 prepare를 건너뛴 경우).
- 오류: `interview_session_not_found`, `invalid_ai_job`, `invalid_ai_metadata`, `invalid_interview_payload`, `invalid_evidence_source`.

```sql
complete_interview_questions(p_session_id uuid, p_ai_job_id uuid, p_run_generation integer, p_payload jsonb) returns jsonb
-- 반영: {applied:true, session_id, generation_status:'ready', question_count, question_provider, question_model}
-- 무시: {applied:false, reason:'stale_run'}
```
- 저장된 질문 수가 `question_count`와 같아야 한다(아니면 `interview_questions_incomplete`).
- 세션: `generation_status = 'ready'`, `question_provider`(= 작업 provider), `question_model`(= meta.model), `weak_requirement_ids`, `insight_id`, `career_snapshot_hash`, `last_activity_at`. 지원 프로젝트 `last_activity_at`.
- 순서: `complete_interview_questions` → `complete_ai_job`. `stale_run`이면 `complete_ai_job`을 부르지 않는다.
- 오류: `interview_session_not_found`, `invalid_ai_job`, `invalid_ai_metadata`, `invalid_interview_payload`, `interview_questions_incomplete`.

```sql
fail_interview_questions(p_session_id uuid, p_ai_job_id uuid) returns boolean
```
- 세션이 `generating`이고 `question_job_id = p_ai_job_id`일 때만 `generation_status = 'failed'`, true. 저장된 질문·빈 답변은 유지(D-36). 아니면 false. 오류: `interview_session_not_found`.

### 3. 채점 — app_ai_writer RPC

```sql
begin_interview_evaluation(p_session_id uuid, p_ai_job_id uuid, p_provider text, p_model text) returns jsonb
-- {session_id, application_project_id, interview_type, data_sufficiency, status:'evaluating', reopened:boolean,
--  answers_to_evaluate:[{answer_id, question_id, sequence}],   -- 이번에 AI-06을 부를 답변(평가 성공이 없는 submitted)
--  evaluated_answer_ids: uuid[],                                -- 이미 평가 성공(보존, AI-07 입력에는 포함)
--  unanswered_answer_ids: uuid[],
--  feedback_needed:boolean}                                     -- 항상 true (답변 평가가 바뀌면 종합도 다시)
```
- `p_provider` = 작업 provider여야 한다(`invalid_ai_metadata`), `p_model` 1~200자. 세션 `evaluation_provider`·`evaluation_model`을 덮어쓴다(다시 채점 포함).
- 열 수 있는 세션: `evaluating`(제출 직후, 또는 같은 작업 멱등), `evaluation_failed`(다시 채점), `completed`인데 평가 성공이 없는 submitted 답변이 있음(`not_scored` 다시 채점). 다시 열면 `status = 'evaluating'`, `score_status = null`, `result_viewed_at = null`.
- 같은 작업 멱등 / 수동 재시도(세대 증가) 재오픈 / 다른 작업 진행 중이면 `interview_evaluation_in_progress`, 끝난 작업이면 인계 — 질문 생성과 같은 규칙.
- 오류: `interview_session_not_found`, `invalid_ai_job`, `invalid_ai_metadata`, `interview_not_submitted`(작성 중·그만둠), `interview_evaluation_not_needed`(completed이고 다시 할 답변 없음), `interview_evaluation_in_progress`.

```sql
save_answer_evaluation(p_answer_id uuid, p_ai_job_id uuid, p_run_generation integer, p_payload jsonb) returns jsonb
-- 반영: {applied:true, evaluation_id, answer_id, session_id, status:'succeeded', evidence_count, completed_at}
-- 무시: {applied:false, reason:'stale_run'}
```
- `answer_evaluations` 행(answer_id unique)을 만들거나 **같은 행을 교체**(다시 채점), 그 평가의 기존 근거를 지우고 새로 넣는다(owner_type `answer_evaluation`). 답변 `score_status = 'pending_method'`(값·만점·버전·설명 null — D-14 전).
- 답변이 `submitted`가 아니면(미응답) `answer_not_evaluable`.
- `stale_run` 규칙: 질문 생성과 같음(행 기준 = 세션의 `evaluation_job_id`·채점 실행 세대).
- 오류: `interview_answer_not_found`, `invalid_ai_job`, `invalid_ai_metadata`, `invalid_interview_payload`, `invalid_evidence_source`, `answer_not_evaluable`.

```sql
fail_answer_evaluation(p_answer_id uuid, p_ai_job_id uuid) returns boolean
```
- 세션이 `evaluating`이고 `evaluation_job_id = p_ai_job_id`, 작업 `running`, 답변 `submitted`, 그 평가가 아직 `succeeded`가 아닐 때만: 평가 행 `failed`(없으면 만든다) + 답변 `score_status = 'not_scored'`, true. 아니면 false. 오류: `interview_answer_not_found`.

```sql
save_session_feedback(p_session_id uuid, p_ai_job_id uuid, p_run_generation integer, p_payload jsonb) returns jsonb
-- 반영: {applied:true, feedback_id, session_id, status:'succeeded', evidence_count, completed_at}
-- 무시: {applied:false, reason:'stale_run'}
```
- `session_feedbacks` 행(session_id unique)을 만들거나 교체, 근거 교체(owner_type `session_feedback`). 응답 답변이 0개인 세션은 `invalid_interview_payload`가 아니라 애초에 채점 작업이 없다.
- 오류: `interview_session_not_found`, `invalid_ai_job`, `invalid_ai_metadata`, `invalid_interview_payload`, `invalid_evidence_source`.

```sql
complete_interview_evaluation(p_session_id uuid, p_ai_job_id uuid, p_run_generation integer) returns jsonb
-- 반영: {applied:true, session_id, status:'completed'|'evaluation_failed', score_status, score_counted_count,
--        not_scored_answer_ids: uuid[], completed_at}
-- 무시: {applied:false, reason:'stale_run'}
```
- 평가 성공이 없는 submitted 답변 → `score_status = 'not_scored'`(평가 행이 `pending`이면 `failed`).
- 평가 성공이 1개 이상 **그리고** 종합 피드백 `succeeded` → `completed`, `completed_at`, 세션 `score_status = 'pending_method'`, `score_counted_count` = 평가 성공 답변 수.
- 그 밖(모든 답변 평가 실패, 또는 종합만 실패 `[가정]`) → `evaluation_failed`, 세션 `score_status = 'not_scored'`. 저장된 평가는 보존.
- 순서: api는 `applied:true`이고 `status = 'completed'`면 `complete_ai_job`, `evaluation_failed`면 작업을 실패로 끝낸다(원인 오류 코드). `stale_run`이면 작업을 건드리지 않는다.
- 오류: `interview_session_not_found`, `invalid_ai_job`.

### 4. 작업 종료 트리거 `ai_jobs_release_interview`
- `interview_questions` 작업이 `failed`(sweep `stalled` 포함)·`canceled`·`succeeded`로 끝났는데 세션이 아직 그 작업의 `generating`이면 → `generation_status = 'failed'`(질문 보존).
- `interview_evaluation` 작업이 끝났는데 세션이 아직 그 작업의 `evaluating`이면 → `evaluation_failed` + 세션 `score_status = 'not_scored'`, 평가 성공이 없는 submitted 답변 → `not_scored`. 저장된 평가는 보존.
- 프로젝트·세션 행을 `skip locked`로 잡고, 못 잡으면 아무것도 하지 않는다(S6·S7과 같음). **api 조회는 "`generating`/`evaluating`인데 그 작업(`question_job_id`/`evaluation_job_id`)이 queued/running이 아니거나 없음"을 실패로 보여야 한다.** 다음 begin이 정리한다.

### 5. 보드 팝업 (S5 확장)
`move_application_stage(...)`의 `interview_prompt`(인터뷰 열로 옮길 때만):
```jsonc
{ "interview_type": "job" | "culture_fit",          // 옮긴 열의 유형
  "in_progress_session_id": "<uuid>" | null,         // 이 프로젝트의 작성 중 세션(유형 무관, 최대 1개)
  "in_progress_session": { "session_id", "interview_type", "answered_count", "question_count",
                           "generation_status", "last_activity_at" } | null }
```

### 6. 커리어 삭제 영향 (§4.2)
- `get_deletion_impact` `by_application_project[].interview_sessions` = 질문(`interview_question`)·답변 평가(`answer_evaluation`)·종합(`session_feedback`) 근거가 삭제될 커리어 행(연쇄분 포함)을 가리키는 서로 다른 세션 수.
- `delete_career_item(..., 'delete_results')`: 그 세션을 지운다(질문·답변·평가·종합·근거 연쇄). 세션 대상 queued/running 작업에는 삭제 트리거가 취소를 요청한다.

### Payload 모양

#### 공통 meta / hashes / evidence 원소 (S6·S7과 같음)
```jsonc
"hashes": { "input_hash": "…", "career_snapshot_hash": "…" },     // 각 1~128자
"meta": { "schema_version": 2, "prompt_version": "ai-05.generate.v1+common.v1",
          "provider": "gemini", "model": "…", "model_tier": "default", "connection_tier": "free",  // 작업과 같아야 함
          "validation_report": { … } | null, "usage": { … } | null },
"evidence": [ { "item_key": "…", "sort_order": 0, "source_type": "…", "source_id": "<uuid>",
                "source_field": "action" | null, "quote": "…" | null, "quote_adjusted": false,
                "source_locator": {…} | null, "source_snapshot_at": "…" | null, "source_label": "…" | null } ]  // 0~2000
```
- 원소의 `owner_type`·`owner_id`·`application_project_id`·`user_id`는 무시(RPC가 채움).

#### `save_interview_question.p_payload`
```jsonc
{
  "sequence": 1,                                  // 정수 1..question_count (AI order)
  "source_kind": "project_deep_dive",             // 직무: project_deep_dive|requirement_fit|gap_probe
                                                  // 컬처핏: collaboration|conflict|failure_growth|values|org_adaptation|motivation_career
  "anchor": "experience",                         // experience|jd|general (직무는 experience|jd만)
  "question_text": "…",                           // 1~1000자 [가정]
  "intent": "…",                                  // 1~1000자 [가정], 비공개
  "focus_criteria": ["specificity", "intent_fit"],// specificity|intent_fit|structure|job_relevance, 0~4, 중복 없음
  "target_requirement_ids": ["<uuid>"],           // 0~20, 이 지원 프로젝트 JD 요건만
  "target_gap_requirement_ids": ["<uuid>"],       // 0~20, 같음
  "good_answer_signals": ["…"],                   // 문자열 배열 0~10, 각 1~300자 [가정], 비공개
  "hashes": { … }, "meta": { … },
  "evidence": [ … ]                               // item_key 자유(권장 "question"), 출처: 커리어 7종 + jd_requirement + jd_sentence
}
```
- **직무 면접은 `project_detail.learnings` 근거를 거부**(V-8 DB 방어). 컬처핏은 허용(회고 인용).
- AI 메타는 질문 행에 저장(`ai_job_id`, `run_generation`, provider·tier는 작업에서, `model`·`prompt_version`·`schema_version`·해시·`validation_report`·`usage`는 payload에서).

#### `complete_interview_questions.p_payload`
```jsonc
{
  "weak_requirement_ids": ["<uuid>"],             // 0~50, 이 프로젝트 요건만 (weak_requirement_refs 변환값)
  "insight_id": "<uuid>" | null,                  // 참고한 인사이트(이 프로젝트의 ready 행)만
  "career_snapshot_hash": "…",                    // 1~128자
  "meta": { "provider", "model", "model_tier", "connection_tier", … }  // provider·tier는 작업과 같아야 함
}
```
- 세트 단위 `validation_report`·`usage`는 저장 자리가 없어 무시한다(사용량 원천은 `ai_usage_records`).

#### `save_answer_evaluation.p_payload`
```jsonc
{
  "result": { "schema_version": 2, "criteria": [...], "strengths": [...], "improvements": [...],
              "intent_reveal": "…", "model_answer": {...}, "consistency_notes": [...],
              "score": { "status": "pending_method", … } },     // object. 어느 깊이에도 "evidence" 키 금지(C-3)
  "hashes": { … }, "meta": { … },
  "evidence": [ … ]   // item_key 예: criteria.specificity / improvements.0 / model_answer
                      // 출처: 커리어 7종 + jd_requirement + jd_sentence + interview_answer(source_id = 이 세션 답변 id)
}
```

#### `save_session_feedback.p_payload`
```jsonc
{
  "result": { "headline": "…", "overall_strengths": [...], "overall_weaknesses": [...], "next_practice": [...],
              "criteria_summary": [...], "unanswered_note": "…" | null, "session_score": {...} },  // object, "evidence" 키 금지
  "hashes": { … }, "meta": { … },
  "evidence": [ … ]   // 출처는 답변 평가와 같음
}
```
- `interview_answer` 근거는 `source_field = null`이어야 한다(DM CHECK). 다른 지원 프로젝트 답변이면 `invalid_evidence_source`.

---

## 마이그레이션 파일
| 파일 | 내용 |
|------|------|
| `supabase/migrations/20261103000100_s8_interview_tables.sql` | 5개 테이블 + CHECK·복합 FK·인덱스·RLS·grant, `updated_at`, 소유 근거 삭제 트리거 3개, 답변 출처 삭제 트리거, 답변 수정 → `answered_count`·`last_activity_at` 트리거, 세션 삭제 → 작업 취소 요청 트리거, service_role 쓰기 회수 |
| `supabase/migrations/20261103000200_s8_evidence_interview_answer_source.sql` | `evidence_links_check_source`에 `interview_answer` 분기(나머지는 S7 그대로) |
| `supabase/migrations/20261103000300_s8_interview_user_rpcs.sql` | `create/abandon_interview_session`, `mark_interview_result_viewed`, `submit_interview_session`, `get_interview_question_reveals`, 헬퍼 `interview_cancel_jobs` |
| `supabase/migrations/20261103000400_s8_interview_question_rpcs.sql` | 공용 헬퍼(잠금, 작업 일치, 요건 id 검사, 근거 검사·insert, 실행 상태), `begin/save/complete/fail_interview_questions`, `interview_questions_mark_failed` |
| `supabase/migrations/20261103000500_s8_interview_evaluation_rpcs.sql` | `begin_interview_evaluation`, `save/fail_answer_evaluation`, `save_session_feedback`, `complete_interview_evaluation`, 헬퍼, 작업 종료 트리거 `ai_jobs_release_interview` |
| `supabase/migrations/20261103000600_s8_move_application_stage_interview.sql` | `move_application_stage` 재정의(`interview_prompt.in_progress_session_id`·`in_progress_session`). 시그니처·grant 동일 |
| `supabase/migrations/20261103000700_s8_career_deletion_interviews.sql` | `career_deletion_interview_session_ids`, `get_deletion_impact`·`delete_career_item` 재정의(시그니처·grant 동일) |

`ai_jobs`는 바꾸지 않았다. `target_type` CHECK가 없어 `interview_session`이 그대로 허용되고, 세션당 같은 종류 작업 1개는 기존 `ai_jobs_in_flight_target_key`가 막는다.

## 테이블·컬럼 (스펙 대비 차이)
- 5개 테이블 모두 A.12·A.13 컬럼 그대로 + `user_id`(DM-1, 복합 FK DM-2) + `created_at`/`updated_at`. 질문·평가·종합에 AI 공통 메타(`ai_job_id`, `run_generation`, `schema_version`, `prompt_version`, `provider`, `model`, `model_tier`, `connection_tier`, `input_hash`, `career_snapshot_hash`, `validation_report`, `usage`)를 두고, 평가·종합에는 `completed_at`도 둔다.
- **추가 컬럼 `[구현 결정]`**: 세션 `question_job_id`·`question_run_generation`·`evaluation_job_id`·`evaluation_run_generation`(spec-gaps ①).
- FK
  - 세션 → 프로젝트 cascade. `insight_id`·`source_session_id`·작업 id는 set null.
  - 답변 `(question_id, session_id)` → 질문, 평가 `(answer_id, session_id)` → 답변(같은 세션을 강제).
  - `copied_from_question_id`는 set null(F-P3-08 Should 자리만).
- CHECK
  - 열거값 전부, `question_count` 3/5/7.
  - 상태 수명주기: `in_progress`/`abandoned` ⇔ `submitted_at is null`, `abandoned` ⇔ `abandoned_at`, `completed` → `completed_at`, 제출 → 생성 `ready`, `ready` → `question_provider`·`question_model`.
  - 답변 ≤ 5000자, `unanswered` ⇔ `score_status = 'unanswered'`, `draft`는 점수 없음.
  - 평가·종합이 `succeeded`면 result·메타 필수. 길이·개수 상한(spec-gaps ③).
- 인덱스: `interview_sessions_in_progress_key`(A.12 partial unique), 프로젝트·사용자별 최신순, 작업 id 부분 인덱스들, 답변·평가 `session_id`.

## RLS·권한 요약 (DM §5 대비)
| 대상 | authenticated | app_ai_writer | service_role |
|------|---------------|---------------|--------------|
| interview_sessions | select·delete 본인 | select 본인 | select·delete |
| interview_questions | select 본인, **`intent`·`good_answer_signals` 제외 column grant** | select 본인(전체) | select·delete |
| interview_answers | select 본인, update(`answer_text`) — 편집 조건 RLS | select 본인 | select·delete |
| answer_evaluations / session_feedbacks | select 본인 | select 본인 | select·delete |
| 사용자 RPC 5개 | execute | 없음 | — |
| AI RPC 9개 | 없음 | execute | — |

- insert와 그 밖의 update는 어느 API 역할에도 없다(RPC·트리거·연쇄만). `grants.test.sql`에 S8 매트릭스 4개와 비공개 컬럼 검사 1개를 더했다(plan 34 → 39).
- `delete_results`의 세션 삭제는 invoker RPC가 사용자 delete 권한으로 한다. 집계 헬퍼 `private.career_deletion_interview_session_ids`는 invoker(RLS 적용)이고 authenticated에 execute를 줬다.

## 테스트 (`supabase test db`: 41파일 1966개, 모두 통과)
- 새 파일
  - `supabase/tests/interviews.test.sql`(168)
    - 구조: RLS·정책·인덱스. 생성: 오류 4종, 멱등, `session_id_conflict`, `interview_in_progress` + detail, 직접 insert/update 금지.
    - 질문 생성: begin(작업 종류·멱등), save(멱등·stale·잘못된 payload 18종·공급자 불일치·트림·AI 메타·빈 답변·근거), complete(미완성·잘못된 payload 4종·stale·ready), fail, 같은 세대 stale, 수동 재시도 재오픈.
    - 비공개 컬럼(`intent`·`good_answer_signals`·`select *` 거부), 공개 전 reveal 거부.
    - 답변: 자동 저장, `answered_count`, 길이, 점수·상태 컬럼 금지, 교차 사용자(사용자·app_ai_writer).
    - 제출: 공백·빈 답변 미응답, 1회만, 제출 후 편집 0행, reveal.
    - 채점: begin(공급자·작업 종류), save(미응답 거부·잘못된 payload 4종·stale·`interview_answer` 근거), 성공 후 fail no-op, 종합 없이 complete → `evaluation_failed`, 새 작업으로 다시 채점(성공 답변 보존)·종합·complete, `interview_evaluation_not_needed`, 결과 확인.
    - 부분 실패(`not_scored` → completed), 다른 프로젝트 답변 근거 거부, not_scored만 다시 채점, 종료 트리거 `evaluation_failed`.
    - JD 미추출, 질문 작업 취소 트리거(app_ai_writer가 상태 갱신), 남은 질문 다시 만들기, 세션당 작업 1개(23505).
    - 보드 팝업 id·null, 생성 중 편집 0행, 그만두기(작업 취소 요청·멱등·이후 begin 거부), 응답 0개 제출.
    - 세션 삭제 연쇄·근거·작업 취소, 삭제 후 RPC `interview_session_not_found`, 프로젝트·탈퇴 연쇄.
  - `supabase/tests/interviews_career_deletion.test.sql`(13): 상세·프로젝트(연쇄)·경력(delete/keep_projects)·무관 스킬 집계, 같은 세션 중복 링크 1회, keep_results(근거 표시·세션 유지), delete_results(세션 삭제·작업 취소 요청·근거 삭제), 헬퍼 교차 사용자.
- 기존 파일 수정
  - `grants.test.sql`: app_ai_writer 테이블·함수 허용 목록에 S8 추가, S8 매트릭스(plan 39).
  - `application_stage.test.sql`: `interview_prompt`에 `in_progress_session: null`.
  - `evidence_links.test.sql`: 출처 삭제 트리거 목록에 `interview_answers`.
  - `s6_lock_order.test.sql`: 종료 트리거 목록에 `ai_jobs_release_interview`.
- 첫 호출 권한: 별도 파일 대신 `interviews.test.sql`이 모든 RPC·RLS·트리거를 실제 역할(authenticated / app_ai_writer)로 부른다. invoker 경로(`get_deletion_impact`, 답변 update 정책의 세션 서브쿼리, 세션 삭제 트리거)도 사용자 역할로 확인했다.

## 원격 브랜치 적용 여부
적용하지 않았다(계획대로). 커밋도 하지 않았다.

## api·ai가 알아야 할 것
- 질문 생성 순서: 세션 생성(사용자) → 작업 생성(`target_id` = 세션) → `begin_interview_questions`(prepare, D-30 뒤) → 질문마다 `save_interview_question` → `complete_interview_questions` → `complete_ai_job`. 실패는 `fail_interview_questions` 또는 작업 실패(트리거가 대신한다).
- 남은 질문 다시 만들기: 생성 실패 세션에 새 작업으로 `begin`을 부르고, `existing_questions`·`remaining`·`next_sequence`를 보고 비어 있는 sequence로 저장한다. 같은 sequence를 다시 보내면 무시된다(`created:false`).
- 채점 순서
  1. 제출(사용자). `evaluation_needed`가 true일 때만 작업을 만든다.
  2. `begin_interview_evaluation(p_provider = 작업 provider, p_model)`
  3. `answers_to_evaluate`마다 `save_answer_evaluation` 또는 `fail_answer_evaluation`
  4. `save_session_feedback`. AI-07 입력은 `evaluated_answer_ids` + 이번에 성공한 답변이다.
  5. `complete_interview_evaluation` → `status = 'completed'`면 `complete_ai_job`, `evaluation_failed`면 작업을 실패로 끝낸다.
- 조회 규칙: `generation_status = 'generating'`인데 `question_job_id` 작업이 queued/running이 아니면 생성 실패, `status = 'evaluating'`인데 `evaluation_job_id` 작업이 끝났으면 채점 실패로 보인다(트리거가 skip locked로 건너뛴 경우).
- 답변지 조회는 `interview_questions`에서 `intent`·`good_answer_signals`를 빼고 컬럼을 나열한다. 결과 화면의 `intent`는 `get_interview_question_reveals`(제출 후)로 받는다. `answer_evaluations.result.intent_reveal`도 있다.
- 답변 자동 저장 update가 0행이면: 세션 생성 중·생성 실패, 제출됨, 그만둠, 또는 남의 답변이다. 세션 상태를 읽어 이유를 돌려준다.
- 실행 공급자 표시: `evaluation_provider`가 있으면(채점 시작됨) 그것, 없으면 `question_provider`.

## 스펙 차이·가정 (spec-gaps.md "2026-11-03 · S8 (db)")
1. 세션 작업 id·실행 세대 내부 컬럼 `[구현 결정]`
2. 세트 단위 validation_report·usage 저장 자리 없음
3. 길이·개수 상한 `[가정]`
4. 그만둔 세션 답변 편집 금지 `[가정]`
5. "응답됨" = 공백 아닌 글자 `[구현 결정]`
6. 점수 슬롯 단계별 값 `[구현 결정]`
7. 다시 채점 범위(실패 답변 + 종합은 항상) `[가정]`
8. 결과 확인 표시는 completed만 `[가정]`
9. 세션 삭제 → 작업 취소 요청 `[구현 결정]`
10. 직무 질문 learnings 근거 DB 거부(V-8) `[구현 결정]`
11. `interview_answer` 근거 출처 규칙 `[구현 결정]`
12. 보드 팝업 `in_progress_session` 객체 추가 `[구현 결정]`
13. 세션 `data_sufficiency` not null `[구현 결정]`
14. 자동 저장 ↔ 세션 삭제 교착 가능성 `[가정]`

## QA 1차 반영 (2026-11-03)
- **QA-S8-02 [Minor] 교차 사용자 격리 테스트 보강**: `supabase/tests/interviews.test.sql`에 6개를 더했다(162 → 168). A의 질문 3개·답변 평가 1개·종합 1개가 있는 상태(고정값 확인)에서 확인한다.
  - B가 `authenticated`이면 A의 `interview_questions`(공개 컬럼으로 조회), `answer_evaluations`, `session_feedbacks`가 모두 0행이다.
  - B가 `app_ai_writer`이면 A의 `answer_evaluations`, `session_feedbacks`가 0행이다.
- 스키마·RLS 변경은 없다(테스트만 추가). `supabase test db` 41파일 1966개 모두 통과. 커밋하지 않았다.
