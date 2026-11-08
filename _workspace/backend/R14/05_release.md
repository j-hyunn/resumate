# R14 원격 반영 (2026-11-08, 사용자 요청 "배포 순서대로 ㄱㄱ")

## 사전 확인 (원격 읽기 전용)
- 면접 단계 지원 프로젝트 0 · 전형 이력 0 · 세션/질문/답변 0 · 면접 작업 0(실행 중 0) · 면접 사용량 0 · 면접 근거 0 · `job_interview` 복귀 대상 0 · 사용자 1 → drop으로 잃는 데이터 없음, 덤프 생략
- 원격 마지막 마이그레이션 `20261113002900` — 새 파일 2개가 그 뒤로 정렬

## 반영
1. PR [#64](https://github.com/j-hyunn/resumate/pull/64) 생성
2. `supabase link --project-ref rxtnguarpotkcgdazkbw` → `db push --linked --dry-run`(2개, 예상과 같음) → `db push --linked --yes`
   - `20261113002950_r14_policy_versions_rm1` (비파괴) · `20261113003000_r14_remove_mock_interview` (DESTRUCTIVE) 적용
3. 확인: 마지막 `20261113003000`, 면접 테이블·함수 0, `application_projects_stage_check` 4값, `evidence_links.application_project_id` not null, 현재 판 privacy·ai_data_use `2026-11-08.1` / terms·cross_border `2026-11-08`. advisors(security) 신규 없음 — SECURITY DEFINER WARN 17(이전 21, 면접 RPC 삭제), `account_deletion_logs` 정책 없음·Auth 비밀번호/MFA는 기존 수용 항목
4. main과 문서 충돌(#61·#63, S-44 DH-1) 해소 커밋 `ff9d810` — 코드 변경 없음
5. PR #64 병합 `d739047` (2026-11-08T09:58:45Z) → Vercel 운영 배포 success
6. 운영 확인(비로그인): `/` 200, `/interviews`·`/interviews/x/result` → 308 `/applications`, `/applications/abc/interview` → 308 `/applications/abc`, 정책 4종 200·면접 문구 0·처리방침 `2026-11-08.1`, `/board` → 로그인

## 주의
- db push(09:5x)와 병합(09:58) 사이 수 분 동안 운영 앱이 옛 코드 + 새 DB였다(면접 데이터 0, 사용자 1명이라 영향 미미).
- Vercel MCP는 403(권한 없음) — 배포 상태는 GitHub 커밋 상태로 확인. 런타임 오류 조회는 하지 못했다.
- 로그인 화면(보드·S-31 등)의 운영 확인은 하지 않았다(로컬 HTTP 확인만).
