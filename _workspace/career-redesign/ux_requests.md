# ux-planner 요청 — 커리어 화면 재설계 (CR-1~CR-14, 2026-11-02)

기준: `docs/planning/02-user-flows.md` **v5.5**. 화면이 쓰는 이름 중 아직 정해지지 않은 것은 문서에 `[가정]`으로 적었다. 정해지면 ux-planner가 화면 명세를 맞춘다.

## 다른 팀원에게 요청

### data-architect

화면이 읽고 쓰는 필드. 이름이 다르면 알려 주세요(화면 쪽을 고침).

| # | 화면 | 필요한 것 | 화면이 쓴 이름 `[가정]` | 메모 |
|---|------|-----------|--------------------------|------|
| D-1 | S-10 STAR | STAR 1개의 위치(CR-2): `projects`에 합침(권고) 또는 1:1 `project_details` | `situation`·`task`·`action`·`result`·`learnings` 그대로 | 제목(`title`)·`sort_order` 없음. 각 2,000자, 마크다운 텍스트 |
| D-2 | S-10 머리, C-25 카드 | 분류 3종(CR-9). 종류·경험 유형 단일, 역량 복수 최대 3 | `projects.project_type`, `projects.experience_type`, `projects.competencies`(text[]) | 값 목록은 PRD F-P1-19. 영문 키를 정해 주세요. 독립 프로젝트에는 쓰지 않음 |
| D-3 | S-43 프로젝트 정보 | Link URL 1개(CR-7) | `projects.link_url` | `http(s)://`만 |
| D-4 | S-43 프로젝트 내용 | 긴 본문(마크다운, CR-7). 기존 `summary`(≤200자)와 관계 | `projects.description`(≤5,000자) | `summary`를 없앨지(경력·교육 안 프로젝트에도 없음, PRD F-P1-03 (5)) |
| D-5 | S-43 담당 업무 | 독립 프로젝트의 담당 업무 | `projects.role` 재사용 | 경력·교육 안 프로젝트에서는 `role` 미사용(CR-10). complete 조건에서 빼 주세요 |
| D-6 | S-43 산출물, S-44 | 산출물 테이블(CR-8): 독립 프로젝트 아래 여러 개, 제목 + 마크다운 본문 | `project_deliverables`(`project_id`, `title` ≤100자, `body` ≤20,000자, `sort_order`, `created_at`, `updated_at`) | 독립 프로젝트에만 달 수 있게(CHECK 또는 트리거). 삭제 영향 `entity_type = 'deliverable'`, `cascade.deliverables`. 근거 종류 값·`source_locator` |
| D-7 | C-05 | `get_deletion_impact`·`delete_career_item`의 `entity_type`에서 `project_detail`·`achievement` 제거, `deliverable` 추가. 경력·교육 삭제의 `affiliation_mode`는 화면 잠정안이 `delete_projects`만(D-UX-22 `[결정 필요]`) | — | 사용자 답에 따라 `keep_projects` 유지 여부 결정 |
| D-8 | S-10 AI 패널 | 대화는 항상 프로젝트에 묶임(CR-6): `writing_chats.project_id` not null, `mode`는 하나(또는 컬럼 삭제), `experience_id`·`education_id`·`affiliation_suggestion` 삭제 | `writing_chats.title`(목록 제목, 없으면 화면이 첫 메시지로 만듦) | 프로젝트당 여러 개(인덱스 `(project_id, last_activity_at desc)`) |
| D-9 | S-10 AI 패널 | 대화 상태 정리: `saved`·`handed_off`·`abandoned`·재개 전이 삭제. 화면은 `active`와 상한 도달 `closed`(열람·반영만)만 구분 | `writing_chats.status` ∈ `active` / `closed` | 90일 자동 정리 대상 없음(U-9 일부 대체). `save_writing_chat`·`hand_off_writing_chat`·`set_writing_chat_affiliation` 폐기 |
| D-10 | S-10 제안 카드 | 섹션별 반영 RPC(사용자 세션 동기 쓰기, AI 호출 없음): 빈 섹션은 쓰기, 있는 섹션은 뒤에 덧붙임, 반영한 필드를 정리 결과에 "반영됨"으로 표시 | 예: `apply_writing_chat_proposal(writing_chat_id, fields text[])` | `needs_review` 미수락 필드는 거부. 섹션 편집 중 충돌은 화면이 막음. 반영 후 `projects.status` 재계산 |
| D-11 | S-10 제안 카드, C-15 | 정리 결과의 STAR 필드 객체(`value`, `origin`, `source_message_ids`, `source_quotes`, `review`, `reviewed_at`) 재사용 + 반영 여부 | `structured_draft.fields.{star}` + `applied_at` | 반영 뒤 섹션에 출처를 남기지 않음(MVP). 필드 단위 출처가 필요하면 알려 주세요 |
| D-12 | C-09, FL-13 | `get_data_readiness`: hint `complete_project_detail` → STAR 미완 프로젝트 의미로(이름 변경 권고 `project_star`), `counts.projects_without_complete_detail` 이름 정리, `next_action` 새 값 `create_project`(AI 명세 제안), `project_fields`는 이름만 | — | 독립 프로젝트를 `complete_project`에 셀지 결정 |
| D-13 | 완료 판정 | 경력·교육 안 프로젝트 = 이름 + 상황 + 행동, 독립 = 이름 + 프로젝트 내용, 산출물 = 제목 + 본문(PRD F-P1-03 (6)·F-P1-15 (3)·F-P1-17 (4)) | — | 화면은 완료 표시를 하지 않음(CR-11) |
| D-14 | S-08 목록 | 경력·교육·독립 프로젝트를 한 번에 읽는 목록(시작 연도 1회, CR-4). 2.4의 "모든 연도 반복"·"기타 프로젝트" 규칙 삭제 | `career_list` 응답: `entity_type`, `id`, `name`, `start_month` | 앱 계산이면 문서만 고쳐 주세요 |
| D-15 | C-25 기간 | 프로젝트 진행 중 표시가 없어 `end_month` null이면 "YYYY.MM -"만 보임. 진행 중이 필요하면 `projects.is_current` | — | 필요 여부 회신만 |
| D-16 | C-01, C-11 | 근거 종류 `project_detail` → `project`(필드 단위 `source_field` 유지)로 합칠지, `draft_section_sources.project_detail_ids` 삭제, 산출물 근거 종류 추가 | — | 칩 라벨: "프로젝트 · 행동", "산출물 › {제목}" |
| D-17 | 폐기 | `achievements` 테이블, `project_details` 다건 구조, `projects.team_size`·`summary`(경력·교육 안), `project_skills`의 경력·교육 프로젝트 연결 | — | `skills`는 독립 프로젝트 사용 기술 자동완성 사전으로만 씀(S-12 보류) |

### ai-feature-designer

`ai_requests.md`의 ux-planner 항목은 대부분 v5.5에 반영했다(대화당 제안 카드 1개, 덧붙임 규칙, SSE 이벤트 순서, 상한 도달 `closed`, 새 대화는 STAR만 읽음, `create_project`, 산출물 칩, 독립 프로젝트 패널 없음). 확인할 것:

| # | 화면 | 요청 |
|---|------|------|
| A-1 | S-10 빠른 버튼 칩 | 화면 예시 문구(상태 3종 × 3개)를 AI-12 표와 맞춰 확정해 주세요. 화면은 `message_count` ≥ 36이면 칩을 숨긴다 `[가정]` — 문제 있으면 알려 주세요 |
| A-2 | S-10 STAR "AI에게 물어보기" | 빈 섹션 옆 버튼 → 패널이 닫혀 있으면 열고, 고정 문구 메시지 + `requested_slot = {섹션}`을 보낸다(권고대로 둠). 고정 문구 초안 필요 |
| A-3 | 제안 → STAR 매핑 | 제안 카드 섹션 = `situation` 상황 / `task` 역할 / `action` 행동 / `result` 결과·성과 / `learnings` 배운 점. 분류 3종·이름·기간은 제안하지 않음(화면 규칙). 덧붙일 문장만 강조하려면 `draft_patch`에 "기존 값과 다른 부분"이 구분돼 와야 함 — 형식 확인 |
| A-4 | 반영 뒤 제안 | 반영한 섹션은 "반영됨". 이후 턴에서 같은 섹션에 새 문장이 정리되면 그 부분만 다시 반영 대상 `[가정]`. 파이프라인이 반영된 값을 "현재 STAR"로 다시 읽어 중복 제안을 피하는지 확인 |
| A-5 | 시작 인사 4종 | 최종 문구는 ux가 다듬는다. 초안 위치(AI-12)와 무료 등급 문장(D-10)을 알려 주세요 |
| A-6 | 게이트 진입 | `ready_to_return`이 오면 패널 입력창 위와 C-10 배너에 "{기능}으로 돌아가기"를 강조(자동 실행 없음) |
| A-7 | 산출물 근거 | 칩 "산출물 › {제목}", S-44에서 `source_locator` 구간 강조. 구간 단위(문단/문자 범위)를 정해 주세요 |
| A-8 | 경력·교육 안 프로젝트의 기술 정보 | CR-10으로 사용 기술이 빠짐(PRD Q-CR-2). 인사이트 기술 요건 판정에서 STAR 서술만으로 충분한지 평가 세트 결과 공유 |

### product-planner

| # | 요청 |
|---|------|
| P-1 | PRD F-P1-05 "전체 스킬 목록"의 위치: UX는 S-12를 `[보류]`(진입점 없음)로 두었다. MVP에 목록 화면이 꼭 필요하면 위치를 정해 주세요(후보: 계정 메뉴 "내 스킬" `[가정]`) |
| P-2 | 프로젝트 기간 "진행 중": PRD F-P1-03 (3) "진행 중이면 이번 달까지"는 프로젝트에 진행 중 표시가 없어 화면이 판단할 수 없다. UX는 종료월이 비면 "YYYY.MM -"(개월 수 없음)로 둠. 진행 중 표시를 추가할지 |
| P-3 | 경력·교육 시작월: 화면은 경력·교육을 처음 저장할 때 시작월을 요구한다(PRD F-P1-09 (3)과 맞춤, `draft` 저장과 충돌하지 않게 시작월만 필수) `[가정]`. 이의 있으면 알려 주세요 |
| P-4 | Q-CR-4 답: 배지 대신 S-10에 "상황·행동이 비어 있는 동안만" 보이는 도움말 한 줄, S-43은 "프로젝트 내용이 빈 동안만"(v5.5 S-10 "AI 근거 도움말") |

## 사용자에게 열린 질문

| ID | 질문 | 선택지 | 권고 |
|----|------|--------|------|
| Q-UX-1 (D-UX-22) | 경력·교육을 지우면 그 아래 프로젝트를 어떻게 할까요? | (a) 함께 삭제만 (b) 독립 프로젝트로 남기기(STAR·AI 대화는 화면에서 안 보임) (c) 남기되 STAR를 "프로젝트 내용"으로 합침 | **(a)**. 삭제 확인에 프로젝트 수와 "STAR·AI 대화가 함께 삭제돼요"를 보인다. 데이터가 지워지는 쪽이라 확인 필요 |
| Q-UX-2 (D-UX-20) | 메뉴가 "자기소개서 관리"가 된 뒤 화면 안 "기업 JD"(기업 JD 추가·목록) 용어를 그대로 둘까요? | (a) 유지 (b) 함께 바꿈 | **(a)**. CR-12가 이름만 바꾸기로 했고, 메뉴는 할 일·개체는 저장 단위라 달라도 혼동이 적다 |
| Q-UX-3 | 왼쪽 메뉴 아래 "AI 연결 상태 한 줄"(피그마에 없음)을 계정 블록 위에 남길까요? | (a) 남김 (b) 계정 메뉴 안으로 | **(a)**. AI 기능이 잠긴 이유를 한눈에 알 수 있다 |
| Q-UX-4 | 전체 스킬 목록 화면(S-12)을 MVP에서 뺄까요? | (a) 보류 (b) 계정 메뉴에 둠 | **(a)**. 피그마에 진입점이 없고 스킬은 독립 프로젝트 태그로만 생긴다 |
| Q-UX-5 | 섹션 수정 방식(인라인 + 저장/취소, D-UX-19)과 프로젝트당 여러 대화의 제안 카드 반영 방식(D-UX-21)으로 진행해도 될까요? | — | 진행. 피그마 섹션별 "수정"과 UX-4(사용자 확정)를 지킨다 |
