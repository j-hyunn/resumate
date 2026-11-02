# S5 DB 구현 노트 (db-engineer)

> 상태: **QA 1차 반영 완료**(QA-S5-01·02·03·05). `supabase db reset` 통과, `supabase test db` 29파일 1289개 통과, `database.types.ts` 재생성(시그니처 변화 없음). 미커밋 S5 파일을 직접 고쳤다(리더 허용).

## RPC 시그니처와 반환 형태 (api·ai 먼저 볼 것)

오류는 모두 `errcode = 'P0001'`, `message` = 소문자 코드. 미인증은 `42501 not_authenticated`.

### 사용자 세션 (authenticated, security definer + `auth.uid()` 소유 검사)

```sql
create_application_project(
  p_id uuid,                    -- 클라이언트 생성 id (멱등 키)
  p_raw_text text,              -- 1~50,000자 (btrim 후 비면 거부)
  p_raw_text_hash text,         -- 서버 계산, 1~128자
  p_sentences jsonb,            -- [{sid:'S1',text,start,end}, ...] sid 연속, start<end. 빈 배열 [] 허용(QA-S5-01)
  p_company_name text default null,   -- btrim, 빈 값 = null, ≤ 200 [가정]
  p_position_title text default null, -- btrim, 빈 값 = null, ≤ 200 [가정]
  p_name text default null,           -- btrim, 빈 값 = null, ≤ 100
  p_deadline date default null
) returns jsonb
-- {application_project_id, job_description_id, name, name_source, extraction_status, ai_run_allowed, created}
```
- `ai_run_allowed`(추가 키): 활성 공급자 + 그 키가 `invalid` 아님 + 실행 동의 규칙 통과(= `check_ai_run_allowed`와 같은 기준). 서버 액션 `shouldExtract`에 그대로 쓰면 된다.
- 이름 규칙: `p_name` 있으면 (`p_name`, `user`). 없고 `ai_run_allowed`면 (null, null) = 추출 대기. 없고 실행 불가면 회사명·포지션명 둘 다 있으면 ("회사명 – 포지션명", `user`), 아니면 ("새 기업 JD (YYYY-MM-DD)", `default`, KST 생성일). 구분자는 en dash `–`(U+2013) 앞뒤 공백, 100자 초과 시 앞 100자.
- 멱등: 같은 `p_id`가 본인 것이면 기존 행 값을 돌려준다(`created: false`, 입력 무시). 다른 사용자 id면 `application_project_id_conflict`.
- 오류: `invalid_id`, `invalid_raw_text`, `invalid_raw_text_hash`, `invalid_sentences`, `invalid_name`, `invalid_company_name`, `invalid_position_title`, `application_project_id_conflict`.

```sql
move_application_stage(p_application_project_id uuid, p_to_stage text, p_outcome text default null) returns jsonb
-- {stage, stage_outcome, stage_changed_at, changed, interview_prompt}
-- interview_prompt: changed이고 to_stage가 job_interview/culture_fit_interview이면
--   {interview_type:'job'|'culture_fit', in_progress_session_id:null}, 아니면 null
```
- 오류: `application_project_not_found`, `invalid_stage`, `invalid_outcome`(값이 passed/failed가 아니거나 `to_stage <> 'closed'`인데 outcome을 줌).
- 같은 단계면 변경·이벤트 없음(`changed:false`, outcome 인자도 무시).

```sql
set_application_outcome(p_application_project_id uuid, p_outcome text) returns jsonb
-- {stage, stage_outcome, stage_changed_at, changed}
```
- `p_outcome` in (`passed`, `failed`) 또는 null(결과 지우기). 오류: `application_project_not_found`, `not_closed`, `invalid_outcome`.

직접 update(사용자 세션): `application_projects`의 `name`, `deadline`, `memo` 컬럼만. 이름을 null/빈 문자열로 바꾸면 `invalid_name`. 이름을 바꾸면 트리거가 `name_source = 'user'`, 세 컬럼 중 하나라도 바뀌면 `last_activity_at = now()`.

### app_ai_writer 전용 (security definer + `private.current_uid()` 소유 검사)

```sql
begin_jd_extraction(p_job_description_id uuid, p_ai_job_id uuid) returns void
```
- 작업 조건: 본인 작업, `job_type = 'jd_extraction'`, `target_type = 'job_description'`, `target_id = p_job_description_id`, `application_project_id` = JD의 프로젝트, status in (`queued`, `running`). 아니면 `invalid_ai_job`.
- `pending`/`failed` → `running` + `extraction_job_id = p_ai_job_id`.
- `running`이고 같은 작업 id → 아무것도 안 함(멱등).
- `running`이고 다른 작업이 이미 끝났거나(succeeded/failed/canceled) 없으면 → 덮어씀(멈춘 추출 복구). 살아 있으면 `extraction_in_progress`.
- `succeeded` → `already_extracted`. JD 없음/남의 것 → `job_description_not_found`.

```sql
apply_jd_extraction(
  p_job_description_id uuid,
  p_ai_job_id uuid,
  p_run_generation integer,    -- ai_jobs.run_generation (계획서의 p_attempt_count. S3a에서 컬럼명이 바뀜)
  p_result jsonb,
  p_provider text,             -- ai_jobs.provider와 같아야 함
  p_model text
) returns jsonb
-- 반영:   {applied:true, job_description_id, application_project_id, extraction_status:'succeeded',
--          name, name_source, company_name, company_name_source, position_title, position_title_source,
--          requirement_count}
-- 무시:   {applied:false, reason:'stale_run'}   -- 늦게 도착한 실행(아래)
```
- 무시(`stale_run`) 조건: JD `extraction_status <> 'running'`, `extraction_job_id <> p_ai_job_id`, 작업 status <> `running`, 작업 `run_generation <> p_run_generation`.
- 오류: `job_description_not_found`(프로젝트가 삭제된 경우 포함 → api는 canceled처럼 처리), `invalid_ai_job`(작업이 없거나 JD 대상이 아님), `invalid_ai_metadata`(provider 불일치·model 빈 값), `invalid_extraction_result`(아래 모양 위반, 존재하지 않는 sid 포함), `user_edited_requirements_exist`.

#### `p_result` 모양 (ai-pipeline이 만들고 api가 그대로 넘김)

```jsonc
{
  "detected_language": "ko",                  // string 1~16자 | null
  "is_likely_jd": true,                       // boolean (extraction 안에도 있음, DB는 저장만)
  "company_name":   { "value": "에이비씨페이", "source_sids": ["S1"] } | null,
  "position_title": { "value": "백엔드 엔지니어", "source_sids": ["S1"] } | null,
  "seniority": { ... } | null,                // DB는 읽지 않음 (extraction에 들어 있음)
  "requirements": [                           // 1개 이상 (0개면 파이프라인이 not_a_jd/재시도로 끝냄)
    { "category": "responsibility|required|preferred",
      "content": "…",                          // 1~500자 (모델 출력 text → content)
      "keywords": ["…"],                       // string 배열 (0개 이상, 각 1~100자)
      "importance": "high|normal",
      "source_sids": ["S4"] }                  // 1개 이상, 모두 JD sentences에 있는 sid
  ],
  "tech_keywords": [ { "keyword": "Kafka", "source_sids": ["S12"] } ],   // 배열, 그대로 tech_keywords 컬럼에
  "other_sids": ["S2"], "warnings": [],
  "requirements_hash": "…",                   // 서버(TS) 계산, 1~128자
  "extraction": { ...정규화된 전체 출력 (schema_version 포함) }        // object, 그대로 extraction 컬럼에
}
```
- DB가 쓰는 키: `detected_language`, `company_name.value`, `position_title.value`, `requirements`, `tech_keywords`, `requirements_hash`, `extraction`. 나머지는 `extraction` 안에 있으면 된다.
- **모르는 키는 무시한다(거부하지 않음)**: 최상위(`schema_version`, `prompt_version`, `validation` 등), `company_name`/`position_title` 객체, 요건 원소(`alias` 등), `tech_keywords` 원소의 추가 키 모두 그대로 통과한다. `tech_keywords`는 받은 배열을 그대로 컬럼에 저장하므로 원소의 추가 키도 저장된다. pgTAP `jd_extraction.test.sql`의 `t_result`가 모든 단계에 추가 키를 넣어 이것을 고정한다.
- sid는 정규형 `S<n>`만 받는다(`s1`, `S01` 거부). n은 그 JD 문장 수 이하여야 한다.
- 요건 순서 = `sort_order`(0부터). 이전 `origin = 'ai'` 요건은 지우고 새로 넣는다.
- 회사명·포지션명: 비어 있을 때만 AI 값(`*_source = 'ai'`). 값 200자 초과는 앞 200자. **그 값의 `source_sids`가 1개 이상이고 모두 JD에 있어야 쓴다. 아니면 값만 버리고 결과는 반영한다**(QA-S5-05, TS 검증기와 같은 규칙).
- 이름: `name_source`가 null/`default`이면 회사명·포지션명(반영 후 값) 둘 다 있을 때 "회사명 – 포지션명"(`ai`). 둘 중 하나라도 없으면 null 이름만 기본 이름(`default`)으로.
- `last_activity_at` 갱신.

```sql
fail_jd_extraction(p_job_description_id uuid, p_ai_job_id uuid) returns boolean
```
- `running`이고 `extraction_job_id = p_ai_job_id`일 때만 → `failed`, true. 아니면 false(무시).
- 이름이 null이면 키 없는 생성과 같은 대체 이름을 넣는다 [가정 1]: 회사명·포지션명 둘 다 있으면 ("회사명 – 포지션명", `user`), 아니면 기본 이름(`default`).
- 오류: `job_description_not_found`.

### ai_jobs 제약 (추가)
- `job_type = 'jd_extraction'`이면 `target_type = 'job_description'`, `target_id`와 `application_project_id` not null (`ai_jobs_jd_extraction_check`).
- `target_type`에는 원래 CHECK가 없다(값 제한 없음). `ai_usage_records.feature`는 이미 `jd_extraction` 포함.


## 마이그레이션 파일
| 파일 | 내용 |
|------|------|
| `supabase/migrations/20261031000100_s5_application_projects.sql` | `application_projects`(A.5 + 2.6), 사용자 update 트리거, `application_stage_events`, RLS, grant, service_role 쓰기 회수 |
| `supabase/migrations/20261031000200_s5_job_descriptions.sql` | `job_descriptions`(A.6 v4), `jd_requirements`(A.7), `sentences` 구조 검사 함수, 변경 불가 트리거(D-19), RLS, grant |
| `supabase/migrations/20261031000300_s5_application_project_fks.sql` | `ai_jobs`·`evidence_links`(cascade)·`ai_usage_records`(`set null (application_project_id)`) 복합 FK, `ai_jobs_jd_extraction_check` |
| `supabase/migrations/20261031000400_s5_application_rpcs.sql` | 이름 헬퍼, `private.user_ai_run_allowed`, `create_application_project`, `move_application_stage`, `set_application_outcome` |
| `supabase/migrations/20261031000500_s5_jd_extraction_rpcs.sql` | 결과 모양 검사 헬퍼, `begin_jd_extraction`, `apply_jd_extraction`, `fail_jd_extraction` |

## 테이블·컬럼 (스펙 대비 차이)
- `application_projects`: 스펙 컬럼 그대로. CHECK: 이름 1~100자(공백만 불가), `(name is null) = (name_source is null)`, 메모 ≤ 2,000, `stage` 6값, `stage_outcome`(passed/failed), `stage = 'closed' or stage_outcome is null`. `duplicated_from_id`는 복합 FK `on delete set null (duplicated_from_id)`. 인덱스 3개(DM) + `duplicated_from_id` 부분 인덱스.
- `application_stage_events`: 스펙 그대로(`updated_at` 없음). `created` 이벤트는 from/outcome 모두 null(CHECK). `outcome_changed`는 from_stage = to_stage = `closed`로 기록한다.
- `job_descriptions`: `extraction_job_id`는 soft reference 대신 **복합 FK `(extraction_job_id, user_id)` → `ai_jobs` `on delete set null`**로 걸었다(다른 사용자 작업 지정 차단, 90일 정리 때 null). `succeeded`면 `extraction`·`tech_keywords`·`requirements_hash`·`extraction_provider`·`extraction_model` 필수(CHECK). `application_project_id`·`raw_text`·`raw_text_hash`·`sentences`·`user_id`는 모든 역할에 대해 변경 불가(`job_description_immutable`).
- `jd_requirements`: `keywords text[]` default `{}`, `importance` default `normal`, `origin` default `ai`, `source_sids`는 정규형 sid 1개 이상(CHECK). `unique (id, user_id)` 추가(S6 결과 테이블의 복합 FK용).
- `ai_jobs`: `target_type`에는 원래 CHECK 목록이 없다(값 제한 없음). `jd_extraction`이면 `target_type = 'job_description'` + `target_id`·`application_project_id` 필수 CHECK를 더했다. `ai_usage_records.feature`·`job_type`은 이미 `jd_extraction` 포함, 변경 없음.

## RLS·권한 요약 (DM §5 대비)
| 테이블 | authenticated | app_ai_writer | service_role |
|--------|---------------|---------------|--------------|
| application_projects | select·delete 본인, update(`name`,`deadline`,`memo`) | select(컬럼, `memo`·`duplicated_from_id` 제외) | select·delete |
| application_stage_events | select 본인 | 없음 | select·delete |
| job_descriptions | select 본인 | select 본인 | select·delete |
| jd_requirements | select 본인 | select 본인 | select·delete |

- insert는 모두 RPC(definer). `stage*` 컬럼과 이벤트 쓰기는 어떤 역할에도 없다(grants.test로 고정).
- **계획 대비 차이**: 계획은 `app_ai_writer`에 이름·`last_activity_at`·`extraction_status` update grant를 주지만, S4처럼 definer RPC로만 쓰게 하고 컬럼 grant는 주지 않았다(spec-gaps ①).
- 실행 권한: `create_application_project`/`move_application_stage`/`set_application_outcome` → authenticated만. `begin/apply/fail_jd_extraction` → app_ai_writer만. 모두 security definer + `search_path = ''` + 소유 검사(사용자 RPC는 `auth.uid()`, AI RPC는 `private.current_uid()`).
- 잠금 순서: 프로젝트 행 → JD 행(프로젝트 삭제 cascade와 같은 순서라 교착을 피함).

## 테스트 (`supabase test db`: 29파일, 1262개, 모두 통과)
- 새 파일
  - `supabase/tests/application_projects.test.sql`(69): RLS·정책 목록, 이름 규칙(키 없음/합성/회사만/사용자 이름/100자 자르기/키 있음 null/invalid 키), 멱등 재호출, 입력 검증 오류 전부, 직접 쓰기 금지, 사용자 update 트리거, 교차 사용자, anon, JD 변경 불가, CHECK
  - `supabase/tests/application_stage.test.sql`(23): 이동 1~5단계, 면접 팝업, 종료에서 나갈 때 결과 지움과 `from_outcome`, 같은 단계 무이벤트, 결과 기록·지우기·`not_closed`, 이벤트 이력 전체
  - `supabase/tests/jd_extraction.test.sql`(70): begin 매칭·멱등·`already_extracted`·`extraction_in_progress`·멈춘 추출 인계, apply의 `stale_run`(세대·미시작·중복 반영)·메타 검사·모양 거부 17종·**모르는 키 통과**·회사명/포지션/이름 규칙·사용자 요건 거부, fail 규칙·기본 이름, 교차 사용자, 역할 제한, 삭제 cascade(JD·요건·이벤트·ai_jobs·evidence_links 삭제, usage_records null 유지), 탈퇴 cascade
  - `supabase/tests/s5_first_call_privileges.test.sql`(21): 실제 역할로 처음 호출
- 기존 파일 수정(새 FK·CHECK 때문)
  - `supabase/tests/grants.test.sql`: app_ai_writer 테이블·함수 허용 목록에 S5 추가, S5 RPC 실행 매트릭스, 사용자 쓰기 권한, stage 쓰기 금지, memo 비공개(5개 추가, plan 27)
  - `supabase/tests/evidence_links.test.sql`, `supabase/tests/s3_first_call_privileges.test.sql`: 임의 uuid 대신 실제 지원 프로젝트를 만들어 씀
  - `supabase/tests/ai_jobs.test.sql`, `supabase/tests/complete_ai_job.test.sql`: 대상 없는 `jd_extraction` 작업 → `interview_questions`(테스트 의미 동일)

## 원격 브랜치 적용 여부
적용하지 않았다(계획대로). 커밋도 하지 않았다.

## api·ai가 알아야 할 것
- `job_description_not_found`는 "프로젝트가 삭제됨"도 뜻한다 → `canceled`처럼 처리.
- `apply_jd_extraction` 순서: `apply` → `complete_ai_job(job, run_generation)`. `apply`가 `stale_run`이면 `complete`를 부르지 않는다.
- 실패 경로: 작업을 `failed`로 둔 뒤(또는 전에) `fail_jd_extraction`을 부른다. 반환 false면 이미 다른 실행이 JD를 가져간 것이다.
- 사용 기록을 프로젝트 삭제 뒤에 넣으면 23503이 난다. api 노트(④)대로 `application_project_id = null`로 다시 넣으면 된다.
- S6 확장 지점: `get_deletion_impact.by_application_project`, `evidence_links` 출처 가드의 JD 출처, 요건 삭제 시 근거 처리, `move_application_stage.in_progress_session_id`(S8).

## 스펙 차이·가정 (spec-gaps.md "2026-10-31 · S5 (db)" 항목)
1. AI 쓰기는 definer RPC만(컬럼 grant 없음), `memo`는 AI 비공개 `[구현 결정]`
2. 추출 실패 시 null 이름을 대체 이름으로 채움 `[가정 1 해석]`
3. 기획에 없는 길이 상한 `[가정]`
4. 반환 키 `ai_run_allowed`·`created` 추가
5. 같은 단계 이동 시 outcome 무시, `interview_prompt`는 실제 이동 때만
6. `extraction_in_progress`는 방어용(유일 인덱스가 먼저 막음)
7. JD 근거 가드·요건 삭제 근거 처리는 S6로 넘김


## QA 1차 반영 (2026-10-31)
- **QA-S5-01**: `private.jd_sentences_valid`가 빈 배열 `[]`를 받는다(테이블 CHECK와 `create_application_project` 모두). 원문(1~50,000자)은 항상 저장된다. 문장 0개 JD의 추출은 ai·api가 호출 없이 `not_a_jd`로 끝낸다. `null`이나 배열이 아닌 값은 여전히 `invalid_sentences`다.
- **QA-S5-02**: 트리거 `ai_jobs_release_jd_extraction`(`after update of status on ai_jobs`)를 추가했다. `jd_extraction` 작업이 `failed`(sweep의 `stalled` 포함)나 `canceled`로 바뀌면, 그 작업으로 `running` 중인 JD를 `failed`로 바꾸고 null 이름에 대체 이름을 넣는다. `fail_jd_extraction`과 같은 내부 함수 `private.jd_extraction_mark_failed`를 쓴다(security definer, 잠금 순서는 프로젝트 → JD). `succeeded`는 건드리지 않는다. 성공은 `apply`가 먼저 처리하기 때문이다.
  - api 영향: 작업을 먼저 `failed`로 바꾸면 그 뒤의 `fail_jd_extraction`은 `false`를 돌려준다(이미 트리거가 처리함). 순서는 어느 쪽이든 결과가 같다.
  - 멈춘 추출 인계(`begin_jd_extraction`)는 이제 "작업이 apply 없이 `succeeded`로 끝났거나, 90일 정리로 작업 행이 사라진 경우"에만 쓰인다.
- **QA-S5-03**: A의 요건·JD·이벤트·프로젝트가 있는 상태에서 B(사용자 세션, `app_ai_writer`)가 0행을 보는지 확인하는 테스트를 넣었다. `app_ai_writer`는 이벤트 테이블에 권한이 아예 없다(42501).
- **QA-S5-05**: 위 회사명·포지션명 sid 검사를 넣었다. 테스트: 없는 sid(`S9`)나 `source_sids`가 없으면 값을 버리고 이름은 기본 이름이 된다.
- 테스트 추가 위치: `application_projects.test.sql`(빈 문장), `jd_extraction.test.sql`(트리거: 실패·sweep·취소, `succeeded`는 해제하지 않음, 인계, 교차 사용자, sid 검사).
