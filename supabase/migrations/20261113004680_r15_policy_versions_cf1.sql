-- 정책 문서 개정 3종 (CF-1, 경력기술서 서비스 제외 — decisions 4.23 백엔드 #15, CF-S6 확정 2026-11-09 (사용자)).
-- 파괴적 아님: policy_versions는 버전 이력이라 기존 행을 고치지 않고 새 행만 넣는다(R14 20261113002950 패턴).
--
-- 원문(시행판, PR #68 — docs/legal/):
--   terms 2026-11-09 (terms-of-service.md): 제2조 5호 AI 결과물 정의·제5조 2호 서비스 목록에서 경력기술서 삭제.
--   privacy 2026-11-09 (privacy-policy.md): 1번 표 지원 관리 데이터 항목에서 경력기술서 초안 삭제.
--   ai_data_use 2026-11-09 (ai-data-use.md): 1번 첫 문단 AI 기능 목록에서 경력기술서 삭제.
-- 세 행 모두 제공 서비스·수집 항목이 줄어드는 개정이라 requires_reconsent = false. 가입 게이트
-- (terms·privacy_required)는 requires_reconsent = true 행만 보므로 재동의가 생기지 않는다.
-- cross_border_transfer는 이번 개정 대상이 아니다(2026-11-08 판 그대로).
--
-- 원격의 직전 판: terms 2026-11-08, privacy 2026-11-08.1, ai_data_use 2026-11-08.1. 새 판은 시행일이 더 늦어
-- private.current_policy_version의 동률 정렬(R14)에 기대지 않는다.
--
-- 앱 본문(src/components/account/policy-content.ts — UI 소유)과 같은 머지로 나가야 한다. 마이그레이션은 코드
-- 배포 전에 push되므로 push ~ 머지 사이에는 화면이 옛 본문에 새 시행일을 보인다(R14와 같은 창 — push 직후
-- 머지해 창을 짧게 둔다).
--
-- 번호: 20261113004670(R15 후속)보다 뒤, 20261113004700(파괴)보다 앞 — 파괴가 마지막이다.

insert into public.policy_versions (policy_type, version, effective_at, requires_reconsent, document_path)
values
  ('terms', '2026-11-09', '2026-11-09 00:00:00+09', false, '/policies/terms/2026-11-09'),
  ('privacy', '2026-11-09', '2026-11-09 00:00:00+09', false, '/policies/privacy/2026-11-09'),
  ('ai_data_use', '2026-11-09', '2026-11-09 00:00:00+09', false, '/policies/ai_data_use/2026-11-09')
on conflict (policy_type, version) do nothing;
