# UI32 원격 반영 (2026-11-04)

## 원격 상태 (list_migrations, rxtnguarpotkcgdazkbw)
- 원격 마지막 적용: `20261112000100_inactive_account_deletion`.
- 미반영(로컬 순서대로, 모두 원격 마지막보다 뒤 — 이름 변경 불필요):
  1. `20261113000100_policy_versions_cross_border_2026_11_04_1.sql` — main에 이미 머지된 PR #26(처리방침 2026-11-04.1). 정책 버전 행 추가. 비파괴.
  2. `20261113000200_ui32_education_display_labels.sql` — 이번 작업. 함수 3개 추가·2개 교체, `evidence_links`·`draft_section_sources`의 교육 라벨 값 백필. **삭제 없음, 기존 라벨 값 변경**(되돌리려면 기관명으로 다시 쓰는 별도 마이그레이션 필요).
- 새 env 없음.

## 순서
1. `supabase link --project-ref rxtnguarpotkcgdazkbw` (DB 비밀번호는 사용자가 직접 입력)
2. `supabase db push --dry-run` 으로 위 2개만 나오는지 확인
3. `supabase db push`
4. 리더: list_migrations 재확인, get_advisors(security·performance)
5. 그 뒤 이 브랜치 PR 머지(=운영 배포). DB 변경이 먼저 나가도 현재 운영 코드와 호환(라벨 값만 바뀜).

## 결과
- 2026-11-04 사용자가 `supabase db push --linked` 실행. 원격 이력에 `20261113000100`, `20261113000200` 추가 확인.
- 원격 확인: `private.education_display_name`·`trim_js_whitespace`·`backfill_education_display_labels` 3개 존재, 정책 버전 `cross_border_transfer 2026-11-04.1` 행 존재. 원격 `evidence_links` 교육 출처 행 0건(백필 대상 없음), 불일치 0.
- advisors 보안: 이전과 같음(authenticated용 SECURITY DEFINER RPC WARN 22, `account_deletion_logs` 정책 없음 INFO, Auth 비밀번호 유출 보호·MFA WARN) — 새 함수는 목록에 없음(실행 권한 회수 확인). 성능: INFO만(미색인 FK·미사용 인덱스), 새 항목 없음.
- 남은 일: 이 브랜치 커밋·PR·main 머지(=운영 배포) 뒤 Vercel 배포 상태 확인.
