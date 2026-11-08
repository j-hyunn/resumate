-- 정책 문서 개정 4종 (RM-1, AI 모의 면접 MVP 제외 — decisions 3.26·4.20, DM 11.9 (4)).
-- 파괴적 아님: policy_versions는 버전 이력이라 기존 행을 고치지 않고 새 행만 넣는다.
--
-- 20261113002900(privacy·ai_data_use 2026-11-08)은 이미 원격에 반영돼 있어(list_migrations, 2026-11-08 확인)
-- 그 파일·행을 고치지 않고 이 파일을 더한다.
--
-- terms 2026-11-08 (원문 docs/legal/terms-of-service.md): 제2조 5호·제5조 면접 1호·제7조 3항 삭제.
-- cross_border_transfer 2026-11-08 (원문 docs/legal/cross-border-transfer.md): 이전 항목 "모의 면접 답변"·
--   목적 "모의 면접" 삭제.
-- privacy 2026-11-08.1 · ai_data_use 2026-11-08.1 (원문 docs/legal/privacy-policy.md · ai-data-use.md):
--   RM-1 면접 서술 삭제. 2026-11-08 판은 이미 원격에 있으므로 새 .1 버전으로 올린다, 재동의 없음.
--   시행일은 2026-11-08 판과 같다 — 같은 시행일 안에서는 버전 문자열이 큰 쪽(.1)이 현재 판이다
--   (아래 current_policy_version 동률 정렬, 2026-11-04.1 선례).
-- 네 행 모두 항목이 줄어든 개정이라 requires_reconsent = false. 가입 게이트(terms·privacy_required)는
-- requires_reconsent = true 행만 보므로 재동의가 생기지 않는다.
--
-- 앱 본문(src/components/account/policy-content.ts)과 같은 머지로 나가야 한다. 이 행만 먼저 올리면
-- 화면이 옛 본문에 새 시행일을 보인다.

insert into public.policy_versions (policy_type, version, effective_at, requires_reconsent, document_path)
values
  ('terms', '2026-11-08', '2026-11-08 00:00:00+09', false, '/policies/terms/2026-11-08'),
  ('cross_border_transfer', '2026-11-08', '2026-11-08 00:00:00+09', false, '/policies/cross_border_transfer/2026-11-08'),
  ('privacy', '2026-11-08.1', '2026-11-08 00:00:00+09', false, '/policies/privacy/2026-11-08.1'),
  ('ai_data_use', '2026-11-08.1', '2026-11-08 00:00:00+09', false, '/policies/ai_data_use/2026-11-08.1')
on conflict (policy_type, version) do nothing;

-- Two versions now share one effective_at (2026-11-08 / 2026-11-08.1). Without a tie-breaker the "current"
-- version was arbitrary; the later revision (larger version string, byte order) wins.
create or replace function private.current_policy_version(p_policy_type text)
returns text
language sql
stable
set search_path = ''
as $$
  select pv.version
    from public.policy_versions pv
   where pv.policy_type = p_policy_type
     and pv.effective_at <= now()
   order by pv.effective_at desc, pv.version collate "C" desc
   limit 1;
$$;
