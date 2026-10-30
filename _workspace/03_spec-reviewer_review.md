# Resumate 기획 정합성 리뷰 (라운드 1)

> **라운드 2(최종) 결과는 문서 끝 "라운드 2 — 최종" 절에 있다. 통합 결정 목록은 그 절의 것이 최신이다.**

> 작성: spec-reviewer / 기준: `product-context.md`, `spec-consistency-review` 체크리스트 B1~B11, `00_input/brief.md`(사용자 피드백 1·2차 = 요구사항 원문, "리더 해석·가정" = 가정)
> 이름의 기준 문서는 데이터 모델 v3(필드명), PRD v3(범위·용어)다. 문서는 직접 고치지 않았다. 수정은 각 담당자가 한다.

## 요약

- 검토 문서
  - `01_product-planner_prd.md` **PRD v3**
  - `02_ux-planner_flows.md` **UX v4** (데이터 모델 v2 기준으로 작성됨)
  - `02_ai-feature-designer_ai-spec.md` **AI v3** (데이터 모델 v2 기준으로 작성됨)
  - `02_data-architect_data-model.md` **데이터 모델 v3** (이름 확정본, 11장 rename U4-1~U4-12 / A3-1~A3-12)
- 이슈: **Critical 3 / Major 11 / Minor 12** (총 26), 해결 0 / 미해결 26 (라운드 1, 모두 open)
- 담당별: ai-feature-designer 8 (C2·M5·m1) / ux-planner 7 (C1·M3·m3) / product-planner 9 (M3·m6) / data-architect 2 (m2)
- 데이터 모델 v3의 rename 24건은 UX v4·AI v3에 **하나도 반영되지 않았다.** 담당별로 묶어 6건(R-07, R-08, R-09, R-10, R-11, R-15)으로 올렸다.
- 사용자 요구사항(brief 1·2차) 8개 항목은 네 문서 모두에 반영됐다(아래 "사용자 요구 반영 점검"). 빠진 요구는 없고, 세부 계약이 비어 구현이 막히는 곳이 3건(Critical) 있다.
- 통합 결정 목록: **27건** (사용자 결정 10 / 팀 해결 가능 17)

## 사용자 요구 반영 점검 (brief 1·2차)

| # | 사용자 요구 (brief) | PRD v3 | UX v4 | AI v3 | 데이터 v3 | 판정 |
|---|---------------------|--------|-------|-------|-----------|------|
| 1 | 홈 = 대시보드, 왼쪽 메뉴(커리어 기본 / 기업 JD 관리 / 모의 면접 / 지원 현황) (2차-1) | F-COM-10, 3.1 | L-01, UX-1 | 해당 없음 | 해당 없음(보기) | 반영. 메뉴 수 "3개" 발언 해석은 U-4 |
| 2 | 지원 현황 칸반 6열 + 드래그앤드롭 + 인터뷰 전형 이동 시 팝업 → 면접 준비 (2차-1.4) | F-ST-01~05 | S-39, C-12~C-14, FL-15·16 | C-6 "AI 호출 없음" | `stage`, `application_stage_events`, `move_application_stage` | 반영 |
| 3 | 연도 > 경력/교육 > 프로젝트 > 상세 내용 계층 (2차-2.1) | F-P1-09, 14 | S-08, S-34 | C-1 팩 구조 | `educations`, 2.4 연도 보기 | 반영 |
| 4 | 상세 내용 = STAR + Insights(→ 배운 점) (2차-2.2) | F-P1-15, D-21 | S-35 | C-9, V-8 | `project_details.learnings` | 반영. 이름은 U-2 |
| 5 | 프로젝트를 AI와 채팅으로 함께 작성 (2차-2.3) | F-P1-13 | S-36, FL-14 | AI-12 | `writing_chats` | 반영. 단 계약 공백 R-02·R-03·R-04 |
| 6 | 커리어 정리와 지원 프로젝트는 독립, 순서 강제 없음 (1차-1) | 3.1 | UX-2·3 | C-1 게이트 | DM-11 | 반영 |
| 7 | 자소서 기본 3문항 + 문항 수정 + AI가 문항별 경력·프로젝트 선택 (1차-2) | F-DOC-02, 08 | S-18, C-11 | AI-04 | `draft_sections.template_key`, `draft_section_sources` | 반영. 교육 소속 표시 R-16 |
| 8 | 면접 유형 선택 → 질문 일괄 생성 → 답변 일괄 제출 → 점수(산식 미정) (1차-3·4) | F-P3-01~06, D-14 | S-20, S-33, S-22, C-17 | AI-05~07, 4.3 | 점수 슬롯 컬럼 | 반영. 세션 점수 값 불일치 R-05 |

## 경계별 결과

| 경계 | 결과 | 이슈 ID |
|------|------|---------|
| B1 PRD Must → 화면 | 통과. UX 4.1 매트릭스가 PRD 5.1 Must 전체를 덮는다. 단 F-P1-13의 필수 상호작용(검토 수락) 화면 요소가 없다 | R-03 |
| B2 화면 필드 → 데이터 | 실패. rename 미반영 다수, 일부 화면이 확정 필드를 쓰지 않음 | R-06, R-07, R-08, R-15, R-16, R-17 |
| B3 AI 입력 → 데이터 | 실패. 교육 포함 항목 입력 없음, rename 미반영 | R-01, R-09, R-10, R-11 |
| B4 AI 출력 → 저장 | 실패. AI-12 패치 ↔ `structured_draft` 매핑, AI-03 교육 섹션, 세션 점수 값 | R-01, R-02, R-04, R-05 |
| B5 AI 출력 → 화면 | 실패. `needs_review`·`actor_ambiguous`·소속 제안 표시 없음, 상세 내용 선택 표시 없음 | R-03, R-16, R-18 |
| B6 응답 모드 | 통과. AI-01 동기 / AI-02·05·06·07 비동기 / AI-03·04·12 스트리밍이 UX C-03·C-04, PRD 6.3과 맞음 | — |
| B7 기능 → 데이터 | 부분 통과. Must 기능별 테이블은 있으나 v3 문서에 기능↔테이블 매트릭스가 없음 | R-26 |
| B8 용어 | 실패. 지원 프로젝트 화면 표기, 회고 근거 칩 표시명, 신규 용어 미등록 | R-13, R-19 |
| B9 MVP 범위 | 부분 실패. Should 항목 일부를 UX가 MVP에 노출, 배운 점 자소서 사용 범위 확대 | R-21, R-22 |
| B10 개인정보·삭제 | 부분 실패. 상세 내용 삭제 시 대화 기록 처리 문구 충돌, 미연결 대화 보관 기간이 PRD에 없음, 민감정보 원문 메시지 보관 | R-12, R-14, R-20 |
| B11 비용 | 통과. 평균 약 $1.61 ≤ $2(PRD 6.4 평균 기준). 한도 최대 $7.83은 D-12·D-AI-10 결정 대상. 차감 시점 문구만 정리 필요 | R-23 |

---

## 이슈

### R-01 [Critical] 경력기술서(AI-03)에 교육 소속 프로젝트를 넣을 계약이 없다
- 경계: B3, B4
- 근거:
  - `01_product-planner_prd.md` F-DOC-01 비고 "(v3) STAR를 재료로 쓴다. 교육 아래 프로젝트도 고를 수 있다" (Must)
  - `02_ux-planner_flows.md` S-17 "경력기술서 포함 항목 트리에 **교육 아래 프로젝트** 포함"
  - `02_data-architect_data-model.md` A.9 `drafts.options`에 `included_education_ids`, A.10 `draft_sections.section_kind`에 `education`, `education_id`
  - `02_ai-feature-designer_ai-spec.md` AI-03 입력 표: "사용자 선택 | `drafts.options.included_experience_ids`, `drafts.options.included_project_ids`, `drafts.options.project_order`" — 교육 없음. 출력 스키마는 `sections[].experience_ref`와 `standalone_projects`뿐이라 교육 섹션을 표현할 자리가 없다. 저장 문단에만 "교육 소속 프로젝트는 `'education'` `[제안]`"이 있다. AI-11 출력 설명도 "경력(`experience`)의 포함 여부는 소속 프로젝트에서 서버가 파생"으로 교육을 다루지 않는다.
- 담당: ai-feature-designer
- 수정 제안:
  1. AI-03 입력에 `drafts.options.included_education_ids`를 추가한다.
  2. 출력 스키마에 교육 섹션을 추가한다. 예: `sections[]`가 `experience_ref` 또는 `education_ref` 중 하나를 갖게 하거나 `education_sections[]`를 별도로 둔다. 서버가 채우는 머리글(기관명·과정명·기간)도 명시한다.
  3. 저장 매핑: 교육 섹션 → `draft_sections.section_kind = 'education'`, `draft_sections.education_id`.
  4. AI-11: 교육 포함 여부도 소속 프로젝트에서 파생한다고 적는다.
- 상태: open

### R-02 [Critical] AI-12 정리 패치 스키마가 `structured_draft` 형식과 맞지 않는다
- 경계: B4
- 근거:
  - AI v3 AI-12 출력 스키마: `"target": "project"`의 `field`가 `name`/`role`/`team_size`/`period`/`summary`/`skills`. 상세 내용은 `detail_key`("D1")로만 가리키고, 기존 상세 내용을 가리킬 수단이 없다. 예시 값 `"value": "4"`(문자열) for `team_size`.
  - 데이터 v3 2.5 `structured_draft`: `project.{field}`(필드 객체), 스킬은 최상위 `skills[]`, `details[].existing_detail_id`("`augment_project`에서 기존 상세 내용의 빈 필드를 채울 때"). `projects`는 `start_month`/`end_month`(date), `team_size`(smallint).
  - 데이터 v3 3.3 `save_writing_chat`: "`augment_project`는 기존 행의 **빈 필드에만** 쓰고 … (`existing_detail_id` 지정분)" — AI 출력에서 이 값을 만들 방법이 없으면 보강 대화(F-P1-13 (1), Must)가 저장되지 않는다.
- 담당: ai-feature-designer
- 수정 제안: AI-12에 "패치 → `structured_draft` 매핑" 표를 추가한다.
  - `period` → `project.start_month` / `project.end_month`(YYYY-MM, V-9c 대상)
  - `skills` → 최상위 `skills[]`(`value`, `source_message_ids`, `source_quotes`)
  - `team_size` → 정수, V-9c로 인용문 숫자 확인
  - `augment_project`: 입력 컨텍스트의 기존 상세 내용에 `DET-n` 별칭을 붙이고, 패치에 `detail_ref`(기존) / `detail_key`(신규)를 구분한다. 서버가 `detail_ref`를 `existing_detail_id`로 바꾸고, 이미 값이 있는 필드에 대한 패치는 거부한다.
  - `new_details[]` → `details[]` 행 추가, `affiliation_suggestion.ref`(EXP-n/EDU-n) → `affiliation_suggestion.id`(UUID)
- 상태: open

### R-03 [Critical] S-36 미리보기에 `needs_review` 수락/거절, 본인 역할 확인, 소속 제안 확인이 없다
- 경계: B1, B5
- 근거:
  - AI v3 AI-12 V-9e: "자동 반영하지 않고 `needs_review`로 미리보기에 표시(사용자가 수락해야 반영)". 요청 표: "상태 배지 `needs_review`(수락/거절 버튼), `actor_ambiguous`(본인 역할 확인 중) … 소속 연결 제안 확인 UI"
  - 데이터 v3 3.3 "`save_writing_chat(writing_chat_id, accepted_review_paths[])` … `review = 'needs_review'` 필드는 `accepted_review_paths`에 있을 때만 쓴다", "소속은 … 사용자가 미리보기에서 확정한 것만"
  - UX v4 S-36 정리 결과 미리보기 표에는 "필드별 출처 | C-15 출처 발화 칩 / '직접 수정' / '아직 없음'"만 있고, C-15에도 검토 상태가 없다. 소속은 "필드 직접 수정"뿐이다.
- 영향: 수락 UI가 없으면 `needs_review` 필드는 저장될 길이 없다(F-P1-13 (5) 확정 흐름이 끊김).
- 담당: ux-planner
- 수정 제안:
  1. C-15에 네 번째 상태 "검토 필요"를 추가한다: 값 + "AI가 정리한 표현이 원래 말과 달라요" + [수락] / [거절(비우기)]. 수락 시 `review = 'ok'`(경로를 `accepted_review_paths`에 추가), 거절 시 값 비움.
  2. 저장 확인 다이얼로그에 "검토하지 않은 항목 N개는 저장되지 않아요"를 넣는다.
  3. `clarifications.kind = actor_ambiguous` → 해당 행동 필드에 "본인 역할 확인 중" 배지.
  4. `affiliation_suggestion` → 미리보기 소속 칸에 "'{회사명}' 경력에 연결할까요? [연결] [아니요]".
- 상태: open

### R-04 [Major] "폼으로 전환" 동작이 AI 문서만 다르다
- 경계: B4
- 근거:
  - AI v3 AI-12 저장: "**폼으로 전환**: AI 호출 없음. 검증 통과 필드…로 채운 폼을 연다. `status = 'handed_off'`. 폼에서 저장하면 일반 폼 저장과 같다" — 전환 시점에 커리어 행을 쓰지 않는다는 뜻으로 읽힌다.
  - 데이터 v3 3.3 "폼으로 전환 (D-UX-11 (a)) | 사용자 세션 RPC `hand_off_writing_chat` | 같은 테이블에 정리 결과를 쓰고 `status`는 완료 판정대로(대부분 `draft`)"
  - UX v4 FL-14 "사용자가 옮기기를 확인한 순간 정리 결과가 `status = 'draft'` 항목으로 저장"
- 담당: ai-feature-designer (데이터 모델이 기준)
- 수정 제안: AI-12 "폼으로 전환" 문단을 "사용자 확인 후 사용자 세션 RPC `hand_off_writing_chat`이 정리 결과를 커리어 테이블에 쓰고(완료 판정대로, 대부분 `draft`) `writing_chats.status = 'handed_off'`, `project_id`를 채운다. 이후는 폼 자동 저장"으로 바꾼다.
- 상태: open

### R-05 [Major] 응답 0개 세션의 세션 점수 값 `unanswered`는 저장할 수 없다
- 경계: B4, B5
- 근거:
  - AI v3 AI-07 트리거: "응답된 질문이 0개면 호출하지 않는다(세션 점수 `unanswered`, …)"
  - 같은 문서 4.3: "세션 점수는 `pending_method`/`scored`/`not_scored`만(A2-13)"
  - 데이터 v3 A.12 `interview_sessions.score_status`(pending_method/scored/not_scored)
  - UX v4 C-17 `unanswered` 행 "(세션에는 없음)"
- 담당: ai-feature-designer
- 수정 제안: AI-07 트리거 문구를 "세션 `score_status = 'not_scored'`, `unanswered_count = question_count`, `session_feedbacks` 행 없음"으로 바꾼다. 화면 문구("답변이 없어 평가할 내용이 없어요")는 UX가 C-17에 추가하도록 리더가 함께 전달한다.
- 상태: open

### R-06 [Major] 보강 모드에서 기존 상세 내용 처리가 UX만 다르다
- 경계: B2, B5
- 근거:
  - UX v4 S-36 프로젝트 기본 정보 비고: "보강 모드는 기존 값 표시(읽기 전용) + **새 상세 내용만 편집**"
  - AI v3 AI-12 모드 표: "`augment_project` … 기존 프로젝트에 새 상세 내용 추가, 또는 **기존 상세 내용의 빈 필드만** 채움"
  - 데이터 v3 2.5 `details[].existing_detail_id`, 3.3 "`augment_project`는 기존 행의 빈 필드에만 쓰고"
- 담당: ux-planner
- 수정 제안: S-36 보강 모드에 "기존 상세 내용 카드: 채워진 필드는 읽기 전용, 빈 필드는 대화로 채워지면 출처 칩과 함께 표시·수정 가능"을 추가하고, 저장 확인 다이얼로그에 "기존 상세 내용 '{제목}'의 빈 칸 N개 채움"을 넣는다.
- 상태: open

### R-07 [Major] UX v4: AI 작성 대화 이름 미반영 (U4-1~U4-6, U4-11)
- 경계: B2
- 근거 (데이터 v3 11.1 rename 목록 ↔ UX v4):
  - U4-1 `enrich_project` → `augment_project`: S-36 데이터 줄 "`mode`(`new_project` / `enrich_project`)"
  - U4-2 `target_experience_id` / `target_education_id` → `experience_id` / `education_id`: S-36 데이터 줄, "다른 팀원에게 요청" data-architect 5
  - U4-3 상태값에 `handed_off` 추가: S-36 데이터 줄 "`status`(`active` / `saved` / `abandoned`)", S-36 "폼으로 전환" 동작
  - U4-4 `last_message_at` → `last_activity_at`: S-36 데이터 줄, S-08 "작성 중인 AI 대화"의 "마지막 메시지 시각"
  - U4-5 필드 값 경로 → `structured_draft.project.{field}.value`, `structured_draft.details[].fields.{field}.value`, `details[].achievements[]`: S-36 미리보기 "`structured_draft.project.*`", "`structured_draft.details[].*`"
  - U4-6 "직접 수정" → `origin = 'user_edit'`: C-15
  - U4-11 추가 컬럼 `source_writing_chat_id`(projects/project_details/achievements), `writing_chat_messages.status`, `writing_chats.usage_event_id`: S-36 데이터 줄, S-36 응답 실패 상태("다시 보내기"는 `writing_chat_messages.status = 'failed'`)
  - 문서 머리글 "데이터 모델 v2" 기준 표기
- 담당: ux-planner
- 수정 제안: 위 위치를 확정명으로 일괄 치환하고, 해당 위치의 `[확인 필요: data-architect]` 표식을 지운다. S-10에 AI 요청의 "출처 대화 보기"(`source_writing_chat_id`) 진입점을 둘지 함께 정한다.
- 상태: open

### R-08 [Major] UX v4: 삭제·준비도·탈퇴 집계 이름 미반영 (U4-7, U4-9, U4-10)
- 경계: B2
- 근거:
  - U4-7: C-05 "`get_deletion_impact(entity_type, entity_id, experience_mode)`", "RPC `delete_career_item(entity_type, entity_id, experience_mode, result_mode)`" → 데이터 v3 4.2 `affiliation_mode`(`keep_projects` / `delete_projects`)
  - U4-9: S-25 "(`get_deletion_impact` 또는 탈퇴 전용 집계 `[확인 필요]`)" → `get_account_deletion_summary()`
  - U4-10: C-09 부족 항목 문구가 `missing`만 읽음 → 데이터 v3 6장 `hints: ["complete_project_detail"]`를 문구 분기에 써야 한다("완료된 상세 내용이 없어 프로젝트가 미완료" 안내). C-09 비고 `[확인 필요: data-architect]`
- 담당: ux-planner
- 수정 제안: C-05 파라미터를 `affiliation_mode`로, S-25 데이터 원천을 `get_account_deletion_summary()`로 바꾸고, C-09 부족 항목 표에 `hints` 행(`complete_project_detail` → "작성 중인 상세 내용을 완료해 주세요" + `draft_item_ids.project_details` 바로가기)을 추가한다.
- 상태: open

### R-09 [Major] AI v3: 교육 컬럼명 미반영 (A3-1~A3-3)
- 경계: B3
- 근거: AI v3 C-1 교육 행 "`education_kind`(degree/course) … `education_status`", 필수 "id·institution_name·education_kind·start_month"; C-3 education `field` 허용값 "`education_kind`, `education_status`"; "다른 팀원에게 요청" 교육 행 ↔ 데이터 v3 2.3 `education_type`, `enrollment_status`(enrolled/graduated/completed/dropped_out/on_leave), 2.8 `source_field`
- 담당: ai-feature-designer
- 수정 제안: C-1, C-3, 요청 표의 `education_kind` → `education_type`, `education_status` → `enrollment_status`로 바꾸고 `[제안]` 표식을 지운다.
- 상태: open

### R-10 [Major] AI v3: AI 작성 대화 이름 미반영 (A3-4~A3-9, A3-11, A3-12)
- 경계: B3, B4
- 근거:
  - AI-12 입력 표 "`writing_chat_messages`(`seq`, …)", "`writing_chats.draft_result`"
  - AI-12 저장 "`target_project_id`", "`affiliation_type`/`affiliation_id`", "`status`(`active`/`saved`/`handed_off`/`closed`)", "`draft_result`(jsonb …)", "`writing_chat_messages`(…, `seq`, …)"
  - A3-9: 출처 `source_message_ids` 값이 `M-n` 별칭 — 저장 시 UUID로 바꾼다는 규칙이 AI-12에 없다(C-1 별칭 규칙은 커리어 팩만 다룸)
  - A3-11: `writing_chat_messages.status`, `ai_job_id` 누락. AI-12 "정리 호출 실패 → 응답은 계속"과 UX 응답 실패 "다시 보내기"가 이 컬럼에 기대고 있다
  - 문서 머리글·C-3·C-6·요청 표의 `[제안]` 표식, 머리글 "데이터 모델 v1/v2" 기준 표기
- 담당: ai-feature-designer
- 수정 제안: 데이터 v3 11.2 표대로 일괄 치환(`project_id`, `experience_id`/`education_id`, `abandoned`, `structured_draft`, `sequence`)하고, AI-12 저장에 "`M-n`은 호출 단위 별칭, 저장 시 `writing_chat_messages.id`로 변환"과 `writing_chat_messages.status`(streaming/done/failed)·`ai_job_id`를 적는다. 메시지 상한은 `writing_chats.message_count`(사용자 + AI 합계)로 확인 표기.
- 상태: open

### R-11 [Major] AI v3: 자소서 근거 선택 이름·범위 미반영 (A3-10)
- 경계: B3, B4
- 근거:
  - AI-04 저장 "`draft_section_sources`(… v3 `[제안]` `education_id`, `detail_ids`)" ↔ 데이터 v3 A.11 `project_detail_ids` uuid[], `education_id`
  - AI-04 저장 컬럼 목록에 `reuse_reason`이 빠져 있다(출력 스키마에는 있음, 데이터 A.11에 있음)
  - AI-04 V-7 범위 "본문 근거는 `sources`의 경력·프로젝트와 그 하위 성과·스킬" — 교육, `detail_refs`로 고른 상세 내용이 범위 정의에 없다
- 담당: ai-feature-designer
- 수정 제안: `detail_ids` → `project_detail_ids`(출력 `detail_refs` → 저장 `project_detail_ids` 매핑 명시), `education_ref` → `education_id`, 저장 목록에 `reuse_reason` 추가. V-7 범위를 "선택된 경력·교육·프로젝트와 그 하위 상세 내용(`detail_refs`가 있으면 그 상세 내용)·성과·스킬"로 고친다.
- 상태: open

### R-12 [Major] PRD F-COM-04의 "상세 내용 삭제 시 AI 작성 대화 기록" 문구가 다른 문서와 충돌
- 경계: B10
- 근거:
  - PRD F-COM-04 수용 기준: "상세 내용을 지우면 거기 붙은 정량 성과도 지워지고, AI 작성 대화 기록은 남기지 않는다 [가정]"
  - PRD NFR-PRV-06: "AI 작성 대화 기록은 해당 프로젝트에 묶여 보관되고, 프로젝트를 지우면 함께 지워진다"
  - 데이터 v3 4.1 상세 내용 삭제: "그 정량 성과" 연쇄만, 대화는 프로젝트 삭제·대화만 삭제·탈퇴 때만 삭제
  - UX v4 C-05 "프로젝트 삭제 … 이 프로젝트의 AI 작성 대화도 삭제돼요"
- 담당: product-planner
- 수정 제안: F-COM-04 문구를 "상세 내용을 지우면 붙은 정량 성과가 함께 지워진다. 프로젝트를 지우면 그 프로젝트의 AI 작성 대화도 지워진다. 상세 내용 삭제는 대화 기록에 영향이 없다"로 정리한다. 의도가 정말 "상세 내용 삭제 시 대화도 삭제"라면 데이터·UX에 별도 요청으로 내린다.
- 상태: open

### R-13 [Major] 지원 프로젝트의 화면 표기가 PRD 권고와 다르고 용어집에 없다
- 경계: B8
- 근거:
  - PRD D-20 권고: 개체 용어 "지원 프로젝트", 메뉴 라벨 "기업 JD 관리". (b) "개체 용어도 '기업 JD'로"는 "JD 원문 개체(`job_descriptions`)와 겹친다"는 이유로 기각. "화면에 개체 이름이 꼭 필요한 곳(삭제 확인 등)에서는 '지원 건' 같은 말을 쓰도록 UX가 정한다"
  - UX v4 머리글·D-UX-10: 화면 문구 개체 이름 = **"기업 JD"**("기업 JD 추가", "이 기업 JD를 삭제할까요?", C-16 "기업 JD 선택")
  - 데이터 v3 머리글: "지원 프로젝트(`application_projects`)는 지원 건 단위(화면 라벨 '기업 JD')" — PRD의 메뉴 라벨은 "기업 JD 관리"
  - PRD 8장 용어집에는 "기업 JD 관리 (메뉴)"만 있고 화면 표기 "기업 JD"가 없다
- 담당: product-planner
- 수정 제안: D-UX-10을 확정(UX 권고 (a) "기업 JD"를 받는다면 D-20 기각 사유와의 관계를 한 줄로 정리)하고 용어집에 "기업 JD (화면 표기) — 지원 프로젝트의 화면 이름. JD 원문은 화면에서 '공고 원문'으로 부른다" 같은 행을 추가한다. 확정 후 데이터 모델 머리글 표기("화면 라벨 '기업 JD'" → "메뉴 라벨 '기업 JD 관리', 화면 표기 '기업 JD'")는 리더가 data-architect에게 전달한다.
- 상태: open

### R-14 [Major] 저장 전 중단된 AI 작성 대화의 90일 자동 삭제가 PRD 개인정보 요구에 없다
- 경계: B10
- 근거:
  - 데이터 v3 3.4 "저장 전 대화(`project_id` null)로 남은 경우 … 마지막 활동 후 90일이 지나면 자동 삭제 `[가정]` → D-DM-08. 사용자에게 S-08 '작성 중인 AI 대화'에서 남은 기간 안내", 7장 Vercel Cron 배치
  - PRD NFR-PRV-06, D-27은 프로젝트에 묶인 대화만 다룬다
  - UX v4 S-08 "작성 중인 AI 대화" 행에 남은 기간 표시가 없다
- 담당: product-planner
- 수정 제안: D-DM-08을 결정하고 NFR-PRV-06에 "프로젝트와 연결되지 않은 대화는 마지막 활동 후 N일 뒤 자동 파기"를 추가한다(처리방침 고지 대상). 확정되면 리더가 ux-planner에게 S-08 남은 기간 표시("N일 뒤 자동 삭제")를 요청한다.
- 상태: open

### R-15 [Minor] UX v4: 지원 현황 이력 이름 미반영과 남은 `[확인 필요]` 표식 (U4-8, U4-12)
- 경계: B2
- 근거: S-39 데이터 줄 "이동 기록 `application_stage_events`(`application_project_id`, `from_stage`, `to_stage`, `created_at`)", "v2의 `application_status`(Could)는 이것으로 대체", D-UX-12 "`[확인 필요: data-architect]`(이벤트에 결과 기록 여부)" ↔ 데이터 v3 2.6 `event_type`(created/stage_changed/outcome_changed), `from_outcome`/`to_outcome`. C-13, S-13, S-08, S-10, S-11, S-34, S-35, C-01의 `[확인 필요]` 표식은 데이터 v3에서 모두 확정됐다.
- 담당: ux-planner
- 수정 제안: S-39 데이터 줄에 `event_type`, `from_outcome`/`to_outcome`을 넣고 `application_status` 언급을 지운다. D-UX-12 비고를 "이전 결과는 `application_stage_events.from_outcome`에 남음(데이터 v3 확정)"으로 바꾸고, 확정된 위치의 `[확인 필요]` 표식을 모두 지운다.
- 상태: open

### R-16 [Minor] 자소서·경력기술서 근거 표시에 교육과 상세 내용이 없다
- 경계: B2, B5
- 근거:
  - UX v4 C-11 자소서 문항별 목록 "`experience_id` + `project_id`(→ '회사명 › 프로젝트명' …)", S-19 확정 필드 목록도 같음. 경력기술서 행 "`drafts.options.included_experience_ids` / `included_project_ids`"
  - 데이터 v3 A.11 `draft_section_sources.education_id`, `project_detail_ids`, A.9 `included_education_ids`
  - AI v3 AI-04 출력 `sources[].detail_refs`, `education_ref`
- 담당: ux-planner
- 수정 제안: C-11 목록 라벨을 "회사명 또는 기관명 › 프로젝트명 › (사용한 상세 내용 제목)"으로 바꾸고 `education_id`, `project_detail_ids`를 데이터 열에 추가한다. 경력기술서 행에 `included_education_ids`를 추가한다.
- 상태: open

### R-17 [Minor] S-36 저장 동작의 쓰기 대상에 스킬이 빠져 있다
- 경계: B2
- 근거: UX v4 S-36 저장 "→ `projects`·`project_details`·`achievements` 쓰기, `writing_chats.status = 'saved'`, `saved_at`" ↔ 데이터 v3 3.3 `save_writing_chat` "W: `projects`, `project_details`, `achievements`, `skills`, `project_skills` + `writing_chats.status = 'saved'`, `project_id`, `saved_at`". UX 미리보기에는 "사용 기술"이 있다.
- 담당: ux-planner
- 수정 제안: 저장 동작에 스킬(`skills`, `project_skills`)과 `writing_chats.project_id`를 추가하고, 저장 확인 다이얼로그 요약에 "스킬 N개(새 스킬 M개)"를 넣는다.
- 상태: open

### R-18 [Minor] UX가 가정한 S-36 상호작용 2개에 AI 계약이 없다
- 경계: B5
- 근거:
  - UX v4 S-36 진행 단계 표시 "단계를 눌러 '이 부분부터 다시 물어봐 줘' 요청 `[가정]`", 자리 표시 "클릭 → AI에게 '이거 물어봐 줘'"
  - AI v3 AI-12: "대화 진행 규칙 (서버가 슬롯 순서를 결정)", 입력 `focus_slots`는 서버 계산값뿐이다. 자리 표시는 "정리 결과에만 표시"라 했지만 패치 스키마·`structured_draft`에 자리 표시 표현이 없다. UX 요청 1의 해당 질문에 답이 없다.
- 담당: ai-feature-designer
- 수정 제안: AI-12 입력에 "사용자 요청 슬롯 `requested_slot`(선택, 있으면 `focus_slots` 맨 앞)"을 추가하고, 화면 자리 표시는 "필수·권유 필드가 비어 있을 때 화면이 그리는 것(저장값 없음)"이라고 명시한다. 지원하지 않기로 하면 리더가 ux-planner에게 두 상호작용을 빼도록 전달한다.
- 상태: open

### R-19 [Minor] 신규 용어가 용어집에 없고, 회고 근거 칩 표시명이 문서마다 다르다
- 경계: B8
- 근거:
  - UX v4 C-01 "배운 점 구분 | `source_field = learnings`인 칩은 '배운 점 · 본인 회고' 라벨" ↔ AI v3 C-9 "근거 칩 표시명 '본인의 회고'", AI-04 같은 표기
  - UX 요청 product-planner 10: "대시보드 셸/왼쪽 메뉴", "답변지", "복귀 배너", "출처 발화", "연도 미정" / AI 요청 product-planner 8: "본인의 회고", "출처 발화" — PRD 8장에 없음
- 담당: product-planner
- 수정 제안: 용어집에 위 용어를 추가하고 회고 근거 칩 표시명을 하나로 정한다(권고: 화면 라벨은 "배운 점 · 본인 회고", 문서 용어는 "본인의 회고"). AI 문서는 확정 후 따른다.
- 상태: open

### R-20 [Minor] 민감정보로 걸러진 발화도 대화 원문(`writing_chat_messages.content`)에는 그대로 보관된다
- 경계: B10
- 근거: PRD NFR-PRV-05 "대화 중 AI는 민감정보로 보이는 내용을 정리 결과에 옮기지 않고 사용자에게 알린다 [가정]" / 데이터 v3 2.5 "민감정보로 걸러진 내용은 저장하지 않는다(개수만)"는 `structured_draft` 규칙이고, 메시지 원문은 D-27 (a)대로 계속 보관된다 / AI V-9g는 정리 결과에서만 제외
- 담당: product-planner
- 수정 제안: 요구사항을 정한다. (a) 원문은 사용자 데이터라 그대로 보관하고, 안내 문구에 "대화 기록에는 남아 있어요. 필요하면 대화를 삭제하세요"를 넣는다 (b) 감지된 구간을 메시지 원문에서도 가린다(데이터·AI 작업 추가). 권고 (a) — MVP 범위가 작고, 사용자가 대화만 따로 지울 수 있다.
- 상태: open

### R-21 [Minor] Should 항목 일부가 UX에서 MVP로 노출된다
- 경계: B9
- 근거: PRD 5.2 Should "F-P1-07, 08 / F-AP-04 / … F-P2-07 … F-COM-06, 07" ↔ UX v4 1.4 "F-P1-07 … S-08 규칙 기반 안내 1줄 `[가정]`", "F-AP-04 … S-31 헤더 이름·마감일 인라인 수정 `[가정]` (product 확인 대기)", "F-P2-07 '데이터 변경됨' 상태 표시만 `[가정]`", "F-COM-06, 07 … 실행 버튼 옆 '이번 달 N회 남음'은 MVP `[가정]`"
- 담당: product-planner
- 수정 제안: 네 항목 각각 "MVP에 포함하는 최소 범위"를 PRD 5.3 경계 항목 표에 적거나 Should로 되돌린다. 권고: "이번 달 N회 남음"과 "데이터 변경됨" 표시는 비용이 작고 한도 안내(6.4)와 붙어 있어 MVP에 포함, F-AP-04 인라인 수정·F-P1-07 1줄은 비용이 작으면 포함.
- 상태: open

### R-22 [Minor] 배운 점의 자소서 사용 범위가 PRD보다 넓다
- 경계: B9
- 근거: PRD F-DOC-09 비고 "'배운 점'이 있으면 **입사 후 포부 및 성장 계획** 문항에서 근거로 쓸 수 있다 [가정]" ↔ AI v3 C-9 "AI-04 자소서 | `future_plan`·`experience_story`·`motivation` 문항에서 회고 문장의 근거"
- 담당: product-planner
- 수정 제안: 범위를 정해 F-DOC-09를 고친다. 권고: AI 안(세 문항, 회고 표현으로만)을 수용. V-8과 표현 검사가 사실 근거로의 오용을 막는다.
- 상태: open

### R-23 [Minor] AI 작성 대화 차감 시점·단위 문구가 문서마다 다르다
- 경계: B11, B9
- 근거:
  - PRD 6.4 "AI 작성 대화 = 프로젝트 1건의 대화 1회. **대화를 시작할 때 차감**", "메시지 상한은 40개 [가정]"(정의 없음)
  - AI v3 C-6·AI-12 "첫 사용자 발화를 처리할 때 예약, 첫 턴 성공 시 확정", "40개 = 사용자 + AI 메시지 합계"
  - 데이터 v3 2.9 같은 규칙 + "보강 대화도 1회 `[가정]`(PRD 확인 대기)"
  - UX v4 S-36 "대화 시작(1회 사용 …)", "보강 모드도 같은 차감 `[가정]`", 한도 도달 시 "이어 하기는 가능 `[가정]`"
- 담당: product-planner
- 수정 제안: 6.4를 "첫 사용자 메시지에 대한 AI 응답이 성공했을 때 1회 차감(시작 화면만 열고 나가면 무차감). 기존 프로젝트 보강 대화도 대화마다 1회. 메시지 상한 40 = 사용자 + AI 합계. 한도 도달 시 새 대화만 막고 이어 하기·저장·폼 전환은 허용"으로 고친다.
- 상태: open

### R-24 [Minor] PRD F-P3-15 세션 상태 목록이 화면·데이터보다 적다
- 경계: B1
- 근거: PRD F-P3-15 "(1) 세션 목록에 … 상태(작성 중 / 채점 중 / 완료)" ↔ 데이터 v3 A.12 `status`(in_progress/evaluating/completed/**evaluation_failed**/**abandoned**), UX v4 S-37 "상태(작성 중 / 채점 중 / 완료 / 채점 실패 / 그만둠)"
- 담당: product-planner
- 수정 제안: F-P3-15 수용 기준에 "채점 실패(다시 채점 가능) / 그만둠"을 추가하고 "그만둠" 세션을 목록에 남길지(UX 요청 9의 `abandoned` 처리)를 함께 적는다.
- 상태: open

### R-25 [Minor] 데이터 모델 안에서 `message_count` 상한 CHECK 여부가 다르게 적혀 있다
- 경계: B2 (문서 내부)
- 근거: 데이터 v3 2.5 `writing_chats.message_count` 제약 "`CHECK (message_count <= 40)` `[가정]`" ↔ 8장 "상한이 확정되면 CHECK, 그전엔 RPC 검사만 `[가정]`", 11.1 요청 7 "상한 40 검사는 `append_writing_chat_message` RPC(+ 상한 확정 시 CHECK)"
- 담당: data-architect
- 수정 제안: 2.5 표 제약을 "RPC `append_writing_chat_message`에서 검사. 상한 확정 시 CHECK 추가"로 맞춘다.
- 상태: open

### R-26 [Minor] 데이터 모델 v3에 기능 ↔ 테이블 매트릭스가 없다
- 경계: B7
- 근거: 데이터 v3는 테이블마다 "관련 기능"을 적었지만(예: `educations` "F-P1-14"), PRD 5.1 Must 전체를 한 표로 대조하는 매트릭스가 없다. v3 신설 Must(F-P1-13~15, F-ST-01~05, F-P3-15, F-COM-10)의 테이블·RPC 대응을 한눈에 확인할 수 없다(리뷰에서는 개별 대조로 모두 대응 테이블이 있음을 확인했다. F-COM-10은 저장 데이터 없음).
- 담당: data-architect
- 수정 제안: "기능 ↔ 테이블·RPC 매트릭스" 절을 추가한다(PRD 5.1 Must 행 전체, 저장 데이터가 없는 기능은 "없음(보기)"으로 표기).
- 상태: open

---

## 통합 결정 목록 (모든 문서의 미결 `[결정 필요]`·확인 대기, 중복 제거)

분류: **사용자** = 사용자 요구 원문의 해석, 사용자가 직접 정하겠다고 한 것, 사업·개인정보 정책. **팀** = 문서 간 권고가 이미 일치하거나 설계 판단이라 product-planner(필요 시 담당자)가 확정하면 되는 것.

### 사용자 결정 (10)

| # | 질문 | 출처 | 선택지 | 권고 |
|---|------|------|--------|------|
| U-1 | 모의 면접 점수 산정 방식, 미응답 질문의 점수 반영 | PRD D-14·D-16, AI 4.3·D-AI-07, 데이터 8장, UX D-UX-09·5.2 | 사용자가 정의 (D-16: (a) 제출 금지 (b) 허용+경고 (c) 허용+점수 제외) | 사용자 정의 대기. 저장 구조·화면은 "점수 산정 방식 준비 중" 자리로 준비됨. 계산 주체는 서버(저장된 등급 기반)로 이미 수용. D-16은 (b), 점수 반영은 D-14와 함께 |
| U-2 | 상세 내용의 "Insights" 필드 이름 | brief 2차 리더 해석, PRD D-21 | (a) 배운 점 (b) 회고 (c) 느낀 점 (d) "인사이트" 유지 + JD 분석 이름 변경 | (a) 배운 점. 네 문서가 이미 이 이름으로 맞춰져 있다 |
| U-3 | 전형 종료 결과 종류 | PRD D-25, UX C-13, 데이터 8장 | (a) 최종 합격 / 불합격 (b) + 지원 철회 (c) + 입사 포기 | (a) 사용자 원문대로. 통계(F-ST-07) 만들 때 (b) 재검토. 스키마는 `withdrawn` 추가만으로 확장 가능 |
| U-4 | 왼쪽 메뉴 수 ("메뉴 3개"라 하고 4개를 나열) | brief 2차 리더 해석 `[가정]`, PRD F-COM-10 | (a) 4개(커리어 / 기업 JD 관리 / 모의 면접 / 지원 현황) (b) 3개(어느 하나를 다른 메뉴 안으로) | (a). 나열한 4개 모두 독립 화면으로 설계됨 |
| U-5 | 커리어 데이터가 부족할 때 면접 허용 범위 | brief 1차 리더 해석 `[결정 필요]`, PRD D-15·F-P3-13, AI C-1 | (a) 모두 차단 (b) 인사이트·서류·직무 면접 차단, 컬처핏 허용 (c) 모두 허용 | (b). 컬처핏은 JD만으로 시작, 프로필 없이도 허용 |
| U-6 | 지원 프로젝트 1개 = JD 1개, JD 교체 불가 | brief 1차 `[가정]`, PRD D-19 | (a) JD 필수·교체 불가 (b) 빈 지원 프로젝트 허용 (c) 교체 허용 | (a). 데이터 소유 키(`application_project_id`)가 이 전제 위에 있다 |
| U-7 | MVP 면접 유형 | brief 1차 `[가정]`, PRD F-P3-14 | (a) 직무 / 컬처핏(인성) 2종, 임원 면접 등은 보류 (b) 유형 추가 | (a). 보드의 인터뷰 열 2개(F-ST-04)와도 맞는다 |
| U-8 | 무료 한도와 AI 비용 정책 (AI 작성 대화 월 한도, 커리어 채팅 메시지 한도 포함) | PRD D-12·6.4, AI D-AI-10·요청 7, 데이터 2.9 | D-AI-10: (a) 대화 20회 (b) 10회 (c) 첫 달 20회 이후 10회 | 평균 비용 약 $1.61로 상한 $2 이내라 (a)로 시작하고 p90 관찰. 한도를 다 쓰는 사용자는 약 $7.83(약 3.9배)이므로 p90이 $3를 넘으면 (c). 커리어 채팅(Should) 메시지 한도는 출시 시 정함 |
| U-9 | AI 작성 대화 보관 기간 (프로젝트에 묶인 대화 / 묶이지 않은 대화) | PRD D-27·NFR-PRV-06, 데이터 D-DM-08·3.4, R-14 | 묶인 대화: (a) 계속 보관 + 대화만 삭제 (b) 저장 후 30일 자동 삭제 (c) 저장 즉시 삭제 / 묶이지 않은 대화: 마지막 활동 후 N일 자동 삭제 | 묶인 대화 (a), 묶이지 않은 대화 90일. 처리방침 고지 대상이라 사용자 승인 필요 |
| U-10 | v2부터 권고 유지 중인 PRD 결정 일괄 승인 | PRD 9.1 D-02, D-04, D-05, D-06, D-09, D-10, D-11, D-17, D-18 | 권고안 그대로 / 항목별 변경 | 권고안 일괄 승인(JD 텍스트 입력만, 커리어 채팅 Should, 인사이트 점수 없음, 질문 수 3/5/7, 매직 링크 + Google, 출시 전 약관 확인, 탈퇴 즉시 파기, 사용량 단위 6.4, 인사이트는 사용자가 시작) |

### 팀 해결 가능 (17) — product-planner 확정, 필요 시 해당 담당자

| # | 질문 | 출처 | 선택지 | 권고 |
|---|------|------|--------|------|
| T-1 | 지원 프로젝트의 화면 표기 | PRD D-20, UX D-UX-10, R-13 | (a) "기업 JD" (b) "지원 건" (c) "지원 프로젝트" | UX 권고 (a)를 받되 용어집에 화면 표기로 등록하고, JD 원문은 화면에서 "공고 원문"으로 구분 |
| T-2 | 연도 보기 규칙과 "연도 미정" 묶음 | PRD D-22, UX 요청 7, 데이터 2.4·8장 | (a) 시작 연도 한 번 (b) 경력·교육은 모든 활동 연도, 프로젝트는 시작 연도 (c) 연도 묶음 없음 | (b). 기간 없는 프로젝트는 소속의 시작 연도, 소속·기간 모두 없으면 "연도 미정" |
| T-3 | 프로젝트당 상세 내용 개수 | PRD D-23 | (a) 1개 (b) 여러 개(각각 제목) | (b). 네 문서가 이미 이 전제 |
| T-4 | STAR 결과와 성과(Achievement)의 관계 | PRD D-24 | (a) 결과 서술만 (b) 결과 = 서술 + 정량 성과 첨부 (c) 성과 개체 폐지 | (b). 수치 가드의 원천 |
| T-5 | 보드 정렬과 종료 카드 처리 | PRD D-26 | (a) 최근 이동순, 종료 카드 계속 표시 (b) + 30일 지난 종료 카드 접기 (c) 사용자 정렬 | (a) |
| T-6 | "폼으로 전환" 시 draft로 저장 | UX D-UX-11, 데이터 8장, R-04 | (a) 전환 확인 시 draft 저장 (b) 임시 폼 + 별도 저장 버튼 | (a). 데이터 RPC가 지원, AI 문서만 정렬 필요 |
| T-7 | 전형 종료에서 다른 열로 옮길 때 결과 처리 | UX D-UX-12, 데이터 8장 | (a) 확인 후 결과 지움 (b) 유지 | (a). 이전 결과는 이력에 남음 |
| T-8 | 좁은 화면의 보드 | UX D-UX-13, PRD 6.5 | (a) 열 탭 + 카드 메뉴 이동 (b) 가로 스크롤 + 드래그 | (a). PRD 6.5 "모바일은 카드 메뉴로 이동"과 맞음 |
| T-9 | 면접 답변란 여는 시점 / 점수 산정 전 표시 | UX D-UX-07·D-UX-09 | D-UX-07: (a) 전체 생성 후 (b) 생성된 것부터 / D-UX-09: (a) "준비 중" (b) 숨김 | 둘 다 (a). 데이터 모델에 이미 반영 |
| T-10 | AI 작성 대화 사용량 세부(차감 시점, 보강 대화 차감, 메시지 상한 정의, 한도 도달 시 이어 하기, CHECK 시점) | PRD 6.4, AI 요청 3·4, UX 요청 5·6, 데이터 2.9·8장, R-23·R-25 | — | 첫 턴 성공 시 1회, 보강 대화도 대화마다 1회, 40 = 사용자 + AI 합계, 한도 도달 시 이어 하기·저장·전환 허용, CHECK는 상한 확정 후 |
| T-11 | 배운 점의 자소서 사용 범위 | PRD F-DOC-09, AI C-9·요청 5, R-22 | (a) 입사 후 포부만 (b) 포부·경험 서술·지원 동기(회고 표현만) | (b) |
| T-12 | 인터뷰 팝업 세부 | PRD F-ST-04 `[가정]`, UX 요청 8·C-14 | 작성 중 세션 유형이 다를 때 / 같은 열로 다시 옮길 때 | 유형이 달라도 이어 쓰기를 먼저 안내(세션은 지원 프로젝트당 1개), 다시 옮기면 다시 표시, "다시 보지 않기" 없음 |
| T-13 | Should 항목의 MVP 노출 범위 | UX 1.4·요청 9, R-21 | F-AP-04 인라인 수정, F-P1-07 안내 1줄, F-P2-07 변경 표시, F-COM-07 남은 횟수, 완료 알림 인앱만 | 남은 횟수·변경 표시·인앱 알림은 MVP 포함, 인라인 수정·안내 1줄은 비용이 작으면 포함 |
| T-14 | 비동기 작업 실행 인프라 | AI D-AI-01 | (a) `after()` + 실행 시간 연장 (b) 큐/워크플로 서비스 (c) Edge Functions | (a)로 시작, 실패율 1% 넘으면 (b) |
| T-15 | 모델 전환 기준 (답변 평가, 대화 응답) | AI D-AI-02·D-AI-11 | Sonnet 고정 / 평가 세트 통과 시 Haiku / Haiku 고정 | 둘 다 "Sonnet으로 시작, 평가 세트 통과 시 Haiku" |
| T-16 | 완료 조건과 데이터 최소 기준 v3 | PRD F-P1-03·F-P1-15 `[가정]`, D-01, UX 5.2 | 상세 내용 = 제목 + 상황 + 행동, 프로젝트 = 이름 + 역할 + 완료 상세 내용 1개, D-01 = 완료 경력 1 + 완료 프로젝트 1(교육만으론 미충족) | 권고안대로 확정. 네 문서 정의가 일치 |
| T-17 | 민감정보로 걸러진 발화의 원문 보관 | R-20 | (a) 원문 보관 + 안내 (b) 원문에서도 가림 | (a) |

### 해소 확인 (재질문하지 않음)
D-03, D-07, D-08, D-13, D-AI-03~09, D-UX-01~06, D-UX-08, D-DM-06, D-DM-07 — PRD v3 9.2·9.3, AI v3 8장 해소 표, UX v4 5.1에서 해소로 기록됨. 문서 간 충돌 없음.

---

## 다음 라운드 안내 (리더 전달용)

- 담당자별 수정 요청
  - ai-feature-designer: R-01, R-02, R-04, R-05, R-09, R-10, R-11, R-18 (Critical 2)
  - ux-planner: R-03, R-06, R-07, R-08, R-15, R-16, R-17 (Critical 1)
  - product-planner: R-12, R-13, R-14, R-19~R-24 + 통합 결정 T-1~T-17 확정, U-1~U-10 사용자 질의
  - data-architect: R-25, R-26 (R-13 확정 후 머리글 표기 1줄)
- 재검토 범위: 수정된 문서가 닿는 경계만 다시 본다(라운드 2가 마지막. 남는 것은 "미해결"로 넘긴다).

---
---

# Resumate 기획 정합성 리뷰 (라운드 2 — 최종)

> 작성: spec-reviewer / 2026-10-24
> 검토 문서: PRD **v3.1**, UX **v4.1**, AI **v3.1**, 데이터 모델 **v3.1** (같은 경로)
> 라운드 1 본문(위)은 기록으로 남긴다. **이 절의 통합 결정 목록이 라운드 1의 목록을 대체한다.** 라운드 2가 마지막이므로 남은 항목은 "미해결(잔여)"로 리더에게 넘긴다.

## 요약

- 라운드 1 이슈 26건: **해결 23 / 부분 해결 3 (R-13, R-18, R-19) / 미해결 0**. 부분 해결 3건은 모두 한두 줄의 표기 정리만 남았다(Minor 수준).
- 라운드 2 신규 이슈 4건: **Major 2 (R-27, R-28) / Minor 2 (R-29, R-30)**. 남은 Critical 없음.
- UX 문서 정합성(“file changed on disk” 경고 확인): `02_ux-planner_flows.md` v4.1은 1~6장과 요청 절이 모두 온전하다. 절이 반쯤 적용된 흔적은 없다. 머리글·변경 이력·본문(C-05, C-09, C-11, C-15, S-36, S-39, C-17, 5장)이 서로 맞는다. 남은 문제는 (1) 머리글 기준 입력에 "데이터 모델 v2" 표기, (2) 문서 안에서 "수락은 화면 상태"와 "이어 하기 때 수락 상태 복원"이 함께 적혀 있는 것(R-27), (3) 이미 답이 나온 `[가정]`·요청 항목이 남은 것(R-18, R-30)뿐이다.
- 통합 결정: 팀 해결 가능 T-1~T-17은 **모두 PRD v3.1(9.1·9.2)과 각 문서에 확정 기록됨 → "확정"으로 이동**. 새 팀 항목 2건(T-18, T-19)은 R-27·R-28 수정으로 닫힌다. **사용자 결정 10건(U-1~U-10)이 최종 목록**이며 PRD 9.0과 일치한다.

## 라운드 1 이슈 재검토

| ID | 심각도 | 담당 | 판정 | 확인 근거 / 남은 일 |
|----|--------|------|------|---------------------|
| R-01 | Critical | ai | **해결** | AI-03 입력에 `included_education_ids`, 출력 `education_sections[]`(`education_ref`), 서버 머리글(기관명·과정명·기간·재학 상태), 저장 `section_kind = 'education'` + `education_id`, AI-11 교육 포함 파생. UX C-11 `included_education_ids`, 데이터 A.9·A.10과 일치 |
| R-02 | Critical | ai | **해결** | 패치 스키마 v2(`project_patches` / `detail_patches`, `detail_key` vs `detail_ref`, 숫자형, `start_month`/`end_month`, 최상위 `skills[]`) + 매핑표(`existing_detail_id`, `affiliation_suggestion.id`, `M-n` → UUID) + V-9h. 데이터 v3.1 2.5 "필드 키 = 컬럼명" 명확화와 일치. 단 소속 확정 위치는 신규 R-28 |
| R-03 | Critical | ux | **해결** | C-15 상태 4종(검토 필요 [수락][거절]), "본인 역할 확인 중" 배지, S-36 소속 칸 [연결]/[아니요], 저장·전환 확인에 "검토하지 않은 항목 N개". 수락 상태의 저장 위치는 신규 R-27 |
| R-04 | Major | ai | **해결** | AI-12 "폼으로 전환" = 사용자 세션 RPC `hand_off_writing_chat`이 커리어 테이블에 씀. 데이터 3.3·UX FL-14와 일치 |
| R-05 | Major | ai | **해결** | AI-07 응답 0개 → `score_status = 'not_scored'`, `unanswered_count = question_count`, 종합 피드백 없음. UX C-17 "답변이 없어 평가할 내용이 없어요" 추가 |
| R-06 | Major | ux | **해결** | S-36 "상세 내용 카드 — 기존(보강 모드)": 채워진 필드 읽기 전용, 빈 필드만, `existing_detail_id`, 저장 요약 "빈 칸 N개 채움". AI V-9h·데이터 save 규칙과 일치 |
| R-07 | Major | ux | **해결** | U4-1~U4-6, U4-11 반영(S-36 데이터 줄, S-08, S-10, C-15). 머리글 기준 입력의 "데이터 모델 v2" 한 곳만 남음 → R-30 |
| R-08 | Major | ux | **해결** | C-05 `affiliation_mode`(`keep_projects`/`delete_projects`), S-25 `get_account_deletion_summary()`, C-09 `hints`(`complete_project_detail`) 행 |
| R-09 | Major | ai | **해결** | C-1·C-3 `education_type`, `enrollment_status`. 옛 이름 0건(grep) |
| R-10 | Major | ai | **해결** | `project_id`, `experience_id`/`education_id`, `abandoned`, `structured_draft`, `sequence`, `writing_chat_messages.status`/`ai_job_id`, `M-n` → UUID, `[제안]` 표식 0건 |
| R-11 | Major | ai | **해결** | `project_detail_ids`, `education_id`, `reuse_reason`, 저장 매핑, V-7 범위(교육·`detail_refs` 상세 내용) |
| R-12 | Major | product | **해결** | F-COM-04·NFR-PRV-06: 상세 내용 삭제는 대화 기록에 영향 없음, 프로젝트 삭제 시 대화 삭제. 데이터 4.1·UX C-05와 일치 |
| R-13 | Major | product | **부분 해결** | PRD D-20 확정(화면 "기업 JD", JD 원문 "공고 원문"), 용어집 2행 추가, UX D-UX-10 일치. **잔여**: 데이터 모델 머리글 "(화면 라벨 '기업 JD')"를 "메뉴 라벨 '기업 JD 관리', 화면 표기 '기업 JD'"로(PRD v3.1 추가 요청, 데이터 8.1이 "미확정이라 그대로 둠"이라 적음 — 이제 확정). 담당 data-architect, 1줄 |
| R-14 | Major | product | **해결** | NFR-PRV-06에 미연결 대화 90일 자동 파기 `[가정]` + 남은 기간 표시, D-27이 D-DM-08 흡수(사용자 결정 U-9). UX S-08 "N일 뒤 자동 삭제"(확정 시 표시) |
| R-15 | Minor | ux | **해결** | S-39 `event_type`, `from_outcome`/`to_outcome`, `application_status` 언급 삭제, `[확인 필요]` 표식 0건 |
| R-16 | Minor | ux | **해결** | C-11 `education_id`, `project_detail_ids`(상세 내용 직접 지정 포함), `included_education_ids` |
| R-17 | Minor | ux | **해결** | S-36 저장 대상 `skills`·`project_skills`·`writing_chats.project_id`, 저장 요약 "스킬 N개(새 스킬 M개)" |
| R-18 | Minor | ai | **부분 해결** | AI-12에 `requested_slot` 추가(진행 단계·빈 필드에서 요청, 고정 문구 사용자 메시지로 전송, 메시지 상한 포함), "자리 표시는 저장값 아님" 명시. **잔여(UX)**: S-36 진행 단계·자리 표시 행이 아직 "`[가정]` — R-18 결과에 따라 유지/제거", 요청 절 ai-feature-designer 1번이 열린 채. 담당 ux-planner → R-30에 포함 |
| R-19 | Minor | product | **부분 해결** | PRD 용어집 추가(대시보드 셸, 답변지, 복귀 배너, 출처 발화, 연도 미정, 본인의 회고, 기업 JD, 공고 원문), 칩 라벨 "배운 점 · 본인 회고"로 통일, UX C-01 일치. **잔여(AI)**: AI C-9 "**화면**: `learnings` 근거 칩은 '본인의 회고'로 구분 표시", AI-04 "근거 칩 표시명 '본인의 회고'"가 화면 라벨로 남음 → "배운 점 · 본인 회고". AI 머리글 기준 입력도 "PRD v3"(v3.1 아님). 담당 ai-feature-designer, 2~3줄. "검토 필요" 용어(UX 제안)는 용어집에 없음 — 화면 상태명이라 필수 아님 |
| R-20 | Minor | product | **해결** | NFR-PRV-05 원문 보관 + 안내 문구, AI V-9g, 데이터 8.1 T-17 일치. UX 안내 문구 반영은 R-30 |
| R-21 | Minor | product | **해결** | PRD 5.3 "Should 항목의 MVP 최소 범위"(F-P1-07 1줄, F-AP-04 이름·마감일, F-P2-07 표시 + 다시 생성, F-COM-07 남은 횟수, 인앱 알림). UX 1.4 `[가정]`·"product 확인 대기" 표식 정리는 R-30 |
| R-22 | Minor | product | **해결** | F-DOC-09: 포부·지원 동기·경험 서술형, 회고 표현으로만. AI C-9와 일치 |
| R-23 | Minor | product | **해결** | 6.4: 첫 응답 성공 시 1회, 보강 대화도 1회, 40 = 합계, 한도 도달 시 새 대화만 차단. AI C-6·데이터 2.9·UX S-36 일치 |
| R-24 | Minor | product | **해결** | F-P3-15 상태 5종(채점 실패·그만둠 포함). UX S-37 일치(그만둠 위치는 R-30) |
| R-25 | Minor | data | **해결** | 2.5 `message_count`: `CHECK (>= 0)`, 상한은 RPC, 확정 시 CHECK. 8장·8.1과 일치 |
| R-26 | Minor | data | **해결** | 6.1 기능 ↔ 테이블·RPC 매트릭스(PRD 5.1 Must 전체) |

## 경계 재스캔 (수정이 닿은 경계)

| 경계 | 결과 | 이슈 |
|------|------|------|
| B1 Must → 화면 | 통과 | — |
| B2 화면 → 데이터 | 부분 실패: 수락 상태·소속 확정이 저장 위치 없이 화면 상태로 설계됨 | R-27, R-28 |
| B3 AI 입력 → 데이터 | 통과(AI-03 교육, AI-12 `structured_draft`, `sequence`, `status = 'done'` 필터) | — |
| B4 AI 출력 → 저장 | 부분 실패: AI-12 패치 v2 ↔ `structured_draft` 매핑은 맞음. 소속 확정 위치가 3문서에서 다름, V-9h를 RPC가 보장하지 않음 | R-28, R-29 |
| B5 AI 출력 → 화면 | 통과(검토 필요·본인 역할·소속 제안·교육 섹션·0응답 세션 표시). `requested_slot` UI 확정만 남음 | R-30 |
| B6 응답 모드 | 통과(변경 없음) | — |
| B7 기능 → 데이터 | 통과(6.1 매트릭스) | — |
| B8 용어 | 부분: AI 칩 라벨, 데이터 머리글 | R-13 잔여, R-19 잔여 |
| B9 MVP 범위 | 통과(PRD 5.3과 UX 1.4 내용 일치, 표식만 남음) | R-30 |
| B10 개인정보·삭제 | 통과(F-COM-04, NFR-PRV-05·06, 데이터 3.4·4.1 일치). 보관 기간 값은 사용자 결정 U-9 | — |
| B11 비용 | 통과. `requested_slot` 고정 문구 메시지는 상한 40에 포함되어 대화 상한 비용($0.19) 변동 없음 | — |

## 신규 이슈 (라운드 2)

### R-27 [Major] AI 작성 대화의 "검토 필요" 수락 상태를 어디에 저장하는지 정해지지 않았다
- 경계: B2, B4
- 근거:
  - UX v4.1 C-15 상태 ③: "수락 → 이 필드 경로를 **화면의** `accepted_review_paths`에 추가(저장 시 전달)". 같은 문서 S-36 상태: "이어 하기 진입: 기록·정리 결과·**수락 상태 복원**" — 화면에만 있는 상태는 복원할 수 없다. UX 요청 data-architect 1번이 이 질문을 열어 둠
  - 데이터 v3.1 3.3: "미리보기 필드 직접 수정·`needs_review` 수락 | 사용자 세션 | `writing_chats.structured_draft`"(수락을 저장한다는 뜻)인데, 같은 표의 저장 RPC는 `save_writing_chat(writing_chat_id, accepted_review_paths[])`로 수락 목록을 인자로 받는다. 필드 객체 `review`는 `ok` / `needs_review` 두 값뿐이라 "AI가 ok로 낸 것"과 "사용자가 수락한 것"을 구분할 수 없다
  - 폼 전환: 데이터 3.3 `hand_off_writing_chat(writing_chat_id)`에는 수락 인자도, `needs_review` 처리 규칙도 없다. AI v3.1 "`needs_review` 필드는 쓰지 않음 `[가정]`", UX v4.1 "수락하지 않은 `needs_review` 필드는 옮기지 않는다 `[가정]`"(수락한 것은 옮긴다는 뜻) — AI 요청 data-architect 1번이 같은 질문
  - PRD F-P1-13 (7) "그때까지 정리된 내용이 폼에 채워진 상태로 열린다"는 미수락 필드 처리를 정하지 않음
- 담당: data-architect (저장 구조가 기준. 확정 후 리더가 UX·AI 문구 정리를 전달)
- 수정 제안:
  1. 수락은 `structured_draft`에 저장한다: 필드 객체에 `review` 값 `accepted`를 추가(또는 수락 시 `review = 'ok'` + `reviewed_at`), 거절은 값 비움 + `review = 'ok'`. 쓰기는 사용자 세션.
  2. `save_writing_chat`·`hand_off_writing_chat` 모두 `structured_draft`의 `review`를 읽어 **미수락 `needs_review` 필드는 쓰지 않는다**로 통일하고, `accepted_review_paths` 인자는 없애거나 "화면이 저장 직전에 함께 보내는 최종 확인"으로만 정의한다.
  3. 확정 후 UX C-15 상태 ③ 문구("화면의 … 저장 시 전달")와 AI-12 저장 문단의 `[가정]`을 정리한다(T-18).
- 상태: open (라운드 2 신규, 다음 라운드 없음 → 리더에게 미해결로 넘김)

### R-28 [Major] 소속(경력/교육) 확정을 어디에 쓰는지 세 문서가 다르다
- 경계: B2, B4
- 근거:
  - 데이터 v3.1 2.5: `structured_draft.project` 키에 `experience_id`, `education_id` 포함. 3.3 save 규칙 "소속은 **`structured_draft.project`에 확정된** 경력·교육(사용자가 미리보기에서 확정한 것만)"
  - AI v3.1 매핑표: `affiliation_suggestion` "제안일 뿐, 사용자가 미리보기에서 확정해야 **`writing_chats.experience_id`/`education_id`**와 저장 소속이 된다". `project_patches[].field` 허용값에 `experience_id`/`education_id` 없음
  - UX v4.1 S-36 소속 칸: "[연결] → 소속 확정(사용자 세션 쓰기)", 시작 영역 "소속 선택 → `writing_chats.experience_id` / `education_id` … 여기서 고른 소속은 사용자가 확정한 것으로 본다". UX 요청 data-architect 2번이 이 질문
- 영향: 저장 RPC가 읽는 곳(`structured_draft.project`)과 화면이 쓰는 곳(`writing_chats` 컬럼)이 달라 확정한 소속이 저장되지 않는다.
- 담당: data-architect
- 수정 제안: 확정 소속의 단일 원천을 `writing_chats.experience_id` / `education_id`로 한다(이미 FK set null이고 시작 화면 선택과 같은 자리). `structured_draft.project`에서 `experience_id`/`education_id` 키를 빼고, save·hand_off 규칙을 "소속 = `writing_chats.experience_id`/`education_id`"로 고친다. [연결]은 컬럼을 채우고 `affiliation_suggestion`을 지운다, [아니요]는 제안만 지운다(T-19). AI·UX 문서는 이미 이 안과 같다.
- 상태: open (미해결로 넘김)

### R-29 [Minor] `apply_structured_draft_patch`의 역할과 V-9h 보장이 불분명하다
- 경계: B4
- 근거: 데이터 v3.1 2.5 "턴 처리와 사용자 수정이 겹치면 행 잠금 RPC `apply_structured_draft_patch`로 병합(`user_edit` 필드는 AI 패치가 덮어쓰지 않음)" — 기존 상세 내용의 채워진 필드 보호는 없다. AI v3.1 V-9h는 서버 검증에서 거부하고, 요청 data-architect 2번으로 RPC에도 같은 검사를 요청. UX v4.1 S-36 데이터 줄은 "미리보기 수정은 RPC `apply_structured_draft_patch`"라고 적어, 데이터 5장 RLS(사용자 세션은 `structured_draft` 직접 update, `app_ai_writer`는 패치)와 호출 주체가 엇갈린다.
- 담당: data-architect
- 수정 제안: 2.5에 RPC 정의를 한 줄로 적는다 — 호출 주체(AI 턴 = `app_ai_writer`, 사용자 수정·수락 = 사용자 세션, 둘 다 이 RPC로 행 잠금), 보장 규칙(`user_edit` 비덮어쓰기 + `augment_project`의 `existing_detail_id` 대상 필드가 기존 행에서 채워져 있으면 거부 = V-9h와 같음). save의 "빈 필드에만" 규칙이 최종 방어이므로 Minor.
- 상태: open (미해결로 넘김)

### R-30 [Minor] UX v4.1 정리: PRD v3.1·AI v3.1 확정 사항 미반영 표식
- 경계: B5, B8, B9
- 근거와 위치 (`02_ux-planner_flows.md`):
  1. 머리글 3행 기준 입력 "**데이터 모델 v2**" (4행은 v3 기준이라 적음)
  2. R-18 잔여: S-36 진행 단계 "`[가정]` — AI 명세 R-18(`requested_slot`) 결과에 따라 유지/제거", 자리 표시 "'AI에게 물어봐 줘' `[가정]`(R-18 결과에 따라)", 요청 절 ai-feature-designer 1~3번(AI v3.1이 모두 답함: `requested_slot` 지원, `existing_detail_id` 저장, 폼 전환 시 미수락 필드 제외 `[가정]`)
  3. C-01 칩 라벨 `jd_sentence` "JD 원문" → PRD 용어집 "공고 원문"(S-15는 이미 "공고 원문")
  4. S-36 민감정보 안내에 NFR-PRV-05 v3.1 문구 "대화 기록에는 남아 있어요. 필요하면 대화를 삭제하세요" 없음
  5. S-37 세션 목록: PRD F-P3-15 v3.1 "그만둠 세션은 아래쪽에 남기고 삭제 가능" 미반영
  6. 1.4·4.2 Should 항목 `[가정]`, "(product 확인 대기)" — PRD 5.3에서 확정됨
  7. `requested_slot` 버튼이 보내는 고정 문구 메시지가 상한 40에 포함된다는 안내(입력창 "n / 40")
- 담당: ux-planner
- 수정 제안: 위 7곳을 확정 내용으로 바꾸고 `[가정]` 표식을 지운다. 구조 변경 없음.
- 상태: open (미해결로 넘김)

## 미해결로 넘기는 항목 (리더 전달)

| ID | 심각도 | 담당 | 남은 일 |
|----|--------|------|---------|
| R-27 | Major | data-architect | 검토 수락 상태를 `structured_draft`에 저장, save·hand_off 모두 미수락 `needs_review` 제외로 통일 → UX C-15·AI-12 문구 정리 |
| R-28 | Major | data-architect | 확정 소속의 원천을 `writing_chats.experience_id`/`education_id`로 단일화, `structured_draft.project`에서 소속 키 제거 |
| R-29 | Minor | data-architect | `apply_structured_draft_patch` 호출 주체·보장 규칙(V-9h 포함) 명시 |
| R-30 | Minor | ux-planner | 표식·문구 7곳 정리(R-18 잔여 포함) |
| R-13 잔여 | Minor | data-architect | 머리글 화면 표기 1줄 |
| R-19 잔여 | Minor | ai-feature-designer | C-9·AI-04 칩 표시명 "배운 점 · 본인 회고", 머리글 PRD v3.1 |

R-27·R-28은 구현 전에 데이터 모델 한 절(2.5·3.3)만 고치면 닫히고, UX·AI는 이미 R-28 안과 같은 방향이다. Critical은 없다.

## 통합 결정 목록 (라운드 2 최종 — 라운드 1 목록 대체)

### 사용자 결정 (최종 10건) — PRD 9.0과 일치

| # | 질문 | 출처 | 선택지 | 권고 |
|---|------|------|--------|------|
| U-1 | 모의 면접 점수 산정 방식과 미응답 질문의 점수 반영 | PRD D-14·D-16, AI 4.3, 데이터 A.12, UX C-17 | 산식: 사용자 정의 / 미응답: (a) 제출 금지 (b) 허용+경고 (c) 허용+점수 제외 | 산식은 사용자 정의 대기(저장 구조·"점수 산정 방식 준비 중" 화면 준비됨, 계산은 서버가 저장된 등급에서). 미응답은 (b) |
| U-2 | 상세 내용의 "Insights" 필드 이름 | PRD D-21 | (a) 배운 점 (b) 회고 (c) 느낀 점 (d) "인사이트" 유지 + JD 분석 이름 변경 | (a) 배운 점 — 네 문서가 이미 이 이름 |
| U-3 | 전형 종료 결과 종류 | PRD D-25 | (a) 최종 합격 / 불합격 (b) + 지원 철회 (c) + 입사 포기 | (a) 사용자 원문대로. 통계 기능 때 (b) 재검토 |
| U-4 | 왼쪽 메뉴 수("3개"라 말하고 4개 나열) | PRD F-COM-10 | (a) 4개 (b) 3개로 합침 | (a) 커리어 / 기업 JD 관리 / 모의 면접 / 지원 현황 |
| U-5 | 커리어 데이터가 부족할 때 면접 허용 범위 | PRD D-15 | (a) 모두 차단 (b) 인사이트·서류·직무 면접 차단, 컬처핏 허용 (c) 모두 허용 | (b) |
| U-6 | 지원 프로젝트 1개 = JD 1개, JD 교체 불가 | PRD D-19 | (a) JD 필수·교체 불가 (b) 빈 지원 프로젝트 허용 (c) 교체 허용 | (a) |
| U-7 | MVP 면접 유형 | PRD F-P3-01·F-P3-14 | (a) 직무 / 컬처핏 2종, 그 외 보류 (b) 유형 추가 | (a) |
| U-8 | 무료 한도·AI 비용 정책(AI 작성 대화 월 한도 포함) | PRD D-12·6.4, AI D-AI-10 | 대화 월 한도 (a) 20회 (b) 10회 (c) 첫 달 20회 이후 10회 | (a)로 시작, 1인당 비용 p90이 US$3를 넘으면 (c). 평균 약 US$1.61(상한 $2 이내), 한도를 다 쓰면 약 US$7.83. 커리어 채팅(Should) 메시지 한도는 출시 시 |
| U-9 | AI 작성 대화 보관 기간 | PRD D-27·NFR-PRV-06, 데이터 3.4 | 프로젝트에 묶인 대화: (a) 계속 보관 + 대화만 삭제 가능 (b) 저장 후 30일 삭제 (c) 저장 즉시 삭제 / 묶이지 않은 대화: 마지막 활동 후 N일 자동 삭제 | 묶인 대화 (a), 묶이지 않은 대화 90일. 처리방침 고지 대상 |
| U-10 | v2부터 유지 중인 PRD 권고 일괄 승인 | PRD D-02, D-04, D-05, D-06, D-09, D-10, D-11, D-17(단위 전체), D-18 | 권고안 일괄 승인 / 항목별 변경 | 일괄 승인(JD 텍스트만, 커리어 채팅 Should, 인사이트 점수 없음, 질문 수 3/5/7, 매직 링크 + Google, 출시 전 약관 확인, 탈퇴 즉시 파기, 사용량 단위 6.4, 인사이트는 사용자가 시작) |

### 팀 결정 — 확정 (라운드 1의 T-1~T-17, 문서 반영 확인)

| # | 내용 | 확정 위치 |
|---|------|-----------|
| T-1 | 화면 표기 "기업 JD", JD 원문은 "공고 원문" | PRD D-20·용어집, UX D-UX-10 (데이터 머리글 1줄 잔여 — R-13) |
| T-2 | 연도 보기 (b) + 기간 없으면 소속 시작 연도, 둘 다 없으면 "연도 미정" | PRD D-22·F-P1-09, 데이터 8.1 |
| T-3 | 상세 내용 여러 개 | PRD D-23 |
| T-4 | 결과 = 서술 + 정량 성과 | PRD D-24 |
| T-5 | 보드 최근 이동순 | PRD D-26, UX S-39 |
| T-6 | 폼 전환 시 draft 저장(`hand_off_writing_chat`) | PRD 9.2, UX D-UX-11, AI-12, 데이터 8.1 |
| T-7 | 종료에서 나가면 결과 지움, 이력에 보존 | PRD 9.2, UX D-UX-12, 데이터 8.1 |
| T-8 | 좁은 화면 보드 = 열 탭 + 카드 메뉴 | PRD 9.2, UX D-UX-13 |
| T-9 | 답변란은 전체 생성 후 / 점수 "준비 중" | PRD 9.2, UX D-UX-07·09, 데이터 8.1 |
| T-10 | 대화 차감: 첫 응답 성공 시 1회, 보강도 1회, 40 = 합계, 한도 시 새 대화만 차단, CHECK는 상한 확정 후 | PRD 6.4·D-17, AI C-6, 데이터 2.5·2.9, UX S-36 |
| T-11 | 배운 점 자소서 사용: 포부·지원 동기·경험 서술형, 회고 표현만 | PRD F-DOC-09, AI C-9 |
| T-12 | 인터뷰 팝업: 이어 쓰기 우선, 다시 옮기면 다시 표시 | PRD F-ST-04, UX C-14 |
| T-13 | Should 항목 MVP 최소 범위 | PRD 5.3 (UX 표식 정리 R-30) |
| T-14 | 비동기 인프라: `after()`로 시작 | PRD 9.2, AI D-AI-01 |
| T-15 | 답변 평가·대화 응답 모델: Sonnet 시작, 평가 세트 통과 시 Haiku | PRD 9.2, AI D-AI-02·11 |
| T-16 | 완료 조건·D-01 v3 | PRD D-01·F-P1-15, 데이터 8.1 |
| T-17 | 민감정보 걸러진 발화의 원문 보관 + 안내 | PRD NFR-PRV-05, AI V-9g, 데이터 8.1 (UX 문구 R-30) |

### 팀 결정 — 신규, 이슈 수정으로 닫힘 (사용자 질의 불필요)

| # | 질문 | 권고 | 닫는 이슈 |
|---|------|------|-----------|
| T-18 | 폼 전환 때 수락하지 않은 "검토 필요" 필드를 옮길까 | 옮기지 않는다(저장과 같은 규칙). 근거 없이 바뀐 표현이 확인 없이 커리어 데이터에 들어가지 않게 함. PRD F-P1-13 (7)에 "검토하지 않은 항목은 옮기지 않는다" 한 줄 추가는 product-planner | R-27 |
| T-19 | 확정 소속을 어디에 쓸까 | `writing_chats.experience_id` / `education_id` 단일 원천 | R-28 |

---
---

# 확인 패스 (2026-10-24)

> 작성: spec-reviewer. 정식 라운드가 아니라 확인 패스다. 대상: PRD **v3.2**, UX **v4.2a**(문서 제목은 "v4.2", 변경 이력에 v4.2a 행), AI **v3.2**, 데이터 모델 **v3.2**, `00_input/brief.md` "사용자 결정 (2026-10-24)". 문서는 고치지 않았다.

## 1. 미해결 6건 재확인

| 항목 | 해결 | 네 문서 대조 결과 |
|------|------|-------------------|
| R-27 검토 수락 상태 | **예** | 데이터 2.5: `review` ∈ `ok` / `needs_review` / `accepted` + `reviewed_at`, 거절 = `value = null` + `review = 'ok'`. 저장·전환 모두 `review in ('ok','accepted')`만 씀. 3.3 `save_writing_chat(writing_chat_id)`(인자 삭제, V32-2). UX FL-14·C-15 상태 ③(수락 → `accepted` + `reviewed_at`, 이어 하기 때 복원, 거절 → AI가 다시 물음). AI-12 매핑표·저장 문단 같음. PRD F-P1-13 (8) "미수락 필드는 반영하지 않는다" |
| R-28 소속 확정 위치 | **예** | 데이터: `structured_draft.project`에서 소속 키 삭제, 단일 원천 `writing_chats.experience_id`/`education_id`, RPC `set_writing_chat_affiliation(writing_chat_id, experience_id, education_id)`가 제안도 지움. UX S-36 시작 영역·소속 칸, AI-12 매핑표가 같은 RPC |
| R-29 패치 RPC | **예** | 데이터 2.5 `apply_structured_draft_patch(writing_chat_id, patch)`: `structured_draft` 직접 update 권한 없음, AI 턴 = `app_ai_writer` / 사용자 수정·수락 = 사용자 세션, `user_edit`·`accepted` 보호, **V-9h 보장(AI·사용자 공통)**. AI V-9h "RPC가 강제", UX S-36 데이터 줄·C-15 일치. 5장 RLS 표도 갱신 |
| R-30 UX 정리 7곳 | **예** (머리글 잔여는 R-32) | `requested_slot` `[가정]` 제거, C-01 `jd_sentence` "공고 원문", 민감정보 안내 문구, S-37 그만둔 세션 아래쪽, 1.4·4.2 `[가정]` 제거, 상한 안내 반영. 다만 머리글 기준 입력 3행 "PRD v3", 4행 "PRD v3.1 기준"(현재 PRD v3.2), 제목 "v4.2"(변경 이력은 v4.2a) |
| R-13 잔여 | **예** | 데이터 머리글: 메뉴 라벨 "기업 JD 관리", 화면 표기 "기업 JD", JD 원문 "공고 원문" |
| R-19 잔여 | **예** (사소한 흔적은 R-33·R-35) | U-2로 칩·필드 라벨이 "회고 및 배운 점" 하나로 정리됨. PRD 용어집·539행 "'배운 점 · 본인 회고' 라벨 폐기", UX C-01 "회고 및 배운 점 라벨만", AI C-9 "칩 표시명 '회고 및 배운 점'", 문서 용어 "본인의 회고"는 성격 구분용으로만 남음. 흔적: AI 변경 이력 v3.2 행 "칩 '회고 및 배운 점 · 본인 회고'", 데이터 333행 "(본인 회고 표시)" |

`return_target` + `get_data_readiness` `next_action`/`suggested_mode`(U-5 계약)도 데이터 6장·2.5, AI-12 게이트 진입, UX C-09·FL-13·C-10에서 같은 흐름이다: `writing_chat`(`new_project` / `augment_project` + `suggested_project_id`) 또는 `form`(완료 경력 없음 → S-09 → 다시 판정 → S-36), 대화 시작 시 `return_target` 저장, 저장·전환 후 재판정 → 복귀 시 비움. 폼만 거친 복귀는 브라우저 세션.

## 2. 사용자 결정 U-1~U-10 반영

| # | 사용자 답 | 반영 | 비고 |
|---|-----------|------|------|
| U-1 | 산식 대기 | **예** | PRD 9.0: `[결정 필요]`는 D-14 하나. D-16 (b) `[가정]`. AI 4.3·UX C-17 "점수 산정 방식 준비 중". 단 AI 본문에 해소된 D-AI-01·D-AI-02의 `[결정 필요]` 태그가 남음 → R-33 |
| U-2 | 회고 및 배운 점 | **예** | PRD F-P1-15·NFR-AI-06·용어집, UX S-35·C-01·S-36, AI C-9·AI-04/05/06/12, 데이터 표시명(컬럼 `learnings` 유지). UX 745행 비고 "D-21 `[가정]`" 흔적 → R-32 |
| U-3 | 최종 합격 / 불합격 | **예** | `stage_outcome` passed / failed, UX C-13 |
| U-4 | 4개 | **예** | F-COM-10, L-01 |
| U-5 | AI 채팅으로 해결 | **부분** | 게이트 → AI 작성 대화 → 복귀, 경력 미완료면 폼 먼저, 컬처핏 예외 `[가정]`은 네 문서 일치. 어긋난 곳 2건: PRD F-AP-06 (2) "대화는 이 지원 프로젝트의 JD를 참고해 관련 있을 만한 경험부터 묻는다 `[가정]`" ↔ AI-12 입력 "다른 프로젝트의 내용, **JD, 지원 프로젝트 데이터는 넣지 않는다**"(→ R-31 Major). PRD 9.1 D-15 행이 아직 "(b) v2 유지"로 차단 방식만 적음(→ R-34) |
| U-6 | JD 필수·교체 불가 | **예** | D-19, DM-12 |
| U-7 | 직무 / 컬처핏 | **예** | F-P3-01·14, `interview_type` |
| U-8 | 10회 | **예** | PRD 6.4·D-12, 데이터 `usage_limits.writing_chat = 10`, AI D-AI-10·7.3(한도 최대 $5.93), UX S-36 "{N}/10회"·ST-LIMIT |
| U-9 | 계속 보관 + 대화만 삭제 | **예** | PRD D-27, 데이터 3.4·4.4, UX S-10·C-05. 90일 자동 삭제는 네 문서 모두 `[가정]`. PRD NFR-PRV-06 "대화 기록만 따로 지울 수 있다 `[가정]`" 태그 흔적 → R-34 |
| U-10 | 일괄 승인 | **예** | PRD 9.1 D-02·04·05·06·09·10·11·17·18 확정 |

## 3. 이번 수정으로 생긴 문제

### R-31 [Major] 게이트에서 시작한 AI 작성 대화가 JD를 참고하는지 PRD와 AI가 다르다
- 근거: PRD F-AP-06 (2) "대화는 이 지원 프로젝트의 JD를 참고해 관련 있을 만한 경험부터 묻는다 `[가정]`", PRD 요청(ai-feature-designer) "F-AP-06에서 시작한 AI 작성 대화는 지원 프로젝트의 JD를 참고해 관련 경험부터 묻게" ↔ AI v3.2 AI-12 입력 표 끝 "다른 프로젝트의 내용, JD, 지원 프로젝트 데이터는 넣지 않는다", 게이트 진입 컨텍스트는 `return_target` + `missing`·`suggested_mode`뿐. UX C-09는 "인사이트 보완점에서 왔으면 관련 요건을 대화 시작 맥락으로 표시"(화면은 PRD 쪽).
- 담당: ai-feature-designer (범위는 PRD가 기준)
- 수정 제안: AI-12 입력에 "게이트 진입 시에만: `return_target.application_project_id`의 `jd_requirements.content`(`importance = high` 또는 보완점 대상 요건) 목록 — `focus_slots`와 질문 주제 선택에만 사용, 출처 아님"을 추가하고, "JD를 넣지 않는다" 문장을 "게이트 진입 외에는"으로 좁힌다. 질문에 사실을 넣지 않는 규칙과 V-9a(사용자 발화만 출처)는 그대로라 날조 위험은 늘지 않는다. 비용은 턴당 입력 0.2k~0.5k 증가.

### R-32 [Minor] UX: AI가 보낸 게이트 화면 요청 미반영 + 머리글·태그 흔적
- 근거: AI v3.2 요청(ux-planner) 1 "AI-12 화면 상단에 '{원래 기능}을 위해 필요한 내용: …' 배너와 부족 항목, D-01 충족 예상 시 '저장하고 돌아가기' 강조 … 대화 한도(10회) 소진 시 직접 입력만" — UX S-36에 해당 배너·강조가 없고, C-09에 한도 소진 시 동작이 없다. 요청 4 "실패 응답 '다시 보내기'(무차감·메시지 수 미증가 `[가정]`)"도 S-36 "실패한 턴" 행에 없음. 그런데 UX 끝 절은 "열린 항목 없음". 그 밖에 머리글 3·4행(PRD v3 / v3.1 기준), 제목 v4.2 ↔ 이력 v4.2a, S-35 비고 "D-21 `[가정]`", FL-05 "완료 판정 `[가정]`(PRD v3)"(T-16 확정).
- 담당: ux-planner
- 수정 제안: S-36에 게이트 진입 배너(원래 기능 + 남은 부족 항목, `ready_to_return`이면 "저장하고 돌아가기" 강조), C-09에 "AI 작성 대화 한도 소진 → 주 버튼을 '직접 입력'으로" 상태, 실패 턴 재시도 무차감·메시지 수 미증가 문구를 넣고 머리글·태그를 PRD v3.2 기준으로 정리.

### R-33 [Minor] AI: 해소된 결정의 태그와 지난 요청이 남아 있다
- 근거: C-6 "실행 인프라 `[결정 필요]` D-AI-01"(8장은 T-14 확정), AI-06 "Haiku 전환은 … `[결정 필요]` D-AI-02"(T-15 확정) — "남은 결정은 D-14뿐"과 충돌. AI-12 게이트 사용량 "`[가정]` — product 확인 대기"와 요청(product-planner) 1번은 PRD F-AP-06 (5) "AI 작성 대화의 사용량은 대화 규칙대로 차감"으로 이미 답이 났음. 요청(ux-planner) 2·3번과 4번 일부는 UX v4.2a에 반영됨. 머리글 기준 입력이 PRD v3.1·데이터 v3.1(현재 v3.2). 변경 이력 v3.2 행의 칩 표기 "회고 및 배운 점 · 본인 회고".
- 담당: ai-feature-designer
- 수정 제안: 두 `[결정 필요]`를 "확정"으로, 게이트 차감 `[가정]` 제거, 답 받은 요청 삭제, 머리글·변경 이력 표기 정리.

### R-34 [Minor] PRD: U-5·U-9 반영 흔적
- 근거: 9.1 D-15 행 "**(b)** v2 유지. 컬처핏은 프로필이 없어도 허용"(인사이트·서류·직무 면접 "차단" 선택지 그대로, U-5의 "AI 대화로 채우고 복귀"는 F-AP-06에만 있음). NFR-PRV-06 "사용자는 대화 기록만 따로 지울 수 있다 [가정] (v3)" — U-9로 사용자 확정. 요청(data-architect) "복귀 대상 … 기존 '브라우저 세션 저장' 가정 유지 가능" — 데이터 v3.2는 `return_target`(DB)로 정함.
- 담당: product-planner
- 수정 제안: D-15 행을 "확정 2026-10-24 (사용자, U-5): 미달이면 해당 AI 기능 대신 AI 작성 대화로 채우고 복귀(F-AP-06). 컬처핏 예외는 `[가정]`"으로, NFR-PRV-06 해당 `[가정]` 삭제, 데이터 요청 문구를 "`writing_chats.return_target`(데이터 모델 v3.2)"로.

### R-35 [Minor] 데이터: 준비도 예시·기능 키·머리글 흔적
- 근거: 6장 `get_data_readiness()` JSON 예시에 새 필드 `next_action`, `suggested_mode`, `suggested_project_id`가 없다(본문 설명에만 있음). `features`의 키는 `insight` / `draft` / `job_interview`인데 `return_target.feature`는 `insight` / `career_description` / `cover_letter` / `job_interview` — `draft` ↔ 두 값의 대응이 적혀 있지 않다. 머리글 기준 입력이 PRD v3·UX v4·AI v3. 2.8 "'회고 및 배운 점' 칩(본인 회고 표시)" — PRD는 별도 표식을 폐기.
- 담당: data-architect
- 수정 제안: JSON 예시에 세 필드 추가, "`return_target.feature`의 `career_description`·`cover_letter`는 readiness `draft`로 판정" 한 줄, 머리글·2.8 표기 정리.

새 Critical 없음. R-31 외에는 표기·태그 정리 수준이다.

## 4. 남은 열린 항목 (최종)

### `[결정 필요]` (사용자)
| 항목 | 내용 | 현재 처리 |
|------|------|-----------|
| D-14 | 모의 면접 점수 산정 방식(산식) | 사용자 정의 대기. 저장 구조(점수 슬롯)·화면("점수 산정 방식 준비 중")·계산 주체(서버, 저장된 등급 기반)는 준비됨 |

### 주요 `[가정]` (확정 전, 사용자가 바꾸면 따름)
| 항목 | 가정 | 출처 |
|------|------|------|
| D-16 | 미응답 제출 허용 + 경고, 점수 반영은 D-14와 함께 | PRD 9.0 |
| F-P3-13 / D-15 일부 | 데이터 부족해도 컬처핏 면접은 JD만으로 시작 허용 | PRD 9.0, UX C-09, AI C-1 |
| D-DM-08 / NFR-PRV-06 | 프로젝트와 연결되지 않은 AI 작성 대화 마지막 활동 후 90일 자동 삭제(처리방침 고지 전 확정 필요) | PRD, 데이터 3.4 |
| 6.4 | AI 작성 대화 외 무료 한도(인사이트 10, 초안 20, 면접 5), 메시지 상한 40(사용자 + AI 합계) | PRD 6.4, 데이터 2.5 |
| F-AP-06 (2) | 게이트 대화가 JD를 참고해 관련 경험부터 묻기(R-31로 AI 반영 필요) | PRD |
| 커리어 채팅(Should) 월 메시지 한도 | 출시 시 정함 | PRD D-12, AI 요청 |
| 그 밖 | 성능 목표(6.3), 지표 목표치(7장), V-9e 겹침 40% 등 AI 품질 임계값, 평가 세트 규모 | 각 문서 |

---
---

# BYOK 리뷰 라운드 1 (2026-10-26)

> 작성: spec-reviewer. 새 리뷰 주기(BYOK)의 라운드 1. 대상: PRD **v4**, UX **v5**, AI **v4**, 데이터 모델 **v4**. 기준: `00_input/brief.md` "기획 변경 3차: BYOK"(확정 사항 = 사용자 범위: BYOK 전용, 공급자 3개, AI는 선택, 사용량 표시는 **미터 + 한도 초과 안내 두 가지만**, 예산 상한·응답 헤더 실시간 한도 표시·관리자 키 잔액 조회 제외). 문서는 고치지 않았다. 이슈 번호는 R-36부터 잇는다.

## 요약

- 이슈 **9건: Critical 0 / Major 3 / Minor 6**
- 담당별: ux-planner 2 (M1·m1) / ai-feature-designer 2 (M1·m1) / product-planner 3 (M1·m2) / data-architect 2 (m2)
- 데이터 모델 v4의 rename(U5-1~U5-14, A4-1~A4-12)은 UX v5·AI v4에 **반영되지 않았다**(두 문서가 데이터 v3.2를 기준으로 먼저 나옴). 담당별 1건씩(R-36, R-37)으로 묶었다.
- 사용자 범위 준수: 예산 상한(F-AI-12)·실시간 헤더 한도(F-AI-13)·관리자 키 잔액(F-AI-14)은 네 문서 모두 **Won't/제외**로 일치하고 화면 자리도 없다. 서비스 무료 한도·차감·"N회 남음"·D-12는 PRD·UX·데이터에서 폐기 확인(잔여 문구 2곳은 R-37·R-43). 범위를 조금 넘는 표시 3건은 사용자 결정으로 올렸다(R-44, UB-2·UB-3).
- 사용자 결정: **4건**(UB-1~UB-4).

## 경계별 결과

| 경계 | 결과 | 이슈 |
|------|------|------|
| B1 PRD Must → 화면 | 통과. F-AI-01~09가 S-40·S-41·S-42·C-18~C-21에 매핑. 키 없는 동작(PRD 3.3) 9행 모두 UX C-18 진입점 표·S-15·S-33·C-14 변형으로 대응 | — |
| B2 화면 → 데이터 | 실패: U5 rename 미반영, 세션 목록 "실행 공급자" 원천 없음, 미터 공급자 필터용 집계 없음 | R-36, R-40, R-41 |
| B3 AI 입력 → 데이터 | 통과(게이트 대화 요건 목록 = `jd_requirements`, R-31 해소) | — |
| B4 AI 출력 → 저장 | 실패: A4 rename 미반영(`meter_feature`, 단가 컬럼, `key_validation`) | R-37 |
| B5 AI 출력 → 화면 | 부분: 재시도 정책 값이 문서마다 다름 | R-39 |
| B6 응답 모드 | 통과. 키 확인 동기(유료 5초 / 무료 10초 — UX는 "최대 5초"만, R-41), 무료 등급 순차 + `next_run_at` 예약 | R-41 |
| B7 기능 → 데이터 | 통과(데이터 6.1에 F-AI-01~09 행) | — |
| B8 용어 | 부분: "연결 확인"·"실행 공급자"·"키 연결 단계" 용어집 미등록 | R-42 |
| B9 MVP 범위 | 부분: 미터 표시 범위·공급자 출시 게이트가 사용자 원문보다 넓거나 좁음 | R-44 |
| B10 개인정보·삭제·키 보안 | 통과(봉투 암호화 + 외부 KMS, 암호 컬럼 grant 없음, `app_key_reader` + 실행 중 작업에 묶인 `get_provider_key_secret`, 즉시 hard delete, 동의 철회 기록, 탈퇴 집계 포함). 사용 기록 보관 13개월이 PRD 보유 표에 없음 | R-42 |
| B11 비용 | 통과. 운영자 AI 비용 0, 운영자 상한·한도 개념 삭제. AI 7장은 미터 규모 추정으로만 남음 | — |

## 집중 점검 결과

| 항목 | 결과 |
|------|------|
| 키 없는 동작 PRD 3.3 ↔ UX C-18 ↔ 데이터 `ai_connection` | 화면별 동작은 일치(기존 결과 열람·편집 유지 D-36, 보드·폼·공고 원문 키 불필요, 미터 빈 상태). 데이터는 `get_data_readiness().ai_connection{active_provider, key_status, connection_tier}`와 "키 없음·무효면 `next_action = form`"을 제공하는데 UX C-18·C-09가 이 필드를 판정 원천으로 적지 않음 → R-41 |
| 키 생애주기(등록·확인·교체·삭제·동의·활성 공급자) | PRD F-AI-01~04 ↔ UX S-40/S-41/FL-20 ↔ 데이터 `save_provider_key` / `record_provider_key_check` / `mark_provider_key_invalid` / `delete_provider_key` / `set_active_ai_provider`, `ai_data_use_consents`, `profiles.active_ai_provider`(FK set null, 자동 전환 없음) 일치. **불일치 1건**: 등록 검증 중 429·일일 한도일 때 저장 여부 → R-38 |
| 사용량 미터 AI C-13 ↔ `ai_usage_records`·`get_ai_usage_summary` ↔ UX S-42 | 필드 구성은 일치. 이름 불일치(A4·U5) → R-36·R-37. S-42 "가격표 기준일"은 `effective_from`이 아니라 `source_checked_at`(U5-7). 공급자 행 → 기능 표 거르기는 집계에 없음 → R-41 |
| 오류 분류 AI C-11 ↔ `error_code`/`error_category`/`failure_cause` ↔ UX C-20 | 7원인 의미는 일치. 값 이름 `invalid_key`·`model_unavailable`(UX) ↔ `key_invalid`·`model_not_available`(데이터·AI), UX의 시스템 원인 `error_category` 3범주 ↔ 5값(`system` 등), `key_missing`(실행 중 키 삭제) 화면 상태 없음 → R-36 |
| 무료 등급 순차 모드 | AI C-12 ↔ 데이터 `ai_jobs.connection_tier`·`next_run_at`·`progress.waiting_retry_until` ↔ UX C-03 일치. 재시도 횟수만 불일치 → R-39 |
| 운영비 개념 잔여 | PRD: 폐기 정리 완료. UX: S-36 데이터 줄 `usage_event_id`(U5-12). AI: AI-11 "무차감", AI-05 "사용량 미차감", 요청 5 문구. 데이터: 3.3 "새 보강 대화 … (1회 차감)" → R-36·R-37·R-43 |
| 공급자·모델 배지 | 데이터 메타 `provider`·`model`·`model_tier`·`connection_tier`(결과 테이블 8곳 + `job_descriptions.extraction_*`). UX는 `ai_provider`/`ai_model`(U5-8), 세션 목록 열은 원천 없음 → R-36·R-40 |

## 이슈

### R-36 [Major] UX v5: 데이터 모델 v4 rename U5-1~U5-14 미반영
- 담당: ux-planner
- 위치·내용(데이터 v4 11.2 ↔ UX v5):
  - U5-1~3 `tier` → `connection_tier`: C-19 배지, C-21 기록, S-40 데이터 줄, S-41 ①, S-42 데이터 줄, 요청 절 1·3·4 (`ai_usage_records`는 `model_tier`도 추가)
  - U5-5·6·7 미터 필드: S-42 데이터 줄 `succeeded` → `outcome`(+`error_code`), `created_at` → `occurred_at`, `cache_write_tokens`·`reasoning_tokens`·`usage_source`·`job_type`·`call_key` 추가, 가격표 기준일은 **`source_checked_at`**(S-42 "기준일 {effective_from}"을 바꿈)
  - U5-8 결과 메타: C-19 결과 배지·S-36 대화 공급자 표시 `ai_provider`/`ai_model` → `provider`/`model`/`model_tier`
  - U5-9·10·11 원인 값: C-20 표·S-41 ③·C-18 아래 문단의 `invalid_key` → `key_invalid`, `model_unavailable` → `model_not_available`, `last_failure_cause` 같은 7값
  - U5-12: S-36 데이터 줄의 `usage_event_id`(null = 차감 전) 삭제
  - U5-13: C-20 "(시스템)" 행·공통 상태 ST-AI-FAILED의 `error_category`(`transient` / `input` / `timeout`) → 5값(`provider_limit` / `user_account` / `transient` / `input` / `system`). 시스템 문구는 `error_category = 'system'` + `error_code`(`timeout` 등)로 고른다
  - U5-14: `last_failure_at`(S-40 카드 무효 상태 시각), **`error_code = 'key_missing'`**(실행 중 키 삭제) 상태를 C-20 또는 C-18에 추가 — "키가 삭제되어 작업을 끝냈어요. 입력은 저장돼 있어요" + AI 연결하기
  - 그 밖: S-40 "(또는 `ai_settings.active_provider`)" 대안 삭제(데이터: `profiles.active_ai_provider`만), 화면 조회는 `ai_provider_keys_public` 뷰, 머리글 기준 "데이터 모델 v3.2"·`[확인 필요: data-architect]` 표식 정리
- 수정 제안: 위치별 일괄 치환. 구조 변경은 `key_missing` 상태 1행뿐.

### R-37 [Major] AI v4: 데이터 모델 v4 rename A4-1~A4-10 미반영 + 차감 문구 잔여
- 담당: ai-feature-designer
- 위치·내용:
  - A4-1·2: C-13 표 `meter_feature` → `feature`, 값 `key_validation` → `key_verification`(C-10.5 본문 "기능 `key_validation`"도), 요청 절 4
  - A4-3~7: C-13 가격표 문단·변경 이력 아래 표의 `input_per_mtok` / `cached_input_per_mtok` / `cache_write_per_mtok` / `output_per_mtok` → `*_usd_per_mtok`, 장문 구간 단가 2개 추가
  - A4-9·10: C-11.1 표에 `key_missing`(category `user_account`, `failure_cause` null, 재시도 없음) 행이 없다. `failure_cause`(7값 generated), `quota_resets_at`(C-11.2 초기화 시각 저장처), `retry_after`(C-12 "N분 후" 저장처) 명시
  - `[제안]` 표식(C-11.1 `error_category`, C-12 `next_run_at`, C-13 기록·가격표), 머리글 "데이터 모델 v3.2 기준"
  - 차감 잔여: AI-11 트리거 "**무차감.**", AI-05 "끝내 실패하면 … 사용량 미차감", 요청(ux) 5의 "재시도 무차감 문구" 언급
- 수정 제안: 일괄 치환, C-11.1에 `key_missing` 행 추가, 차감 표현 삭제(필요하면 "호출 없음"·"토큰 기록 없음"으로).

### R-38 [Major] 키 등록 검증에서 한도 응답(429·일일 한도)이 나왔을 때 저장 여부가 문서마다 다르다
- 담당: product-planner (F-AI-01 수용 기준이 기준)
- 근거: PRD F-AI-01 (2) "실패하면 원인 … 을 보여 주며 저장하지 않는다" / 데이터 2.11.2 "검증한 뒤, **성공했을 때만** 암호화해 저장" ↔ AI C-10.5 단계 2 "429 → (1)/(2) (**저장은 허용하고 '한도 상태' 표시** `[가정]`)" ↔ UX S-41 ③ "`daily_quota_exhausted`, 키는 유효할 수 있음 — 저장 여부는 AI 명세 결정 `[가정]`". 데이터 `ai_provider_keys.status`에는 `needs_check`(검증 중 일시 오류·한도)가 이미 있다.
- 영향: Gemini 무료(기본 추천 경로) 사용자가 그날 한도를 다 쓴 상태로 키를 연결하면 "연결 실패"가 되어 연결 자체를 못 한다.
- 수정 제안(팀 해결): F-AI-01 (2)를 "인증 실패·권한 없음·형식 오류(키 무효), 결제 필요, 모델 불가면 저장하지 않는다. 인증은 통과했으나 분당·일일 한도(429)나 공급자 장애면 **저장하고 `status = 'needs_check'` + `last_failure_cause`**로 표시, 다음 실행 또는 '다시 확인'에서 갱신"으로 정한다. 데이터 2.11.2 "성공했을 때만" 문장과 UX S-41 ③ `[가정]`을 이에 맞춘다.

### R-39 [Minor] 자동 재시도 횟수가 문서 안팎에서 다르다
- 담당: ai-feature-designer
- 근거: AI C-11.1 #6 `provider_unavailable` "백오프 최대 2회" ↔ C-12 "자동 재시도 (원인 1·6) … **호출당 최대 4회**, 작업당 대기 합계 120초" ↔ UX C-20 `provider_unavailable` "서버 자동 재시도 **1회** 후 표시". C-12는 무료 등급 절인데 C-11.1 #1은 유료 등급도 "C-12" 백오프를 참조해, 유료 등급 재시도 규칙이 어느 쪽인지 불분명.
- 수정 제안: 원인(1·6) × 등급(무료·유료) 재시도 표 하나로 정하고 UX C-20 문구가 그 값을 따르게 리더가 전달.

### R-40 [Minor] 면접 세션 목록의 "실행 공급자" 열에 데이터 원천이 없다
- 담당: data-architect
- 근거: PRD F-P3-15·요청(data-architect) 4 "AI 결과(인사이트, 초안, **면접 세션**, 대화 메시지)에 실행 공급자·모델", UX C-19 "S-37·S-20 세션 목록 '실행 공급자' 열" ↔ 데이터 v4 11.1 #4: 메타는 `interview_questions`, `answer_evaluations`, `session_feedbacks`에만, `interview_sessions`에는 없다. 질문 생성과 채점이 다른 공급자일 수 있다(F-AI-03 (2)).
- 수정 제안: `interview_sessions`에 `question_provider`·`evaluation_provider`(+ model_tier)를 두거나, "목록 표시 = 질문 생성 공급자(`interview_questions` 첫 행), 결과 화면 = 채점 공급자(`session_feedbacks`)" 규칙을 6.1·A.12에 적는다.

### R-41 [Minor] UX v5: 판정·표시의 데이터 원천 연결 정리
- 담당: ux-planner
- 근거와 위치:
  1. C-18·C-09: 잠금·폼 경로 판정을 "활성 공급자 키 없음"으로만 적었다. 데이터는 `get_data_readiness().ai_connection`(`active_provider`, `key_status`, `connection_tier`)과 "키 없음·`invalid`면 `next_action = 'form'`"을 준다. `key_status = 'needs_check'`일 때 동작(실행 허용 + 배지 주의)이 없다.
  2. S-42 공급자별 표 "행 → 기능별 표를 그 공급자로 거르기": `get_ai_usage_summary`는 `by_feature`와 `by_provider`를 따로만 준다(교차 집계 없음). 사용자 범위도 "기능별"이다.
  3. C-03 무료 등급 "(n초)" 대기 표시의 원천 `progress.waiting_retry_until`, C-20 "{N}분 뒤"의 `retry_after`, "{초기화 시각}"의 `quota_resets_at`을 명시.
  4. S-41 ③ "최대 5초" — 무료 등급 목표는 10초(AI C-10.5·C-12, PRD 6.4).
- 수정 제안: 1·3·4는 문구·데이터 줄 보강. 2는 필터 상호작용을 빼거나(권고, 범위 안) data-architect에 교차 집계를 요청.

### R-42 [Minor] PRD v4: 다른 문서가 올린 결정·용어·보유 기간 미기록
- 담당: product-planner
- 근거:
  - UX D-UX-14~17(키 연결 단계형, 잠금 범위, 연결 후 자동 실행 없음, 미터 기간 이번 달 + 지난달), UX 요청 2(OpenAI·Claude 등급 기본값 "유료"), 데이터 D-DM-09(`ai_usage_records` 보관 13개월 `[가정]`), D-DM-10(봉투 암호화 + 외부 KMS, Vault 비권고), 데이터 11.4-3(키 삭제 시 동의 철회 기록), AI D-AI-12(고성능 등급 MVP 미배정)·D-AI-13(애매한 429는 분당으로 재시도)이 PRD 9장에 없다.
  - F-AI-07 (2) 기능 목록에 "연결 확인"이 없다(NFR-KEY-04 `[가정]`·UX S-42·AI·데이터는 포함).
  - 용어집에 "연결 확인", "실행 공급자", "키 연결 단계"(UX 요청 3) 없음.
  - 사용 기록 13개월 보관이 6.1 개인정보·보유 표(NFR-PRV-06)에 없다.
- 수정 제안: 9.2에 위 항목을 상태와 함께 기록, F-AI-07 (2)에 "연결 확인" 추가, 용어 3개 등록, NFR-PRV-06에 사용 기록 보관 기간(`[가정]`) 추가. D-DM-10은 NFR-KEY-02·07과 맞으므로 팀 확정 가능.

### R-43 [Minor] 데이터 모델: 차감 문구 잔여
- 담당: data-architect
- 근거: 3.3 "같은 프로젝트에 새 보강 대화는 새 `writing_chats` 행(**1회 차감**)", 8.1 T-10 행의 사용량 세부 문구(이력 행이라면 "v4 폐기" 표시 필요).
- 수정 제안: "(1회 차감)" 삭제, 8.1 T-10 행에 "v4: 차감 폐기(D-34), 상한 40 CHECK 확정" 표기.

### R-44 [Minor] 사용자 범위와 크기가 다른 표시·게이트 3건
- 담당: product-planner (사용자 결정으로 확정 필요 — UB-2·UB-3)
- 근거:
  1. 사용자 원문 미터: "이번 달 Resumate에서 쓴 토큰 / 예상 비용을 **기능별로**". PRD F-AI-07·UX S-42는 **공급자별 표**, **지난달 비교**(D-UX-17), 호출 수, S-40 요약 한 줄을 더한다. 공급자별은 무료 등급 "청구되지 않을 수 있음" 표시와 공급자 전환 시 필요하지만, 지난달 비교는 원문 밖이다.
  2. 재시도 대기 표시 "공급자 요청 한도로 잠시 기다리는 중 (n초)"(UX C-03·C-20, `waiting_retry_until`)는 공급자 `Retry-After`를 쓴다. 제외된 "응답 헤더 기반 실시간 분당 한도 표시"(남은 요청 수)와는 다른 것(실패 안내의 일부)으로 판단하지만, 사용자에게 한 줄 확인을 권한다.
  3. 사용자 확정 "공급자 3개 연동" ↔ PRD D-38 "평가 세트를 통과 못 한 공급자는 '준비 중'"(데이터 `ai_providers.is_available`) — 출시 때 3개 미만이 열릴 수 있다.
- 수정 제안: 사용자 결정 UB-2·UB-3 답에 따라 F-AI-07·D-38을 확정. 2는 PRD F-AI-08 (1)에 "재시도 대기 시간 표시는 남은 한도 표시가 아니다" 한 줄.

## 사용자 결정 (BYOK — 사용자만 정할 수 있는 것)

| # | 질문 | 선택지 | 권고 |
|---|------|--------|------|
| UB-1 | 모의 면접 점수 산정 방식(D-14, 이전부터 대기) | 사용자 정의 | 사용자 정의 대기. 점수 자리·"점수 산정 방식 준비 중"·서버 계산 구조는 준비됨 |
| UB-2 | 사용량 미터의 표시 범위 | (a) 기능별 + 공급자별 + 지난달 비교(현재 설계) (b) 기능별 + 공급자별(이번 달만) (c) 기능별만(원문 그대로) | **(b)**. 공급자별은 무료 등급 "청구되지 않을 수 있음" 표시와 공급자 전환에 필요하다. 지난달 비교는 "두 가지만"의 취지보다 넓어 Could로 미룬다 |
| UB-3 | 공급자 출시 게이트(D-38) | (a) 세 공급자 모두 평가 세트를 통과해야 열고, 통과 전에는 "준비 중"(출시 때 3개 미만 가능) (b) 세 공급자 모두 출시 시 연다(평가는 출시 전에 반드시 끝낸다) (c) 평가와 무관하게 셋 다 연다 | **(a)**. 근거 기반 원칙(없는 경험을 지어내지 않음)을 공급자마다 확인해야 한다. 다만 사용자 확정 "3개 연동"과 다를 수 있어 승인이 필요하다. 일정은 "세 공급자 평가 완료 후 출시"를 목표로 |
| UB-4 | Gemini 무료 키를 기본 추천 경로로 둘지(brief 3차 리더 해석) | (a) 추천 + 무료 등급 데이터 사용(Google 제품 개선 활용·사람 검토 가능) 별도 동의 (b) 추천하지 않고 세 공급자를 동등하게 (c) 추천 + 고지만(별도 동의 없음) | **(a)**. 사용자 원문 "제미나이는 무료 API를 제공하기 때문에 더 괜찮다"와 맞고, 무료 등급 데이터 정책은 별도 체크로 알린다. 고지 문구는 출시 전 최신 약관으로 확정(D-10) |

- 사용자 결정이 아닌 것: D-39(공급자 전송의 법적 성격)는 **법무**, D-DM-09(사용 기록 13개월)·D-DM-10(KMS)·R-38(검증 중 한도 응답 시 저장)·D-AI-12·13·D-UX-14~17은 **팀 확정** 대상이다.
- 이전부터 남은 `[가정]`(D-16 미응답 허용 + 경고, 컬처핏 예외, 묶이지 않은 대화 90일)은 사용자가 답하지 않은 항목으로 그대로 둔다.

---
---

# BYOK 리뷰 라운드 2 (2026-10-26) — 이번 주기 최종

> 작성: spec-reviewer. 대상: PRD **v4.1**, UX **v5.1**, AI **v4.1**, 데이터 모델 **v4.1**. 문서는 고치지 않았다. 이번 주기의 마지막 라운드라 남은 항목은 "미해결(잔여)"로 리더에게 넘긴다.

## 요약

- R-36~R-44(9건): **해결 7 / 부분 해결 2 (R-37, R-38) / 미해결 0**. 부분 해결 2건은 문장 하나씩 남은 흔적이다.
- 신규: **Minor 3건 (R-45 data, R-46 ux, R-47 product)**. Critical·Major 없음.
- 사용자 결정 4건(UB-1~UB-4)은 그대로. PRD 9.0에 `[결정 필요]`로 올라 있고, UB-2~UB-4는 권고안을 `[가정]`으로 적용해 네 문서가 같은 설계를 쓴다.

## R-36~R-44 재검토

| ID | 담당 | 판정 | 근거 / 남은 일 |
|----|------|------|----------------|
| R-36 | ux | **해결** | UX v5.1: `connection_tier`, 사용 기록 `outcome`·`occurred_at`·추가 필드, 가격표 기준일 `source_checked_at`, 결과 메타 `provider`/`model`/`model_tier`, `key_invalid`·`model_not_available`, `error_category` 5값, `key_missing` 상태, 뷰 `ai_provider_keys_public`, `usage_event_id` 삭제. (흔적: S-36 데이터 줄 머리 "데이터 모델 v3 2.5" 표기 — R-46) |
| R-37 | ai | **부분 해결** | A4-1~A4-10 반영(`feature`, `key_verification`, `*_usd_per_mtok`, 장문 구간 단가, `key_missing` 행, `failure_cause`·`quota_resets_at`·`retry_after` 저장 위치), AI-11·AI-05 차감 문구 삭제. **잔여**: C-6 "`error_code` 범주 (화면 3범주 … 데이터 모델 v2): 일시적 — `model_unavailable`, …, `refused`" 문단이 C-11.1과 충돌(옛 값·옛 3범주). 요청 절 7 "게이트 진입 배너(R-32) — v3.2a부터 미회신"은 UX v4.2b에서 반영됨 |
| R-38 | product | **부분 해결** | PRD F-AI-01 (2), AI C-10.5 저장 규칙, 데이터 `save_provider_key`(`verification_result` = `valid` / `limited`)·`record_provider_key_check`, UX S-41 ③ "확인 보류(저장함)"가 같은 규칙. **잔여(data-architect)**: 데이터 2.11.2 마지막 문단 "등록·교체는 … 검증한 뒤, **성공했을 때만** 암호화해 저장한다"가 2.11.3과 충돌 |
| R-39 | ai | **해결** | AI C-11.3 원인별 표 하나(등급 무관: `rate_limited` 4회, `provider_unavailable` 2회, `schema_invalid`·`timeout` 1회, 그 밖 0회, 작업당 대기 합계 120초, 스트리밍은 첫 토큰 전 오류만). UX C-20·C-03이 같은 값. 데이터 `retry_count`·`next_run_at`·`progress.waiting_retry_until`·`retry_after`로 표현(대기 합계 저장처는 R-45) |
| R-40 | data | **해결** | `interview_sessions.question_provider`·`question_model`·`evaluation_provider`·`evaluation_model` + 목록 표시 규칙(채점 시작 후 채점 공급자, 다르면 둘 다). AI-05/AI-06·07이 기록, UX C-19·S-20·S-37·S-22가 같은 규칙 |
| R-41 | ux | **해결** | C-18·C-09 판정 원천 `get_data_readiness().ai_connection`, `needs_check` = 실행 허용 + 주의 배지(ST-AI-KEY-CHECK), S-42 공급자 행 필터 삭제, `waiting_retry_until`·`retry_after`·`quota_resets_at` 명시, 검증 예상 시간 유료 5초 / 무료 10초 |
| R-42 | product | **해결** | PRD 9.2에 D-UX-14~17, D-DM-09·10, D-AI-12·13, 키 삭제 시 동의 철회 기록. F-AI-07 (2)에 "연결 확인", 용어집에 연결 확인·실행 공급자·키 연결 단계·확인 필요, NFR-PRV-06에 사용 기록 13개월 `[가정]` |
| R-43 | data | **해결** | 3.3 "(1회 차감)" 삭제, T-10 행 v4 폐기 표기 |
| R-44 | product | **해결** | 미터 = 이번 달 + 기능별·공급자별(지난달 비교 Could, UB-2 `[가정]`), F-AI-08 (1)에 "재시도 대기 표시는 F-AI-13(실시간 한도 표시)이 아니다" 명시, D-38 `[가정]`(UB-3). 사용자 결정으로 넘김 |

## 집중 점검

| 항목 | 결과 |
|------|------|
| `ai_provider_keys_public` 뷰 | 데이터 2.11.1에 정의됨: 화면 조회 컬럼 10개(`id`, `provider`, `connection_tier`, `key_last4`, `status`, `last_verified_at`, `last_failure_cause`, `last_failure_at`, `created_at`, `updated_at`)만 담은 security invoker 뷰. UX S-40 데이터 줄과 컬럼 일치. 5장 RLS 표·9장 목록에는 없음 → R-45에서 한 줄 보강 권고 |
| `verification_result` valid / limited, `needs_check` | 네 문서 일치: 인증 통과 + 한도(분당·일일)·공급자 장애면 `limited` → `needs_check`로 저장·활성화 허용, 키 무효·결제·모델 불가면 저장 안 함, "다시 확인"·다음 실행은 `record_provider_key_check`(성공 → `valid`, `key_invalid` → `invalid`, 그 밖 → `needs_check`). readiness: `needs_check`는 `next_action`을 바꾸지 않음(UX C-09·데이터 6장 일치). 흔적은 R-38 잔여 1문장 |
| 면접 세션 공급자 필드 | AI ↔ 데이터 ↔ UX 일치(R-40) |
| 재시도 규칙 | AI C-11.3 ↔ UX C-20·C-03 ↔ 데이터 `ai_jobs` 컬럼 일치. 작업당 대기 합계 120초를 단계 사이(서버리스 실행이 나뉨)에 어디에 누적하는지 없음 → R-45 |
| 미터 범위 | PRD F-AI-07 (1) "이번 달만", AI C-13 "이번 달만", 데이터 `get_ai_usage_summary(period_month, include_previous default false)`, UX S-42 "이번 달만·지난달 대비 없음·공급자 행 필터 없음" 일치. PRD 아래 요청 절(v4 원 요청) 3번에 "지난달 비교"가 남음 → R-47 |
| 운영비 문구 잔여 | 본문은 정리됨. 남은 것은 이력·폐기 표기와 AI C-6 문단(R-37 잔여), PRD 요청 절(R-47)뿐 |

## 신규 이슈

### R-45 [Minor] 데이터: 재시도 대기 합계 저장처, RPC 서명, 뷰 표기
- 담당: data-architect
- 근거: AI C-11.3 "작업당 대기 합계 상한 120초(원인 1·6 합산)" — 단계가 `next_run_at`으로 나뉘어 실행되므로 누적값을 DB에 남겨야 하는데 `ai_jobs.progress`는 `{stage, done, total, waiting_retry_until}`뿐이다. `save_provider_key(provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, disclosure_version)` 서명에 본문이 말하는 `verification_result` 인자가 없다. `ai_provider_keys_public` 뷰가 5장 RLS 표·9장 목록에 없다. (R-38 잔여: 2.11.2 "성공했을 때만 저장" 문장)
- 수정 제안: `progress.retry_wait_total_s`(또는 `ai_jobs.retry_wait_total_s` 컬럼) 추가, `save_provider_key` 서명에 `verification_result` 추가, 뷰를 5장·9장에 한 줄, 2.11.2 문장을 2.11.3 규칙으로 교체.

### R-46 [Minor] UX: 결과 배지의 모델 표시 결정 미기록 + 머리 표기
- 담당: ux-planner
- 근거: UX 요청(ai-feature-designer) 1 "결과 배지에 모델 원래 이름을 보일지, 단계 이름만 보일지"가 열린 채. S-36 데이터 줄 머리 "데이터 모델 v3 2.5".
- **권고(담당 결정용)**: 배지 본문은 **"공급자 · 단계 이름"**(예: "Gemini · 기본", `provider` + `model_tier`), **원래 모델 ID(`model`)는 툴팁·결과 상세 정보에** 둔다. 이유: (1) 모델 ID는 공급자별로 길고 자주 바뀌어(`[가정]` 매핑은 운영자가 갱신) 배지가 읽기 어렵고 사용자는 고를 수도 없다(D-31, F-AI-10 Won't). (2) 반면 사용자는 공급자 청구서·대시보드와 대조할 때 실제 모델 ID가 필요하고, 결과의 실행 공급자·모델을 기록·표시한다는 F-AI-03 (3)의 취지(투명성)도 툴팁으로 충족된다. (3) 단계 이름은 공급자가 달라도 같은 말이라 "어느 결과가 더 무거운 모델로 만들어졌나"를 비교하기 쉽다. 결정을 D-UX-18로 기록하고 PRD 용어집 "실행 공급자" 정의와 맞춘다.

### R-47 [Minor] PRD: 아래 요청 절의 지난달 비교 문구
- 담당: product-planner
- 근거: PRD "다른 팀원에게 요청 (v4 반영 사항)" ux-planner 3 "사용량 미터 화면(F-AI-07): 이번 달 기능별·공급자별 … **지난달 비교** …"가 v4.1 F-AI-07 (1) "이번 달만, 지난달 비교는 Could"와 충돌(v4.1 추가 요청 절은 맞음).
- 수정 제안: v4 요청 3번에 "(v4.1: 지난달 비교는 Could, UB-2)" 표기 또는 삭제.

## 미해결로 넘기는 항목 (리더 전달)

| ID | 심각도 | 담당 | 남은 일 |
|----|--------|------|---------|
| R-37 잔여 | Minor | ai-feature-designer | C-6 `error_code` 범주 문단을 C-11.1로 대체(옛 `model_unavailable`·`refused`·3범주 삭제), 요청 7 정리 |
| R-38 잔여 | Minor | data-architect | 2.11.2 "성공했을 때만 저장" 문장 교체(R-45와 함께) |
| R-45 | Minor | data-architect | 대기 합계 저장처, `save_provider_key` 서명, 뷰 표기 |
| R-46 | Minor | ux-planner | 모델 표시 결정 기록(권고: 단계 이름 + 툴팁에 모델 ID), 머리 표기 |
| R-47 | Minor | product-planner | 요청 절 문구 |

모두 문장 수준이며 설계 충돌은 없다.

## 사용자 결정 (최종, BYOK 주기)

| # | 질문 | 선택지 | 권고 (현재 문서 적용 상태) |
|---|------|--------|----------------------------|
| UB-1 | 모의 면접 점수 산정 방식(D-14) | 사용자 정의 | 사용자 정의 대기. 점수 자리·"점수 산정 방식 준비 중"·서버 계산 구조 준비됨 |
| UB-2 | 사용량 미터 표시 범위 | (a) 기능별 + 공급자별 + 지난달 비교 (b) 기능별 + 공급자별, 이번 달만 (c) 기능별만 | **(b)** — 네 문서에 `[가정]`으로 적용. (a)로 바뀌면 `include_previous = true`와 화면 한 줄만 추가 |
| UB-3 | 공급자 출시 게이트(D-38) | (a) 평가 통과 전 "준비 중"(출시 때 3개 미만 가능) (b) 셋 다 출시 시 연다(평가는 출시 전 완료) (c) 평가와 무관하게 연다 | **(a) + 세 공급자 평가 완료 후 출시를 목표** — `[가정]` 적용(`ai_providers.is_available`) |
| UB-4 | Gemini 무료 키를 기본 추천 경로로 | (a) 추천 + 무료 등급 데이터 사용 별도 동의 (b) 추천 없이 동등 (c) 추천 + 고지만 | **(a)** — `[가정]` 적용(F-AI-05, C-21 별도 체크) |

- 사용자 결정이 아닌 것: D-39(공급자 전송의 법적 성격)는 법무. 남은 `[가정]`(D-16 미응답 허용 + 경고, 컬처핏 예외, 묶이지 않은 대화 90일, 사용 기록 13개월, 검증 순서 Gemini → Claude → OpenAI, 성능·지표 수치)은 이전과 같다.

---

## 백엔드 구현 반영 리뷰 (2026-11-05) — 라운드 1

> 작성: spec-reviewer / 대상: PRD v4.3, UX v5.3, AI v4.3, DM v4.2 / 기준: `00_input/brief-2026-11-05.md`(고정 이름), `planning-decisions-2026-11-05.md`(A1~A24), `spec-gaps-summary.md`(B·C·D)
> 방법: `00_input/pre-2026-11-05/` 스냅샷과 `diff`로 바뀐 부분만 보고, 그 부분이 닿는 상대 문서 구절과 나란히 비교했다. 문서 본문은 고치지 않았다.

### 요약

- A1~A24는 결정 파일의 "반영할 문서"에 모두 들어갔다. 대부분 같은 문장·같은 이름으로 맞는다.
- 브리프 고정 이름(`project_fields`, `question_validation_report`·`question_usage`, `abandoned → active`, `concise`/`detailed`, A19 서버 전용 역할 + `p_user_id`, A20 규칙, A23 `selection_origin = user`, A24, A13, A9 `result_viewed_at`, A4, A21)은 네 문서에서 같다.
- B 항목은 반영됐다. AI-02 예시의 "PRJ-3"은 프로젝트명으로 바뀌었고, AI-03·AI-04 `notes_for_user`, AI-07 `unanswered_note` 예시에도 별칭이 없다. 남은 별칭은 규칙 설명과 AI-09 인라인 표식 예시뿐이다(정상).
- 버전 머리·변경 이력("백엔드 구현 반영(2026-11-05)")·상호 참조 버전은 네 문서 모두 맞다. 본문 안의 옛 버전 참조 2곳만 남았다(R-58).
- 새 이슈 11건: Major 3, Minor 8. 설계가 크게 부딪히는 곳은 A1의 적용 범위(R-48) 하나다.

### 점검 결과 (A1~A24)

| # | 반영 문서 | 결과 | 비고 |
|---|-----------|------|------|
| A1 | PRD F-AI-03 (2), AI C-11.4 (+UX C-20·S-40, DM 2.9.1) | **불일치** | 요청 범위 작업·다시 채점의 공급자가 문서마다 다름 → R-48. 거부 코드 → R-49 |
| A2 | PRD F-P2-03, UX S-15, AI AI-02 | 일치 | |
| A3 | DM A.2 | 일치 | |
| A4 | UX S-17·S-19·C-20, AI AI-03 | 일치 | DM A.9에도 같은 문장 |
| A5 | DM 2.5, UX S-36, AI AI-12 (+PRD) | 일치 | `≤ 38`일 때 사용자 메시지 접수, 시작 인사 `ai_job_id` null까지 같음 |
| A6 | PRD F-P1-06·F-P1-13, UX S-08·S-36, DM 2.5·3.4 | 대체로 일치 | 재개 진입점 표기 차이 → R-53 |
| A7 | UX FL-07·S-25 | UX 반영됨 | 서버 판정 방법이 DM에 없음 → R-50 |
| A8 | DM A.13, UX S-33 | 일치 | 편집 조건 4개가 같다 |
| A9 | AI AI-06·AI-07, UX S-22·S-37 (+DM A.12) | 동작 일치 | UX 문구 1곳 → R-55. 진행 단계 → R-51. 공급자 → R-48 |
| A10 | AI C-3 V-4·AI-02 | 일치 | DM 6장 `profile_filled`에도 같은 문장 |
| A11 | AI 4.1 | 일치 | |
| A12 | AI AI-04, UX S-18·S-19 | 일치 | |
| A13 | UX FL-03·S-17, AI C-6·AI-03, PRD D-30 | 경력기술서 일치 | 자소서·AI-11·비동기 선행 추출의 확정 수준이 다름 → R-52 |
| A14 | AI C-11.3·AI-12 | 일치 | UX C-20·S-36도 같음 |
| A15 | AI AI-12 | 일치 | DM 2.5도 같음 |
| A16 | AI AI-01 | 일치 | |
| A17 | AI AI-03, DM A.9, UX S-17 | 값 일치 | 미지정 기본값 차이 → R-54 |
| A18 | DM 6장, UX C-09 | 일치 | 판정 순서·`suggested_mode` 생략·S-10까지 같음 |
| A19 | DM 2.11.3·5장 | 일치 | AI C-10.5·UX S-40도 같은 이름 |
| A20 | DM 2.11.5, PRD F-AI-04 | 버전 규칙 일치 | 공급자·등급 전환 문구 → R-56 |
| A21 | DM A.9·A.10, AI AI-03·AI-04, UX S-19 | 일치 | |
| A22 | DM A.12 | 일치 | AI AI-05도 같은 컬럼명 |
| A23 | AI AI-11, UX S-17·C-11 | 일치 | DM A.9도 같음 |
| A24 | DM 5장 | 일치 | AI C-3에도 반영 |

### "다른 팀원에게 요청" 해소 여부

| 요청 | 대상 | 결과 |
|------|------|------|
| PRD v4.3 → UX (1) A1 실패 상태·키 없으면 잠금, (2) A6·A5, (3) A13 | UX | 해소. 단 (1)의 범위 문제 → R-48 |
| PRD v4.3 → AI: C-11 A1 같은 문장, C-6·AI-03 60초 예산 | AI | 해소(C-11.4, C-6) |
| PRD v4.3 → DM: 2.11.5 한 규칙, 2.5·3.4 재개·인사 제외 | DM | 해소 |
| UX v5.3 → DM 1: 탈퇴 미완료 판정을 6.1에 | DM | **미해소** → R-50 |
| UX v5.3 → AI 1: A13 자소서 적용 | AI | AI C-6이 같은 `[가정]`으로 적음. PRD 쪽 미정 → R-52 |
| UX v5.3 → AI 2: 새 진행 단계 문구를 UX 표와 맞춰 달라 | AI | **미해소** → R-51 |
| UX v5.3 → PRD 1·2: S-36 무료 등급 문장 D-10 연결, 용어 3개 | PRD | **미해소** → R-57 |
| AI v4.3 → DM 1~3: 세트 기록 컬럼, `consistency_notes`, 장문 캐시 단가, 이름 확인 | DM | 해소(A.12, A.13, 2.8, 2.9.3, 2.5, 6장, 5장) |
| AI v4.3 → UX 1~5 | UX | 1·3·4 해소, 2 미해소(R-51), 5는 D-10 대기(R-57) |
| AI v4.3 → PRD 1: AI-04·AI-11 같은 순서 확정 | PRD | **미해소** → R-52 |
| AI v4.3 → PRD 2: F-AI-03 (2) 문구 | PRD | 해소. 범위 → R-48 |
| DM 11.5 → UX·AI·PRD | 각 문서 | 해소(S-36 n/40, S-20, C-09, A21 / C-13 식, AI-05 저장, UUID 키 / F-AI-04, D-DM-08) |

### 이슈

#### R-48 [Major] A1 "다시 시도는 처음 공급자"의 적용 범위가 문서마다 다르다
- 담당: product-planner(주), ux-planner, ai-feature-designer, data-architect
- 위치·근거
  - PRD F-AI-03 (2): "실패한 작업의 '다시 시도'는 … 작업을 시작할 때 고정된 처음 공급자로 다시 실행한다". 예외가 없다.
  - UX C-20 "다시 시도의 공급자"(850행): "실패한 작업의 '다시 시도'는 그 작업에 고정된 **처음 공급자**로 다시 돈다(활성 공급자를 바꿨어도)". S-40 활성 변경 확인 문구(1297행): "진행 중인 작업과 **실패한 작업의 다시 시도는 원래 공급자로** 해요".
  - AI C-11.4(470행 부근): "요청 범위 작업(C-6)의 '다시 시도'는 새 요청이므로 **현재 활성 공급자로** 돈다". DM 2.9.1과 7장도 요청 범위 작업(JD 추출, 서류 3종)을 일반 재시도에서 빼서 `ai_job_not_retryable`로 둔다.
  - AI AI-06 "다시 채점"(1415행): "다시 채점은 **새** `interview_evaluation` 작업이며 채점 공급자(`evaluation_provider`·`evaluation_model`)를 덮어쓴다". 새 작업은 활성 공급자로 돈다. 그런데 UX S-37(채점 실패 행 "실패한 답변 다시 채점")은 C-20 규칙(처음 공급자)을 따르는 것처럼 읽힌다. AI C-6은 "비동기 작업(AI-02, AI-05, AI-06/07)만 같은 행을 다시 연다"고도 적었다.
- 내용: 경력기술서·자소서·요건 추출의 "다시 시도"와 면접 "다시 채점"이 어느 공급자로 도는지 PRD·UX와 AI·DM이 다르게 말한다. 화면 문구(S-40)는 서류 다시 시도도 원래 공급자로 간다고 안내하지만 실제로는 활성 공급자로 간다. 백엔드 후속에서 A1 반영 범위를 정할 수 없다.
- 수정 제안
  - product-planner: F-AI-03 (2)에 범위를 적는다. "같은 작업 행을 다시 여는 다시 시도(인사이트, 면접 질문 생성, 채점 작업의 실패 재시도)는 처음 공급자. 요청 하나로 끝나는 기능(요건 추출, 서류 생성)의 다시 시도와 면접 '다시 채점'은 새 실행이라 현재 활성 공급자" (AI C-11.4·DM 2.9.1과 같은 해석).
  - ux-planner: C-20 "다시 시도의 공급자"와 S-40 확인 문구에 같은 예외를 넣는다(예: "실패한 인사이트·면접 작업의 다시 시도는 원래 공급자로 해요").
  - ai-feature-designer: AI-06에 "채점 작업이 `failed`일 때의 다시 시도(같은 행, 처음 공급자)"와 "다시 채점(새 작업, 활성 공급자)"이 서로 다른 동작인지, 화면에 둘 다 있는지 한 줄로 적는다. UX S-22·S-37은 "다시 채점" 하나만 둔다.
  - 해석이 갈리면 `[결정 필요]`로 리더에게 올린다(선택지: (a) 위 제안, (b) 요청 범위 작업도 처음 공급자 고정. 권고 (a): A1 결정 근거가 "다시 시도는 이어 하는 것"이고, 요청 범위 작업은 이어 할 상태가 없다).

#### R-49 [Major] 다시 시도 거부 코드 `ai_consent_required`가 DM에만 있다
- 담당: data-architect(주), ux-planner
- 위치·근거
  - DM 7장 "실패 작업 다시 시도"(981행): "키 없음 409 `key_missing`, 무효 409 `key_invalid`, **동의 필요 409 `ai_consent_required`**". v4.2에서 새로 생긴 코드다(스냅샷 4개 문서에 0건).
  - DM 2.11.3 `check_ai_run_allowed`: "동의 필요 → `key_missing`". AI C-11.4: "실행 동의가 필요하면(A20) 같은 연결 안내로 거부". AI-12: "키 없음·동의 필요 → `key_missing`".
  - UX C-20·S-36 "전송이 막힐 때": `key_missing` / `key_invalid` 행만 있다. `ai_consent_required` 행은 없다.
- 내용: 같은 상황(동의 필요)에 실행 경로는 `key_missing`, 다시 시도 경로는 `ai_consent_required`를 쓴다. 화면은 다시 시도 응답을 분기할 행이 없어 일반 오류로 떨어진다.
- 수정 제안: DM 7장을 `key_missing`(동의 필요 포함)으로 맞춘다. 별도 코드를 남기려면 UX C-20에 행("AI 연결 동의가 필요해요" → C-21)을 더하고 AI C-11.4에도 같은 코드를 적는다.

#### R-50 [Major] A7 탈퇴 미완료 상태의 서버 판정 방법이 없다
- 담당: data-architect
- 위치·근거
  - UX S-25 "재진입" 행: "판정 방법은 데이터 모델 확인 요청". UX 끝 v5.3 요청 data-architect 1(1567행): "'공개 데이터는 지워졌고 auth 사용자만 남은 상태'를 서버가 무엇으로 아는지 … §6.1에 적어 달라". UX 5.2 열린 항목(1536행)에도 남아 있다.
  - DM 4.5 탈퇴 표(765행) "auth 삭제 실패": "public 데이터는 이미 없고 세션은 남는다 … 재진입 경로는 UX FL-07·S-25(A7)". DM 7장 F-COM-05: "약관 동의 게이트 없이 로그인만 확인". 판정 기준은 어디에도 없다.
- 내용: A7은 ★(백엔드 후속)이다. 로그인 직후 미들웨어가 무엇을 보고 S-25로 보낼지 정해지지 않으면, 탈퇴 미완료 사용자가 동의 게이트(S-03)나 빈 S-08로 빠진다. 동의 기록·`profiles`가 이미 지워져 "동의 없음 = 신규 가입자"와도 구분해야 한다.
- 수정 제안: DM 6.1(또는 4.5 탈퇴 표)에 판정 규칙 하나를 적는다. 예: "`account_deletion_logs`에 `subject_hash(user id)` 행이 있고 auth 사용자가 남아 있으면 탈퇴 미완료" — 신규 가입자는 `profiles` 행이 없어도 로그 행이 없으므로 구분된다. 판정 RPC 이름(예: `get_account_deletion_state`)과 실행 역할(로그는 사용자 select 불가라면 서버 전용)도 함께.

#### R-51 [Minor] 새 진행 단계의 화면 문구·순서가 AI C-6과 UX C-03에서 다르다
- 담당: ai-feature-designer, ux-planner
- 위치·근거
  - AI C-6 진행 단계 표(280~284행, 머리 "화면 문구 제안 (ux-planner 확정)"): AI-02 `prepare` "**공고 요건 정리 중**", AI-05 `complete` "별도 문구 없이 `generate` 문구 유지", 채점 = "`prepare` → `evaluate` → `summarize` → `score` → `complete`". AI-02 카드 응답 모드에도 "`prepare` '공고 요건 정리 중'".
  - UX C-03 단계 문구(669행): `prepare` "**공고 요건 확인 중**", `complete` "**마무리하는 중**". UX S-22 다시 채점 표·FL-12(409행)·S-37: 채점 순서 "`evaluate` → `summarize` → `score` → `complete`"(`prepare` 없음).
- 내용: UX 요청 2가 미해소다. 문구는 UX가 정하고 AI 표는 "ux-planner 확정"이라고 적어서, 구현자가 두 값 중 하나를 골라야 한다. 채점 첫 단계 `prepare`가 오면 UX 문구 표에는 "공고 요건 확인 중"만 있어 채점 화면에 엉뚱한 문구가 뜰 수 있다.
- 수정 제안: ai-feature-designer는 C-6 표·AI-02 카드 문구를 UX C-03 값으로 바꾼다. ux-planner는 채점 `prepare`의 문구(예: "채점 준비 중")를 C-03에 더하고 S-22·FL-12 순서에 `prepare`를 넣는다(또는 AI가 채점 `prepare`를 표시하지 않는 단계로 적는다).

#### R-52 [Minor] A13의 자소서·AI-11 적용과 비동기 선행 추출의 확정 수준이 PRD와 AI에서 다르다
- 담당: product-planner
- 위치·근거
  - PRD D-30(v4.3): 경력기술서만 확정. "인사이트·면접처럼 비동기 작업인 기능은 작업의 첫 단계에서 추출을 먼저 한다 `[가정]`". 자소서·AI-11은 언급이 없다. 그런데 PRD 6.4 "서류 초안 (문항당)" 비고는 서류 전체에 "요건 추출이 먼저 필요하면 추출은 별도 단계로 먼저 끝나고"라고 적었다.
  - AI C-6: 비동기 선행 추출은 `prepare` 단계로 확정 서술, "AI-04 자소서 문항 생성과 AI-11 정렬도 같은 순서 `[가정]`". AI 끝 요청 product-planner 1: "확정해 주세요". UX S-18도 `[가정]`.
- 내용: 같은 규칙이 PRD 안에서(D-30 vs 6.4)와 문서 사이에서 다른 수준으로 적혀 있다. 사용자 결정 대상은 아니고 팀 확정으로 닫을 수 있는 항목이다.
- 수정 제안: D-30 (v4.3) 문단을 "서류 3종(경력기술서·자소서·AI-11 선택)은 화면이 추출을 먼저 끝낸 뒤 요청 — 경력기술서는 확정 2026-11-05 (사용자), 나머지는 확정 (2026-11-05, 팀). 인사이트·면접은 작업 첫 단계 `prepare`에서 추출 — 확정 (2026-11-05, 팀)(구현과 같음)"으로 고친다. 확정하면 AI C-6·UX S-18의 `[가정]`도 지운다(각 담당).

#### R-53 [Minor] A6 재개 진입점이 DM 2.5와 UX에서 다르다
- 담당: data-architect
- 위치·근거
  - DM 2.5 상태 전이 표(282행): `abandoned → active` 주체 "사용자 동작(S-08 **'작성 중인 AI 대화'**·S-36 [이어 하기])".
  - UX S-08: `active` 대화는 "작성 중인 AI 대화", `abandoned` 대화는 새 행 **"그만둔 AI 대화"**(923행)에서 "다시 이어 하기". S-10 대화 기록에도 "abandoned면 '다시 이어 하기'". DM 7장 API 표는 "S-08, S-10, S-36"으로 맞게 적었다.
- 내용: 화면 이름이 어긋나 백엔드가 재개 동작을 어느 화면 이벤트에 붙일지 헷갈릴 수 있다(문장 수준).
- 수정 제안: DM 2.5 주체 칸을 "사용자 동작(S-08 '그만둔 AI 대화'·S-10 대화 기록의 [다시 이어 하기])"로 고친다.

#### R-54 [Minor] A17 `tone` 미지정 기본값이 UX와 DM에서 다르다
- 담당: ux-planner, data-architect
- 위치·근거
  - UX S-17(1149행): "문체 선택 간결 / 상세. **기본 간결** `[가정]`".
  - DM A.9·2.7 v4.2 표(378행): "`options.tone` … **미지정은 null(톤 지시 없음)** `[가정]`". AI AI-03은 값 목록만 적었다.
- 내용: 화면이 항상 `concise`를 보내면 null은 생기지 않고, null을 허용하면 "간결 선택"과 "지시 없음"이 다른 출력·다른 `input_hash`가 된다. 기본값이 어디서 정해지는지 한쪽으로 모아야 한다.
- 수정 제안: 둘 중 하나로 맞춘다. (a) UX 기본 간결 → DM "화면은 항상 값을 보낸다. null은 v4.2 이전 초안만" (b) DM null 허용 → UX 기본 선택 없음. 권고 (a).

#### R-55 [Minor] UX의 다시 채점 문구가 "새 결과 표식을 지운다"로 읽힌다
- 담당: ux-planner
- 위치·근거: UX FL-12(409행) "다시 채점을 시작하면 세션 점수·완료 시각·**'새 결과' 표식이 비워지고**(`result_viewed_at = null`), 끝나면 다시 '새 결과'로 보인다". `result_viewed_at = null`은 표식이 **켜진** 상태다. 결정 A9는 "다시 채점하면 되살린다", AI AI-06은 "표식을 되살린다(null로 되돌림)". UX S-37 행은 "표식이 비워졌다가 끝나면 다시 켜진다"로 화면 동작은 같다.
- 내용: 동작은 같지만 문장이 컬럼 값과 반대로 읽혀 구현 때 반대로 옮길 수 있다.
- 수정 제안: "다시 채점을 시작하면 세션 점수·완료 시각을 비우고 `result_viewed_at`을 null로 되돌린다(채점 중에는 표식을 보이지 않다가, 끝나면 '새 결과'로 보인다)"로 고친다.

#### R-56 [Minor] F-AI-04 (5) "공급자·등급을 바꾸면 다시 동의"가 2.11.5 규칙 1과 다르다
- 담당: product-planner
- 위치·근거
  - PRD F-AI-04 (5)(v4.3): "**공급자·등급을 바꾸면 다시 동의받는다.** 고지 문구 버전이 바뀐 경우에는 … `requires_reconsent` … 새 버전이 있을 때만".
  - DM 2.11.5: "`(provider, connection_tier)`의 최신 `withdrawn_at is null` 동의 행이 **없으면** 동의 필요". UX S-40(1297행)·FL-20: "그 공급자·등급 동의가 **없거나** `requires_reconsent` 새 버전이 있으면 C-21". UX C-21 기록 행: "처음 쓰는 공급자·등급이면 동의를 받는다".
- 내용: 이미 동의한 공급자로 활성을 되돌리면 PRD는 다시 동의, DM·UX는 묻지 않는다. 이번 A20 통일로 버전 규칙은 맞췄지만 같은 문장 안의 공급자·등급 전환 규칙이 남았다.
- 수정 제안: "(5) 유효한 동의가 없는 공급자·등급으로 바꾸면 동의받는다(이미 동의한 공급자·등급으로 돌아가면 다시 묻지 않음)"로 고친다.

#### R-57 [Minor] UX의 PRD 요청(용어 3개, S-36 무료 등급 문장)이 반영되지 않았다
- 담당: product-planner
- 위치·근거: UX 끝 v5.3 요청 product-planner 1 "S-36 시작 인사의 무료 등급 문장 … D-10 고지 문구 확정 때 함께 확정", 2 "용어 추가 제안: '탈퇴 마무리', '그만둔 대화', '생성 직후 안내'". PRD 8장 용어집에는 AI 작성 대화 정의에 "그만둔 대화도 다시 이어 할 수 있다"만 더했고, 세 용어 행은 없다. PRD 9.0 D-10 행은 "정책·AI 고지 문서의 실제 버전과 문구"만 적고 S-36 문장을 언급하지 않는다.
- 내용: 세 용어는 화면 문구로 이미 쓰인다(S-25, S-08, S-19). 용어집에 없으면 UI 하네스가 다른 말로 옮길 수 있다.
- 수정 제안: 용어집에 세 용어를 더하고, 9.0 D-10 행에 "S-36 시작 인사 무료 등급 문장·C-19 툴팁 포함"을 덧붙인다.

#### R-58 [Minor] UX 본문에 옛 버전 참조 2곳
- 담당: ux-planner
- 위치·근거
  - UX C-20(848행): "**자동 재시도 규칙** (AI 명세 **v4.1** C-11.3, 유료·무료 같음)". v4.3 C-11.3은 동기·스트리밍 경로 규칙이 바뀌었다(바로 아래 새 문단이 v4.3을 인용).
  - UX S-36(1028행): "데이터 (데이터 모델 **v4.1** 2.5)". 같은 줄 내용은 v4.2(시작 인사 제외, `abandoned → active`)다.
- 수정 제안: 두 곳을 "AI 명세 v4.3 C-11.3", "데이터 모델 v4.2 2.5"로 고친다.

### 이슈 목록

| ID | 심각도 | 담당 | 한 줄 |
|----|--------|------|-------|
| R-48 | Major | product-planner(주), ux-planner, ai-feature-designer, data-architect | A1 다시 시도 공급자: 요청 범위 작업·다시 채점의 예외가 PRD·UX에 없음 |
| R-49 | Major | data-architect, ux-planner | 다시 시도 거부 코드 `ai_consent_required`가 DM에만, 다른 경로는 `key_missing` |
| R-50 | Major | data-architect | A7 탈퇴 미완료 서버 판정 방법 미기재(UX 요청 미해소) |
| R-51 | Minor | ai-feature-designer, ux-planner | `prepare`·`complete` 문구, 채점 `prepare` 단계가 AI C-6과 UX C-03에서 다름 |
| R-52 | Minor | product-planner | A13 자소서·AI-11·비동기 선행 추출의 확정 수준(D-30 `[가정]` vs 6.4·AI C-6) |
| R-53 | Minor | data-architect | A6 재개 진입점 화면 이름(DM 2.5 vs UX S-08 "그만둔 AI 대화"·S-10) |
| R-54 | Minor | ux-planner, data-architect | `tone` 미지정 기본값(UX 간결 vs DM null) |
| R-55 | Minor | ux-planner | FL-12 "새 결과 표식이 비워지고(`result_viewed_at = null`)" 문장이 값과 반대 |
| R-56 | Minor | product-planner | F-AI-04 (5) 공급자·등급 전환 재동의가 2.11.5·UX와 다름 |
| R-57 | Minor | product-planner | 용어 3개·S-36 무료 등급 문장 D-10 연결 미반영 |
| R-58 | Minor | ux-planner | UX 본문 옛 버전 참조 2곳(AI v4.1 C-11.3, DM v4.1 2.5) |

### 결정 필요 후보 (리더 전달)

- R-48: 담당 간 해석이 갈리면 `[결정 필요]` — "요청 범위 작업의 다시 시도·면접 다시 채점도 처음 공급자로 고정할지". 선택지 (a) 고정하지 않음(새 실행 = 활성 공급자, AI·DM 현재 서술) (b) 고정. 권고 (a).
- 그 밖 이슈는 팀 안에서 문장 수정으로 닫을 수 있다. 출시 전 확정 항목(D-10 고지 문구, KMS 공급사)은 PRD 9.0에 이미 있다.

## 백엔드 구현 반영 리뷰 (2026-11-05) — 라운드 2 (최종)

> 작성: spec-reviewer / 대상: PRD v4.3, UX v5.3, AI v4.3, DM v4.2 (라운드 1 이후 담당자 수정본) / 기준: 라운드 1 R-48~R-58, `00_input/brief-2026-11-05.md` "리뷰 라운드 1 후 리더 판단"(R-48 두 경우, R-54 tone)
> 방법: 각 이슈의 근거 구절을 네 문서에서 다시 열어 나란히 비교했다. 새 이슈는 이번 수정 부분이 닿는 경계만 봤다. 문서 본문은 고치지 않았다. 이번이 마지막 수정 라운드라, 남은 항목은 "미해결"로 리더에게 넘긴다.

### 요약

- R-48~R-58 11건 중 **10건 해소**. R-49 하나가 **부분 해소**(DM·UX는 맞고 AI C-11.4 한 문장이 옛 코드로 남음)다. 영향 범위가 작아 Major → Minor로 낮춰 미해결로 넘긴다.
- **Critical·Major 미해결 없음.**
- 새 이슈 4건(R-59~R-62), 모두 Minor. R-59(인사이트 "다시 생성"이 두 경우 목록 중 AI에만 있음)만 동작에 닿고, 나머지는 문장·요청 목록 정리다.

### 이슈별 상태 (R-48~R-58)

| ID | 라운드 1 심각도 | 상태 | 확인 근거 |
|----|-----------------|------|-----------|
| R-48 | Major | **해소** (잔여 → R-59) | 네 문서가 같은 두 경우로 나뉜다. PRD F-AI-03 (2) "(가) 같은 작업 행 다시 시도 = 처음 공급자 … (나) 새 작업 = 활성 공급자", F-P3-06 "다시 채점은 새 작업 … (나)". UX C-20 "다시 시도의 공급자" 표 (가)/(나) + 배지·문구 구분, FL-12·S-16·S-19·S-22·S-33·S-37·S-40이 이 표를 가리킨다. AI C-11.4 표 ①/②, AI-06 "'다시 채점'과 '채점 작업 다시 시도'는 다른 동작 … 화면에는 '다시 채점' 하나만". DM 2.9.1 표 (1)/(2)와 7장 "실패 작업 다시 시도" 행. (가)의 대상(`insight`·`interview_questions`·`interview_evaluation` 같은 행, 공용 라우트)과 (나)의 대상(요건 추출·서류 3종 다시 생성, 다시 채점, 남은 질문 다시 만들기)이 같다. 채점 같은 행 재시도는 API에만 있고 화면에 없다는 점도 AI·DM·UX(S-22 "같은 행 다시 시도 버튼을 따로 두지 않는다")가 같다. 인사이트 "다시 생성"만 AI에만 적혀 있다 → R-59 |
| R-49 | Major | **부분 해소 → 미해결 (Minor로 하향)** | DM 2.11.7 경로별 표가 새로 생겼고, 경로 ②(같은 행 다시 시도) 동의 필요 = `ai_consent_required`, ③·④ = `key_missing`. UX C-20 "다시 시도 거부" 행이 같은 코드로 나뉜다(`ai_consent_required` → 작업의 `provider`·`connection_tier`로 C-21). UX FL-20(613행)도 같다. **남은 곳**: AI C-11.4 경우 ①(477행) "그 공급자·등급의 실행 동의가 필요하면(A20) 같은 연결 안내(`key_missing`)로 거부한다". DM 11.5도 "AI C-11.4 (리뷰 R-49)"를 참조 문서로 적었지만 AI는 고치지 않았다. DM 2.11.7이 "다른 절은 이 표를 가리킨다"고 단일 기준을 선언했고 UX가 그것을 따르므로 구현이 갈릴 위험은 낮다 → Minor. 수정: AI C-11.4 경우 ① 문장을 "동의 필요는 409 `ai_consent_required`(DM 2.11.7 경로 ②), 실행 중 단계 확인(경로 ③)에서는 `key_missing`"으로. 담당 ai-feature-designer |
| R-50 | Major | **해소** (UX 쪽 낡은 표시 → R-61) | DM 6.1 표 아래 "탈퇴 미완료 상태의 서버 판정": `profiles` 없음 + `account_deletion_logs`에 `subject_hash` 행 있음 = 탈퇴 미완료. 신규 가입자는 가입 트리거로 `profiles`가 있어 구분되고, 재가입은 새 user id라 hash가 다르다. RPC `get_account_deletion_state(p_user_id)` → `active`/`deletion_incomplete`/`profile_missing`, 서버 전용 역할, `profiles`가 없을 때만 호출, `deletion_incomplete`면 동의 게이트보다 먼저 S-25. DM 4.5 "auth 삭제 실패" 행과 7장 F-COM-05 행이 이 판정을 가리킨다. UX FL-07(540행)·L-01 첫 화면(181행)·S-02(908행)의 "동의 게이트·원래 URL보다 먼저 S-25"와 순서가 맞는다 |
| R-51 | Minor | **해소** | AI C-6 표 머리가 "문구는 UX C-03 기준"으로 바뀌었고, 287행 "화면 문구의 최종 권한은 UX다 … 이 문서는 문구를 따로 두지 않는다". AI-02 카드(864행)도 "단계별 화면 문구는 UX C-03 기준". 채점 `prepare`는 양쪽에 있다: AI C-6 채점 행 "`prepare`가 있다 … AI 호출·요건 추출이 없다 → `evaluate` → `summarize` → `score` → `complete`", UX C-03 "채점: 채점 준비 중", FL-12(409행)·S-22 진행 중 행(1216행) 순서에 `prepare` 포함. `complete` 문구(별도 문구 없이 직전 단계 유지)도 같다 |
| R-52 | Minor | **해소** | PRD D-30 (v4.3): 경력기술서 확정(사용자), 자기소개서·AI-11 확정 (2026-11-05, 팀), 인사이트·면접 `prepare` 선행 추출 확정 (팀). F-P2-02·6.4·9.2 A13 행이 같다. AI C-6(272행) "확정 2026-11-05 (팀)", UX 결정 반영표(1514행)도 같다. 남은 `[가정]` 없음 |
| R-53 | Minor | **해소** | DM 2.5(282행) 주체 "S-08 '그만둔 AI 대화'·S-10 대화 기록의 [다시 이어 하기]". UX S-08(933행)·S-10(1096행)과 같다 |
| R-54 | Minor | **해소** (AI 쪽 잔여 → R-60) | 리더 판단대로 UX S-17(1159행) "화면 기본 선택은 간결 … 화면은 항상 값을 보낸다. DB는 null을 허용하며 null은 간결로 처리", DM 2.7(378행) "null은 `concise`로 처리 … 프롬프트와 `input_hash`에서 정규화". 두 문서가 같다 |
| R-55 | Minor | **해소** | UX FL-12(409행) "세션 점수·완료 시각을 비우고 `result_viewed_at`을 null로 되돌린다(채점 중에는 표식을 보이지 않다가, 끝나면 '새 결과'로 보인다)". AI AI-06·DM A.12와 같은 방향 |
| R-56 | Minor | **해소** | PRD F-AI-04 (5) "유효한 동의가 없는 공급자·등급으로 바꾸면 동의받는다. 이미 동의한(철회하지 않은) 공급자·등급으로 돌아가면 다시 묻지 않는다". DM 2.11.5·UX S-40(1307행)과 같다 |
| R-57 | Minor | **해소** | PRD 8장에 "그만둔 대화"(451행), "생성 직후 안내"(463행), "탈퇴 마무리"(466행) 추가. 9.0 D-10 행(481행)에 "AI 작성 대화 시작 인사의 무료 등급 문장과 공급자·등급 배지 툴팁 문구도 함께 확정" |
| R-58 | Minor | **해소** | UX C-20 "자동 재시도 규칙 (AI 명세 v4.3 C-11.3 …)", S-36(1038행) "데이터 (데이터 모델 v4.2 2.5)". 이번 수정으로 새로 들어간 다른 버전 참조(예: 1188행 "데이터 모델 v4.1, 구현 반영" — `question_provider` 등은 DM v4.1 신설이 맞음)도 맞다 |

### 신규 이슈

#### R-59 [Minor] 인사이트 "다시 생성"이 두 경우 목록 중 AI C-11.4에만 있다
- 담당: product-planner(주), ux-planner, data-architect
- 위치·근거
  - AI C-11.4 경우 ②(475행): "요청 범위 작업 … 의 '다시 시도'·'다시 생성', **인사이트 '다시 생성'**, 면접 '다시 채점'·'남은 질문 다시 만들기'".
  - PRD F-AI-03 (2) (나): "요건 추출, 서류 3종 … 의 다시 생성·다시 요청, 면접 '다시 채점'·'남은 질문 다시 만들기'". 인사이트 다시 생성(F-P2-07)이 없다.
  - UX C-20 "다시 시도의 공급자" (나) 행: 요건 추출, 경력기술서, 자기소개서, AI-11, 다시 채점, 남은 질문 다시 만들기. 인사이트 다시 생성이 없다. S-40 확인 문구(1307행)도 "실패한 인사이트·면접 질문 작업의 다시 시도는 원래 공급자로 해요. 서류·요건 정리를 다시 하거나 면접을 다시 채점하면 {공급자}로 해요"라서, 인사이트에 대해서는 "원래 공급자"만 안내한다.
  - DM 2.9.1 경우 (2): 인사이트 다시 생성이 없고, 대신 다른 문서에 없는 "AI 작성 대화 '다시 보내기'(새 턴 작업)"가 있다.
- 내용: S-16에는 실패 행 "다시 시도"(가)와 결과가 있을 때의 "다시 생성"(F-P2-07, "데이터 변경됨" 뒤)이 함께 있다. 둘이 다른 공급자로 돈다는 것이 AI에만 적혀 있어, 화면·API 구현자가 인사이트의 두 버튼을 같은 (가) 규칙으로 묶을 수 있다. S-40 문구를 그대로 쓰면 사용자는 인사이트 다시 생성도 원래 공급자로 간다고 읽는다.
- 수정 제안: PRD F-AI-03 (2) (나)·UX C-20 (나) 행·DM 2.9.1 (2)에 "인사이트 '다시 생성'(F-P2-07, 새 `insight` 작업)"을 더한다. UX S-40 확인 문구 뒷문장을 "인사이트·서류·요건 정리를 다시 만들거나 면접을 다시 채점하면 {공급자}로 해요"처럼 고친다. DM의 "다시 보내기"는 PRD F-AI-03 (2) "진행 중인 AI 작성 대화는 다음 메시지부터 새 공급자"와 같은 뜻이라 PRD·UX (나)에 한 줄로 맞추거나 DM에서 빼도 된다.

#### R-60 [Minor] AI-03에 `tone` null 처리가 없다
- 담당: ai-feature-designer
- 위치·근거
  - DM 2.7(378행): "null은 `concise`로 처리한다 — 생성 프롬프트와 `input_hash`에서 null을 `concise`로 정규화해 '간결 선택'과 '값 없음'이 같은 출력·같은 해시가 되게 한다(리더 판단 2026-11-05, R-54. 정규화 위치는 `[가정]`)". UX S-17도 같다.
  - AI AI-03 입력 표(975행): "`concise`(간결) / `detailed`(상세) 두 값. **그 밖의 값은 프롬프트에 넣지 않고 무시한다**". null도 "그 밖의 값"으로 읽혀 톤 지시가 빠진다. AI-03 재사용 문장(965행)은 "정규화한 옵션·tone"이라고만 적었다.
- 내용: 프롬프트를 만드는 쪽(AI 파이프라인)이 AI-03만 보면 null = 지시 없음으로 구현하고, `input_hash`는 DM대로 `concise`로 정규화하면 같은 해시에 다른 출력이 생길 수 있다.
- 수정 제안: AI-03 입력 표에 "null(값 없는 이전 초안)은 `concise`로 정규화한 뒤 프롬프트와 `input_hash`에 넣는다(DM 2.7, R-54)"를 더한다.

#### R-61 [Minor] UX에 이미 해소된 요청·열린 항목이 "열림"으로 남아 있다
- 담당: ux-planner
- 위치·근거
  - S-25 "재진입" 행(1291행): "A7. **판정 방법은 데이터 모델 확인 요청**". 5.2 열린 항목(1546행) "탈퇴 미완료 판정 방법(데이터 모델)". 요청 data-architect 1(1577행). → DM 6.1 `get_account_deletion_state`로 답이 나왔다(R-50 해소). DM의 세 번째 값 `profile_missing`(가입 트리거 누락, "일반 오류 화면 `[가정]`")의 화면 처리도 UX에는 없다.
  - C-03 단계 문구 비고(669행) "(AI C-6 표에 같은 값 반영 요청)", 요청 ai-feature-designer 1(1583행) "C-6 표 채점 행 문구 칸을 … 적어 달라". → AI는 문구를 두지 않고 C-03에 위임하는 쪽으로 닫았다(R-51 해소). 요청 ai-feature-designer 2(1584행)도 AI-06 1425행·C-11.4 표로 답이 나왔다.
  - 요청 product-planner 1·2(1587~1588행) → PRD D-10 행·용어집으로 반영됨(R-57 해소). "v5 이전 요청" product-planner 1~3(D-UX-14~16, OpenAI·Claude 등급 기본값, 용어 4개)도 PRD 9.3·9.4·8장(431~434행, 542~546행)에 이미 있다.
- 내용: 동작 불일치는 아니지만, UI·백엔드 하네스가 S-25 재진입을 "판정 미정"으로 읽고 임시 판정을 만들 수 있다.
- 수정 제안: S-25 재진입 행을 "판정: DM 6.1 `get_account_deletion_state` = `deletion_incomplete`"로 바꾸고, `profile_missing`은 "일반 오류 화면(ST-xx)" 한 줄을 더한다. 5.2 열린 항목과 위 요청들은 "(해소)"로 닫는다.

#### R-62 [Minor] AI·DM 요청 목록에 해소된 요청이 남아 있다
- 담당: ai-feature-designer, data-architect
- 위치·근거
  - AI "다른 팀원에게 요청" ux-planner 2(1634행, 채점 `prepare` 문구·순서), 4(1636행, C-20·S-40 두 경우 구분), product-planner 2(1641행, F-AI-03 (2) 범위) → 각각 UX C-03·FL-12·S-22, UX C-20·S-40, PRD F-AI-03 (2)에 반영됐다. product-planner 1만 "(해소)"로 닫혀 있다.
  - DM 11.5 마지막 줄(1202행) "UX C-20·S-40 다시 시도 문구를 … 구분, C-20에 `ai_consent_required` 행 추가" → UX 반영 완료. 같은 줄의 "AI C-11.4 … 같은 구분"은 구분은 반영됐고 코드만 남았다(R-49).
- 수정 제안: 해소된 항목에 "(해소, 2026-11-05 라운드 2)"를 붙인다. DM 1202행은 "AI C-11.4 경우 ① 동의 필요 코드(R-49)"만 남긴다.

### "다른 팀원에게 요청" 중 남은 미해소 요청

| 문서 | 요청 | 대상 | 상태 |
|------|------|------|------|
| AI v4.3 | ux-planner 5: AI-12 시작 인사 고정 문구(무료 등급 안내)가 공급자별 고지와 맞는지 | PRD D-10 / 법무 D-39 | **열림(출시 전 확정 대기)**. PRD 9.0 D-10 행이 이 문장을 함께 확정하기로 받았다 |
| AI v4.3 | product-planner 3: D-14 점수 산식, D-16 미응답 점수 반영 | 사용자 | **열림(사용자 결정 대기)**, 이번 범위 밖 |
| UX v5.3 | product-planner 1: S-36 시작 인사 무료 등급 문장 확정 | PRD D-10 | 위 AI ux-planner 5와 같은 항목. D-10 확정 때 닫힘 |
| DM v4.2 | 11.5 "AI C-11.4 … 같은 구분" 중 동의 필요 코드 | AI | **미해소** → R-49 |
| DM v4.2 | 11.5 백엔드 후속(★): 2.11.7 경로 ① 동의 필요 코드(`ai_consent_required` `[가정]`), `get_account_deletion_state`, `tone` 정규화 위치 | 백엔드 하네스 | 기획 범위 밖(구현에서 확인). 기획 문서끼리는 맞다 |
| PRD v4.3 | v4.3 추가 요청(ux 1~3, ai 1, dm 1) | 각 문서 | 모두 해소(라운드 1 확인, 이번 재확인) |

그 밖에 각 문서 요청 목록에 "열림"처럼 남은 항목(UX 1577·1583·1584·1587·1588행, UX v5 이전 product-planner 1~3, AI 1634·1636·1641행, DM 1202행 앞부분)은 실제로는 해소됐다 → R-61·R-62.

### 이슈 목록 (라운드 2 종료 시점)

| ID | 심각도 | 담당 | 상태 | 한 줄 |
|----|--------|------|------|-------|
| R-48 | Major | product-planner, ux-planner, ai-feature-designer, data-architect | 해소 | A1 다시 시도 두 경우가 네 문서에서 같은 목록으로 나뉨 |
| R-49 | Minor(Major에서 하향) | ai-feature-designer | **미해결** | AI C-11.4 경우 ① 동의 필요 코드가 `key_missing`, DM 2.11.7 ②·UX C-20은 `ai_consent_required` |
| R-50 | Major | data-architect | 해소 | DM 6.1 `get_account_deletion_state` 판정 |
| R-51 | Minor | ai-feature-designer, ux-planner | 해소 | 문구는 UX C-03, 채점 `prepare` 양쪽에 있음 |
| R-52 | Minor | product-planner | 해소 | D-30 확정 수준 정리 |
| R-53 | Minor | data-architect | 해소 | 재개 진입점 이름 |
| R-54 | Minor | ux-planner, data-architect | 해소 | tone 기본 간결, null = 간결 |
| R-55 | Minor | ux-planner | 해소 | FL-12 문장 |
| R-56 | Minor | product-planner | 해소 | F-AI-04 (5) 전환 재동의 |
| R-57 | Minor | product-planner | 해소 | 용어 3개, D-10 연결 |
| R-58 | Minor | ux-planner | 해소 | 버전 참조 |
| R-59 | Minor | product-planner, ux-planner, data-architect | **미해결(신규)** | 인사이트 "다시 생성"(새 작업, 활성 공급자)이 AI C-11.4에만 있음, S-40 문구 |
| R-60 | Minor | ai-feature-designer | **미해결(신규)** | AI-03에 `tone` null → `concise` 정규화 없음 |
| R-61 | Minor | ux-planner | **미해결(신규)** | S-25 "판정 방법 확인 요청" 등 해소된 요청·열린 항목이 UX에 남음, `profile_missing` 화면 처리 없음 |
| R-62 | Minor | ai-feature-designer, data-architect | **미해결(신규)** | AI·DM 요청 목록의 해소된 항목 미정리 |

### 미해결로 넘기는 항목 (리더 전달)

- 수정 라운드 상한(2회)에 닿았다. 아래는 모두 Minor이고 문장 수정으로 닫힌다. 다음 기획 부분 재실행이나 백엔드 후속 착수 전에 담당자가 한 번에 고치면 된다.
  - R-49 (ai-feature-designer): C-11.4 경우 ① 동의 필요 → `ai_consent_required`.
  - R-59 (product-planner 주, ux-planner, data-architect): (나)/(2) 목록에 인사이트 다시 생성 추가, S-40 문구.
  - R-60 (ai-feature-designer): AI-03 null 정규화 한 줄.
  - R-61 (ux-planner), R-62 (ai-feature-designer, data-architect): 요청·열린 항목 정리.
- 백엔드 하네스에 넘길 확인 항목(기획 문서끼리는 맞음): DM 2.11.7 경로 ① 동의 필요 코드 `[가정]` ★, `get_account_deletion_state` 실행 역할, `tone` 정규화 위치 `[가정]`.

### 사용자 결정이 필요한 항목

- **A1 적용 범위(R-48) — 리더 해석 `[가정]` 확정 여부.** 네 문서가 "같은 행 다시 시도만 처음 공급자, 새 작업을 시작하는 다시 실행은 활성 공급자"로 맞췄고 모두 `[가정]`(리더 해석)으로 표시했다. 사용자 결정 A1 원문은 이 범위를 나누지 않았으므로 사용자 확인을 받으면 `[가정]`을 지울 수 있다. 선택지: (a) 리더 해석 그대로 확정 (b) 새 작업 다시 실행도 처음 공급자로 고정. 권고 (a): 새 작업은 이어 할 상태가 없고, 구현(spec-gaps S8 ④)과도 같다.
- **R-54 tone 기본값** — 리더 판단(화면 기본 간결, null = 간결)으로 네 문서가 맞다. A17 사용자 결정의 세부라 별도 결정은 필요 없다고 본다. 리더가 decisions에 기록만 하면 된다.
- 이미 PRD 9.0에 올라 있는 출시 전 항목(D-10 고지 문구 — 이번에 S-36 시작 인사 문장·C-19 툴팁 포함, D-14·D-16 점수 산식, D-39 법무)은 그대로 대기다. 이번 라운드에서 새로 생긴 사용자 결정 항목은 없다.

### 리더 후속 처리 (2026-11-05, 라운드 2 이후)

- R-49: 리더가 AI C-11.4 경우 ①의 동의 필요 코드를 `ai_consent_required`(409, DM 2.11.7 기준)로 고쳤다 → 해소(리뷰어 재검토 없음)
- R-60: 리더가 AI-03 tone 행에 "null = `concise`, 프롬프트·`input_hash` 같은 값"을 넣었다 → 해소(리뷰어 재검토 없음)
- 미해결로 넘김(Minor): R-59, R-61, R-62

### A1 변경 확인 (2026-11-05)

> 범위: 브리프 `00_input/brief-2026-11-05.md` 끝 "A1 변경 — 사용자 결정 (2026-11-05, 후속)"의 경계만 본다. 대상: PRD v4.3 F-AI-03 (2)·9.0 A1 행, UX v5.3 C-20(다시 시도 거부·다시 시도의 공급자)·S-16·S-33·S-40, AI v4.3 0장 표·C-11.4·AI-06, DM v4.2 0장 공통 메타·2.7·2.9.1·2.11.7·7장·11.5. 본문 문서는 고치지 않았다.

#### 확인 1 — 네 문서의 A1 규칙 문장

| 규칙 | PRD F-AI-03 (2) | UX C-20 | AI C-11.4 | DM 2.9.1 | 판정 |
|------|-----------------|---------|-----------|----------|------|
| 모든 다시 시도·재실행 = 누른 시점의 활성 공급자·등급 | "실패 뒤 다시 실행하는 모든 동작은 현재 활성 공급자로 돈다" | "경우를 나누지 않는다" | "모든 다시 시도·재실행은 누른 시점의 현재 활성 공급자·등급" | "모든 재실행은 다시 시도를 누른 시점의 활성 공급자·등급" | 같음 |
| 같은 행 다시 시도: 다르면 `step_outputs` 버리고 처음 단계부터 | "다르면 처음 단계부터 다시" | "처음 단계(`prepare`)부터" | "`step_outputs`를 버리고 처음 단계(`prepare`)부터" | "`step_outputs`를 비우고 처음 단계부터" | 같음 |
| 같으면 이어서 | "같으면 끝난 단계는 건너뛰고" | "같으면 … 이어서" | "같으면 … 실패한 단계부터 잇는다" | "같으면 `step_outputs` 유지" | 같음 |
| 비교 기준 | **"작업을 처음 실행한 것과"** | "작업 행의 `provider`·`connection_tier`와" | "작업에 기록된 것과" | "기록된 값과" | **PRD만 다름 → R-66** |
| 진행 중 작업 = 시작 공급자로 끝까지 | "진행 중 작업은 시작할 때의 공급자로 끝낸다" | "진행 중(running) 작업만 시작한 공급자로" | "진행 중(`running`) 작업은 시작한 공급자로" | "진행 중(`running`) 작업만 시작한 공급자로" | 같음 |
| 화면 문구 폐기·배지 | 다시 시도 옆 활성 공급자, 다르면 "{활성 공급자}로 처음부터 다시 해요" | 같음(C-20 표, S-16·S-33 본문) | 같음 | 같음(UX 담당으로 위임) | 같음. S-40 확인 문구(1306행)도 "다시 시도·다시 생성·다시 채점도 {공급자}로 해요"로 바뀜 |

- 경우 구분: AI C-11.4 ①/②, DM 2.9.1 (1)/(2)는 "공급자 규칙은 같고 작업 행·`step_outputs`만 다름"으로 같은 말을 한다. UX는 표를 하나로 합쳤다. 해당 동작 목록은 인사이트 "다시 생성"을 빼면 맞다(→ 확인 5, R-65).
- AI-06(1427행) "다시 채점(경우 ②)과 채점 작업 다시 시도(경우 ①)는 다른 동작, 공급자는 둘 다 활성"은 DM 2.9.1 표·UX S-22("다시 채점" 하나만)와 맞다.

#### 확인 2 — 거부 코드 (활성 공급자·등급 기준)

| 상황 | DM 2.11.7 ② 같은 행 다시 시도 | UX C-20 "다시 시도 거부" | AI C-11.4 | 판정 |
|------|-------------------------------|--------------------------|-----------|------|
| 키 없음 | `key_missing`(활성 공급자의 키 없음) | `key_missing`(활성 공급자) → C-18 | `key_missing` | 같음 |
| 동의 필요 | `ai_consent_required`(활성 공급자·활성 키 현재 등급) | `ai_consent_required` → 활성 공급자·등급으로 C-21 | 409 `ai_consent_required`, 활성 공급자·등급으로 C-21 | 같음(R-49 리더 수정 확인) |
| 키 무효 | `key_invalid`(활성 키) | `key_invalid` → 키 교체 | `key_invalid` | 같음 |

- 경로 ② 세 코드는 세 문서가 같다. 다만 AI C-11.4 문장이 "**두 경우 모두** … 키가 없으면 `key_missing`"이고 근거를 `check_ai_run_allowed`(DM 경로 ③ 실행 중 확인)로 적었다. 경우 ②(새 작업 시작)는 DM 2.11.7 경로 ①이라 키 없음 = `ai_not_connected`다 → R-64.
- 경로 ③·④에서 동의 필요가 `key_missing`으로 합쳐지는 규칙은 DM·UX가 같다(이번 변경 영향 없음).

#### 확인 3 — 공급자 컬럼 갱신과 AI `[가정]`(이미 저장된 질문·평가 교체)의 DM 뒷받침

- `ai_jobs`: DM 2.9.1 컬럼표 `provider`(420행) "같은 행 다시 시도는 … 그 시점 활성 공급자로 갱신", 상태 전이(441행) "`provider`·`model`·`model_tier`·`connection_tier`는 활성 값으로 갱신하고, 기록된 값과 다르면 `step_outputs`를 비우며" → 받쳐 있다. AI C-11.4는 `model_tier`를 빼고 세 개만 적었지만 `model_tier`는 기능별 고정 매핑이라 구현 차이는 없다(이슈 아님).
- 결과 행·`interview_sessions`: DM 2.9.1 (1) "결과 행의 `provider`·`model`·`model_tier`·`connection_tier`와 `interview_sessions.question_*`/`evaluation_*`도 이 실행 값으로 기록(2.7)" → 받쳐 있다. 2.7(371행) "`question_*` 생성 성공 시 기록, `evaluation_*` 채점 시작 시 기록"과도 어긋나지 않는다.
- **AI `[가정]` "처음부터 다시 돌 때 이미 저장된 면접 질문·답변 평가를 새 결과로 바꾼다"는 DM에 받쳐 있지 않다.** DM 0장 결과 테이블 내부 컬럼(41행) "이전 세대에서 실패한 행만 수동 재시도가 다시 열고"는 공급자가 바뀌어도 성공한 행은 그대로 둔다는 뜻이고, 2.9.1 (1)·11.5에는 교체 규칙이 없다. AI 요청 data-architect 4(1633행)도 답이 없다 → R-63.

#### 확인 4 — 잔여 표현 grep ("처음 공급자"·"원래 공급자"·"처음 실행한"·R-48 (가)/(나))

| 위치 | 표현 | 맥락 | 판정 |
|------|------|------|------|
| PRD 611행, UX 1567행(변경 이력) | (가)/(나) | "A1 변경으로 … 구분 제거" | 폐기 맥락, 문제없음 |
| AI 16·470·1621·1644행, DM 442·1089행, UX 851행 | "처음 공급자"·"R-48 해석" | "폐기" | 폐기 맥락, 문제없음 |
| AI 481·1639행, DM 453·1206행, PRD 660행 | "처음 실행한 {공급자}로 다시 해요"·"원래 공급자로" | "없앤다" | 폐기 맥락, 문제없음 |
| UX 1306행 S-40 확인 문구 | "진행 중인 작업만 원래 공급자로 끝까지 해요" | 진행 중 작업 | 뜻은 맞다(시작 공급자). 다른 문서는 "시작한 공급자"라 써서 표현만 다름 — 이슈 아님(원하면 "시작한 공급자로") |
| **PRD 131행 F-AI-03 (2)** | "작업을 **처음 실행한** 것과 다르면 처음 단계부터" | 현행 규칙 | **R-66** |
| UX 1150·1190행 | "공급자가 처음과 다르면" | 화면 문구 조건 | 브리프 원문 "처음과 다르면"과 같은 말이고 C-20 표가 "작업 행의 `provider`·`connection_tier`와 다르면"으로 정의하므로 이슈 아님. R-66 정리 때 함께 맞추면 좋다 |

- 요청 목록 잔여: AI ux-planner 4·product-planner 2(1639·1644행), PRD v4.3 추가 요청 ux-planner (1)·ai-feature-designer(660·661행), DM 11.5 1206행은 이번 반영으로 해소됐는데 "(해소)" 표시가 없다. R-62와 같은 종류라 R-62 범위에 더한다(새 번호 없음).

#### 확인 5 — R-59 (인사이트 "다시 생성" 누락)

- 공급자 쟁점은 A1 변경으로 닫혔다: 모든 재실행이 활성 공급자라 "인사이트 다시 생성이 어느 목록에 있느냐"가 공급자를 바꾸지 않는다. UX C-20 표(855행)·S-16(1150행) "인사이트 '다시 생성'도 활성 공급자", AI C-11.4 ② "인사이트 '다시 생성'"으로 들어갔다. S-40 문구도 고쳐졌다(1306행). PRD F-AI-03 (2)는 "모든 동작" 총칙으로 덮는다.
- 남은 것: **DM 2.9.1 (2) 새 작업 시작 목록(447행)에 인사이트 "다시 생성"이 없다.** 새 행인지 같은 행인지, 거부 코드가 경로 ①인지가 DM에 적혀 있지 않다 → R-65로 넘기고 R-59는 해소로 닫는다.

#### 새 이슈

##### R-63 [Major] 같은 행 다시 시도에서 공급자가 바뀌면 이미 저장된 질문·답변 평가를 바꾸는지 AI와 DM이 다르다
- 담당: data-architect(주), ai-feature-designer
- 위치·근거
  - AI C-11.4 477행: "그 작업이 이미 저장한 부분 결과(AI-05 이 세션에 저장된 질문, AI-06 이 작업에서 저장된 답변 평가)도 새 실행의 결과로 바꾼다 … `[가정]`(… data-architect 확인 요청)". AI 요청 data-architect 4(1633행)도 같은 확인을 요청했다.
  - DM 0장 41행: "`run_generation` … 이전 세대에서 실패한 행만 수동 재시도가 다시 열고, 늦게 도착한 이전 세대의 완료는 `stale_run`으로 버린다". 2.9.1 (1)(446행)은 `step_outputs`를 비우는 것만 말하고, 이미 `succeeded`인 `answer_evaluations`·`interview_questions`·`session_feedbacks` 행을 다시 여는 규칙이 없다.
  - 결과: DM대로 구현하면 `step_outputs`는 비워도 성공한 답변 평가는 옛 공급자 결과로 남고 실패한 답변만 새 공급자로 채점된다. 리더 판단의 목적("한 결과가 두 공급자의 출력으로 섞이지 않게")이 채점 작업에서는 이뤄지지 않고, AI `[가정]`과 RPC 동작(`complete_*`의 세대 검사)이 서로 다르게 구현된다.
  - 참고: 다시 채점(새 작업, A9)은 사용자 결정으로 "실패한 답변만" 다시 평가하므로 거기서는 답변별로 공급자가 섞인다. 각 결과 행에 공급자 메타가 있어 화면 배지는 답변마다 맞게 나온다.
- 수정 제안 (리더 판단 필요): (a) **권고** — DM 2.9.1 (1)과 0장 41행에 "공급자·등급이 바뀐 같은 행 다시 시도는 이 작업이 쓴 결과 행 전부(AI-05 이 세션 질문, AI-06 이 작업의 답변 평가와 `session_feedbacks`)를 새 세대로 다시 열고 덮어쓴다(같을 때만 '실패한 행만')"를 넣고 해당 `begin_*`/`complete_*` RPC에 반영, 11.5 백엔드 후속 ★에 추가. AI는 `[가정]`을 지운다. (b) AI `[가정]`을 지우고 DM 41행 그대로 둔다 — 행별 공급자 메타로 섞임을 허용(A9 다시 채점과 같은 방식). 이때 리더 판단 문장 "섞이지 않게"는 "`step_outputs`(검증 전 중간 결과)를 섞지 않게"로 좁힌다.
- `[결정 필요]`(리더): (a)/(b). 사용자 결정 A1 원문 범위 밖의 세부라 리더가 정해도 된다.

##### R-64 [Minor] AI C-11.4가 새 작업 시작(경우 ②)의 키 없음 코드도 `key_missing`이라 적었다
- 담당: ai-feature-designer
- 위치·근거
  - AI C-11.4 478행: "**연결 확인은 두 경우 모두** 활성 공급자·등급 기준(`check_ai_run_allowed`): 활성 공급자 키가 없으면 `key_missing`".
  - DM 2.11.7 661행 경로 ① 새 작업 시작: 키 없음 `ai_not_connected`(409) `[가정]`. 경로 ②(같은 행 다시 시도)만 `key_missing`. `check_ai_run_allowed`는 경로 ③(실행 중 단계 확인)이다.
  - UX C-20 845행은 경로 ①을 `ai_not_connected` → C-18로 따로 적어 DM과 같다.
- 수정 제안: "연결 확인은 두 경우 모두 활성 공급자·등급 기준이고, 거부 코드는 DM 2.11.7 경로별 — 경우 ①(다시 시도 라우트) `key_missing`/`ai_consent_required`/`key_invalid`, 경우 ②(새 작업 시작) `ai_not_connected`/`ai_consent_required`/`key_invalid`. 실행 중 단계 확인(`check_ai_run_allowed`)은 경로 ③"으로 고친다.

##### R-65 [Minor] DM 2.9.1 (2) 새 작업 목록에 인사이트 "다시 생성"이 없다 (R-59 잔여)
- 담당: data-architect
- 위치·근거: DM 447행 (2) 목록은 요청 범위 작업 다시 생성, 면접 다시 채점·남은 질문 다시 만들기, AI 작성 대화 다시 보내기만 적었다. AI C-11.4 ②(475행)·UX C-20(855행)·S-16(1150행)은 인사이트 "다시 생성"(F-P2-07)을 새 실행으로 둔다. 7장 1014행도 같은 목록을 쓴다.
- 수정 제안: (2) 목록에 "인사이트 다시 생성(F-P2-07, 새 `insight` 작업 행, 이전 인사이트 행은 새 결과로 대체 — 기존 2.x 인사이트 버전 규칙 따름)"과 거부 코드 경로 ①을 더한다. PRD F-AI-03 (2) 새 작업 괄호 목록에도 "인사이트 다시 생성"을 넣으면 네 문서 목록이 같아진다(선택, product-planner).

##### R-66 [Minor] PRD F-AI-03 (2)의 비교 기준이 "처음 실행한 것"이라 다른 세 문서("작업에 기록된 값")와 다르다
- 담당: product-planner
- 위치·근거
  - PRD 131행: "같은 작업 행 다시 시도에서 활성 공급자·등급이 **작업을 처음 실행한 것과** 다르면 처음 단계부터 다시". 9.0 A1 행(568행) "처음과 다르면"도 같다.
  - DM 441행 "기록된 값과 다르면", AI 474행 "작업에 기록된 것과", UX 855행 "작업 행의 `provider`·`connection_tier`와 다르면". DM은 다시 시도마다 기록값을 활성 값으로 갱신하므로 두 번째 다시 시도부터는 "처음 실행"과 "기록된 값"이 다르다.
  - 예: A로 실패 → B로 다시 시도(처음부터, 기록 = B) 실패 → B로 또 다시 시도. DM·AI·UX는 "같음 → 이어서", PRD 문장대로면 "처음(A)과 다름 → 또 처음부터". 화면 배지 조건도 둘로 갈린다.
- 수정 제안: PRD 131·568행을 "작업에 기록된(직전 실행의) 공급자·등급과 다르면"으로 고친다. UX 1150·1190행 "처음과 다르면"도 "직전 실행과 다르면"으로 맞추면 좋다(선택).

#### 이슈 목록 (A1 변경 확인 후)

| ID | 심각도 | 담당 | 상태 | 한 줄 |
|----|--------|------|------|-------|
| R-59 | Minor | product-planner, ux-planner, data-architect | **해소**(공급자 쟁점 A1 변경으로 소멸, UX·AI·S-40 반영) | 남은 DM 목록 누락은 R-65 |
| R-61 | Minor | ux-planner | 미해결(변동 없음) | UX 해소된 요청·열린 항목 정리 |
| R-62 | Minor | ai-feature-designer, data-architect (+ product-planner) | 미해결(범위 추가) | 요청 목록 해소 표시 누락. 이번 A1 반영분(AI 1639·1644행, PRD 660·661행, DM 1206행) 추가 |
| R-63 | **Major** | data-architect, ai-feature-designer | **신규** | 공급자 바뀐 같은 행 다시 시도에서 저장된 질문·답변 평가 교체 여부: AI `[가정]` "바꾼다" ↔ DM 41행 "실패한 행만 다시 연다" |
| R-64 | Minor | ai-feature-designer | 신규 | AI C-11.4 "두 경우 모두 키 없음 = `key_missing`" ↔ DM 2.11.7 경로 ① `ai_not_connected` |
| R-65 | Minor | data-architect (+ product-planner 선택) | 신규 | DM 2.9.1 (2)·7장 목록에 인사이트 "다시 생성" 없음 |
| R-66 | Minor | product-planner | 신규 | PRD F-AI-03 (2) 비교 기준 "처음 실행한 것" ↔ 세 문서 "작업에 기록된 값" |

#### 리더 전달

- `[결정 필요]`(리더): R-63 (a) 결과 행 전부 다시 열기 / (b) 실패 행만 + `[가정]` 삭제. 권고 (a) — 리더 판단 "섞이지 않게"의 목적과 맞다. (a)면 DM 11.5 백엔드 후속 ★에 "공급자 변경 시 결과 행 재개방" 추가.
- 나머지(R-64·R-65·R-66, R-61·R-62)는 문장 수정으로 닫힌다. 거부 코드(확인 2)와 컬럼 갱신(확인 3 앞 두 항목)은 네 문서가 맞다.
