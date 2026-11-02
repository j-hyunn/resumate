# R4 DB 구현 노트 (커리어 재설계 CR-1~CR-24, DM v4.4)

- 기준: DM v4.4 11장 + 2.3·2.5·2.8·3.3·4.1~4.3·5·6장, PRD F-P1-19(CR-17 키 목록), decisions 3.9
- 결과: `supabase db reset` 통과, `supabase test db` **51개 파일 2,382개 테스트 전부 통과**
- 원격 개발 브랜치: 적용 안 함(계획대로). 커밋 안 함.
- `src/server/db/database.types.ts` 재생성 완료(`project_details`·`achievements`·`save_writing_chat` 등 사라짐, `project_deliverables`·`apply_writing_chat_proposal`·`reorder_project_deliverables` 생김). **TS 쪽은 이 타입 변경으로 컴파일이 깨진다 — api·ai 몫.**

## 마이그레이션 파일 (새 파일만, 기존 파일 수정 없음)

| 파일 | 내용 |
|------|------|
| `20261109100100_r4_clear_career_chat_data.sql` | `[가정]` 데이터 비우기: `evidence_links`(source_type `project`/`project_detail`/`achievement`), `draft_section_sources`(project_id 있는 행), `writing_chats`(+메시지), `achievements`, `projects`(+details·project_skills 연쇄). 경력·교육·프로필·스킬(수동)·지원 프로젝트는 유지 |
| `…100200_r4_drop_project_details_achievements.sql` | `project_details`·`achievements`·`reorder_project_details`·관련 트리거 함수·`private.project_is_complete` 삭제, `draft_section_sources.project_detail_ids`(+CHECK, `private.draft_sources_remove_project_detail`) 삭제 |
| `…100300_r4_projects_v44.sql` | `projects` v4.4: 컬럼·CHECK·FK cascade·트리거(완료 판정, 범위 변경 거부, `content_updated_at`)·부분 인덱스·grant. `private.text_array_is_distinct` |
| `…100400_r4_project_skills_standalone.sql` | `project_skills` 독립 프로젝트 한정 트리거 |
| `…100500_r4_project_deliverables.sql` | `project_deliverables` 테이블·RLS·grant·트리거(독립 한정·50개·sort_order 기본값·updated_at·career_data·근거 삭제 표시), `reorder_project_deliverables` |
| `…100600_r4_evidence_links_v44.sql` | `evidence_links` source_type/source_field CHECK 교체, `private.evidence_links_check_source`(산출물 원본 확인, 프로젝트 종류↔필드 검사) |
| `…100700_r4_result_rpcs_evidence_types.sql` | 결과 RPC 근거 허용 목록(`project_deliverable` 추가, `project_detail`·`achievement` 삭제)과 V-8(`project.learnings`): `private.insight_payload_valid`, `private.interview_result_payload_valid`, `save_interview_question`, `complete_career_description`, `complete_cover_letter_section` |
| `…100800_r4_writing_chats_v44.sql` | `writing_chats` 컬럼·CHECK·인덱스, 가드/소속 한정/작업 취소 트리거, `status` grant 회수, 빈 초안 v3, 시작 인사 4종, `start_writing_chat(p_project_id, p_return_target)`, 폐기 RPC 삭제 |
| `…100900_r4_writing_chat_message_rpcs.sql` | `append_writing_chat_message`(closed 거부, title), `begin_assistant_message`(closed 거부), `finish_assistant_message`(closed 전이) |
| `…101000_r4_structured_draft_patch_v3.sql` | `apply_structured_draft_patch` v3 (impl 교체), `wc_normalize_draft`·`wc_value_ok` 교체, `private.classification_keys`, `private.wc_classification_value` |
| `…101100_r4_apply_writing_chat_proposal.sql` | `apply_writing_chat_proposal` + definer 헬퍼 `private.wc_proposal_lock`, `private.wc_proposal_mark_applied` |
| `…101200_r4_get_data_readiness.sql` | `get_data_readiness` v4.4 |
| `…101300_r4_career_deletion_rpcs.sql` | `private.career_deletion_sources`·`career_deletion_section_ids`, `get_deletion_impact`, `delete_career_item` |
| `…101400_r4_draft_sources_v44.sql` | `set_section_sources`, `private.draft_section_sources_json`(project_detail_ids 제거) |
| `…101500_r4_account_deletion.sql` | `get_account_deletion_summary`, `delete_account` 테이블 목록 |
| `…101600_r4_application_default_name.sql` | `private.application_default_name` → "새 자기소개서 (YYYY-MM-DD)" (CR-23 `[가정]`) |

- 파일명: 처음엔 `20261107…`로 썼고 리더가 `20261109100100`~`20261109101600`으로 바꿨다(w1 `20261108000100` 뒤로 정렬). 위 표의 `…1001xx` 약칭은 이 새 번호다. QA 1라운드 수정은 `20261109101700_r4_qa1_fixes.sql`.
- 이전 정의를 그대로 옮긴 RPC는 `pg_get_functiondef` 결과에 필요한 줄만 고쳤다(파일 머리 주석에 표시).

## 테이블·컬럼

### projects (DM 2.3)
- 추가: `is_current boolean not null default false`, `project_type text`, `experience_type text`, `competencies text[] not null default '{}'`, `situation`/`task`/`action`/`result`/`learnings text`, `description text`, `link_url text`, `content_updated_at timestamptz not null default now()`
- 삭제: `summary`, `team_size`. `name` not null(+`btrim(name) <> ''`). `role` 선택(독립 전용).
- CHECK: `projects_is_current_check`(`NOT is_current OR end_month IS NULL`), `projects_project_type_check`, `projects_experience_type_check`, `projects_competencies_check`(원소 목록·≤3·중복 없음·null 없음), STAR 각 ≤2,000, `description` ≤5,000, `link_url` ≤2,048 + `^https?://`, DM-20 3개 = `projects_standalone_shape_check`, `projects_affiliated_shape_check`, `projects_complete_check`
- FK: `projects_experience_fkey`/`projects_education_fkey` → **on delete cascade**(CR-15)
- 트리거: `projects_set_status`(소속 = name+situation+action, 독립 = name+description, 공백만 = 빈 값), `projects_guard_scope`(소속↔독립 전환 → `project_scope_change_not_allowed`, 경력↔교육 이동은 허용), `projects_set_content_updated_at`(name·start_month·end_month·is_current·STAR 5·role·description 바뀔 때만; 클라이언트 쓰기 불가)
- 인덱스: `projects_user_id_standalone_idx (user_id) where experience_id is null and education_id is null`
- 사용자 grant: insert `(id, user_id, experience_id, education_id, name, role, start_month, end_month, is_current, project_type, experience_type, competencies, situation, task, action, result, learnings, description, link_url)`, update 같은 목록(id·user_id 제외). **`status`·`content_updated_at`·`source_writing_chat_id`는 사용자 쓰기 불가**(`source_writing_chat_id`는 반영 RPC의 definer 헬퍼가 씀).

### 분류 enum 값 (CR-17, DB에는 키만) — TS `as const`와 맞출 것

| 컬럼 | 키 |
|------|----|
| `project_type` | `new_build`, `improvement`, `operation`, `research`, `marketing`, `process_improvement`, `migration`, `coursework`, `other` |
| `experience_type` | `impact`, `problem_solving`, `collaboration`, `leadership`, `failure_recovery`, `new_challenge`, `customer_facing` |
| `competencies` 원소 (최대 3, 순서 저장) | `problem_solving`, `analysis`, `planning`, `execution`, `communication`, `collaboration`, `leadership`, `technical_expertise`, `customer_insight`, `learning_agility` |

### project_deliverables (신설)
- `id, user_id (default auth.uid()), project_id not null, title text not null (공백 아님, ≤100), body text not null default '' (≤20,000), sort_order smallint not null (≥1), created_at, updated_at`
- `unique (id, user_id)`, 복합 FK `(project_id, user_id) → projects on delete cascade`, `unique (project_id, sort_order) deferrable initially deferred`, 인덱스 `(user_id)`
- insert 트리거: 소속 프로젝트면 `deliverable_requires_standalone_project`, 51번째면 `deliverable_limit_reached`(50개 `[가정]`), `sort_order` 생략 시 최댓값+1. 부모 행을 `for no key update`로 잠가 동시 insert를 줄 세운다.
- `updated_at`은 title/body가 바뀔 때만 움직인다(순서만 바꾸면 그대로 — 근거 `source_snapshot_at` 기준이므로).
- RLS 4동작 본인 + `app_ai_writer` select. 사용자 grant: insert `(id, user_id, project_id, title, body, sort_order)`, update `(title, body, sort_order)`(project_id 고정).
- 부모 `status`·`content_updated_at`에 영향 없음.

### project_skills
- insert 트리거 `project_skill_requires_standalone_project`(소속 프로젝트 거부).

### writing_chats (DM 2.5)
- 삭제: `mode`, `experience_id`, `education_id`, `saved_at`(+관련 CHECK·FK·인덱스, `writing_chats_unlinked_last_activity_idx`, `writing_chats_user_id_project_id_idx`)
- 추가: `title text`(≤100), `last_applied_at timestamptz`. `project_id` not null. `status` CHECK `('active','closed')`.
- 인덱스: `writing_chats_project_id_last_activity_idx (project_id, last_activity_at desc)`, 기존 `(user_id) where status='active'` 유지
- 트리거: `writing_chats_require_affiliated_project`(insert, 독립 프로젝트면 `writing_chat_requires_affiliated_project`), `writing_chats_guard`(`active→closed`만, project_id 고정 — 위반 `invalid_writing_chat_transition`), `writing_chats_cancel_jobs`(대화 삭제·연쇄 삭제 시 그 대화의 queued/running `writing_chat_turn` 작업에 `cancel_requested_at`)
- 사용자 grant: **update `(return_target)`만**(status grant 회수).

### draft_section_sources
- `project_detail_ids` 컬럼·CHECK 삭제.

## RPC 시그니처와 반환 (api·ai 계약)

### 바뀐·새 RPC 요약

| RPC | 실행 | 인자 | 반환 | 오류(message) |
|-----|------|------|------|---------------|
| `start_writing_chat` **(시그니처 변경)** | authenticated, definer | `p_project_id uuid, p_return_target jsonb default null` | `uuid` | `not_authenticated`(42501), `project_not_found`, `writing_chat_requires_affiliated_project`, `invalid_return_target` |
| `append_writing_chat_message` | authenticated, definer | 그대로 `(p_writing_chat_id, p_content)` | 그대로 `TABLE(message_id, sequence, message_count)` | **`writing_chat_closed`**(이전 `writing_chat_not_active`), 나머지 그대로(`invalid_content`, `turn_in_progress`, `message_limit_reached`, `writing_chat_not_found`) |
| `begin_assistant_message` | app_ai_writer, definer | 그대로 | 그대로 `TABLE(message_id, sequence, message_count, reused, is_final)` | **`writing_chat_closed`**(이전 `writing_chat_not_active`), 나머지 그대로 |
| `finish_assistant_message` | app_ai_writer, definer | 그대로 | `void` | 그대로. **`p_status='done'`이고 `message_count > 38`이면 대화를 `closed`로** 바꾼다(`failed`면 그대로 `active` — 다시 보내기 가능) |
| `apply_structured_draft_patch` **(payload v3)** | authenticated / app_ai_writer, invoker → definer impl | `p_writing_chat_id uuid, p_patch jsonb` | `jsonb {structured_draft, rejected}` | 아래 |
| `apply_writing_chat_proposal` **(신설)** | authenticated, **invoker** | `p_writing_chat_id uuid, p_fields text[] default null` | `jsonb {applied, skipped, project_status}` | 아래 |
| `reorder_project_deliverables` **(신설)** | authenticated, invoker | `p_project_id uuid, p_ordered_ids uuid[]` | `void` | `not_authenticated`, `career_item_not_found`, `invalid_deliverable_order` |
| `get_data_readiness` | 그대로 | 그대로 | 아래 v4.4 모양 | 그대로 |
| `get_deletion_impact` | authenticated, invoker | `p_entity_type text, p_entity_id uuid, p_affiliation_mode text default 'delete_projects'` | 아래 | `invalid_entity_type`, **`affiliation_mode_not_supported`**(keep_projects), `invalid_affiliation_mode`(그 밖 값), `career_item_not_found` |
| `delete_career_item` | authenticated, invoker | `p_entity_type, p_entity_id, p_affiliation_mode default 'delete_projects', p_result_mode default 'keep_results'` | 입력 echo `{entity_type, entity_id, affiliation_mode, result_mode}` + impact | 위 + `invalid_result_mode` |
| `set_section_sources` | 그대로 | 그대로 | 그대로(단 `sources[]`에 `project_detail_ids` 없음) | 그대로. 요소의 `project_detail_ids` 키는 **무시** |
| `complete_cover_letter_section` | 그대로 | 그대로 | 그대로 | `sources[].project_detail_ids` 키 무시, 근거 허용 목록 변경 |
| `get_account_deletion_summary` | 그대로 | — | `career` 키: `experiences, educations, projects, project_deliverables, skills, writing_chats` | 그대로 |
| 삭제(폐기) | — | `save_writing_chat`, `hand_off_writing_chat`, `set_writing_chat_affiliation`, `purge_unlinked_writing_chats`, `reorder_project_details`, `start_writing_chat(text, uuid, jsonb)` | — | — |

### structured_draft v3 저장 모양 (빈 초안 = `start_writing_chat`가 넣는 값)
```json
{ "schema_version": 3, "project": {}, "star": {}, "classification": {}, "clarifications": [], "sensitive_flags_count": 0 }
```
- `project.{start_month|end_month}`: `{value:"YYYY-MM", origin, source_message_ids, source_quotes, review, reviewed_at, applied_at}` (op 없음)
- `star.{situation|task|action|result|learnings}`: 위 키 + `op`(`set`/`append`)
- `classification.{project_type|experience_type|competencies}`: `{value, origin, source_message_ids, reason, review:"ok", reviewed_at, applied_at}` (op·source_quotes 없음. `competencies` value = 키 배열)
- `clarifications[]`: `{kind, field}` (`kind` ∈ `actor_ambiguous`, `number_vague`, `period_unclear` — `affiliation_unclear` 폐기)
- `schema_version`이 3이 아닌 초안은 RPC가 빈 v3로 읽는다(기존 v1 데이터는 비웠음).

### `apply_structured_draft_patch` v3 payload (`p_patch = {"ops": [...]}`, 1~100개, 순서대로)
**AI(app_ai_writer)** — 대화가 `active`일 때만(아니면 `writing_chat_closed`):
```json
{ "op": "set" | "append", "target": {"section": "star", "field": "action"}, "value": "…",
  "source_message_ids": ["uuid"], "source_quotes": ["…"], "review": "ok" | "needs_review" }
{ "op": "set", "target": {"section": "project", "field": "start_month" | "end_month"}, "value": "2023-03",
  "source_message_ids": ["uuid"], "source_quotes": ["…"], "review": "ok" }
{ "op": "set", "target": {"section": "classification", "field": "project_type" | "experience_type" | "competencies"},
  "value": "improvement" | ["analysis", "execution"], "source_message_ids": ["uuid"]?, "reason": "…"? }
{ "op": "set_clarifications", "items": [ {"kind": "actor_ambiguous", "field": "action"} ] }   // 목록 교체, ≤50
{ "op": "add_sensitive_flags", "count": 2 }                                                // 0~100 정수
```
**사용자(authenticated)** — `active`·`closed` 모두 `[가정]`:
```json
{ "op": "set", "target": {...}, "value": … }      // 값 수정(null = 그 필드 비우기). origin=user_edit, review=ok
{ "op": "accept" | "reject", "target": {...} }    // needs_review 필드만
```
- `append`는 `star`만. `section`/`field`가 목록 밖이거나 op 모양이 틀리면 **호출 전체** `invalid_patch`(detail `op N …`). `project.is_current`는 필드별 거부 `field_not_patchable`(R-CR-15).
- 규칙(필드별):
  - V-9a: AI STAR·기간 패치는 `source_message_ids`가 이 대화의 `role='user'` 메시지(1~20개)여야 함 → 아니면 `invalid_source`. `source_quotes` ≤20개·각 ≤1,000자.
  - 값: STAR 1~2,000자(앞뒤 공백 제거), 기간 `YYYY-MM` → 아니면 `invalid_value`.
  - **V-9h**: 프로젝트 STAR 컬럼에 값이 있으면 AI `set` 거부 `field_already_filled`, `append`만 받음(저장 `op='append'`). 비어 있으면 `append`도 `op='set'`으로 저장. 기간은 프로젝트 컬럼이 비어 있을 때만(`end_month`는 `is_current=true`여도 거부) → `field_already_filled`(AI·사용자 공통).
  - 같은 필드의 **미반영** 제안: AI `set`은 교체, AI `append`는 기존 값 + `\n` + 새 값(출처 합침, `needs_review`가 하나라도 있으면 유지). 합친 값이 2,000자를 넘으면 `invalid_value`.
  - 보호: 미반영 필드가 `origin='user_edit'` 또는 `review='accepted'`면 AI 패치 거부 `protected_field`.
  - 반영된 필드(`applied_at` 있음): AI 패치는 **새 필드 객체**로 바꿈. 사용자 `set`/`accept`/`reject`는 `field_already_applied`.
  - 분류(V-9i DB 방어): 목록 밖 키는 버리고, `competencies`는 유효·중복 제거·앞 3개. 남는 값이 없으면 `invalid_value`. 프로젝트에 이미 값이 있으면(`competencies`는 `'{}'`가 아니면) `classification_already_set`(AI·사용자). `source_message_ids`는 선택, 이 대화 user 메시지가 아닌 id는 **지움**(거부 아님). `reason` 문자열이면 공백 제거 후 **200자로 자름**, 문자열/null 외 타입이면 `invalid_value`.
  - 사용자 `set` STAR: `op`는 프로젝트 컬럼 기준으로 다시 정함(값 있음 → `append`, 없음 → `set`).
  - `accept`/`reject`: 대상이 `needs_review`가 아니면 `invalid_review_transition`. reject = `{value:null, origin:"ai", …, review:"ok", reviewed_at:now}`.
- AI 호출은 규칙 위반 op만 건너뛰고 `rejected`에 담음, 사용자 호출은 첫 위반에서 예외(message = reason).
- 반환: `{ "structured_draft": {…전체…}, "rejected": [ {"index": 3, "op": "set", "reason": "invalid_source"} ] }`
- **거부 reason 목록**: `invalid_source`, `invalid_value`, `field_already_filled`, `classification_already_set`, `protected_field`, `field_already_applied`, `field_not_patchable`, `invalid_review_transition`
- 그 밖 오류: `not_authenticated`(42501), `actor_mismatch`(42501), `writing_chat_not_found`, `writing_chat_closed`(AI만), `invalid_patch`

### `apply_writing_chat_proposal(p_writing_chat_id uuid, p_fields text[] default null) → jsonb`
- 사용자 세션 전용(security invoker, app_ai_writer execute 없음). 키·동의·활성 공급자 확인 없음. 대화 `active`·`closed` 모두.
- 잠금: `writing_chats` 행(definer 헬퍼) → `projects` 행(`for update`, 사용자 RLS).
- `p_fields`: null = 제안에 있는 필드 전부, 아니면 그 필드(정해진 순서로 처리). 허용 `situation, task, action, result, learnings, start_month, end_month, project_type, experience_type, competencies`. 그 밖·null 원소 → `invalid_fields`.
- 필드별 판정(순서대로): 값 없음 → `empty` / `applied_at` 있음 → `already_applied` / `review`가 `ok`·`accepted`가 아님 → `needs_review` / 기간 컬럼에 값 있음(또는 `end_month`인데 `is_current=true`) → `period_already_set` / 분류 컬럼에 값 있음 → `classification_already_set`.
- STAR: 프로젝트 컬럼이 비면 제안 값, 있으면 `현재 값 + "\n" + 제안 값`(반영 시점의 현재 값 기준, `op` 무관).
- 결과 STAR 값이 2,000자를 넘는 필드가 하나라도 있으면 **아무것도 쓰지 않고** `field_too_long`(P0001, `detail` = 쉼표로 이은 필드명, 예 `learnings`). 결과 기간이 `end < start`면 `invalid_period`.
- 반영한 게 있으면: `projects` update(상태·`content_updated_at`·`career_data_updated_at`은 트리거) → 반영 필드에 `applied_at`, 대화 `last_applied_at`·`last_activity_at`, `projects.source_writing_chat_id = 이 대화`.
- 반환: `{ "applied": ["action", "start_month"], "skipped": [{"field": "result", "reason": "needs_review"}], "project_status": "complete" }`. 반영할 게 없으면 `applied: []`(오류 아님).
- **skipped reason 목록**: `needs_review`, `already_applied`, `empty`, `period_already_set`, `classification_already_set`
- 오류: `not_authenticated`, `invalid_fields`, `writing_chat_not_found`, `project_not_found`, `field_too_long`, `invalid_period`

### `start_writing_chat(p_project_id uuid, p_return_target jsonb default null) → uuid`
- 소속 프로젝트(경력·교육 안)만. `draft`여도 된다. 키 없어도 시작 가능.
- `p_return_target` 검증·정규화는 이전과 같다(`{application_project_id, feature ∈ insight|career_description|cover_letter|job_interview, params}` + 서버 `created_at`).
- 빈 v3 초안 + 시작 인사(sequence 1, assistant, `ai_job_id` null, 상한 제외). 인사 문구 `[가정]`(최종 UX):
  - STAR 5칸 모두 빔: "'{이름}'을 함께 정리해 볼게요. 하나씩 여쭤보고, 정리한 내용은 왼쪽에 반영하기 전에 먼저 보여 드릴게요. 이 프로젝트는 어떤 상황에서 시작됐나요?"
  - 일부: "'{이름}'에서 비어 있는 {상황|역할|행동|결과/성과|배운 점}부터 여쭤볼게요. " + 그 슬롯 질문(AI-12 표)
  - 모두 채움: "모든 항목이 채워져 있어요. 보강하고 싶은 항목을 골라 주세요."
  - `return_target`이 있으면 맨 앞에 "{인사이트를|경력기술서를|자기소개서를|직무 면접을} 쓰려면 이 프로젝트의 상황과 행동이 필요해요." 한 줄
  - 공통 끝: 민감정보 안내 + (활성 키 무료 등급이면) 서비스 개선 안내
- `title`은 첫 사용자 메시지에서 `append_writing_chat_message`가 앞 30자(연속 공백 1칸)로 채운다.

### `get_data_readiness()` v4.4 반환
```json
{
  "ai_connection": {"active_provider": "gemini", "key_status": "valid", "connection_tier": "free", "consent_required": true},
  "counts": {
    "complete_experiences": 1, "complete_educations": 1, "complete_projects": 0,
    "projects_without_complete_star": 1, "standalone_projects_without_description": 0,
    "draft_experiences": 0, "draft_educations": 0, "draft_projects": 1, "profile_filled": true
  },
  "draft_item_ids": {"experiences": [], "educations": [], "projects": ["uuid"]},
  "features": {
    "insight": {"ready": false, "missing": ["complete_project"], "hints": ["project_star"],
                "next_action": "writing_chat", "suggested_project_id": "uuid"},
    "draft": {…같은 객체…}, "job_interview": {…같은 객체…},
    "culture_fit_interview": {"ready": true, "data_sufficiency": "thin"}
  }
}
```
- 삭제된 키: `projects_without_complete_detail`, `complete_project_details`, `draft_project_details`, `draft_item_ids.project_details`, `suggested_mode`.
- 셀 때 소속 프로젝트는 부모 경력·교육이 `complete`인 것만. 독립 프로젝트는 항상 포함.
- `projects_without_complete_star` = 포함 대상 중 `draft`인 소속 프로젝트, `standalone_projects_without_description` = `draft`인 독립 프로젝트.
- `next_action`(ready=false일 때만): ① 완료 경력 없음 → `form`(suggested 없음) ② STAR 미완 소속 프로젝트 있음 → AI 사용 가능이면 `writing_chat`, 아니면 `form` + `suggested_project_id`(최근 수정 1건) ③ 내용 빈 독립 프로젝트 있음 → `form` + `suggested_project_id` ④ 그 밖 → AI 사용 가능이면 `create_project`, 아니면 `form`. "AI 사용 가능" = 활성 공급자 있음 + `key_status <> 'invalid'`(동의 여부는 안 봄).
- `hints`: `complete_projects = 0`일 때 ②에 해당하면 `project_star`, 아니고 ③이면 `project_fields`(둘 중 하나), 프로필 비면 `profile`.
- `data_sufficiency`: ready → `ok`, 아니면 프로필/완료 경력·교육·프로젝트 중 하나라도 있으면 `thin`, 없으면 `none`.

### `get_deletion_impact` / `delete_career_item`
- `entity_type` ∈ `experience`, `education`, `project`, `project_deliverable`, `skill`, `writing_chat`
- `affiliation_mode`: `delete_projects`(기본, 유일). `keep_projects` → `affiliation_mode_not_supported`. 경력·교육 삭제는 FK cascade로 소속 프로젝트(→ 대화 → 메시지)를 함께 지운다.
- 반환(writing_chat 제외):
```json
{ "cascade": {"projects": 2, "project_deliverables": 0, "project_skills": 0, "writing_chats": 2},
  "affected_results": {"by_application_project": [
    {"application_project_id": "uuid", "name": "…", "insights": 1, "drafts": 0, "draft_sections": 1, "interview_sessions": 0}]}}
```
  - cascade는 대상 자신 제외: 경력·교육 = 소속 프로젝트 수·그 대화 수, 독립 프로젝트 = 산출물·project_skills, 소속 프로젝트 = 대화, 스킬 = project_skills, 산출물 = 모두 0.
  - 결과 영향 집계 원천 = 지워질 행(연쇄 포함)의 `experience`/`education`/`project`/`project_deliverable`/`skill` 근거 + `draft_section_sources`(experience/education/project).
- `writing_chat`: `{ "message_count": 5, "last_applied_at": "…" | null }` 만. `message_count` = `writing_chats.message_count`(시작 인사 제외, QA-R4-03).
- `delete_career_item` 반환: `{entity_type, entity_id, affiliation_mode, result_mode}` + 위 impact. `project_deliverable`은 `result_mode`를 따른다. 대화 삭제(직접 delete·연쇄 모두)는 진행 중 `writing_chat_turn` 작업에 취소 요청을 건다(트리거).

## evidence_links (DM 2.8)
- `source_type` ∈ `profile`, `experience`, `education`, `project`, `project_deliverable`, `skill`, `jd_requirement`, `jd_sentence`, `interview_answer`, `user_note`
- `source_field` 허용값:

| source_type | source_field |
|-------------|--------------|
| `profile` | `desired_job_title`, `total_years_of_experience`, `interested_industries` |
| `experience` | `job_rank`, `job_position`, `department`, `summary`, `period` |
| `education` | `institution_name`, `program_name`, `education_type`, `enrollment_status`, `period`, `description` |
| `project` | `name`, `period` (공통) / `situation`, `task`, `action`, `result`, `learnings` (소속만) / `role`, `description` (독립만) |
| `project_deliverable` | `title`, `body` |
| `skill` | `name` |
| 그 밖 | null |

- insert 트리거: 프로젝트 종류와 필드가 맞지 않으면(소속에 `role`/`description`, 독립에 STAR) **`invalid_evidence_source`로 예외** → 결과 저장 RPC 전체가 실패한다. 파이프라인 V-2에서 먼저 걸러야 한다. 원본(산출물 포함)이 없으면 `quote=null`, `source_deleted_at=now()`로 저장.
- `project_deliverable` `body` 근거의 `source_locator`는 `{start, end}`(원문 마크다운 UTF-16 오프셋) — DB는 object인지만 확인한다.
- `source_snapshot_at`은 **DB가 계산하지 않는다**(결과 RPC가 payload 값을 저장, 없으면 now()). 파이프라인이 `project` = `projects.content_updated_at`, `project_deliverable` = 산출물 `updated_at`을 넣어야 "변경됨" 판정이 맞다.
- V-8: 직무 면접 질문(`save_interview_question`, interview_type `job`), 경력기술서(`complete_career_description`), `job_competency` 자소서 문항(`complete_cover_letter_section`)은 `source_type='project' AND source_field='learnings'` 근거를 `invalid_interview_payload` / `invalid_draft_payload`로 거부.
- 결과 RPC 근거 허용 목록: 인사이트 = 커리어 6종 + `jd_requirement`·`jd_sentence`, 경력기술서 = 커리어 6종, 자소서 = 커리어 6종 + JD 2종 + `user_note`, 면접 질문 = 커리어 6종 + JD 2종, 답변 평가·종합 = 커리어 6종 + JD 2종 + `interview_answer`. (커리어 6종 = profile, experience, education, project, project_deliverable, skill)

## RLS·권한 요약 (DM 5장 대비)
- `project_deliverables`: 4동작 본인 + `app_ai_writer` select (DM과 같음). `grants.test.sql`의 app_ai_writer 목록 갱신.
- `writing_chats`: 사용자 직접 update는 `return_target`만(`status` grant 회수, DM v4.4와 같음).
- `apply_writing_chat_proposal`·`reorder_project_deliverables`·`delete_career_item`: security invoker, authenticated만(service_role은 기존 기본 권한).
- 새 private 함수 execute: `text_array_is_distinct`(authenticated, service_role — CHECK 평가용), `classification_keys`·`wc_classification_value`·`wc_proposal_lock`·`wc_proposal_mark_applied`(authenticated).

## 테스트 (`supabase test db`)
- **51개 파일, 2,382개 테스트 통과**(QA 1라운드 수정 뒤 2,387개, 아래).
- 새로 쓴 파일: `apply_writing_chat_proposal.test.sql`(28, 반영·덧붙임·needs_review 건너뜀·2,000자 전체 거부·기간/분류 건너뜀·closed 허용·대화 삭제 뒤 STAR 유지·권한), `structured_draft_patch.test.sql`(48, v3 전체 규칙), `career_tables.test.sql`(DM-20 CHECK·분류 CHECK·is_current·범위 전환 거부·content_updated_at·산출물 독립 한정·50개·reorder·project_skills 독립 한정), `career_deletion_rpcs.test.sql`(v4.4 entity/cascade/keep_projects 거부)
- 삭제: `writing_chat_save.test.sql`(대상 RPC 폐기 → 위 새 파일로 대체)
- 갱신: `grants`, `account_deletion`, `get_data_readiness`, `r1_planning_decisions`(A18 v4.4 의미), `evidence_links`, `writing_chats`(closed 전이·title·인사 4종·소속 한정·작업 취소), `retention_purge`(purge 폐기 확인), `career_first_call_privileges`, `s4/s6/s7_first_call_privileges`, `drafts`, `drafts_career_deletion`, `drafts_qa1`, `career_description`, `career_description_cancel`, `insights`, `insights_career_deletion`, `interviews`, `interviews_career_deletion`, `retry_ai_job`, `application_projects`·`jd_extraction`(기본 이름)

## 원격 브랜치 적용 여부
- 적용 안 함(계획·사용자 요청 없음).

## 스펙 차이·가정 (spec-gaps.md "R4 (db-engineer)"에 기록)
- R4-DB-1 데이터 비우기 `[가정]`(decisions.md에도 기록)
- R4-DB-2 패치 payload 형식은 DB가 정함(ops 방식 유지, `append` op, `field_not_patchable` 등)
- R4-DB-3 사용자 STAR 수정의 V-9h: 거부 대신 `op`를 프로젝트 기준으로 다시 정함
- R4-DB-4 `is_current=true`일 때 `end_month` 제안: 패치 `field_already_filled`, 반영 `period_already_set`
- R4-DB-5 마지막 응답 `failed`면 `closed`로 안 바꿈(다시 보내기 위해)
- R4-DB-6 `writing_chat_not_active` → `writing_chat_closed`(오류 코드 변경)
- R4-DB-7 분류 `reason` 200자 자르기(AI는 100자)
- R4-DB-8 V-9i ⑤(상황·행동 없으면 추천 버림)는 DB가 강제하지 않음 — 파이프라인 몫
- R4-DB-9 `source_snapshot_at`은 파이프라인이 넣음
- R4-DB-10 hints `project_star`/`project_fields`는 판정 순서와 같이 하나만
- R4-DB-11 반영 시 `invalid_period`(DM 반환 reason 목록에 없음)
- R4-DB-12 근거 프로젝트 종류 불일치 시 결과 RPC 전체 실패(insert 트리거 예외)
- R4-DB-13 ~~마이그레이션 접두사가 w1 앞에 정렬~~ — 해소(파일명 `20261109…`로 변경)

## 팀 전달 사항
- **api-engineer**: `start_writing_chat` 2인자, `save/hand_off/set_affiliation/purge_unlinked/reorder_project_details` 호출 제거(보관 크론 포함), 반영은 `apply_writing_chat_proposal`, 오류 코드 `writing_chat_closed`·`field_too_long`(details 필드)·`invalid_fields`·`affiliation_mode_not_supported`·`project_scope_change_not_allowed`·`deliverable_requires_standalone_project`·`deliverable_limit_reached`·`project_skill_requires_standalone_project`·`writing_chat_requires_affiliated_project`·`invalid_deliverable_order` 매핑, `database.types.ts` 반영, readiness 키 변경.
- **ai-pipeline-engineer**: 위 v3 패치 형식(`toDraftPatch` 재작성), 분류 키 목록, 근거 `source_type`/`source_field`(프로젝트 종류별), V-8 `project.learnings`, `source_snapshot_at` 값, 산출물 `source_locator {start,end}`.

## QA 1라운드 수정 (2026-11-09, `03_backend-qa_report.md` QA-R4-01~04)

- 마이그레이션: `supabase/migrations/20261109101700_r4_qa1_fixes.sql`(새 파일). 로컬은 `supabase migration up --local`로 적용(reset 안 함). `supabase test db` **51개 파일 2,387개 통과**. 시그니처 변경 없음 → `database.types.ts` 재생성 안 함.
- **QA-R4-01** `private.project_deliverables_before_insert`, `private.project_skills_require_standalone`를 **security invoker**로 바꿨다. 사용자 세션에서 남의 프로젝트는 RLS로 안 보여 검사를 건너뛰고, 행은 RLS(42501)·복합 FK(23503)가 거부한다 — 남의 프로젝트 종류·산출물 개수가 오류 코드로 새지 않고, 남의 행을 잠그지도 않는다. 자기 프로젝트에 대한 `deliverable_requires_standalone_project`·`deliverable_limit_reached`·`project_skill_requires_standalone_project`는 그대로. pgTAP: `career_tables.test.sql`에 "B의 user_id·B의 소속 프로젝트로 insert → 42501" 2건.
- **QA-R4-02** `apply_writing_chat_proposal`: 현재 STAR 값을 `rtrim(…, E' \t\r\n')`한 뒤 `값 + "\n" + 제안`으로 잇고 길이를 잰다(파이프라인 `mergedStarLength`의 trim 길이와 같음, 빈 줄 없음). 앞쪽 공백은 그대로. pgTAP: `apply_writing_chat_proposal.test.sql`에 끝 공백·빈 줄 있는 값 2건(이어 붙인 모양, 다듬기 전이면 2,002자인 경우 통과).
- **QA-R4-03** `get_deletion_impact('writing_chat', …)`의 `message_count` = `writing_chats.message_count`(시작 인사 제외, A5). 반환 모양은 그대로. `career_deletion_rpcs.test.sql` 기대값 1 → 0.
- **QA-R4-04** R4 마이그레이션 주석·`decisions.md`·`spec-gaps.md`(R4-DB-13 해소 표시)·이 노트의 옛 번호 `20261107…`를 `20261109…`로 고쳤다(주석만, 동작 영향 없음).
