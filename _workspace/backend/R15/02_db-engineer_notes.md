# R15 db-engineer 노트 — 자기소개서 관리 DB (cover-letter-chat 11.8 + cover-letter-flow 11.10)

- 날짜: 2026-11-09 · 기준 판: **DM v4.15** (+ **CF-S1** 2026-11-09 사용자 결정, 문서 반영은 **PR #68 미머지** — 이 워크트리 `docs/planning/`에는 없다)
- 로컬 적용: **완료** (`supabase db reset` 성공, `supabase test db` **64파일 2,613 단정 전부 통과**)
- 원격: **미반영**. `db push`·MCP `apply_migration`·쓰기 `execute_sql`은 하지 않았다. 파괴 마이그레이션은 **사용자 승인 뒤 코드 배포가 끝난 다음** push.
- `src/server/db/database.types.ts` 재생성 완료(최종 상태 1개 파일, 생성기 원본 포맷 그대로 — `oxfmt`를 돌리면 전 파일이 리포맷돼 diff가 2,000줄 늘어난다).

---

## ① 마이그레이션 파일 목록

| 번호 | 파일 | 한 줄 | 파괴 |
|------|------|-------|------|
| 20261113003100 | `r15_application_documents` | `application_documents` 신설(테이블·CHECK·unique·복합 FK·`updated_at` 트리거·생성 컬럼 `slot_count`·RLS 5정책·grant) — D1 | 아니다 |
| 20261113003200 | `r15_writing_chats_document_target` | `writing_chats` 서류 대상 확장(`application_project_id`·`document_kind`, `project_id` not null 해제, 대상 CHECK 3개 + `return_target` CHECK 교체, 인덱스 1개, 트리거 3개 교체) — D2 | 아니다(not null 해제는 코드 배포 뒤 비가역) |
| 20261113003300 | `r15_ai_jobs_checks` | 서류 턴 조합 CHECK 추가, `ai_jobs_career_description_in_flight_key` 삭제, `jd_extraction` CHECK에 `jd_preview` 분기 — D3·D4 | 아니다 |
| 20261113003400 | `r15_job_descriptions_source_url` | `source_url` 컬럼 + CHECK, `app_ai_writer`의 `job_descriptions` grant를 **컬럼 단위**로 바꿔 `source_url` 제외 — D5 | 아니다 |
| 20261113003500 | `r15_application_projects_created_at_index` | `(user_id, created_at desc)` 인덱스 — D6 | 아니다 |
| 20261113003600 | `r15_evidence_links_application_document` | `owner_type` CHECK에 `application_document`, 허용 출처 목록 함수 `private.evidence_allowed_sources` 신설, `private.evidence_links_check_source` **1회 교체**(SD-A19 `profile` 차단 + `draft_section` insert 거부 + 소유자별 허용 출처 + `user_note` 판정 이동), 슬롯 근거용 `source_field`·`source_locator` 완화 — D10 + CF-S1 | 아니다 |
| 20261113003700 | `r15_application_document_rpcs` | `private.application_reset_name`·`doc_evidence_row`·`doc_replace_slot_evidence`·`doc_proposal_sources`, `wc_mark_proposal_applied` 3번째 대상 추가, 빈 서류 초안·정규화·시작 인사 헬퍼, **`save_application_document`**·**`start_document_writing_chat`** — D7 + CF-S1 | 아니다 |
| 20261113003800 | `r15_structured_draft_patch_document` | `private.wc_doc_sources`·`wc_document_block`·**`wc_patch_document`**, `apply_structured_draft_patch_impl` 3분기 — D8 + CF-S1 | 아니다 |
| 20261113003900 | `r15_application_name_rules` | `private.application_compose_name`·`application_fallback_name` → "{회사명} 자기소개서" — D12 | 아니다 |
| 20261113004000 | `r15_jd_extraction_deadline` | `private.jd_apply_extraction_result` 분리 + `apply_jd_extraction` 교체(마감일 분기, 반환 `deadline`) — D13 | 아니다 |
| 20261113004100 | `r15_create_application_project_preview` | 8인자 함수 **drop 후** 10인자 재생성(`p_source_url`·`p_preview_job_id`, 해시 재계산, 연결·적용·버림) — D11 | 아니다 |
| 20261113004200 | `r15_start_writing_chat_return_target` | `start_writing_chat`의 `p_return_target.feature` 2값 — D14 | 아니다 |
| 20261113004300 | `r15_deletion_rpcs_documents` | `private.career_deletion_document_slots`·`reset_application_document_slots`·`cancel_document_jobs`, `get_deletion_impact`·`delete_career_item`·`get_account_deletion_summary`·`private.delete_account_data` 교체 — D9 | 아니다 |
| 20261113004400 | `r15_purge_unused_jd_previews` | `public.purge_unused_jd_preview_outputs` 신설(정리 크론 1줄) — D15 | 아니다 |
| 20261113004600 | `r15_document_block_review` | **리더 판정 2026-11-09** — `private.wc_document_block`의 `review`/`review_reason` 강제 제거(⑥-16) | 아니다 |
| 20261113004650 | `r15_begin_assistant_message_document_turn` | **QA-01 [Critical] 수정** — `begin_assistant_message`가 서류 턴(`job_type='cover_letter'`)을 받게 한다(⑥-17) | 아니다 |
| 20261113004660 | `r15_document_draft_count_per_turn` | **R15-API-7 수정(리더 판정)** — 서류 `draft_count`를 **초안 턴당 1**로(⑥-20) | 아니다 |
| **20261113004700** | **`r15_drop_drafts`** | **파괴** — 가드 + 옛 서류 RPC·트리거·헬퍼 drop + 테이블 3개 drop + `owner_type` CHECK에서 `draft_section` 제거 + `update_failed_jd_raw_text`·`delete_account_data` 재교체 — 1-B | **예** |

**파괴 파일 첫 줄**: `-- DESTRUCTIVE: 자기소개서 흐름 재설계(CF-1·CF-M1) — 서류 3테이블 drop …`. 한 트랜잭션, 계획 1-B의 순서 그대로(가드 → 교체 → 트리거 → RPC → 테이블 → 트리거 함수·검증기 → CHECK).

**번호 재조정 (리더 판정 수정 때)**: 004600을 더하면서 파괴 파일을 **`20261113004500` → `20261113004700`으로 옮겼다**(파괴가 항상 마지막). 원격에 아무것도 가지 않았으므로 재번호가 안전하다. 기존 파일은 고치지 않았다 — 004600·004650·004660이 `create or replace`로 함수만 교체한다. 앞으로 비파괴 수정이 더 생기면 **004700보다 작은 번호**를 쓰면 된다(QA-01이 004650, R15-API-7이 004660을 썼다).

---

## ② 신설·교체 RPC — 최종 시그니처와 반환 키

### 1. `public.save_application_document` (신설, **security INVOKER**, `authenticated`만 execute)

```
save_application_document(
  p_application_project_id uuid,
  p_document_kind          text,                       -- 'cover_letter'만
  p_body                   jsonb,                       -- {questions: [...]}, 전체 덮어쓰기, 길이 0 허용
  p_meta                   jsonb default null,          -- {tone} 만 (없으면 기존 유지)
  p_expected_updated_at    timestamptz default null,
  p_applied_proposals      jsonb default null,          -- [{writing_chat_id, slot, rev}] ≤ 50
  p_client_id              uuid default null,            -- 받아도 무시
  p_application_values     jsonb default null            -- {name, deadline} 만
) returns jsonb
```

**반환 키 10개** (계획 2장의 9개 + `skipped`):
```json
{ "application_document_id": "uuid", "document_kind": "cover_letter",
  "filled_slot_count": 2, "slot_count": 3,
  "name": "에이비씨페이 자기소개서", "name_source": "user", "deadline": "2026-12-01",
  "updated_at": "2026-11-09T03:14:08.84434+00:00",
  "applied": [{"writing_chat_id": "uuid", "slot": "q_1"}],
  "skipped": [{"writing_chat_id": "uuid", "slot": "q_1", "reason": "already_applied"}] }
```

**`p_body.questions[]` 원소** (서버가 정규화해 저장하는 키 = 이 목록 그대로, `sort_order`는 **서버가 1부터 재부여**):
`slot`(필수, `^q_[0-9]{1,3}$`) · `question_id`(uuid, **없거나 null이면 서버가 만든다** `[가정]`) · `question_text`(≤1,000) · `answer_title`(≤100, 앞뒤 공백 제거, 빈 값은 null) · `template_key`(`motivation`/`job_competency`/`future_plan`/null) · `question_class`(+ `experience_story`/null) · `char_limit`(**1~10,000 필수**) · `count_basis`(`with_spaces`/`without_spaces`/null) · `user_note`(≤300) · `body`(≤8,000, 없으면 `''`) · `blocks[]`
**`blocks[]` 원소**: `block_id`(`^[A-Za-z0-9_.:-]{1,64}$`, 슬롯 안에서 유일) · `type`(7종) · `text`(≤5,000) · `basis`(`new`/`current_body`/`user`) · `placeholders[]` · `flags[]` · `applied_writing_chat_id` · `applied_rev` · `applied_at` · `user_modified`(기본 false) · `evidence[]`(≤20, 저장 뒤 **본문에 복제하지 않는다**)
**`evidence[]` 원소**: `{source_type, source_id, source_field, source_locator, quote(≤2,000), label(≤300)}`
> **`sources` 키는 `p_body`에 두지 않는다**(CF-S1). 화면은 슬롯 근거를 보내지 않는다.

**거부 코드 (전부 `P0001` + `message`; 아무것도 쓰지 않는다)**

| 코드 | HTTP | 언제 | raise detail |
|------|------|------|--------------|
| `not_authenticated` | 401 (`42501`) | 세션 없음 | — |
| `invalid_fields` | 400 | `p_document_kind ≠ 'cover_letter'` / `p_body.questions` 없음·배열 아님 / `p_meta`에 `tone` 밖 키·값 목록 밖 / `p_applied_proposals` 배열 아님·50개 초과 / `p_application_values`에 `name`·`deadline` 밖 키 / `deadline` 형식·달력 오류 / `question_id` 형식 오류 / `template_key`·`question_class`·`count_basis` 목록 밖 / `char_limit` 없음·null·1~10,000 밖 / 블록 모양 오류 | `document_kind`, `body.questions`, `meta`, `meta.tone`, `p_applied_proposals`, `application`, `application.name`, `application.deadline`, `questions.q_2.question_id`, `questions.q_2.char_limit`, `questions.q_2.blocks`, `questions[0]` 같은 **점 경로** |
| `field_too_long` | 400 | `question_text`>1,000 / `answer_title`>100 / `user_note`>300 / `body`>8,000 / 블록 200개 초과 / 블록 `text`>5,000 / 블록당 근거 20개 초과 / 근거 `quote`>2,000·`label`>300 / `application.name`>100 | 점 경로(`questions.q_2.answer_title`, `questions.q_2.blocks.b1.text`, `q_1.blocks.b1.quote`, `application.name`) |
| `invalid_slot` | 400 | `slot` 형식 오류·중복(= 종류 불일치) | 그 `slot` 값 |
| **`too_many_questions`** | 400 | **보낸 수 > 5 이고 저장돼 있던 수보다 많을 때만** | **`'5,{current}'`** (`current` = 저장돼 있던 문항 수, 행이 없으면 `0`) → api가 `details {limit: 5, current}` |
| `application_project_not_found` | 404 | 지원 프로젝트 없음·남의 것 | — |
| `stale_write` | 409 | `p_expected_updated_at`이 행의 `updated_at`과 다름 | ISO 8601 UTC `YYYY-MM-DDTHH:MM:SS.ffffffZ` → api가 `details {current_updated_at}` |
| `invalid_evidence_source` | 400 | 허용 출처 밖 / `job_competency` 문항의 `project.learnings`(V-8 마지막 안전망) | `item_key`(`q_1.blocks.b1`) 또는 `item_key + '.learnings'` |
| `not_found` | 404 | 내부 헬퍼가 서류 행을 못 찾음(경합) | — |

- **근거 쓰기 실패는 저장을 되돌린다**(한 트랜잭션). 반영됨 기록 실패는 되돌리지 않고 `skipped`로 간다.
- `skipped[].reason` 6종: `not_found` / `already_applied` / `proposal_changed` / `needs_review` / `invalid_entry` / `mark_failed` — 판정 순서는 2.5.1 공통 규칙 그대로. **`applied_mode`는 없다.**
- `filled_slot_count` = `btrim(body) <> ''`인 문항 수. **`answer_title`만 있고 본문이 빈 문항은 세지 않는다.** `slot_count`는 생성 컬럼이라 RPC가 쓰지 않는다.
- **키·동의·활성 공급자를 보지 않는다**(CL-8).
- 이름: 빈 `name`은 `private.application_reset_name`으로 **"{회사명} 자기소개서"**(회사명 출처가 `name_source`) 또는 회사명이 없으면 **"새 자기소개서 (YYYY-MM-DD)"**(`default`). 비지 않은 이름은 사용자 세션 update(트리거가 `name_source='user'`).

### 2. `public.start_document_writing_chat` (신설, security definer + 소유 검사, `authenticated`만)

```
start_document_writing_chat(p_application_project_id uuid, p_document_kind text,
                            p_form_snapshot jsonb default null) returns uuid
```
- 반환은 **`uuid`**(새 `writing_chat_id`). 시작 인사는 `writing_chat_messages.sequence = 1`.
- **정본 행을 만들지 않는다.** `p_return_target` 인자는 없다(`return_target`은 null 고정).
- 거부: `not_authenticated`(42501) / `invalid_fields`(detail `document_kind`) / `application_project_not_found`(404) / `invalid_form_snapshot`(400).
- `p_form_snapshot` = `{questions:[{slot, question_text, char_limit, count_basis, user_note, answer_title, body}]}`(≤20개, 길이 검사만, 저장하지 않음).
- 시작 인사 4분기: ① JD `extraction_status <> 'succeeded'` → "채용 공고의 요건을 아직…" ② 문항 0개 또는 채운 문항 0개 → "자기소개서 문항에 답할 내용을…" ③ 일부 → "지금 쓰신 답변을 바탕으로…" ④ 전부 → "문항을 모두 채우셨네요…" + 민감정보 줄(+ 무료 등급 줄). **문구는 `[가정]`, 최종 문구 원천은 UX** — 바뀌면 RPC 교체.

### 3. `public.create_application_project` (교체 — **8인자 drop 후 10인자 재생성**, 오버로드 없음)

```
create_application_project(
  p_id uuid, p_raw_text text, p_raw_text_hash text, p_sentences jsonb,
  p_company_name text default null, p_position_title text default null,
  p_name text default null, p_deadline date default null,
  p_source_url text default null, p_preview_job_id uuid default null) returns jsonb
```
**반환** = 기존 8키 + `preview_applied`(boolean) · `preview_skip_reason`(text|null):
`application_project_id, job_description_id, name, name_source, extraction_status, ai_run_allowed, created, preview_applied, preview_skip_reason`

- 새 거부 코드 **`invalid_source_url`**(400) — `http(s)` 아님 또는 2,048자 초과. 인자 검사라 **아무 행도 만들지 않는다**(화면은 같은 `p_id`로 `p_source_url`만 빼고 다시 보내면 된다).
- 기존 거부 코드 그대로: `not_authenticated`·`invalid_id`·`invalid_raw_text`·`invalid_raw_text_hash`·`invalid_sentences`·`invalid_name`·`invalid_company_name`·`invalid_position_title`·`key_invalid`·`ai_consent_required`·`application_project_id_conflict`.
- **이름 규칙 교체**: `p_name`이 있으면 `user` → 없고 `p_company_name`이 있으면 **키 유무와 무관하게** "{회사명} 자기소개서"(`user`) → 둘 다 없고 키도 없으면 기본 이름(`default`) → 키가 있으면 null(추출 대기).
- **미리 보기**: `p_preview_job_id`가 있으면 `jd_extraction` + `target_type='jd_preview'` + `succeeded` + 미연결 + 내 것인지 본다. 아니면 `preview_skip_reason = 'preview_not_found'`(연결하지 않는다). 쓸 수 있는 행이면 **연결은 항상 한다**(`ai_jobs.target_id`·`application_project_id`, 그 작업의 `ai_usage_records.application_project_id`) — `preview_expired`·`preview_mismatch`로 **버린 경우에도** `[가정]`.
  - `preview_expired`: `finished_at`이 24시간보다 오래됨.
  - `preview_mismatch`: **`p_raw_text`로 다시 계산한 sha256**(`extensions.digest`, hex 소문자)이 `params.raw_text_hash`와 다름 / `jsonb_array_length(p_sentences) ≠ params.sentence_count` / `output`이 `jd_extraction_result_valid`를 통과하지 못함. **보낸 `p_raw_text_hash`는 믿지 않는다.**
  - 적용은 `apply_jd_extraction`과 **같은 내부 함수** `private.jd_apply_extraction_result`로 한다.
- 같은 `p_id` 재시도(`created: false`)는 미리 보기를 다시 적용하지 않고 `preview_applied: false`·`preview_skip_reason: null`을 돌려준다.

### 4. `public.apply_jd_extraction` (교체 — 반환에 `deadline` 추가)

시그니처 변경 없음(`p_job_description_id, p_ai_job_id, p_run_generation, p_result, p_provider, p_model`).
반환에 **`deadline`**(date|null)이 생긴다. 적용 본문은 `private.jd_apply_extraction_result`로 분리됐다(생성 RPC와 공유).
마감일 규칙: `p_result -> 'deadline' ->> 'value'`가 유효한 `date`이고 `deadline.source_sids`가 **그 분할 안**(≥1개)이고 **KST 오늘 ~ 오늘+366일**(양끝 포함)이고 **`application_projects.deadline is null`**일 때만 쓴다. 변환 실패·기간 밖·sid 밖은 **값만 버리고** 추출은 성공한다. `deadline` 키가 없는 옛 1판 결과도 그대로 통과한다.

### 5. `public.apply_structured_draft_patch` — 서류 분기 (대상 3분기)

대상 판정: `application_project_id`가 있으면 **서류** → 없고 `project_deliverable_id`가 있으면 산출물 → 그 밖은 STAR.

| 주체 | 연산 |
|------|------|
| AI(`app_ai_writer`) | `add_facts` · **`replace_draft`**(`slot` 필수) · `count_draft` · `set_clarifications` · `add_sensitive_flags` · **`set_tone`** · `set_question_edit_proposal` |
| 사용자(`authenticated`) | `accept_fact` · `reject_fact` · `accept_block`(+`slot`) · `remove_block`(+`slot`) |

**만들지 않은 것**: `set_section_order_proposal` · `set_source_ranking`(CF-1 폐기) · `set_writing_kind`(산출물 전용). 보내면 `invalid_patch`.

`replace_draft` 인자: `{op, slot, question_id?, draft}` — `draft` 키:
`answer_title`(≤100, 넘으면 `invalid_patch`) · `blocks[]`(1~200) · `char_count`(필수, 숫자) · `char_limit_at_generation` · `char_adjust_needed`(boolean) · `correction_applied`(boolean) · `base_body_hash`(≤200) · `replace_allowed`(boolean) · `missing_slots[]`(≤20) · `dropped_block_count` · **`sources[]`**(CF-S1, 아래).
- **`value`는 무시하고 DB가 `blocks`로 다시 조립한다**(R5-DB-5, 슬롯마다). `answer_title`은 `value`에 넣지 않는다.
- 저장되는 `draft` 키: 위 + `value`·`rev`(슬롯 단위 단조 증가)·`generated_at`·`applied_at`·`applied_rev`. **`applied_mode`는 없다.**
- 블록 검증 범위(DM §2.5.0b "DB의 V-10 방어 범위 (서류)"): 2.5.0a 범위 + `evidence[]` **원소의 모양·길이·개수**(출처 목록·`quote` ≤2,000·블록당 ≤20)**만**. **`review`·`review_reason`은 파이프라인이 보낸 값을 그대로 저장한다** — DB가 강제하지 않는다(리더 판정 2026-11-09, ⑥-16). `review` 값 목록은 `ok`/`needs_review`(새 초안), `review_reason`은 문자열 또는 null(≤100자 `[가정]`). 블록 출처는 **3종**(`evidence`·`source_fact_ids`·`source_body_quotes`)이라 `evidence[]`가 비었다는 것만으로는 아무 판정도 하지 않는다 — V-4·V-10a·V-10h는 파이프라인 몫(R5-DB-6).
- AI 패치의 값 오류는 `rejected[]`(`invalid_value`/`invalid_source`/…)로 돌려주고, 모양·슬롯·블록 id 오류는 `invalid_patch`(400)로 raise. 사용자 패치는 사유를 그대로 raise.
- `draft_count` ≥ 6이면 `writing_chat_draft_limit_reached`(409) — **대화 전체 6회**이고 **초안 턴 1회당 1**이다(한 턴이 문항 3개를 제안해도 +1 — R15-API-7, 아래 ⑥-20). `count_draft`만 온 턴도 +1, 거부된 `replace_draft`는 세지 않는다.

### 6. ★ CF-S1 (2026-11-09 사용자 결정) — 슬롯 근거 `{slot}.sources.{n}`

- **`replace_draft.draft.sources[]`**: 원소 `{source_type, source_id, role}`, `role ∈ primary|supporting`, **0~5개** `[가정]`. 허용 출처는 아래 ③ 목록 **그대로**(블록 근거와 같은 함수). `user_note` 출처의 `source_id`는 **그 문항의 `question_id`**. 어기면 **`invalid_patch`**(detail `op {i} sources`).
- 저장 위치: **`structured_draft.document.questions[].draft.sources[]`**. 폐기된 `document.source_ranking`과 **다른 자리**다(되살린 것이 아니다).
- **`sources` 키 없음 ≠ 빈 배열** `[가정]`: 키가 없으면 초안에 `sources` 키를 두지 않고, 저장 때 그 슬롯의 기존 `{slot}.sources.{n}` 행을 **그대로 유지**한다. 빈 배열은 **지운다**. (ai-pipeline 노트 R15-AI-2와 같은 약속 — 초안 턴은 블록이 남은 문항마다 항상 키를 싣는다.)
- `save_application_document`의 근거 쓰기(CF-S1 확정):
  - **보내지 않은 슬롯**(삭제된 문항) → 블록 근거·`sources` 근거 **둘 다 삭제**.
  - **보낸 모든 슬롯** → 블록 근거(`{slot}.blocks.{block_id}`)는 **본문대로 재작성**(전부 지우고 다시 넣기).
  - **적용 제안이 있는 슬롯**(그 원소가 `skipped`로 떨어지지 않음) → 그 제안(같은 `rev`)의 `draft.sources[]`로 `{slot}.sources.{n}`을 **교체**. `n` = 배열 순서, **`primary` 먼저**. **`role`은 `evidence_links` 행에 저장하지 않는다.** 같은 슬롯에 적용 제안이 여러 개면 **나중 것이 이긴다**.
  - **적용 제안이 없는 슬롯** → 기존 `sources` 행 **유지**.
- 슬롯 근거 행의 컬럼: `source_field` **null**, `source_locator` **null**, `quote`·`source_label` null, `sort_order`는 서버 연번. (그래서 `evidence_links_source_field_check`와 `jd_sentence` locator 규칙을 그 행 모양에서만 완화했다 — spec-gaps **R15-DB-3**.)

### 7. 삭제·탈퇴 RPC (교체, R14 정의에서 시작)

- `get_deletion_impact('application_project', id)` → `{"cascade": {"insights": n, "documents": 0|1, "document_chats": n, "stage_events": n}}`
  - `documents` = `filled_slot_count > 0`인 정본 수(0 또는 1). `kept`·`interview_sessions` 없음.
- `get_deletion_impact(커리어 종류, id)` → `affected_results.by_application_project[]` = `{application_project_id, name, insights, documents, document_sections}`
  - 기준은 `evidence_links`(`owner_type='application_document'`) 하나. `document_sections` = 슬롯 수(**키 이름은 그대로 둔다**, v4.15).
  - `cascade.writing_chats`에 **`project_id is not null`** 조건 — 커리어 삭제는 서류 대화를 만나지 않는다.
  - **`entity_type = 'application_document'`는 만들지 않았다** `[가정]` → `invalid_entity_type`.
- `delete_career_item(..., 'delete_results')` → 그 문항의 **본문·블록·근거만 비운다**(`question_text`·`char_limit`·`count_basis`·`user_note`·문항 자체는 유지, `slot_count` 그대로). 서류 대화는 **지우지 않는다**. 진행 중 `cover_letter` 작업에 `cancel_requested_at`.
- `get_account_deletion_summary()` → `applications.drafts` = `filled_slot_count > 0`인 정본 수. **반환 키 이름은 `drafts` 그대로**(DM §4.3 "반환 키 변경 없음"). `career.writing_chats`는 서류 대화를 자동 포함.
- `private.delete_account_data`는 `application_documents`를 명시적으로 지운다(파괴 마이그레이션에서 `drafts` 3줄 제거).

### 8. `public.start_writing_chat` (교체)

`p_return_target.feature` 허용 값 **`insight`·`cover_letter` 2값**. `career_description`을 보내면 `invalid_return_target`(400). 테이블 CHECK `writing_chats_return_target_check`는 **R14의 3값 그대로**(기존 행). `private.writing_chat_greeting`의 `career_description` 분기는 남겼다 `[가정]`.

### 9. 내부 헬퍼 (외부에서 부르지 말 것 — `authenticated` execute는 invoker RPC 때문에만 있다)

```
private.application_reset_name(p_application_project_id uuid) returns jsonb
private.doc_evidence_row(p_item_key text, p_sort_order int, p_e jsonb, p_allowed text[], p_question_class text) returns jsonb
private.doc_replace_slot_evidence(p_application_document_id uuid, p_application_project_id uuid,
                                  p_rows jsonb, p_slots text[], p_source_slots text[]) returns integer
private.doc_proposal_sources(p_writing_chat_id uuid, p_application_project_id uuid,
                             p_document_kind text, p_slot text) returns jsonb   -- null = sources 키 없음
private.wc_mark_proposal_applied(p_writing_chat_id uuid, p_target_kind text, p_target_id uuid,
                                 p_field text, p_rev integer, p_mode text) returns text
   -- 서류: p_target_kind='application_document', p_target_id=지원 프로젝트 id, p_field=slot, p_mode=document_kind
private.evidence_allowed_sources(p_owner_type text) returns text[]
private.career_deletion_document_slots(uuid, text, uuid, text) returns table(application_document_id, application_project_id, slot)
private.reset_application_document_slots(p_pairs jsonb) returns integer   -- [{application_document_id, slot}]
private.cancel_document_jobs(p_application_project_ids uuid[]) returns integer
private.jd_apply_extraction_result(uuid, job_descriptions, application_projects, uuid, jsonb, text, text) returns jsonb
private.wc_doc_sources(jsonb, text[]) / wc_document_block(jsonb, uuid[], text[]) / wc_patch_document(writing_chats, jsonb, text)
private.writing_chat_empty_document_draft(text) / wc_normalize_document_draft(jsonb, text)
private.writing_chat_document_greeting(boolean, integer, integer, boolean)
```

### 10. 정리 크론 RPC

```
public.purge_unused_jd_preview_outputs(p_now timestamptz default now(), p_limit integer default 5000)
  returns integer            -- service_role만 execute
```

---

## ③ `evidence_links` 허용 출처 목록 (저장 RPC와 트리거가 **같은 함수**를 읽는다)

`private.evidence_allowed_sources(owner_type)`:

| `owner_type` | 허용 `source_type` |
|--------------|--------------------|
| `insight` | `experience`, `education`, `project`, `project_deliverable`, `skill`, `jd_requirement`, `jd_sentence` |
| **`application_document`** | `experience`, `education`, `project`, `project_deliverable`, `skill`, `jd_requirement`, `jd_sentence`, **`user_note`** |
| `chat_message` | (제약 없음 — Should, 생산자 없음) |
| `draft_section` | **insert 거부**(파괴 마이그레이션 뒤에는 CHECK에서도 빠진다) |

- `profile`은 **모든 소유자에서 새 행 금지**(SD-A19) — 트리거가 `invalid_evidence_source`.
- `user_note`: `source_id` = **그 서류 `body.questions[].question_id`**. 트리거는 모양만 보고, "문항이 없으면 원본 삭제됨"은 **저장 RPC가 판정**해 `source_deleted_at`·`quote=null`로 넣는다.
- `job_competency` 문항의 `source_type='project' AND source_field='learnings'`는 저장 RPC가 **거부**(V-8 마지막 안전망). 판정 기준은 `question_class` 또는 `template_key` 중 하나라도 `job_competency` `[가정]`.
- `item_key`: 블록 `{slot}.blocks.{block_id}` / 슬롯 `{slot}.sources.{n}` (`slot` = `q_{n}`만).

---

## ④ 새 CHECK 값 목록 (TS `src/lib/contracts/enums.ts` 미러용)

| 제약 | 값 |
|------|-----|
| `application_documents_document_kind_check` | **`cover_letter`** (1값) |
| `writing_chats_document_kind_check` | `document_kind is null` 또는 **`cover_letter`** |
| `writing_chats_return_target_check`(테이블) | `insight`, `career_description`, `cover_letter` — **변경 없음**(기존 행). **`start_writing_chat`이 받는 값은 `insight`·`cover_letter` 2값** |
| `evidence_links_owner_type_check` | 3단계: `insight`, `draft_section`, `chat_message`, `application_document` → **4단계(파괴) 뒤: `insight`, `chat_message`, `application_document`** |
| `evidence_links_source_type_check` | 변경 없음(`profile`, `experience`, `education`, `project`, `project_deliverable`, `skill`, `jd_requirement`, `jd_sentence`, `user_note`) |
| `ai_jobs.target_type`(전역 CHECK 없음, 값 목록만) | `writing_chat`, `application_project`, `job_description`, **`jd_preview`**(신설), `draft`·`draft_section`(과거 행) |
| `ai_jobs_job_type_check` / `ai_usage_records_job_type_check` | **변경 없음** 9값(`career_description`·`draft_source_ranking` 보존 — CF-A3) |
| `ai_usage_records_feature_check` | **변경 없음** 8값 |
| `job_descriptions_source_url_check` | `null` 또는 `≤ 2,048자` + `^https?://` |
| 서류 본문 값 목록 (CHECK 아님 — **저장 RPC가 지킨다**) | `slot` `^q_[0-9]{1,3}$` · `template_key` `motivation`/`job_competency`/`future_plan` · `question_class` + `experience_story` · `count_basis` `with_spaces`/`without_spaces` · `meta.tone` `concise`/`detailed` · 블록 `type` `heading`/`paragraph`/`bullet_list`/`numbered_list`/`table`/`quote`/`code` · 블록 `basis` `new`/`current_body`/**`user`** · 문항 ≤ 5 · `char_limit` 1~10,000 |
| 제안(`structured_draft`) 값 목록 | `target` = `cover_letter` · 블록 `review` `ok`/`needs_review`/`accepted` · `review_reason` `no_evidence`/null · **`sources[].role` `primary`/`supporting`**(CF-S1) · `question_edit_proposal[].op` `add`/`update`/`remove` `[가정]` |

---

## ⑤ 정리 크론에 넣어야 할 규칙 (api — `/api/cron/ai-jobs`)

**한 줄 추가**: 연결되지 않은 미리 보기 작업의 결과를 24시간 뒤 비운다.

```sql
select public.purge_unused_jd_preview_outputs(now(), 5000);   -- service_role
```

의미(= RPC 본문):
```
update ai_jobs set output = null, step_outputs = '{}'
 where job_type = 'jd_extraction' and target_type = 'jd_preview' and target_id is null
   and finished_at < now() - interval '24 hours'
   and (output is not null or step_outputs <> '{}')
 -- finished_at, id 순, p_limit개, for update skip locked
```
- **작업 행 자체는 지우지 않는다** — 다른 작업과 같이 `purge_old_ai_jobs`의 90일 보관을 탄다.
- 반환은 비운 행 수(기존 purge RPC와 같은 모양). `p_limit` 1~50,000, 꽉 차면 같은 실행에서 이어 부르는 기존 배치 규칙 그대로.
- 사용량 행은 13개월 보관 그대로 남는다(`application_project_id` null → 미터 "요건 추출"에 계속 보인다).

---

## ⑥ 구현 판단과 `[가정]`

1. **`application_documents`의 insert·update grant** — invoker RPC가 쓰려면 `authenticated` grant가 필요하다. `profile_job_interests` 선례대로 grant + 본인 행 RLS를 두고 화면은 RPC만 쓴다(spec-gaps **R15-DB-1**). `app_ai_writer`는 **select만**, `service_role`은 **select·delete만**(Supabase 기본 권한의 쓰기를 revoke했다).
2. **내부 definer 헬퍼 2개도 `authenticated` execute가 있다** — `wc_mark_proposal_applied`(R5)와 같은 모양. `anon`·`app_ai_writer`·`app_key_reader`·`service_role`에는 없다(spec-gaps **R15-DB-2**).
3. **슬롯 근거 행의 `source_field`·`source_locator`가 null이어야 한다** — CHECK·트리거를 그 행 모양(`item_key ~ '\.sources\.[0-9]+$'`)에서만 완화했다. 블록 근거는 그대로 엄격(spec-gaps **R15-DB-3**).
4. **`ai_jobs` 서류 턴 조합은 "완화"가 아니라 "추가"** — 새 CHECK `ai_jobs_document_chat_turn_check`(spec-gaps **R15-DB-4**).
5. **`app_ai_writer`의 `job_descriptions` grant를 컬럼 단위로 바꿨다** — `source_url` 제외(spec-gaps **R15-DB-5**).
6. **소유자별 허용 출처 검사를 트리거로 올렸다** — 허용 목록 밖 출처의 거부 코드가 `23514` → `P0001 invalid_evidence_source`로 바뀐다(spec-gaps **R15-DB-9**). api의 오류 매핑에서 그 전환을 확인할 것.
7. **`update_failed_jd_raw_text` 조건 5에서 서류 분기가 사라졌다** — 자소서만 쓴 JD는 원문을 고칠 수 있게 된다(spec-gaps **R15-DB-8**).
8. `question_id`가 없거나 null인 문항은 **서버가 uuid를 만든다** `[가정]`(새 문항). 형식이 틀리면 `invalid_fields`.
9. `evidence_links.source_snapshot_at` — `project`는 `projects.content_updated_at`, `project_deliverable`은 그 행의 `updated_at`, 그 밖은 `now()` `[가정]`.
10. 근거는 **본문이 바뀌지 않아도 매 저장마다 블록 행을 다시 쓴다** `[가정]`(행 id가 바뀐다 — 화면이 근거 행 id를 들고 있지 않으므로 무해). `sources` 행은 적용 제안이 있을 때만 바뀐다.
11. 제약·인덱스 이름 `[가정]`: `application_documents_document_kind_check`·`_filled_slot_count_check`·`_body_check`·`_meta_check`·`_project_kind_key`·`_application_project_fkey`·`application_documents_user_id_idx`, `writing_chats_target_check`·`_document_kind_check`·`_deliverable_project_check`·`_target_return_target_check`·`writing_chats_application_document_last_activity_idx`, `ai_jobs_document_chat_turn_check`, `job_descriptions_source_url_check`, `application_projects_user_id_created_at_idx`.
12. 서류 대화를 지울 때 취소하는 작업에 **`cover_letter`를 더했다** `[가정]`(`private.writing_chats_cancel_jobs`).
13. `private.cancel_document_jobs`는 지원 프로젝트 단위로 `cover_letter` 작업을 취소한다 `[가정]`(옛 `cancel_draft_jobs`가 초안·섹션 단위로 하던 일).
14. 시작 인사 4종 문구는 `[가정]` — 최종 문구 원천은 UX.
15. 파괴 마이그레이션에서 **DM 11.8 #8 목록에 없던 객체 11개**를 함께 지웠다(spec-gaps **R15-DB-6**). `private.is_uuid_text`·`is_uuid_array`는 범용이라 남겼다.
16. **리더 판정으로 블록 `review` 강제 제거 (§2.5.0b DB 방어 범위, 마이그레이션 20261113004600)** — 처음 쓴 `private.wc_document_block`은 `evidence[]`가 빈 비제목 블록을 `review='needs_review'`·`review_reason='no_evidence'`로 강제했다. 두 가지로 범위를 넘었다: ① 블록 출처는 **3종**(`evidence`·`source_fact_ids`·`source_body_quotes`)이고 "근거 0개"는 **셋 다 비었을 때**를 말한다 — `evidence[]`만 보면 **CL-4 이어 쓰기 블록**(출처가 대화 사실·지금 본문 인용뿐인 문단)이 전부 `needs_review`가 되어 매번 사용자 [수락]을 요구한다. ② 그 판정은 §2.5.0b "DB의 V-10 방어 범위 (서류)"와 §2.5.0a R5-DB-6에 따라 **파이프라인 몫**이다(V-4·V-10a·V-10h). 지금은 패치로 온 `review`·`review_reason`을 **그대로 저장**하고, DB는 `evidence[]` 원소의 모양·길이·개수와 값 목록·길이만 본다. **유지한 것**: 출처 목록 검사·`quote` ≤2,000·블록당 ≤20 + 저장 RPC의 **V-8 마지막 안전망**(`job_competency` 문항의 `project.learnings` 거부 — 문서가 명시한 유일한 예외). `database.types.ts`는 모양이 바뀌지 않았다(재생성해 동일 확인). 기획 문제가 아니라 구현 수정이므로 `spec-gaps.md`에는 적지 않았다.
17. **QA-01 [Critical] — `begin_assistant_message`가 서류 턴을 막고 있었다 (마이그레이션 20261113004650)** — 그 함수는 턴 작업을 `job_type = 'writing_chat_turn'` **한 값으로 못 박고** 있었는데, 서류 턴은 `job_type = 'cover_letter'`로 행을 만든다(DM §2.9.1 "서류 작성 대화의 턴 1회"). 그 값은 D3의 `ai_jobs_document_chat_turn_check`(20261113003300)가 **요구**하는 값이다. 그래서 질문 턴·초안 턴 모두 사용자 메시지를 저장한 직후 `invalid_ai_job` → 500으로 죽었고 **자소서 작성 대화 기능 전체가 동작하지 않았다**. 조건을 **`j.job_type in ('writing_chat_turn','cover_letter')`**로 넓혔다. 코드 쪽(`turn.ts`의 `turnJobType`)을 `writing_chat_turn`으로 되돌리는 방향은 **틀렸다** — 그 CHECK를 위반하고, 사용량 미터·보드가 필요한 지원 프로젝트 귀속이 끊긴다. `career_description`은 넣지 않았다(새 행을 만들지 않고 과거 행은 `target_type='draft'`라 이 RPC에 오지 않는다 — CF-1·CF-A3).
    - **같은 유형을 전부 훑었다**(`pg_proc.prosrc ~ 'job_type'`, public·private 11개): 손댈 곳은 이 함수 하나였다. `private.writing_chats_cancel_jobs`는 이미 두 값을 받고(20261113003200), `finish_assistant_message`·`mark_writing_chat_extracted`·`complete_ai_job`·`request_ai_job_cancel`은 `job_type`을 보지 않으며, `retry_ai_job`은 **의도적으로 `insight`만** 받는다(서류 턴은 같은 행 다시 시도 대상이 아니다 — DM §2.9.1, "다시 보내기"는 새 턴). `private.ai_jobs_release_insight`·`release_jd_extraction`·`insight_job_matches`·`jd_extraction_job_matches`는 다른 작업 종류 전용이라 해당 없음.
    - **서류 초안(compose) 경로를 pgTAP으로 처음 끝까지 돌렸다**: 사용자 메시지 → `begin_assistant_message`(`cover_letter` 작업) → `apply_structured_draft_patch` 서류 분기 → `mark_writing_chat_extracted` → `finish_assistant_message` → `complete_ai_job` → 메시지 `done`·작업 `succeeded`. 이 대화의 턴이 아닌 작업은 여전히 `invalid_ai_job`으로 거부되는 것도 단정했다.
18. **QA-04 — R15 pgTAP 단정을 픽스처 범위로 좁혔다** — 전역 `count(*)`/`results_eq`가 로컬 DB에 남은 **다른 사용자의 행** 때문에 깨졌다. R15 5파일의 12개 쿼리에 `user_id = <픽스처 사용자>` 또는 `application_project_id = <픽스처 프로젝트>` 조건을 더했다. **확인 방법**: 다른 사용자의 `application_documents`·`evidence_links`·`application_projects` 행을 일부러 남겨 두고 전체 재실행 → R15 전부 통과. 그때 **R11이 쓴 `jd_extraction.test.sql`의 단정 1개**(`'account deletion cascades through all S5 tables'`, 전역 4테이블 합계)가 같은 이유로 깨지는 것이 드러나 같은 방식으로 좁혔다(R15 소관 밖이지만 `supabase/` 안이고 `run-checks.sh`를 불안정하게 만들던 원인이다).
19. **QA-05 — 노트의 가드 재현 스니펫이 재번호 전 파일명(`20261113004500`)을 가리켰다** → `20261113004700`으로 고쳤다(아래 ⑦ "가드 검증 방법").
20. **R15-API-7 — 서류 `draft_count`를 초안 턴당 1로 고쳤다 (리더 판정 2026-11-09, 마이그레이션 20261113004660)** — 처음 쓴 `wc_patch_document`는 산출물 분기를 그대로 따라 **`replace_draft` 연산마다** `draft_count`를 올렸다. 서류는 한 턴이 문항을 최대 3개 제안하므로 한 턴이 3을 소모했고, 5문항 자소서는 한 바퀴(3+2문항, 연산 5개)만 돌아도 6회 중 5회를 써 **두 번째 바퀴가 `writing_chat_draft_limit_reached`로 막혔다**. 지금은 **`replace_draft`/`count_draft`를 하나 이상 적용한 패치 호출당 1**만 올린다(연산이 3개여도 +1). 근거: AI 명세 C-14가 **"제안 단위"를 "최대 3문항"**으로 못 박고 "자소서 5문항이면 초안 턴 2회면 한 바퀴"라고 산수까지 적었다 → 6회는 **초안 턴 6회**(세 바퀴). 보강: AI 7.4의 비용 단위는 compose **호출**이고, DM §2.5.0b는 **슬롯별 6회**를 부정한 것이며, 화면은 "6 − `draft_count`"를 남은 횟수로 보인다.
    - **산출물(2.5.0a)·STAR 분기는 건드리지 않았다** — 슬롯이 하나라 "연산당 = 턴당"이어서 결과가 같고, 고치면 회귀다. 서류는 슬롯이 여럿이라 처음 갈라진 것이다. 회귀 단정을 새 테스트에 넣었다.
    - 한 호출 안에서 count가 바뀌지 않으므로 **거부 시점이 "6번째 턴 뒤"**가 된다(사전 검사·409 코드 자체는 그대로). 블록이 하나도 안 남은 초안도 센다(AI 명세) — `count_draft`만 온 턴도 +1, **거부된** `replace_draft`는 세지 않는다.
    - api-engineer가 통합 테스트 기대값을 `[2,2]` → `[1,1]`로 바꾸는 중이다(리더가 동시 지시).

---

## ⑦ pgTAP 결과

`supabase test db` — **64파일 2,613 단정 전부 통과** (2026-11-09). 로컬 DB에 **다른 사용자의 행이 남아 있어도** 통과한다(QA-04 뒤 확인: 남은 행을 일부러 넣고 전체 재실행).

**신설 파일 6개**

| 파일 | 범위 |
|------|------|
| `r15_application_documents.test.sql` (70) | 컬럼·`migration_note` 부재·unique·`slot_count` 생성 컬럼(직접 쓰기 거부·본문 추종)·복합 FK(남의 프로젝트 거부·cascade)·RLS 정책 5개·남의 행 안 보임·남의 행 insert 거부·`app_ai_writer` select만 / 저장 RPC: 만들기(반환 10키·문항 0개)·`invalid_slot`(형식·중복)·`char_limit` 필수·null·범위·`answer_title` 100자·`question_text` 1,000자·`count_basis`·`p_meta`·`too_many_questions`(+ **raise detail `'5,0'`**)·`filled_slot_count`(제목만 있는 문항 제외)·`sort_order` 재부여·근거 `item_key`·`source_snapshot_at`·본문에 근거 복제 안 함·`stale_write`(아무것도 안 씀)·보내지 않은 슬롯 삭제·V-8 `learnings` 거부·`profile` 출처 거부·근거 실패 롤백·`user_note` 원본 삭제됨 판정·`p_application_values`(이름·마감일·달력 오류·100자·빈 이름 기본 복귀)·키 없이 성공 |
| `r15_document_writing_chat.test.sql` (67) | `writing_chats` 대상 CHECK 3개·`return_target` CHECK·복합 FK·`project_id` nullable·인덱스 / `start_document_writing_chat`(404·`invalid_fields`·`invalid_form_snapshot`·정본 행 안 만듦·행 모양·시작 인사 2분기·대화 여러 개) / `ai_jobs` 조합 CHECK 3가지·in-flight 인덱스 부재 / 패치 서류 분기(`set_writing_kind`·`set_source_ranking`·`set_section_order_proposal` 거부, `set_tone`, `replace_draft` slot 필수·`answer_title` 100자·**DB 재조립**·`answer_title`은 `value`에 없음·`rev` 단조·**`review`/`review_reason` 그대로 저장**(강제 없음)·**`source_fact_ids`만·`source_body_quotes`만인 블록이 `ok` 유지**·**파이프라인이 보낸 `needs_review` 보존**·허용 출처 밖 `invalid_source`) / 반영됨 기록(applied·`skipped` 3종·`applied_rev`·`applied_mode` 없음) / **서류 턴 한 바퀴**(사용자 메시지 → `begin_assistant_message`(`cover_letter` 작업) → 패치 → `mark_writing_chat_extracted` → `finish_assistant_message` → `complete_ai_job`, 이 대화의 턴이 아닌 작업 거부 — QA-01) / `start_writing_chat`의 `career_description` 거부 |
| `r15_document_sources.test.sql` (16) | **CF-S1** — `sources[]` 검증(출처 목록 밖·`role` 밖·5개 초과·배열 아님 → `invalid_patch`), 저장 순서 유지, `source_ranking` 부재 / 적용 제안의 `sources` 교체(`primary` 먼저·`role` 미저장) / **적용 제안 없는 슬롯의 기존 `sources` 유지 + 블록 근거 재작성** / 보내지 않은 슬롯 양쪽 삭제 / 나중 적용 제안이 이김 / **`sources` 키 없음 = 유지 / 빈 배열 = 삭제** |
| `r15_jd_preview_and_deadline.test.sql` (46) | `source_url` 컬럼·grant(사용자 update 없음·`app_ai_writer` 못 읽음) / `(user_id, created_at desc)` 인덱스 / `jd_preview` 조합 CHECK / 생성 RPC: `invalid_source_url` 2가지·행 안 만듦·URL 그대로 저장·`preview_not_found`(없음·남의 것)·남의 작업 미연결·`preview_expired`(연결됨)·**해시 재계산 불일치 `preview_mismatch`**(연결·사용량 귀속·`pending` 유지)·적용(요건·공급자·모델·이름 `ai`·마감일)·2단계 값 보존 / `apply_jd_extraction` 마감일 6분기(sid 밖·달력 오류·문자열·과거·366일 초과·경계 2개)·옛 1판 결과·사용자 값 보존 / 정리 크론(24시간 경계·멱등·연결된 작업 유지) |
| `r15_document_deletion.test.sql` (21) | `get_deletion_impact('application_project')` 4키·`application_document` 종류 없음·커리어 종류 `documents`/`document_sections`·`cascade.writing_chats`가 서류 대화 제외 / `keep_results`(본문 유지·근거만 표시) / `delete_results`(본문·블록·근거만 비움, 문구·메모·`char_limit`·`slot_count` 유지, 대화 유지) / `get_account_deletion_summary`(서류 수·빈 서류 제외·대화 합계) / `delete_account` 연쇄 |
| `r15_drop_drafts.test.sql` (12) | 테이블 3개 부재·객체 43개 부재·남는 함수 본문에 폐기 테이블 참조 0건·생존 테이블의 트리거 4개 부재·`education_display_name`·`trim_js_whitespace` 보존·`owner_type` CHECK 3값·`draft_section` 소유자 거부·CF-A3 보존 값 3가지 |
| `r15_draft_count_per_turn.test.sql` (21) | **R15-API-7** — 문항 3개 턴 1회 → `draft_count` 1 · 두 번째 턴 → 2 · `count_draft`만 온 턴도 +1 · 초안 연산 없는 패치는 안 셈 · 거부된 초안은 안 셈 · **초안 턴 6회 뒤 7번째가 `writing_chat_draft_limit_reached`** · **산출물 분기 회귀 없음**(연산당 유지) |

**지운 파일 6개**: `drafts.test.sql` · `drafts_career_deletion.test.sql` · `drafts_qa1.test.sql` · `career_description.test.sql` · `career_description_cancel.test.sql` · `s7_first_call_privileges.test.sql`(전부 폐기 객체 전용. 마지막 파일의 권한 단정은 `grants.test.sql`의 R15 블록으로 옮겼다).

**고친 파일 12개**: `account_deletion`(사용자 테이블 목록·픽스처·요약) · `application_projects`(이름 규칙 3분기·반환 2키) · `create_application_project_gate`(이름) · `evidence_links`(허용 목록 거부 코드 3건) · `grants`(app_ai_writer 테이블 목록·함수 목록·R15 문서 RPC 블록·`authenticated` 함수 목록·컬럼 단위 JD grant) · `insights_career_deletion`(키 이름) · `jd_extraction`(이름·`deadline` 키) · `r12_ui36_followups`(`draft_default_title` 단정 삭제) · `retention_purge`(FK 목록·purge 목록) · `s5_first_call_privileges`(이름·컬럼 단위 JD select) · `s6_lock_order`(release 트리거 목록) · `ui32_education_display_labels`(헬퍼 단정만 남김) · `update_failed_jd_raw_text`(조건 5) · `writing_chats`(`project_id` nullable) · `r14_remove_mock_interview`(`owner_type`·삭제 영향 키).

### 가드 검증 방법 (pgTAP 밖 — R14 선례)

파괴 마이그레이션의 0단계 가드는 마이그레이션이 돈 뒤에는 세는 테이블이 없어 pgTAP으로 단정할 수 없다. **마이그레이션 파일에서 `do $$ … $$;` 블록을 그대로 뽑아** 임시 대역 테이블 위에서 돌려 확인했다(실제 가드 텍스트가 실행된다):

```bash
python3 - <<'PY' > /tmp/guard_check.sql
s=open('supabase/migrations/20261113004700_r15_drop_drafts.sql').read()
g=s[s.index('do $$'):s.index('$$;', s.index('do $$'))+3]
print("begin;\ncreate table public.drafts (id uuid primary key default gen_random_uuid());"
      "\ncreate table public.draft_sections (id uuid primary key default gen_random_uuid());"
      "\ncreate table public.draft_section_sources (id uuid primary key default gen_random_uuid());")
print(g); print("insert into public.drafts default values;"); print(g); print("rollback;")
PY
psql "$DB_URL" -v ON_ERROR_STOP=0 -f /tmp/guard_check.sql
```

**결과(2026-11-09)**: 네 테이블이 비어 있으면 통과, `drafts`에 1행을 넣으면
`ERROR: r15_drop_drafts: old document rows still exist (drafts=1, draft_sections=0, draft_section_sources=0, evidence_links[draft_section]=0); nothing is migrated, so resolve them first`
로 **멈춘다**. 메시지에 **테이블별 행 수만** 들어가고 값·id는 없다(R14 0단계와 같은 모양). `evidence_links`의 `owner_type='draft_section'` 분기는 3단계에서 트리거·CHECK가 그 값을 막아 마이그레이션 뒤에는 행을 만들 수 없어 같은 방식으로 재현하지 못했다 — 식은 나머지 셋과 같은 모양이고 `r15_drop_drafts.test.sql`이 그 CHECK를 단정한다.

---

## ⑧ 열린 문제 · 다음 사람에게

- **spec-gaps 9건**(`R15-DB-1` ~ `R15-DB-9`)을 `_workspace/backend/spec-gaps.md`에 적었다. 그중 **DB-8**(원문 수정 조건 완화)·**DB-9**(근거 거부 코드 `23514` → `P0001`)는 **api의 오류 매핑·화면 동작에 보이는 변화**다.
- **CF-S1은 문서 PR #68 미머지 상태에서 구현했다.** 위 ②-6이 구현 기준이다. 문서가 머지되면 `sources[]` 상한(5개)·`role` 값·"키 없음 = 유지" 규칙이 그대로인지 대조할 것.
- api-engineer: `enums.ts` 미러 대상은 위 ④. 거부 코드 → HTTP 매핑은 ②의 표를 그대로 쓰면 된다. `too_many_questions`의 raise detail은 **`'5,{current}'`** 문자열이므로 `split(',')`로 `{limit, current}`를 만들어야 한다.
- ai-pipeline-engineer: `replace_draft`는 `draft` 키 안에 초안을 담는다(`body`가 아니다) `[가정]`. `value`는 보내도 무시되고 DB가 `blocks`로 다시 조립한다. `sources[]`는 `draft` 안에 둔다.
- 파괴 마이그레이션은 **`20261113004700`**(재번호됨)이고 **코드 배포 뒤** push. push 전 원격 읽기 전용 확인: 세 테이블 행 수 0 · `evidence_links(owner_type='draft_section')` 0 · 옛 서류 RPC 호출 0 · `writing_chats`에 `project_id is null` 행 0 · 서류 `job_type` + `target_type='writing_chat'` `ai_jobs` 행 0.
- 되돌릴 수 없는 지점(사용자 승인 대상): ① 코드 배포 뒤 `writing_chats.project_id` not null 복구 ② 코드 배포 뒤 `ai_jobs` CHECK 원복(90일) ③ 3단계 뒤 `structured_draft`에 쓴 서류 모양 jsonb ④ 4단계 drop(스키마 비가역, 지우는 행 0).
