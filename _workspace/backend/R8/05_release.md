# R8 원격 반영 (2026-11-04)

- 대상: Supabase `resumate` (ref `rxtnguarpotkcgdazkbw`, 운영 겸용)
- 반영 전 원격 마지막 마이그레이션: `20261113000200_ui32_education_display_labels` → 로컬 전용 파일은 `20261113000300_r8_star_merged_proposal.sql` 1개, 순서 문제 없음.
- 비파괴: `private.wc_patch_star` 함수 교체만. 데이터·컬럼 삭제 없음. 새 환경 변수 없음.
- 실행: `supabase link --project-ref rxtnguarpotkcgdazkbw` → `supabase db push --dry-run`(대상 1개 확인) → `supabase db push --linked`, 사용자가 터미널에서 적용 확인.
- 결과: `list_migrations`에 `20261113000300 r8_star_merged_proposal` 확인.
- advisors (반영 후):
  - 보안: `authenticated`가 실행하는 SECURITY DEFINER RPC WARN 22건(설계대로, decisions.md "2026-11-04 원격 연동"), `account_deletion_logs` 정책 없음 INFO(service role 전용), Auth 유출 비밀번호 보호·MFA WARN(Google 로그인만 사용, 비밀번호 없음). R8로 새로 생긴 항목 없음 — 바뀐 함수는 `private` 스키마.
  - 성능: INFO만(외래 키 인덱스 없음 51, 미사용 인덱스 52). R8과 무관.
- 남은 일: PR #34 머지(화면 변경 포함 — 같은 머지여야 함) → Vercel 배포 상태·런타임 오류 확인.
- R7은 마이그레이션 없음(같은 PR로 나감).
