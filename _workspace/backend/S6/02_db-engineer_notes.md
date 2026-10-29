# S6 DB 구현 노트 (db-engineer)

> 상태: **QA 1차 반영(QA-S6-01)**. `supabase db reset` 통과, `supabase test db` 34파일 1464개 통과, `database.types.ts` 재생성(`insights.run_generation` 추가). 커밋·원격 적용 없음.
> 아래 시그니처·payload 모양이 계약 기준이다(작업 중 공개본에서 바뀐 것 없음).

## RPC 시그니처와 반환 형태 (api·ai 먼저 볼 것)

오류는 모두 `errcode = 'P0001'`, `message` = 소문자 코드. 미인증은 `42501 not_authenticated`.
세 RPC 모두 **app_ai_writer 전용**, security definer + `private.current_uid()` 소유 검사. 잠금 순서는 지원 프로젝트 행 → 인사이트 행.

```sql
begin_insight(p_application_project_id uuid, p_ai_job_id uuid) returns uuid   -- insights.id
```
- 작업 조건: 본인 작업, `job_type = 'insight'`, `target_type = 'application_project'`, `target_id = application_project_id = p_application_project_id`, status in (`queued`, `running`). 아니면 `invalid_ai_job`.
- JD 추출이 `succeeded`가 아니면 `jd_not_extracted`(api는 `prepare`에서 `ensureJdExtracted`를 먼저 끝낸다).
- 같은 작업으로 만든 행이 이미 있으면 그 id를 돌려준다(멱등). 단 그 행이 `failed`이고 작업이 다시 `queued`/`running`이며 행의 `run_generation`이 작업보다 작으면(수동 재시도) `generating`으로 다시 연다(QA-S6-01). 같은 실행 세대 안에서 실패한 행은 다시 열지 않는다.
- 다른 작업의 `generating` 행이 있을 때: 그 작업이 아직 `queued`/`running`이면 `insight_in_progress`, 끝났거나 없으면 그 행을 `failed`로 바꾸고 새로 만든다(멈춘 생성 인계).
- 새 행: `status = 'generating'`, `version_no = max(version_no) + 1`(failed 포함 전체 기준), `ai_job_id`, `provider`·`model_tier`·`connection_tier`는 작업에서 복사.
- 프로젝트 없음/남의 것: `application_project_not_found`.

```sql
complete_insight(p_insight_id uuid, p_ai_job_id uuid, p_run_generation integer, p_payload jsonb) returns jsonb
-- 반영: {applied:true, insight_id, application_project_id, version_no, status:'ready', is_latest:true,
--        previous_latest_id (uuid|null), evidence_count, completed_at}
-- 무시: {applied:false, reason:'stale_run'}
```
- 한 트랜잭션: 결과·해시·메타 저장 → `evidence_links`(owner_type `insight`, owner_id = 이 행) insert → `ready` + `completed_at = now()` → 이전 latest `is_latest = false`, 이번 행 `true` → 프로젝트 `last_activity_at = now()`.
- `stale_run`: 작업 status <> `running`, 작업 `run_generation <> p_run_generation`, 또는 행이 `generating`이 아님. **예외(QA-S6-01)**: 행이 `failed`이고 그 실패가 이전 실행 세대(`insights.run_generation < p_run_generation`)였으면 반영한다 — 수동 재시도는 `step_outputs`를 유지해 `prepare`(`begin_insight`)를 다시 부르지 않을 수 있기 때문이다.
- 오류: `insight_not_found`(행 없음/남의 것/프로젝트 삭제됨 → api는 canceled처럼), `invalid_ai_job`(작업 없음, 또는 행의 `ai_job_id`와 다름), `invalid_ai_metadata`(provider·model_tier·connection_tier가 작업과 다름, model 빈 값), `invalid_insight_payload`(아래 모양 위반), `invalid_evidence_source`(JD 근거가 다른 지원 프로젝트를 가리키거나 `jd_sentence` 위치가 틀림 — 아래 "근거 출처 검사").
- **순서**: `complete_insight` → `complete_ai_job(job, run_generation)`. `stale_run`이면 `complete_ai_job`을 부르지 않는다. 작업을 먼저 끝내면(성공 포함) 트리거가 `generating` 행을 `failed`로 바꾼다.

```sql
fail_insight(p_insight_id uuid, p_ai_job_id uuid) returns boolean
```
- 행이 `generating`이고 `ai_job_id = p_ai_job_id`일 때만 `failed`로 바꾸고 true. 아니면 false(무시).
- 오류: `insight_not_found`.

### 트리거 (작업 종료 → 인사이트 실패)
- `insight` 작업이 `failed`(sweep의 `stalled` 포함)·`canceled`·`succeeded`로 바뀌면, 그 작업의 `generating` 행을 `failed`로 바꾼다. `succeeded`도 포함한 이유: `complete_insight` 없이 작업이 성공 처리되면 행이 영영 `generating`으로 남기 때문.
- 잠금(QA-S5-06): 트리거 경로는 프로젝트 행을 `for update skip locked`로 잡는다. 못 잡으면 아무것도 하지 않는다(삭제 중이면 행이 함께 사라진다). 드물게 다른 짧은 잠금과 겹치면 `generating`이 남을 수 있으므로, **api 조회는 "`generating`인데 그 작업이 이미 끝났거나 없음"을 실패로 취급**한다. 다음 `begin_insight`도 이 행을 `failed`로 정리한다.

### `p_payload` 모양 (ai-pipeline이 만들고 api가 그대로 넘김)

```jsonc
{
  "result": { ... },               // object. AI-02 최종 저장 형태(근거 제거, item_key·UUID 참조). 
                                   // 어느 깊이에도 "evidence" / "positioning_evidence" 키가 있으면 거부(C-3)
  "match_stage_result": { ... },   // object 또는 array. 단계 1 원본(병합본)
  "hashes": {
    "requirements_hash": "…",      // 1~128자
    "career_snapshot_hash": "…",   // 1~128자
    "input_hash": "…"              // 1~128자 (C-6 v4: 공급자·모델 포함)
  },
  "meta": {
    "schema_version": 1,           // 정수 ≥ 1
    "prompt_version": "ai-02.match.v1+ai-02.synthesize.v1+common.v1",  // 1~200자
    "provider": "gemini",          // = ai_jobs.provider
    "model": "gemini-…",           // 1~200자
    "model_tier": "default",       // = ai_jobs.model_tier
    "connection_tier": "free",     // = ai_jobs.connection_tier
    "validation_report": { ... } | null,   // object | null
    "usage": { ... } | null                // object | null (표시용 합계)
  },
  "evidence": [                    // array, 0~2000개. 원소 키는 EvidenceLinkInsert(snake_case)와 같다
    {
      "item_key": "requirement_matches.<요건uuid>",  // 1~200자
      "sort_order": 0,                  // 정수 ≥ 0 (item 안 순서)
      "source_type": "project_detail",  // profile|experience|education|project|project_detail|achievement|skill|jd_requirement|jd_sentence
      "source_id": "<uuid>",
      "source_field": "action" | null,  // C-3 표(DB CHECK). jd_* 는 null
      "quote": "…" | null,              // ≤ 2000자 [가정]
      "quote_adjusted": false,          // boolean, 생략 = false
      "source_locator": {"sid":"S3","start":120,"end":168} | null,  // jd_sentence는 필수, 그 밖은 null 권장
      "source_snapshot_at": "2026-11-01T00:00:00Z" | null,  // 생략/null = now()
      "source_label": "…" | null        // ≤ 300자 [가정]
    }
  ]
}
```
- `owner_type`·`owner_id`·`application_project_id`·`user_id`는 RPC가 채운다(원소에 있어도 무시). 즉 `toEvidenceLinkRows(...)` 결과에서 owner 키를 지우지 않고 그대로 넣어도 된다.
- `interview_answer`·`user_note` 출처는 인사이트에서 거부한다(`invalid_insight_payload`).
- 모르는 최상위 키는 무시한다.

### 근거 출처 검사 (`evidence_links` insert 트리거, S5에서 넘김)
- `jd_requirement`: `source_id` = `jd_requirements.id`. 같은 사용자 요건이 **다른 지원 프로젝트** 것이면 `invalid_evidence_source`. 요건이 아예 없으면(삭제됨) 커리어 출처와 같이 `quote = null`, `source_deleted_at = now()`로 저장.
- `jd_sentence`: `source_id` = `job_descriptions.id`(같은 사용자·같은 지원 프로젝트), `source_locator = {sid, start, end}`(start·end 정수, `start < end`, 그 문장의 `[start, end]` 범위 안). JD가 다른 프로젝트 것이거나 위치가 틀리면 `invalid_evidence_source`. JD가 없으면 삭제 처리.
- 요건 행·JD 행 삭제 시 근거에 `source_deleted_at` 기록(트리거). 요건 삭제는 MVP에 없지만 규칙은 둔다.

### 커리어 삭제 영향 (§4.2)
- `get_deletion_impact(...)`의 `affected_results.by_application_project`:
  `[{application_project_id, name, insights, drafts: 0, draft_sections: 0, interview_sessions: 0}]` — 인사이트가 1개 이상 걸린 프로젝트만, 이름순.
  `insights` = 삭제될 커리어 행(연쇄분 포함)을 가리키는 `owner_type = 'insight'` 근거를 가진 서로 다른 인사이트 수.
- `delete_career_item(..., p_result_mode)`: `delete_results`면 그 인사이트 행을 지우고(근거도 함께), 그 프로젝트에 latest가 없어지면 남은 `ready` 중 `version_no`가 가장 큰 행을 latest로 올린다 `[가정 3]`. `keep_results`면 근거만 "원본 삭제됨"이 된다. 반환 모양은 그대로.

## 테이블 `insights` (A.8 + 공통 AI 메타)
- 컬럼: `id`, `user_id`, `application_project_id`, `version_no`, `is_latest`(default false), `status`(`generating`/`ready`/`failed`), `result`, `match_stage_result`, `requirements_hash`, `career_snapshot_hash`, `input_hash`, `ai_job_id`, `run_generation`(내부용, QA-S6-01), `schema_version`, `prompt_version`, `provider`, `model`, `model_tier`, `connection_tier`, `validation_report`, `usage`, `completed_at`, `created_at`, `updated_at`.
- 읽기: 사용자 세션 select 본인(전체 컬럼), app_ai_writer select 본인. 직접 쓰기 권한은 어떤 역할에도 없다(RPC·연쇄만).
- 진행 표시(목록·보드): `select status, is_latest from insights where application_project_id = any(...)` 로 충분 → RPC 없음.


## 마이그레이션 파일
| 파일 | 내용 |
|------|------|
| `supabase/migrations/20261101000100_s6_insights.sql` | `insights`(A.8 + AI 메타), CHECK, 인덱스 4개, RLS, grant, 삭제 시 근거 삭제 트리거, service_role 쓰기 회수 |
| `supabase/migrations/20261101000200_s6_evidence_jd_sources.sql` | `evidence_links_check_source` 재정의(`jd_requirement`·`jd_sentence` 검사), 요건·JD 삭제 트리거 |
| `supabase/migrations/20261101000300_s6_insight_rpcs.sql` | payload 검사 헬퍼, `begin_insight`, `complete_insight`, `fail_insight`, `private.insight_mark_failed`, 작업 종료 트리거 `ai_jobs_release_insight` |
| `supabase/migrations/20261101000400_s6_jd_extraction_lock_order.sql` | QA-S5-06: `private.jd_extraction_mark_failed(jd, job, skip_locked)`로 교체, 트리거는 skip-locked 경로, 2인자 함수 삭제 |
| `supabase/migrations/20261101000500_s6_career_deletion_insights.sql` | `get_deletion_impact`·`delete_career_item` 재정의(시그니처·grant 동일), 헬퍼 `career_deletion_sources`·`career_deletion_insight_ids`·`insight_promote_latest`·`delete_insights_by_ids` |

## 테이블·컬럼 (스펙 대비 차이)
- `insights.ai_job_id`: soft reference 대신 **복합 FK `(ai_job_id, user_id)` → `ai_jobs` `on delete set null (ai_job_id)`**(S5 `extraction_job_id`와 같은 방식, 다른 사용자 작업 지정 차단, 90일 정리 때 null).
- CHECK: `is_latest`는 `ready`만, `ready`면 `result`·`match_stage_result`·`completed_at`·해시 3개·AI 메타 전부 not null(배지·stale 판정에 필요), 상태 3값, 공급자·등급 목록, 해시 ≤ 128, `prompt_version`·`model` ≤ 200, jsonb 형태.
- 인덱스: A.8 두 개 + `(application_project_id, created_at desc)` + `ai_job_id` 부분 인덱스(트리거 조회).
- `ai_jobs`에 `insight` 모양 CHECK(`target_type = 'application_project'` 등)는 **추가하지 않았다**. 기존 S3~S5 테스트 다수가 대상 없는 `insight` 작업을 만들기 때문이다. 대신 `begin_insight`가 작업 모양을 검사한다(`invalid_ai_job`).

## RLS·권한 요약 (DM §5 대비)
| 대상 | authenticated | app_ai_writer | service_role |
|------|---------------|---------------|--------------|
| insights | select 본인 | select 본인 | select·delete |
| begin/complete/fail_insight | 없음 | execute | 없음 |
| get_deletion_impact / delete_career_item | execute(invoker, 기존) | 없음 | — |

- 직접 insert·update·delete 권한은 어느 API 역할에도 없다(grants.test로 고정). 쓰기는 definer RPC·트리거·연쇄뿐.
- 커리어 삭제의 인사이트 삭제는 invoker RPC가 definer 헬퍼 `private.delete_insights_by_ids`(본인 행만, `auth.uid()` 검사)를 부른다. 이 헬퍼는 authenticated에 execute를 줬지만 `private`은 PostgREST에 노출되지 않는다.

## QA-S5-06 (잠금 순서) 수정
- 원인: 작업 종료 트리거가 `ai_jobs` 행을 쥔 채 프로젝트 행을 기다림(ai_jobs → 프로젝트), 프로젝트 삭제는 프로젝트 → (연쇄) ai_jobs.
- 수정: 트리거 경로만 프로젝트 행을 `for update ... skip locked`. 못 잡으면 아무것도 안 함. `fail_jd_extraction`·`fail_insight`(ai_jobs 잠금 없음)는 기다리는 기존 순서 유지. 인사이트 트리거도 같은 방식으로 처음부터 만들었다.
- 검증
  - pgTAP `supabase/tests/s6_lock_order.test.sql`: 구조 고정(2인자 함수 삭제, skip locked, 트리거가 true 경로 사용, fail RPC는 false 경로). 두 연결이 필요한 실제 교착 재현은 dblink 없이 pgTAP으로 할 수 없다.
  - **수동 두 세션 재현**(psql 2개, 로컬): 세션 D가 프로젝트 행을 `for update`로 잡고 2초 뒤 삭제, 그 사이 세션 T가 작업을 `canceled`로 갱신.
    - 수정 전 동작(트리거를 blocking으로 임시 교체): JD·인사이트 두 경우 모두 **`deadlock detected`(40P01)**, T 2.5초.
    - 수정 후: 두 경우 모두 T 0.05초에 끝나고 D도 정상 삭제, 오류 없음. 확인 뒤 `db reset`으로 되돌렸다.
- 남는 한계 `[가정]`: 짧은 다른 쓰기(이름 수정 등)와 겹쳐 트리거가 건너뛰면 JD `running`·인사이트 `generating`이 남는다. → **api 조회는 "`running`/`generating`인데 그 작업이 끝났거나 없음"을 실패로 보여야 한다**(S5 `read.ts`의 추출 상태 포함). 다음 `begin_jd_extraction`·`begin_insight`가 이 행을 인계·정리한다.

## 테스트 (`supabase test db`: 33파일 1444개, 모두 통과)
- 새 파일
  - `supabase/tests/insights.test.sql`(99): RLS·정책·인덱스, begin(작업 모양 4종·JD 미추출·남의 프로젝트·멱등·버전), complete(stale_run 세대·재호출·실패 후, invalid_ai_job, insight_not_found, **잘못된 payload 23종 → invalid_insight_payload**, 메타 불일치 4종, JD 근거 위반 2종, 실패 시 아무것도 안 남음, 정상 반영·근거 매핑·owner 키 무시·snapshot 기본값·last_activity_at), 재생성 latest 교체, fail 규칙, 트리거(failed·canceled·succeeded·sweep stalled), 멈춘 행 인계, `insight_in_progress`, 교차 사용자(사용자·app_ai_writer·sub 없음), 직접 쓰기 금지, CHECK·FK, 직접 근거 insert의 JD 출처 검사 10종, 요건 삭제 표시, 프로젝트·탈퇴 연쇄
  - `supabase/tests/insights_career_deletion.test.sql`(22): 프로젝트·상세·성과·스킬·경력(keep/delete_projects)·경력 단위 성과 연쇄별 `by_application_project`, 같은 인사이트 중복 링크 1회 집계, 이름순, keep_results, delete_results(근거 삭제·latest 재지정·failed 제외·latest 없음), 헬퍼는 남의 행 못 지움, 다른 사용자 집계 분리
  - `supabase/tests/s6_first_call_privileges.test.sql`(22): 실제 역할로 처음 호출(추출 → begin/complete/fail → 트리거 → 삭제 영향 → delete_results → 프로젝트 삭제)
  - `supabase/tests/s6_lock_order.test.sql`(10): 위 QA-S5-06 구조 검사
- 기존 파일 수정
  - `supabase/tests/grants.test.sql`: app_ai_writer 테이블·함수 허용 목록에 S6 추가, S6 RPC 실행 매트릭스, insights 직접 쓰기 금지(plan 27 → 29)
  - `supabase/tests/evidence_links.test.sql`: 삭제 트리거 목록에 JD 2개, `jd_sentence` 행을 실제 JD + 위치로 바꿈(가짜 id면 이제 "삭제됨"으로 저장됨)

## 원격 브랜치 적용 여부
적용하지 않았다(계획대로). 커밋도 하지 않았다.

## api·ai가 알아야 할 것
- 순서: `begin_insight`(prepare 단계, JD 추출 성공 뒤) → … → `complete_insight` → `complete_ai_job`. 실패는 `fail_insight` 또는 작업 실패 처리(트리거가 대신함, 순서 무관).
- `insight_not_found`(complete/fail)·`application_project_not_found`(begin)는 프로젝트 삭제도 뜻한다 → canceled처럼 처리.
- `input_hash` 재사용 조회: `insights where user_id, application_project_id, input_hash, status = 'ready'`(인덱스 있음). 최신은 `is_latest`.
- 진행 표시: `status`가 `generating`이고 그 `ai_job_id` 작업이 `queued`/`running`이면 생성 중. `generating`인데 작업이 끝났거나 null이면 실패로 본다.
- `complete_insight`는 `requirements_hash`를 현재 JD 값과 비교하지 않는다(파이프라인이 넘긴 값을 그대로 저장). stale 판정은 조회 쪽에서 JD·경력 현재 해시와 비교한다.
- 근거 원소의 `source_label`·`source_snapshot_at`·`source_locator`는 `toEvidenceLinkRows` 결과 그대로 넣으면 된다. `jd_sentence`는 `source_locator {sid,start,end}` 필수(그 문장 범위 안의 부분 구간 허용).

## 스펙 차이·가정 (spec-gaps.md "2026-11-01 · S6 (db)")
1. `insights.ai_job_id` 복합 FK(set null) `[구현 결정]`
2. 작업 종료 트리거에 `succeeded` 포함 `[구현 결정]`
3. skip-locked로 남을 수 있는 `running`/`generating`은 조회가 실패로 취급 `[가정]`
4. delete_results 후 latest 재지정 `[가정 3]`, `by_application_project` 모양·정렬·0 키 `[가정]`
5. 기획에 없는 길이 상한 `[가정]`
6. JD 근거 검사의 오류/삭제 구분, `jd_sentence` 부분 구간 허용 `[가정]`
7. 인사이트 근거 출처 9종 제한, `begin_insight`의 `jd_not_extracted` `[구현 결정]`
8. `ai_jobs` insight 모양 CHECK 미추가 `[구현 결정]`

## QA 1차 반영 (QA-S6-01, 2026-11-01)
- 문제: 실패한 인사이트 작업을 수동 재시도하면(같은 작업 행, `run_generation + 1`, `step_outputs` 유지) 작업 종료 트리거가 이미 `failed`로 바꾼 행 때문에 `complete_insight`가 항상 `stale_run` → `stalled`.
- 수정(커밋 전 S6 마이그레이션을 직접 고침)
  - `insights.run_generation` 추가: 행을 연(또는 실패시킨) 실행 세대. `begin_insight`가 작업 세대로 넣고, `private.insight_mark_failed`(트리거·`fail_insight`)가 실패시킨 작업 세대로 찍는다.
  - `begin_insight`: 같은 작업의 `failed` 행 + 작업 `queued`/`running` + 행 세대 < 작업 세대 → `generating`으로 다시 열고 세대 갱신. `ready`·같은 세대 실패는 그대로(멱등 유지).
  - `complete_insight`: 행이 `generating`이거나, `failed`이면서 행 세대 < `p_run_generation`이면 반영(`begin`을 다시 부르지 않는 재시도 경로). 같은 세대에서 실패한 행(`fail_insight`)은 여전히 `stale_run`. 반영 시 `run_generation = p_run_generation`.
  - 재시도는 같은 행을 쓰므로 버전 번호가 늘지 않는다.
- 테스트: `supabase/tests/insights_retry.test.sql`(20): ① 실패 → 재시도 → `begin` 재호출(같은 행, 다시 열림) → 늦은 세대 1 `complete` = stale_run → 세대 2 `complete` 반영, ② `begin` 없이 세대 2 `complete` 반영, ③ 같은 세대 `fail_insight` 뒤 `begin`·`complete`는 다시 열지 않음 → 다음 재시도에서는 반영. QA 재현 스크립트(`retry_repro.sql`)도 이제 `applied: true`.
- **S5 `begin_jd_extraction` 확인 → 같은 틈 없음**: `jd_extraction` 작업은 수동 재시도(requeue) 대상이 아니다(`runner.ts`가 `notRetryable`, 재시도는 새 작업). 또 `begin_jd_extraction`은 `failed` JD를 작업 id와 무관하게 `running`으로 되돌리고, `apply`는 작업 세대만 본다. 변경하지 않았다.
- 남는 경계 `[가정]`: 다른 작업의 `begin_insight` 인계로 `failed`가 된 옛 행도, 그 옛 작업이 나중에 수동 재시도되면 다시 열려 latest가 될 수 있다(동시 실행 1개 제약 때문에 새 작업이 끝난 뒤에만 가능). 사용자가 직접 누른 재시도의 결과이므로 그대로 둔다.
