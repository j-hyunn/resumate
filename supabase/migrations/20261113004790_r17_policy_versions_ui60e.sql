-- 정책 문서 개정 3종 (UI60-E, 채용 공고 AI 처리 폐기 JR-1·JR-5·JR-6 — decisions 3.30 · 4.25 백엔드 #1).
-- 파괴적 아님: policy_versions는 버전 이력이라 기존 행을 고치지 않고 새 행만 넣는다(CF-S6 20261113004695 패턴).
--
-- 원문(2026-11-20판, 기획 PR #77 — docs/legal/):
--   terms 2026-11-20 (terms-of-service.md): 제5조 2호 서비스 목록에서 "요건 정리" 삭제.
--   privacy 2026-11-20 (privacy-policy.md): 1번 표 지원 관리 데이터 항목에서 "요건" 삭제.
--   ai_data_use 2026-11-20 (ai-data-use.md): 3번 보내는 데이터에서 "요건" 삭제 + "인사이트 결과" 추가,
--     자기소개서를 만들 때 인사이트 자동 시작(JR-6)을 보내는 때에 추가.
-- 세 행 모두 requires_reconsent = false — terms·privacy는 제공 서비스·수집 항목이 줄어드는 개정이고, ai_data_use는
-- 보내는 원천 데이터 종류가 늘지 않는다 `[가정 — 출시 전 법무 확인]`(UI60-E). 가입 게이트(terms·privacy_required)는
-- requires_reconsent = true 행만 보므로 재동의가 생기지 않는다. cross_border_transfer는 이번 개정 대상이 아니다.
--
-- 직전 판: terms·privacy·ai_data_use 2026-11-09. 새 판은 시행일이 더 늦어 동률 정렬(R14)에 기대지 않는다.
--
-- 앱 본문(src/components/account/policy-content.ts — UI 소유, 4.25 UI #3)과 같은 머지로 나가야 한다. push ~ 머지
-- 사이에는 화면이 옛 본문에 새 시행일을 보인다(CF-S6와 같은 창 — push 직후 머지).
--
-- 번호: 원격 마지막 20261113004700 뒤, R17 파괴 마이그레이션 A(004800)·B·C(004820)보다 앞 — 파괴가 마지막이다
-- (004695 선례).

insert into public.policy_versions (policy_type, version, effective_at, requires_reconsent, document_path)
values
  ('terms', '2026-11-20', '2026-11-20 00:00:00+09', false, '/policies/terms/2026-11-20'),
  ('privacy', '2026-11-20', '2026-11-20 00:00:00+09', false, '/policies/privacy/2026-11-20'),
  ('ai_data_use', '2026-11-20', '2026-11-20 00:00:00+09', false, '/policies/ai_data_use/2026-11-20')
on conflict (policy_type, version) do nothing;
