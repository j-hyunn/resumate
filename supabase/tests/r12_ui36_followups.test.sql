-- R12 (2026-11-05): UI 36·37 backend follow-ups — policy versions 2026-11-05, cover_letter default title,
-- AI-12 greeting gate label, free-tier greeting sentence only for Gemini free (R-OD-15).
-- QA fix (QA-02, QA-03): Gemini paid / inactive Gemini free key, greetings through the start RPCs, UX v5.13 wording.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

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
  ('aaaaaaaa-0000-0000-0000-0000000000a3', 'c@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-0000000000a4', 'gp@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-0000000000a5', 'go@example.test', 'authenticated', 'authenticated');
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek,
                                     kek_id, key_last4, status)
values ('aaaaaaaa-9999-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'gemini', 'free',
        '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'valid'),
       ('aaaaaaaa-9999-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-0000000000a2', 'openai', 'free',
        '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'valid'),
       ('aaaaaaaa-9999-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-0000000000a3', 'anthropic', 'free',
        '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'valid'),
       ('aaaaaaaa-9999-0000-0000-0000000000a4', 'aaaaaaaa-0000-0000-0000-0000000000a4', 'gemini', 'paid',
        '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'valid'),
       ('aaaaaaaa-9999-0000-0000-0000000000a5', 'aaaaaaaa-0000-0000-0000-0000000000a5', 'gemini', 'free',
        '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'valid'),
       ('aaaaaaaa-9999-0000-0000-0000000000b5', 'aaaaaaaa-0000-0000-0000-0000000000a5', 'openai', 'paid',
        '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'valid');
update public.profiles set active_ai_provider = 'gemini' where id = 'aaaaaaaa-0000-0000-0000-0000000000a1';
update public.profiles set active_ai_provider = 'openai' where id = 'aaaaaaaa-0000-0000-0000-0000000000a2';
update public.profiles set active_ai_provider = 'anthropic' where id = 'aaaaaaaa-0000-0000-0000-0000000000a3';
update public.profiles set active_ai_provider = 'gemini' where id = 'aaaaaaaa-0000-0000-0000-0000000000a4';
update public.profiles set active_ai_provider = 'openai' where id = 'aaaaaaaa-0000-0000-0000-0000000000a5';

select ok(private.writing_chat_free_tier('aaaaaaaa-0000-0000-0000-0000000000a1'), 'Gemini free → free-tier sentence');
select ok(not private.writing_chat_free_tier('aaaaaaaa-0000-0000-0000-0000000000a2'), 'OpenAI free → no free-tier sentence');
select ok(not private.writing_chat_free_tier('aaaaaaaa-0000-0000-0000-0000000000a3'), 'Anthropic free → no free-tier sentence');
select ok(not private.writing_chat_free_tier('aaaaaaaa-0000-0000-0000-0000000000ff'), 'no profile → false');
select ok(not private.writing_chat_free_tier('aaaaaaaa-0000-0000-0000-0000000000a4'), 'Gemini paid → no free-tier sentence');
select ok(not private.writing_chat_free_tier('aaaaaaaa-0000-0000-0000-0000000000a5'),
          'Gemini free key but OpenAI paid active → follows the active provider (no free-tier sentence)');

-- 5. QA-03: UX v5.13 wording (S-10 "+ 새 대화", S-44 same sentence; C-19 · C-21)
create function pg_temp.free_line() returns text language sql immutable as
  $$ select '무료 등급에서는 입력한 내용이 Google 제품 개선에 쓰이고 사람이 검토할 수 있어요. 민감정보·회사 기밀은 쓰지 마세요.'::text $$;
grant execute on function pg_temp.free_line() to authenticated;

select ok(private.writing_chat_greeting(jsonb_populate_record(null::public.projects, '{"name":"P"}'), null, true)
            like '%말하지 말아 주세요. ' || pg_temp.free_line(), 'AI-12 greeting ends with the UX free-tier sentence');
select ok(private.writing_chat_deliverable_greeting('D', false, null, true)
            like '%쓰지 말아 주세요. ' || pg_temp.free_line(), 'AI-13 greeting ends with the UX free-tier sentence');
select ok(private.writing_chat_greeting(jsonb_populate_record(null::public.projects, '{"name":"P"}'), null, true)
            not like '%서비스 개선에 쓰일 수%'
          and private.writing_chat_deliverable_greeting('D', false, null, true) not like '%서비스 개선에 쓰일 수%',
          'old free-tier sentence is gone from both greetings');
select ok(private.writing_chat_greeting(jsonb_populate_record(null::public.projects, '{"name":"P"}'), null, false)
            not like '%무료 등급%'
          and private.writing_chat_deliverable_greeting('D', false, null, false) not like '%무료 등급%',
          'no free-tier sentence when p_free_tier is false');

-- 6. greetings stored by the start RPCs (Gemini free = sentence; OpenAI free / Gemini paid = none)
insert into public.experiences (id, user_id, company_name) values
  ('aaaaaaaa-1111-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'G사'),
  ('aaaaaaaa-1111-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-0000000000a2', 'O사'),
  ('aaaaaaaa-1111-0000-0000-0000000000a4', 'aaaaaaaa-0000-0000-0000-0000000000a4', 'GP사');
insert into public.projects (id, user_id, experience_id, name) values
  ('aaaaaaaa-3333-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000a1',
   'aaaaaaaa-1111-0000-0000-0000000000a1', 'G project'),
  ('aaaaaaaa-3333-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-0000000000a2',
   'aaaaaaaa-1111-0000-0000-0000000000a2', 'O project'),
  ('aaaaaaaa-3333-0000-0000-0000000000a4', 'aaaaaaaa-0000-0000-0000-0000000000a4',
   'aaaaaaaa-1111-0000-0000-0000000000a4', 'GP project');
-- deliverables live under standalone projects
insert into public.projects (id, user_id, name) values
  ('aaaaaaaa-3333-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'G standalone'),
  ('aaaaaaaa-3333-0000-0000-0000000000b2', 'aaaaaaaa-0000-0000-0000-0000000000a2', 'O standalone'),
  ('aaaaaaaa-3333-0000-0000-0000000000b4', 'aaaaaaaa-0000-0000-0000-0000000000a4', 'GP standalone');
insert into public.project_deliverables (id, user_id, project_id, title, body) values
  ('aaaaaaaa-4444-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000a1',
   'aaaaaaaa-3333-0000-0000-0000000000b1', 'G 산출물', ''),
  ('aaaaaaaa-4444-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-0000000000a2',
   'aaaaaaaa-3333-0000-0000-0000000000b2', 'O 산출물', ''),
  ('aaaaaaaa-4444-0000-0000-0000000000a4', 'aaaaaaaa-0000-0000-0000-0000000000a4',
   'aaaaaaaa-3333-0000-0000-0000000000b4', 'GP 산출물', '');

create function pg_temp.greeting(p_chat uuid) returns text language sql as
  $$ select content from public.writing_chat_messages where writing_chat_id = p_chat and sequence = 1 $$;
grant execute on function pg_temp.greeting(uuid) to authenticated;

set local role authenticated;

set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-0000000000a2","role":"authenticated"}';
select ok(pg_temp.greeting(public.start_writing_chat('aaaaaaaa-3333-0000-0000-0000000000a2')) not like '%무료 등급%',
          'OpenAI free: start_writing_chat greeting has no free-tier sentence');
select ok(pg_temp.greeting(public.start_deliverable_writing_chat('aaaaaaaa-4444-0000-0000-0000000000a2')) not like '%무료 등급%',
          'OpenAI free: start_deliverable_writing_chat greeting has no free-tier sentence');

set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-0000000000a4","role":"authenticated"}';
select ok(pg_temp.greeting(public.start_writing_chat('aaaaaaaa-3333-0000-0000-0000000000a4')) not like '%무료 등급%',
          'Gemini paid: start_writing_chat greeting has no free-tier sentence');
select ok(pg_temp.greeting(public.start_deliverable_writing_chat('aaaaaaaa-4444-0000-0000-0000000000a4')) not like '%무료 등급%',
          'Gemini paid: start_deliverable_writing_chat greeting has no free-tier sentence');

set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-0000000000a1","role":"authenticated"}';
select ok(pg_temp.greeting(public.start_writing_chat('aaaaaaaa-3333-0000-0000-0000000000a1')) like '%' || pg_temp.free_line(),
          'Gemini free: start_writing_chat greeting ends with the UX free-tier sentence');
select ok(pg_temp.greeting(public.start_deliverable_writing_chat('aaaaaaaa-4444-0000-0000-0000000000a1')) like '%' || pg_temp.free_line(),
          'Gemini free: start_deliverable_writing_chat greeting ends with the UX free-tier sentence');

reset role;

select * from finish();
rollback;
