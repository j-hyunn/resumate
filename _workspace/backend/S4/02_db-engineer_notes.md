# S4 DB 구현 노트

> 상태: 마이그레이션 6개 적용(`supabase db reset` OK), **타입 재생성 완료**(`src/server/db/database.types.ts`), `supabase test db` **PASS(25파일 1066개)**, `pnpm test` 51파일 892개 통과, `pnpm typecheck` 통과. 커밋·원격 적용 없음. 아래 "패치 계약"과 "RPC 시그니처"는 확정본이다(ai-pipeline-engineer·api-engineer는 이 모양으로 코딩).

## RPC 시그니처 (api·ai용 요약)

오류: `42501 not_authenticated`(JWT sub 없음), 그 밖은 `P0001` + 아래 message. 타입은 `Database['public']['Functions'][name]`.

| RPC | 호출 역할 | 인자 | 반환 | 오류(P0001 message) |
|-----|-----------|------|------|----------------------|
| `start_writing_chat` | authenticated (definer) | `p_mode`(`new_project`/`augment_project`), `p_project_id?`(augment 필수), `p_return_target?` jsonb `{application_project_id, feature, params?}` | `string`(대화 id) | `invalid_mode`, `project_required`, `project_not_allowed`(new_project에 id), `project_not_found`, `invalid_return_target` |
| `append_writing_chat_message` | authenticated (definer) | `p_writing_chat_id`, `p_content`(앞뒤 공백 제거 후 1..4000자) | 행 1개 `{message_id, sequence, message_count}` | `writing_chat_not_found`, `writing_chat_not_active`, `invalid_content`, **`turn_in_progress`**(살아 있는 응답 중 턴, QA-S4-04), `message_limit_reached`(현재 `message_count > 38`) |
| `begin_assistant_message` | **app_ai_writer** (definer) | `p_writing_chat_id`, `p_ai_job_id`(이 대화의 `writing_chat_turn` 작업), `p_provider`, `p_model`, `p_model_tier`, `p_connection_tier` | 행 1개 `{message_id, sequence, message_count, reused, is_final}` | `writing_chat_not_found`, `writing_chat_not_active`, `invalid_ai_metadata`, `invalid_ai_job`, `turn_in_progress`, `no_pending_user_message`, `message_limit_reached` |
| `finish_assistant_message` | **app_ai_writer** (definer) | `p_message_id`, `p_status`(`done`/`failed`), `p_content`(done은 공백 아님, ≤4000자) | `undefined` | `invalid_message_status`, `message_not_found`, `invalid_message_state`(streaming 아님), `invalid_content` |
| `mark_writing_chat_extracted` | **app_ai_writer** (definer) | `p_writing_chat_id`, `p_sequence`(0..마지막 sequence) | `number`(저장된 값, 내려가지 않음) | `writing_chat_not_found`, `invalid_sequence` |
| `apply_structured_draft_patch` | authenticated **또는** app_ai_writer (invoker → private definer) | `p_writing_chat_id`, `p_patch`(위 계약) | `Json` `{structured_draft, rejected}` | `writing_chat_not_found`, `writing_chat_not_active`, `invalid_patch`, (사용자만) 거부 사유 표 |
| `set_writing_chat_affiliation` | authenticated (definer) | `p_writing_chat_id`, `p_experience_id?`, `p_education_id?`, `p_dismiss_only?`(기본 false) | `undefined` | `writing_chat_not_found`, `writing_chat_not_active`, `affiliation_not_editable`(augment, dismiss 제외), `invalid_affiliation`(둘 다), `affiliation_not_found` |
| `save_writing_chat` | authenticated (invoker) | `p_writing_chat_id` | `Json` 아래 "저장 결과" | `writing_chat_not_found`, `writing_chat_not_active`, `invalid_period`(종료월 < 시작월) |
| `hand_off_writing_chat` | authenticated (invoker) | `p_writing_chat_id` | `Json` 같은 모양(`status: 'handed_off'`) | 같음 |
| `get_deletion_impact` | authenticated | `('writing_chat', id)` 추가 | writing_chat이면 `{message_count, linked_saved_rows}`만. 그 밖은 S2 모양(이제 `cascade.writing_chats`가 실제 개수) | 기존 + 대화 없음은 `career_item_not_found` |
| `delete_career_item` | authenticated | `('writing_chat', id)` 추가 | 입력 echo(`entity_type, entity_id, affiliation_mode, result_mode`) + 영향 객체를 합친 것 | 기존과 같음 |

### 턴 처리 순서 (api 참고)
1. 사용자 세션 `append_writing_chat_message` → `message_id`/`sequence`. 다시 보내기(`?retry=1`)면 이 단계 없음.
2. app_ai_writer로 `ai_jobs` insert(`writing_chat_turn`, `target_type='writing_chat'`, `target_id=대화`).
3. `begin_assistant_message(...)` → `message_id`(assistant), `reused`(다시 보내기면 true, 개수 불변), `is_final`(true면 이번 응답이 마지막 — 빈 필드 요약 + 저장/폼 안내).
   - 직전 메시지가 user → 새 assistant 행(개수 +1). 직전이 assistant `failed` → 그 행 재사용. 직전이 assistant `streaming`이면 **살아 있는 턴**(아래)일 때 `turn_in_progress`, 죽은 턴이면 재사용. 직전이 assistant `done` → `no_pending_user_message`.
   - **살아 있는 턴**(QA-S4-04) = `streaming`이고 2분 안에 갱신됐고, 그 행의 `ai_job_id` 작업이 `succeeded`/`failed`/`canceled`가 아님. 작업이 끝났거나 2분이 지나면 죽은 턴이다(화면의 "작업 끝난 streaming = failed" 표시와 같은 기준).
   - 클라이언트가 끊으면 api는 바로 `finish_assistant_message(id, 'failed', 받은 부분 또는 '')`를 부른다. 그 직후 다시 보내기는 곧바로 재사용된다(테스트 있음).
4. 스트림 끝 → `finish_assistant_message(id, 'done', 전체 응답)`. 실패·끊김 → `finish_assistant_message(id, 'failed', 받은 부분)`.
5. extract → V-9 → app_ai_writer `apply_structured_draft_patch` → `rejected`는 로그(원문 없이 index·op·reason).
6. 정리 성공 시 `mark_writing_chat_extracted(id, 이번 턴에 정리한 마지막 user sequence)`. 다음 정리 입력 = `sequence > last_extracted_sequence`인 user 메시지.

### 메시지 상한 규칙 (`[가정]`, spec-gaps)
- 시작 인사 = sequence 1, `message_count = 1`.
- 사용자 메시지는 `message_count <= 38`일 때만 받는다(답할 자리 확보). assistant 새 행은 `<= 39`. 그래서 실제 최대는 보통 39개(인사 + 사용자 19 + AI 19).
- 화면 표시는 `message_count / 40` 그대로.

### 저장 결과 (`save_writing_chat` / `hand_off_writing_chat`)
```json
{ "writing_chat_id": "uuid", "status": "saved", "project_id": "uuid",
  "project": { "created": true, "updated": false },
  "project_details": { "created": 1, "updated": 0, "missing": 0 },
  "achievements": { "created": 1 },
  "skills": { "created": 1, "linked": 2 },
  "skipped_needs_review": 1 }
```
- `project.updated`: augment에서 빈 컬럼을 하나라도 채웠는지. `project_details.updated`: 빈 컬럼을 채운 기존 상세 내용 수. `missing`: 정리 결과가 가리키는 기존 상세 내용이 그 사이 삭제돼 건너뛴 수.
- `skills.linked`: 새로 생긴 `project_skills` 행 수(이미 연결돼 있던 것은 세지 않음).
- `skipped_needs_review`: 남아 있던 `needs_review` 필드 수(저장 안 됨).
- 쓰기 규칙: `review ∈ (ok, accepted)` + 값 있음. 새 상세 내용은 쓸 값이 하나라도 있을 때만 insert. 성과는 4필드 중 쓸 값이 하나라도 있으면 insert(`description` 없음). augment는 기존 행의 빈 컬럼만(공백만 있는 값도 빈 것으로 봄). 새 프로젝트는 값이 하나도 없어도 만든다(완료 판정은 S2 트리거, 대부분 draft).
- 스킬: `normalized_name`이 같은 기존 스킬에 연결, 없으면 `is_manual = false`로 만든다(링크가 모두 사라지면 S2 고아 정리 대상).
- 소속: new_project만 `writing_chats.experience_id`/`education_id`를 프로젝트에 쓴다. augment는 프로젝트 소속을 바꾸지 않는다.

### 테이블 직접 접근
| 대상 | authenticated | app_ai_writer |
|------|---------------|---------------|
| `writing_chats` | select·delete 본인, update는 `status`(active → abandoned만, 트리거) / `return_target`만 | select 본인 |
| `writing_chat_messages` | select 본인 | select 본인 |
- insert는 둘 다 RPC로만. `structured_draft`·`message_count`·`project_id`·`last_extracted_sequence`는 누구도 직접 update 못 한다.
- 상태: `saved`/`handed_off`/`abandoned`는 되돌릴 수 없다(`invalid_writing_chat_transition`). 이어하기는 `active`만.

## 패치 계약 — `apply_structured_draft_patch(p_writing_chat_id uuid, p_patch jsonb) returns jsonb`

- 호출 역할로 행위자를 정한다. `app_ai_writer` = AI, `authenticated` = 사용자. 그 밖 역할은 실행 권한 없음.
- 대화 행을 잠그고(`for update`), `status = 'active'`만 허용한다. 끝나면 `last_activity_at = now()`.
- **ops는 순서대로 적용**한다. 앞 op가 만든 상세 내용(`new_detail`)을 뒤 op가 쓸 수 있다.
- **규칙 위반 처리가 행위자마다 다르다.**
  - AI: 그 op만 건너뛰고 `rejected[]`에 `{index, op, reason}`을 남긴다. 나머지 op는 반영한다(필드 하나 때문에 턴 전체 정리가 사라지지 않게).
  - 사용자: 첫 위반에서 `P0001 <reason>` 예외. 아무것도 반영되지 않는다.
  - 형식 오류(ops 배열 아님, 모르는 op, 행위자에게 허용되지 않은 op, target 모양 오류)는 둘 다 `P0001 invalid_patch` 예외.

### 입력 모양
```jsonc
{
  "ops": [ /* Op, 1..100개 */ ]
}
```

### target (필드 위치)
| 모양 | field 값 |
|------|----------|
| `{"section":"project","field":F}` | `name`, `role`, `summary`, `start_month`, `end_month`, `team_size` |
| `{"section":"detail","detail_key":"D1","field":F}` (새 상세 내용) | `title`, `situation`, `task`, `action`, `result`, `learnings` |
| `{"section":"detail","existing_detail_id":"<uuid>","field":F}` (보강: 기존 상세 내용) | 위와 같음 |
| `{"section":"achievement","achievement_key":"A1","field":F}` | `metric_name`, `value_before`, `value_after`, `unit` |

- `detail_key`: `^D[1-9][0-9]{0,2}$`. `achievement_key`: RPC가 `add_achievement` 때 붙인다(`A1`, `A2`… 대화 전체에서 증가).
- `existing_detail_id`: 대화의 `project_id` 프로젝트에 속한 `project_details.id`여야 한다(`augment_project`만). 처음 쓰일 때 `details[]` 항목이 자동으로 생긴다.

### 값 형식 (DB가 검사, 위반은 `invalid_value`)
| field | jsonb 타입 | 제한 |
|-------|-----------|------|
| `name`, `role` | string | 공백 제외 1..100자 |
| `summary` | string | 1..200자 |
| `start_month`, `end_month` | string `YYYY-MM` | 01..12월 |
| `team_size` | number(정수) | 1..32767 |
| `title` | string | 1..100자 |
| `situation`, `task`, `action`, `result`, `learnings` | string | 1..2000자 |
| `metric_name` | string | 1..200자 |
| `unit` | string | 1..50자 |
| `value_before`, `value_after` | number | |
| 스킬 `value` | string | 공백 제외 1..50자 |

### Op 목록
| op | 행위자 | 모양 | 동작 |
|----|--------|------|------|
| `set` | AI·사용자 | `{op, target, value, source_message_ids?, source_quotes?, review?}` | 필드 객체를 쓴다. AI: `value` 필수, `source_message_ids` 1개 이상(모두 이 대화의 `role='user'` 메시지), `source_quotes` 문자열 배열, `review` ∈ `ok`(기본)/`needs_review` → `{value, origin:'ai', source_message_ids, source_quotes, review, reviewed_at:null}`. 사용자: `value`만 본다 → `{value, origin:'user_edit', source_message_ids:[], source_quotes:[], review:'ok', reviewed_at:null}`. **사용자가 `value: null`을 보내면 필드 객체를 지운다**(빈 필드 → AI가 다시 물을 수 있음) |
| `accept` | 사용자 | `{op, target}` | `review = 'needs_review'`인 필드만 → `review:'accepted'`, `reviewed_at: now()` |
| `reject` | 사용자 | `{op, target}` | `review = 'needs_review'`인 필드만 → `{value:null, origin:'ai', source_message_ids:[], source_quotes:[], review:'ok', reviewed_at: now()}` |
| `new_detail` | AI·사용자 | `{op, detail_key}` | `details[]`에 `{detail_key, existing_detail_id:null, fields:{}, achievements:[]}` 추가. 이미 있으면 아무것도 안 함 |
| `remove_detail` | 사용자 | `{op, detail_key}` 또는 `{op, existing_detail_id}` | 그 항목과 그 항목을 가리키는 clarifications 제거(기존 커리어 행은 건드리지 않음) |
| `add_achievement` | AI·사용자 | `{op, detail:{detail_key}|{existing_detail_id}, fields:{metric_name?, value_before?, value_after?, unit?}}` | 그 상세 내용의 `achievements[]`에 `{achievement_key, metric_name:{…}, …}` 추가. fields 값: AI는 `{value, source_message_ids, source_quotes, review?}`, 사용자는 `{value}`. 값이 있는 필드 1개 이상. AI는 한 필드라도 출처가 틀리면 성과 전체 거부 |
| `remove_achievement` | 사용자 | `{op, achievement_key}` | 제거 |
| `add_skill` | AI·사용자 | `{op, value, source_message_ids?, source_quotes?}` | `skills[]`에 `{value, source_message_ids, source_quotes}`. 정규화 이름(`lower`, 공백 1칸)이 같은 항목이 있으면 AI는 출처를 합치고 사용자는 아무것도 안 함 |
| `remove_skill` | 사용자 | `{op, value}` | 정규화 이름이 같은 항목 제거 |
| `set_affiliation_suggestion` | AI | `{op, type:'experience'|'education', id, source_message_ids}` | `affiliation_suggestion = {type, id, source_message_ids}`. id는 본인 경력·교육 |
| `set_clarifications` | AI | `{op, items:[{kind, field?, detail_key?, existing_detail_id?}]}` | 목록 전체 교체. `kind` ∈ `actor_ambiguous`/`number_vague`/`period_unclear`/`affiliation_unclear`. `note` 같은 자유 텍스트는 저장하지 않는다 |
| `add_sensitive_flags` | AI | `{op, count}` | `sensitive_flags_count += count`(0..100) |

### 거부 사유(`reason`, 사용자에게는 예외 message)
| reason | 언제 |
|--------|------|
| `protected_field` | AI가 `origin='user_edit'` 또는 `review='accepted'` 필드를 `set` |
| `invalid_source` | AI 출처 id가 이 대화의 user 메시지가 아님(빈 배열 포함) — V-9a |
| `field_already_filled` | `augment_project`에서 대상 기존 행(`projects` 또는 `existing_detail_id`의 `project_details`)의 그 컬럼이 이미 채워짐 — V-9h, **AI·사용자 공통** |
| `detail_not_found` | `detail_key` 항목 없음(먼저 `new_detail`), 또는 `existing_detail_id`가 이 대화 프로젝트의 상세 내용이 아님(`new_project` 대화 포함) |
| `achievement_not_found` | `achievement_key` 없음 |
| `invalid_value` | 위 값 형식 위반 |
| `invalid_review_transition` | `accept`/`reject` 대상이 `needs_review`가 아님 |
| `affiliation_not_found` | 제안 id가 본인 경력·교육이 아님 |
| `affiliation_not_editable` | `augment_project` 대화에 소속 제안 |

### 반환
```json
{ "structured_draft": { …갱신된 전체… }, "rejected": [ { "index": 2, "op": "set", "reason": "protected_field" } ] }
```
사용자 호출은 성공하면 `rejected`가 항상 `[]`.

### `structured_draft` 저장 모양 (DM 2.5 + 이 구현의 추가 키)
```json
{
  "schema_version": 1,
  "project": { "name": { "value": "…", "origin": "ai", "source_message_ids": ["uuid"], "source_quotes": ["…"], "review": "ok", "reviewed_at": null } },
  "affiliation_suggestion": null,
  "details": [
    { "detail_key": "D1", "existing_detail_id": null,
      "fields": { "action": { …필드 객체… } },
      "achievements": [ { "achievement_key": "A1", "metric_name": { … }, "value_after": { … } } ] },
    { "detail_key": null, "existing_detail_id": "uuid", "fields": { "result": { … } }, "achievements": [] }
  ],
  "skills": [ { "value": "Kafka", "source_message_ids": ["uuid"], "source_quotes": ["…"] } ],
  "clarifications": [ { "kind": "actor_ambiguous", "field": "action", "detail_key": "D1", "existing_detail_id": null } ],
  "sensitive_flags_count": 0
}
```
- 추가 키(DM에 없음): 성과의 `achievement_key`, clarifications의 `existing_detail_id`. 기존 상세 내용 항목은 `detail_key = null`.
- `start_writing_chat`이 위 뼈대(빈 값)로 시작한다.

### 예시 — AI 패치 (턴 1회, 별칭 → UUID 변환 후)
```json
{ "ops": [
  { "op": "set", "target": {"section":"project","field":"team_size"}, "value": 4,
    "source_message_ids": ["<M3 uuid>"], "source_quotes": ["저 포함 4명이었어요"] },
  { "op": "set", "target": {"section":"project","field":"start_month"}, "value": "2023-03",
    "source_message_ids": ["<M2 uuid>"], "source_quotes": ["23년 3월부터"] },
  { "op": "new_detail", "detail_key": "D1" },
  { "op": "set", "target": {"section":"detail","detail_key":"D1","field":"action"},
    "value": "결제 승인 API의 병목 쿼리를 APM으로 찾아 인덱스를 재설계했다",
    "source_message_ids": ["<M7 uuid>"], "source_quotes": ["APM으로 병목 쿼리를 찾아서 인덱스를 다시 설계했어요"] },
  { "op": "set", "target": {"section":"detail","detail_key":"D1","field":"result"}, "value": "응답이 빨라졌다",
    "source_message_ids": ["<M9 uuid>"], "source_quotes": ["빨라졌어요"], "review": "needs_review" },
  { "op": "set", "target": {"section":"detail","existing_detail_id":"<DET-12 uuid>","field":"result"},
    "value": "장애 알림 건수가 줄었다", "source_message_ids": ["<M11 uuid>"], "source_quotes": ["그 뒤로 장애 알림이 확 줄었어요"] },
  { "op": "add_achievement", "detail": {"detail_key":"D1"}, "fields": {
      "metric_name": {"value":"결제 승인 API 응답 시간","source_message_ids":["<M9 uuid>"],"source_quotes":["1.2초 걸리던 게 0.7초로 줄었어요"]},
      "value_before": {"value":1.2,"source_message_ids":["<M9 uuid>"],"source_quotes":["1.2초"]},
      "value_after": {"value":0.7,"source_message_ids":["<M9 uuid>"],"source_quotes":["0.7초"]},
      "unit": {"value":"초","source_message_ids":["<M9 uuid>"],"source_quotes":["초"]} } },
  { "op": "add_skill", "value": "Kafka", "source_message_ids": ["<M4 uuid>"], "source_quotes": ["Kafka로 이벤트를 받아서"] },
  { "op": "set_affiliation_suggestion", "type": "experience", "id": "<EXP-1 uuid>", "source_message_ids": ["<M1 uuid>"] },
  { "op": "set_clarifications", "items": [ {"kind":"actor_ambiguous","field":"action","detail_key":"D1"} ] },
  { "op": "add_sensitive_flags", "count": 1 }
] }
```
- AI 출력 `op: "append"`는 파이프라인이 기존 값과 합친 최종 값 + 합친 출처로 `set`을 보낸다(RPC에는 append가 없다).
- AI 출력 `new_details[]` → `new_detail` op, `detail_patches[]` → `set`(detail target), `achievements[]` → `add_achievement`, `clarifications[].detail_ref` → `existing_detail_id`, `sensitive_flags[]` → 개수만 `add_sensitive_flags`.
- 이미 있는 성과의 값을 다음 턴에 채우려면 `set` + `{"section":"achievement","achievement_key":"A1","field":"value_after"}`.

### 예시 — 사용자 패치 (미리보기 서버 액션)
```json
{ "ops": [ { "op": "set", "target": {"section":"project","field":"role"}, "value": "백엔드 리드" } ] }
{ "ops": [ { "op": "accept", "target": {"section":"detail","detail_key":"D1","field":"result"} } ] }
{ "ops": [ { "op": "reject", "target": {"section":"detail","detail_key":"D1","field":"result"} } ] }
{ "ops": [ { "op": "set", "target": {"section":"achievement","achievement_key":"A1","field":"unit"}, "value": "ms" } ] }
{ "ops": [ { "op": "add_skill", "value": "Redis" }, { "op": "remove_skill", "value": "kafka" } ] }
```


## 마이그레이션 파일
| 파일 | 내용 |
|------|------|
| `supabase/migrations/20261030000100_s4_writing_chats.sql` | `writing_chats`, `writing_chat_messages` + CHECK + 인덱스 + 상태 가드 트리거 + RLS + grant(service_role 쓰기 회수) |
| `supabase/migrations/20261030000200_s4_source_writing_chat_fks.sql` | `source_writing_chat_id` 복합 FK 3개(set null) + 인덱스 + 링크 해제 시 `updated_at` 유지 트리거 + projects·project_details `source_writing_chat_id` update grant |
| `supabase/migrations/20261030000300_s4_writing_chat_message_rpcs.sql` | `start_writing_chat`, `append_writing_chat_message`, `begin_assistant_message`, `finish_assistant_message`, `mark_writing_chat_extracted` + 빈 정리 결과·시작 인사 헬퍼 |
| `supabase/migrations/20261030000400_s4_structured_draft_patch.sql` | `apply_structured_draft_patch`(invoker 래퍼 + `private.apply_structured_draft_patch_impl` definer), 값·출처 검사 헬퍼, `set_writing_chat_affiliation` |
| `supabase/migrations/20261030000500_s4_save_writing_chat.sql` | `save_writing_chat`, `hand_off_writing_chat`(invoker) → `private.commit_writing_chat`(invoker) + `private.finalize_writing_chat`(definer) |
| `supabase/migrations/20261030000600_s4_career_deletion_writing_chat.sql` | `get_deletion_impact`·`delete_career_item` create or replace(`writing_chat` 대상, `cascade.writing_chats` 실제 집계) |

## 테이블·컬럼 (스펙 대비 차이 포함)
### writing_chats (DM 2.5)
- DM 컬럼 그대로(`usage_event_id` 없음) + `id`, `user_id`(기본 `auth.uid()`), `created_at`, `updated_at`, **`last_extracted_sequence smallint not null default 0`**(spec-gaps 2026-10-30 ①).
- FK: `project_id` 복합 → projects cascade, `experience_id`/`education_id` 복합 → set null(그 컬럼만). `unique (id, user_id)`.
- CHECK: mode 2값, status 4값, `message_count 0..40`, 소속 ≤ 1, `structured_draft`는 object, `return_target`는 null 또는 `feature` 4값 object, `last_extracted_sequence >= 0`. **추가 [구현 결정]**: augment면 `project_id` 필수, saved/handed_off면 `project_id` 필수, `saved_at`은 saved일 때만.
- 인덱스: `(user_id) where status='active'`, `(user_id, project_id)`, `(user_id, experience_id)`·`(user_id, education_id)` 부분 인덱스(set null 연쇄용).
- 가드 트리거: saved/handed_off/abandoned는 끝 상태. 사용자 직접 update는 `active → abandoned`만(`invalid_writing_chat_transition`).
### writing_chat_messages (DM 2.5)
- DM 컬럼 + `provider`, `model`, `model_tier`, `connection_tier`(assistant 결과 메타, 4개 모두 있거나 모두 null). user 행은 `done`·job 없음·메타 없음(CHECK).
- `unique (writing_chat_id, sequence)`, `sequence >= 1`, `content ≤ 4000`. 복합 FK → writing_chats cascade.
### source_writing_chat_id (QA-S2-07)
- 3개 테이블에 복합 FK `(source_writing_chat_id, user_id) → writing_chats(id, user_id) on delete set null (source_writing_chat_id)`.
- 대화 삭제로 링크만 지워질 때는 `updated_at`을 유지한다(근거 칩 "변경됨" 오탐 방지, `profiles.career_data_updated_at`은 갱신됨).

## RLS·권한 요약 (DM §5 대비)
| 대상 | authenticated | app_ai_writer | service_role |
|------|---------------|---------------|--------------|
| writing_chats | select·delete 본인, update(`status`, `return_target`) | select 본인 | select·delete |
| writing_chat_messages | select 본인 | select 본인 | select·delete |
| `structured_draft` 직접 update | 없음 | 없음 | 없음 |
| 함수 | start, append, set_affiliation, apply_patch, save, hand_off, (기존) 삭제 RPC | begin, finish, mark_extracted, apply_patch | — |
- DM §5와 다른 점(spec-gaps 2026-10-30 S4 db ①): append가 definer, app_ai_writer 직접 컬럼 쓰기 없음(전부 definer RPC). 커리어 7개 테이블에 대한 app_ai_writer 권한은 여전히 select만.
- private 헬퍼 실행 권한: `writing_chat_empty_draft`(authenticated, app_ai_writer), `apply_structured_draft_patch_impl`(authenticated, app_ai_writer — public 래퍼가 호출 역할로 행위자를 넘김. private은 PostgREST에 노출되지 않음), `wc_normalize_draft`·`wc_normalized_name`·`wc_writable*`·`commit_writing_chat`·`finalize_writing_chat`(authenticated).

## 테스트 (`supabase test db` 결과)
**Files=25, Tests=1066, PASS.**
- 신규 `supabase/tests/writing_chats.test.sql`(99): RLS·정책, `structured_draft` update 권한 0(모든 역할), 직접 쓰기 권한 표, start 오류 6종·인사(seq 1, count 1, 무료 등급 안내)·return_target 정규화, 직접 insert/update 거부, append(공백·4000자·없는 대화·trim), B 격리, app_ai_writer 커리어 쓰기 불가·사용자 RPC 실행 불가, begin 오류(작업 종류·대상·메타·사용자 메시지 없음·turn_in_progress), finish 분기, **다시 보내기 = 같은 행·count 불변**, 2분 지난 streaming 재사용, 새 턴 시 남은 streaming → failed, mark_extracted(범위·단조), **상한: 38에서 사용자 OK → 39에서 거부, AI 40 + is_final, 상한에서도 다시 보내기 가능**, CHECK 41 거부, 상태 가드, 탈퇴 cascade.
- 신규 `supabase/tests/structured_draft_patch.test.sql`(67): AI 패치 op별 거부 목록(V-9a: 인사·남의 대화·빈 출처, 값 형식, D-key 없음, new_project의 existing_detail_id, 성과 출처, 남의 경력 제안)과 나머지 반영, 필드 객체 모양·trim·needs_review, 성과 A1, 스킬 정규화 병합, clarifications 자유 텍스트 제외, sensitive 개수, 형식 오류 예외(AI의 accept·remove, 빈 ops, 소속 키), 사용자 set/accept/reject(origin 유지)·원자성·null로 비우기·스킬/성과 추가 삭제, **보호 필드(user_edit·accepted) AI 거부 + 거절·비운 필드는 AI가 다시 채움**, **V-9h(AI·사용자 공통, 공백 값 = 빈 값, 다른 프로젝트 상세 내용 거부)**, 같은 사용자의 다른 대화 메시지 출처 거부, remove_detail이 clarifications도 지움, 소속 RPC 전 분기, 비활성 대화 거부, 역할별 실행 불가.
- 신규 `supabase/tests/writing_chat_save.test.sql`(46): 저장 전 커리어 불변, **저장 규칙(needs_review 4개 건너뜀, accepted 반영, 빈 D2 미생성, 월 → date, 소속 = 대화 컬럼, 출처 id, complete 판정, 스킬 normalized_name 연결·태그 스킬 생성)**, 저장 후 읽기 전용, **augment hand-off(빈 컬럼만 — 패치 뒤 폼에서 채운 값 유지, 소속 불변, 기존 상세 내용 빈 칸 채움, 새 상세 내용 draft·순서 끝, 기존 상세 내용에 성과 추가, saved_at null)**, invalid_period 시 아무것도 안 씀, B 격리, **삭제: writing_chat 영향 `{message_count, linked_saved_rows}`, 경력 delete_projects/keep_projects·프로젝트의 `cascade.writing_chats`, 대화만 삭제 → 커리어 행 유지·링크 null·updated_at 유지, 프로젝트 삭제 → 대화·메시지 cascade, 경력 삭제 → 대화 experience_id null**.
- 신규 `supabase/tests/s4_first_call_privileges.test.sql`(29): authenticated → app_ai_writer → authenticated 순으로 S4 경로 전체를 실제 역할이 처음 호출.
- 수정 `career_deletion_rpcs.test.sql`: `writing_chat`이 이제 유효 → 없는 대화 id는 `career_item_not_found`, 모르는 대상은 `invalid_entity_type`.
- 수정 `grants.test.sql`(22): app_ai_writer 테이블 select +2, 실행 함수 +4, S4 RPC 역할 표, `structured_draft` update 권한 0.

## 원격 브랜치 적용 여부
하지 않음(계획대로 로컬 전용). 커밋하지 않음.

## 스펙 차이·가정 (spec-gaps.md 2026-10-30 · S4 (db))
- 쓰기 경로를 DM §5보다 좁힘(append definer, app_ai_writer 직접 컬럼 쓰기 없음).
- 상한: 사용자 메시지는 count ≤ 38일 때만(답 자리 확보), `is_final`.
- 죽은 streaming 턴 2분 규칙.
- 상태: saved/handed_off/abandoned 끝 상태, 사용자 직접은 active → abandoned만.
- 패치 형식·추가 키(`achievement_key`, clarifications `existing_detail_id`), 사용자 `value: null` = 필드 삭제.
- AI 패치는 op 단위 거부, 사용자 패치는 전체 거부.
- 소속 제안 반복은 파이프라인 몫, 보강 모드 제안 거부.
- 길이 제한(name·role 100, metric_name 200, unit 50).
- 시작 인사 문구·무료 등급 안내.
- `return_target.application_project_id`는 uuid 모양만(S5 전).

## 다른 팀원에게 (요약)
- **ai-pipeline-engineer**: 패치는 위 "패치 계약". 별칭(`M-n`, `DET-n`, `EXP-n`/`EDU-n`) → UUID 변환 후 보낸다. `append`는 파이프라인이 합쳐 `set`으로. V-9a·V-9h는 DB도 다시 막고 `rejected[]`로 돌려준다. 정리 입력은 `sequence > last_extracted_sequence`인 user 메시지(+ `status='done'` 대화 기록).
- **api-engineer**: RETURNS TABLE RPC(`append_writing_chat_message`, `begin_assistant_message`)는 PostgREST에서 배열로 온다(`.single()`). 사용자 패치 오류는 P0001 message가 곧 코드다. 대화 목록(S-08)은 `writing_chats where status='active'` 직접 select. 그만두기는 `update writing_chats set status='abandoned'`, 대화만 삭제는 `delete_career_item('writing_chat', id)`(또는 직접 delete). 저장 확인 다이얼로그의 "검토하지 않은 항목 N개"는 `structured_draft`에서 직접 셀 수 있고, 저장 후 `skipped_needs_review`와 같다.


## QA 라운드 1 반영 (2026-10-30)
S4는 아직 병합·커밋 전이라 새 파일 대신 **S4 마이그레이션 파일 안에서 고쳤다**(S2 QA 때와 같은 방식).
- **QA-S4-06**: `private.apply_structured_draft_patch_impl`이 인자 `p_actor`를 호출 역할과 대조한다. definer로 바뀌어도 남는 `current_setting('role')`(PostgREST의 SET ROLE)이 `ai` ↔ `app_ai_writer`, `user` ↔ `authenticated`와 맞지 않으면 **`42501 actor_mismatch`**다. SET ROLE이 없는 호출(소유자·서비스 경로)도 거부한다. `private`가 노출돼도 행위자를 위조할 수 없다. 테스트 3개(`structured_draft_patch.test.sql`).
- **QA-S4-04 (DB)**: 헬퍼 `private.writing_chat_message_is_live(msg)`를 추가했다. 기준은 위 "살아 있는 턴"이다.
  - `append_writing_chat_message`는 살아 있는 턴이 있으면 **`P0001 turn_in_progress`**로 거부한다. 두 탭이 턴을 섞지 못한다.
  - `begin_assistant_message`의 재사용 조건도 같은 헬퍼를 쓴다. 2분 규칙은 유지하고, 작업이 끝난 streaming 행은 즉시 재사용한다.
  - `finish_assistant_message`는 streaming → failed를 언제든 바로 처리한다. 내용이 비어도 된다. 끊김 처리는 이것으로 충분하다.
- **api가 바꿀 것**: `append_writing_chat_message`의 `turn_in_progress`를 409로 매핑한다(begin과 같은 코드).
- 결과: 시그니처가 바뀌지 않아 타입도 그대로다. `supabase db reset` OK, `supabase test db` **25파일 1074개 PASS**, `pnpm test` 53파일 910개 통과, typecheck 통과.
