# UI 브리프 — 프로젝트 상세 · 산출물 상세 (PA-1~PA-4)

- 작성: 리더 / 2026-11-03
- 사용자 요청: "화면 구현으로 넘어가자. ui 하네스 사용해서 진행해." — 직전 기획 사이클(PR j-hyunn/resumate#10) 결과를 화면으로 구현
- 기준 기획: **PRD v4.6 · 플로우 v5.6 · AI v4.6 · 데이터 모델 v4.5** (`docs/planning/`, 결정 `decisions.md` 3.9 CR-1~24 · 3.10 PA-1~4 + D-DM-12/D-AI-16/D-UX-28)
- 지금 화면 상태: `docs/ui/screen-status.md` 기준 기획은 PRD v4.4a / 플로우 v5.4a. S-08은 v5.5 2단 레이아웃까지 구현(`src/components/career/career-overview.tsx`, 산출물·종류 태그·Link는 아직 안 그림). **S-10은 아직 v4 편집 폼**(`project-form.tsx`, `projects/[id]/details/*` = 폐기된 상세 내용). S-44 없음. AI 작성 대화는 v4 별도 화면(`career/writing-chats/*`, S-36 — 폐기).

## 이번 범위

| ID | 내용 | 기획 위치 |
|----|------|-----------|
| L-02 | 전체 페이지 셸(왼쪽 메뉴 없음): 로고 · [Resumate AI] 다시 열기(패널 닫혔을 때만) · "저장하기" · 계정 아이콘, 이동 줄(← + 이동 경로), 저장하기 상태, 페이지 단위 이탈 확인·입력 보존 | UX 1.3a |
| S-10 | 프로젝트 상세(경력·교육 소속) 전체 재구현: 빈 새 페이지(`/career/projects/new?experience=|education=`), 머리 5필드 상시 입력(종류·경험 유형·역량 최대 3·기간·진행 중), STAR 5칸 입력, 페이지 단위 저장(`save_project_page`), 오른쪽 Resumate AI 패널(AI-12: 대화 기록·새 대화·⋯·×, 빠른 버튼 칩, 메시지, STAR 제안 카드 — [반영] = 폼 채우기, "폼에 채움 · 저장 전" 상태, `p_applied_proposals`), 너비 조절, 첫 AI 메시지 순서(이름 확인 → AI 사용 가능 → 페이지 저장 → 대화 시작 → 턴) | UX S-10, FL-05·FL-14, AI-12 |
| S-43 | 독립 프로젝트 패널의 **산출물 섹션**(행 목록, "+ 산출물 추가", 50개 상한, 빈 상태) | UX S-43 |
| S-44 | 산출물 상세 신규: L-02, 이동 경로 "{프로젝트명} › {산출물 제목} › 산출물 상세", 제목 입력, 마크다운 본문, G-2 안내, ⋯ 삭제, Resumate AI 패널(AI-13: 블록 단위 초안 카드 — [본문 교체]/[뒤에 덧붙이기]/[본문에 넣기], `needs_review` 블록 [수락]/[빼기], 출처 칩, `missing_slots`, 초안 남은 횟수) | UX S-44, FL-22, AI-13 |
| C-23 | 범위 축소: 소속 프로젝트 "+ 프로젝트 추가"는 다이얼로그 없이 S-10 새 페이지로. C-23은 C-22 독립 프로젝트 이름 입력, C-09·S-16 소속 선택에만 | UX C-23 |
| 칩 | `quickChips(state)` 공유 상수·순수 함수(AI-12·AI-13 칩 표) | AI-12 "빠른 버튼 칩 계산 규칙" |
| 정리 | v4 S-36 별도 대화 화면, `projects/[id]/details/*`, `project-form.tsx` 등 폐기된 경로 정리(링크는 새 화면으로 redirect) | UX 사이트맵 |

## 데이터 계층 (중요)

- 백엔드는 **DM v4.4까지 구현**됨: `src/lib/data/career-v44.ts`, `writing-chats-v44.ts`, `src/server/actions/career.ts`(`createProject`, `saveProject`, `saveDeliverable`, …). 이 모듈은 "연결 대기"로 아직 화면이 안 씀.
- DM **v4.5 계약**(`save_project_page`, `save_project_deliverable`, `start_writing_chat(p_form_snapshot)`, `start_deliverable_writing_chat`, 턴 요청 `form_snapshot`, `turn_done.draft_count`, AI-13 `draft_*` 이벤트, `p_applied_proposals`, `stale_write`, `skipped` 6종)은 **백엔드에 아직 없다**(후속 `resumate-backend`, DM 11.3).
- 그래서: 화면은 **v4.5 계약 이름 그대로의 데이터 계층 함수**(`saveProjectPage`, `saveProjectDeliverable`, `startDeliverableWritingChat`, …)만 부른다. 구현은 (1) v4.4 백엔드로 같은 결과를 낼 수 있으면 그걸로 잇고(예: 페이지 저장 = createProject/saveProject 조합, 산출물 저장 = saveDeliverable), (2) 없으면 mock(`?state=` 미리보기 포함)으로 두고 `// 연결 대기 (DM v4.5 11.3)`로 표시. 반영됨 기록(`p_applied_proposals`)과 산출물 AI 대화(AI-13)는 mock.
- 실제 Supabase·AI 호출을 새로 만들지 않는다(백엔드 범위).

## Figma

파일 `GagTxDayknEFEa6qdSqQCc`. `1034:8565` 근무 › 프로젝트 추가, `1041:8783` 교육,연수 › 프로젝트 상세, `1041:8904` 산출물 상세. Figma MCP는 이 세션에서 **Starter 플랜 호출 한도에 걸렸다** — 한 번 시도해 보고 실패하면 아래 관찰로 대신한다.

리더 관찰(1440×1045 프레임):
- 상단 바(셸 밖, 배경 연한 민트 그레이): 왼쪽 ResuMate 로고(녹색 마크 + 워드마크), 오른쪽 녹색 채움 버튼 "저장하기"(radius 약 8, 높이 약 36) + 사람 아이콘.
- 본문은 흰 카드(radius 약 16, 화면 가장자리 8px 여백). 카드 안 왼쪽 위: 둥근 회색 "←" 버튼 + 이동 경로 "{커리어명} › {프로젝트 명} › 프로젝트 상세"(14px).
- 제목 "{프로젝트 명}" 20px bold. 머리 행: 왼쪽 라벨(회색 13px, 폭 약 100) + 값. 값은 회색 채움 칩 드롭다운("전체 전형 ⌄")과 테두리 셀렉트(연도 ⌄ / 월 ⌄ ~ 연도 ⌄ / 월 ⌄) + 체크박스 "진행 중".
- 구분선 뒤 본문 2단: 왼쪽 STAR(제목 "상황  Situation" 16px medium + 회색 플레이스홀더 15px, 섹션 간격 약 90px) | 세로 손잡이(회색 막대) | 오른쪽 패널(폭 약 420, 연회색 배경, radius 12): 머리 "Resumate AI" + 목록·+·⋯·× 아이콘, 아래쪽 칩 3개(회색 채움 pill) + 입력창(흰 pill, 플레이스홀더 "Resumate AI에게 물어보세요", 녹색 원형 전송 버튼).
- 산출물 상세: 같은 셸·패널, 머리에 분류 드롭다운(PA-2로 그리지 않음), 왼쪽은 본문 한 칸.

## 기획 확인 경로

명세에 없는 것은 `[UI-가정]` + 보고서 "기획 확인 필요". `docs/planning/` 수정 금지.
