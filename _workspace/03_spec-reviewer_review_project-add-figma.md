# Resumate 기획 정합성 리뷰 — 프로젝트 추가·산출물 상세 (PA-1~PA-4) 부분 재실행, 라운드 1

- 작성: spec-reviewer / 2026-11-03
- 기준: 사용자 결정 `_workspace/00_input/planning-decisions-project-add-figma.md`(PA-1~PA-4, 확정 2026-11-03 (사용자)), 리더 정렬 1~4, `_workspace/project-add-figma/{prd,ux,ai}_requests.md`, `dm_replies.md`
- 범위: 이번 실행에서 바뀐 경계만(PA-1 산출물 AI 대화, PA-2 산출물 분류 없음, PA-3 페이지 단위 저장, PA-4 머리 필드, 대체 표기, 폐기 이름, 결정 ID). 리더 정렬 1~4는 다시 열지 않고 적용 여부만 확인했다.

## 요약

- 검토 문서: `docs/planning/01-prd.md` v4.6 · `02-user-flows.md` v5.6 · `03-ai-features.md` v4.6 · `04-data-model.md` v4.5
- 이슈: **Critical 0 / Major 3 / Minor 10** (합계 13), 해결 0 / 미해결 13
- 담당별: ux-planner 5 (Major 2, Minor 3) · ai-feature-designer 4 (Major 1, Minor 3) · data-architect 2 (Minor 2) · product-planner 2 (Minor 2)
- 핵심: PA-3 페이지 저장 계약(`save_project_page`·`save_project_deliverable`·`p_expected_updated_at`·`p_applied_proposals`·`stale_write`·`skipped` 6종·첫 메시지 순서)은 네 문서가 **정확히 일치**한다. 큰 어긋남은 한 곳에 몰려 있다 — **S-44 본문 초안 제안 카드가 AI-13·DM 2.5.0의 블록 단위 모양(덧붙이기 = `basis = new` 블록만, 블록별 검토·[빼기]·출처 3종, `replace_allowed`, `missing_slots` 등)을 반영하지 않았다.**

### 리더 정렬 적용 확인

| 정렬 | PRD | UX | AI | DM | 결과 |
|------|-----|----|----|----|------|
| 1. 이름·제목 비면 AI 전송 막고 칸 포커스, 임시 이름 없음 | F-P1-03 (1)·F-P1-18 (1)(6), 9.5 가정 1·2 폐기 | S-10·S-44 "첫 AI 메시지", FL-14·FL-22, D-UX-25 | AI-12·AI-13 "대상·시작점" ① | 3.7, 7장 | 일치 |
| 2. 턴에 `form_snapshot`, D-UX-26 폐기 | F-P1-13 (3), F-P1-18 (6), NFR-PRV-03 | S-10·S-44 "AI가 읽는", D-UX-26 취소선 | AI-12·AI-13 입력 컨텍스트 | 2.5.1, 7장 | 일치 (DM 7장 1행에 옛 문구 — R-PA-9) |
| 3. [반영] = 폼 채우기, 반영됨은 저장 트랜잭션, 실패해도 저장 | F-P1-13 (6), 용어집 | S-10 반영 규칙, C-15 ④⑤ | AI-12 "반영 → 저장하기" | 2.5.1, 3.3 | 일치. `apply_writing_chat_proposal`은 네 문서 모두 폐기로만 남음 |
| 4. 산출물 AI = F-P1-18 (6)~(8), F-P1-20 없음 | F-P1-18 비고, 9.5 가정 12 | FL-22, S-44, 매트릭스 | AI-13 머리, 0.2 | 6장 매트릭스 | 일치 |

### 폐기 이름 잔존 검사

`apply_writing_chat_proposal`, `p_target`, `new_project`/`new_project_deliverable` kind, `project_deliverables.source_writing_chat_id`, `mark_writing_chat_proposal_applied`, `value_too_long`, `project_status`, `p_applied_proposal`(단수), `p_deliverable_id`, 기본(임시) 이름·제목 — **현재 규칙으로 쓰인 곳 없음.** 모두 폐기·이름 변경 기록, 변경 이력, 취소선 안에만 있다. ("기본 이름"은 자기소개서 기본 이름 "새 자기소개서 (날짜)"로만 남아 있고 이번 범위와 무관.)

## 경계별 결과

| 경계 | 결과 | 이슈 |
|------|------|------|
| B1 PRD Must → 화면 | F-P1-18 (6)~(8) → S-44·FL-22, 매트릭스 반영 | — |
| B2 화면 필드 → 데이터 | S-10 `p_values`·머리 5필드·거부 코드, S-44 저장 인자·반환 일치. 역량 일부 체크의 반영 정보 표현 불가, 새 산출물 URL 표기 차이 | R-PA-7, R-PA-8 |
| B3 AI 입력 → 데이터 | `form_snapshot` 모양·길이, 부모 프로젝트 필드, 형제 산출물 제목 모두 DM에 있음 | — |
| B4 AI 출력 → 저장 | AI-13 `structured_draft`(schema_version 1, `target`) = DM 2.5.0 그대로 | — |
| B5 AI 출력 → 화면 | **S-44 카드가 AI-13 출력 필드 대부분을 보이지 않음**, 검토 필요 블록 채우기 규칙 미정, 새 페이지 칩 경로 없음, 제목 제안 여부 미답 | R-PA-1, R-PA-2, R-PA-3, R-PA-5, R-PA-6 |
| B6 응답 모드 | AI-13 초안 턴 이벤트·`compose` 단계가 S-44·C-03에 없음 | R-PA-4 |
| B7 기능 → 데이터 | DM 6장 F-P1-18 행에 산출물 대화 반영 | — |
| B8 용어 | "폼에 채움 / 반영됨", "저장하기", "산출물 상세" 일치. 이동 경로 자리표시자 표기 차이 | R-PA-12 |
| B9 MVP 범위 | PA-2 분류 없음 네 문서 일치(`writing_kind`는 `structured_draft` 안에만). 대체 표기 누락·구 규칙 잔존 | R-PA-9~R-PA-12 |
| B10 개인정보·삭제 | 산출물 삭제 → 대화 cascade, 독립 프로젝트 삭제 → 산출물·대화, `get_deletion_impact` 집계와 C-05 문구 일치. `form_snapshot` 저장·로그 없음 일치. 고지 범위는 D-DM-12 | — |
| B11 비용 | AI-13 대화 1회 약 $0.19(상한 약 $0.5~1.0), 초안 6회 제한 PRD 6.5·AI 7.4·DM 일치. BYOK라 PRD 1인 비용 상한 없음 | — |
| 결정 ID | D-DM-12 네 문서 선택지·권고 동일. D-UX-24~30 뜻 일치(DM이 D-UX-25·D-UX-30 인용). **PRD 열린 결정 목록에 D-AI-16·D-UX-28 없음** | R-PA-13 |

## 이슈

### R-PA-1 [Major] S-44 [뒤에 덧붙이기]·반영 버튼 규칙이 AI-13·DM과 다르다

- 경계: B5
- 근거:
  - `02-user-flows.md` S-44 "반영 규칙": "**[뒤에 덧붙이기]**: 지금 본문 끝에 빈 줄 하나를 두고 **초안을 붙인다**" — 초안 전체를 붙임. 버튼은 늘 [본문 교체] / [뒤에 덧붙이기] 두 개.
  - `03-ai-features.md` AI-13 "교체와 덧붙이기": "덧붙이기: `basis = new` 블록(과 그 앞 제목 블록)만 폼 현재 본문 뒤에 … 붙인다", "`new` 블록이 없으면 덧붙이기 비활성", "현재 본문이 비어 있으면 … **[본문에 넣기]** 하나만", "현재 본문이 6,000자를 넘으면 … `replace_allowed = false`", "`base_body_hash` … 다르면 교체는 '초안을 만든 뒤 본문이 바뀌었어요…' 확인".
  - `04-data-model.md` 3.3 "채우기 규칙은 화면 판정": "산출물은 교체 / **`basis = new` 블록만 덧붙이기**".
  - 두 문서(AI·DM)가 같은 규칙이고 화면만 다르다. 화면대로 구현하면 현재 본문을 다시 정리한 `current_body` 블록이 본문에 두 번 들어간다(AI-13 품질 기준 "덧붙이기 중복 5% 이하"를 화면이 깸).
- 담당: **ux-planner**
- 수정 제안: S-44 반영 규칙을 AI-13에 맞춘다 — ① 덧붙이기 = `basis = new` 블록(+ 앞 제목 블록)만, 미리보기에서 붙을 부분 강조 ② `new` 블록이 없으면 [뒤에 덧붙이기] 비활성 ③ 본문이 비면 [본문에 넣기] 하나 ④ `replace_allowed = false`면 [본문 교체] 숨김 + 안내("본문이 길어 교체 초안은 만들지 않았어요 — 덧붙이기나 직접 편집") ⑤ `base_body_hash`가 폼 본문과 다르면 교체 전 추가 확인. FL-22의 분기와 D-UX-29도 함께 고친다.
- 상태: open

### R-PA-2 [Major] S-44 제안 카드가 AI-13의 블록 단위 출력을 보이지 않는다 (검토·출처·사실·누락 슬롯)

- 경계: B5 (+ B2: 화면 동작이 DM 패치 경로와 어긋남)
- 근거:
  - `02-user-flows.md` S-44 패널 표 "본문 초안 제안 카드": "C-15 출처 발화 칩(**초안 전체에 한 묶음**)", 상태 "제안 / 검토 필요 / …", 동작 "검토 필요면 [수락]·[거절] 먼저". 반영 규칙: "검토 필요(`review = 'needs_review'`) 초안은 [수락] 전에는 두 버튼이 비활성이다. **[거절]은 초안을 비우고 AI가 다시 묻는다**". C-15도 "S-44 … 초안 전체에 한 묶음".
  - `03-ai-features.md` AI-13: "블록마다 출처 칩('이 말에서 정리했어요' → 발화로 / '지금 본문에서' / '프로젝트 내용에서'), `needs_review` 블록은 강조 + **블록별 [빼기]**", V-10d·V-10e는 **블록**을 `needs_review`로, `draft_done`에 `missing_slots`·제거 수, 카드 "아직 비어 있는 부분: …"(`missing_slots`), "확인되지 않은 문장 N개는 뺐어요"(`dropped_block_count`), `turn_done`에 "초안 남은 횟수". 사용자 수정 = "사실의 수락/거절, 블록 [빼기], `needs_review` 블록 수락".
  - `04-data-model.md` 2.5.0 사용자 패치: "사실 수락/거절, 블록 [빼기] …, 블록 `needs_review` 수락" — **초안 전체 거절(비우기) 경로는 없다.**
  - 사실(`facts[]`)의 `needs_review`(V-9e)는 사용자가 수락해야 초안 출처가 되는데(V-10a), S-44에는 사실을 보거나 수락하는 자리가 없다 → 그런 사실은 영영 초안에 쓰이지 않는다.
- 담당: **ux-planner**
- 수정 제안: S-44 카드를 블록 단위로 다시 정의한다 — 블록별 출처 칩 3종(C-15에 "지금 본문에서"·"프로젝트 내용에서" 상태 추가), `needs_review` 블록 강조 + [수락] / [빼기](초안 전체 [거절] 삭제), `missing_slots` 한 줄, `dropped_block_count` 한 줄, 초안 남은 횟수(`6 − draft_count`), 검토 필요 **사실** 목록(수락 / 거절) 자리. 블록 문장 직접 고치기는 두지 않는다(AI-13·DM 그대로 — UX-12 확인됨).
- 상태: open

### R-PA-3 [Major] 산출물 초안에 `needs_review` 블록이 남아 있을 때 [반영]이 되는지 정해지지 않았다

- 경계: B5 (가드레일 T-18·F-P1-13 (6) "수락하지 않은 검토 필요 항목은 반영하지 않는다")
- 근거:
  - `03-ai-features.md` AI-13 "반영(폼 채우기) → 저장하기": "`skipped` 사유는 AI-12와 같다(`needs_review` = `needs_review` 블록이 남음)" — 즉 **채운 뒤 저장할 때** 기록만 건너뛴다는 뜻으로 읽힌다. 채우기 단계에서 `needs_review` 블록을 빼는지, 버튼을 막는지는 AI-13 "교체와 덧붙이기"에 없다.
  - `04-data-model.md` 2.5.1: `needs_review`(…산출물은 `needs_review` 블록이 남음) → `skipped`. DM 3.3 채우기 규칙에도 산출물의 `needs_review` 처리는 없다.
  - `02-user-flows.md` S-44: 초안 전체가 검토 필요면 두 버튼 비활성(블록 단위 개념 없음).
  - 이대로면 "검토 안 한 블록이 본문에 채워져 저장되고, 반영됨 기록만 빠지는" 경로가 생긴다 — S-10(검토 필요 섹션은 채우기에서 빠짐)과 규칙이 다르고 T-18에 어긋난다.
- 담당: **ai-feature-designer** (산출물 반영 규칙의 원천)
- 수정 제안: AI-13에 채우기 규칙을 명시한다. 권고: "`needs_review` 블록은 수락 전까지 교체·덧붙이기 결과에서 **뺀다**(미리보기에 '검토하지 않은 문장 N개는 넣지 않아요'), 모두 `needs_review`면 버튼 비활성". 그러면 저장 RPC의 `needs_review` skip은 다른 탭 등 드문 경우만 남는다. 정한 뒤 DM 3.3 채우기 규칙 한 줄과 UX S-44(R-PA-2)를 맞춘다.
- 상태: open

### R-PA-4 [Minor] S-44 응답 방식·진행 표시·시작 인사가 AI-13 초안 턴과 다르다

- 경계: B6
- 근거:
  - `02-user-flows.md` S-44: "AI 응답 방식: SSE 스트리밍(**답 스트리밍 → 초안 갱신**, 이벤트 이름은 AI 명세). 본문 초안이 길어 카드의 '정리 중'이 S-10보다 길 수 있다". 상태(패널) "초안 정리 중". 시작 영역 "시작 인사(… 예: 본문 비어 있음 / 본문 있음 `[가정]`)".
  - `03-ai-features.md` AI-13: 초안 턴은 응답 호출이 없고 `facts_patch` → `draft_started` → `draft_block`(블록마다) → `draft_done` → `reply_done`(고정 문구) 순서, 초안 실패 시 이전 초안 유지·횟수 안 셈, 목표 첫 블록 8초·완료 60초. C-6 표: "초안 턴은 패널 제안 카드에 '초안 작성 중'을 보인다(문구 UX)". 시작 인사는 **3종**(본문 비고 종류 모름 / 제목으로 종류 짐작 / 본문 있음).
  - UX C-03·C-04에 `compose` 단계 문구가 없다(`grep` 결과 UX 전체에 `compose`·`draft_block` 없음).
- 담당: **ux-planner**
- 수정 제안: S-44에 "초안 턴" 상태를 따로 둔다 — `draft_started` 때 카드 자리에 "초안 작성 중", `draft_block`이 오는 대로 블록 채움(임시 표시), `draft_done`에서 확정·`missing_slots` 등 표시, 실패 시 이전 초안 유지 + 다시 시도. C-04 목록에 "산출물 초안(블록, 첫 블록 8초·완료 60초)" 추가, C-03 단계 문구에 `compose`. 시작 인사 예시를 AI-13 3종으로.
- 상태: open

### R-PA-5 [Minor] 대화 행이 없는 새 페이지의 빠른 버튼 칩을 받을 경로가 없다

- 경계: B5
- 근거:
  - `03-ai-features.md` AI-12 "빠른 버튼 칩": "서버가 `turn_done`(**시작 인사 때는 대화 조회**)에서 … 내려 준다". AI-13도 "서버가 `turn_done`·대화 조회에서 내려 줌". 시작 인사는 "행이 생기기 전에는 화면이 고정 문구(상수)로 먼저" — 칩은 이 예외가 없다.
  - `02-user-flows.md` S-10 칩 행: "새 프로젝트(대화 행 없음)는 'STAR 비어 있음' 상태의 칩을 쓴다(**값을 내려 주는 경로는 AI·데이터 모델 요청 `[가정]`**)". S-44: "칩 문구는 AI 명세가 원천이고 서버가 내려 준다(화면 쪽 예시 문구를 따로 두지 않는다)". 5.2 마지막 행 "행 없는 새 페이지의 칩" 미해소.
  - `04-data-model.md` 시작 RPC 반환 `{ writing_chat_id, greeting_message }` — 칩 없음. 7장 산출물·프로젝트 상세 조회 행에도 칩 없음. `dm_replies.md` UX AI-7 회신: "화면 상수 또는 서버 상수 응답 — **AI 명세 몫**".
- 담당: **ai-feature-designer**
- 수정 제안: AI-12·AI-13에 "대화 행이 없을 때의 칩 = 고정 상수(S-10: 'STAR 비어 있음' 행, S-44: '초안 불가' 행), 화면 상수로 두고 서버 상수와 같은 값" 한 줄, 그리고 "대화를 열 때의 칩"을 누가 계산해 어떤 응답으로 주는지(조회 RPC 반환 또는 시작 RPC 반환에 `chips` 추가)를 정한다. 반환 모양이 바뀌면 data-architect가 7장에 반영.
- 상태: open

### R-PA-6 [Minor] 산출물 AI의 "제목은 제안하지 않음"이 AI-13에 명시돼 있지 않다

- 경계: B5
- 근거: `02-user-flows.md` S-44 반영 규칙 "**제목은 AI가 제안하지 않는다** `[가정]`(**AI 명세 확인 요청**)". `01-prd.md` F-P1-18 (7) "제목은 바꾸지 않는다 `[가정]`", 9.5 가정 5. `03-ai-features.md` AI-13은 출력이 본문 블록뿐이라 사실상 제목 제안이 없지만 그렇다고 적은 문장이 없고, UX 요청 AI-4에 대한 답이 없다.
- 담당: **ai-feature-designer**
- 수정 제안: AI-13 "목적" 또는 "출력 스키마"에 "산출물 제목은 제안·변경하지 않는다(PRD F-P1-18 (7)). 초안의 `heading` 블록은 본문 안 소제목이다" 한 줄. UX는 "AI 명세 확인 요청" 문구를 지운다.
- 상태: open

### R-PA-7 [Minor] 역량 추천을 일부만 체크했을 때 "반영 정보에 체크한 값만 담는다"를 계약이 표현하지 못한다

- 경계: B2
- 근거: `02-user-flows.md` S-10 "분류 추천": "역량 칩을 일부만 체크한 경우 … **저장 요청의 반영 정보에도 체크한 값만 담는다**(R-CR-16의 의미 유지, v5.6)". `04-data-model.md` 2.5.1 `p_applied_proposals` 원소 = `{writing_chat_id, field, rev}` — 값 목록을 담을 자리가 없고 `field = 'competencies'` 하나로 기록된다.
- 담당: **ux-planner** (데이터 모델이 계약 기준)
- 수정 제안: 문구를 "반영 정보에는 `{writing_chat_id, field: 'competencies', rev}` 하나를 보낸다(어떤 값을 골랐는지는 저장된 `projects.competencies`가 말한다). 체크를 모두 빼면 원소를 보내지 않는다"로 고친다. 다른 뜻(체크하지 않은 값은 '반영됨'이 아님을 기록)이 필요하면 data-architect에 원소 모양 변경을 따로 요청.
- 상태: open

### R-PA-8 [Minor] 새 산출물 URL 표기가 다르다

- 경계: B2
- 근거: `02-user-flows.md` S-44 URL "새 산출물 `/career/projects/{project_id}/deliverables/new` `[가정]`" ↔ `04-data-model.md` 7장 "산출물 상세 (v4.5)" 행 "새 산출물은 행 없음(**`?project=` 경로**, UX)".
- 담당: **data-architect** (URL은 UX 소관)
- 수정 제안: DM 7장 문구를 "새 산출물은 행 없음(`/career/projects/{project_id}/deliverables/new`, UX S-44)"으로.
- 상태: open

### R-PA-9 [Minor] 데이터 모델에 대체된 규칙이 현재형으로 남아 있다

- 경계: B9
- 근거 (`04-data-model.md`):
  - 2.5 사용자 패치 규칙: "반영된 필드 … 사용자 패치도 거부 — 반영 뒤 고치기는 **왼쪽 STAR 섹션 편집에서**" — S-10에 섹션 편집이 없다(PA-3).
  - 6장 `next_action` 판정 ②: "`form`이면 **S-10 STAR 섹션 편집** `[가정]`".
  - 6장 게이트 설명: "`next_action: "create_project"`(채울 프로젝트가 없음 → **이름만 넣어 작성 중 프로젝트를 먼저 만들고** 그 패널에서 대화, CR-6)" — CR-6 해당 부분은 PA-3으로 대체(소속 선택 → 빈 S-10 → 첫 저장·첫 메시지 때 생성).
  - 7장 "대화 턴" 행: "② `app_ai_writer`로 extract·reply(**프로젝트 현재 STAR를 매 턴 다시 읽음**)" — 리더 정렬 2로 `form_snapshot` 우선(같은 행 머리에는 바르게 적힘).
- 담당: **data-architect**
- 수정 제안: 각각 "왼쪽 STAR 입력란에서(페이지 저장)", "S-10 STAR 입력(페이지 저장)", "C-23 소속 선택 → 빈 S-10, 첫 저장 또는 첫 AI 메시지 때 행 생성(PA-3)", "`form_snapshot` 우선, 없으면 DB 값"으로 고친다.
- 상태: open

### R-PA-10 [Minor] AI 명세에 대체된 규칙·옛 기준 버전이 남아 있다

- 경계: B9
- 근거 (`03-ai-features.md`):
  - C-1 데이터 기준 표(AI-02 등 행): "AI를 쓸 수 없으면 … 그 프로젝트 상세(S-10)의 **STAR 섹션 편집**을 연다", "② `create_project` — … '프로젝트 추가'(**이름 + 소속 선택**)로 **작성 중 프로젝트를 먼저 만들고(CR-6)**" — AI-12 본문(v4.6)은 빈 S-10으로 고쳤는데 C-1 표는 그대로.
  - AI-12 대상·시작점: "MVP에 독립 프로젝트 대화 없음 — CR-19 확정(D-AI-15)" — 산출물 대화(AI-13, PA-1) 예외 표기 없음.
  - AI-08(F-P1-08) 목적: "프로젝트 상세 페이지의 **STAR 섹션 편집**에서" — PRD F-P1-08 v4.6은 "STAR 항목 입력란 안, 폼에 채우기만".
  - 문서 머리 기준 입력: "PRD **v4.5**", "UX **v5.5**" — 이번 판은 PRD v4.6·UX v5.6을 기준으로 정렬했다.
- 담당: **ai-feature-designer**
- 수정 제안: C-1 표 두 곳을 AI-12 v4.6과 같은 문장으로, AI-12에 "(산출물 대화는 AI-13, PA-1)" 덧붙임, AI-08 진입·수락 = 입력란 안·폼 채우기, 머리 기준 버전 갱신.
- 상태: open

### R-PA-11 [Minor] 화면 명세에 대체된 규칙·미해소 표시가 남아 있다

- 경계: B9 (+ B6 일부)
- 근거 (`02-user-flows.md`):
  - 1.4 확장 자리 표·4장 Should 표: "F-P1-08 STAR 섹션 다듬기 | **S-10 STAR 섹션 편집 안**" — S-10에 섹션 편집이 없다(PRD F-P1-08 v4.6 "STAR 항목 입력란 안").
  - S-35 폐기 설명: "STAR 편집은 **S-10의 섹션 수정으로** 옮겼다".
  - C-23 소속 행: 독립을 고르면 "**독립 프로젝트에는 STAR와 AI 대화가 없어요**" 안내 — PA-1로 산출물에는 AI 대화가 있다.
  - 5.2 행 "(v5.6) AI 명세 개정 — 산출물 작성 대화(**AI-12 확장 또는 새 ID**…)"가 미해소처럼 남아 있다 — AI-13이 생겼다(남은 것은 새 페이지 칩, R-PA-5).
  - FL-22에 `stale_write` 분기가 없다(FL-14에는 있음, S-44 본문은 "S-10과 같은 처리").
- 담당: **ux-planner**
- 수정 제안: F-P1-08 위치 = "S-10 STAR 입력란 옆", S-35 문장 = "S-10의 STAR 입력란으로", C-23 안내 = "독립 프로젝트에는 STAR가 없어요. 산출물은 AI와 함께 쓸 수 있어요" 등, 5.2 행을 "해소: AI-13(산출물 작성 대화). 남음: 행 없는 새 페이지의 칩"으로, FL-22에 `W -->|stale_write|` 분기 추가.
- 상태: open

### R-PA-12 [Minor] PRD 결정 표의 대체 표기 누락과 이동 경로 자리표시자

- 경계: B8·B9
- 근거 (`01-prd.md`):
  - 9.5 PA-1 행 "대체·폐기하는 결정"에 **CR-8(산출물 = 직접 작성만)**, PA-3 행에 **"프로젝트 상세 STAR의 섹션별 수정(CR-3의 해당 부분)"**이 있는데, 9.4 표의 **CR-8 행과 CR-3 행에는 (v4.6) 표시가 없다**(CR-6·CR-19 행에는 있음). UX 5.1f "v5.6으로 대체된 기존 결정"은 CR-8을 "확장(PA-1)"으로 적었다.
  - 9.4 아래 "v4.5에서 새로 둔 `[가정]`" 5번: "독립 프로젝트 … **AI 작성 대화 없음은 CR-19로 확정**" — 산출물 예외 표기 없음.
  - F-P1-09 (5): 이동 경로 "**{커리어명}** › {프로젝트명} › 프로젝트 상세" — UX L-02·S-10과 결정 파일 "함께 정리할 명세"는 Figma의 "{커리어명}"을 자리표시자 오류로 보고 "{회사명 / 기관명}"을 쓴다.
- 담당: **product-planner**
- 수정 제안: CR-8 행에 "(v4.6) PA-1로 확장: 직접 작성 + 산출물 상세 AI 초안 제안", CR-3 행에 "(v4.6) 프로젝트 상세의 섹션별 수정은 PA-3 페이지 단위 저장으로 대체", 가정 5에 "(산출물은 v4.6 PA-1로 AI 대화 있음)", F-P1-09 (5) 이동 경로를 "{회사명 / 기관명} › {프로젝트명} › 프로젝트 상세"로.
- 상태: open

### R-PA-13 [Minor] PRD 열린 결정 목록에 D-AI-16·D-UX-28이 없다

- 경계: 결정 ID 정합
- 근거: `01-prd.md` 9.0 "열린 제품 결정은 세 개(D-14, D-39, v4.6의 D-DM-12)". 그런데 `03-ai-features.md` 8장 **D-AI-16 `[결정 필요]`**(S-43 독립 프로젝트 정보·내용에도 AI 패널을 둘지, 권고 (a) 유지 — DM 2.5·8장도 인용)와 `02-user-flows.md` 5.1f **D-UX-28 `[결정 필요]`**(독립 프로젝트 만들기도 이름 다이얼로그 없이 바꿀지, 권고 (b)·현재 명세 (a))가 사용자 결정으로 올라와 있다. PRD는 9.5 가정 9("독립 프로젝트 생성 진입은 UX 재검토")로만 D-UX-28을 가리키고, D-AI-16은 F-P1-13 (11)이 "확정(CR-19)"으로 적어 열린 결정이 있다는 표시가 없다.
- 담당: **product-planner** (범위 결정의 기준 문서)
- 수정 제안: 9.0 표에 D-AI-16(권고 (a) 유지 — CR-19 남는 부분)·D-UX-28(권고 (b), 현재 명세 (a))을 `[결정 필요]` 사용자 행으로 추가하고, 9.0 머리 문장의 개수를 고친다. F-P1-13 (11)에 "정보·내용 대화를 다시 열지는 D-AI-16" 참조, 9.5 가정 9에 D-UX-28 ID.
- 상태: open

## 정합 확인된 항목 (참고)

- PA-3 계약: `save_project_page(p_project_id, p_values, p_expected_updated_at, p_applied_proposals)` → `{project_id, status, updated_at, applied, skipped}`, `save_project_deliverable(p_project_deliverable_id, p_project_id, p_title, p_body, p_expected_updated_at, p_applied_proposals)` → `{project_deliverable_id, project_id, sort_order, updated_at, applied, skipped}`, 원소 S-10 `{writing_chat_id, field, rev}` / S-44 `{writing_chat_id, rev, mode}` — UX S-10·S-44, AI-12·AI-13, DM 2.5.1·3.7·7장 모두 같음.
- `skipped[].reason` 6종(`not_found`·`already_applied`·`proposal_changed`·`needs_review`·`invalid_entry`·`mark_failed`)과 화면 채우기 판정 이름(`empty`·`period_already_set`·`classification_already_set`) 구분 — UX S-10·AI-12·DM 일치. 거부 코드(`project_name_required`·`field_too_long`·`invalid_period`·`invalid_classification`·`project_affiliation_required`·`project_scope_change_not_allowed`·`project_not_affiliated`·`deliverable_title_required`·`deliverable_limit_reached`·`deliverable_requires_standalone_project`·`stale_write`·`invalid_form_snapshot`·`writing_chat_draft_limit_reached`)와 UX 문구 연결 일치.
- 첫 AI 메시지 순서(이름·제목 확인 → AI 사용 가능 확인 → 페이지 저장 → 시작 RPC → 턴) — PRD·UX(FL-14·FL-22·S-10·S-44)·AI-12·AI-13·DM 7장 일치. 시작 RPC `start_writing_chat(p_project_id, p_return_target, p_form_snapshot)` / `start_deliverable_writing_chat(p_project_deliverable_id, p_form_snapshot)` 일치.
- `stale_write`: 기대 버전 = 페이지를 연 시점 또는 마지막 저장 응답 `updated_at`, "내 내용으로 저장" = 인자 null 재전송, 대화 삭제(`source_writing_chat_id` set null)로는 오르지 않음 — UX·AI·DM 일치.
- L-02 셸(로고 · [Resumate AI] · 저장하기 · 계정), C-23 남는 범위(독립 이름 입력 + 소속 선택), C-24 = S-09·S-34·S-43 전용 — PRD F-P1-03 (1)·F-P1-18 (1)·F-P2-09, UX, DM 7장 "섹션 저장" 행 일치.
- PA-4 머리 5필드 — PRD F-P1-03 (4)·F-P1-19, UX S-10 머리, `form_snapshot`·`p_values` 키 일치.
- PA-2 — PRD F-P1-18 (9)·F-P1-19, UX S-44·S-43, AI-13 "분류 추천 없음", DM 2.3 "분류 컬럼 없음" 일치.
- 대체 표기: CR-6(PRD 9.4·UX 5.1f·AI-12 취소선), CR-7·CR-19(UX 5.1f, PRD CR-19 행), C-24(UX C-24 머리), D-UX-26(UX 취소선, DM 3.7) — 표기됨. CR-8·CR-3은 PRD만 누락(R-PA-12).

## 사용자 결정 필요 (통합, 중복 제거)

| ID | 질문 | 선택지와 권고 | 출처 | 비고 |
|----|------|---------------|------|------|
| **D-DM-12** (신규) | 저장하지 않은 폼 값(`form_snapshot`)을 AI 작성 대화 턴에 실어 사용자의 공급자로 보내는 것이 지금 고지·동의 범위에 드는가 | (a) 지금 범위 + 다음 고지 버전에 "작성 중인 내용 포함" 한 구절, 재동의 없음 **(권고 — PRD·AI·DM 일치)** / (b) 새 고지 + 재동의 / (c) 보내지 않음(리더 정렬 2 되돌림) | DM 8장(정본), PRD 9.0·9.2, AI 8장, UX 5.2 | 법무 D-39·고지 문구 D-10과 함께. 확정 전 구현은 (a) `[가정]` |
| **D-AI-16** (신규) | 독립 프로젝트 정보·내용(S-43, `projects.description`)에도 AI 작성 대화를 둘까 | (a) MVP에 없음 유지 **(권고)** / (b) S-43에 AI-13과 같은 "내용 초안" 대화 | AI 8장, DM 2.5·8장 참조 | 독립 프로젝트만 있는 사용자는 D-01 게이트에서 AI 없이 폼뿐이라는 점이 남는다. PRD 9.0에 없음(R-PA-13) |
| **D-UX-28** (신규) | 독립 프로젝트 만들기도 이름 다이얼로그(C-23) 없이 S-43 "새 독립 프로젝트" 패널(첫 섹션 저장 때 생성)로 바꿀까 | (a) 유지 — 지금 명세 / (b) 첫 저장 때 생성으로 통일 **(UX 권고)** | UX 5.1f, PRD 9.5 가정 9 | PA-3 범위 밖이라 이번 판은 (a). PRD 9.0에 없음(R-PA-13) |
| D-14 (기존) | 모의 면접 점수 산정 방식 | 사용자 추후 정의 | PRD 9.0 | 이번 범위 밖, 변동 없음 |
| D-39 (기존) | BYOK 공급자 전송이 국외 이전인지 | 법무 확인 | PRD 9.0 | D-DM-12와 함께 |
| 출시 전 (기존) | D-10 고지 문구·버전, KMS 공급사 | — | PRD 9.0 | D-10에 D-DM-12 (a)의 한 구절 포함 |

UX가 `[가정]`으로 둔 D-UX-24(늘 입력 상태)·D-UX-25(첫 메시지 = 폼 전체 저장)·D-UX-27(다시 열기 버튼 위치)·D-UX-29(교체 확인·되돌리기)·D-UX-30(소속 변경 = ⋯ 메뉴)은 사용자 결정이 아니라 UX 결정이며 다른 문서와 뜻이 맞는다(DM은 D-UX-25·D-UX-30을 같은 뜻으로 인용).

## 다음 단계

- 라운드 1 수정 요청을 담당자에게 보낸다. Major 3건(R-PA-1·R-PA-2는 ux-planner, R-PA-3은 ai-feature-designer)은 **R-PA-3을 먼저 정한 뒤 R-PA-1·R-PA-2를 고치는 순서**가 맞다(채우기 규칙이 카드 동작을 정함).
- R-PA-5에서 시작·조회 반환 모양이 바뀌면 data-architect가 DM 2.5·7장을 따라 고친다.
- Phase 5에서 `docs/planning/decisions.md`에 PA-1~PA-4(확정 2026-11-03 (사용자)), 리더 정렬 1~4, D-DM-12·D-AI-16·D-UX-28(결정 대기), CR-6·CR-8·CR-19·D-UX-26 대체 표기를 옮겨야 한다(현재 decisions.md에는 PA 관련 항목이 없음 — 이번 단계의 이슈는 아님).

---

## 라운드 2 (최종) — 2026-11-03

- 검토 문서: `01-prd.md` v4.6 · `02-user-flows.md` v5.6 · `03-ai-features.md` v4.6 · `04-data-model.md` v4.5 (라운드 1 수정 반영본)
- 함께 확인한 리더 판정·회신: R-PA-3 리더 판정(미수락 `needs_review` 블록은 채우기에서 제외, 블록별 [수락]/[빼기], 초안 전체 거절 없음, DM 2.5.1 산출물 `skipped.needs_review` = 채울 내용 블록 없음), R-PA-5(칩은 화면 `quickChips(state)`, `turn_done`에 칩 없음), R-PA-7(DM 변경 없음)
- 결과: **라운드 1 이슈 13건 모두 해결.** 새 이슈 **Minor 2건**(R-PA-14·R-PA-15). Critical·Major 0. 라운드 상한(2회)에 닿아 새 이슈 2건은 **미해결로 리더에게 넘긴다**(구현 전 한 줄 수정으로 닫을 수 있는 수준).

### 라운드 1 이슈 재확인

| ID | 심각도 | 담당 | 상태 | 확인 근거 |
|----|--------|------|------|-----------|
| R-PA-1 | Major | ux-planner | **해결** | S-44 "반영 규칙": 덧붙이기 = "`basis = 'new'` 블록(과 그 바로 앞 제목 블록)만", `new` 없으면 비활성, 본문 비면 [본문에 넣기] 하나, `replace_allowed = false`면 [본문 교체] 숨김, `base_body_hash` 불일치 시 교체 확인 문구 — AI-13 "교체와 덧붙이기"·DM 3.3과 같다. FL-22 분기(`B`·`BT`·`HS`·`AP`)도 같은 규칙 |
| R-PA-2 | Major | ux-planner | **해결** | S-44 "본문 초안 제안 카드 구성" 표: 블록별 출처 칩 3종(C-15도 갱신), `needs_review` 블록 [수락]/[빼기], 확인이 필요한 사실 [수락]/[거절], `missing_slots`, `dropped_block_count`, 초안 남은 횟수, 교체 불가 안내, 카드 잠금. "초안 전체를 거절(비우기)하는 버튼은 없다" — DM 2.5.0 사용자 패치(407행)·AI-13 "사용자 수정"과 일치 |
| R-PA-3 | Major | ai-feature-designer | **해결** | AI-13 "검토 필요 블록 채우기 규칙"(교체·덧붙이기·[본문에 넣기] 모두에서 미수락 블록 제외, 모두 미수락이면 버튼 막음, ② 상태에서 블록 패치 막음), DM 3.3 채우기 규칙·2.5.1 `skipped[].reason` 표, UX S-44·5.2 해소 행 — 네 곳 문장이 같다. PRD F-P1-13 (6) "수락하지 않은 검토 필요 항목은 반영하지 않는다"와도 맞다 |
| R-PA-4 | Minor | ux-planner | **해결** | S-44 "AI 응답 방식"에 질문 턴 / 초안 턴(`draft_started` → `draft_block` 임시 표시 → `draft_done` 확정, 실패 시 이전 초안 유지·횟수 안 셈, 첫 블록 8초·완료 60초), C-03 `compose`·`validate` 문구, C-04 산출물 초안 이벤트 순서, 시작 인사 3종 — AI-13 "응답 모드"와 같다 |
| R-PA-5 | Minor | ai-feature-designer | **해결** | AI-12 "빠른 버튼 칩 계산 규칙(AI-12·AI-13 공통)": 화면 `quickChips(state)`, 서버는 칩을 내려 주지 않음(`turn_done`·시작 RPC·조회에 칩 없음), 행 없는 새 페이지 포함. UX S-10 칩 행·S-44 시작 영역, DM 7장 "대화 턴" 행(`turn_done`은 `ready_to_return`만, 칩 없음) 일치. 세부 표현 차이 1건은 R-PA-14 |
| R-PA-6 | Minor | ai-feature-designer | **해결** | AI-13 머리 "제목은 제안·변경하지 않는다"(`heading` = 본문 안 소제목). UX S-44 확인 요청 문구 삭제, PRD F-P1-18 (7)과 일치 |
| R-PA-7 | Minor | ux-planner | **해결** | S-10 분류 추천: 체크한 값만 폼에 채우고 반영 정보는 `{writing_chat_id, field: 'competencies', rev}` 하나, 모두 빼면 원소 없음 — DM 2.5.1 원소 모양 그대로(DM 변경 없음) |
| R-PA-8 | Minor | data-architect | **해결** | DM 7장 "산출물 상세" 행: `/career/projects/{project_id}/deliverables/new`(UX S-44) |
| R-PA-9 | Minor | data-architect | **해결** | DM 2.5 사용자 패치 규칙 "왼쪽 STAR 입력란에서(페이지 저장)", 2.5.0 `is_current` "S-10 기간 입력(페이지 저장)", 6장 판정 ② "S-10 STAR 입력(페이지 저장)", 6장 게이트 "C-23 소속 선택 → 빈 S-10, 첫 저장하기 또는 첫 AI 메시지 때 행 생성", 7장 턴 ② "`form_snapshot` 우선, 없으면 DB 값" |
| R-PA-10 | Minor | ai-feature-designer | **해결** | C-1 표 ①② 빈 S-10·STAR 입력란으로 고침(취소선 보존), AI-12 "산출물 대화는 AI-13", AI-08 목적 "STAR 항목 입력란 안", 머리 기준 PRD v4.6·UX v5.6 |
| R-PA-11 | Minor | ux-planner | **해결** | 1.4·4장 F-P1-08 "S-10 STAR 입력란 옆", S-35 폐기 문장, C-23 독립 안내 "독립 프로젝트에는 STAR가 없어요. 산출물은 AI와 함께 쓸 수 있어요"(D-AI-16 참조), 5.2 AI 명세 행 해소, FL-22 `stale_write`·저장 실패 분기 |
| R-PA-12 | Minor | product-planner | **해결** | 9.4 CR-3·CR-8 행에 (v4.6) 대체·확장 표기, 9.4 가정 5 산출물 예외, F-P1-09 이동 경로 "{회사명 / 기관명} › {프로젝트명} › 프로젝트 상세" |
| R-PA-13 | Minor | product-planner | **해결** | 9.0 "열린 제품 결정은 다섯 개(D-14, D-39, D-DM-12·D-AI-16·D-UX-28)" + 표 두 행, 9.x 결정 목록 D-AI-16·D-UX-28, F-P1-13 (11) D-AI-16 참조, 9.5 가정 9 D-UX-28 |

### 수정분에서 새로 찾은 이슈

#### R-PA-14 [Minor] S-44 빠른 버튼 칩 상태 계산이 AI-13과 두 곳에서 다르다

- 경계: B5 (AI 칩 표 ↔ 화면)
- 근거:
  - ① 행 없는 새 산출물: `02-user-flows.md` S-44 시작 영역 비고 "대화 행이 없으면 사실 0개·초안 없음 → **'초안 불가' 행**" ↔ `03-ai-features.md` AI-12 "빠른 버튼 칩 계산 규칙" 입력 항목: "S-44는 **본문이 비면 '초안 불가' 행, 본문이 있으면 '초안 가능, 초안 없음' 행**". AI-13 "초안 제안 시점"도 초안 불가 = "사실이 2개 미만**이고 본문이 비어 있으면**". 새 산출물에 본문을 먼저 쓰고 첫 메시지를 보내려는 사용자에게 UX 문장대로면 초안 칩이 안 보인다.
  - ② 초안 6회 도달: UX S-44 카드 구성 "초안 남은 횟수" 행 "0이면 **초안 칩 숨김**" ↔ AI-13 칩 표 아래 "초안 6회에 닿으면 초안 칩 자리를 **'빠진 부분 물어봐 줘'·'새 대화 시작'으로 바꾼다**". (UX "초안 6회 상한" 문단은 "칩은 AI-13 규칙대로 바뀐다"라고 맞게 적어 같은 문서 안에서도 갈린다.)
- 담당: **ux-planner**
- 수정 제안: ① S-44 시작 영역 비고를 "대화 행이 없으면 사실 0개·초안 없음·`draft_count` 0으로 계산(본문이 비면 '초안 불가' 행, 있으면 '초안 가능, 초안 없음' 행 — AI-12 칩 계산 규칙)"으로. ② 카드 구성 표의 "0이면 초안 칩 숨김"을 "0이면 초안 칩 자리가 AI-13 규칙대로 바뀜('빠진 부분 물어봐 줘'·'새 대화 시작')"으로.
- 상태: **해결 — 리더 수정(2026-11-03, 리뷰어 재검토 없음, grep 확인)**

#### R-PA-15 [Minor] 초안 턴 뒤 화면이 새 `draft_count`(초안 남은 횟수)를 받는 자리가 문서마다 다르다

- 경계: B5·B6 (AI 이벤트 ↔ DM 7장 ↔ 화면)
- 근거:
  - `03-ai-features.md` AI-13 응답 모드 질문 턴: "`turn_done`(**초안 남은 횟수**. 칩은 싣지 않음)" — 필드 이름 없음. 초안 턴의 `draft_done`은 "제거 수, `needs_review` 블록, `missing_slots`, `replace_allowed`, `rev`"로 `draft_count`가 없다.
  - `04-data-model.md` 7장 "대화 턴" 행: `turn_done`(`ready_to_return`만 — 칩 없음). 산출물 대화 추가 이벤트 목록에도 남은 횟수 없음.
  - `02-user-flows.md` S-44: "초안 남은 횟수 {6 − `draft_count`}(`structured_draft.draft_count`로 화면이 계산)", "`turn_done`(뒤에 화면이 칩·초안 남은 횟수를 다시 계산)". AI-12 칩 계산 규칙도 입력에 `draft_count`를 쓴다.
  - 초안 턴마다 `draft_count`가 +1 되는데(내용 블록이 안 남은 경우 포함, DM 2.5.0 406행), 그 새 값을 어느 이벤트가 싣는지 정해지지 않았다. 정하지 않으면 화면은 대화를 다시 조회하거나 직접 +1 해야 하고, "초안 없이 횟수만 센" 경우(블록 0개)를 화면이 알 길이 없다 → 칩·남은 횟수 표시가 서버와 어긋난다(서버가 막으므로 잘못된 실행은 없음, 표시 오류만).
- 담당: **ai-feature-designer**(이벤트 필드 이름 정함) → data-architect(7장 행에 반영)
- 수정 제안: 산출물 대화의 `draft_done`과 `turn_done`에 `draft_count`(정수)를 싣는다고 AI-13 응답 모드에 적고("초안 남은 횟수" 표현을 이 필드로 대체, 블록 0개로 끝난 초안 턴은 `draft_done` 없이 `turn_done`의 `draft_count`로 반영), DM 7장 "대화 턴" 행에 "산출물 대화는 `turn_done`에 `draft_count`"를 한 구절 추가. UX는 이미 `draft_count`로 계산하므로 출처 이벤트만 한 줄 덧붙인다.
- 상태: **해결 — 리더 수정(2026-11-03, 리뷰어 재검토 없음, grep 확인)**

### 참고 (이슈 아님)

- `03-ai-features.md` AI-13 "교체와 덧붙이기 (반영 방식, PA-1)" 머리의 `[가정 — ux 확인]` 태그는 UX S-44가 같은 규칙으로 맞춰 확인을 마쳤으므로 `[가정]`으로 낮추면 된다(동작 차이 없음, 다음 AI 명세 손질 때).
- PRD F-AP-06 제목 칸 "직접 입력(섹션 수정)으로 안내"는 본문 (2) "섹션 수정 또는 프로젝트 상세 페이지 입력"이 범위를 바로 적고 있어 구현 혼선은 없다.
- PA-3 저장 계약·`skipped` 6종·첫 메시지 순서·`stale_write`·폐기 이름 잔존 검사는 라운드 1 확인 결과가 수정 뒤에도 그대로다(수정분에서 폐기 이름의 현재형 재등장 없음).

### 최종 사용자 결정 목록 (통합, 중복 제거)

| ID | 질문 | 선택지와 권고 | 정본 | 상태 |
|----|------|---------------|------|------|
| **D-DM-12** | 저장하지 않은 폼 값(`form_snapshot`)을 AI 턴에 실어 사용자의 공급자로 보내는 것이 지금 고지·동의 범위에 드는가 | (a) 지금 범위 + 다음 고지 버전에 한 구절, 재동의 없음 **(권고, PRD·AI·DM 일치)** / (b) 새 고지 + 재동의 / (c) 보내지 않음 | DM 8장 (PRD 9.0, AI 8장, UX 5.2 참조) | `[결정 필요]` — 확정 전 구현은 (a) |
| **D-AI-16** | 독립 프로젝트 정보·내용(S-43)에도 AI 작성 대화를 둘까 | (a) MVP에 없음 유지 **(권고)** / (b) AI-13식 "내용 초안" 대화 | AI 8장 (PRD 9.0, DM 2.5, UX C-23 참조) | `[결정 필요]` — 명세는 (a) |
| **D-UX-28** | 독립 프로젝트 만들기도 이름 다이얼로그 없이 첫 저장 때 생성으로 바꿀까 | (a) 유지 — 지금 명세 / (b) 첫 저장 때 생성 **(UX 권고)** | UX 5.1f (PRD 9.0·9.5 가정 9 참조) | `[결정 필요]` — 명세는 (a) |
| D-14 | 모의 면접 점수 산정 방식 | 사용자 추후 정의 | PRD 9.0 | 기존, 이번 범위 밖 |
| D-39 | BYOK 공급자 전송의 국외 이전 해당 여부 | 법무 확인 | PRD 9.0 | 기존, D-DM-12와 함께 |
| 출시 전 운영 | D-10 고지 문구·버전, KMS 공급사 | — | PRD 9.0 | 기존. D-DM-12 (a)이면 D-10에 한 구절 |

네 문서의 열린 결정 목록(PRD 9.0 다섯 개 + 출시 전 2개)이 위 표와 같다.

### 다음 단계

- 리더: R-PA-14(ux-planner)·R-PA-15(ai-feature-designer → data-architect)를 Phase 5 정리 때 한 줄 수정으로 닫거나, 구현 착수 메모로 넘긴다. 둘 다 표시 규칙 문제이고 서버 검사가 잘못된 실행을 막는다.
- Phase 5 `decisions.md` 이관 항목은 라운드 1 "다음 단계"와 같다(PA-1~PA-4, 리더 정렬 1~4, R-PA-3 리더 판정, D-DM-12·D-AI-16·D-UX-28, CR-3·CR-6·CR-8·CR-19·D-UX-26 대체 표기).


## 리더 후속 (2026-11-03)

- R-PA-14: UX S-44 시작 영역 비고·초안 남은 횟수 행을 AI-12 칩 계산 규칙·AI-13 6회 규칙에 맞춤.
- R-PA-15: AI-13 `draft_done`·`turn_done`에 `draft_count`, DM 7장 대화 턴 행에 산출물 대화 `draft_count`, UX S-44 출처 이벤트 명시.
- 참고 항목: AI-13 `[가정 — ux 확인]` → `[가정]`.
- 최종: R-PA-1~15 모두 해결, 미해결 0.
