# 커리어 재설계 (CR-1~CR-14) — AI 기능 설계 쪽 요청·질문

> 작성: ai-feature-designer / 2026-11-02 / 기준: `00_input/planning-decisions-career-redesign.md`(확정 2026-11-02 (사용자)), `docs/planning/03-ai-features.md` **v4.5**
> 이 파일의 이름(`projects.situation`, `project_artifacts`, `ART-n`, `apply_writing_chat_proposal` 등)은 AI 명세 v4.5가 쓰는 `[제안]` 이름이다. 받는 쪽이 이름을 바꾸면 AI 명세를 맞춘다.

## 다른 팀원에게 요청

### data-architect

1. **상세 내용을 프로젝트에 합치기 (CR-2) — 권고: `project_details` 폐기, STAR 컬럼을 `projects`로.**
   - `projects`에 `situation`, `task`(화면 "역할"), `action`, `result`(화면 "결과/성과"), `learnings`(화면 "배운 점") 추가. 각 ≤ 2,000자(현재 `project_details`와 같은 상한).
   - 근거: AI 쪽은 STAR를 `PRJ-n`의 필드로 다루고 **`DET-n` 별칭을 폐기**했다. 1:1 테이블로 남기면 별칭·근거 `source_type`·`source_snapshot_at`(다른 STAR 필드 수정도 "변경됨")·삭제 트리거·readiness 카운트가 두 단계로 남아 복잡도만 늘고 얻는 것이 없다. 1:1로 남기기로 하면 그 근거를 남기고 알려 주면 AI 명세는 `project` source_type 그대로 두고 저장 매핑만 바꾼다.
   - `project_details.title`은 없어진다(프로젝트 이름이 제목).
2. **정량 성과 삭제 (CR-11)**: `achievements` 테이블, `achievements.kind`, 경력 단위 성과, `writing_chats.structured_draft`의 `achievements[]` 폐기. 수치 가드는 사용자 서술 텍스트만 원천으로 쓴다(AI V-5) — 스키마 영향 없음.
3. **소속 프로젝트에서 `role`·스킬 제외 (CR-10)**: AI는 소속 프로젝트의 `role`·`team_size`·`summary`·`project_skills`를 팩에 넣지 않는다. 컬럼을 남길지는 데이터 모델 판단이지만, 남기면 "화면에 없는 값"이 되므로 AI는 계속 읽지 않는다. `project_skills`는 **독립 프로젝트 전용**(사용 기술)으로 범위를 좁혀 주길 요청.
4. **분류 3종 (CR-9)**: `projects.project_kind`, `experience_type`, `competencies`(복수 선택이면 text[]) — 값은 정해진 목록(CHECK 또는 코드 테이블). AI는 **표시명 문자열**만 받으면 된다. 근거 `source_field` 허용값에는 넣지 않는다(근거로 인용하지 않음, AI C-1.2). `career_snapshot_hash` 포함 필드에는 넣는다.
5. **독립 프로젝트 필드 (CR-7)**: `role`(화면 "담당 업무", 독립 프로젝트에서만 사용), `content`(화면 "프로젝트 내용" — 현재 `summary` ≤200자와 다른 긴 본문, ≤ 5,000자 `[가정]`), `link_url`(새 컬럼). AI는 `link_url`을 읽지 않는다(팩·해시 모두 제외).
6. **산출물 테이블 신설 (CR-8)**: `project_artifacts`(`id`, `user_id`, `project_id`(복합 FK, 독립 프로젝트만 — 소속 있는 프로젝트면 거부), `title` not null ≤ 200자, `body` text(마크다운) ≤ 20,000자 `[가정]`, `sort_order`, `created_at`, `updated_at`). `unique (id, user_id)`, RLS 본인, `profiles.career_data_updated_at` 갱신 트리거 대상, `delete_career_item`·`get_deletion_impact` cascade 목록에 추가. 상태 컬럼은 두지 않는다(부모 프로젝트가 `complete`일 때만 AI 팩에 들어감).
7. **근거 저장 (`evidence_links`)**:
   - `source_type` CHECK: `project_detail`·`achievement` **삭제**, **`project_artifact` 추가**.
   - `source_field`: `project` = `name`, `period`, `situation`, `task`, `action`, `result`, `learnings`, `role`, `content` (`team_size`, `summary` 삭제) / `project_artifact` = `title`, `body`.
   - `project_artifact`의 `source_locator` = 원문 마크다운의 `{start, end}`(JS UTF-16). 서버가 정규화 오프셋 지도로 계산해 넣는다(AI C-1.1). `source_snapshot_at` = 산출물 행 `updated_at`. 삭제 트리거·insert 시 원본 없음 처리 대상에 `project_artifacts` 추가.
   - 소유자별 허용 출처: 인사이트·경력기술서 = 커리어 출처에 `project_artifact` 포함. V-8 DB 방어 조건을 `source_type = 'project' AND source_field = 'learnings'`로 변경.
   - 기존 `project_detail`·`achievement` 근거 행 처리(이관 vs "원본 삭제됨") 결정 필요 — AI 쪽은 이관 시 `project_detail.{field}` → `project.{field}`(같은 프로젝트) 매핑이면 충분하다.
8. **`draft_section_sources.project_detail_ids` 폐기**(AI-04 `detail_refs` 폐기).
9. **AI 작성 대화 테이블 (CR-5, CR-6)**:
   - `writing_chats.project_id` **not null**, FK `projects on delete cascade`. 프로젝트당 여러 행 허용.
   - 폐기: `mode`, `experience_id`/`education_id`, `affiliation_suggestion`, `saved_at`, `status`의 `saved`/`handed_off`/`abandoned`, "묶이지 않은 대화 90일 자동 삭제"(D-DM-08, U-9의 해당 부분).
   - `status` ∈ `active` / `closed`(메시지 상한 도달). `title`(대화 기록 목록 표시, 첫 사용자 메시지 앞 30자, 서버가 채움), `last_applied_at` 추가.
   - `structured_draft` 모양 v3: `project.{start_month,end_month}` + `star.{situation,task,action,result,learnings}` 필드 객체(`value`, `op`, `origin`, `source_message_ids`, `source_quotes`, `review`, `reviewed_at`, `applied_at`) + `clarifications[]` + `sensitive_flags_count`. (`details[]`, `achievements[]`, `skills[]`, `affiliation_suggestion` 삭제)
   - RPC: `apply_structured_draft_patch` V-9h 개정(프로젝트에 값이 있는 STAR 필드는 `op = append`만, 기간은 비었을 때만). **새 사용자 세션 RPC `apply_writing_chat_proposal(writing_chat_id, fields text[])`**: 빈 필드는 제안 값으로, 값이 있으면 현재 값 + 줄바꿈 + 제안 문장으로 덧붙임, 남은 `needs_review` 건너뜀, `applied_at`·`last_applied_at` 기록, `projects.source_writing_chat_id` 갱신, 완료 판정 재계산. 키 없이도 실행 가능. **폐기**: `save_writing_chat`, `hand_off_writing_chat`, `set_writing_chat_affiliation`.
   - `projects.source_writing_chat_id`는 "마지막으로 반영한 대화"(on delete set null).
10. **완료 판정·데이터 최소 기준 (`get_data_readiness`)** `[가정]` — product-planner와 함께 확정:
    - 소속 프로젝트 `complete` = `name` + `situation` + `action`(CHECK로 표현 가능, 자식 의존 트리거 불필요). 독립 프로젝트 `complete` = `name` + (`content` 또는 `body`가 있는 산출물 ≥ 1)(산출물 insert/update/delete 트리거로 재계산).
    - D-01 = `complete` 경력 1 + `complete` 프로젝트 1(소속·독립 무관).
    - `counts`에서 `*_project_details` 삭제. `suggested_mode` 삭제. `next_action` 값에 **`create_project`** 추가(complete 경력은 있고 채울 소속 프로젝트가 없을 때). `writing_chat` + `suggested_project_id` = 상황·행동이 빈 draft 소속 프로젝트. `hints.project_fields` = 내용·산출물이 없는 draft 독립 프로젝트(`next_action = form`).
    - `features.*.hints`의 `complete_project_detail` 삭제.
11. **AI-08 `ai_suggestions.target`**: `source_type = 'project'` + STAR `source_field`로 정리.

### ux-planner

1. **Resumate AI 패널 (CR-5)**: 대화 기록 목록(대화 `title`, 마지막 활동, 상한 도달 표시), "+ 새 대화", … 메뉴(대화 삭제), × 닫기. 새 대화는 이전 대화 기록을 이어받지 않는다(프로젝트 현재 STAR만 읽음).
2. **응답 모드**: 대화 턴은 SSE 스트리밍(`turn_started` → `reply_delta` → `reply_done` → `draft_patch` → `draft_flags` → `turn_done`(+ 다음 빠른 버튼 3개, `ready_to_return`) / `error`). 반영은 일반 동기 요청(AI 호출 없음, 키 없이도 가능).
3. **제안 카드 (UX-4 유지)**: 턴마다 갱신. 필드별로 빈 필드 = 새 값, 값이 있는 필드 = 기존 값 + **덧붙일 문장 강조**. 필드마다 출처 발화 보기, 직접 고치기(`user_edit`), `needs_review` 수락/거절, "반영됨" 표시. "반영" 버튼(전체·필드 선택). 반영하면 왼쪽 STAR 섹션이 바로 바뀐다.
4. **덧붙임 규칙 표시**: 대화 중 왼쪽 섹션을 직접 고쳐도 제안은 남고, 반영 시 현재 값 뒤에 붙는다는 점을 카드에서 알 수 있게(예: "현재 내용 뒤에 붙어요").
5. **시작 인사 문구** `[가정]`(AI 명세 AI-12): STAR 비어 있음 / 일부만 / 다 채워짐 / 게이트 진입 4가지 + 민감정보 주의 + 무료 등급 안내. 최종 문구는 ux가 정한다.
6. **빠른 버튼 칩 3개** `[가정]`: 서버가 프로젝트 상태(필수 빔 / 선택만 빔 / 다 채워짐)에 따라 내려 준다(AI-12 표). 칩 = 정해진 사용자 메시지 + `requested_slot`(메시지 상한 포함). "반영"은 칩이 아니라 카드 버튼. 상한 근처 숨김 여부 등 노출 규칙은 ux 판단.
7. **왼쪽 STAR 섹션 → "이 부분 물어봐 줘"**: 섹션별로 패널에 `requested_slot`을 보내는 진입점을 둘지(권장) ux 판단.
8. **상한 도달(40)**: 마지막 AI 메시지가 반영 안 된 제안 요약 + "반영" + "새 대화에서 이어 하기". 대화는 `closed`(열람·반영만).
9. **게이트 진입**: `next_action` ∈ `writing_chat`(프로젝트 상세 + 패널 새 대화) / `create_project`(프로젝트 추가 → 상세 + 패널) / `form`. 반영으로 D-01이 채워지면 패널에 "돌아가기"(원래 기능으로, 실행은 사용자가 다시 누름).
10. **삭제되는 화면 요소**: S-36 별도 화면, S-08의 "작성 중인 AI 대화"·"그만둔 AI 대화" 묶음, 저장·폼 전환·소속 확인·그만두기·다시 이어 하기 버튼.
11. **근거 칩**: `learnings` 칩 이름 "배운 점"(CR-2). 산출물 근거 칩 = "산출물 › {산출물 제목}", 눌렀을 때 산출물 본문에서 `source_locator` 구간 하이라이트. 분류 3종은 근거 칩으로 나오지 않는다.
12. **독립 프로젝트**: AI 패널 없음(D-AI-15 권고 (a)). 게이트에서 독립 프로젝트만 있는 경우는 "프로젝트 내용" 섹션 편집으로 안내.

### product-planner

1. 완료 판정·D-01 재정의(위 data-architect 10)를 PRD F-P1-03·F-P1-15·D-01에 반영. 독립 프로젝트를 D-01 완료 프로젝트로 셀지 확인(AI 권고: 센다 — 산출물·내용이 사실 근거가 되므로).
2. F-P1-04(정량 성과)·F-P1-07 축소판 삭제에 따라 AI 품질 지표(PRD 7장)에 "구조화 성과" 관련 항목이 있으면 정리.
3. F-P1-13 기준 문구(새 프로젝트/보강으로 시작, 소속 정함, 폼 전환) → "프로젝트 상세 패널, 프로젝트당 여러 대화, 제안 → 반영"으로. D-27·U-9·NFR-PRV-06의 "묶이지 않은 대화 90일 자동 파기" 삭제.
4. 용어집: "상세 내용" 폐기(STAR는 프로젝트의 필드), "산출물" 추가, "배운 점"(표시명), 분류 3종 값 목록 `[가정]`.

## 사용자에게 묻는 것 (열린 질문)

1. **D-AI-14 `[결정 필요]`** AI 작성 대화가 프로젝트 종류·경험 유형·역량 분류도 채워야 하나요? — 권고 **(a) 채우지 않음**(사용자가 머리에서 직접 고름). 분류는 본인 판단이라 "모든 값은 사용자 발화에서 나온다"는 원칙과 맞지 않습니다.
2. **D-AI-15 `[결정 필요]`** 독립 프로젝트에도 AI 대화 패널이 필요한가요? — 권고 **(a) MVP에는 없음**(피그마에 패널이 없고 산출물은 직접 쓰는 글). 출시 후 "프로젝트 내용을 대화로 채우기"가 첫 후보입니다.
3. **이미 쓴 STAR를 대화로 고치기**: 대화는 빈 칸은 채우고, 이미 쓴 칸에는 **문장을 덧붙이는 제안만** 하도록 했습니다 `[가정]`(사용자 글을 AI가 지우거나 바꾸는 경로를 없애기 위해). 대화로 기존 문장을 "다시 써 주는" 기능이 필요하면 알려 주세요(문장 다듬기는 AI-08 다듬기 버튼으로 대신).
4. **산출물 길이**: 산출물 하나 최대 20,000자, AI에는 산출물당 앞 6,000자·전체 15,000자까지만 넣습니다 `[가정]`. 뒷부분은 AI 근거가 되지 못합니다. 긴 산출물이 많을 것으로 보이면 상한을 조정하거나(비용 증가) 산출물별 "AI에 포함" 선택을 두는 안을 검토하겠습니다.
5. **소속 프로젝트의 팀 규모·한 줄 요약**: 피그마에 없어 AI 입력에서 뺐습니다 `[가정]`. 화면에서 아예 없앨지 확인 부탁드립니다.
