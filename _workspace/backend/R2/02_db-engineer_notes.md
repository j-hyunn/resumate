# R2 DB 구현 노트

## QA-01 반영 — 최종 시그니처 (2026-11-06, 이전 5인자 판을 대체)

```sql
public.retry_ai_job(
  p_ai_job_id uuid,
  p_expected_run_generation integer,
  p_model text,
  p_model_tier text,
  p_run_meta jsonb,
  p_expected_provider text,                    -- 필수: api가 p_model을 정할 때 쓴 활성 공급자
  p_expected_connection_tier text default null -- 권장: 그때 읽은 활성 키 등급(null이면 등급 비교 생략)
) returns jsonb
```
- 5인자 판은 없다(같은 미커밋 마이그레이션 `20261106000100`을 고쳐 판이 하나뿐). 실행 역할은 그대로 app_ai_writer만.
- 새 오류: **P0001 `ai_connection_changed`** — 활성 공급자 ≠ `p_expected_provider`, 또는 `p_expected_connection_tier`가 있고 활성 키 등급 ≠ 그 값. 작업 행·결과 행은 바뀌지 않는다(`failed` 그대로).
- 인자 검사: `p_expected_provider`가 null이거나 (`openai`,`gemini`,`anthropic`) 밖이면, `p_expected_connection_tier`가 null도 (`free`,`paid`)도 아니면 → P0001 `invalid_ai_metadata`.
- **판정 순서**: (1) 작업 없음 `ai_job_not_found` → (2) 상태/세대 불일치 `{requeued:false,...}` 반환 → (3) `ai_job_not_retryable` → (4) 인자 `invalid_ai_metadata`/`invalid_run_meta` → (5) 게이트 `key_missing` → `key_invalid` → `ai_consent_required` (활성 공급자 기준) → (6) **`ai_connection_changed`**. 게이트를 먼저 보는 이유: 활성 연결이 없어졌거나 무효면 "다시 시도"보다 연결 화면 안내가 맞다. 게이트를 통과한 뒤에만 기대값과 비교한다.
- 나머지(반환 모양, step_outputs 처리, 결과 행 다시 열기, 23505)는 아래 원래 절과 같다.
- 상태: 완료. `supabase db reset` + `supabase test db` 45파일 2158 PASS, 타입 재생성(`retry_ai_job` Args 7개, `p_expected_connection_tier?` 선택).
- 테스트 추가(`retry_ai_job.test.sql`, 71 → 79): 판 1개, 공급자 불일치·등급 불일치 → `ai_connection_changed`, 기대 공급자 null/알 수 없는 값·알 수 없는 등급 → `invalid_ai_metadata`, 거부 뒤 작업 행(상태·세대·공급자·모델·error_code·step_outputs)과 인사이트 행이 그대로.
- 아래 원래 절의 5인자 시그니처는 이 판으로 대체됐다.

## 확정 시그니처·오류 코드 (api-engineer 먼저 보기)

> 상태: 완료. 로컬 `supabase db reset` + `supabase test db` 전체 PASS(45파일, 2150), 타입 재생성. 시그니처·코드 확정.

```sql
public.retry_ai_job(
  p_ai_job_id uuid,
  p_expected_run_generation integer,  -- 호출자가 본 run_generation (조건부 claim)
  p_model text,                       -- 활성 공급자 + p_model_tier로 api가 정한 모델 id (1~200자)
  p_model_tier text,                  -- 'light' | 'default' | 'heavy'
  p_run_meta jsonb                    -- step_outputs->'_meta'에 넣을 새 러너 메타 {runBase, waitBase, retries:{}} (object 필수)
) returns jsonb
```
- **실행 역할: `app_ai_writer`만**(security definer, 소유 검사 `private.current_uid()` = JWT sub). 계획서의 `authenticated`가 아니다 — 지금 `store.requeueFailed`가 쓰는 app_ai_writer 클라이언트(forUser scope)로 부르면 된다. 사용자 세션이 `p_model`·`p_run_meta`를 임의로 넣지 못하게 하려는 것.
- 공급자·연결 등급은 인자로 받지 않는다. DB가 `profiles.active_ai_provider`와 그 공급자의 `ai_provider_keys.connection_tier`에서 읽는다.

### 처리 순서와 결과
1. `p_ai_job_id`가 없거나 다른 사용자 것 → raise P0001 `ai_job_not_found`. 미인증 → 42501 `not_authenticated`.
2. 작업 행 잠금(`for update`) 후 **상태/세대 불일치는 raise 하지 않고 반환**:
   `{ "requeued": false, "status": <현재 status>, "run_generation": <현재 값> }`
   — 조건: `status <> 'failed'` 또는 `run_generation <> p_expected_run_generation`. api는 status가 queued/running이면 진행 중으로, 그 밖이면 `ai_job_not_retryable`로 처리하면 된다.
3. 다시 시도할 수 없는 작업 → raise P0001 `ai_job_not_retryable`
   — `job_type`이 `insight`·`interview_questions`·`interview_evaluation`이 아님, 또는 `error_code`가 null이거나 `error_category = 'input'`.
4. 인자 검사 → raise P0001 `invalid_ai_metadata`(p_model 공백/200자 초과, p_model_tier가 CHECK 밖), `invalid_run_meta`(p_run_meta가 object 아님).
5. 연결 게이트 (DM 2.11.7 경로 ②, 활성 공급자 기준, 작업 행은 `failed` 그대로) — 모두 **errcode P0001, message가 코드 문자열**:
   - 활성 공급자 없음 또는 그 키 행 없음 → `key_missing`
   - 활성 키 `status = 'invalid'` → `key_invalid`
   - `private.ai_consent_allows_run(user, 활성 공급자, 키 현재 connection_tier)` false → `ai_consent_required`
   - 판정 순서: key_missing → key_invalid → ai_consent_required (`check_ai_run_allowed`와 같은 순서)
6. 성공 시 같은 행 `failed → queued`, `run_generation + 1`, `provider`/`model`/`model_tier`/`connection_tier` = 활성 값, `heartbeat_at = now()`, `next_run_at = null` (가드 트리거가 error_code·finished_at·cancel_requested_at·retry_after·quota_resets_at을 비움).
   - `restarted = (활성 공급자 ≠ 기록 provider) or (활성 connection_tier ≠ 기록 connection_tier)` (model·model_tier 차이는 restarted 판정에 넣지 않는다)
   - restarted → `step_outputs := {"_meta": p_run_meta}` (단계 출력·partials 모두 버림) + 그 작업의 결과 행 전부 다시 엶(아래 "결과 행 다시 열기")
   - 같음 → `step_outputs := (step_outputs - '_meta') || {"_meta": p_run_meta || {"partials": 옛 _meta.partials}}` (옛 partials가 비어 있지 않은 object일 때만 붙임). 결과 행은 지금처럼 실패한 것만 다음 begin/save/complete가 세대 검사로 다시 엶.
   - 반환: `{ "requeued": true, "restarted": bool, "status": "queued", "provider", "model", "model_tier", "connection_tier", "run_generation": <새 값> }`
7. 같은 대상에 다른 진행 중 작업이 있으면 in-flight unique 인덱스 위반 **23505가 그대로** 올라간다(지금과 같음).

### 사용자 세션이 계속 읽을 수 있는 것 (배지 계산용)
- `profiles.active_ai_provider`, `ai_provider_keys_public.connection_tier`·`status`, `ai_jobs.provider`·`connection_tier`: authenticated select 유지(이번에 회수하지 않음).

## 결과 행 다시 열기 (restarted일 때만, 같은 트랜잭션)
| job_type | 조건 | 처리 |
|----------|------|------|
| `insight` | 이 작업의 `insights` 행이 `failed` | `generating`, `run_generation = 새 세대`, `provider`·`model_tier`·`connection_tier` = 새 값 |
| `interview_questions` | 세션 `question_job_id = 이 작업`, `generation_status <> 'ready'`, 세션 `in_progress` | 세션의 `interview_questions` 삭제(빈 답변·근거 함께), 세션 `generation_status = 'generating'`, `question_run_generation = 새 세대` `[가정]` |
| `interview_evaluation` | 세션 `evaluation_job_id = 이 작업`, `status in (evaluation_failed, evaluating)` | 이 작업의 `answer_evaluations` 전부(성공 포함) → `pending` + 새 공급자 메타·세대, `private.interview_evaluation_open`(세션 `evaluating`, 피드백 `pending`), 이 작업의 `session_feedbacks` 공급자 메타 갱신, 세션 `evaluation_provider`/`evaluation_model` = 새 값 |

- 러너 쪽에 바뀌는 것은 없다: begin_*은 같은 작업이면 열린 행을 그대로 받아 이어 가고(질문은 `next_sequence = 1`, 평가는 `answers_to_evaluate`에 pending 포함), save/complete는 세대 검사(`run_generation`)로 옛 세대 완료를 `stale_run`으로 버린다.
- 이미 완결된 묶음(인사이트 `ready`, 질문 `ready`, 평가 `completed`)은 공급자가 달라도 다시 열지 않는다 `[가정]`(spec-gaps R2 ③).
- 같은 공급자·등급이면 결과 행을 건드리지 않는다(기존 지연 다시 열기).

## 마이그레이션 파일
| 파일 | 내용 |
|------|------|
| `supabase/migrations/20261106000100_r2_retry_ai_job.sql` | `public.retry_ai_job(uuid, integer, text, text, jsonb)` definer, app_ai_writer만 execute. `private.ai_jobs_guard_status` 재정의: `provider`·`model_tier`·`connection_tier` 변경은 `failed → queued`에서만(그 밖은 P0001 `invalid_ai_job_transition`) |

- 잠금 순서: `application_projects` → `interview_sessions` → `ai_jobs`(끝 트리거와 같음). 먼저 잠그지 않고 작업 행을 읽어 대상을 찾은 뒤 잠그고 다시 읽는다.
- 게이트는 키 행의 `status`·`connection_tier`만 읽는다(암호문 컬럼 없음).

## 권한
- 회수한 권한 없음. 사용자 세션은 원래 `ai_jobs` update 권한이 없고, app_ai_writer의 `status`·`run_generation`·`step_outputs` update는 러너가 계속 쓴다(spec-gaps R2 ⑦). `store.requeueFailed`의 직접 update는 DB가 막지 않지만, api가 RPC로 바꾸면 쓰는 곳이 없어진다.
- 배지 계산용 읽기(`profiles.active_ai_provider`, `ai_provider_keys_public`, `ai_jobs.provider`·`connection_tier`)는 authenticated select 유지(테스트로 확인).

## [가정]·구현 결정
- 실행 역할 app_ai_writer(계획의 authenticated 대신), 질문 다시 열기 = 삭제, 완결 묶음 제외, RPC 안에서 즉시 다시 열기, `input_hash` null, `restarted` = 공급자·등급만 비교. 상세는 `spec-gaps.md` "2026-11-06 · R2 (db)" ①~⑥.

## 테스트
- 새 파일 `supabase/tests/retry_ai_job.test.sql`(71): 권한(app_ai_writer만, 배지 읽기 유지), 다른 사용자·없는 작업, 세대 불일치·running → `requeued:false`, 인자 오류, 경로 ② 3코드(활성 공급자 없음 / 활성 키 invalid / 활성 공급자 동의 철회 — 작업은 failed 유지), 같은 공급자(단계 출력·partials 유지, `_meta` 교체, 결과 행 그대로, 옛 세대 완료 stale_run), 다른 공급자(단계 출력 비움, 공급자 4컬럼·input_hash, 인사이트 행 재개·새 메타, 옛 세대·옛 공급자 메타 거부), 등급만 다름(restarted), 빈 partials 미보존, 요청 범위 작업·입력 원인 거부, 23505, 가드, 면접 질문(같음: 유지·begin이 2번부터 / 다름: 질문·답변·근거 삭제, 1번부터, 옛 세대 저장 stale_run, 새 공급자만 남음), 면접 평가(같음: 성공 유지 / 다름: 성공·실패 모두 pending, 세션 evaluating·evaluation_provider 갱신, 옛 세대 저장 stale_run, 다시 실패하면 끝 트리거가 닫음).
- `supabase/tests/grants.test.sql`: app_ai_writer 함수 목록에 `retry_ai_job` 추가, R2 실행 행렬 1건 추가(plan 41 → 42).
- 전체: `supabase test db` 45파일 2150 PASS.

## 타입
- `src/server/db/database.types.ts` 재생성(`retry_ai_job` Args/Returns 추가, 다른 변경 없음).

## api-engineer에게 남기는 메모
- 오류 매핑: P0001 `key_missing`·`key_invalid`·`ai_consent_required`·`ai_job_not_retryable` → 409 같은 코드. `ai_job_not_found` → 404. `invalid_ai_metadata`·`invalid_run_meta`는 서버 버그(500). 23505 → 진행 중 작업 찾기(지금과 같음).
- 경로 ① 거부 코드(`ai_not_connected`/`ai_consent_required`/`key_invalid`) 확인은 api 몫이다. DB 쪽 새 작업 시작 RPC에는 이번에 바뀐 것이 없다.
- R1 요약의 A1 "현행 유지" 표시를 "R2에서 바꿈"으로 고치는 일은 리더 몫으로 남긴다(`_workspace/backend/R1/04_summary.md` 7·46행).
