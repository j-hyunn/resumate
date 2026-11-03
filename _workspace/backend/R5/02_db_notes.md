# R5 DB 구현 노트 (프로젝트 추가·산출물 상세 PA-1~PA-4, DM v4.5)

- 기준: DM v4.5 11.3 표 + 2.3·2.5·2.5.0·2.5.1·3.3·3.7·4.1~4.3·7장, AI 명세 v4.6 AI-12·AI-13
- 결과: `supabase db reset` 통과, `supabase test db` **53개 파일 2,588개 테스트 전부 통과**
- 원격 개발 브랜치: 적용 안 함(계획대로). 커밋 안 함.
- `src/server/db/database.types.ts` 재생성 완료. `pnpm typecheck` 오류 **1건**(api 몫): `src/server/services/writing-chat/chat.ts:205` — `apply_writing_chat_proposal` RPC가 없어짐.

## 마이그레이션 파일 (새 파일만, 기존 파일 수정 없음)

| 파일 | 내용 (DM 11.3 행) |
|------|------|
| `supabase/migrations/20261110000100_r5_deliverable_writing_chats.sql` | `project_deliverables` `unique (id, project_id, user_id)`. `writing_chats.project_deliverable_id` + 복합 FK `(project_deliverable_id, project_id, user_id)` cascade, CHECK `project_deliverable_id is null or return_target is null`, 부분 인덱스 `writing_chats_project_deliverable_id_last_activity_idx`. 트리거 `writing_chats_require_affiliated_project` → **`writing_chats_check_target`**. 가드에 `project_deliverable_id` 불변 추가. 빈 산출물 초안·종류 짐작·산출물 시작 인사 3종. `start_writing_chat` 3인자(+`p_form_snapshot`)로 교체, **`start_deliverable_writing_chat` 신설** |
| `…000200_r5_structured_draft_patch_v4.sql` | `apply_structured_draft_patch` 내부 구현 교체(시그니처·grant 그대로): 대상별 분기, STAR `rev`·`new_object`·V-9h 낮춤·기간/분류 DB 거부 삭제, 산출물 연산 전부, 마크다운 조립기 |
| `…000300_r5_drop_apply_writing_chat_proposal.sql` | **`apply_writing_chat_proposal` 삭제**(grant 함께), `private.wc_proposal_lock`·`private.wc_proposal_mark_applied` 삭제. **`private.wc_mark_proposal_applied`**, `private.projects_set_source_writing_chat` 신설 |
| `…000400_r5_page_save_rpcs.sql` | **`save_project_page`**, **`save_project_deliverable`** 신설(invoker, `authenticated`만 execute) |
| `…000500_r5_projects_updated_at_source_only.sql` | `projects`: `source_writing_chat_id`**만** 바뀌는 update는 `updated_at` 유지(R4는 set null만 유지했음). 같은 트리거 함수 교체 |
| `…000600_r5_career_deletion_writing_chats.sql` | `get_deletion_impact`: `project_deliverable`의 `cascade.writing_chats` = 그 산출물의 대화 수. 독립 프로젝트는 기존 `project_id` 규칙으로 이미 산출물 대화를 셈. `delete_career_item`은 이 함수를 반환하므로 따라감 |

- 탈퇴(11.3 행): `get_account_deletion_summary().career.writing_chats`는 `user_id` 행 기준 count라 산출물 대화가 이미 포함된다 → **변경 없음**(pgTAP로 확인: STAR 2 + 산출물 5 = 7). `delete_account`도 `writing_chats` 전체를 먼저 지우므로 변경 없음.
- `writing_chats_cancel_jobs`(삭제 시 턴 취소)는 산출물 FK cascade에서도 돈다 → pgTAP 확인.
- 데이터 이관 없음: 기존 STAR 대화는 `project_deliverable_id = null`, 기존 필드 객체의 `rev` 없음은 **읽을 때 1**(`private.wc_rev`).

## 테이블·컬럼 (스펙 대비)

- `writing_chats.project_deliverable_id uuid null` — 사용자 세션 insert/update grant 없음(가드 + grant). `app_ai_writer`는 테이블 select라 읽힌다.
- 산출물 대화의 `project_id` = 산출물의 부모 독립 프로젝트(늘 채움). 복합 FK 때문에 **대화가 있는 산출물의 `project_id`는 바꿀 수 없다**(23503).
- 트리거 `writing_chats_check_target`(insert): `project_deliverable_id` null이면 소속 프로젝트여야 함(`writing_chat_requires_affiliated_project`), 아니면 통과(FK가 보장).
- 컬럼 추가 없음: `project_deliverables`에 분류·`source_writing_chat_id` 없음(DM 그대로).

## RPC 시그니처와 반환 (api·ai 계약)

| RPC | 실행 | 인자 | 반환 | 오류(message) |
|-----|------|------|------|---------------|
| `start_writing_chat` **(시그니처 변경)** | authenticated, definer | `p_project_id uuid, p_return_target jsonb default null, p_form_snapshot jsonb default null` | `uuid` | `not_authenticated`(42501), `project_not_found`, `writing_chat_requires_affiliated_project`, `invalid_return_target`, **`invalid_form_snapshot`** |
| **`start_deliverable_writing_chat`** (신설) | authenticated, definer | `p_project_deliverable_id uuid, p_form_snapshot jsonb default null` | `uuid` | `not_authenticated`, **`project_deliverable_not_found`**, `invalid_form_snapshot` |
| **`save_project_page`** (신설) | authenticated, **invoker** | `p_project_id uuid, p_values jsonb, p_expected_updated_at timestamptz default null, p_applied_proposals jsonb default null` | jsonb (아래) | 아래 표 |
| **`save_project_deliverable`** (신설) | authenticated, **invoker** | `p_project_deliverable_id uuid, p_project_id uuid, p_title text, p_body text, p_expected_updated_at timestamptz default null, p_applied_proposals jsonb default null` | jsonb (아래) | 아래 표 |
| `apply_structured_draft_patch` (구현 변경) | authenticated + app_ai_writer, invoker → definer impl | 그대로 `p_writing_chat_id uuid, p_patch jsonb` | `{ structured_draft, rejected: [{index, op, reason[, fact_index]}] }` | 기존 + **`writing_chat_draft_limit_reached`**. **`classification_already_set` 삭제** |
| ~~`apply_writing_chat_proposal`~~ | **삭제** | — | — | — |

- 생성 타입 주의: `supabase gen types`는 nullable 인자를 표시하지 않는다. `save_project_page.p_project_id`·`save_project_deliverable.p_project_deliverable_id`·`p_project_id`는 만들기에서 `null`을 보내야 하므로 호출부에서 `null as unknown as string` 같은 우회가 필요하다(R4 `sort_order`와 같은 성격).
- `start_*`는 `uuid`만 반환(R5-DB-1). 인사는 메시지 sequence 1.

### `p_form_snapshot` (시작 RPC — 인사 분기만, 저장 안 함)
- STAR: `{name?, star?: {situation, task, action, result, learnings}, …}` — `name`(공백 아니면)과 `star` 값만 읽는다. 키가 있으면 그 값이 DB 값보다 우선(빈 문자열 = 비어 있음). 다른 키는 무시. object 아님·`star` object 아님·`name` > 100·STAR > 2,000·문자열 아님 → `invalid_form_snapshot`.
- 산출물: `{title?, body?}` — `title`(공백 아니면)이 짐작·인사 제목, `body` 키가 있으면 본문 유무 판정. > 100 / > 20,000·문자열 아님 → `invalid_form_snapshot`.

### 산출물 시작 인사 (고정 문구 `[가정]`, 최종 문구는 UX)
1. 본문 비어 있음 + 종류 모름: `'{제목}'을 함께 써 볼게요. 몇 가지 여쭤보고, … 어떤 글인가요? 기획서 요약, 설계 문서, 회고, 발표 내용처럼 알려 주세요.`
2. 본문 비어 있음 + 제목으로 종류 짐작: `'{제목}'을 {종류}(으)로 정리해 볼게요. {슬롯 1 질문}`
3. 본문 있음: `지금 본문을 바탕으로 더 채워 볼게요. 보강하고 싶은 부분을 알려 주시거나, 아래 버튼으로 시작하세요.`
- + 빈 줄 + `회사 기밀, 민감정보, 다른 사람의 개인정보는 쓰지 말아 주세요.` (+ 무료 등급 안내 1문장)
- 짐작한 `writing_kind`는 빈 초안에 미리 넣는다(본문이 있어도 넣음). 키워드는 spec-gaps R5-DB-13.

### `save_project_page` 반환·규칙
```json
{ "project_id": "uuid", "status": "draft|complete", "updated_at": "timestamptz",
  "applied": [ { "writing_chat_id": "uuid", "field": "result" } ],
  "skipped": [ { "writing_chat_id": "uuid", "field": "task", "reason": "needs_review" } ] }
```
- `p_values` 허용 키: `name, experience_id, education_id, start_month, end_month('YYYY-MM'|null), is_current, project_type, experience_type, competencies, situation, task, action, result, learnings`. 키 없음 = 유지(만들기면 null/기본값), null = 비움(`is_current` null = false, `competencies` null = `{}`).
- 저장 값: 이름은 앞뒤 공백 제거, STAR는 공백뿐이면 null(본문은 자르지 않음).
- 값이 하나도 안 바뀐 고치기는 update를 하지 않는다 → `updated_at` 그대로(R5-DB-11).
- 응답의 `applied`·`skipped`는 **요청 순서**. 처리(잠금)는 대화 id 순.
- 기록 성공 원소 중 요청 순서상 마지막 원소의 대화로 `projects.source_writing_chat_id`를 쓰고, 이 update는 `updated_at`을 올리지 않는다.

| 오류 message | 언제 | raise `detail` |
|---|---|---|
| `invalid_fields` | `p_values`가 object 아님 / 허용 밖 키 / JSON 타입 오류(id가 uuid 아님 포함) / `p_applied_proposals`가 배열 아님·50개 초과 | 키 이름 쉼표 구분(또는 `p_values`·`p_applied_proposals`) |
| `not_found` | 고치기 대상 없음·남의 것 / 만들기·이동의 부모(경력·교육)가 없음·남의 것 | 부모면 `experience_id`·`education_id` |
| `project_not_affiliated` | 고치기 대상이 독립 프로젝트 | — |
| `stale_write` | `p_expected_updated_at`이 있고 행의 `updated_at`과 다름(고치기만) | 현재 `updated_at` ISO UTC 문자열 |
| `project_name_required` | 이름 없음·공백 | — |
| `field_too_long` | 이름 > 100, STAR > 2,000 | 필드 이름 |
| `project_affiliation_required` | 만들기에 소속 없음 / 경력·교육 둘 다 | — |
| `project_scope_change_not_allowed` | 고치기에서 소속을 둘 다 비움 | — |
| `invalid_period` | 월 형식 오류 / `end_month < start_month` / `is_current`인데 `end_month` 있음 | `start_month`·`end_month` |
| `invalid_classification` | 분류 키 목록 밖 / 역량 > 3·중복·문자열 아님 | 필드 이름 |

- `p_applied_proposals` 원소 `{writing_chat_id, field, rev}`. `field` ∈ STAR 5 + `start_month`·`end_month` + 분류 3.

### `save_project_deliverable` 반환·규칙
```json
{ "project_deliverable_id": "uuid", "project_id": "uuid", "sort_order": 3, "updated_at": "timestamptz",
  "applied": [ { "writing_chat_id": "uuid" } ], "skipped": [ { "writing_chat_id": "uuid", "reason": "proposal_changed" } ] }
```
- 만들기(`p_project_deliverable_id` null): `p_project_id` 필수·본인 것(아니면 `not_found` detail `project_id`), 독립 프로젝트만(`deliverable_requires_standalone_project`), 50개(`deliverable_limit_reached`), `sort_order` 맨 뒤. `p_body` null = `''`.
- 고치기: `p_project_id`는 null이거나 부모와 같아야 함(아니면 `not_found`). 제목·본문이 같으면 update 안 함.
- 오류: `deliverable_title_required`, `field_too_long`(detail `title`/`body`), `stale_write`(detail 현재 `updated_at`), `not_found`, `invalid_fields`(detail `p_applied_proposals`) + 트리거 코드 2개.
- 원소 `{writing_chat_id, rev, mode}`, `mode` ∈ `replace`·`append`.

### `skipped[].reason` 판정 (`private.wc_mark_proposal_applied`, 원소마다 하위 트랜잭션)
1. 원소 모양 오류(object 아님, `writing_chat_id` uuid 문자열 아님, `rev` 0 이상 정수 아님, `field`/`mode` 문자열 아님) → `invalid_entry`
2. 허용 밖 `field`(예: `is_current`)·`mode` → `invalid_entry`
3. 대화 없음·남의 것·이 대상의 대화 아님(STAR: `project_id` 다르거나 산출물 대화 / 산출물: `project_deliverable_id` 다름)·필드 객체 없음 → `not_found`
4. `applied_at` 있음 → `already_applied`
5. 보낸 `rev` ≠ 현재 `rev`(없으면 1) → `proposal_changed`
6. 필드 객체 `value` null(거절·비움 뒤) → `not_found`
7. STAR: `review` ∉ `ok`/`accepted` → `needs_review`. 산출물: `type ≠ heading`이고 `review` ∈ `ok`/`accepted`인 블록이 하나도 없음 → `needs_review`
8. 그 밖의 예외 → `mark_failed` (커리어 저장은 커밋)
- 기록: STAR 필드 `applied_at = now()`(rev 그대로), 산출물 body `applied_at`·`applied_mode`·`applied_rev`, 대화 `last_applied_at`·`last_activity_at`. `active`·`closed` 모두.

## `structured_draft` 변경

### STAR 대화 (schema_version 3 그대로)
- 모든 필드 객체에 **`rev`**(정수). 새 슬롯 1, `value`가 바뀔 때마다 +1(AI set/append·이어 붙임, 사용자 수정, 거절, 비우기), 새 객체로 바꿀 때도 이전 + 1, **수락은 그대로**. 없는 객체는 1로 읽음.
- AI 패치 `new_object: true`(set/append, boolean, `app_ai_writer`만): 이어 붙이지 않고 슬롯을 새 객체로(이전 rev + 1). `user_edit`·`accepted` 보호도 넘는다(R5-DB-2). 사용자 패치에 있으면 `invalid_patch`.
- V-9h: DB 값이 있는 STAR 컬럼에 `set` → 저장 `op = 'append'`(거부 없음). 기간·분류 "비어 있을 때만" DB 검사 삭제(AI·사용자 모두). 반환 `rejected`에서 `field_already_filled`·`classification_already_set` 사라짐. `is_current`는 여전히 `field_not_patchable`.
- 사용자 `set` null(비우기): 슬롯을 지우지 않고 `{value: null, origin: 'ai', review: 'ok', reviewed_at: now, applied_at: null, rev + 1, (op)}`로 둔다(거절과 같은 모양 → AI가 다시 채울 수 있음).
- 산출물 연산이 오면 `invalid_patch`.

### 산출물 대화 (target `project_deliverable`, schema_version 1, DM 2.5.0 모양 그대로)
빈 초안: `{schema_version:1, target:'project_deliverable', writing_kind, facts:[], deliverable:{}, clarifications:[], sensitive_flags_count:0, draft_count:0}`

**AI 연산** (`app_ai_writer`, 대화 `active`만):
| op | 모양 | 효과 / 거부 |
|---|---|---|
| `add_facts` | `{facts: [{id?, slot, text, actor, source_message_ids, source_quotes?, review?}]}` 1~80 | 사실마다 검사, 틀린 사실만 `rejected`(`fact_index`, `invalid_value`/`invalid_source`/`facts_limit_reached`). `id`는 uuid면 그대로(이미 있으면 새로 매김), 없으면 DB가 매김 → **같은 패치 안 뒤 연산의 `source_fact_ids`가 이 id를 쓸 수 있다**. `text` 1~500(trim), `slot` ∈ AI-13 슬롯 19개, `actor` ∈ self/team/unknown, `source_message_ids` 1~20개 이 대화 user 메시지(V-9a), `review` ok/needs_review. 저장 `origin 'ai'`, `reviewed_at null` |
| `replace_draft` | `{body: {blocks[1..200], base_body_hash?, replace_allowed?(기본 true), missing_slots?, dropped_block_count?}}` | `draft_count >= 6`이면 **raise `writing_chat_draft_limit_reached`**. 블록 검증 실패 → `rejected` `invalid_value`/`invalid_source`(횟수 안 셈). 성공 → `deliverable.body` 새 객체(`value` = DB 조립, `rev` = 이전 + 1 또는 1, `generated_at = now()`, `applied_*` null), `draft_count + 1`. 반영 여부와 관계없이 교체. `body.value`를 보내도 무시 |
| `count_draft` | `{}` | 내용 블록이 안 남은 초안 턴: `draft_count + 1`만. 6이면 raise |
| `set_writing_kind` | `{value: kind|null}` | 목록 밖 → `rejected invalid_value` |
| `set_clarifications` | `{items: [{kind: actor_ambiguous|number_vague, slot?, note? ≤200}]}` ≤ 50 | 목록 교체. 틀리면 raise `invalid_patch` |
| `add_sensitive_flags` | `{count: 0..100}` | 누적 |

**블록** (저장 모양): `{block_id(1~50자, 초안 안 유일), type, [level 1~6 기본 2 — heading], [text — heading ≤500 한 줄 / paragraph·quote·code ≤8,000], [items — bullet/numbered 1~100, 문자열 또는 {text, 출처…}], [rows — table 1~100행, 행 = 셀 배열 또는 {cells, 출처…}, 셀 1~20], basis(new|current_body, heading은 null 가능, 그 밖 기본 new), source_fact_ids(이 대화 사실 id만, ≤40), source_body_quotes(≤20개·≤1,000자), source_project_fields(문자열 ≤10개·≤50자), review(ok|needs_review)}`. 조립 결과 `value` 1~8,000자 아니면 `invalid_value`.

**사용자 연산** (사용자 세션, `active`·`closed`):
| op | 효과 |
|---|---|
| `accept_fact {fact_id}` | `needs_review` → `accepted`, `reviewed_at` (아니면 `invalid_review_transition`, 없는 id는 `invalid_patch`) |
| `reject_fact {fact_id}` | `needs_review` 사실을 **배열에서 지움**(R5-DB-4) |
| `accept_block {block_id}` | `needs_review` → `accepted`, **rev 그대로** |
| `remove_block {block_id}` | 블록 삭제 + `value` 재조립 + **rev + 1** |
- 반영된 초안(`body.applied_at` 있음)에 블록 연산 → `field_already_applied`. 초안 없음·없는 블록 id → `invalid_patch`. 초안 전체 거절·블록 문장 수정 연산은 없음.
- STAR 연산이 오면 `invalid_patch`.

### 마크다운 조립 규칙 (`private.wc_deliverable_markdown`, 정본)
- 블록 사이 빈 줄 1개(`\n\n`).
- heading: `#`×level + 공백 + text(trim). paragraph: text(trim). quote: `> ` + 줄마다 `> `. code: "```\n" + text(끝 공백·줄바꿈 제거) + "\n```".
- bullet_list: 항목마다 `- 항목`(항목 = 문자열 또는 `.text`, trim, 줄바꿈 → 공백), `\n` 연결. numbered_list: `1. `, `2. ` ….
- table: 행마다 `| a | b |`(셀 = 문자열 또는 `.text`, `|` → `\|`, 줄바꿈 → 공백), 첫 행 뒤 `| --- | --- |`(첫 행 셀 수만큼).

## RLS·권한 요약 (DM §5 대비)
- `save_project_page`·`save_project_deliverable`·`start_deliverable_writing_chat`: `authenticated`만 execute(anon·app_ai_writer·app_key_reader 없음, pgTAP 매트릭스).
- 저장 RPC는 invoker → 커리어 쓰기는 사용자 RLS·컬럼 grant 그대로. `structured_draft`·`last_applied_at`·`source_writing_chat_id`는 definer 헬퍼(`private.wc_mark_proposal_applied`, `private.projects_set_source_writing_chat` — `private` 스키마라 API 비노출, `authenticated` execute만)로만.
- `app_ai_writer`는 커리어 테이블 쓰기·저장 RPC 실행 불가(테스트), `structured_draft`는 여전히 `apply_structured_draft_patch`로만.
- 잠금 순서: 저장 RPC = 대상 행(`for update`) → 대화 행(id 순). 패치 RPC = 대화 행만(커리어 행 안 잠금) → 교착 없음.

## 테스트 (`supabase test db` 결과)
- **PASS — 53 files, 2,588 tests.**
- 새 파일
  - `supabase/tests/r5_deliverable_writing_chats.test.sql` (67): 컬럼·FK·cascade 종류·부분 인덱스·트리거 교체·grant, 시작 RPC(남의 산출물, 스냅숏 오류, 인사 3종·조사 로/으로, 종류 짐작, 스냅숏 우선·미저장), STAR 시작 + 스냅숏, 복합 FK(다른 프로젝트·소속 프로젝트·다른 사용자), CHECK(return_target), 대상 열 불변, 대화 있는 산출물 이동 불가, 삭제 영향(산출물·독립 프로젝트·대화), 탈퇴 집계, 산출물 삭제 cascade + 턴 취소, 독립 프로젝트 삭제 cascade
  - `supabase/tests/r5_structured_draft_patch.test.sql` (64): rev 단조(새 슬롯 1, 값 변경 +1, `new_object` +1, 수정·비우기 +1, 수락 그대로), `new_object` 검증·보호 넘음, 대상 밖 연산 `invalid_patch`, 사실 검증, `replace_draft`(알 수 없는 사실 출처 거부·횟수 안 셈, 조립 결과, 메타), `count_draft`, 6회 상한, 사용자 사실·블록 연산, 반영된 초안 보호, 중복 사실 id, closed 대화
  - `supabase/tests/r5_page_save.test.sql` (93): 권한·invoker/definer, 폐기 객체 부재, 만들기 거부 코드 전부 + detail, 만들기 성공·저장 값, 고치기(not_found·독립·stale_write + detail·변경 없음·범위 변경·소속 이동), B 격리, 반영됨 기록(applied 순서, needs_review·proposal_changed·다른 프로젝트 대화·필드 없음·invalid_entry), **기록 실패(`mark_failed`)가 저장을 막지 않음**, already_applied, `source_writing_chat_id` 변경·대화 삭제 set null에서 `updated_at` 유지, 산출물 저장 전부(만들기·고치기·stale·이동 금지·50개·기록 replace/needs_review/STAR 대화/모드 오류·새 초안 뒤 `proposal_changed`·대화 삭제 시 `updated_at` 유지)
- 고친 기존 파일: `structured_draft_patch.test.sql`(rev 기대값, V-9h 낮춤·분류 거부 삭제 반영, 반영은 `save_project_page`로), `writing_chats.test.sql`·`s4_first_call_privileges.test.sql`(반영 → `save_project_page`), `grants.test.sql`(실행 매트릭스·authenticated RPC 목록). **삭제**: `apply_writing_chat_proposal.test.sql`(대상 RPC 폐기, 내용은 r5_page_save로 대체).

## 원격 브랜치 적용 여부
- 적용 안 함(계획: 로컬 reset + pgTAP까지).

## 스펙 차이·가정 (spec-gaps.md R5-DB-1~13)
- R5-DB-1 시작 RPC는 `uuid` 반환(DM 문구 `{writing_chat_id, greeting_message}`와 다름 — 구현된 v4.4 유지).
- R5-DB-2 `new_object`는 `user_edit`·`accepted` 보호를 넘음.
- R5-DB-3 사용자 비우기 = 빈 객체 유지(rev 단조).
- R5-DB-4 산출물 패치 연산 이름·모양, 사실 거절 = 삭제.
- R5-DB-5 초안 `value`는 DB가 조립(정본).
- R5-DB-6 V-10a 출처 개수·V-10h는 DB 미강제.
- R5-DB-7 기록 판정 순서(모양 오류 먼저).
- R5-DB-8 오류 detail은 문자열(필드 이름 / ISO 시각).
- R5-DB-9 부모 소유 검사 = `not_found`.
- R5-DB-10 `project_deliverable_not_found`, `invalid_form_snapshot`.
- R5-DB-11 변경 없는 저장은 update 안 함.
- R5-DB-12 STAR 공백 = null, 이름 trim.
- R5-DB-13 종류 짐작 키워드·슬롯 1 질문 문구.

## 팀에 알림
- **api-engineer**: `apply_writing_chat_proposal` 호출 제거(타입 오류 1건), 저장 RPC 2개 계약(위 표, detail 문자열 → `{field}`·`{current_updated_at}` 변환), 만들기 null 인자 타입 우회, `start_writing_chat` 3인자·`start_deliverable_writing_chat`(둘 다 uuid 반환), 새 오류 코드: `stale_write`·`project_name_required`·`project_affiliation_required`·`project_not_affiliated`·`deliverable_title_required`·`invalid_period`·`invalid_classification`·`invalid_fields`·`not_found`·`invalid_form_snapshot`·`project_deliverable_not_found`·`writing_chat_draft_limit_reached`(409). `classification_already_set`은 DB에서 더 안 나옴. `get_deletion_impact('project_deliverable').cascade.writing_chats`.
- **ai-pipeline-engineer**: STAR 패치에 `new_object`, 응답 필드 객체에 `rev`, V-9h는 DB가 낮추기만 함(앱 계층이 스냅숏으로 정본 판정). 산출물 패치 연산 표(위), 같은 패치 안에서 `add_facts`(id 지정) → `replace_draft`의 `source_fact_ids` 순서, `body.value`는 DB가 조립(미리보기는 위 조립 규칙과 같게), 초안 6회는 DB도 raise, `set_clarifications` 산출물 모양(`slot`, `note`).

## QA 수정 (라운드 1, 03_backend-qa_report.md)

- **QA-R5-06** 새 마이그레이션 `supabase/migrations/20261110000700_r5_qa1_block_shape.sql` (기존 파일 수정 없음). `private.wc_deliverable_block`·`private.wc_block_sources`를 교체했다.
  - 목록 항목은 객체 `{text, source_*}`, 표 행은 객체 `{cells: string[], source_*}`만 받는다(TS `StoredListItemSchema`·`StoredTableRowSchema`와 같음). 문자열 항목·배열 행·문자열이 아닌 셀은 **`invalid_patch` raise**(내용 거부가 아니라 계약 위반이라 `rejected`가 아님). 초안 횟수는 세지 않는다.
  - 같은 이유로 `source_project_fields`도 TS `PROJECT_SOURCE_FIELDS`(`PRJ.description`·`PRJ.role`·`PRJ.skills`·`PRJ.name`·`PRJ.period`)만 받는다. 밖의 값은 다른 출처 오류처럼 `rejected invalid_source`. (QA 요청 범위 밖이지만 같은 종류의 "DB가 받고 TS 파싱이 실패하는" 경로라 함께 막았다.)
  - 마크다운 조립기는 그대로(두 모양을 다 읽지만 이제 객체만 들어온다). 위 "블록 (저장 모양)" 설명의 "문자열 또는 {text…}"·"셀 배열 또는 {cells…}"는 **객체만**으로 바뀐다.
- **QA-R5-01** 교차 사용자 pgTAP 추가
  - `r5_page_save.test.sql`: B가 A 산출물을 `save_project_deliverable`로 고치기 → `not_found`. B가 A 프로젝트 아래 만들기 → `not_found`. B가 자기 산출물 저장에 A 산출물 대화를 `p_applied_proposals`로 보냄 → `skipped not_found`. B가 자기 프로젝트 저장에 A STAR 대화를 보냄 → `skipped not_found`. A의 대화 `structured_draft`·산출물 제목·본문은 그대로.
  - `r5_structured_draft_patch.test.sql`: B 세션과 `app_ai_writer`(sub = B)가 A 산출물 대화를 패치하면 `writing_chat_not_found`이고 A 초안은 그대로. 블록 모양 위반 3건(`invalid_patch`)과 `source_project_fields` 위반(`invalid_source`)도 확인. 기존 replace_draft 테스트의 항목·행은 객체 모양으로 고쳤다.
- 결과: `supabase db reset` 통과, `supabase test db` **53개 파일 2,602개 테스트 전부 통과**. 시그니처 변경이 없어 `database.types.ts`는 다시 만들어도 같다(재생성 diff 없음).
- ai-pipeline-engineer에게: `draftPatch`가 이미 객체만 보내므로 영향 없음. `source_project_fields`가 `PRJ.*` 5개 안에 있는지만 확인하면 된다.
