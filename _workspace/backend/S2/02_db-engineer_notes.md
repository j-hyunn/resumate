# S2 DB 구현 노트

> 상태: 완료. `supabase db reset` OK, `supabase test db` PASS(9파일 263개), 타입 재생성, `pnpm typecheck` 통과, `pnpm test` 19파일 221개 통과(api-engineer 커리어 통합 테스트 포함).

## 마이그레이션 파일
| 파일 | 내용 |
|------|------|
| `supabase/migrations/20261025000100_s2_experiences.sql` | experiences + status 트리거 + updated_at + career_data 트리거 + RLS + grant |
| `supabase/migrations/20261025000200_s2_educations.sql` | educations (같은 구성) |
| `supabase/migrations/20261025000300_s2_projects.sql` | projects + `private.project_is_complete()` + status 트리거 |
| `supabase/migrations/20261025000400_s2_project_details.sql` | project_details + status·sort_order 트리거 + 부모 프로젝트 status 재계산 트리거 + 순서만 바뀌면 updated_at 유지 |
| `supabase/migrations/20261025000500_s2_achievements.sql` | achievements + `kind` generated + status 트리거 |
| `supabase/migrations/20261025000600_s2_skills.sql` | skills(`normalized_name` generated) + project_skills + 고아 태그 스킬 삭제 트리거 |
| `supabase/migrations/20261025000700_s2_get_data_readiness.sql` | `get_data_readiness()` |
| `supabase/migrations/20261025000800_s2_reorder_project_details.sql` | `reorder_project_details()` |
| `supabase/migrations/20261025000900_s2_career_deletion_rpcs.sql` | `get_deletion_impact()`, `delete_career_item()` |

생성 타입: `src/server/db/database.types.ts` (`supabase gen types typescript --local`, 손대지 않음).

## 테이블·컬럼 (스펙 대비 차이 포함)

공통: `id uuid` PK, `user_id uuid not null default auth.uid()` → `auth.users on delete cascade`, `created_at`, `updated_at`(트리거, project_skills 제외), `unique (id, user_id)`(project_skills 제외).

### status — DB가 계산 (클라이언트는 보내지 않는다)
- 5개 테이블(experiences, educations, projects, project_details, achievements)의 BEFORE INSERT/UPDATE 트리거가 `status`를 계산한다. **`status`는 insert/update grant에 없다** → 클라이언트가 `status`를 보내면 42501. 저장 후 응답(`.select('id,status,updated_at')`)으로 읽는다.
- 빈 문자열·공백만 있는 값은 "없음"으로 본다(`btrim = ''`). 그 값은 그대로 저장되고 status만 draft.
- complete 조건: DM §2.2 표 그대로.
  - experiences: `company_name`, `start_month`, (`job_rank` 또는 `job_position`)
  - educations: `institution_name`, `education_type`, `start_month`
  - project_details: `title`, `situation`, `action`
  - projects: `name`, `role` + 이 프로젝트의 complete 상세 내용 ≥ 1
  - achievements: `description` 또는 (`metric_name` and (`value_before` or `value_after`))
- 프로젝트 재계산: project_details insert / delete / (status 또는 project_id 변경 update) 뒤에 부모 프로젝트를 다시 계산한다. **status가 실제로 바뀔 때만** 프로젝트 행을 update → 그때 `projects.updated_at`도 바뀐다(DM §4.2). 상세 내용 본문만 고친 경우 프로젝트 `updated_at`은 그대로.

### 테이블별
- **experiences** (A.3): `is_current boolean not null default false`. CHECK: `employment_type` 5종, `summary ≤ 2000`, 년-월 1일, `end_month >= start_month`, `is_current → end_month is null`. 인덱스 `(user_id, start_month desc)`, `(user_id) where draft`.
- **educations** (§2.3): CHECK `education_type` (degree, course), `enrollment_status` 5종, `enrolled → end_month is null`, 길이(institution_name·program_name ≤ 100, description ≤ 2000). 인덱스 같음.
- **projects**: 복합 FK `(experience_id, user_id)`·`(education_id, user_id)` `on delete set null (experience_id|education_id)` → 소속 삭제 시 독립 프로젝트. `num_nonnulls(experience_id, education_id) <= 1`. `summary ≤ 200`. **스펙에 없는 추가 CHECK**: `end_month >= start_month`, `team_size >= 1` [구현 결정]. 인덱스 `(user_id, experience_id)`, `(user_id, education_id)`, `(user_id, start_month desc)`, `(user_id) where draft`.
- **project_details**: 복합 FK `(project_id, user_id)` cascade. 길이 title ≤ 100, 나머지 STAR·learnings ≤ 2000. `sort_order smallint not null`, `unique (project_id, sort_order) deferrable initially deferred`, `sort_order >= 1`.
  - **insert 때 `sort_order`를 생략하면(null) 트리거가 `max + 1`(첫 행 1)로 채운다.** 단, 생성 타입의 `Insert.sort_order`는 필수(`number`)로 나온다(gen types가 트리거 기본값을 모름). api는 값을 직접 넣거나, 생략하려면 타입 단언이 필요하다.
  - `project_id`는 update 불가(상세 내용은 프로젝트 사이를 옮기지 않는다).
  - 순서만 바뀐 update(`reorder`)는 `updated_at`을 바꾸지 않는다(근거 칩 "변경됨" 오탐 방지) [구현 결정].
- **achievements**: 복합 FK `(project_detail_id, user_id)` → project_details cascade, `(experience_id, user_id)` → experiences cascade. `num_nonnulls(project_detail_id, experience_id) = 1`. `value_before`/`value_after` numeric. `kind` generated stored: `quantitative`(공백 아닌 metric_name + 값 하나 이상) / `qualitative` [가정]. status와 같은 "값 있음" 기준(`nullif(btrim(metric_name), '')`, QA-S2-06). 소유(project_detail_id/experience_id)는 update 불가. **길이 제한은 스펙에 없어 두지 않음**(metric_name, unit, description).
- **skills**: `name not null`, `1 ≤ char_length(btrim(name)) ≤ 50`. `normalized_name` generated stored = `lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))`, `unique (user_id, normalized_name)`. `is_manual boolean not null default true`(직접 추가 기본, 태그로 만들 때 `false`를 명시). `proficiency` CHECK (basic, practical, expert).
  - TS에서 기존 스킬 찾기: `normalized_name = name.trim().replace(/\s+/g, ' ').toLowerCase()`로 select. 중복 insert는 `23505`(unique) — 이걸 잡아 재조회해도 된다.
- **project_skills**: PK `(project_id, skill_id)`, `user_id`, `created_at`만(updated_at 없음, A.4). 양쪽 복합 FK cascade. update 정책·grant 없음(링크는 넣고 지우기만). 인덱스 `(user_id, skill_id)`.
  - 링크 삭제(직접 또는 프로젝트 삭제 연쇄) 후 그 스킬이 `is_manual = false`이고 링크 0이면 스킬 자동 삭제.
- `source_writing_chat_id` (projects, project_details, achievements): uuid 컬럼만, FK는 S4. insert grant만 있음(update grant는 S4 `save_writing_chat` 보강 모드에서 필요하면 추가).
- 7개 테이블 모두 `profiles.career_data_updated_at` 트리거 연결.

### 쓰기 가능한 컬럼 (authenticated)
| 테이블 | insert | update |
|--------|--------|--------|
| experiences | id, user_id, company_name, start_month, end_month, is_current, job_rank, job_position, department, employment_type, summary | id, user_id 제외 같은 목록 |
| educations | id, user_id, institution_name, education_type, program_name, start_month, end_month, enrollment_status, description | id, user_id 제외 |
| projects | id, user_id, experience_id, education_id, name, role, summary, start_month, end_month, team_size, source_writing_chat_id | experience_id, education_id, name, role, summary, start_month, end_month, team_size |
| project_details | id, user_id, project_id, title, situation, task, action, result, learnings, sort_order, source_writing_chat_id | title, situation, task, action, result, learnings, sort_order |
| achievements | id, user_id, project_detail_id, experience_id, metric_name, value_before, value_after, unit, description, source_writing_chat_id | metric_name, value_before, value_after, unit, description |
| skills | id, user_id, name, is_manual, proficiency | name, is_manual, proficiency |
| project_skills | project_id, skill_id, user_id | 없음 |

`id`는 insert 때 클라이언트가 정할 수 있다(자동 저장 멱등성용, 생략하면 gen_random_uuid). `status`, `kind`, `normalized_name`, `created_at`, `updated_at`은 쓰기 불가. `user_id`는 생략하면 `auth.uid()`. 낙관적 동시성(`expectedUpdatedAt`)은 api 쪽에서 `.eq('updated_at', expected)` 조건으로 구현 가능(0행이면 conflict).

## RPC 시그니처와 반환 형태

모두 `revoke all from public, anon`. 오류는 `errcode` / `message`(소문자 코드).

### `get_data_readiness() returns jsonb`
- security invoker, `stable`. 실행: **authenticated, app_ai_writer**(AI Route Handler 재확인용, DM §6).
- 타입: `Args: Record<PropertyKey, never>; Returns: Json` → api에서 zod로 파싱.
- 반환 (DM §6 그대로):
```json
{
  "counts": {
    "complete_experiences": 0, "complete_educations": 0,
    "complete_projects": 0, "projects_without_complete_detail": 0,
    "complete_project_details": 0, "draft_project_details": 0,
    "draft_experiences": 0, "draft_educations": 0, "draft_projects": 0,
    "profile_filled": false
  },
  "draft_item_ids": { "experiences": ["uuid"], "educations": [], "projects": [], "project_details": [] },
  "features": {
    "insight":       { "ready": false, "missing": ["complete_experience", "complete_project"], "hints": ["profile"], "next_action": "form" },
    "draft":         { "...insight와 같은 객체" : "" },
    "job_interview": { "...insight와 같은 객체" : "" },
    "culture_fit_interview": { "ready": true, "data_sufficiency": "none" }
  }
}
```
- 규칙:
  - "포함 프로젝트" = 소속이 없거나 소속 경력·교육이 complete인 프로젝트. `complete_projects`, `projects_without_complete_detail`, `complete_project_details`, `suggested_project_id`는 포함 프로젝트만 본다.
  - `complete_experiences`/`complete_educations`: complete 행 수. `draft_*`: draft 행 수(전체).
  - `projects_without_complete_detail`: 포함 프로젝트 중 complete 상세 내용이 없는 수.
  - `complete_project_details`: complete 상세 내용 중 부모 프로젝트가 complete이고 포함 프로젝트인 것.
  - `profile_filled`: `desired_job_title`(공백 아님) / `total_years_of_experience` / `interested_industries`(비지 않음) 중 하나 [가정].
  - `draft_item_ids`: draft 행 id, `updated_at desc` 순.
  - insight / draft / job_interview: **같은 객체**. 항상 `ready`, `missing`(배열, ready면 `[]`), `hints`(배열) 3개 키.
    - `missing`: `complete_experience`(complete 경력 0), `complete_project`(complete 포함 프로젝트 0). 순서도 이 순서.
    - `hints`: `complete_project_detail`(complete_projects = 0이고 projects_without_complete_detail > 0), `profile`(profile_filled = false — ready여도 붙음).
    - ready = false일 때만: complete 경력 0이면 `next_action: "form"`(**suggested_mode 없음**). 아니면 `next_action: "writing_chat"` + 후보가 있으면 `suggested_mode: "augment_project"`, `suggested_project_id`(최근 수정 포함 프로젝트 중 complete 상세 없는 것), 없으면 `suggested_mode: "new_project"`.
  - `culture_fit_interview`: `{ ready: true, data_sufficiency }` — `ok`(D-01 충족) / `thin`(profile_filled 또는 complete 경력·교육·상세 내용 > 0) / `none`.
- 오류: `42501 not_authenticated`(JWT sub 없음).

### `reorder_project_details(p_project_id uuid, p_ordered_ids uuid[]) returns void`
- security invoker. 실행: authenticated. 타입 `Args: { p_ordered_ids: string[]; p_project_id: string }; Returns: undefined`.
- `p_ordered_ids` = 그 프로젝트의 상세 내용 id **전체**를 새 순서로, 중복·null 없이. 결과 `sort_order` = 1..n. 순서만 바뀐 행은 `updated_at` 유지.
- 오류: `42501 not_authenticated`, `P0001 career_item_not_found`(프로젝트가 없거나 남의 것), `P0001 invalid_detail_order`(빠짐·추가·중복·null·다른 프로젝트 id).

### `get_deletion_impact(p_entity_type text, p_entity_id uuid, p_affiliation_mode text default 'keep_projects') returns jsonb`
- security invoker, `stable`. 실행: authenticated. 타입 `Args: { p_entity_type: string; p_entity_id: string; p_affiliation_mode?: string }; Returns: Json`.
- `p_entity_type` ∈ `experience`, `education`, `project`, `project_detail`, `achievement`, `skill` (`writing_chat`은 S4에서 추가 — 지금은 `invalid_entity_type`).
- `p_affiliation_mode` ∈ `keep_projects`(기본, null도 기본) / `delete_projects`. 경력·교육 외에는 값 검사만 하고 무시.
- 반환:
```json
{
  "cascade": { "projects": 0, "project_details": 0, "achievements": 0, "project_skills": 0, "writing_chats": 0 },
  "affected_results": { "by_application_project": [] }
}
```
  - `cascade`는 **대상과 함께 지워지는 하위 행 수(대상 자신은 제외)**. 예: 프로젝트 삭제 → `projects: 0`, 그 상세 내용·성과·태그 수.
  - 경력 + keep_projects → 경력 단위 성과 수만. 경력 + delete_projects → 소속 프로젝트 수와 그 하위 + 경력 단위 성과. 교육도 같음(경력 단위 성과 없음). 상세 내용 → 그 성과 수. 스킬 → 그 스킬의 project_skills 수. 성과 → 모두 0.
  - 고아 태그 스킬 자동 삭제분은 세지 않는다.
  - `affected_results.by_application_project`는 S2에서 항상 `[]`, `writing_chats`는 항상 0(결과 테이블은 S3·S5–S7, 대화는 S4에서 `create or replace`로 확장).
- 오류: `42501 not_authenticated`, `P0001 invalid_entity_type`, `P0001 invalid_affiliation_mode`, `P0001 career_item_not_found`.

### `delete_career_item(p_entity_type text, p_entity_id uuid, p_affiliation_mode text default 'keep_projects', p_result_mode text default 'keep_results') returns jsonb`
- security invoker(DM §5). 실행: authenticated. 타입 `Args: { p_entity_type: string; p_entity_id: string; p_affiliation_mode?: string; p_result_mode?: string }; Returns: Json`.
- **`p_result_mode` ∈ `keep_results`(기본) / `delete_results`** — UX 02 C-05의 값 이름. 계획(01_plan)의 `keep`/`delete`와 다르다(spec-gaps 2026-10-25 정정 항목). S2에서는 지울 결과가 없어 값 검사만.
- 반환 (삭제 전에 센 영향 + 입력 echo):
```json
{
  "entity_type": "project", "entity_id": "uuid",
  "affiliation_mode": "keep_projects", "result_mode": "keep_results",
  "cascade": { "projects": 0, "project_details": 2, "achievements": 1, "project_skills": 3, "writing_chats": 0 },
  "affected_results": { "by_application_project": [] }
}
```
- 동작: 경력·교육 + delete_projects면 소속 프로젝트(하위 전체)를 먼저 지우고 대상 삭제. keep_projects면 FK가 프로젝트의 소속을 null로(독립 프로젝트). 상세 내용 삭제 시 부모 프로젝트 status 재계산(마지막 complete 상세 내용이면 draft + updated_at 갱신).
- 오류: `get_deletion_impact`의 오류 전부 + `P0001 invalid_result_mode`. 실패 시 아무것도 지우지 않음.

## RLS·권한 요약 (DM §5 대비)
- 7개 테이블: `<table>_select_own`, `_insert_own`, `_update_own`, `_delete_own`(authenticated, `user_id = (select auth.uid())`), `_select_ai_writer`(`user_id = (select private.current_uid())`). project_skills는 update 정책 없음(갱신할 컬럼 없음).
- authenticated: 테이블 select·delete + 위 표의 컬럼 insert/update.
- app_ai_writer: **7개 테이블 테이블 단위 select만**(커리어 팩은 모든 컬럼을 읽는다). 쓰기 없음. `grants.test.sql` 허용 목록 갱신.
- anon: 없음.
- 트리거 함수는 `private` 스키마. `private.project_is_complete(uuid, text, text)`는 security invoker + `grant execute to authenticated`(projects BEFORE 트리거가 사용자 권한으로 부른다). security definer: `project_details_sync_project_status`(사용자에게 projects.status update 권한이 없어서), `project_skills_delete_orphan_skill`(연쇄 삭제 안에서도 동작), 기존 `touch_career_data_updated_at`. 모두 `search_path = ''`.

## 테스트 (`supabase test db` 결과)
`supabase db reset` 성공, `supabase test db` — **Files=9, Tests=263, PASS** (S2 신규 4파일 + grants 갱신).
- `supabase/tests/career_tables.test.sql`: RLS 활성·정책 목록(7개 테이블), A/B 격리(select 0행, update·delete 무효 확인), insert 시 남의 `user_id` 거부, 복합 FK로 남의 경력·교육·프로젝트·상세 내용·스킬 연결 차단(23503), 테이블별 status 계산(빈 문자열 = 없음 포함), `status` 쓰기 거부, CHECK(년-월 1일, 기간, is_current, 열거값, 길이, 소속 1개, 성과 소유 1개), 상세 내용 추가·수정·삭제에 따른 프로젝트 status·updated_at 변화(상태가 안 바뀌면 updated_at 유지), `career_data_updated_at` 갱신, sort_order 기본값, kind, normalized_name·unique, 고아 태그 스킬 삭제(수동 스킬 유지), project_id·성과 소유 update 거부, anon 거부, app_ai_writer 본인 행 select만·쓰기 전부 거부, 경력 삭제 시 프로젝트 독립(set null)·경력 단위 성과 cascade, 계정 삭제 시 7개 테이블 cascade.
- `supabase/tests/get_data_readiness.test.sql`: 빈 계정 전체 JSON, 프로필만(thin), 교육만(D-01 미충족·form), augment_project(+ suggested_project_id, counts, draft_item_ids), ready(키 생략), draft 소속 아래 complete 프로젝트 제외(new_project), 교육 소속 프로젝트 인정, B 데이터 비유출, app_ai_writer 실행, sub 없음 42501, anon 거부.
- `supabase/tests/career_deletion_rpcs.test.sql`: 영향 집계 6종 × 모드, 오류 분기(invalid_entity_type·null·writing_chat, invalid_affiliation_mode, invalid_result_mode, career_item_not_found — 남의 것·없는 id), 실패 시 삭제 없음, 실제 삭제와 연쇄(상세 내용 → 프로젝트 draft, 경력 keep_projects, 프로젝트 → 고아 스킬, 교육 delete_projects, 스킬, 성과), B 행 불변, reorder(새 순서, 1..n, updated_at 유지, 빠짐·중복·외부·null id, 남의 프로젝트, 한 트랜잭션 2회 + 지연 unique 즉시 검사), app_ai_writer·anon 실행 불가.
- `supabase/tests/career_first_call_privileges.test.sql`(회귀 방지): 세션에서 **첫 호출을 실제 역할로** 하는 쓰기·RPC 경로 전체. 이유는 아래 "발견한 버그".
- `supabase/tests/grants.test.sql` 갱신(7개): app_ai_writer 테이블 권한 허용 목록 = 커리어 7개 테이블 SELECT(profiles 컬럼 단위 제외), `profiles.display_name` 불가, app_ai_writer가 실행 가능한 public 함수 = `get_data_readiness`만.

### 발견한 버그와 교훈 (QA 참고)
- 첫 버전에서 `private.project_is_complete`에 authenticated EXECUTE grant가 없었다. pgTAP은 통과했지만 api-engineer의 통합 테스트(PostgREST 경유)가 `permission denied for function project_is_complete`로 실패했다.
- 원인: plpgsql은 단순 식(`new.status := case when f(...)`)의 실행 상태를 **트랜잭션 단위로 캐시**하고 EXECUTE 권한은 그 초기화 때만 검사한다. pgTAP 파일이 postgres로 먼저 insert하면 이후 `set role authenticated`에서도 검사가 다시 일어나지 않는다.
- 조치: 함수를 security invoker로 바꾸고 `grant execute ... to authenticated`(S2 마이그레이션 파일 안에서 수정 — 로컬에만 적용됐고 공유 전). 회귀 테스트 파일을 추가했고, grant를 회수하면 그 파일이 실패하는 것을 확인했다.
- 이후 슬라이스: 트리거·invoker RPC가 부르는 private 헬퍼는 "첫 호출을 실제 역할로" 하는 테스트로 확인할 것.

## 원격 브랜치 적용 여부
하지 않음(계획대로 로컬 전용).

## 스펙 차이·가정 (spec-gaps.md에 기록한 항목)
- (계획 단계 기록, 그대로 구현) achievements `kind` 계산식, skills `normalized_name` 규칙.
- **정정**: `delete_career_item` 모드 값 — UX 02 C-05에 이미 `keep_results`/`delete_results`가 있어 그 값으로 구현(계획의 `keep`/`delete` 아님). api `RESULT_MODES`와 일치 확인.
- (신규) `profile_filled` 정의, readiness 세부 규칙(form이면 suggested_mode 없음, 포함 규칙 적용 범위, profile hint, missing/hints 항상 존재), `cascade` 집계 범위(대상 제외, 고아 스킬 미집계), 길이 제한 누락 필드.
- 구현 결정(스펙 침묵, 노트에만): 빈 문자열 = 없음, projects `end_month >= start_month`·`team_size >= 1`, `sort_order >= 1` + 생략 시 자동 부여, 순서만 바뀌면 상세 내용 `updated_at` 유지, 부모 프로젝트 `updated_at`은 status가 바뀔 때만 갱신, skills `is_manual` 기본 true·이름 공백 불가, project_skills update 정책 없음, `id` insert 허용, 상세 내용 `project_id`·성과 소유 update 불가, readiness를 app_ai_writer도 실행.

## S4 이후 할 일 (메모)
- `source_writing_chat_id` 3곳에 FK(`writing_chats on delete set null`) 추가, `save_writing_chat` 보강 모드에 필요하면 update grant 추가.
- `get_deletion_impact`/`delete_career_item`: `writing_chat` 대상·`cascade.writing_chats`(S4), `affected_results`와 `delete_results` 처리(S3·S5–S7) — `create or replace`.
- grants.test.sql 허용 목록은 DM §5 변경 때만 같이 갱신.

## QA 라운드 1 반영 (2026-10-25)
S2 마이그레이션은 로컬 전용·미커밋이라 파일 안에서 수정했다(새 마이그레이션 없음).
- **QA-S2-06**: `achievements.kind` generated 식을 `nullif(btrim(metric_name), '') is not null and (value_before or value_after)`로 바꿔 status 트리거와 기준을 맞췄다. 공백만 있는 metric_name + 값 → `draft` + `qualitative`. 테스트 추가(`career_tables.test.sql`).
- **QA-S2-05**: `grants.test.sql`에 "app_ai_writer는 public 어느 컬럼에도 INSERT/UPDATE/REFERENCES 권한이 없다" 항목 추가(`has_column_privilege` 전수, 8개 항목). `grant update (summary) on experiences to app_ai_writer`를 넣으면 이 항목이 실패하는 것을 확인했다. S4에서 writing_chats 3컬럼·writing_chat_messages assistant 컬럼이 생기면 허용 목록으로 바꾼다.
- **QA-S2-04 (DB 부분, 리더 결정)**: 이미 구현된 동작을 확인했다 — `project_details_sync_project_status`는 계산한 status가 현재와 다를 때만 projects를 update하므로 그때만 `projects.updated_at`이 바뀐다. 테스트 "editing a detail without a status change leaves project updated_at", "project updated_at bumps when its status is recalculated"가 지킨다. (경력·교육 삭제 시 FK set null로 소속 프로젝트의 `updated_at`이 바뀌는 것은 FK 동작이라 그대로.)
- **클라이언트 `id` insert**: 리더 결정대로 유지(6개 테이블 insert grant에 `id` 포함). 변경 없음.
- 확인: `supabase db reset` OK, `supabase test db` **Files=9, Tests=265 PASS**, 타입 재생성 결과 변경 없음, `pnpm typecheck` 통과.
- `pnpm test`: 이번 실행에서 27개 실패. 모두 `src/lib/contracts/career.test.ts`와 `career.integration.test.ts`의 **ZodError**(입력 계약 쪽 — api-engineer가 QA-S2-02/03 id 계약을 병렬로 고치는 중)이고, 같은 시간대 DB 로그에 authenticator 권한 오류는 없다. DB 원인 아님. api 수정이 끝난 뒤 다시 돌려야 한다.
