# R4 커리어 재설계 반영 (CR-1~CR-24) — 슬라이스 계획

- 기준 기획: 커밋 ccf3b26 — PRD v4.5, 유저 플로우 v5.5, AI 명세 v4.5, 데이터 모델(DM) v4.4, `decisions.md` 3.9
- 작업 목록의 원천: **DM 11장**(11.1 영향받는 객체, 11.2 이관 규칙). 이 계획은 그 표를 담당자별로 나눈 것이다. 표와 다르면 DM이 우선한다.
- 원격 개발 브랜치 적용: **안 함**(사용자 요청 없음). 로컬 `supabase db reset` + pgTAP까지.
- 커밋: 하지 않음(사용자 요청 시).

## 범위

### DB (db-engineer) — 새 마이그레이션 파일만 더한다(기존 파일 수정 금지). 접두사 `20261109…_r4_`
1. **기존 데이터 처리** `[가정]`: DM 11.2 권고대로 운영 데이터가 없으므로 커리어 하위·대화 데이터를 비우고 새 스키마로 시작한다 — `writing_chat_messages`, `writing_chats`, `project_details`, `achievements`, `project_skills`, `projects`와 이것에 걸린 `evidence_links`(source_type `project`/`project_detail`/`achievement`)·`draft_section_sources` 참조를 정리. 경력·교육·프로필·지원 프로젝트는 유지. `decisions.md`에 기록.
2. `projects` v4.4 (DM 2.3 projects): STAR 5컬럼, 분류 3종(종류 9개 단일·경험 유형 7개 단일·역량 10개 최대 3, PRD F-P1-19 값), `description`, `link_url`, `content_updated_at`, `is_current` + CHECK(`NOT is_current OR end_month IS NULL`), `summary`·`team_size` 삭제, `name` not null, `role` 필수 해제, DM-20 CHECK 3개, 경력·교육 FK cascade, 범위(소속↔독립) 변경 거부 트리거, `content_updated_at` 트리거, 완료 판정 컬럼 조건화, 독립 프로젝트 부분 인덱스.
3. `project_details`(+ 트리거, `reorder_project_details`)·`achievements` 삭제.
4. `project_skills` 독립 프로젝트 한정 트리거.
5. `project_deliverables` 신설(DM 2.3): RLS, 복합 FK, 독립 한정, 50개 상한 트리거, `updated_at`, `career_data_updated_at`, 근거 삭제 표시 트리거, `reorder_project_deliverables` `[가정]`, `app_ai_writer` select grant.
6. `career_data_updated_at` 트리거 대상 갱신.
7. `get_data_readiness` v4.4 (DM 6장, A18 내용 변경 포함).
8. `get_deletion_impact` / `delete_career_item` (DM 4.1, 11.1 행).
9. `evidence_links` CHECK·`private.evidence_links_check_source`·`private.evidence_mark_source_deleted` (DM 2.8, `project_deliverable`, `source_field` 목록, V-8 `project.learnings`, `source_snapshot_at` = `content_updated_at`).
10. `writing_chats` v4.4 (DM 2.5): 컬럼 변경, `project_id` not null + 소속 프로젝트 한정, `status` `active`/`closed`, 인덱스, 빈 초안 v3, 시작 인사 4종, `start_writing_chat(p_project_id, p_return_target)`.
11. 메시지 RPC: `closed` 거부, 첫 메시지 `title`, 상한 도달 시 `closed`.
12. `apply_structured_draft_patch` v3 (`project`·`star`·`classification`, `op` set/append, `applied_at`, 분류 키 걸러 내기·`reason`, `is_current` 패치 거부, V-9h, 사용자 패치 `closed` 허용). 상세 내용·성과용 `wc_*` 헬퍼 삭제.
13. `save_writing_chat`·`hand_off_writing_chat`·`set_writing_chat_affiliation`·`private.commit/finalize_writing_chat` 삭제 → 신규 `apply_writing_chat_proposal` (DM 3.3, 분류 반영·`classification_already_set` 건너뜀, `is_current` 제외, 2,000자 초과 거부 `field_too_long`, `needs_review` 건너뜀).
14. R1 재개 전이(`abandoned → active`)·사용자 `status` update grant 회수.
15. 서류: `draft_section_sources.project_detail_ids` 컬럼·트리거 삭제, 근거 선택 RPC 인자 정리.
16. 탈퇴 집계·삭제 RPC 테이블 목록.
17. 지원 프로젝트 기본 이름 "새 자기소개서 (날짜)" (CR-23 `[가정]`).
18. `purge_unlinked_writing_chats`·관련 인덱스 삭제.
19. pgTAP: DM 11.1 마지막 행의 테스트 갱신·추가. 삭제된 객체를 참조하는 기존 테스트는 고치거나 대체.
20. `database.types.ts` 재생성.

### API (api-engineer)
- `src/server/services/career/*`, `src/server/actions/career.ts`, `src/lib/contracts/*`: 프로젝트 v4.4 필드(STAR·분류·`is_current`·`description`·`link_url`), 독립/소속 구분, 섹션 단위 저장, 상세 내용·정량 성과 서비스·액션 삭제, 산출물 CRUD·정렬 신설(S-44), 프로젝트 이름만으로 만드는 작성 중 프로젝트(CR-6).
- `src/server/services/writing-chat/*`, `src/server/actions/writing-chat.ts`, 턴 SSE 핸들러: 프로젝트에 묶인 대화(여러 기록·새 대화·목록), `closed`, `apply_writing_chat_proposal` 호출, 저장·인계·소속 지정 경로 삭제.
- 삭제 영향·탈퇴 집계, 서류 근거 선택(상세 내용 인자 제거), 인사이트·면접 서비스의 상세/성과 참조 제거.
- 보관 정리 크론(`src/app/api/cron/retention`)에서 `purge_unlinked_writing_chats` 호출 제거.
- readiness 소비 코드: 힌트 이름·`suggested_mode` 삭제 반영.
- **배선(`src/lib/data/`, `src/types/db.ts`)**: 새 모델로 갱신. UI 화면(S-08·S-09·S-34·S-10·S-35·S-11·S-36)은 아직 옛 모델이고 UI 파일은 백엔드 팀이 고칠 수 없으므로, **UI가 import하는 옛 함수·타입은 지우지 말고 `@deprecated` 호환 껍데기로 남긴다**(옛 함수는 빈 결과나 "지원 안 함" 오류). 목표: `pnpm typecheck`·`pnpm build` 통과 유지. 새 화면(S-08 2단, S-10 패널, S-43, S-44)에 필요한 새 데이터 함수는 추가만 해 두고 "연결 대기"로 표시. 껍데기 목록을 notes에 남긴다(UI 재작업 때 지울 대상).

### AI (ai-pipeline-engineer)
- Career Context Pack(AI C-1 v4.5): STAR를 `PRJ-n` 필드로, `DET-n`·`ACH-n` 제거, 산출물 `DLV-n`, 소속 프로젝트 role·스킬 제외, 분류는 사실 근거 아님(팩에 넣는다면 표시용), 기간 표기 `is_current`(CR-22).
- 근거 검증(C-3, V-1~V-9): `project_detail`·`achievement` 제거, `project_deliverable` 추가, 숫자 가드를 결과/성과 서술 기준(V-5/V-9c), V-8 `project.learnings`, `evidence-rules.ts`, evidence_links 저장 매핑.
- AI-12(v4.5 패널): 출력 스키마(`structured-draft.ts`)를 v3 형식으로 — STAR `set`/`append`, `classification` 추천(빈 값만, 역량은 비어 있을 때만), `is_current` 제안 안 함, 시작 인사 4종, 빠른 칩(AI-12 표의 `requested_slot`). 프롬프트 `prompt_version` 올림, 픽스처 갱신.
- AI-02·03·04·05·06·11 프롬프트·픽스처에서 상세 내용·정량 성과 참조 제거.

### QA (backend-qa)
- 경계: DM v4.4 ↔ 마이그레이션 ↔ `database.types.ts` ↔ 서비스, RPC 시그니처 ↔ 호출부, AI-12 스키마 ↔ `apply_structured_draft_patch`·`apply_writing_chat_proposal`, `evidence_links` `source_type`·`source_field` DB CHECK ↔ TS, 분류 enum DB ↔ TS ↔ PRD F-P1-19, `src/lib/data` 호환 껍데기가 UI 빌드를 지키는지.
- `run-checks.sh` 전체(typecheck·lint·vitest·pgTAP) + `pnpm build`.

## 순서
1. db-engineer (마이그레이션 + 타입). 끝나면 2로.
2. api-engineer, ai-pipeline-engineer 병렬(background). ai는 순수 코드(검증기·스키마·프롬프트)를 먼저.
3. 각 모듈 끝나면 backend-qa 점진 검토 → 최종 라운드(최대 2).

## 이 슬라이스가 닿는 `[가정]`
- 기존 데이터 비우기(DM 11.2 권고)
- `reorder_project_deliverables` 존재(DM 11.1)
- 기본 이름 "새 자기소개서 (날짜)"(CR-23)
- 산출물 50개 상한(PRD F-P1-18)

## 연결(UI)
- 커리어 영역 UI는 옛 화면이다(screen-status: S-08 등). 새 화면은 `resumate-ui` 재작업 뒤 연결 → **연결 대기**. 이번에는 호환 껍데기로 빌드만 유지.
