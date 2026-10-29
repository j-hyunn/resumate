# S7 DB 구현 노트 (db-engineer)

> 상태: **QA 1차 반영(QA-S7-01·07·09)**. `supabase db reset` 통과, `supabase test db` 39파일 1780개 모두 통과, `database.types.ts` 재생성(공개 시그니처 변화 없음). 커밋·원격 적용 없음.
> 아래 시그니처·payload 모양이 계약 기준이다(작업 중 먼저 공개한 내용에서 바뀐 것 없음).

## RPC 시그니처와 반환 형태 (api·ai 먼저 볼 것)

공통
- 오류는 `errcode = 'P0001'`, `message` = 소문자 코드. 미인증은 `42501 not_authenticated`.
- 사용자 RPC는 **authenticated 전용**, security definer + `auth.uid()` 소유 검사. 키 불필요(AI 호출 없음).
- AI RPC는 **app_ai_writer 전용**, security definer + `private.current_uid()` 소유 검사.
- 잠금 순서: 지원 프로젝트 → `drafts` → `draft_sections` (S6와 같은 방식, 작업 종료 트리거는 프로젝트를 `skip locked`).
- `*_not_found`는 프로젝트·초안·섹션 삭제도 뜻한다 → api는 canceled처럼 처리.

### 1. 자기소개서 — 사용자 RPC (authenticated)

```sql
create_cover_letter_draft(p_application_project_id uuid, p_draft_id uuid default null, p_title text default null) returns jsonb
-- {draft_id, application_project_id, draft_type:'cover_letter', title, status:'composing', created:boolean,
--  sections:[{section_id, sort_order, template_key, question_text, char_limit, count_basis}]}
```
- 기본 3문항 시드(sort_order 0·1·2): `motivation` "지원 동기", `job_competency` "직무 역량", `future_plan` "입사 후 포부 및 성장 계획". `char_limit = 1000`, `count_basis = 'with_spaces'` `[가정]`.
- 제목 기본값 "자기소개서 (YYYY-MM-DD)"(KST), 1~100자.
- `p_draft_id`(클라이언트 UUID, 선택): 같은 id의 본인 자소서 초안이 이미 있으면 그것을 돌려준다(`created:false`, 재시도 멱등). 다른 프로젝트·다른 종류면 `draft_id_conflict`.
- 오류: `application_project_not_found`, `invalid_title`, `draft_id_conflict`.

```sql
add_cover_letter_question(p_draft_id uuid, p_question_text text, p_char_limit integer default 1000,
                          p_count_basis text default 'with_spaces', p_section_id uuid default null) returns jsonb
-- {section_id, draft_id, sort_order, created:boolean, draft_status}
```
- 맨 뒤에 붙인다(`max(sort_order) + 1`), `template_key = null`. 문항은 초안당 최대 10개 `[가정]`.
- `p_section_id`(선택, 멱등): 같은 초안의 같은 id가 있으면 그대로 돌려준다(`created:false`).
- 오류: `draft_not_found`(자소서 초안 아님 포함), `invalid_question`(문구 공백·1000자 초과, 글자 수 1~10000 밖, 기준값 오류), `question_limit_reached`, `section_id_conflict`.

```sql
delete_cover_letter_question(p_section_id uuid) returns jsonb
-- {deleted:true, section_id, draft_id, remaining, draft_status}
```
- 마지막 1문항은 지울 수 없다 → `last_question`. 진행 중 작업(queued/running)으로 생성 중인 문항 → `section_generating`.
- sources는 FK 연쇄, 근거(`evidence_links` owner `draft_section`)는 트리거로 함께 지워진다. sort_order 빈 번호는 그대로 둔다.
- 오류: `section_not_found`, `last_question`, `section_generating`.

```sql
reorder_cover_letter_questions(p_draft_id uuid, p_section_ids uuid[]) returns jsonb
-- {draft_id, section_ids: uuid[]}   -- 저장된 순서
```
- `p_section_ids`는 그 초안의 문항 id 전체를 중복 없이 담아야 한다. sort_order = 배열 index(0부터).
- 오류: `draft_not_found`, `invalid_section_order`.

```sql
set_section_sources(p_section_id uuid, p_sources jsonb) returns jsonb
-- {section_id, source_selection_mode:'user', sources_modified_at,
--  sources:[{id, sort_order, experience_id, education_id, project_id, project_detail_ids, role, origin:'user',
--            rationale, requirement_ids, reuse_reason, source_label, source_deleted_at}]}
```
- `p_sources`: 배열 0~5개 `[가정]`. 원소 `{project_id?, experience_id?, education_id?, project_detail_ids?: uuid[], role?: 'primary'|'supporting', requirement_ids?: uuid[]}`
  - `project_id`가 있으면 소속(경력/교육)은 프로젝트에서 파생한다. 함께 보낸 `experience_id`/`education_id`가 프로젝트 소속과 다르면 `source_not_found`.
  - 경력만 / 교육만 고르는 것도 허용(`project_id` 없이). 셋 다 없거나 경력·교육 둘 다면 `invalid_sources`.
  - 대상 행은 본인 소유 + `status = 'complete'`. `project_detail_ids`는 그 프로젝트의 complete 상세 내용만. `requirement_ids`는 이 지원 프로젝트 JD의 요건만. 어기면 `source_not_found`.
  - `role` 생략 시 첫 원소 `primary`, 나머지 `supporting`. 같은 (경력, 교육, 프로젝트) 조합 중복은 `invalid_sources`.
- 기존 행을 모두 `origin = 'user'` 행으로 교체하고 `source_selection_mode = 'user'`, `sources_modified_at = now()`.
  - 같은 조합이 기존 목록에 있으면 `rationale`·`reuse_reason`·`requirement_ids`(입력에 없을 때)를 이어받고, 그 선택 이유 근거(`item_key = sources.{n}`)도 새 순서로 옮긴다. 빠진 항목의 `sources.{n}` 근거는 지운다.
  - 빈 배열 허용(메모·JD·프로필만으로 쓰기).
- 생성 중(진행 중 작업)인 문항은 `section_generating`.
- 오류: `section_not_found`(자소서 문항 아님 포함), `section_generating`, `invalid_sources`, `source_not_found`.

직접 update (column grant, RLS 본인)
- `drafts`: `title`, `edited_at`, `first_copied_at`. `first_copied_at`은 한번 기록되면 트리거가 바꾸지 않는다(처음 복사만 남음). delete 본인(개별 초안 삭제 `[가정]`).
- `draft_sections`: `question_text`, `char_limit`, `count_basis`, `user_note`, `edited_content`. 자소서 문항이 아닌 섹션에 `question_text`·`char_limit`·`count_basis`·`user_note`를 넣으면 CHECK 위반. `edited_content`는 블록 배열 모양 검사(아래 Block). `drafts.edited_at`은 api가 같은 요청에서 따로 갱신한다(트리거 없음 — 잠금 순서 때문).

### 2. 경력기술서 — app_ai_writer RPC

작업 모양: `job_type = 'career_description'`, `target_type = 'draft'`, **`target_id` = 새로 만들 초안 id(api가 UUID를 먼저 만든다)**, `application_project_id` = 지원 프로젝트.

```sql
begin_career_description(p_application_project_id uuid, p_ai_job_id uuid, p_options jsonb, p_sections jsonb,
                         p_insight_id uuid default null, p_regenerated_from_id uuid default null,
                         p_title text default null) returns jsonb
-- {draft_id, application_project_id, status:'generating', reopened:boolean,
--  sections:[{section_id, sort_order, section_kind, experience_id, education_id, heading}]}
```
- 초안 id = 작업 `target_id`. 같은 작업으로 이미 만들었으면 그 초안·섹션을 그대로 돌려준다(멱등, `p_options`·`p_sections`는 무시). 그 초안이 `failed`이고 작업이 다시 queued/running이며 초안의 `run_generation` < 작업 세대면(수동 재시도) `generating`으로 다시 열고 섹션을 `pending`으로 되돌린다(`reopened:true`, S6 QA-S6-01 방식).
- `p_options`: 아래 Options 모양. 경력기술서는 `included_project_ids` 배열과 `selection_origin` 필수.
- `p_sections`: 서버가 정한 순서의 배열 1~30개, sort_order = index. 원소 `{section_kind:'experience'|'education'|'standalone_projects', experience_id?, education_id?, heading?: string|null(≤300)}`. `experience`는 `experience_id`(본인 행) 필수, `education`은 `education_id` 필수, `standalone_projects`는 둘 다 없음·최대 1개. 같은 경력·교육 중복 금지.
- `p_insight_id`: 참고한 인사이트(같은 지원 프로젝트의 `ready` 행). `p_regenerated_from_id`: 다시 생성의 원본 경력기술서(같은 프로젝트). 이전 행은 그대로 남는다(새 행 생성).
- 제목 기본값 "경력기술서 (YYYY-MM-DD)"(KST).
- AI 메타: `ai_job_id`, `run_generation`, `provider`·`model_tier`·`connection_tier`는 작업에서 복사.
- 오류: `application_project_not_found`, `invalid_ai_job`(작업 모양·상태, target_id 초안이 다른 작업 것), `jd_not_extracted`, `invalid_draft_options`, `invalid_draft_sections`, `insight_not_found`, `draft_not_found`(regenerated_from), `invalid_title`.

```sql
complete_career_description(p_draft_id uuid, p_ai_job_id uuid, p_run_generation integer, p_payload jsonb) returns jsonb
-- 반영: {applied:true, draft_id, application_project_id, status:'ready', section_count, evidence_count, completed_at}
-- 무시: {applied:false, reason:'stale_run'}
```
- 한 트랜잭션: 섹션별 `ai_content`·`validation_report`·AI 메타·`status = 'ready'`·`generation_no + 1` → `evidence_links`(owner_type `draft_section`, owner_id = 섹션, `item_key = block_id`) → 초안 `ready`·해시·메타·`completed_at` → 지원 프로젝트 `last_activity_at`.
- `stale_run`: 작업이 `running`이 아님, 세대 불일치, 또는 초안이 `generating`이 아님(단 `failed`이고 초안 세대 < `p_run_generation`이면 반영 — S6 QA-S6-01).
- 순서: `complete_career_description` → `complete_ai_job`. `stale_run`이면 `complete_ai_job`을 부르지 않는다.
- 오류: `draft_not_found`, `invalid_ai_job`, `invalid_ai_metadata`, `invalid_draft_payload`, `invalid_evidence_source`.

```sql
fail_career_description(p_draft_id uuid, p_ai_job_id uuid) returns boolean
```
- 초안이 `generating`이고 `ai_job_id = p_ai_job_id`일 때만 초안 `failed` + `pending`/`generating` 섹션 `failed`, true. 아니면 false. 오류: `draft_not_found`.

### 3. 자기소개서 문항 생성 — app_ai_writer RPC

작업 모양: `job_type = 'cover_letter'`, `target_type = 'draft_section'`, `target_id` = 문항 id, `application_project_id` = 초안의 지원 프로젝트. 동시 실행 1개는 문항 단위(`ai_jobs_in_flight_target_key`).

```sql
begin_cover_letter_section(p_section_id uuid, p_ai_job_id uuid) returns jsonb
-- {section_id, draft_id, application_project_id, status:'generating', generation_no, source_selection_mode,
--  reopened:boolean, draft_status}
```
- 문항 `generating` + `ai_job_id`·`run_generation`·공급자 메타(작업에서) 기록, 초안 상태 재계산(→ `generating`).
- 같은 작업이 이미 열었으면 그대로(멱등). 같은 작업의 `failed` 문항 + 작업 queued/running + 행 세대 < 작업 세대면 다시 연다(`reopened:true`).
- 다른 작업이 생성 중: 그 작업이 queued/running이면 `section_in_progress`, 끝났거나 없으면 인계(덮어씀).
- `generation_no`는 begin에서 늘지 않는다(완료 때 +1). 반환값은 현재 값.
- 오류: `section_not_found`, `invalid_ai_job`, `jd_not_extracted`, `section_in_progress`.

```sql
complete_cover_letter_section(p_section_id uuid, p_ai_job_id uuid, p_run_generation integer, p_payload jsonb) returns jsonb
-- 반영: {applied:true, section_id, draft_id, generation_no, status:'ready', draft_status, source_count, evidence_count, completed_at}
-- 무시: {applied:false, reason:'stale_run'}
```
- 쓰는 것: `ai_content`(paragraph 블록), `ai_char_count`, `correction_applied`, `question_class`, `validation_report`, AI 메타·해시, `generation_no + 1`, `sources_modified_at = null`, **`edited_content = null`**, `status = 'ready'`, `completed_at`.
- sources: 문항이 `ai` 모드면 전부 `origin = 'ai'` 행으로 교체(sort_order = payload index). `user` 모드면 사용자 행을 그대로 두고, payload source와 (경력, 교육, 프로젝트)가 같은 행의 `rationale`만 갱신. 맞는 행이 없는 payload source는 버린다(그 `sources.{n}` 근거도).
- 근거: 이 문항의 기존 근거를 모두 지우고 새로 넣는다(이전 생성본 미보관, D-DM-06).
- 초안: 상태 재계산 + `provider`·`model`·`model_tier`·`connection_tier`·`prompt_version`·`schema_version`·`completed_at`을 이 문항 값으로(결과 배지).
- `stale_run` 규칙은 경력기술서와 같다(행 기준 = 문항).
- 오류: `section_not_found`, `invalid_ai_job`, `invalid_ai_metadata`, `invalid_draft_payload`, `invalid_evidence_source`.

```sql
fail_draft_section(p_section_id uuid, p_ai_job_id uuid) returns boolean
```
- 문항이 `generating`이고 `ai_job_id = p_ai_job_id`일 때만 `failed` + 초안 상태 재계산, true. 아니면 false. 오류: `section_not_found`.

초안 상태 재계산(자소서): 생성 중 문항이 있으면 `generating` → 모두 `ready`면 `ready` → `failed`가 있고 `ready`도 있으면 `partially_failed` → `failed`가 있고 `ready`가 없으면 `failed` → 그 밖(생성 전·생성 전+ready 섞임)은 `composing` `[가정]`.

### 4. 작업 종료 트리거
- `career_description` 작업이 `failed`(sweep `stalled` 포함)·`canceled`·`succeeded`로 끝나면 그 작업의 `generating` 초안 → `failed`(섹션도). `cover_letter` 작업이면 그 작업의 `generating` 문항 → `failed` + 초안 재계산.
- 프로젝트 행을 `skip locked`로 잡고, 못 잡으면 아무것도 하지 않는다(S6와 같음). **api 조회는 "`generating`인데 그 작업이 끝났거나 없음"을 실패로 보여야 한다.** 다음 begin이 정리한다.

### 5. `draft_source_ranking` (AI-11)
- RPC 없음. `ai_jobs` 행(`job_type = 'draft_source_ranking'`, `target_type = 'application_project'`, `target_id` = 프로젝트)의 `output` jsonb를 app_ai_writer가 직접 insert/update한다(기존 column grant 그대로). 재사용 조회는 `ai_jobs_reuse_idx`.

### Payload 모양

#### Options (`drafts.options`, `begin_career_description.p_options`)
```jsonc
{
  "included_experience_ids": ["<uuid>"],   // 배열(생략 가능), 각 uuid 문자열, ≤ 100
  "included_education_ids": ["<uuid>"],
  "included_project_ids": ["<uuid>"],       // 경력기술서 필수
  "project_order": ["<uuid>"],              // 생략 가능
  "selection_origin": "insight" | "ai_ranking" | "user",   // 경력기술서 필수
  "ranking": [ ... ] | { ... } | null,      // AI-11 결과 복사(UUID 형태). 모양은 검사하지 않음
  "tone": "concise" | "…" | null            // 문자열 ≤ 50 [가정]
}
```
- 이 7개 밖의 키는 거부(`invalid_draft_options`, 테이블 CHECK도 같음).

#### Block (`ai_content`, `edited_content` 원소)
```jsonc
{
  "block_id": "p3-b1",            // 필수, 1~64자 [A-Za-z0-9_.:-], 초안 안에서 유일(complete가 검사)
  "block_kind": "header" | "summary" | "role_line" | "bullet" | "paragraph",   // 필수
  "text": "…",                    // 필수 문자열, ≤ 5000자 (header는 빈 문자열 허용)
  "project_id": "<uuid>" | null,
  "requirement_ids": ["<uuid>"],
  "placeholders": [{ "token": "[수치 입력 필요]", "hint": "…" }],
  "flags": ["evidence_check_needed", "number_check_needed", …],   // 문자열 배열
  "generated_by": "ai" | "server" | "user",
  "user_modified": false,
  "header": { … } | null         // 머리글 구조값(회사명·기간·직급 등). 모양 검사 없음
}
```
- 배열 0~500개. 위 키 밖의 키는 허용(무시하지 않고 저장). 타입만 검사한다.
- 경력기술서 섹션 블록은 `header`/`summary`/`role_line`/`bullet`, 자소서는 `paragraph`만(complete가 검사). `edited_content`는 종류 제한 없음.

#### `complete_career_description.p_payload`
```jsonc
{
  "sections": [                        // 초안의 모든 섹션을 정확히 1번씩
    { "section_id": "<uuid>", "blocks": [Block], "validation_report": { … } | null }
  ],
  "hashes": { "input_hash": "…", "career_snapshot_hash": "…" },   // 각 1~128자
  "meta": {
    "schema_version": 1, "prompt_version": "ai-03.generate.v1+common.v1",
    "provider": "gemini", "model": "…", "model_tier": "default", "connection_tier": "free",  // 작업과 같아야 함
    "validation_report": { … } | null, "usage": { … } | null
  },
  "evidence": [                        // 0~2000
    { "section_id": "<uuid>",          // 이 초안의 섹션
      "item_key": "p3-b1",             // 그 섹션 블록의 block_id
      "sort_order": 0, "source_type": "project_detail", "source_id": "<uuid>", "source_field": "action",
      "quote": "…" | null, "quote_adjusted": false, "source_locator": null,
      "source_snapshot_at": "…" | null, "source_label": "…" | null }
  ]
}
```
- 근거 출처는 커리어 7종(`profile`, `experience`, `education`, `project`, `project_detail`, `achievement`, `skill`)만. **`project_detail.learnings`는 거부(V-8)**.
- 원소의 `owner_type`·`owner_id`·`application_project_id`·`user_id`는 무시(RPC가 채움). `toEvidenceLinkRows` 결과에 `section_id`만 더하면 된다.

#### `complete_cover_letter_section.p_payload`
```jsonc
{
  "question_class": "motivation" | "job_competency" | "future_plan" | "experience_story",
  "blocks": [Block],                   // 1~20개, block_kind = 'paragraph'
  "ai_char_count": 812,                // 정수 ≥ 0 (서버가 count_basis로 센 값)
  "correction_applied": true,          // boolean
  "sources": [                         // 0~5
    { "project_id": "<uuid>" | null, "experience_id": "<uuid>" | null, "education_id": "<uuid>" | null,
      "project_detail_ids": ["<uuid>"], "role": "primary" | "supporting",
      "rationale": "…" | null,         // ≤ 300
      "requirement_ids": ["<uuid>"], "reuse_reason": "…" | null,   // ≤ 300
      "source_label": "…" | null }     // 원본 행이 없을 때만 쓰는 대체 표시명(≤ 300). 보통 DB가 계산
  ],
  "hashes": { "input_hash": "…", "career_snapshot_hash": "…" },
  "meta": { …경력기술서와 같음… },
  "evidence": [
    { "item_key": "q2-p1" | "sources.0", // 블록 block_id 또는 sources.{payload index}
      "sort_order": 0, "source_type": "…", "source_id": "<uuid>", … }
  ]
}
```
- 근거 출처: 커리어 7종 + `jd_requirement` + `jd_sentence`(S6 위치 규칙) + **`user_note`(source_id = 이 문항 id, `source_field = null`)**.
- `sources` 원소: 경력·교육·프로젝트 중 하나 이상, 경력·교육 동시 불가. 원본 행이 없거나 남의 것이면 `source_deleted_at = now()`로 저장한다(오류 아님).
- `sources.{n}`의 n은 payload `sources` 배열 index. user 모드에서는 맞는 사용자 행의 sort_order로 바꿔 저장한다.

---

## 마이그레이션 파일
| 파일 | 내용 |
|------|------|
| `supabase/migrations/20261102000100_s7_drafts.sql` | 모양 헬퍼(`is_uuid_text`, `is_uuid_array`, `draft_options_valid`, `draft_blocks_valid`), `drafts`·`draft_sections`·`draft_section_sources` + CHECK·인덱스·RLS·grant, `first_copied_at` 보존 트리거, 섹션 삭제 시 근거 삭제 트리거, service_role 쓰기 회수 |
| `supabase/migrations/20261102000200_s7_draft_source_triggers.sql` | 경력·교육·프로젝트 삭제 → `source_deleted_at` + 삭제 전 표시명, 상세 내용 삭제 → `project_detail_ids`에서 제거, `evidence_links_check_source`에 `user_note` 분기 추가 |
| `supabase/migrations/20261102000300_s7_cover_letter_user_rpcs.sql` | 초안 상태 재계산·잠금·제목 헬퍼, `create_cover_letter_draft`, `add/delete/reorder_cover_letter_question(s)`, `set_section_sources` |
| `supabase/migrations/20261102000400_s7_career_description_rpcs.sql` | 공용 payload 헬퍼(메타·해시·근거 원소·근거 insert), `begin/complete/fail_career_description`, `career_description_mark_failed` |
| `supabase/migrations/20261102000500_s7_cover_letter_section_rpcs.sql` | `begin/complete_cover_letter_section`, `fail_draft_section`, `draft_section_mark_failed`, 작업 종료 트리거 `ai_jobs_release_drafts`(두 작업 종류) |
| `supabase/migrations/20261102000600_s7_career_deletion_drafts.sql` | `career_deletion_draft_ids`·`career_deletion_section_ids`·`reset_cover_letter_sections`, `get_deletion_impact`·`delete_career_item` 재정의(시그니처·grant 동일) |

`ai_jobs`는 바꾸지 않았다. `target_type`에 CHECK가 없고(`writing_chat_turn`·`jd_extraction` 모양 CHECK만 있음) `output`은 S3부터 app_ai_writer insert/update grant가 있다 → `career_description`/`draft`, `cover_letter`/`draft_section`, `draft_source_ranking`/`application_project` 조합이 모두 허용된다.

## 테이블·컬럼 (스펙 대비 차이)
- 세 테이블 모두 A.9~A.11 컬럼 그대로 + `user_id`(DM-1, 복합 FK DM-2) + `created_at`/`updated_at`.
- **추가 컬럼 `[구현 결정]`**
  - `drafts`·`draft_sections`: `run_generation`(내부용, S6 QA-S6-01 재시도 규칙), `completed_at`(결과 시각). AI 메타 `ai_job_id`는 복합 FK `(ai_job_id, user_id)` → `ai_jobs` `on delete set null`(S6와 같음).
  - `drafts.insight_id`·`regenerated_from_id`는 복합 FK set null. `draft_sections.experience_id`/`education_id`, `draft_section_sources`의 세 id는 soft(DM-7).
- CHECK
  - `drafts`: 종류별 상태(경력기술서 = `generating`/`ready`/`failed`, 자소서 = 5값), 제목 1~100자, `options` 7개 키·모양, 경력기술서 `ready`면 해시·메타·`completed_at` 필수.
  - `draft_sections`: 종류별 컬럼(`experience`는 `experience_id`만, `education`은 `education_id`만, 자소서 문항만 문구·글자 수·기준·메모·`template_key`·`question_class`), 문구 1~1000자, 메모 ≤ 300, `char_limit` 1~10000, 블록 배열 모양(`ai_content`·`edited_content`), `ready`면 `ai_content`·메타(문항은 글자 수·유형도) 필수, `(draft_id, sort_order)` unique deferrable.
  - `draft_section_sources`: DM §2.7 두 CHECK, `rationale`·`reuse_reason`·`source_label` ≤ 300, `(draft_section_id, sort_order)` unique, 배열 null 원소 금지·상한(상세 20, 요건 50).
- 인덱스: 계획 두 개(`drafts_project_type_created_idx`, `drafts_reuse_idx`) + 작업·FK·삭제 트리거용.

## RLS·권한 요약 (DM §5 대비)
| 대상 | authenticated | app_ai_writer | service_role |
|------|---------------|---------------|--------------|
| drafts | select·delete 본인, update(`title`, `edited_at`, `first_copied_at`) | select 본인 | select·delete |
| draft_sections | select 본인, update(`question_text`, `char_limit`, `count_basis`, `user_note`, `edited_content`) | select 본인 | select·delete |
| draft_section_sources | select 본인 | select 본인 | select·delete |
| 자소서 사용자 RPC 5개 | execute | 없음 | (기본 execute) |
| AI RPC 6개 | 없음 | execute | (기본 execute) |
| `get_deletion_impact` / `delete_career_item` | execute(invoker, 기존) | 없음 | — |

- insert는 어느 API 역할에도 없다(RPC만). `ai_content`·`status`·`options`·`template_key`·sources는 사용자가 직접 못 쓴다(grants.test로 고정).
- `delete_results`의 경력기술서 삭제는 invoker RPC가 사용자 delete 권한으로 하고, 자소서 문항 초기화는 definer 헬퍼 `private.reset_cover_letter_sections`(본인 행만, `auth.uid()`)가 한다.

## 테스트 (`supabase test db`: 38파일 1758개, 모두 통과)
- 새 파일
  - `supabase/tests/drafts.test.sql`(153): RLS·정책·인덱스, 자소서 시드·멱등·충돌·제목, 문항 추가(상한 10·잘못된 값 3종·멱등)·삭제(최소 1)·순서 변경(누락·다른 초안), 직접 update 허용/금지 컬럼·CHECK, `first_copied_at` 보존, `set_section_sources` 오류 15종·소속 파생·표시명·빈 목록, 문항 생성 begin(작업 모양 3종·JD 미추출·멱등)·생성 중 삭제/근거 변경 금지, complete(잘못된 payload 24종 → `invalid_draft_payload`, 메타 불일치, stale_run, 반영·편집본 초기화·AI sources·근거 item_key·user_note·회고 허용), 근거 변경 후 rationale·`sources.{n}` 이어받기, 사용자 모드 다시 생성(rationale만 갱신·목록 밖 버림), fail·같은 세대 재오픈 금지·재시도(begin 없이 complete / begin 재오픈), 종료 트리거(failed·canceled), 초안 상태 재계산 4종, 인계·`section_in_progress`, 교차 사용자(사용자·app_ai_writer·sub 없음), FK·CHECK, 연쇄(초안·프로젝트·탈퇴), 잠금 경로 구조
  - `supabase/tests/career_description.test.sql`(64): begin(작업 모양·JD·남의 프로젝트·옵션/섹션 오류 15종·인사이트·원본·제목, 섹션 순서·메타·멱등), complete(잘못된 payload 20종, 메타, stale_run, 반영·머리글·근거 소유·snapshot·last_activity_at), 다시 생성 새 행·fail, 트리거·수동 재시도 재오픈·begin 없는 재시도, canceled, target_id 재사용 거부, 교차 사용자, 사용자 삭제 연쇄
  - `supabase/tests/drafts_career_deletion.test.sql`(30): 삭제 영향(상세·프로젝트·경력·스킬·교육·무관), keep_results 트리거(상세 id 제거, 프로젝트·교육·경력 표시명), delete_results(문항 초기화·근거 삭제·초안 재계산, 경력기술서 삭제, 연쇄 상세 근거), 헬퍼 교차 사용자
  - `supabase/tests/s7_first_call_privileges.test.sql`(42): 실제 역할로 처음 호출(자소서 편집 → AI-11 output → 문항 생성·실패·트리거 → 경력기술서 begin/complete/fail → 삭제 영향 → delete_results → 삭제·연쇄)
- 기존 파일 수정
  - `supabase/tests/grants.test.sql`: app_ai_writer 테이블·함수 허용 목록에 S7 추가, S7 RPC 실행 매트릭스, 사용자 쓰기 컬럼 고정, 다른 역할 직접 쓰기 금지, `ai_content` 등 금지(plan 29 → 34)
  - `supabase/tests/s6_lock_order.test.sql`: 종료 트리거 목록에 `ai_jobs_release_drafts`

## 원격 브랜치 적용 여부
적용하지 않았다(계획대로). 커밋도 하지 않았다.

## api·ai가 알아야 할 것
- 경력기술서 순서: api가 초안 UUID를 만들고 그 값을 `target_id`로 작업 생성 → `begin_career_description` → AI-03 → `complete_career_description` → `complete_ai_job`. `stale_run`이면 `complete_ai_job`을 부르지 않는다.
- 자소서 순서: 문항마다 작업(`target_id` = 문항) → `begin_cover_letter_section` → AI-04 → `complete_cover_letter_section` → `complete_ai_job`.
- `begin_*`가 `jd_not_extracted`를 낸다(D-30 선행 추출은 api 책임). AI-11은 RPC 없이 작업 행 `output`에 쓴다.
- payload의 모르는 최상위 키(`omitted`, `notes_for_user` 등)는 무시되고 저장되지 않는다(ai spec-gaps ⑤ — 저장하려면 DM 자리가 필요).
- 조회 규칙(S6와 같음): `generating`인데 그 `ai_job_id` 작업이 queued/running이 아니거나 없으면 실패로 본다. 자소서 초안 상태는 그 보정 뒤 문항 상태로 다시 계산한다.
- `drafts.edited_at`은 트리거가 갱신하지 않는다 — `saveSectionEdit`가 섹션 update 뒤 같은 요청에서 `drafts.edited_at = now()`를 따로 쓴다(섹션 → 초안 잠금 순서가 RPC와 반대라 트리거로 두면 교착 위험).
- DB는 생성 중 문항의 직접 update(문구·메모·편집본)를 막지 않는다. 막는 것은 api 규칙(api spec-gaps ⑨). RPC 쪽(삭제·근거 변경)은 `section_generating`.
- 사용자가 생성 중인 초안을 지우면 complete/fail은 `draft_not_found`/`section_not_found` → canceled처럼 처리.
- `user_note` 근거의 `source_id`는 **그 문항(`draft_sections.id`)**이다. 별칭 `NOTE-1` → 문항 id로 매핑한다.

## 스펙 차이·가정 (spec-gaps.md "2026-11-02 · S7 (db)")
1. 경력기술서 작업의 `target_id` = 만들 초안 id(api가 미리 생성) `[구현 결정]`
2. `begin_career_description`에 `p_insight_id`·`p_regenerated_from_id`·`p_title` 추가(기본값 있음), `create_cover_letter_draft`·`add_cover_letter_question`에 멱등용 id `[구현 결정]`
3. 시드 글자 수 1000·공백 포함, 문항 상한 10, 문구 ≤ 1000, 글자 수 1~10000, sources ≤ 5 등 길이·개수 상한 `[가정]`
4. 자소서 초안 상태 재계산 규칙(전부 실패 → `failed`, ready+생성 전 → `composing`) `[가정]`
5. 자소서 초안의 AI 메타(배지) = 마지막으로 생성된 문항 값, `completed_at` 컬럼 추가 `[가정]`/`[구현 결정]`
6. `user_note` 근거 출처 = 문항 id `[구현 결정]`
7. `set_section_sources`: complete 행만, 경력/교육만 고르기 허용, 이어받기·근거 재배치 `[가정]`
8. 표시명 규칙(DB 계산, 첫 삭제 표시명 유지, 경력만이면 회사명) `[가정]`
9. 삭제 영향 집계 단위(경력기술서 = 문서, 섹션 머리글 포함 / 자소서 = 문항)와 초기화 범위 `[가정]`
10. V-8 DB 방어(경력기술서 회고 근거 거부, `job_competency` 문항 회고 거부) `[구현 결정]`
11. 경력기술서 동시 실행 제한 없음(작업 대상이 초안이라 프로젝트 단위 1개 제한이 걸리지 않음) `[가정]`

## QA 1차 반영 (2026-11-02, 커밋 전 S7 마이그레이션을 직접 고침)
- **QA-S7-01 경력기술서 동시 실행 1개**: `20261102000400`에 partial unique index `ai_jobs_career_description_in_flight_key on ai_jobs (user_id, application_project_id) where job_type = 'career_description' and status in ('queued','running')`.
  - 같은 지원 프로젝트에 두 번째 작업을 insert하면 **`23505` + 제약 이름 `ai_jobs_career_description_in_flight_key`** → api는 409(`generation_in_progress` 등)로 바꾼다. 다른 프로젝트는 동시에 하나씩 돌 수 있다.
  - spec-gaps "S7 (db) ①"의 "동시에 여러 개" 가정은 이것으로 없어졌다.
- **QA-S7-07 생성 중 판정**: `private.draft_section_job_active(p_section_id, p_exclude_job_id default null)`
  - "생성 중" = 이 문항을 대상으로 한 `cover_letter` 작업이 queued/running(begin 전 prepare·D-30 구간 포함), 또는 행이 `generating`이고 그 작업이 queued/running.
  - 작업이 끝난 `generating` 잔여 행은 막지 않는다. `delete_cover_letter_question`·`set_section_sources`의 `section_generating`, `begin_cover_letter_section`의 `section_in_progress`(자기 작업 제외) 모두 이 함수다.
  - **초안 상태 재계산도 같은 규칙**: 잔여 `generating`은 `failed`로 센다(조회 표시와 같음).
- **QA-S7-09 delete_results 중 진행 작업**
  - `delete_career_item(delete_results)`는 지운 경력기술서·초기화한 문항을 대상으로 한 queued/running `career_description`·`cover_letter` 작업에 `cancel_requested_at = now()`를 기록한다(definer 헬퍼 `private.cancel_draft_jobs`, 본인 작업만, 이미 요청된 것은 그대로). 잠금 순서를 지키려고 마지막 단계에서 한다.
  - `complete_cover_letter_section`: 문항의 `ai_job_id`가 호출 작업과 다르면(초기화로 null, 또는 다른 작업이 인계) **`stale_run`**을 돌려준다(전에는 `invalid_ai_job`). 작업 자체가 이 문항 대상이 아니면 여전히 `invalid_ai_job`.
  - 지워진 경력기술서는 `draft_not_found`(api: canceled처럼).
- 테스트: `supabase/tests/drafts_qa1.test.sql`(20) 새로 추가, `career_description.test.sql`에 23505 검사와 작업 순서 조정(66).
