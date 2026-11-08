# R14 — AI 모의 면접 MVP 제외 (remove-mock-interview, RM-1~RM-5)

- 작성: 2026-11-08 (리더)
- 기획 근거: `docs/planning/decisions.md` 3.26·**4.20**, `docs/planning/04-data-model.md` **11.9**(단계별 SQL 순서·함수 이름·교체 RPC의 현재 정의 파일), 결정 입력 `_workspace/00_input/planning-decisions-remove-mock-interview.md`. 문서: PRD v4.16 / UX v5.19 / AI v4.14 / DM v4.14
- 법무 원문: `docs/legal/{privacy-policy,terms-of-service,cross-border-transfer,ai-data-use}.md` (2026-11-08판, 리더가 고침)

## 1. 범위

**지운다**: AI 모의 면접 전체(질문 생성 AI-05, 답변 평가 AI-06, 세션 종합 AI-07), 면접 테이블 5개, 면접 RPC·트리거·정책·grant, 면접 API·액션·작업 실행기 분기, 지원 단계 `job_interview`·`culture_fit_interview`.
**남긴다**: 커리어·AI 작성 대화·지원 프로젝트·JD·인사이트(AI-01·AI-02)·서류(AI-03·AI-04·AI-11)·AI-12·AI-13, D-01 게이트, 데이터 충분성 `ok`/`thin`(AI-02 출력).

## 2. 팀원별 할 일

### db-engineer (먼저)
1. 새 마이그레이션 `supabase/migrations/20261113003000_r14_remove_mock_interview.sql` — **첫 줄 `-- DESTRUCTIVE:`**. DM 11.9 (1)의 0~9단계와 (2)의 RPC 교체를 **한 파일·한 트랜잭션**으로, 순서: ⓪ 가드(RM-4) → (2) RPC 교체 전부(면접 헬퍼를 부르지 않는 새 정의) → ① 다른 테이블 트리거 2개 → ② `evidence_links` 면접 행 → ③ `ai_usage_records`·`ai_jobs` 면접 행 → ④ 전형 이력 면접 행(RM-5) → ⑤ `return_target` null → ⑥ 테이블 5개 drop(cascade 없이) → ⑦ 함수 44개 drop → ⑧ CHECK 9개 재정의 → ⑨ `evidence_links_detached_check` drop + `set not null`.
   - 이름·시그니처는 **반드시 로컬 DB에서 확인**(`pg_proc`, `pg_trigger`, `pg_constraint`)하고 DM 11.9와 다르면 DB 실물을 따르고 노트에 적는다.
   - drop 뒤 `pg_proc`·`pg_class`·`pg_trigger`·`pg_policy`에 `interview` 이름이 남지 않는지 확인 쿼리.
2. `policy_versions`: **원격 미반영 `20261113002900_policy_versions_2026_11_08.sql`에** `('terms','2026-11-08','2026-11-08 00:00:00+09',false,'/policies/terms/2026-11-08')`, `('cross_border_transfer','2026-11-08','2026-11-08 00:00:00+09',false,'/policies/cross_border_transfer/2026-11-08')` 2행과 머리 주석(RM-1, 재동의 없음)을 더한다. privacy·ai_data_use 주석에 "RM-1 면접 서술 삭제를 같은 판에 합침" 한 줄.
   - **원격 미반영인지 먼저 확인**: Supabase MCP `list_migrations`(읽기 전용) — 이미 원격에 있으면 고치지 말고 새 파일로.
3. pgTAP: `interviews.test.sql`·`interview_grading.test.sql`·`interviews_career_deletion.test.sql` 삭제, DM 11.9가 나열한 20개 파일에서 면접 단정 정리(테스트 `plan(n)` 수 맞춤), 새 단정 파일 `supabase/tests/r14_remove_mock_interview.test.sql`(면접 객체 부재, stage/이력 CHECK 4값 거부, `job_type` 9값·`feature` 8값, readiness `features` 키 2개·`data_sufficiency` 없음, `move_application_stage` 반환에 `interview_prompt` 없음, 지원 프로젝트 삭제 영향 키, `delete_account_data` 정상 동작). 가드는 픽스처로 "면접 단계 행이 있으면 멈춘다"를 확인할 수 있으면 노트에 방법을 적는다.
4. `supabase db reset` → pgTAP 전체 통과 → `src/server/db/database.types.ts` 재생성.

### api-engineer (db 타입 뒤)
- 삭제: `src/server/services/interview/**`, `src/server/actions/interview.ts`, `src/server/interview-routes.ts`, `src/server/jobs/interview.ts`, `src/app/api/interview-sessions/**`, `src/app/api/application-projects/[id]/interview-sessions/**`, `src/lib/contracts/interview.ts`.
- 정리: `src/lib/contracts/enums.ts`(`APPLICATION_STAGES` 4값, `INTERVIEW_STAGES` 삭제, job_type 9·feature 8·source/owner/progress/return_target 면접 값, 면접 enum 블록), `contracts/{account,ai,application,career,evidence,routes}.ts`, `src/server/jobs/{definitions,cost,status}.ts`, `src/server/services/{account,application,career,evidence,insight,shell,writing-chat}/*`, `src/server/db/errors.ts`, `src/server/mail/inactivity-notice.ts`(면접 문구가 있으면), 해당 테스트.
- 데이터 계층(이미 연결된 함수, 백엔드 소유): `src/lib/data/interviews*.ts`·`interview-*.ts` 삭제, `src/lib/data/{account,actions,ai-errors,ai-jobs,applications*,board-real,deletion,evidence*,labels,readiness,shell,usage-display,writing-chat-view}.ts`의 면접 분기·필드 제거, 사용량 표시 매핑 5행. `src/types/db.ts` 면접 re-export 제거. **내보낸 이름 중 화면이 쓰는 것을 지우면 화면이 깨진다 — 그건 R14 뒤 UI 런이 화면을 지우므로 허용하되, 지운 export 목록을 노트에 "UI 요청"으로 남긴다.**
- `src/components/account/policy-content.ts`(UI 소유지만 법무 본문 동기화 — Minimal UI edits 예외로 리더 허용): `POLICY_DOCUMENTS.terms`·`cross_border_transfer`·`privacy`, `AI_DATA_USE_SECTIONS`를 `docs/legal/` 2026-11-08판과 **문장 단위로 일치**시킨다(버전·시행일 포함). 노트 "UI 소유 파일 수정"에 적는다.

### ai-pipeline-engineer (api와 병렬)
- 삭제: `src/server/ai/pipelines/AI-0{5,6,7}*`, `prompts/AI-0{5,6,7}/`, `schemas/AI-0{5,6,7}.ts`, `schemas/interview-common.ts`, `storage/interview.ts`, `validation/interview*.ts`, `context-pack/interview.ts`, `__fixtures__/S8/`.
- 정리: `evidence-rules.ts`(`interview_answer`·면접 소유자), `storage/evidence-links.ts`, `validation/evidence.ts`, `context-pack/{focus-slots,total-experience}.ts`, `prompts/AI-12/index.ts`(복귀 대상 `job_interview`만 — 역할 문구 "면접 코치"는 AI 명세가 유지 `[가정]`), `services/writing-chat/pipelines.ts`와 겹치면 api와 조율.
- **공통 system 블록 `common.v3` → `common.v4`**: 자리 표시 `[사례 입력 필요]` 제거(6 → 5종, AI C-4·C-5). 각 기능 `prompt_version`의 공통 부분이 바뀌는 방식은 기존 규칙을 따르고 노트에 적는다.
- 테스트·픽스처 정리, `pnpm vitest run src/server/ai` 통과.

### backend-qa (각 모듈 뒤)
- 경계: DM 11.9 ↔ 마이그레이션 ↔ `database.types.ts` ↔ `enums.ts`(CHECK 목록 대조: stage 4, job_type 9, feature 8, evidence source/owner, return_target 3), 교체 RPC 호출부 ↔ 시그니처, readiness 응답 ↔ `src/lib/data/readiness.ts`, `move_application_stage` 반환 ↔ 호출부, `delete_account_data`·탈퇴·장기 미접속 경로, `policy-content.ts` ↔ `docs/legal/` 문장 대조, `grep -rni "interview" src/server src/lib/contracts src/app/api supabase` 잔존 0(정당한 잔존은 근거).
- `run-checks.sh`(typecheck / lint / vitest / pgTAP). **typecheck·build 오류가 UI 소유 파일(`src/app/(dashboard)/**`, `src/components/**`, `src/lib/mock/**`)에서만 나면 R14의 "UI 요청"으로 분류**하고 백엔드 소유 파일 오류는 이슈로 올린다.

## 3. 릴리스 영향
- **파괴적**: `20261113003000` — 면접 테이블 5개와 그 데이터, `ai_jobs`·`ai_usage_records`·`evidence_links`·전형 이력의 면접 행. **되돌릴 수 없다.** push 전 운영자 덤프 권고.
- 새 환경 변수 없음.
- **UI와 같은 머지 필수**: 마이그레이션이 면접 RPC를 지우므로 면접 화면 코드가 남은 채 배포되면 깨진다. 순서: R14 + UI 런(면접 화면 제거) 같은 브랜치 → 사용자 `supabase db push`(`20261113002900`, `20261113003000`) → main 병합.
- 프롬프트 `common.v4`로 동일 입력 재사용이 한 번 끊긴다.

## 4. 연결(UI)
- 면접 화면은 지우는 대상이라 연결할 함수 없음. 지운 export 목록 → UI 런의 입력(`_workspace/backend/R14/02_api_notes.md` "UI 요청").

## 5. 이 슬라이스가 쓰는 `[가정]`
RM-A1(공통 요소 처리), RM-A2(면접 사용량 행 삭제 → 이번 달 합계 감소), `return_target` null 처리, `common.v4`, 옛 주소 리다이렉트(UI 몫).
