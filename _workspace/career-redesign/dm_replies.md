# data-architect 회신 — 커리어 화면 재설계 (CR-1~CR-14)

작성: data-architect / 2026-11-02 / 기준: `docs/planning/04-data-model.md` **v4.4** (확정명은 3.6 이름 확정 표), `_workspace/00_input/planning-decisions-career-redesign.md`(확정 2026-11-02 (사용자)), 요청 `prd_requests.md`·`ux_requests.md`·`ai_requests.md`

## 구조 결정 요약

| # | 결정 | 근거 / 위치 |
|---|------|-------------|
| 1 | **STAR를 `projects` 컬럼으로 합친다. `project_details` 폐기** (DM-19) | 프로젝트당 1개라 별도 행 이점 없음. 1:1로 남기면 2단계 완료 판정·근거 종류 2개·트리거만 남는다. AI 명세는 이미 `DET-n` 폐기. 2.3, 0장 |
| 2 | **`achievements` 폐기**(CR-11), 관련 FK·근거·삭제 연쇄·`source_writing_chat_id` 제거 | 2.3, 2.8, 4.1 |
| 3 | 소속 / 독립 프로젝트는 **한 테이블**, 구분은 `num_nonnulls(experience_id, education_id)`, 구성은 **CHECK**, 소속 ↔ 독립 전환 거부 (DM-20) | 2.3 |
| 4 | 경력·교육 → 소속 프로젝트 FK **`on delete cascade`**, `affiliation_mode`는 `delete_projects`만 | D-UX-22 (a) 잠정. 독립으로 남기면 STAR 있는 독립 프로젝트 → CHECK 위반. 4.2 |
| 5 | 완료: 소속 = `name` + `situation` + `action`, 독립 = `name` + `description`(**산출물은 조건 아님**, PRD 따름), D-01 = complete 경력 1 + complete 프로젝트 1(독립 포함) | 2.2, 6장 |
| 6 | `writing_chats.project_id` not null, **소속 프로젝트만**, 프로젝트당 여러 개, `status` `active`/`closed`, 90일 정리·재개 전이·저장/전환/소속 RPC 폐기, **`apply_writing_chat_proposal`** 신설 | 2.5, 3.3, 3.4 |
| 7 | 연도 목록·기간 "(N년 N개월)"은 **앱 계산**(뷰·RPC 없음). 프로젝트 `is_current` 추가 안 함 `[가정]` | 2.4, D-DM-11 |
| 8 | 이미 구현된 백엔드 영향·데이터 이관 규칙 | 11장 |

## 요청 회신

### 테이블·컬럼

| 요청 (요청자 #) | 요청자가 쓴 이름 | **확정 이름** | 타입·제약 | 비고 |
|-----------------|------------------|---------------|-----------|------|
| STAR 위치 (ux D-1, ai 1, prd 1) | `projects.situation`… / 1:1 `project_details` | **`projects.situation`, `task`, `action`, `result`, `learnings`** | text null, 각 ≤ 2,000자, 마크다운. 소속 프로젝트만(독립은 CHECK로 null) | `title`·`sort_order` 없음. 화면 라벨: 상황 / 역할(`task`) / 행동 / 결과/성과(`result`) / 배운 점(`learnings`) |
| 프로젝트 종류 (ux D-2, ai 4, prd 6) | ux `project_type` / ai `project_kind` | **`projects.project_type`** | text null, CHECK 9값, 단일, 소속만 | 값 키 아래 |
| 경험 유형 (ux D-2, ai 4) | `experience_type` | **`projects.experience_type`** | text null, CHECK 7값, 단일, 소속만 | |
| 역량 (ux D-2, ai 4) | `competencies` text[] | **`projects.competencies`** | text[] not null default `'{}'`, 원소 CHECK 10값, ≤ 3개, 중복 없음, 소속만(독립은 `'{}'`) | 선택 순서 저장 |
| Link (ux D-3, ai 5, prd 4) | `link_url` | **`projects.link_url`** | text null, ≤ 2,048자, `^https?://`, 독립만 | AI 팩·해시 제외(AI 요청대로) |
| 프로젝트 내용 (ux D-4, ai 5, prd 4) | ux `description` / ai `content` | **`projects.description`** | text null, ≤ 5,000자, 마크다운, 독립만 | `summary`와 별개. `content`는 메시지·요건 본문 컬럼명과 겹쳐 쓰지 않음 |
| 담당 업무 (ux D-5, ai 5, prd 4) | `role` | **`projects.role`** | text null, ≤ 100자(서버), **독립만**, 필수 해제 | 소속 프로젝트는 CHECK로 null |
| 한 줄 요약 (ux D-4·D-17, ai 3, prd 3) | `summary` | **삭제** | — | 독립은 `description`이 대신. 이관: 독립 프로젝트 `summary` → `description`(비었을 때) |
| 팀 규모 (ux D-17, ai 3, prd 3) | `team_size` | **삭제** | — | 팀·배경은 `situation` |
| 프로젝트 이름 | `name` | `projects.name` | **not null**(v4.4), 공백 아님 | 이름만으로 `draft` 생성(CR-6) |
| 근거 변경 판정 시각 (신규, 요청 없음) | — | **`projects.content_updated_at`** | timestamptz not null | 근거 필드가 바뀔 때만 갱신. 분류·Link만 바꿔서는 근거 "변경됨" 안 됨. `evidence_links.source_snapshot_at`(project)의 기준 |
| 마지막 반영 대화 (ai 9) | `source_writing_chat_id` | `projects.source_writing_chat_id` | uuid null, FK set null, 소속만 | 의미: 마지막으로 반영한 대화 |
| 산출물 테이블 (ux D-6, ai 6, prd 5) | ux `project_deliverables` / ai `project_artifacts` | **`project_deliverables`** | `id`, `user_id`, `project_id`(복합 FK cascade, **독립만** 트리거), `title` not null ≤ **100**자, `body` text not null default `''` ≤ 20,000자, `sort_order` smallint(지연 unique), `created_at`, `updated_at` | 상태 컬럼 없음. 프로젝트당 50개 `[가정]`. PRD 용어집 "산출물 / Deliverable". AI 제안 제목 200자 대신 UX 100자 |
| 산출물 순서 변경 | — | `reorder_project_deliverables(project_id, ordered_ids uuid[])` `[가정]` | invoker | 화면에 UI 없으면 미사용 |
| 정량 성과 (ux D-17, ai 2, prd 2) | `achievements` | **폐기** | — | `source_writing_chat_id`, `kind`, 근거 `achievement`, 삭제 연쇄 모두 제거 |
| 상세 내용 테이블 | `project_details` | **폐기** | — | `DET-n`, 근거 `project_detail`, `reorder_project_details` 폐기 |
| 프로젝트-스킬 (ux D-17, ai 3, prd 3) | `project_skills` | `project_skills` | **독립 프로젝트만**(insert 트리거) | `skills`는 자동완성 사전, S-12 `[보류]` 그대로 |
| 진행 중 표시 (ux D-15, P-2) | `projects.is_current`(필요 시) | **추가 안 함** `[가정]` | — | D-DM-11. `end_month` null → "YYYY.MM -" |
| 근거 선택 상세 ID (ux D-16, ai 8) | `draft_section_sources.project_detail_ids` | **삭제** | — | 트리거 `draft_sources_remove_project_detail`도 삭제 |

### 분류 값 키 (PRD F-P1-19 `[가정]` 목록 그대로, 영문 키 확정)

| 컬럼 | 키 → 표시명 |
|------|-------------|
| `project_type` | `new_build` 신규 구축 / `improvement` 개선·고도화 / `operation` 운영·유지보수 / `research` 분석·리서치 / `marketing` 마케팅·캠페인 / `process_improvement` 프로세스·조직 개선 / `migration` 전환·마이그레이션 / `coursework` 교육·학습 과제 / `other` 기타 |
| `experience_type` | `impact` 성과 창출 / `problem_solving` 문제 해결 / `collaboration` 협업·갈등 조정 / `leadership` 주도·리딩 / `failure_recovery` 실패·극복 / `new_challenge` 새로운 시도 / `customer_facing` 고객·사용자 대응 |
| `competencies` | `problem_solving` 문제 해결력 / `analysis` 분석력 / `planning` 기획력 / `execution` 실행력 / `communication` 커뮤니케이션 / `collaboration` 협업 / `leadership` 리더십 / `technical_expertise` 기술 전문성 / `customer_insight` 고객 이해 / `learning_agility` 학습 민첩성 |

### AI 작성 대화

| 요청 (요청자 #) | 요청자가 쓴 이름 | **확정 이름** | 비고 |
|-----------------|------------------|---------------|------|
| 대화-프로젝트 (ux D-8, ai 9, prd 7) | `writing_chats.project_id` not null | `writing_chats.project_id` **not null**, FK cascade | **소속 프로젝트만**(insert 트리거 `writing_chat_requires_affiliated_project`, D-AI-15 (a)) |
| 대화 목록 제목 (ux D-8, ai 9) | `title` | **`writing_chats.title`** text null ≤ 100자 | `append_writing_chat_message`가 첫 사용자 메시지 앞 30자로 채움. null이면 화면 "새 대화" |
| 대화 상태 (ux D-9, ai 9) | `active` / `closed` | **`status` ∈ `active`, `closed`** | `active → closed`만, definer RPC(상한 도달). 사용자 `status` 직접 update 회수. 재개 전이 없음 |
| 마지막 반영 시각 (ai 9) | `last_applied_at` | **`writing_chats.last_applied_at`** | |
| 필드 반영 표시 (ux D-11, ai 9) | `applied_at` | **필드 객체 `applied_at`** | |
| 제안 STAR 경로 (ux D-11, ai 9) | ux `structured_draft.fields.{star}` / ai `structured_draft.star.{field}` | **`structured_draft.star.{situation,task,action,result,learnings}`**, 기간 `structured_draft.project.{start_month,end_month}` | `schema_version: 3`. 필드 객체 = `value`, `op`(STAR만, `set`/`append`), `origin`, `source_message_ids`, `source_quotes`, `review`, `reviewed_at`, `applied_at`. `op = append`면 `value` 전체가 덧붙일 문장(UX A-3) |
| 폐기 컬럼 (ux D-8, ai 9, prd 7) | `mode`, `experience_id`, `education_id`, `saved_at`, `affiliation_suggestion` | **삭제** | `status`의 `saved`·`handed_off`·`abandoned`도 삭제 |
| 대화 목록 인덱스 (ux D-8) | `(project_id, last_activity_at desc)` | 같음 | |
| 반영 RPC (ux D-10, ai 9) | `apply_writing_chat_proposal(writing_chat_id, fields text[])` | **`apply_writing_chat_proposal(p_writing_chat_id uuid, p_fields text[] default null)`** | invoker, AI·키 불필요, `active`·`closed` 모두. 빈 필드 = 넣기, 있는 필드 = 현재 값 + 줄바꿈 + 제안. `needs_review`·이미 반영·빈 값 건너뜀, 기간은 비었을 때만. 합계 2,000자 초과면 전체 거부 `field_too_long` `[가정]`. 반환 `{applied, skipped[{field, reason}], project_status}` |
| 패치 RPC (ai 9) | `apply_structured_draft_patch` V-9h 개정 | 같음 | 값 있는 STAR 필드는 `append`만, 기간은 빈 때만, AI 패치는 `active`만, 반영된 필드에 온 AI 패치는 새 필드 객체, 반영된 필드의 사용자 패치는 `field_already_applied` 거부 `[가정]` |
| 대화 시작 | `start_writing_chat` | **`start_writing_chat(p_project_id, p_return_target default null)`** | `mode` 인자 삭제. 시작 인사 STAR 상태별 4종 |
| 폐기 RPC (ux D-9, ai 9) | `save_writing_chat`, `hand_off_writing_chat`, `set_writing_chat_affiliation` | **삭제** | `purge_unlinked_writing_chats`·크론도 삭제 |
| 90일 정리 (ux D-9, ai 9, prd 7) | D-DM-08 | **폐기** | 보관 = 프로젝트·대화 삭제·탈퇴까지 |

### 근거 (`evidence_links`)

| 요청 (요청자 #) | 요청자가 쓴 이름 | **확정 이름** | 비고 |
|-----------------|------------------|---------------|------|
| 산출물 근거 종류 (ux D-16, ai 7) | ai `project_artifact` | **`source_type = 'project_deliverable'`** | `source_field` = `title`, `body`. `source_locator`(body) = 원문 마크다운 `{start, end}` JS UTF-16(문자 범위, UX A-7). `source_snapshot_at` = 산출물 `updated_at` |
| 산출물 별칭 (ai, prd) | ai `ART-n` / prd 예시 `DLV-n` | **`DLV-n` 권고** | 저장에는 영향 없음(AI 명세 소관). 테이블명과 맞춤 |
| 상세 내용 근거 (ux D-16, ai 7) | `project_detail` → `project` | **`source_type = 'project'`** + 필드 | `project_detail`·`achievement` 삭제 |
| 프로젝트 `source_field` (ai 7) | `name`, `period`, STAR 5, `role`, `content` | **`name`, `period`, `situation`, `task`, `action`, `result`, `learnings`, `role`, `description`** | `team_size`·`summary` 삭제. 분류 3종·`link_url` 허용 안 함. 소속에 `role`/`description`, 독립에 STAR면 insert 트리거 거부 `[가정]` |
| 회고 근거 / V-8 (ai 7) | `source_type = 'project' AND source_field = 'learnings'` | 같음 | 칩 "배운 점" |
| 허용 출처 (ai 7) | 커리어 출처에 산출물 포함 | 인사이트 = 커리어 6종 + JD 2종, 경력기술서 = 커리어 6종 | 커리어 6종 = profile, experience, education, project, project_deliverable, skill |
| 기존 근거 행 (ai 7) | 이관 vs 원본 삭제됨 | `project_detail.{field}` → `project.{field}`(같은 프로젝트, `title` → `name`), `achievement` → "원본 삭제됨" | 11.2 `[가정]`. 개발 데이터면 비우기 권고 |
| AI-08 대상 (ai 11) | `source_type = 'project'` + STAR 필드 | **`ai_suggestions.target_type = 'project'` + `target_field`** | Should |

### 데이터 최소 기준 (`get_data_readiness`)

| 요청 (요청자 #) | 요청자가 쓴 이름 | **확정 이름** | 비고 |
|-----------------|------------------|---------------|------|
| STAR 미완 힌트 (ux D-12, ai 10) | ux `complete_project_detail` → `project_star` / ai 삭제 | **`hints: "project_star"`** | 남겨서 이름만 바꿈(화면 문구용) |
| STAR 미완 카운트 (ux D-12) | `projects_without_complete_detail` | **`counts.projects_without_complete_star`** | 부모 경력·교육이 complete인 소속 프로젝트만 |
| 독립 프로젝트 미완 카운트 (신규) | — | **`counts.standalone_projects_without_description`** | |
| 상세 내용 카운트 (ai 10) | `complete_project_details`, `draft_project_details`, `draft_item_ids.project_details` | **삭제** | |
| 새 next_action (ux D-12, ai 10) | `create_project` | **`next_action: "create_project"`** | 채울 프로젝트가 없고 AI 사용 가능일 때 |
| suggested_mode (ai 10) | 삭제 | **삭제** | |
| project_fields (ai 10, A18) | 독립 프로젝트용 재정의 | **`hints: "project_fields"`** = 내용이 빈 `draft` 독립 프로젝트, `form` + `suggested_project_id` | |
| 판정 순서 | — | ① 경력 없음 → `form` ② STAR 미완 소속 프로젝트 → AI 가능 `writing_chat` / 아니면 `form`, 둘 다 `suggested_project_id` ③ 내용 빈 독립 → `form` + id ④ 그 밖 → AI 가능 `create_project` / 아니면 `form` | ②에서 AI가 없을 때도 `suggested_project_id`를 주도록 바꿨다 `[가정]` |
| D-01 (prd 8, ai 10) | 소속 = 이름 + 상황 + 행동, 독립 = 이름 + 내용(PRD) / 내용 **또는** 산출물(AI) | **PRD 채택: 독립 = 이름 + `description`** | 산출물은 완료 조건 아님. 독립 프로젝트도 D-01에 셈 |

### 삭제 (`get_deletion_impact` / `delete_career_item`)

| 요청 (요청자 #) | 요청자가 쓴 이름 | **확정 이름** | 비고 |
|-----------------|------------------|---------------|------|
| 산출물 entity_type (ux D-7) | `deliverable` | **`project_deliverable`** | 기존 규칙(테이블 단수형) |
| 산출물 cascade 키 (ux D-6·D-7) | `cascade.deliverables` | **`cascade.project_deliverables`** | |
| 제거 entity_type (ux D-7) | `project_detail`, `achievement` | **삭제** | cascade 키 `project_details`·`achievements`도 삭제 |
| affiliation_mode (ux D-7) | `delete_projects`만 | **`delete_projects`만**(기본값도), `keep_projects`는 `affiliation_mode_not_supported` | D-UX-22 사용자 답 대기 |
| 대화 삭제 반환 | `{message_count, linked_saved_rows}` | **`{message_count, last_applied_at}`** | |

### 목록·기간

| 요청 (요청자 #) | 요청자가 쓴 이름 | **확정** | 비고 |
|-----------------|------------------|----------|------|
| 커리어 목록 (ux D-14, prd 9) | `career_list` `{entity_type, id, name, start_month}` | **앱 계산**(DB 뷰·RPC 없음). 모양은 화면 타입으로 그대로 사용 | 시작 연도에 한 번, 같은 해 `start_month` desc → `created_at` desc, 시작월 없는 독립 = "연도 미정" |
| 기간 "(N년 N개월)" (prd 9) | — | **앱 계산**, 양 끝 달 포함 | |
| 소속 변경 (prd 10) | 경력 ↔ 교육만 | 같음, 소속 ↔ 독립은 `project_scope_change_not_allowed` | |

## 문서 담당자별 고칠 이름

### product-planner (`docs/planning/01-prd.md`)
- 용어집 "산출물 / Deliverable"에 데이터 이름 `project_deliverables` 병기(선택).
- F-P1-17 (4)·D-01: 현재 문구(독립 완료 = 이름 + 프로젝트 내용)와 데이터 모델이 같다. 변경 없음.
- F-P1-03 (3) "진행 중이면 이번 달까지": 프로젝트에 진행 중 표시 컬럼이 없다(D-DM-11 (a) `[가정]`). 문구를 "종료월이 없으면 시작월만 표시, 개월 수 생략"으로 맞추거나 `is_current`를 요청할 것.
- 9.0/9.4에 D-UX-22 데이터 측 제약 한 줄: "독립으로 남기기(b)는 데이터 구조상 불가에 가깝다(STAR가 있는 독립 프로젝트)".
- `decisions.md` 쪽 D-DM-08 폐기, A6·A15·A18·T-6·T-16·T-19 대체 표기(PRD 요청 "다른 문서와의 충돌"과 같은 범위).
- 이름 변경 없음.

### ux-planner (`docs/planning/02-user-flows.md`)
| 지금 쓴 이름 | 바꿀 이름 | 위치 |
|--------------|-----------|------|
| `entity_type = 'deliverable'` | `entity_type = 'project_deliverable'` | C-05, S-44 삭제 메뉴, 삭제 영향 표 |
| `cascade.deliverables` | `cascade.project_deliverables` | C-05, 프로젝트 삭제 문구 행 |
| `structured_draft.fields.{star}` | `structured_draft.star.{field}` (기간은 `structured_draft.project.{start_month,end_month}`) | S-10 제안 카드, C-15 |
| hint `complete_project_detail` | `project_star` | C-09, FL-13 |
| `projects_without_complete_detail` | `projects_without_complete_star` | C-09(쓰는 곳이 있으면) |
- `[가정]` 해제 가능(이름 확정): `projects.project_type`·`experience_type`·`competencies`, `projects.link_url`, `projects.description`, `projects.role`(독립 전용), `project_deliverables.title`(≤ 100)·`body`(≤ 20,000)·`sort_order`, `writing_chats.title`·`status`(`active`/`closed`)·`last_applied_at`, 필드 `applied_at`, `apply_writing_chat_proposal`, `next_action = create_project`.
- 분류 값 키(위 표)를 S-10 값 목록에 병기.
- `writing_chats.title`은 **서버가 첫 메시지 30자로 채운다** — 화면의 "없으면 첫 사용자 메시지 앞 30자" 대체 규칙은 "null이면 '새 대화'"만 남기면 된다.
- C-09: `next_action = form`이어도 STAR 미완 소속 프로젝트가 있으면 `suggested_project_id`가 온다(판정 ②) → "'{프로젝트명}' 마저 채우기"(S-10 섹션 편집)로 처리.
- 산출물 근거 강조 구간 = 원문 마크다운 문자 범위 `{start, end}`(JS UTF-16).
- 반영 결과 `skipped[].reason` ∈ `needs_review`, `already_applied`, `empty`, `period_already_set`, 오류 `field_too_long`(409) 문구 필요.
- C-25: 프로젝트 진행 중 표시 없음(D-15 회신 — 컬럼 추가 안 함).
- 경력·교육 삭제: 데이터는 `delete_projects`만 받는다(D-UX-22 사용자 답 전까지).

### ai-feature-designer (`docs/planning/03-ai-features.md`)
| 지금 쓴 이름 | 바꿀 이름 | 위치 |
|--------------|-----------|------|
| `projects.project_kind` | `projects.project_type` | C-1 표, C-1.2, C-3 V-2 설명, 해시 포함 필드 |
| `projects.content` (프로젝트 내용) | `projects.description` | C-1 표, C-1.1 "사실 근거로서의 지위", C-3 `project` 필드 목록, V-5 원천, AI-02 강등 규칙, AI-05 사실 전제, AI-03 |
| `source_field` `content` | `description` | C-3 표·근거 저장 매핑 |
| `project_artifacts` | `project_deliverables` | C-1 표, C-1.1, 저장 매핑 |
| `source_type = 'project_artifact'` | `source_type = 'project_deliverable'` | C-1, C-3, AI-03 예시 JSON, V-* |
| 별칭 `ART-n` | **`DLV-n` 권고**(별칭은 AI 소관 — 유지하려면 그 이유만 남겨 주세요) | C-1, C-3 표시 이름 표, 예시 |
| `<artifact>` 태그 | (선택) `<deliverable>` | C-1.1 |
| readiness hint `complete_project_detail` 삭제 | `project_star`로 **남음** | C-1 데이터 부족 행 |
| D-01 독립 = 이름 + 내용 **또는 산출물** | **이름 + `description`**(PRD 채택, 산출물은 완료 조건 아님) | C-1 D-01 행, C-14 `thin` |
- 확정(그대로 사용): STAR 5컬럼, `experience_type`, `competencies`, `link_url`(팩·해시 제외), `role`(독립 전용), `writing_chats.status` `active`/`closed`·`title`·`last_applied_at`, 필드 `applied_at`·`op`, `structured_draft` v3 경로 `project`·`star`, `apply_writing_chat_proposal`, `next_action = create_project`, `project_fields` 재정의, `ai_suggestions.target_field`.
- 산출물 제목 상한은 **100자**(제안 200자 아님). 본문 20,000자, 프로젝트당 50개 `[가정]`.
- `source_snapshot_at`(project) = `projects.content_updated_at` — 분류·Link만 바꾸면 "변경됨"이 뜨지 않는다. `career_snapshot_hash`는 분류를 포함하므로 F-P2-07 "데이터 변경됨"은 분류 변경에도 뜬다(의도대로인지 확인).
- 독립 프로젝트에 `writing_chats`를 만들 수 없다(DB 트리거) — D-AI-15 (a)와 같음. (b)로 가면 트리거만 푼다.
- 반영 RPC는 덧붙인 결과가 2,000자를 넘으면 전체 거부한다 `[가정]` — 정리 프롬프트가 `append` 길이를 의식하도록 할지 판단.

## 열린 항목

| # | 항목 | 담당 |
|---|------|------|
| 1 | D-UX-22 경력·교육 삭제 시 프로젝트 — (a) 전제로 FK cascade. (b)는 비권고 | 사용자 (Q-UX-1) |
| 2 | D-DM-11 프로젝트 진행 중 표시 — (a) 컬럼 없음 `[가정]` | product-planner / 사용자 |
| 3 | Q-CR-1 분류 값 목록 — 바뀌면 CHECK만 수정 | 사용자 |
| 4 | 산출물 50개·제목 100자, 반영 2,000자 초과 전체 거부, `content_updated_at` 범위 | `[가정]`, 리뷰 대상 |
| 5 | 기존 개발 데이터 비우기 vs 이관(11.2) | resumate-backend |

## 요청 회신 (후속 결정)

기준: `planning-decisions-career-redesign.md` "후속 결정" CR-15~CR-24(확정 2026-11-02 (사용자)), `docs/planning/04-data-model.md` v4.4(변경 이력 "후속 결정 CR-15~24").

| 결정 | 데이터 측 확정 이름·규칙 | 고칠 문서 |
|------|--------------------------|-----------|
| CR-15 경력·교육 삭제 시 함께 삭제 | FK cascade, `affiliation_mode` = `delete_projects`만(기본값). 확인 창은 `get_deletion_impact().cascade.projects`·`cascade.writing_chats` | ux: D-UX-22 `[결정 필요]` 해제 |
| CR-17 분류 값 확정 | `project_type` 9키, `experience_type` 7키, `competencies` 10키 최대 3(키 목록은 위 "분류 값 키" 표 그대로) | 모두: `[가정]` 해제 |
| CR-20 분류 추천 후 확인 | **`structured_draft.classification.{project_type, experience_type, competencies}`** (AI 출력 키 `classification_suggestions`). 필드 객체 = `value`(문자열 / 키 배열 1~3), `origin`, `source_message_ids`(선택), **`reason`**(text null, 추천 이유 한 줄, R-CR-14), `review = ok`, `reviewed_at`, `applied_at`. **`op` 없음 — 빈 값만 추천**(리더 결정, AI 명세 채택): `project_type`/`experience_type`은 null일 때, `competencies`는 하나도 고르지 않았을 때만. 바꾸기 제안 없음. 값 있는 분류에 대한 패치는 거부. CHECK 밖 키는 패치 RPC가 버림(AI V-9i의 DB 방어, 역량은 원소 단위·앞 3개). `apply_writing_chat_proposal`의 `p_fields`에 **`project_type`, `experience_type`, `competencies`** 추가. 추천 뒤 사용자가 직접 골랐으면 반영 때 건너뜀 **`classification_already_set`**. 분류만 바뀌면 `content_updated_at` 그대로 | ai: 확정 이름 그대로(`classification_suggestions` → `structured_draft.classification`, V-9i). ux: 제안 카드에 분류 행(빈 값일 때만), 스킵 사유 문구 `classification_already_set` |
| CR-22 진행 중 | **`projects.is_current`** boolean not null default false, `CHECK (NOT is_current OR end_month IS NULL)`, 소속·독립 모두. 표시: 종료월 있음 "YYYY.MM - YYYY.MM (N년 N개월)" / 진행 중 "YYYY.MM - 현재 (N년 N개월)"(이번 달 KST까지) / 둘 다 없음 "YYYY.MM -" / 시작월 없음 생략. 완료 조건 아님, 연도 묶음 영향 없음. **AI는 제안하지 않음**(R-CR-15) — 사용자가 기간 섹션 편집에서만 정한다, `p_fields`에 없음 | prd: F-P1-03 (3) "진행 중" 체크 반영. ux: C-25·섹션 편집 체크박스. ai: 팩 기간 "~ 현재", 개월 수 V-5 허용 값 |
| CR-23 화면 "기업 JD" → "자기소개서" | 내부 이름 그대로(`application_projects`, `job_descriptions`, "지원 프로젝트"). 저장되는 **기본 이름 `"새 자기소개서 (YYYY-MM-DD)"`**(이전 "새 기업 JD …", 기존 행 유지) `[가정]` | ux·prd: 화면·용어집 문구. backend: 기본 이름 상수(11장) |
| CR-16·18·19·21·24 | 스키마 영향 없음(`project_skills` 독립 한정·독립 프로젝트 대화 금지 트리거 유지) | — |
