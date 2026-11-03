# 데이터 모델 v4.5 회신 — 프로젝트 추가·산출물 상세 (PA-1~PA-4)

- 작성: data-architect / 2026-11-03
- 기준: 사용자 결정 PA-1~PA-4(`_workspace/00_input/planning-decisions-project-add-figma.md`, 확정 2026-11-03 (사용자)), 리더 정렬 3건(2026-11-03), 요청 `prd_requests.md`·`ux_requests.md`·`ai_requests.md`
- 결과 문서: `docs/planning/04-data-model.md` **v4.5** (2.5 `writing_chats`, 2.5.0 산출물 대화 모양, **2.5.1 페이지 저장 RPC**, 3.3 반영 경로, 3.7 이름 확정, 4장 삭제, 7장 API 경계, 8장 결정, 11.3 백엔드 후속 ★)
- 이 파일의 "확정" 이름이 정본이다. 아래 "이름이 바뀐 항목" 표대로 각 문서를 맞춰 달라.

## 리더 정렬 3건의 데이터 모델 반영

| # | 리더 정렬 | 데이터 모델 반영 |
|---|-----------|------------------|
| 1 | 이름·제목이 빈 상태의 첫 AI 메시지는 **보내지 않고 칸에 포커스, 임시 이름 없음** | `projects.name` not null·`project_deliverables.title` 필수 그대로. 기본 이름으로 행을 만드는 경로를 두지 않는다. PRD 9.5 `[가정]`("기본 이름") 폐기 |
| 2 | 턴은 **`form_snapshot`(저장 전 폼 값)**을 싣고 AI는 저장된 값보다 우선한다. 첫 AI 메시지는 **폼 전체를 먼저 저장해 행을 만든 뒤** 대화를 시작한다 | `form_snapshot`은 턴 요청 본문의 일시 입력(저장·로그 없음, 2.5.1). 첫 메시지 = ① 이름·제목 확인 ② AI 사용 가능 확인 ③ 페이지 저장 RPC(행 생성) ④ 대화 시작 RPC ⑤ 턴 — 순차 호출(7장). 시작 RPC는 "새 대상"을 받지 않는다 |
| 3 | [반영]은 폼만 채운다. "반영됨" 기록은 **페이지 저장과 같은 트랜잭션**, 기록 실패는 저장을 막지 않는다 | 저장 RPC 인자 `p_applied_proposals`, 원소마다 예외 블록(하위 트랜잭션)에서 기록, 실패는 `skipped[].reason`. `apply_writing_chat_proposal` 폐기 |

## 요청 회신

### product-planner → data-architect (`prd_requests.md` "data-architect")

| # | 요청 | 회신 |
|---|------|------|
| 1 | `writing_chats` 소속을 산출물까지, 산출물 삭제 → 대화 삭제, 독립 프로젝트 삭제 → 산출물·대화 삭제 | **수용.** `writing_chats.project_deliverable_id`(복합 FK `(project_deliverable_id, project_id, user_id)` → `project_deliverables(id, project_id, user_id) on delete cascade`). 산출물 대화의 `project_id` = 부모 독립 프로젝트(`project_id` FK cascade). 두 삭제 모두 연쇄된다(DM 2.5, 4.1) |
| 2 | `apply_writing_chat_proposal`의 "DB 즉시 저장"을 PA-3에 맞게 | **폐기.** [반영] = 화면 폼 채우기(요청 없음), 확정 = `save_project_page` / `save_project_deliverable`. 산출물 교체·덧붙이기도 같다(`mode`는 반영됨 기록에만 남음) (DM 3.3, 2.5.1) |
| 3 | 작성 중 행 생성 시점 = 첫 저장 또는 첫 AI 메시지, 기본 이름(제목)으로 만드는 경로 | **생성 시점 수용, 기본 이름 경로는 거절**(리더 정렬 1). 이름·제목이 비면 화면이 저장·첫 메시지를 막는다. 첫 AI 메시지는 페이지 저장 RPC로 폼 전체를 먼저 저장한다(리더 정렬 2). PRD 9.5 `[가정]` 2를 고쳐 달라 |
| 4 | 산출물에 분류 컬럼 없음(PA-2) | **확인 — 변경 없음.** `writing_kind`(AI-13 산출물 종류)도 `structured_draft` 안에만 두고 컬럼으로 만들지 않는다 |

### ux-planner → data-architect (`ux_requests.md` DM-1~DM-10)

| # | 요청 | 회신 |
|---|------|------|
| DM-1 | S-10 새 프로젝트 첫 저장 = 소속 + 머리 + STAR 한 번에 | **수용.** `save_project_page(p_project_id = null, p_values, p_expected_updated_at, p_applied_proposals)`. `p_values` 키 = `name`, `experience_id`/`education_id`(정확히 하나), `start_month`, `end_month`(`'YYYY-MM'`), `is_current`, `project_type`, `experience_type`, `competencies`(≤ 3), `situation`, `task`, `action`, `result`, `learnings`. 필수는 `name` + 소속. 반환 **`{ project_id, status, updated_at, applied, skipped }`**(UX의 `id` → `project_id`) |
| DM-2 | S-10 기존 프로젝트 = 머리 + STAR 한 요청, 상태 재계산, 소속 변경 포함 | **수용.** 같은 RPC(`p_project_id` 있음). 키가 없으면 기존 값 유지, null이면 비움. `status`·`content_updated_at`은 트리거. 소속 변경은 `experience_id`/`education_id`를 함께 보내 경력 ↔ 교육만, 둘 다 null이면 `project_scope_change_not_allowed`. 독립 프로젝트 대상은 `project_not_affiliated` |
| DM-3 | 반영 기록을 저장 요청과 함께, `apply_writing_chat_proposal` 재정의, 대화가 지워졌으면 그 기록만 건너뛰기 | **수용(폐기안).** 인자 이름 **`p_applied_proposals`**, S-10 원소 **`{writing_chat_id, field, rev}`**(UX `applied: [{writing_chat_id, fields: [...]}]`에서 바뀜 — 필드마다 `rev`가 필요해서 평평하게). 같은 트랜잭션에서 `structured_draft.*.applied_at`·`writing_chats.last_applied_at`·`projects.source_writing_chat_id`. 대화 삭제 → `skipped` `not_found`, 저장은 성공. `apply_writing_chat_proposal`은 이름을 남기지 않고 폐기(저장과 분리된 기록 경로가 없게). **사유 이름**: RPC가 돌려주는 값은 `not_found`·`already_applied`·`proposal_changed`·`needs_review`·`invalid_entry`·`mark_failed`. `empty`·`period_already_set`·`classification_already_set`는 **화면 채우기 판정 이름**으로 그대로 써도 된다(RPC는 돌려주지 않음) |
| DM-4 | 저장 전 페이지에서 첫 메시지 — 한 RPC로 묶을지 | **순차 호출 확정(한 RPC로 묶지 않음).** 화면 기대("프로젝트 생성 실패 = 아무것도 안 생김, 대화 시작 실패 = 프로젝트는 남음")가 순차 호출과 정확히 같다. 순서: 이름 확인 → AI 사용 가능 확인(키·동의 — 막히면 행도 안 만듦) → `save_project_page` → `start_writing_chat(p_project_id, p_return_target, p_form_snapshot)` → 턴. 임시 이름 없음(D-UX-25 (a) 그대로) |
| DM-5 | `writing_chats` 소속을 산출물까지 | **수용.** `writing_chats.project_deliverable_id`. 배타 CHECK가 아니라 **`project_id`(부모 독립 프로젝트)를 늘 채우고 산출물 열을 더한다**(대상 = 산출물 열이 있으면 산출물). RLS는 기존 그대로(본인 select/delete), 산출물 삭제 → 대화 cascade, 시작 RPC **`start_deliverable_writing_chat(p_project_deliverable_id, p_form_snapshot)`**, 정리 결과 `structured_draft.deliverable.body`(값 + 블록별 출처·`review` + `rev` + `applied_at`·`applied_mode`·`applied_rev`), `status` `active`/`closed`·`message_count` 40 공유(DM 2.5, 2.5.0) |
| DM-6 | 산출물 제목 + 본문 한 번에 만들기·고치기, 50개 상한, 첫 메시지 순서 | **수용.** `save_project_deliverable(p_project_deliverable_id, p_project_id, p_title, p_body, p_expected_updated_at, p_applied_proposals)`. 만들기 = id null + `p_project_id`, `sort_order` 맨 뒤, `deliverable_limit_reached`. 제목 공백 `deliverable_title_required`, 초과 `field_too_long`. 첫 메시지 순서는 DM-4와 같음(→ `start_deliverable_writing_chat`) |
| DM-7 | `get_deletion_impact`의 산출물 대화 집계 | **수용, 가정 확정.** `project_deliverable` 삭제 → `cascade.writing_chats` = 그 산출물의 대화 수. 독립 프로젝트 삭제 → `cascade.project_deliverables` + `cascade.writing_chats`(= 산출물 대화 수 — 독립 프로젝트의 대화는 모두 산출물 대화). 대화만 삭제의 반환은 그대로 `{ message_count, last_applied_at }` |
| DM-8 | 기대 버전 인자 + 거부 코드 | **수용.** 인자 **`p_expected_updated_at`**(페이지를 연 시점 또는 마지막 저장 응답의 `updated_at`), 다르면 **`stale_write`**(409, details `{current_updated_at}`), 아무것도 쓰지 않음. 덮어쓰기는 인자 null로 다시 보냄. `projects.updated_at`은 `source_writing_chat_id`만 바뀌면 오르지 않게 바꿨다 — 패널에서 대화를 지워도 열린 페이지가 `stale_write`가 되지 않는다 ★ |
| DM-9 | 새 프로젝트의 복귀 대상은 첫 대화 행 생성 때 `return_target`으로 | **확인.** `start_writing_chat(p_project_id, p_return_target, …)` 그대로. 산출물 대화는 `return_target` 항상 null(CHECK) |
| DM-10 | 산출물 분류 컬럼 없음 | **확인 — 변경 없음** |

### ai-feature-designer → data-architect (`ai_requests.md` DA-1~DA-17)

| # | 요청 | 회신 |
|---|------|------|
| DA-1 | `project_deliverable_id`, 복합 FK cascade, 산출물 대화의 `project_id` = 부모, 트리거 개정, 인덱스 | **수용(제안 그대로).** FK는 `(project_deliverable_id, project_id, user_id)` → `project_deliverables(id, project_id, user_id)` — 그래서 "산출물의 `project_id`와 같아야 함"을 트리거가 아니라 FK가 보장한다(`project_deliverables`에 `unique (id, project_id, user_id)` 추가 ★). 트리거 이름 `writing_chat_requires_affiliated_project` → **`writing_chats_check_target`**(거부 코드 `writing_chat_requires_affiliated_project`는 유지). 인덱스 `(project_deliverable_id, last_activity_at desc) where project_deliverable_id is not null` |
| DA-2 | `start_writing_chat(p_target jsonb, …)` — 산출물 대상 + "새 대상"이면 행까지 생성 | **부분 수용.** (1) 산출물 대상 = 별도 RPC **`start_deliverable_writing_chat(p_project_deliverable_id, p_form_snapshot)`**. (2) **"새 대상"(`new_project`·`new_project_deliverable`) kind는 거절** — 리더 정렬 2: 첫 메시지는 페이지 저장 RPC가 폼 전체로 행을 먼저 만들고, 시작 RPC는 있는 행에 대화만 붙인다. 50개 상한은 저장 RPC에서 걸린다. STAR 쪽은 `start_writing_chat(p_project_id, p_return_target, p_form_snapshot)`(기존 + 인사 분기용 스냅숏). AI 명세 AI-12·AI-13 "대상·시작점"의 행 생성 문장을 "페이지 저장으로 행 생성 → 시작 RPC"로 고쳐 달라 |
| DA-3 | S-10 페이지 저장 RPC | **수용, 인자 하나 추가.** **`save_project_page(p_project_id, p_values, p_expected_updated_at, p_applied_proposals)`** → `{ project_id, status, updated_at, applied: [{writing_chat_id, field}], skipped: [{writing_chat_id, field, reason}] }`. 반환 키 `project_status` → **`status`** |
| DA-4 | S-44 페이지 저장 RPC | **수용, 이름 정리.** **`save_project_deliverable(p_project_deliverable_id, p_project_id, p_title, p_body, p_expected_updated_at, p_applied_proposals)`**. 인자 `p_deliverable_id` → `p_project_deliverable_id`, `p_applied_proposal`(객체) → **`p_applied_proposals`**(배열, 원소 `{writing_chat_id, rev, mode}`) — 한 저장에서 여러 대화의 초안을 차례로 채울 수 있고, 두 RPC가 같은 처리 헬퍼를 쓴다. 반환 `{ project_deliverable_id, project_id, sort_order, updated_at, applied, skipped }` |
| DA-5 | `p_applied_proposals` 모양 | **수용.** `[{writing_chat_id, field, rev}]`, `field` 허용 값 v4.4 `p_fields`와 같음(`is_current` 없음). 최대 50개 `[가정]` |
| DA-6 | 저장 RPC의 `skipped.reason` | **수용 + 2개 추가.** `not_found`·`already_applied`·`proposal_changed`·`needs_review` + **`invalid_entry`**(원소 모양 오류 — 거부하지 않고 건너뜀) + **`mark_failed`**(그 밖의 예외). 판정 순서도 이 순서. `empty`·`period_already_set`·`classification_already_set`·`field_too_long`은 저장 RPC에서 빠진다. 값 검증은 일반 폼 검증이며 **코드 이름은 `field_too_long`**(제안 `value_too_long` 대신 — UX S-10·v4.4가 이미 쓰는 이름) |
| DA-7 | `apply_writing_chat_proposal` 폐기, 기록 부분만 내부 헬퍼 | **수용.** 헬퍼 이름 `mark_writing_chat_proposal_applied` → **`private.wc_mark_proposal_applied`**(구현된 `private.wc_proposal_mark_applied`와 같은 `wc_` 접두어, 외부 execute 없음) |
| DA-8 | 필드 객체 `rev` | **수용 + 규칙 보강.** `rev`는 **슬롯(필드 키) 단위 단조 증가** — 새 필드 객체로 바꿀 때도 이전 값 + 1(1로 되돌리지 않음. 되돌리면 저장 때 보낸 옛 `rev`가 새 객체와 같아질 수 있음). `value`가 바뀔 때만 +1, `review`만 바뀌는 수락은 그대로. `schema_version` 3 유지, `rev` 없는 기존 객체는 1 |
| DA-9 | V-9h 완화, 기간·분류의 "비어 있을 때만" DB 검사 | **수용(둘 다).** DB는 `set → append` 낮춤만 하고 거부하지 않는다. 기간·분류의 DB 빈 값 검사도 삭제(`classification_already_set` 거부 삭제 ★). 정본 판정은 서버 앱 계층(`form_snapshot`), 최종 안전장치는 화면 채우기 규칙. `project.is_current` 패치 거부와 값 검증은 유지 |
| DA-10 | 채운 뒤 들어온 패치 — `new_object`, 미반영 객체 여러 개의 저장 모양 | **`new_object` 수용, 여러 객체 모양은 거절.** `new_object: true`(`app_ai_writer` 패치만)면 슬롯을 새 객체로 **교체**하고 이전 객체는 버린다(`rev` + 1). 배열·`star_prev`는 두지 않는다 — 이전 객체 내용은 이미 폼에 있으므로 저장하면 그 반영 기록만 `proposal_changed`로 건너뛰고 저장은 성공한다(데이터 손실 없음). AI 명세의 "이전 객체는 저장 때 `rev`가 맞으면 반영됨"은 **"이전 객체는 버려지고, 저장 때 `proposal_changed`로 건너뜀"**으로 고쳐 달라 |
| DA-11 | 산출물 대화 `structured_draft` 모양 | **수용(제안 그대로).** DM 2.5.0. 상한 `[가정]`: 사실 ≤ 80개·각 ≤ 500자, `value` ≤ 8,000자, 블록 ≤ 200개. 초안 없으면 `deliverable = {}`. 대상과 모양이 어긋나는 패치는 `invalid_patch` |
| DA-12 | `writing_kind` 값, `structured_draft` 안에만 | **수용.** `planning_summary`/`design_doc`/`retrospective`/`presentation`/`other`, null 허용. 컬럼 없음(PA-2) |
| DA-13 | `project_deliverables.source_writing_chat_id` (선택) | **두지 않음.** 읽는 화면이 없고(반영됨은 `structured_draft`, 마지막 반영 시각은 `writing_chats.last_applied_at`), 두면 산출물 ↔ 대화 FK가 양방향이 되어 대화 삭제의 `set null`이 산출물 행을 update한다(기대 버전 판정이 흔들림). AI 명세 AI-13 "반영(폼 채우기) → 저장하기"의 `project_deliverables.source_writing_chat_id` 언급을 지워 달라 |
| DA-14 | 초안 6회 상한 | **수용.** `structured_draft.draft_count`(컬럼 아님), `apply_structured_draft_patch`가 6에서 **`writing_chat_draft_limit_reached`**(409), 서버도 턴 시작 전 검사. "블록이 하나도 안 남은 초안도 횟수는 셈"을 위해 초안 없이 횟수만 올리는 AI 패치를 받는다 |
| DA-15 | `form_snapshot` 저장 안 함, 길이 검사, API 경계에 | **수용.** DB 없음·로그 없음. 모양은 제안 그대로(S-10 `{name, start_month, end_month, is_current, project_type, experience_type, competencies, star: {…}}` / S-44 `{title, body}`). 길이·형식 위반은 턴 **`invalid_form_snapshot`**(400) `[가정]`. 7장 대화 턴 행에 요청 본문 `{content, requested_slot?, requested_action?, style?, form_snapshot}`으로 넣었다. 시작 RPC 두 개도 인사 분기용 `p_form_snapshot`을 받는다(저장 안 함) |
| DA-16 | 작업·미터 | **수용.** `ai_jobs.job_type = 'writing_chat_turn'`, `target_type = 'writing_chat'`, `progress.stage` `compose`·`validate`(jsonb 앱 상수, DB CHECK 없음), `ai_usage_records.feature = 'writing_chat'`(새 값 없음), `call_key` 예 `writing_chat.turn.7.compose` |
| DA-17 | 메시지 상한 | **확인.** 시작 인사 제외 40, 초안 턴 고정 문구 AI 메시지도 셈. 변경 없음 |

### 다른 팀원 앞 요청 중 데이터에 닿는 것 (참고 회신)

| 출처 # | 요청 (받는 사람) | 데이터 쪽 답 |
|--------|------------------|--------------|
| AI UX-3 | S-44 교체/덧붙이기, `replace_allowed`, `base_body_hash` (ux) | 두 값 모두 `structured_draft.deliverable.body`에 있다. 저장 때 `mode`만 보내면 된다 |
| AI UX-4 | 카드 상태 3단계 (ux) | ②는 화면 로컬, ③은 DB `applied_at`. `skipped` `proposal_changed`면 "새 제안이 있어요" |
| AI UX-5 | 채우기 판정은 화면 (ux) | 서버는 다시 판정하지 않는다. 저장 RPC의 값 검사(`field_too_long` 등)만 |
| AI UX-6, UX AI-5 | 턴마다 `form_snapshot` (ux·ai) | 리더 정렬 2로 확정. UX D-UX-26 "저장된 값만 + 안내 줄"은 폐기 — 고지 범위는 DM **D-DM-12** `[결정 필요]` |
| AI UX-7 | 이름·제목 비면 패널 막기, 첫 메시지 후 "저장 전 변경 있음" 유지(이름·제목만 저장) (ux) | **앞부분 수용, 뒷부분은 바뀜**: 리더 정렬 2로 첫 메시지는 폼 **전체**를 저장한다. 저장 직후에는 저장 전 변경이 없다 |
| AI UX-10 | `ready_to_return`은 저장하기 직후 (ux) | readiness 재판정 시점 = `save_project_page` 성공 뒤(DM 6장) |
| AI UX-12 | 카드에서 블록 직접 편집 없음 (ux) | 사용자 패치에 블록 문장 수정 경로를 두지 않았다([빼기]·수락만) |
| AI PP-4 | 초안 6회 NFR (product) | 데이터 표현은 `draft_count`(DM 2.9.4) |
| AI PP-5 | 미터 `writing_chat` 합산 (product) | 그대로(새 `feature` 값 없음) |
| PRD → UX 2 | 저장 조건 = 이름·제목 | DB 필수 조건과 같다(`project_name_required`, `deliverable_title_required`) |
| PRD → UX 4, PRD → AI 3 | 첫 AI 메시지 경로·기본 이름 | 리더 정렬 1·2: 기본 이름 없음, 폼 전체 첫 저장 → 대화 시작 → 턴 |
| PRD → UX 9 | 산출물 삭제 확인에 대화 수 | `get_deletion_impact('project_deliverable', …).cascade.writing_chats` |
| PRD → AI 4 | 메시지 상한·대화 여러 개·미터 합산 | 모두 같다(DA-16·DA-17) |
| UX AI-6 | 다음 턴 `draft_patch`가 "폼에 채움" 섹션을 덮어써도 되는가 (ai) | DB 쪽은 `new_object`로 새 객체 교체(DA-10). 화면은 새 `rev`를 받으면 카드를 ①로 그린다 |
| UX AI-7 | 행 없는 새 페이지의 시작 인사·칩 (ai) | DB 조회 경로 없음(행이 없으므로). 화면 상수 또는 서버 상수 응답 — AI 명세 몫. 대화가 생길 때 시작 RPC가 같은 문구를 저장한다 |

## 이름이 바뀐 항목

> 요청 문서·개정 문서에 쓴 이름 중 확정과 다른 것. 각 담당이 자기 문서를 고쳐 달라.

| 담당 문서 | 기존 이름 (쓴 곳) | 확정 이름 | 이유 |
|-----------|-------------------|-----------|------|
| AI v4.6 (AI-12·AI-13), ai_requests DA-2 | `start_writing_chat(p_target jsonb, p_return_target)`, `p_target.kind` = `project`/`new_project`/`project_deliverable`/`new_project_deliverable` | STAR: **`start_writing_chat(p_project_id, p_return_target, p_form_snapshot)`** / 산출물: **`start_deliverable_writing_chat(p_project_deliverable_id, p_form_snapshot)`**. "새 대상" kind 없음 | 리더 정렬 2 — 행은 페이지 저장이 먼저 만든다 |
| AI v4.6, ai_requests DA-3 | `save_project_page(p_project_id, p_values, p_applied_proposals)` | **`save_project_page(p_project_id, p_values, p_expected_updated_at, p_applied_proposals)`** | 기대 버전 인자(UX DM-8) |
| AI v4.6, ai_requests DA-3 | 반환 `project_status` | **`status`** | 컬럼명 그대로 |
| AI v4.6 (AI-13), ai_requests DA-4 | `save_project_deliverable(p_deliverable_id, p_project_id, p_title, p_body, p_applied_proposal)` | **`save_project_deliverable(p_project_deliverable_id, p_project_id, p_title, p_body, p_expected_updated_at, p_applied_proposals)`** | 인자는 컬럼명, 기대 버전 |
| AI v4.6 (AI-13), ai_requests DA-4 | `p_applied_proposal = {writing_chat_id, rev, mode}` (객체) | **`p_applied_proposals = [{writing_chat_id, rev, mode}]`** (배열) | 두 RPC 같은 모양·같은 헬퍼 |
| AI v4.6 (AI-12), ai_requests DA-7 | `mark_writing_chat_proposal_applied(p_writing_chat_id, p_field, p_rev, p_mode)` | **`private.wc_mark_proposal_applied`** (내부) | 구현 헬퍼 접두어 |
| ai_requests DA-6 | 값 검증 코드 `value_too_long` | **`field_too_long`** | v4.4·UX S-10이 쓰는 이름 |
| ai_requests DA-1 | 트리거 `writing_chat_requires_affiliated_project` 개정 | 트리거 **`writing_chats_check_target`** (거부 코드 `writing_chat_requires_affiliated_project`는 그대로) | 대상이 둘이 되어 트리거 뜻이 넓어짐 |
| AI v4.6 (AI-13 저장), ai_requests DA-13 | `project_deliverables.source_writing_chat_id` | **없음**(두지 않음) | DA-13 회신 |
| AI v4.6 (AI-12 "채운 뒤 들어온 AI 패치") | "이전 객체는 저장 때 `rev`가 맞으면 반영됨" | 이전 객체는 **버려지고** 저장 때 `skipped` **`proposal_changed`** | DA-10 회신 |
| ux_requests DM-1 | 저장 반환 `id` | **`project_id`** | 산출물 반환(`project_deliverable_id`)과 구분 |
| ux_requests DM-3, UX v5.6 S-10·S-44 | 저장 요청 `applied: [{writing_chat_id, fields: [...]}]` (S-44 `deliverable.body` + 방식) | **`p_applied_proposals`**: S-10 `[{writing_chat_id, field, rev}]`, S-44 `[{writing_chat_id, rev, mode}]` | 필드마다 `rev`(채운 시점의 판 번호)를 보내야 `proposal_changed`를 판정한다 — 화면은 [반영] 때 `rev`를 기억해야 한다 |
| ux_requests DM-3, UX v5.6 S-10 "건너뛴 사유 안내" | 저장 RPC `skipped[].reason` = `needs_review`·`already_applied`·`empty`·`period_already_set`·`classification_already_set` | 저장 RPC: **`not_found`·`already_applied`·`proposal_changed`·`needs_review`·`invalid_entry`·`mark_failed`**. `empty`·`period_already_set`·`classification_already_set`는 **화면 채우기 판정 이름**(이름은 그대로 써도 됨) | 채우기 판정이 화면으로 옮겼다 |
| UX v5.6 (S-10 제안 카드) | `field_already_applied` "폼에 채움 상태 포함" | DB `field_already_applied`는 **`applied_at`이 있을 때(저장 뒤)만**. "폼에 채움" 상태의 수정 막기는 화면 규칙 | DB는 폼 채우기를 모른다 |
| UX v5.6 (D-UX-26, S-10·S-44 "저장 안 한 수정 안내") | AI는 저장된 값만 읽음 + 입력창 위 안내 줄 | 턴마다 **`form_snapshot`**, 안내 줄 없음 | 리더 정렬 2 |
| UX v5.6, ux_requests DM-4 | 대화 시작 `start_writing_chat(p_project_id, p_return_target)` | **`start_writing_chat(p_project_id, p_return_target, p_form_snapshot)`** (+ S-44 **`start_deliverable_writing_chat`**) | 인사 분기용 스냅숏 |
| PRD v4.6 9.5 `[가정]` 2, prd_requests UX 4·DA 3 | 이름(제목)이 비면 기본 이름으로 작성 중 행 생성 | **기본 이름 없음** — 비면 보내지 않음 | 리더 정렬 1 |
| PRD v4.6 (F-P1-13 (6)(12) 등) | `apply_writing_chat_proposal` 언급이 남아 있으면 | **폐기** — "저장하기"(`save_project_page`/`save_project_deliverable`) | DA-7 |

## 결정 필요 (데이터 모델 쪽에서 올림)

- **D-DM-12** `[결정 필요]`: 저장하지 않은 폼 값(`form_snapshot`)을 공급자로 보내는 것을 지금 고지·동의 범위로 볼까. (a) 지금 범위 + 다음 고지 버전에 "작성 중인 내용 포함" 한 구절(재동의 없음) **권고** / (b) 새 고지 + 재동의 / (c) 스냅숏을 보내지 않음(리더 정렬 2 되돌림). 저장 모델은 어느 쪽이든 같다. product-planner·법무(D-39) 확인 요청.

## 백엔드 후속 (★, DM 11.3 요약)

`project_deliverables` `unique (id, project_id, user_id)` / `writing_chats.project_deliverable_id`·CHECK·인덱스·`writing_chats_check_target`·대상 열 불변 / `start_writing_chat` `p_form_snapshot`, `start_deliverable_writing_chat` 신설, 산출물 시작 인사 / `apply_structured_draft_patch`: `rev`·`new_object`·V-9h 낮춤·분류/기간 DB 거부 삭제·산출물 모양·`draft_count` / **`apply_writing_chat_proposal` 삭제**, 헬퍼 `private.wc_mark_proposal_applied` / **`save_project_page`·`save_project_deliverable` 신설** / `projects.updated_at` 트리거(`source_writing_chat_id`만 바뀌면 유지) / `get_deletion_impact` 산출물 대화 집계 / 턴 라우트 `form_snapshot`·AI-13 파이프라인 / pgTAP·타입 재생성.
