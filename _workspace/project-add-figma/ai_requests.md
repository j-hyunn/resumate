# 프로젝트 추가·산출물 상세 (PA-1~PA-4) — AI 기능 설계 쪽 요청

> 작성: ai-feature-designer / 2026-11-03 / 기준: `00_input/planning-decisions-project-add-figma.md`(확정 2026-11-03 (사용자)), `docs/planning/03-ai-features.md` **v4.6**(AI-12 PA-3 개정, AI-13 신설)
> 이 파일의 이름은 모두 AI 명세 v4.6이 쓰는 **`[가정]` 이름**이다. 받는 쪽이 이름을 정하면 AI 명세를 그 이름으로 맞춘다. PA-2(산출물 분류 없음)·PA-4(머리 필드 표시)는 AI 쪽 요청이 없다.

## 다른 팀원에게 요청

### data-architect

| # | 대상 | 요청 내용 | 제안 이름 `[가정]` | 근거 (AI 명세) |
|---|------|-----------|--------------------|----------------|
| DA-1 | `writing_chats` 소속 확장 (PA-1) | 산출물에 묶인 대화를 허용한다. `project_deliverable_id uuid null`, 복합 FK → `project_deliverables(id, user_id) on delete cascade`. 산출물 대화는 `project_id` = 부모 독립 프로젝트(목록·연쇄 삭제용). 트리거 `writing_chat_requires_affiliated_project`를 "`project_deliverable_id`가 null이면 소속 프로젝트, 아니면 산출물의 `project_id`와 같아야 함"으로 바꾼다. 인덱스 `(project_deliverable_id, last_activity_at desc)` | `writing_chats.project_deliverable_id` | AI-13 대상·시작점 |
| DA-2 | `start_writing_chat` 확장 (PA-1·PA-3) | (1) 산출물 대상 대화 시작 (2) **첫 AI 메시지 때 draft 행 생성**: "새 대상"을 받으면 행(프로젝트 = 이름 + 소속 / 산출물 = 부모 + 제목, 본문 `''`) + 대화 + 시작 인사를 한 트랜잭션으로 만들고 id들을 돌려준다. 이름·제목이 비면 거부. 산출물 50개 상한(`deliverable_limit_reached`) 적용 | `start_writing_chat(p_target jsonb, p_return_target jsonb default null)` — `p_target` = `{kind: 'project', project_id}` / `{kind: 'new_project', name, experience_id \| education_id}` / `{kind: 'project_deliverable', project_deliverable_id}` / `{kind: 'new_project_deliverable', project_id, title}` | AI-12 대상·시작점, AI-13 행 생성 |
| DA-3 | 페이지 저장 RPC — S-10 (PA-3) | 페이지 단위 "저장하기" 한 번에 머리 + STAR를 저장하고, **같은 트랜잭션에서** 폼에 채운 제안을 "반영됨"으로 기록한다. 반영됨 기록 실패는 저장을 막지 않는다(`skipped`로 반환). 신규(행 없음)도 받는다(첫 저장 = 행 생성) | `save_project_page(p_project_id uuid null, p_values jsonb, p_applied_proposals jsonb default null)` → `{ project_id, project_status, applied: [{writing_chat_id, field}], skipped: [{writing_chat_id, field, reason}] }` | AI-12 "반영(폼 채우기) → 저장하기" |
| DA-4 | 페이지 저장 RPC — S-44 (PA-3) | 산출물 제목·본문 저장 + 반영됨 기록(`applied_mode`). 신규는 `p_deliverable_id` null + `p_project_id` | `save_project_deliverable(p_deliverable_id uuid null, p_project_id uuid, p_title text, p_body text, p_applied_proposal jsonb default null)`, `p_applied_proposal = {writing_chat_id, rev, mode: 'replace' \| 'append'}` | AI-13 "반영 → 저장하기" |
| DA-5 | `p_applied_proposals` 모양 | `[{writing_chat_id, field, rev}]` — `field`는 v4.4 `p_fields` 허용 값과 같음(`situation`…`learnings`, `start_month`, `end_month`, `project_type`, `experience_type`, `competencies`) | 같음 | AI-12 |
| DA-6 | `skipped.reason` 값 | 저장 RPC에서는 `already_applied`, `proposal_changed`(`rev` 불일치), `needs_review`, `not_found`만 쓴다. v4.4의 `empty`·`period_already_set`·`classification_already_set`·`field_too_long`은 판정이 화면의 채우기 단계로 옮겨 저장 RPC에서 빠진다(값 검증은 일반 폼 검증 `value_too_long` 등) | 같음 | AI-12 |
| DA-7 | `apply_writing_chat_proposal` 처리 | S-10·S-44 반영이 DB에 쓰지 않으므로 **DB 쓰기 역할 폐기**. 반영됨 기록 부분만 내부 헬퍼로(외부 execute 없음) | `mark_writing_chat_proposal_applied(p_writing_chat_id, p_field, p_rev, p_mode default null)` (내부) | AI-12 |
| DA-8 | 필드 객체 `rev` | `structured_draft`의 모든 필드 객체(AI-12 `project.*`·`star.*`·`classification.*`, AI-13 `deliverable.body`)에 정수 `rev`(1부터). `apply_structured_draft_patch`가 그 객체의 `value`를 바꿀 때마다 +1(AI 패치·사용자 수정 모두) | `rev` | AI-12, AI-13 |
| DA-9 | `apply_structured_draft_patch` V-9h 완화 | 저장 전 폼 편집을 DB가 모르므로 DB 기준 V-9h는 "DB에 값이 있으면 `set` → `append`로 낮춤"만 하고 거부하지 않는다. 판정은 서버 앱 계층이 `form_snapshot` 기준으로 한다. 기간·분류의 "비어 있을 때만" DB 검사도 같은 이유로 거부 대신 통과시키고 채우기 단계(화면)에 맡길지 판단 요청 | — | AI-12 V-9h |
| DA-10 | 채운 뒤 들어온 패치 | 미반영 필드 객체의 `value`가 이번 턴 스냅숏의 같은 필드에 (정규화 부분 문자열로) 이미 있으면 새 패치를 **새 필드 객체**로 만든다(서버 앱 계층이 `patch`에 `new_object: true`를 달아 넘김). 같은 필드에 미반영 객체가 여러 개 생기는 저장 모양(배열 또는 `star.{field}` + `star_prev.{field}`) 결정 요청 | `new_object` | AI-12 "채운 뒤 들어온 AI 패치" |
| DA-11 | 산출물 대화 `structured_draft` 모양 (AI-13) | `schema_version 1`, `target = 'project_deliverable'`, `writing_kind`, `facts[]`(`id`, `slot`, `text`, `actor`, `source_message_ids`, `source_quotes`, `review`, `reviewed_at`, `origin`), `deliverable.body`(`value`, `blocks[]`, `rev`, `generated_at`, `base_body_hash`, `replace_allowed`, `missing_slots`, `dropped_block_count`, `applied_at`, `applied_mode`, `applied_rev`), `clarifications[]`, `sensitive_flags_count`, `draft_count`. AI-12 모양(`schema_version 3`)과 `target`으로 구분 | 같음 | AI-13 "저장" |
| DA-12 | `writing_kind` 값 | `planning_summary` / `design_doc` / `retrospective` / `presentation` / `other` — **`structured_draft` 안에만**. `project_deliverables`에는 컬럼을 두지 않는다(PA-2) | 같음 | AI-13 |
| DA-13 | `project_deliverables.source_writing_chat_id` (선택) | `projects.source_writing_chat_id`와 같은 뜻("마지막으로 반영한 대화", `on delete set null`). 두지 않아도 AI 동작에는 지장 없음 — DM 판단 | `project_deliverables.source_writing_chat_id` | AI-13 |
| DA-14 | 초안 생성 횟수 상한 | 대화당 6회 — `draft_count`(structured_draft) 또는 컬럼. 서버가 초안 턴 시작 전에 검사, 닿으면 `writing_chat_draft_limit_reached` | `draft_count`, 오류 `writing_chat_draft_limit_reached` | AI-13, 7.4 |
| DA-15 | `form_snapshot` | 턴 요청(SSE 시작 요청) 본문의 일시 입력이다. **DB에 저장하지 않는다.** 길이 검사는 DB 상한과 같음(STAR 필드 ≤ 2,000자, 제목 ≤ 100자, 본문 ≤ 20,000자). 계약 문서(API 경계)에 넣어 달라는 요청 | S-10: `{name, start_month, end_month, is_current, project_type, experience_type, competencies, star: {situation, task, action, result, learnings}}` / S-44: `{title, body}` | AI-12·AI-13 입력 컨텍스트 |
| DA-16 | 작업·미터 | AI-13 턴도 `ai_jobs.job_type = 'writing_chat_turn'`, `progress.stage`에 `compose`·`validate` 추가, 미터 `feature = 'writing_chat'`, `call_key` 예 `writing_chat.turn.7.compose` | 같음 | C-6, C-13 |
| DA-17 | 메시지 상한 | AI-13도 A5 그대로(시작 인사 제외 40, `message_count`). 초안 턴의 고정 문구 AI 메시지도 센다 | — | AI-13 |

### ux-planner

| # | 화면 | 요청 내용 | 제안 `[가정]` | 근거 |
|---|------|-----------|---------------|------|
| UX-1 | S-44 재정의 (PA-1) | 오른쪽 Resumate AI 패널(S-10과 같은 셸): 대화 기록 / + 새 대화 / 메시지 / 제안 카드 / 칩 3개 / 입력창. 응답 모드 = **스트리밍 대화 턴**(질문 턴: `reply_delta`, 초안 턴: `draft_started` → `draft_block` → `draft_done`) | — | AI-13 응답 모드 |
| UX-2 | S-44 초안 제안 카드 | 초안 미리보기(마크다운 렌더링), 블록별 출처 칩("이 말에서 정리했어요" → 해당 발화로 / "지금 본문에서" / "프로젝트 내용에서"), `needs_review` 블록 강조 + [빼기]/[수락], "아직 비어 있는 부분: …"(`missing_slots`), "확인되지 않은 문장 N개는 뺐어요"(`dropped_block_count`), 초안 남은 횟수 | — | AI-13 |
| UX-3 | S-44 반영 방식 | 본문이 비면 [본문에 넣기] 하나. 본문이 있으면 [교체] / [뒤에 덧붙이기] — 덧붙이기는 `basis = new` 블록만 붙음(미리보기에서 붙을 부분 강조), `replace_allowed = false`(본문 6,000자 초과)면 교체 숨김·안내, `new` 블록이 없으면 덧붙이기 비활성. 교체 전 확인 "지금 본문을 초안으로 바꿀까요? 저장하기 전까지는 되돌릴 수 있어요" + 채운 뒤 **[되돌리기]**. 초안 뒤 본문이 바뀌었으면(`base_body_hash`) 교체 경고. 덧붙인 결과 20,000자 초과면 막기 | 문구 최종은 ux | AI-13 "교체와 덧붙이기" |
| UX-4 | S-10·S-44 카드 상태 (PA-3) | ① 제안 ② **"폼에 채움 — 저장하면 반영돼요"**(로컬 상태) ③ **"반영됨"**(저장 성공 후). ②에서 떠나면(이탈 확인 "나가기") 다시 열 때 ①로 보임. 저장 결과 `skipped`(`proposal_changed` 등)가 있으면 카드에 "새 제안이 있어요" 등 표시 | — | AI-12 "카드 상태 3단계" |
| UX-5 | 채우기 규칙의 화면 판정 (PA-3) | [반영] 때 화면이 판정: STAR 필드는 폼 값이 있으면 "현재 값 + 줄바꿈 + 제안"으로 덧붙임, 합친 값 2,000자 초과 필드는 채우지 않고 "글자 수가 넘어요 — 직접 줄인 뒤 다시 반영해 주세요", 기간은 빈 칸만(`is_current`면 종료월 건너뜀), 분류는 빈 값만("이미 고른 값이 있어요"). 다른 필드는 채움 | — | AI-12, C-14 |
| UX-6 | 턴 요청에 `form_snapshot` 포함 (PA-3) | S-10·S-44는 메시지를 보낼 때마다 폼의 저장 전 현재 값을 함께 보낸다(DA-15 모양). 저장하기와 무관 | `form_snapshot` | AI-12·AI-13 입력 컨텍스트 |
| UX-7 | 첫 AI 메시지 = 행 생성 (PA-3) | 새 페이지(행 없음)에서 **이름(S-10) / 제목(S-44)이 비어 있으면 패널 입력창·칩을 막고** "프로젝트명을 먼저 입력해 주세요" / "산출물 제목을 먼저 입력해 주세요". 첫 메시지 때 행 + 대화가 생긴 뒤 URL을 새 id로 바꾸고, 페이지는 "저장 전 변경 있음" 상태를 유지(이름·제목만 저장됨) | 대안: 이름 없으면 "제목 없는 프로젝트"로 만들기 — 비권장(목록에 빈 이름 행이 생김) | AI-12·AI-13 행 생성 |
| UX-8 | S-44 시작 인사·칩 | 시작 인사 3종(본문 비고 종류 모름 / 제목으로 종류 짐작 / 본문 있음) + 공통 민감정보 안내 줄. 칩 3개 상태표(초안 불가 / 초안 가능 / 초안 있음), 초안 6회 도달 시 칩 교체, 상한 근처 숨김 규칙 | 문구 최종은 ux | AI-13 시작 인사·칩 |
| UX-9 | S-44 진행 표시 | 초안 턴 `progress.stage = compose`: 제안 카드 자리에 "초안 작성 중" + 블록이 도착하는 대로 채움. 초안 실패 시 이전 초안 유지 + 다시 시도 | 단계 문구는 UX C-03 | C-6, AI-13 |
| UX-10 | S-10 게이트 복귀 시점 (PA-3) | `ready_to_return`·"돌아가기"는 [반영] 직후가 아니라 **저장하기 직후** 준비도 재판정 뒤에 보인다 | — | AI-12 게이트 진입 |
| UX-11 | S-43 | 패널 없음 유지(D-AI-16 `[결정 필요]`, 권고 유지). 결정이 (b)로 나면 별도 요청 | — | 8장 D-AI-16 |
| UX-12 | S-44 블록 직접 편집 | 카드에서는 블록 문장 직접 고치기를 두지 않는다(반영 후 본문 폼에서 고침). [빼기]·[수락]만 | 확인 요청 | AI-13 저장 |

### product-planner

| # | 대상 | 요청 내용 | 제안 `[가정]` | 근거 |
|---|------|-----------|---------------|------|
| PP-1 | PRD 기능 ID | 산출물 AI 작성 대화(AI-13)의 기능 ID와 우선순위. F-P1-18 하위 항목 또는 새 ID(예: F-P1-20). AI 명세는 Must `[가정]`로 적었다(PA-1이 MVP 결정이라 봄) | F-P1-20 "산출물 AI 작성 대화" Must | AI-13, 0.2 |
| PP-2 | D-AI-15 / CR-19 변경 기록 | PA-1로 산출물 부분만 뒤집힘을 PRD 결정 기록(D-AI-15 대응 항목)에 반영 | — | 8장 |
| PP-3 | D-AI-16 `[결정 필요]` 상정 | 독립 프로젝트 정보·내용(S-43)에도 AI 대화를 둘지 — 권고 (a) MVP 없음 유지. 이유: S-43은 S-08 안 패널·섹션 저장이라 새 계약이 필요하고, 긴 서술은 산출물(AI-13)로 쓸 수 있음. 단, 독립 프로젝트만 있는 사용자의 D-01 게이트 경로가 AI 없이 폼뿐이라는 점은 남는다 | (a) 유지 | 8장 D-AI-16 |
| PP-4 | 품질 목적 제한 | 대화당 초안 생성 6회(사용자 비용 보호, 7.4) — NFR(D-34 품질 목적 제한) 목록에 추가 | 6회 | 7.4 |
| PP-5 | 비용 예시 갱신 | 산출물 작성 대화 1회 약 $0.19(상한 약 $0.5~1.0, Claude 매핑) — 사용량 미터 기능 목록은 `writing_chat`로 AI-12와 묶음(미터 표시 "AI 작성 대화") | — | 7.3, C-13 |
| PP-6 | 용어 | "폼에 채움"(반영 후 저장 전), "반영됨"(저장 후) 두 상태 구분을 용어집 "반영" 항목에 추가 | — | AI-12 PA-3 |
