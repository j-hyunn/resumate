-- R12 (2026-11-05): UI 36·37 backend follow-ups — policy versions 2026-11-05, cover_letter default title,
-- AI-12 greeting gate label, free-tier greeting sentence only for Gemini free (R-OD-15).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- 1. policy_versions 2026-11-05 (no reconsent) is the latest effective version of each type
select is((select count(*)::int from public.policy_versions where version = '2026-11-05' and not requires_reconsent), 3,
          'three 2026-11-05 policy versions without reconsent');
select is((select array_agg(policy_type order by policy_type)
             from (select distinct on (policy_type) policy_type, version
                     from public.policy_versions where effective_at <= now()
                    order by policy_type, effective_at desc) latest
            where version = '2026-11-05'),
          array['cross_border_transfer', 'privacy', 'terms'], '2026-11-05 is the current version of all three');

-- 2. default draft titles (D-UX-23)
select ok(private.draft_default_title('cover_letter') like '자소서 문항 답변 (____-__-__)', 'cover_letter default title');
select ok(private.draft_default_title('career_description') like '경력기술서 (____-__-__)', 'career_description unchanged');

-- 3. greeting gate label
select ok(private.writing_chat_greeting(jsonb_populate_record(null::public.projects, '{"name":"P"}'), 'cover_letter', false)
            like '자소서 문항 답변을 쓰려면%', 'cover_letter gate line uses "자소서 문항 답변"');

-- 4. free-tier sentence only for Gemini free
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'g@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2', 'o@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-0000000000a3', 'c@example.test', 'authenticated', 'authenticated');
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek,
                                     kek_id, key_last4, status)
values ('aaaaaaaa-9999-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'gemini', 'free',
        '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'valid'),
       ('aaaaaaaa-9999-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-0000000000a2', 'openai', 'free',
        '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'valid'),
       ('aaaaaaaa-9999-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-0000000000a3', 'anthropic', 'free',
        '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'valid');
update public.profiles set active_ai_provider = 'gemini' where id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
update public.profiles set active_ai_provider = 'openai' where id = 'aaaaaaaa-0000-0000-0000-0000000000a2';
update public.profiles set active_ai_provider = 'anthropic' where id = 'aaaaaaaa-0000-0000-0000-0000000000a3';

select ok(private.writing_chat_free_tier('aaaaaaaa-0000-0000-0000-0000000000a1'), 'Gemini free → free-tier sentence');
select ok(not private.writing_chat_free_tier('aaaaaaaa-0000-0000-0000-0000000000a2'), 'OpenAI free → no free-tier sentence');
select ok(not private.writing_chat_free_tier('aaaaaaaa-0000-0000-0000-0000000000a3'), 'Anthropic free → no free-tier sentence');
select ok(not private.writing_chat_free_tier('aaaaaaaa-0000-0000-0000-0000000000ff'), 'no profile → false');

select * from finish();
rollback;
