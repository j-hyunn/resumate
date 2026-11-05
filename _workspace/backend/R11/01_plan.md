# R11 열린 결정 일괄 확정(OD-*) 백엔드 후속 — 계획

- 입력(정본): DM v4.11 11.6 #1~#15, 2.7.2, A.12(점수 산식), 7장 / decisions.md 3.18·4.12 / AI v4.11 4.3 / `_workspace/00_input/planning-decisions-open-decisions.md`
- 브랜치: `claude/od-backend-followups-ba655d` (PR #46 기획 브랜치에서 갈라짐)
- UI 화면 코드(`src/app` 화면, `src/components`)는 건드리지 않는다. 병렬 세션 `od-ui`가 한다. `src/lib/data/`도 UI가 바꾼다(데이터 계층 `getApplicationDeletionImpact`·`p_client_id` 생성·해시 공통 함수 호출). 백엔드는 서버 측과 공유 모듈만 만든다.
- 원격 Supabase 적용·배포 금지. 로컬 Supabase는 다른 worktree와 공유된다.

## 범위

### DB (db-engineer) — 새 마이그레이션, 기존 파일 수정 금지, `20261113000400`보다 뒤 번호
1. OD-I6 (#1~#5)
   - `interview_sessions.application_project_id` drop not null, FK `interview_sessions_application_project_fkey` → `on delete set null (application_project_id)`(복합 FK면 PG15+ 컬럼 지정 문법), `company_name_snapshot`·`position_title_snapshot` text null ≤ 200자 CHECK, CHECK `interview_sessions_detached_check`(`application_project_id is not null or status = 'completed'`)
   - `evidence_links.application_project_id` drop not null, CHECK(null이면 `owner_type` ∈ 면접 3종)
   - 트리거 `private.application_projects_detach_interviews()` BEFORE DELETE 행 트리거(security definer): completed 세션에 JD 회사명·포지션명 복사 → 그 세션 근거 `application_project_id` null → 비완료 세션 delete(기존 작업 취소 트리거). 잠금 순서 프로젝트 → JD → 세션 → 근거 → 작업
   - 읽기 전용 가드: `begin_interview_evaluation`·세션 복사 생성 RPC 등 세션 쓰기 RPC가 `application_project_id is null`이면 `interview_session_read_only`, `private.interview_grading_decision` = `none`
   - `get_deletion_impact`: `entity_type = 'application_project'` 추가(`{cascade: {insights, drafts, interview_sessions, stage_events}, kept: {interview_sessions}}`), 커리어 종류 `affected_results.detached_interview_sessions`
   - 탈퇴(`delete_account`)·장기 미접속 파기는 전부 삭제되는지 확인(CHECK·트리거가 막지 않게)
2. OD-I1 (#7·#8): 헬퍼 하나로 `d14.v1`(가중 30·30·20·20, 등급 100/75/50/25, `not_applicable` 재배분, round .5 올림, 미응답 0점·rationale "미응답 · 0점", 채점 실패 제외, 모두 미응답 = 세션 `scored` 0점 "질문 N개 모두 미응답, 0점", 응답 있고 scored 0개 = `not_scored`, 질문·세션 `score_rationale` 서버 문구 — AI 4.3). `save_answer_evaluation`·`complete_interview_evaluation`·`submit_interview_session`(응답 0개 분기) 교체. 백필 `backfill_interview_scores(p_limit integer default 500)` service_role만, 멱등, skip locked, 반환 `{sessions, answers}`. 원격 실행 안 함(운영 단계)
3. OD-C6 (#9): `save_project_page`·`save_project_deliverable` 마지막 인자 `p_client_id uuid default null`(기존 함수 drop 후 생성). 만들기에서만: 같은 사용자 행 있으면 고치기 경로(같은 요청 반복 → `already_applied` 등 기존 반환 규칙), 없으면 그 id로 insert, 남의 행과 충돌 → `not_found`
4. OD-P11 (#11): `begin_assistant_message`가 "마지막이 사용자 메시지·뒤 assistant 없음"에 새 assistant 행을 받는지 확인, 필요하면 교체. 상한·진행 중 턴 검사 그대로
5. OD-L2·L2a (#12): `ai_disclosures` `v2026-11-05` 6행 insert — `requires_reconsent` = anthropic만 true, `requires_free_tier_ack` = gemini free만, `document_path`, `terms_checked_at = '2026-11-05'`
6. pgTAP 전부 + `database.types.ts` 재생성

### API (api-engineer)
- 순수 코드(바로 시작): #10 해시 공통 함수(DM 2.5.0 규칙, 서버 `deliverable-chat.ts`가 사용, 화면이 import할 수 있게 `src/lib/` 공유 모듈 — `career-v45-shared.ts` 교체는 UI), #11 `turn.ts` `retryTarget` 확장 + 테스트, #13 `EnvKms` 주석, #15 확인(대화 상세 DTO가 작업 상태 포함)
- DB 뒤: #4 오류 매핑 `interview_session_read_only`(409)·zod, #6 `services/interview/read.ts` left join·복사 이름·`read_only` 플래그, #9 서버 액션·zod `p_client_id` 받기, #5 서비스 측 `getDeletionImpact('application_project')` 타입, #7 `job.ts` 점수 주석·`score_overridden` 정리, `services/evidence` null 프로젝트 견딤
- `src/lib/data/` 안 고침(UI 소관) — 단 typecheck가 깨지면 최소 수정 후 보고

### QA (backend-qa): 경계면 + `run-checks.sh`(typecheck·lint·vitest·pgTAP)

## 릴리스 영향
- 파괴적 변경 없음(행·컬럼 삭제 없음). OD-I6는 FK 동작 변경 → 원격 반영 전 확인 표시. 새 env 없음
- UI와 같은 배포: `save_project_*` 시그니처(기본값 있음, 호환), 고지 v2026-11-05(Claude 재동의 — 고지 본문 상수가 같은 배포여야 함)
- 배포 직후 `backfill_interview_scores` 반복 실행(운영 체크리스트)
