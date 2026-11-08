# R14 요약 — AI 모의 면접 MVP 제외 (2026-11-08)

## 만든 것
- **마이그레이션 2개 (원격 미반영)**
  - `20261113002950_r14_policy_versions_rm1.sql` (비파괴): `policy_versions` 4행 — terms·cross_border_transfer `2026-11-08`, privacy·ai_data_use `2026-11-08.1`(재동의 없음). `private.current_policy_version` 동률 정렬(`effective_at desc, version desc`).
  - `20261113003000_r14_remove_mock_interview.sql` (**DESTRUCTIVE**): 가드(면접 단계 행 있으면 멈춤) → 교체 RPC 12개 → 면접 근거·작업·사용량·전형 이력 행 삭제 → `return_target` null → 테이블 5개 drop → 함수 45개 drop → CHECK 9개 재정의 → `evidence_links.application_project_id` not null 복원.
- **코드 삭제**: 면접 서비스·액션·라우트·작업·API·계약·데이터 계층, AI-05·06·07 파이프라인·프롬프트·스키마·검증. `common.v4`(자리 표시 5종), `ai-04.*` v5(R14-AI-1). 장기 미접속 안내 메일 문구 정리(QA-R14-1).
- **법무 본문**: `policy-content.ts` ↔ `docs/legal/` 2026-11-08 / 2026-11-08.1판.

## 검사
typecheck · lint · vitest(144 파일 2346건) · build · pgTAP(63 파일 2732 단정) 모두 PASS. 로컬 스모크(readiness·단계 이동), 가드 동작, `next start` + 실제 세션 쿠키로 HTTP 확인(S-13·S-31·JD·S-39 보드 4열·L-01 메뉴 3개·S-25·정책 4종·옛 주소 308). **실제 브라우저 클릭은 미확인**(Claude in Chrome 미연결).

## 원격 반영 (사용자가 직접)
1. push 전 원격 읽기 전용 확인: 면접 단계 `application_projects` 행 0, 실행 중 면접 `ai_jobs` 수, 지울 면접 `ai_usage_records` 행 수, `return_target.feature = job_interview` 대화 수. 필요하면 면접 테이블 5개 덤프.
2. `supabase db push` — `20261113002950` → `20261113003000` 순서. 되돌릴 수 없다.
3. 그 뒤 이 브랜치(백엔드 R14 + UI 44)를 main에 병합 — 마이그레이션만 먼저 가면 옛 면접 화면이, 코드만 먼저 가면 정책 행 없이 새 본문이 나간다.

## 남은 `[가정]`
RM-A2(면접 사용량 행 삭제 → 이번 달 합계 감소), `return_target` null 처리 시 `updated_at` 갱신(R14-DB-5), `common.v4`·`ai-04.*` v5로 동일 입력 재사용 1회 단절, 옛 주소 리다이렉트가 쿼리를 그대로 붙임(UQ-44-2, 화면 차이 없음).
