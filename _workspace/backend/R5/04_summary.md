# R5 요약 — 프로젝트 추가·산출물 상세 반영 (PA-1~PA-4)

- 기준 기획: PRD v4.6, UX v5.6, AI v4.6, DM v4.5 (기획 세션 `claude/career-project-add-ui-review-49b7c0`의 미커밋 문서를 이 브랜치로 복사)
- 상태: **done** (2026-11-03). Critical 0 / Major 0. QA 2라운드.

## 만든 것
- **DB** (새 마이그레이션 7개 `20261110000100`~`000700_r5_*`)
  - `writing_chats.project_deliverable_id`(복합 FK cascade, CHECK, 인덱스), `writing_chats_check_target`, 산출물 시작 인사 3종, `start_writing_chat(p_form_snapshot)`, `start_deliverable_writing_chat` 신설
  - `apply_structured_draft_patch` v4: `rev`, `new_object`, V-9h 낮춤만, 산출물 op(`add_facts`·`replace_draft`·`count_draft` 등), `draft_count` ≤ 6
  - `apply_writing_chat_proposal` 삭제 → `private.wc_mark_proposal_applied`
  - `save_project_page`·`save_project_deliverable` 신설(`stale_write`, `applied`/`skipped`)
  - `projects.updated_at` 출처만 바뀔 때 유지, 삭제 영향 `cascade.writing_chats`, 블록 모양 강제(QA)
- **AI**: AI-12 `form_snapshot` 기준 판단·`rev`·`new_object`(prompt v4), AI-13 파이프라인 신설(사실 정리·초안·V-10a~h·재생성 1회·교체/덧붙이기 미리보기 함수)
- **API**: 페이지 저장 액션 2개·zod 계약, 반영 액션 제거, 산출물 대화 시작·목록·블록 편집, 턴 라우트 `formSnapshot`/`requestedAction`/`style`, 대상별 AI-12/AI-13 분기, 오류 코드 정리, `src/lib/data/page-save-v45.ts`(연결 대기)

## 검사
typecheck·lint 통과 / vitest 117파일 1,905건 / pgTAP 53파일 2,602건 / `pnpm build`(로컬 env) 통과 / UI 소유 파일 변경 없음.

## 남은 것
- QA-R5-04: 옛 커리어 껍데기가 산출물 대화를 STAR 대화로 취급 — S-44 연결 때 처리(현재 영향 없음).
- 연결 대기: S-10 페이지 저장, S-44 산출물 상세(UI 재작업 필요, `resumate-ui`).
- 기획 확인: `spec-gaps.md`의 R5-DB-1~13, R5-AI-1~5, R5-API-1~9, R5-QA-1.
- 열린 결정 3건은 2026-11-03 사용자 확정(D-DM-12 (a), D-AI-16 (a), D-UX-28 (a) 유지)과 구현이 일치한다. 남은 `[가정]`: AI 상한 값.

## 연결 (2026-11-04, 리더 직접 — 배선 단계만)

- `src/lib/data/career-v45.ts` 실제 경로를 v4.4 브리지에서 DM v4.5로 교체: 페이지 저장 `save_project_page`·`save_project_deliverable`(반영 기록 `applied`/`skipped`는 RPC 판정 그대로), `start_writing_chat(p_form_snapshot)`, `start_deliverable_writing_chat`, 산출물 상세 대화 목록·열린 대화, 대화 열기(대상별), 카드 패치(사실 수락·거절, 블록 수락·빼기), 턴 요청 본문(`requestedSlot`·`requestedAction`·`style`·`formSnapshot`, 다시 보내기도 같은 옵션).
- 새 순수 모듈 `career-v45-save.ts`(화면 snake_case ↔ 계약 camelCase, 오류 매핑) + 테스트. `career-v45-bridge.ts`·테스트 삭제.
- `writing-chat-turn-v45.ts`: AI-13 SSE(`facts_patch`·`draft_started`·`draft_block`·`draft_done`·산출물 `draft_flags`/`turn_done`) 파싱, 저장된 산출물 초안(목록 항목·표 행 객체) → 화면 모양 변환기 + 테스트.
- `backend_pending` 경로 제거: 데이터 계층 타입·문구, UI 소유 파일 최소 수정(아래).
- QA-R5-04 해결: `services/career/rows.ts` 옛 껍데기 대화 목록 2곳에 `project_deliverable_id is null`.
- `bodyHash`를 서버 계산(정규화 없음)과 맞춤(R5-W-2). 새 스펙 차이 R5-W-1~3(`spec-gaps.md`).

### UI 소유 파일 수정 (Minimal UI edits)
- `src/components/career/ai-panel/use-ai-panel.ts`: `backend_pending` 블록 종류·분기·토스트 분기 삭제(더 이상 생기지 않는 코드).
- `src/components/career/ai-panel/panel-input.tsx`: `backend_pending` 안내 Alert 삭제.

### 확인
- 브라우저 확인 안 함(로컬 로그인 Google 전용). 실제 AI-13 턴·페이지 저장은 단위 테스트(매핑·SSE 파싱)와 기존 통합 테스트(서비스·RPC) 기준.
