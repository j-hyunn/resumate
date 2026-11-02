# Resumate 기획 정합성 리뷰 — 커리어 화면 재설계 (라운드 1)

작성: spec-reviewer / 2026-11-02
기준(정답): `_workspace/00_input/planning-decisions-career-redesign.md`(CR-1~CR-14, 확정 2026-11-02 (사용자)), 확정 이름 `_workspace/career-redesign/dm_replies.md`

## 요약
- 검토 문서: `docs/planning/01-prd.md` v4.5, `02-user-flows.md` v5.5, `03-ai-features.md` v4.5, `04-data-model.md` v4.4 (`decisions.md`는 리더 갱신 예정 — 아래 "대체 표기 목록"만)
- 이슈: **Critical 0 / Major 3 / Minor 9**, 해결 0 / 미해결 12 (라운드 1)
- 담당별: ux-planner 6 (Major 2, Minor 4) / product-planner 3 (Major 1, Minor 2) / ai-feature-designer 2 (Minor 2) / data-architect 1 (Minor 1)
- 총평: 네 문서 모두 CR-1~CR-14의 큰 줄기(STAR 1개를 `projects` 컬럼으로, `project_details`·`achievements`·S-11·S-35·S-36 폐기, 독립 프로젝트 + `project_deliverables`(`DLV-n`), 분류 3종 값·개수, 소속 프로젝트에서 `role`·스킬 제거, `writing_chats` 소속 프로젝트 전용 `active`/`closed` + `apply_writing_chat_proposal`, 완료 기준, D-01, 메뉴 이름, 연도 묶음, 삭제 연쇄 (a) 잠정, 기간 표기 D-DM-11 (a), 근거 `source_type`, 숫자 가드 V-5/V-9c)를 같은 이름·같은 규칙으로 반영했다. 폐기 용어(S-11/S-35/S-36, `project_details`, `achievements`, `DET-n`/`ACH-n`/`ART-n`, `project_artifact`, `new_project`, 대화 `abandoned`, 90일, 기타 프로젝트, "기업 JD 관리" 메뉴명, 상세 내용)는 변경 이력·폐기 주석·이름 대조표 밖에서 살아 있는 개념으로 쓰인 곳이 없다(아래 R-CR-7의 S-36 규칙 참조 2건 제외). 남은 문제는 **readiness `project_fields`의 이동 대상(UX만 옛 의미)**, **빠른 버튼 칩 세트 불일치**, **F-P1-05 Must인데 스킬 목록 화면 없음** 세 가지와, 확정 뒤에도 남은 "데이터 모델 결정 대기" 주석들이다.

## 경계별 결과

| 경계 | 결과 | 이슈 ID |
|------|------|---------|
| B1 PRD Must → 화면 | F-P1-17·18·19 매핑 있음. F-P1-05 "전체 스킬 목록·직접 추가"는 화면 없음 | R-CR-3 |
| B2 화면 필드 → 데이터 | `projects.*` 신규 컬럼, `project_deliverables`, `writing_chats.title/status/last_applied_at`, `structured_draft.star.{field}`, `cascade.project_deliverables`, `entity_type = project_deliverable` 모두 일치. 반영 RPC 결과·오류 값의 화면 처리 누락 | R-CR-4 |
| B3 AI 입력 → 데이터 | C-1 팩 필드(STAR 5, 분류 3종, 독립 `role`·`description`, 산출물 `title`·`body`, `link_url` 제외)가 DM과 일치 | — |
| B4 AI 출력 → 저장 | `structured_draft` v3(`schema_version: 3`), `evidence_links.source_type/source_field/source_locator/source_snapshot_at` 일치. `ai_suggestions` 대상 표기만 다름 | R-CR-9 |
| B5 AI 출력 → 화면 | 칩 세트 불일치, readiness `project_fields`/`form + suggested_project_id` 처리 불일치, "변경됨" 기준 | R-CR-1, R-CR-2, R-CR-5 |
| B6 응답 모드 | AI-12 SSE 턴 / 반영은 동기 RPC — PRD·UX·AI·DM 일치 | — |
| B7 기능 → 데이터 | DM 6.1에 F-P1-03·05·06·09·13·15·17·18·19, F-AP-06, F-COM-04 모두 있음 | — |
| B8 용어 | 용어집(독립 프로젝트, 산출물, STAR 항목명, Resumate AI 패널, 대화 기록, 자기소개서 관리) 일관. 폐기 용어 잔존 없음 | R-CR-7(잔존 참조) |
| B9 MVP 범위 | S-12 `[보류]` ↔ F-P1-05 Must | R-CR-3 |
| B10 개인정보·삭제 | `project_deliverables` RLS·삭제 트리거·탈퇴 집계, 대화 cascade, 90일 정리 폐기, D-UX-22 (a) 잠정 — 4문서 일치 | — (결정 필요 D-UX-22) |
| B11 비용 | BYOK라 운영자 상한 없음. AI 0.2(대화 $0.07/상한 $0.17)·7.2·7.3 수치와 산출물 상한 영향(+12k) 서로 맞음 | — |

## 이슈 표

| ID | 심각도 | 문서·위치 | 문제 | 담당 | 수정 제안 |
|----|--------|-----------|------|------|-----------|
| R-CR-1 | **Major** | UX C-09(제목·`hints`·"이름이 빠졌을 때" 행), FL-13 그림(`D4[S-10 머리 수정 · 이름 칸 포커스]`)과 아래 `project_fields` 문단, 5.1c A18 행, 5.1d A18 행 ↔ DM 6장 판정 순서 ②·③, AI C-1 게이트 표 | UX는 `next_action = 'form'` + `suggested_project_id` + `project_fields`를 "이름이 빈 소속 프로젝트 → S-10 머리 수정(이름 칸)"으로 처리한다. DM v4.4는 (1) `projects.name`을 not null로 바꿔 그런 행이 없고, (2) `project_fields` = **프로젝트 내용(`description`)이 빈 `draft` 독립 프로젝트 → S-43 "프로젝트 내용" 섹션 편집**, (3) AI를 못 쓸 때 STAR 미완 소속 프로젝트에도 `form` + `suggested_project_id` + `hints: project_star`를 준다(→ S-10 STAR 섹션 편집). UX 규칙대로 구현하면 ③의 독립 프로젝트를 S-10으로 보내(S-10은 독립 ID를 S-43으로 튕김) 이름 칸을 열고, ②의 키 없는 사용자도 이름 칸으로 보낸다. AI C-1은 DM과 같다. | ux-planner | C-09·FL-13의 `form + suggested_project_id` 분기를 `hints`로 나눈다: `project_star` → S-10 빈 STAR 섹션(상황·행동) 편집 / `project_fields` → S-08 `?item=project:{id}`(S-43) "프로젝트 내용" 섹션 편집. 보조 안내 문구를 "'{프로젝트명}'의 프로젝트 내용이 비어 있어요"로, 제목은 Q53-8 1칸 문구 유지. "이름 칸 포커스"·"이름 없는 프로젝트" 문구 삭제. 5.1c·5.1d의 A18 행을 "독립 프로젝트 내용 → S-43"으로 고침 |
| R-CR-2 | **Major** | UX S-10 Resumate AI 패널 "빠른 버튼 칩" 행 ↔ AI AI-12 "빠른 버튼 칩 3개" 표 | AI-12는 서버가 상태별 칩 3개를 `turn_done`으로 내려 준다고 정하고 칩마다 `requested_slot`을 정했다(필수 빔: "비어 있는 항목부터 물어봐 줘"/"결과/성과도 정리하고 싶어요"/"배운 점도 정리하고 싶어요" 등). UX 예시는 다른 칩 세트이고 그중 "잘 모르겠어요, 예시 보여 줘", "면접에서 물어볼 만한 점 짚어 줘"는 STAR 슬롯에 대응하지 않아 `requested_slot`을 붙일 수 없고, 예시 제시는 AI-12 "질문에 구체적 사실을 넣지 않는다" 규칙과도 부딪힌다. 칩을 서버가 주므로 화면 예시를 따로 두면 UI/백엔드가 서로 다른 문구·슬롯을 구현한다. | ux-planner | S-10 칩 행의 예시를 AI-12 표로 바꾸거나 "칩 문구·슬롯은 AI-12 표, 화면은 받은 3개를 그대로 보인다"로 줄인다. 문구를 바꾸고 싶으면 AI-12 표를 바꾸도록 ai-feature-designer에 요청(슬롯 없는 칩은 두지 않음). 36개 이상 숨김 규칙은 UX에 유지 |
| R-CR-3 | **Major** | PRD F-P1-05(Must, "독립 프로젝트의 사용 기술을 태그로 달고 **전체 스킬 목록을 본다**", 수용 기준 "자동 집계 + 직접 추가"), PRD 5.1 Must 목록 ↔ UX S-12 `[보류]`, 4.1 매트릭스 "전체 스킬 목록은 화면이 없다" ↔ DM 2.3 skills("직접 추가 `is_manual` 유지, 화면 진입점 S-12 보류") | Must 기능의 수용 기준 일부(전체 스킬 목록 보기, 직접 추가)가 MVP 화면 없이 남았다. PRD는 위치만 UX에 위임했지 범위를 줄이지 않았고, UX는 화면 자체를 보류했다. 구현 범위가 모호해진다(직접 추가 스킬은 AI 팩 `SKL-n`에도 들어간다 — 입력 경로가 없다). | product-planner | 범위 기준 문서인 PRD가 정한다: (권고) F-P1-05 수용 기준을 "독립 프로젝트 사용 기술 태그(자동완성)"로 줄이고 "전체 스킬 목록·직접 추가"는 Should/`[보류]`로 내림 + AI C-1 스킬 블록에서 직접 추가 스킬 문구 정리 요청. 또는 MVP에 S-12를 되살리도록 UX에 요청. 사용자 확인 Q-UX-4로 올림 |
| R-CR-4 | Minor | UX S-10 반영 규칙·C-15·C-05·S-43·S-44 ↔ DM 3.3(`apply_writing_chat_proposal` 반환·오류), 2.5(`writing_chat_closed`, `field_already_applied`), 2.3(`deliverable_limit_reached` 50개, `project_scope_change_not_allowed`) | DM이 정한 결과·오류 값의 화면 처리가 없다: 반영 결과 `skipped[].reason`(`needs_review`·`already_applied`·`empty`·`period_already_set`) 안내, **`field_too_long`(409, 합친 값 2,000자 초과 시 전체 거부)** 문구, 닫힌 대화 전송 `writing_chat_closed`, 반영된 필드 수정 `field_already_applied`, 산출물 50개 `deliverable_limit_reached`, 소속 변경 시 독립 선택 거부. dm_replies가 UX에 요청한 항목이다. | ux-planner | S-10 반영 규칙에 skipped·`field_too_long` 처리(예: "합치면 2,000자를 넘어 반영하지 못했어요. 섹션을 줄인 뒤 다시 반영해 주세요"), C-15에 반영된 필드 수정 → "왼쪽 섹션에서 고쳐 주세요", S-43 "+ 산출물 추가" 상한 상태, S-10 머리 소속 선택에서 독립 항목 비노출 명시 |
| R-CR-5 | Minor | UX C-01 "상태" 행("변경됨 = 원본 `updated_at` > `source_snapshot_at`") ↔ DM 2.8 `source_snapshot_at`(project = `projects.content_updated_at`), AI C-3 | 프로젝트 근거의 "변경됨"을 `projects.updated_at`로 비교하면 분류·Link만 바꿔도 칩이 "변경됨"이 된다. DM·AI는 `content_updated_at` 기준으로 그걸 막았다. | ux-planner | C-01 상태 행에 "`project`는 `projects.content_updated_at`, `project_deliverable`은 산출물 `updated_at`과 비교"를 적거나 "판정은 서버 값"으로 바꿈 |
| R-CR-6 | Minor | UX 머리말(기준 입력 PRD v4.3·DM v4.2·AI v4.3, "이름 미정 새 필드는 `[가정]`"), C-01 비고("종류 값·별칭은 결정 `[가정]`", "`project_detail`을 `project`로 합칠지는 데이터 모델 결정"), C-09 부족 항목("독립 프로젝트를 셀지는 데이터 모델 결정 `[가정]`"), C-09 머리("`hints` 이름 정리는 요청 `[가정]`"), C-11("`project_detail_ids` 데이터 모델 확인 요청", "산출물 지정 여부 `[가정]`"), S-10 STAR 상황 행("1:1 `project_details` 가능"), S-43("Link 이름 확인 요청", "`summary` 관계는 데이터 모델"), 5.1d T-16 행·5.2("재정의 대기", "데이터 모델 개정 대기") | DM v4.4·dm_replies가 이미 확정한 사항(STAR = `projects` 컬럼, `project_deliverable`/`DLV-n`, 독립 프로젝트 D-01 포함, `project_detail_ids` 삭제, 산출물은 근거 선택 단위 아님·선택된 독립 프로젝트의 산출물 자동 포함, `link_url`, `summary` 삭제, 완료 기준)이 "결정 대기"로 남아 구현자가 열린 질문으로 읽는다. | ux-planner | dm_replies "ux-planner" 절의 `[가정]` 해제 목록대로 정리하고 기준 입력 버전을 PRD v4.5·DM v4.4·AI v4.5로 갱신 |
| R-CR-7 | Minor | UX S-10 "+ 새 대화" 비고("무료 등급 문장은 v5.3 S-36 시작 인사 규칙 그대로"), 입력창 비고("상한 규칙은 v5.3 S-36과 같음"), 1.2 화면 목록 "S-26, S-27, S-32 (예약) 커리어 채팅 / **완성도** / …" | 폐기된 S-36의 규칙을 참조만 해서 현재 문서에 규칙 본문이 없다(구현자가 v5.3을 찾아야 함). S-27 "완성도" 예약 자리는 폐기된 F-P1-07(CR-11)용이다. | ux-planner | 시작 인사 무료 등급 문장 규칙과 상한(사용자 메시지 `message_count ≤ 38`)을 S-10에 직접 적고 S-36 참조 삭제. S-27 예약을 폐기 표시(ID 재사용 금지) |
| R-CR-8 | Minor | PRD F-P1-13 (8), F-P1-08 비고, F-P1-06, 9.3 A18 행 | (1) F-P1-13 (8) 칩 예시 "지금까지 내용 STAR에 정리하기"는 AI-12 "반영은 칩이 아니다(버튼)"와 맞지 않고, 칩은 서버가 상태별로 준다(AI-12). (2) F-P1-08 "진입은 AI 패널 안 `[가정]`" ↔ UX 1.4·AI-08 "STAR 섹션 편집 안". (3) F-P1-06 "F-P1-13 (6)" 참조 → 다시 열어 이어 하기는 (7). (4) 9.3 A18 "완료 조건이 빠진 프로젝트는 그 프로젝트 상세로"가 DM v4.4 의미(내용 빈 독립 프로젝트 → S-43)와 다름. | product-planner | (1) "칩 3개는 프로젝트 상태에 따라 AI 명세 AI-12 표" 로 바꾸고 예시 삭제 (2) "STAR 섹션 편집 안"으로 맞춤 (3) (7)로 (4) A18 행을 "`project_fields` = 프로젝트 내용이 빈 독립 프로젝트 → 그 독립 프로젝트 상세(S-43)"로 |
| R-CR-9 | Minor | AI 머리말("테이블·필드명은 DM **v4.2** 기준", 기준 입력 PRD v4.3·UX v5.3), C-1 소속 프로젝트 행("`team_size`·`summary`가 데이터 모델에 남더라도"), C-3 폐기 주석("기존 `evidence_links` 이관은 data-architect가 정한다(요청)"), AI-12 저장("폐기 요청: `mode`…"), AI-04 저장("`project_detail_ids` (v4.5 폐기 요청)"), AI-08 저장("`source_type = project` + STAR `source_field` … 값 정리 필요(data-architect)") | DM v4.4에서 이미 확정·삭제된 것이 "요청"·"남더라도"로 남았다. AI-08은 DM 회신 이름 `ai_suggestions.target_type = 'project'` + `target_field`와 표기가 다르다(Should). | ai-feature-designer | 기준 버전을 DM v4.4·PRD v4.5·UX v5.5로, "요청" 문구를 "DM v4.4 확정(11.2 이관 규칙)"으로, AI-08 저장을 `target_type = 'project'`, `target_field` ∈ STAR 5필드로 고침 |
| R-CR-10 | Minor | AI C-1 `career_snapshot_hash`, C-14 AI-12 행, C-1 게이트 표 ↔ dm_replies "ai-feature-designer" 절 | DM이 확인을 요청한 세 가지가 명시되지 않았다: (a) 해시에 분류 3종이 들어가 분류만 바꿔도 F-P2-07 "데이터 변경됨"이 뜬다(근거 칩은 안 뜸) — 의도 여부 미기재. (b) 반영 시 합친 값 2,000자 초과면 **전체 거부**(DM 3.3) — 정리 프롬프트·V-9h가 `append` 길이를 의식하는지 미기재(C-14는 "반영 후 합친 값 기준"이라고만 함). (c) 게이트 표에 DM 판정 ②의 "AI 불가 → `form` + `suggested_project_id` + `project_star`"(S-10 STAR 섹션 편집) 경로가 없다. | ai-feature-designer | (a) "분류는 AI-04·AI-05 선택에 영향 → 의도적으로 포함" 한 줄(아니면 해시에서 제외) (b) 정리 단계에서 현재 값 + 제안이 2,000자를 넘을 append는 내지 않도록(또는 `needs_review`) 규칙 추가 (c) 게이트 표 ③에 ② `form` 분기 추가 |
| R-CR-11 | Minor | DM 2.3 "기간 표시"("PRD의 '진행 중이면 이번 달까지'는 프로젝트에 적용할 수 없다"), 8장 D-DM-11 행("product-planner가 PRD 문구를 맞추거나…"), 8장 "사용자 결정 일괄 (2026-11-05)" 행(A6·A15·A18을 대체 표기 없이 확정으로 나열), 8.1 T-18·T-19 행(`save_writing_chat`·`set_writing_chat_affiliation`·`writing_chats.experience_id` 언급), 머리말 1행(기준 입력 PRD v4.3·UX v5.3·AI v4.3) | PRD v4.5 F-P1-03 (3)은 이미 D-DM-11 (a)로 맞췄는데 DM은 아직 PRD가 다르다고 적었다. 8장·8.1에 v4.4로 폐기·변경된 결정이 그대로 "확정"으로 남았다. | data-architect | 2.3 문장 삭제, D-DM-11을 "(a) `[가정]` — PRD v4.5 반영됨, 사용자 확인 대기"로, 8장 A6·A15 "v4.4 대상 없음", A18 "v4.4 의미 변경(독립 프로젝트 내용)", 8.1 T-18 "반영 시 `needs_review` 건너뜀", T-19 "v4.4 폐기"로 표기. 머리말 1행 버전 갱신 |
| R-CR-12 | Minor | PRD F-P1-18 (3)("개수 제한 없음 `[가정]`") ↔ DM 2.3 `project_deliverables`("프로젝트당 50개 `[가정]`", `deliverable_limit_reached`) | 같은 값을 PRD는 "제한 없음", DM은 50개 상한으로 적었다(PRD 단서 "남용 방지 상한은 구현 시"와 겹치지만 사용자에게 보이는 거부가 생긴다). | product-planner | F-P1-18 (3)을 "사용자 한도는 두지 않되 남용 방지 상한 프로젝트당 50개 `[가정]`(DM), 닿으면 안내"로 맞춤(화면 안내는 R-CR-4) |

### 확인 결과 (문제 없음, 근거 요약)
- **계층·STAR 1개**: PRD P1 계층·F-P1-15 / UX S-10 / AI C-1·AI-12 / DM DM-14·DM-19, `projects.situation·task·action·result·learnings` ≤ 2,000자 — 일치.
- **분류 3종**: 값 9/7/10개, 키(`new_build`…, `impact`…, `problem_solving`…), 종류·경험 유형 단일, 역량 ≤ 3·중복 없음·순서 저장, 소속 전용, 근거 아님 — PRD F-P1-19 / UX S-10 / AI C-1.2·V-2 / DM 2.3·2.8 일치.
- **완료 기준·D-01**: 소속 = 이름 + 상황 + 행동, 독립 = 이름 + `description`(산출물 조건 아님), D-01에 독립 포함, 교육만은 미달 — 4문서 일치.
- **대화**: 소속 프로젝트 전용(트리거), 프로젝트당 여러 개, `active`/`closed`, 40 상한(인사 제외), 반영 = 사용자 RPC·키 불필요·덧붙임·`needs_review` 건너뜀 — 일치.
- **readiness 이름**: `project_star`, `projects_without_complete_star`, `standalone_projects_without_description`, `create_project` — UX·AI·DM 일치(이동 대상만 R-CR-1).
- **삭제**: `affiliation_mode = delete_projects`만, `cascade.project_deliverables`, `entity_type = project_deliverable`, 대화 삭제 반환 `{message_count, last_applied_at}` — 일치.
- **기간·연도**: 양 끝 달 포함, 종료월 없으면 "YYYY.MM -"·개월 수 없음, 시작 연도에 한 번, 같은 해 시작월 → 생성순, "연도 미정" — 일치.
- **메뉴**: "자기소개서 관리"(L-01·3.1·F-COM-10·용어집), 화면 안 "기업 JD" 유지 `[가정]` — 일치.
- **숫자 가드**: V-5 원천 = 서술 필드(소속 S·T·A·R, 경력 `summary`, 교육 `description`, 독립 `role`·`description`, 팩 안 산출물), `learnings` 제외, V-9c 서술 값 전체 — PRD NFR-AI-02 / AI / DM 3.2 일치.

## 사용자 결정이 필요한 항목 (중복 제거)

| # | 항목 | 선택지 | 권고 | 출처 |
|---|------|--------|------|------|
| 1 | **D-UX-22** 경력·교육 삭제 시 소속 프로젝트 | (a) 함께 삭제 (b) 독립으로 남김 (c) STAR를 프로젝트 내용으로 옮겨 독립으로 남김 | (a) — DM CHECK·cascade가 (a)만 받음. (b)는 구조상 불가에 가깝다 | PRD 9.0, UX 5.1d(Q-UX-1), DM 8장 |
| 2 | **Q-UX-4 / F-P1-05 범위** 전체 스킬 목록·직접 추가 | (a) Must에서 빼고 Should/보류(독립 프로젝트 사용 기술 태그만 MVP) (b) S-12를 MVP 화면으로 둠 | (a) | R-CR-3, UX S-12, PRD F-P1-05 |
| 3 | **Q-CR-1** 분류 값 목록·선택 방식 | PRD F-P1-19 목록, 종류·경험 유형 단일, 역량 최대 3 | 그대로(바뀌면 CHECK만 수정) | PRD 9.0, DM 2.3 |
| 4 | **Q-CR-2** 소속 프로젝트에 기술 정보 없음의 영향 | 그대로 두고 평가 세트로 확인 / 경력 단위 기술 태그 재검토 | 그대로 | PRD 9.0 |
| 5 | **Q-CR-3 = D-AI-15** 독립 프로젝트 완료 기준(이름 + 내용)·AI 작성 대화 없음·분류 없음 | (a) MVP에 대화 없음 (b) 내용 채우기 대화 (c) 산출물 초안 대화 | (a) | PRD 9.0, AI 8장 |
| 6 | **D-AI-14** AI 작성 대화가 분류 3종을 채우는가 | (a) 채우지 않음 (b) 추천 후 확인 (c) 사용자가 말한 경우만 | (a) — UX·DM이 이미 (a) 전제 | AI 8장 (PRD 9.0에 없음 — 목록에 추가 권고) |
| 7 | **Q-CR-4** "작성 중" 배지 삭제의 영향 | UX 안: 상황·행동(독립은 내용)이 빌 때만 STAR 영역 위 도움말 한 줄 | UX 안 채택 | PRD 9.0, UX S-10 |
| 8 | **D-DM-11** 프로젝트 "진행 중" 표시 | (a) 컬럼 없음, 종료월 없으면 "YYYY.MM -" (b) `projects.is_current` 추가 | (a) — PRD·UX·DM 반영됨, 확인만 | DM 8장, PRD F-P1-03 (3) |
| 9 | **Q-UX-2 (D-UX-20)** 메뉴명 변경 뒤 화면 안 "기업 JD" 표기 | (a) 유지 (b) 함께 변경 | (a) | UX 5.1d, PRD 용어집 |
| 10 | **Q-UX-3** L-01 하단 AI 연결 상태 한 줄(피그마에 없음) | 유지 / 삭제 | 유지 `[가정]` | UX 1.3 |

(재설계와 무관한 기존 열린 결정 D-14 점수 산식, D-39 법무, 출시 전 D-10 고지 문구·KMS 공급사는 변동 없음. DM 11.2 기존 개발 데이터 비우기 vs 이관은 백엔드 판단 항목이라 사용자 결정에서 뺐다.)

## `decisions.md`에서 대체·폐기 표기가 필요한 항목

| 위치 | 항목 | 표기 |
|------|------|------|
| 2장 가정 | "프로젝트에 연결되지 않은 AI 대화 — 90일 자동 삭제" | **폐기**(CR-6, D-DM-08 폐기) — 행 삭제 또는 취소선 |
| 3.1 | U-2 "회고 및 배운 점" | **대체**: 화면 이름 "배운 점"(CR-2). 회고로 다루는 원칙(NFR-AI-06)은 유지 |
| 3.1 | U-4 메뉴 "기업 JD 관리" | **대체**: "자기소개서 관리"(CR-12) |
| 3.1 | U-5 데이터 부족 → AI 대화 → 복귀 | **문구 갱신**: 대화는 프로젝트 상세의 Resumate AI 패널, 채울 프로젝트 없으면 이름만으로 프로젝트 먼저 생성(CR-5·CR-6), "경력 폼" → 섹션 수정 |
| 3.1 | U-9 대화 보관 | **일부 대체**: 유지. 묶이지 않은 대화 개념 없음(CR-6) |
| 3.2 | "커리어 계층은 연도 > 경력/교육 > 프로젝트 > 상세 내용. 상세 내용은 STAR + 회고 및 배운 점" | **대체**: 연도 > 경력·교육·독립 프로젝트(시작 연도에 한 번), 경력·교육 > 프로젝트(STAR 1개), 독립 > 산출물(CR-1·2·4·7·8) |
| 3.2 | "커리어 입력은 폼 + AI 채팅 작성" | **문구 갱신**: 섹션 수정 + 프로젝트 상세 AI 패널(CR-3·CR-5) |
| 3.3 | T-1 메뉴 "기업 JD 관리" | **대체**(CR-12) |
| 3.3 | T-2 연도 보기 | **대체**(CR-4) |
| 3.3 | T-3 프로젝트당 상세 내용 여러 개 | **폐기**(CR-2, D-23) |
| 3.3 | T-4 결과 = 서술 + 정량 성과 | **폐기**(CR-11, D-24) |
| 3.3 | T-6 폼으로 전환 시 draft 저장 | **폐기**(CR-5·CR-6, D-UX-11 대체) |
| 3.3 | T-11 "회고 및 배운 점" 사용 규칙 | **문구 갱신**: "배운 점"(규칙 유지) |
| 3.3 | T-16 D-01 완료 프로젝트 = 완료 상세 내용 ≥ 1 | **대체**: 소속 = 이름 + 상황 + 행동, 독립 = 이름 + 내용, 독립도 셈(CR-2·7·10) |
| 3.3 | T-18 검토 필요 필드는 저장·폼 전환 때 안 옮김 | **문구 갱신**: 반영(`apply_writing_chat_proposal`) 때 건너뜀 |
| 3.3 | T-19 확정 소속 = `writing_chats.experience_id`/`education_id` | **폐기**(소속은 프로젝트에, 컬럼·RPC 삭제) |
| 3.6 | A5 위치 "UX S-36" | **문구 갱신**: S-10 Resumate AI 패널(결정 유지) |
| 3.6 | A6 그만둔 대화 재개(`abandoned → active`), 90일 정리 | **폐기**(CR-5·CR-6) |
| 3.6 | A11 직무 질문 사실 전제 = 상세 내용의 행동·결과와 성과 | **문구 갱신**: 소속 STAR 행동·결과/성과 + 독립 프로젝트 내용·산출물(CR-8·CR-11) |
| 3.6 | A14 위치 "UX S-36" | **문구 갱신**: S-10 패널 |
| 3.6 | A15 거절한 소속 제안 미저장 | **대상 없음으로 폐기**(소속 제안 없음) |
| 3.6 | A18 이름·역할 빠진 프로젝트 → S-10 | **의미 변경**: `project_fields` = 내용 빈 독립 프로젝트 → S-43 "프로젝트 내용"(DM v4.4 6장) |
| 3.8 | Q53-8 `project_fields` C-09 제목 | **유지, 대상 변경 주석**(독립 프로젝트 내용 1칸) |
| 4.1 | ★ A6 재개 전이·재개 경로 | **백엔드 후속 취소** → 대신 DM 11장 커리어 재설계 후속(`writing_chats` 개정, 90일 크론 삭제) |
| 4.1 | ★ A18 hint `project_fields` | **백엔드 후속 내용 변경**(독립 프로젝트 판정 ③) |
| 4.2 | "시작 인사 무료 등급 문구 … UX S-36" | **문구 갱신**: S-10 패널 |
| (새로 추가) | CR-1~CR-14 (확정 2026-11-02 (사용자)), D-22 개정, D-23·D-24·D-27의 90일·D-DM-08 폐기, D-21·U-2 문구 대체, D-20 메뉴 라벨 대체 | 3.x 새 절로 기록 (PRD 9.4 표 참고) |

## 다음 단계
- 각 담당자에게 위 이슈 ID·근거·제안을 전달한다. 수정 완료 알림을 받으면 해당 이슈만 다시 확인한다(최대 2라운드).
- 리더: 사용자 결정 1~10을 묶어 질문, `decisions.md` 갱신 시 위 표 사용.

## 라운드 2

재확인 범위: 담당자가 수정 완료를 알린 R-CR-1~12와 그 주변 회귀만 (`decisions.md`·README 제외). 결과: **해결 11 / 부분 1 / 미해결 0**, 새 이슈 Minor 1.

| ID | 상태 | 확인 근거 |
|----|------|-----------|
| R-CR-1 | 해결 | UX C-09 `form + suggested_project_id` 행이 `hints`로 분기(`project_star` → S-10 빈 STAR 섹션, `project_fields` → S-43 "프로젝트 내용"), 보조 안내 "'{프로젝트명}'의 프로젝트 내용이 비어 있어요", FL-13 D4/D5 노드·본문, 5.1c·5.1d A18 행 모두 DM 6장과 일치. "이름 칸 포커스" 문구 없음 |
| R-CR-2 | 해결 | S-10 칩 행이 "문구·`requested_slot`·노출 상태는 AI-12 표가 원천, 화면은 받은 3개를 그대로" — 슬롯 없는 칩 예시 삭제 |
| R-CR-3 | 해결 (사용자 결정 대기) | PRD F-P1-05를 "독립 프로젝트 사용 기술 태그"로 줄이고 전체 목록·직접 추가는 9.0 Q-UX-4 `[결정 필요]`로. UX S-12 `[보류]`와 맞음. AI C-1·C-3의 "직접 추가 스킬" 문구는 결정 결과에 따라 정리 |
| R-CR-4 | 해결 | S-10 반영 결과 안내(`skipped` 4사유), `field_too_long`(409, 전체 미반영 안내), `field_already_applied`, `writing_chat_closed`, S-43 산출물 50개 상한, S-10 머리 소속 목록에 "소속 없음" 미노출 + `project_scope_change_not_allowed` |
| R-CR-5 | 해결 | C-01 상태 행: `project` = `content_updated_at`, `project_deliverable` = 산출물 `updated_at`, 판정은 서버 값 |
| R-CR-6 | 해결 | 머리말에 v5.5 기준(PRD v4.5·DM v4.4·AI v4.5) 추가, 새 필드 "확정됨" 표기. C-01·C-09·C-11·S-10·S-43·5.1d·5.2의 "데이터 모델 결정 대기" 주석 정리 확인 |
| R-CR-7 | 해결 | S-10 "+ 새 대화"·입력창 비고에서 S-36 규칙 참조 삭제, S-27 "완성도" 폐기 행(ID 재사용 금지) |
| R-CR-8 | 해결 | F-P1-13 (8) "칩은 서버가 AI-12 표대로, 반영은 칩이 아님", F-P1-08 "STAR 섹션 편집 안", F-P1-06 → (7), 9.3 A18 → 독립 프로젝트 내용 → S-43 |
| R-CR-9 | **부분** | 머리말 DM v4.4 기준, C-1 "남더라도" 삭제, C-3 이관 = DM 11.2, AI-08 `target_type`/`target_field` 반영. **남은 문구 2곳**: AI-12 대상·시작점 "(`writing_chats.mode` 폐기 요청)", AI-12 반영 절 "저장·폼 전환·소속 확정은 **폐기를 요청한다**" → "DM v4.4에서 폐기"로. 구현 영향은 없음 |
| R-CR-10 | 해결 | (a) 해시에 분류 포함은 의도라고 명시(F-P2-07은 뜨고 근거 칩은 안 뜸) (b) C-14 AI-12: 합친 값 2,000자 초과가 될 `append` 처리 규칙 추가 (c) 게이트 표 ①에 AI 불가 시 `form + project_star` → S-10 STAR 섹션 |
| R-CR-11 | 해결 | 2.3 "적용할 수 없다" 문장 삭제, D-DM-11 "(a) `[가정]` — PRD v4.5 반영됨, 사용자 확인 대기", 8장 A6·A15 "v4.4 대상 없음", A18 "의미 변경", 8.1 T-18·T-19 개정·폐기, 머리말 버전 갱신 |
| R-CR-12 | 해결 | PRD F-P1-18 (3) "사용자 한도 없음, 남용 방지 상한 프로젝트당 50개 `[가정]`, 닿으면 안내" — DM·UX S-43과 일치 |

### 새 이슈

| ID | 심각도 | 문서·위치 | 문제 | 담당 | 수정 제안 |
|----|--------|-----------|------|------|-----------|
| R-CR-13 | Minor | UX FL-13 그림 | `form + suggested_project_id · hint project_star`(D4) 노드가 "키 있음 · 주 버튼: AI와 대화하며 채우기" 분기 아래에 있다. DM 판정 ②에서 이 조합은 **AI를 쓸 수 없을 때만** 온다(C-09 표는 맞게 적었음). 그림만 보고 구현하면 키 있는 경로에서 이 분기를 찾게 된다 | ux-planner | D4를 "키 없음·무효" 분기(FM 쪽)로 옮기거나 노드 이름에 "AI 불가 시"를 붙임. D5(`project_fields`)는 키 유무와 무관하므로 K 밖 공통 분기로 두는 편이 정확 |

### 라운드 2 종료 상태
- 남은 항목: R-CR-9(문구 2곳), R-CR-13 — 모두 Minor, 구현을 막지 않는다. 최대 라운드(2)에 닿았으므로 미반영 시 리더에게 "미해결(경미)"로 넘긴다.
- 사용자 결정 목록은 라운드 1과 같다. PRD 9.0에 D-AI-14·Q-UX-4가 추가되고 Q-CR-3 = D-AI-15로 합쳐져 중복이 없어졌다.

## 리더 처리 (라운드 2 뒤)
- R-CR-9 잔여 2곳(AI-12 "폐기 요청" 문구) → "DM v4.4 확정"으로 리더가 직접 수정. 해결.
- R-CR-13 FL-13 `form` + `project_star` 분기를 "키 있음" 아래에서 "AI 쓸 수 없음" 분기로 리더가 옮김. 해결.

## 라운드 3 (후속 결정)

범위: 후속 결정 CR-15~CR-24와 리더 규칙(CR-20 빈 값만 추천·`classification_suggestions`·`structured_draft.classification.*`·V-9i·`classification_already_set`, D-UX-23 "자소서 문항 답변", 화면 "기업 JD" → "자기소개서")만 네 문서에서 교차 확인. 결과: **Major 1 / Minor 3**, 직접 고친 문구 2건.

### 확인 결과 (문제 없음)
- **`is_current` (CR-22)**: PRD F-P1-03 (3)·F-P1-17 (1), UX C-25·S-10·S-43, DM 2.3(`CHECK (NOT is_current OR end_month IS NULL)`, 소속·독립 공통, 표시 규칙 표, 이번 달(KST)까지 셈), AI C-1(팩 기간 문자열 "YYYY.MM - 현재 (N년 N개월)", 종료 미입력 표기), V-5 허용값(진행 중 개월 수), 연도 묶음은 `start_month`만 씀 — 일치. `content_updated_at`·근거 `period`에 포함(DM)도 AI와 충돌 없음.
- **삭제 연쇄 (CR-15)**: PRD F-COM-04, UX C-05 "프로젝트 N개와 그 STAR·AI 대화 N개가 함께 삭제돼요", DM 4.2 `delete_projects`만 + 8장 확정 — 일치, `[결정 필요]` 없음.
- **스킬 보류 (CR-16·CR-18)**: PRD F-P1-05 범위 축소 확정, UX S-12 `[보류]`·매트릭스, DM `project_skills` 독립 전용·`is_manual` 진입점 없음 — 일치.
- **분류 값 (CR-17)**: 9/7/10, 단일/단일/최대 3, 선택 입력 — PRD·UX·AI·DM 모두 확정 표기.
- **CR-15~CR-24의 `[결정 필요]`**: 네 문서 어디에도 남지 않음(남은 `[결정 필요]`는 D-14·D-39·D-10 문구·KMS뿐). D-UX-23만 `[가정]`(의도대로).
- **화면 문구 "기업 JD" / "자기소개서 초안"**: UX는 사이트맵·화면 목록·S-13/S-14/S-18·C-16·C-14·S-37·S-39·빈 상태·이동 경로 문구까지 "자기소개서" / "자소서 문항 답변"으로 바뀜. 남은 "기업 JD"는 변경 이력·대체된 결정 행(D-UX-10, CR-12 설명) 안뿐. PRD·AI·DM의 남은 것도 변경 이력·구 이름 주석·마이그레이션 대조 행뿐.

### 직접 고친 문구 (순수 라벨 변경만)
| 문서·위치 | 변경 |
|-----------|------|
| DM 2.7.1 `evaluation_failed` 행 | "원인 + 이 기업 JD로 새 면접(Q53-3)" → "원인 + \"이 자기소개서로 새 면접 시작\"(Q53-3, CR-23)" (UX S-22 버튼 문구와 맞춤) |
| PRD 3.2 J-4 | "경력기술서 또는 자소서 초안을" → "경력기술서 또는 자소서 문항 답변을" |

### 이슈

| ID | 심각도 | 문서·위치 | 문제 | 담당 | 수정 제안 |
|----|--------|-----------|------|------|-----------|
| R-CR-14 | **Major** | AI AI-12 "분류 추천"·패치 매핑 표(`classification_suggestions.{key}` → 필드 객체), V-9i ④, 반영 절 ↔ DM 2.5 "분류 추천" 필드 객체·3.3 반환 `reason`, UX S-10 "분류 추천" | 저장 필드 객체가 다르다. AI: `origin = 'ai_recommendation'`, **`basis_message_ids`**, **`reason`**, `applied_at`(V-9i ④ basis 1개 이상 필수). DM: `origin` ∈ `ai`/`user_edit`, **`source_message_ids`(선택, 비어도 됨)**, `review = ok`, `reviewed_at`, `applied_at`, `reason` 없음. UX는 DM 모양을 따름(출처 칩)인데 AI는 카드에 `reason` 한 줄을 보인다고 함. 건너뜀 사유도 AI는 `already_set`, DM·UX·리더 규칙은 **`classification_already_set`**. AI 매핑 표에 "data-architect가 병행 추가 중인 경로에 맞춤" 주석이 남음. 이대로면 패치 RPC·화면·검증기가 서로 다른 키를 읽는다 | ai-feature-designer | DM(이름 기준)에 맞춤: 저장 키 `source_message_ids`(모델 출력 `basis_message_ids` → 저장 매핑 명시), `origin = 'ai'`, `review = 'ok'`. `reason`을 남기려면 DM에 필드 추가를 요청하고 UX 카드에 표시 자리 추가(아니면 AI에서 삭제). V-9i ④의 "필수"와 DM "선택"을 한쪽으로. 사유 `already_set` → `classification_already_set`. "병행 추가 중" 주석·"빈 값만 추천 `[가정]`(ai 제안, ux 확인)"을 리더 결정 확정으로 |
| R-CR-15 | Minor | DM 2.5 `structured_draft.project.is_current`("`true`만 제안"), V-9h, 3.3 `p_fields`에 `is_current` ↔ AI AI-12 `project_patches[].field` "`start_month` \| `end_month`만", UX S-10 "이름·기간(빈 기간만 제외)은 AI가 제안하지 않는다" | DM은 AI가 "진행 중"을 제안하는 경로를 열었는데 AI 출력 스키마·대화 슬롯에는 없고 UX 카드에도 표시가 없다. 쓰이지 않는 경로이거나, 한쪽이 빠졌다 | ai-feature-designer | (a) AI-12 기간 슬롯에 "지금도 진행 중" 응답 → `project_patches` `is_current: true`(종료월 비었을 때만)를 추가하고 UX 카드 기간 행에 표시 요청, 또는 (b) DM에서 `project.is_current` 제안 경로를 빼도록 data-architect에 요청. 권고 (a)(대화에서 "아직 하고 있어요"가 흔함) |
| R-CR-16 | Minor | UX S-10 "분류 추천" 표 역량 행("추천 칩 최대 3개, 각각 체크(기본 모두 체크) + [반영]") ↔ DM 3.3 `apply_writing_chat_proposal`(필드 단위, `competencies`는 값 배열 전체를 씀) | 칩 일부만 체크해 반영하는 경로가 RPC에 없다. 체크 해제를 `apply_structured_draft_patch` 사용자 수정(`origin = user_edit`)으로 먼저 저장한 뒤 반영하는지, 반영 인자로 부분 배열을 넘기는지 정해지지 않았다 | ux-planner | "체크를 바꾸면 `apply_structured_draft_patch`로 `classification.competencies` 값을 고치고(`user_edit`) [반영]은 그 값을 쓴다"를 S-10에 명시(DM 현행 RPC로 가능). 모두 해제하면 [반영] 비활성 |
| R-CR-17 | Minor | DM 2.5 `writing_chats.project_id` 행 "소속 프로젝트만(… D-AI-15 (a) `[가정]`)", DM 2.3 skills "(PRD F-P1-05, Q-CR-2)" | CR-19·CR-18로 확정됐는데 `[가정]`/옛 질문 ID로 남음 | data-architect | "D-AI-15 (a) — 확정 2026-11-02 (사용자), CR-19", "Q-CR-2 → CR-18 확정"으로 표기 |

### 라운드 3 종료 상태
- 고칠 것: R-CR-14(Major, AI), R-CR-15·16·17(Minor). 라운드 2의 R-CR-9 잔여 문구 2곳·R-CR-13은 이번 범위 밖이라 재확인하지 않음.
- 새 사용자 결정 필요 항목 없음. D-UX-23 "자소서 문항 답변"만 `[가정]`.
