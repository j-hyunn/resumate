# R5 프로젝트 추가·산출물 상세 반영 (PA-1~PA-4) — 슬라이스 계획

- 기준 기획: PRD v4.6, 유저 플로우 v5.6, AI 명세 v4.6, 데이터 모델(DM) v4.5, `decisions.md` 3.10·4.4. 원문 결정 `_workspace/00_input/planning-decisions-project-add-figma.md`
  - 기획 세션 브랜치(`claude/career-project-add-ui-review-49b7c0`)에서 아직 커밋 전인 문서를 이 워크트리에 복사해 쓴다(내용 동일).
- 작업 목록의 원천: **DM 11.3** 표. 이 계획은 그 표를 담당자별로 나눈 것이다. 표와 다르면 DM이 우선한다. 이름은 **DM 3.7 이름 확정**을 따른다(AI·UX 문서의 옛 가칭 금지).
- 원격 개발 브랜치 적용: **안 함**. 로컬 `supabase db reset` + pgTAP까지.
- 커밋: 하지 않음(사용자 요청 시).

## 범위

### DB (db-engineer) — 새 마이그레이션만 더한다(기존 파일 수정 금지). 접두사 `2026111000…_r5_`
DM 11.3 표의 DB 행 전부. 명세 위치: DM 2.5(writing_chats v4.5), 2.5.0(산출물 `structured_draft`), 2.5.1(페이지 저장 RPC), 3.3(반영 경로), 3.7(이름), 4.1(삭제 영향), 7장(경계·첫 메시지 순서).
1. `project_deliverables`에 `unique (id, project_id, user_id)`.
2. `writing_chats.project_deliverable_id` + 복합 FK cascade, `CHECK (project_deliverable_id IS NULL OR return_target IS NULL)`, 부분 인덱스, 트리거 `writing_chats_check_target`로 교체, 가드에 대상 열 불변, 빈 초안 대상별, 산출물 시작 인사 3종, `start_writing_chat`에 `p_form_snapshot`(인사 분기만, 저장 안 함), **`start_deliverable_writing_chat` 신설**.
3. `apply_structured_draft_patch`: 필드 `rev`(슬롯 단조, 없으면 1), `new_object`(`app_ai_writer`만), V-9h `set → append` 낮춤만·기간/분류 DB 거부 삭제(`classification_already_set` 제거), 대상별 패치 범위(`invalid_patch`), 산출물 모양(사실·초안 교체·블록 빼기·`draft_count` ≤ 6 → `writing_chat_draft_limit_reached`).
4. **`apply_writing_chat_proposal` 삭제**(grant 포함). 헬퍼 `private.wc_mark_proposal_applied(p_writing_chat_id, p_target_kind, p_target_id, p_field, p_rev, p_mode)`.
5. **`save_project_page`**, **`save_project_deliverable`** 신설(DM 2.5.1 전체: invoker, 만들기·고치기, 거부 코드, `p_expected_updated_at` → `stale_write`, 원소별 예외 블록으로 반영됨 기록 → `skipped`, `projects.source_writing_chat_id`, 반환 모양). `authenticated`만 execute.
6. `projects` `updated_at` 트리거: `source_writing_chat_id`만 바뀐 update는 유지.
7. `get_deletion_impact` / `delete_career_item`: 산출물·독립 프로젝트의 `cascade.writing_chats`.
8. 탈퇴 집계: 산출물 대화 포함 여부 확인(행 기준이면 그대로).
9. 오류 코드 신설분은 DM 2.5.1·2.5.0 표 그대로.
10. pgTAP: DM 11.3 pgTAP 행 전부. `apply_writing_chat_proposal`을 쓰던 기존 테스트는 새 경로로 대체.
11. `database.types.ts` 재생성.

### API (api-engineer)
- `src/server/services/career/*`, `src/server/actions/career.ts`, `src/lib/contracts/*`: 페이지 저장 액션 2개(`save_project_page`·`save_project_deliverable` 호출, zod 계약, `stale_write`·`skipped` 응답 매핑, 오류 코드 `src/server/db/errors.ts`).
- `src/server/services/writing-chat/*`, `src/server/actions/writing-chat.ts`, 턴 SSE 라우트:
  - 반영 액션 제거(`apply_writing_chat_proposal` 호출 경로 삭제).
  - 산출물 대화 시작(`start_deliverable_writing_chat`), `start_writing_chat`에 `p_form_snapshot`.
  - 턴 요청에 `form_snapshot` zod 계약(S-10: 머리+STAR, S-44: `{title, body}`), 길이 검사, **로그·DB에 저장하지 않음**. AI 파이프라인에 넘김.
  - 첫 메시지 순차 호출(DM 7장: 페이지 저장 → 대화 시작 → 턴)은 화면이 순서대로 부르므로, 서버는 각 단계 액션을 제공하고 계약을 notes에 적는다.
  - 대상별 파이프라인 분기: 프로젝트 대화 → AI-12, 산출물 대화 → AI-13. `call_key` `…compose`, `progress.stage` `compose`·`validate`, 미터 `feature = writing_chat`.
- 삭제 영향 소비 코드: `cascade.writing_chats` 반영.
- **배선(`src/lib/data/`, `src/types/db.ts`)**: S-10 새 페이지·S-44 화면은 아직 없다(UI 재작업 전). UI가 import하는 옛 함수·타입(예: `writing-chats.ts`의 반영 관련)은 지우지 말고 `@deprecated` 호환 껍데기로 둔다(R4와 같은 방식). 새 데이터 함수는 추가만 하고 "연결 대기". `pnpm typecheck`·`pnpm build` 통과 유지. 껍데기 목록을 notes에.

### AI (ai-pipeline-engineer)
명세: AI 0.v46, AI-12(647~), **AI-13(856~)**, C-1·C-1.1, C-3, C-11~C-14.
- AI-12 v4.6: 현재 값은 `form_snapshot` 우선(없으면 DB 값). V-9h·빈 값·분류 추천 판단을 스냅숏 기준으로. 필드 `rev`, `new_object` 판정. 덧붙임 규칙은 화면 채우기 단계로 옮겨졌으므로 서버 패치 쪽은 DM 2.5와 맞춘다. `prompt_version` 올림.
- **AI-13 파이프라인 신설**: 질문 턴(사실 정리 + 응답 병렬), 초안 턴(사실 정리 → 초안 작성, 고정 문구 메시지), 산출물 종류 5개 슬롯, 입력 컨텍스트(사실·스냅숏 본문·부모 독립 프로젝트·형제 산출물 제목만), 출력 스키마(`structured_draft` 산출물 모양, DM 2.5.0), **V-10a~h** 검증과 30% 초과 탈락 시 1회 재생성, `basis` new/current_body, 6,000자 초과 시 교체 금지(`replace_allowed`), `base_body_hash`, 초안 8,000자, 대화당 6회. SSE `facts_patch`/`draft_*` 이벤트. 픽스처 기반 테스트, 평가 세트 골격.
- 시작 인사·칩: 칩은 화면이 계산(AI 0.v46 확인), 서버는 인사 분기만.
- `src/server/ai/schemas/structured-draft.ts`, `evidence-rules.ts`, `storage/evidence-links.ts`: 산출물 대화 출처 매핑(근거 원본이 아닌 점 확인).

### QA (backend-qa)
- 경계: DM v4.5 ↔ 마이그레이션 ↔ `database.types.ts` ↔ 서비스, 새 RPC 시그니처 ↔ 호출부, AI-12/AI-13 스키마 ↔ `apply_structured_draft_patch`(산출물 모양·`rev`·`draft_count`), SSE 이벤트 이름 API ↔ AI, `apply_writing_chat_proposal` 참조 0건(호환 껍데기 제외), `form_snapshot`이 로그·DB에 남지 않음, 오류 코드 DB ↔ TS.
- `run-checks.sh` 전체(typecheck·lint·vitest·pgTAP) + `pnpm build`.

## 순서
1. db-engineer(마이그레이션 + 타입). 동시에 ai-pipeline-engineer가 순수 코드(AI-13 스키마·V-10 검증기·프롬프트) 시작.
2. db 끝나면 api-engineer 시작. ai는 저장 매핑·서비스 연결.
3. 모듈마다 backend-qa 점진 검토 → 최종 라운드(최대 2).

## 이 슬라이스가 닿는 `[가정]` / 열린 결정
- D-DM-12: `form_snapshot` 전송은 현 고지 범위로 본다(권고 (a)) `[가정]`.
- D-AI-16: 독립 프로젝트 정보·내용에는 AI 대화 없음(권고 (a), 현행) `[가정]`.
- D-UX-28: 독립 프로젝트 생성은 C-23 이름 다이얼로그 유지(현행 명세 (a)) — 백엔드 기존 생성 경로 그대로.
- AI 상한 값(초안 6회, 8,000자, 교체 허용 6,000자)은 명세 `[가정]` 그대로.

## 연결(UI)
- S-10(페이지 저장)·S-44(산출물 상세+AI 패널)는 UI 재작업 전 → **연결 대기**. 호환 껍데기로 빌드만 유지.
