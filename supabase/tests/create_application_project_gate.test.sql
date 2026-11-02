-- W0 Q53-1 (DM 2.7.1, 2.11.7 path ⑥): create_application_project refuses before any insert; existing id skips the gate.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated'),
  ('c0000000-0000-0000-0000-000000000003', 'c@example.test', 'authenticated', 'authenticated');

-- A: gemini free, valid, consent. B: inactive key only (no active provider). C: no key at all.
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status) values
  ('a0000000-9999-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'ag01', 'valid');
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged) values
  ('a0000000-0000-0000-0000-000000000001', 'gemini', 'free', 'v2026-10-29', true);
update public.profiles set active_ai_provider = 'gemini' where id = 'a0000000-0000-0000-0000-000000000001';

create temp table t_args (s jsonb);
insert into t_args values ('[{"sid":"S1","text":"원문","start":0,"end":2}]');
grant select on t_args to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.create_application_project('c0000000-aaaa-0000-0000-000000000001', '원문', 'h', (select s from t_args), '회사', '포지션')
            - 'application_project_id' - 'job_description_id',
          '{"name":"회사 – 포지션","name_source":"user","extraction_status":"pending","ai_run_allowed":false,"created":true}'::jsonb,
          'no active provider: passes, saved key-less (D-30)');

set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000001', '원문', 'h', (select s from t_args)) ->> 'ai_run_allowed',
          'true', 'valid key + consent: passes');
reset role;

-- needs_check passes.
update public.ai_provider_keys set status = 'needs_check' where user_id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000002', '원문', 'h', (select s from t_args)) ->> 'created',
          'true', 'needs_check: passes');
reset role;

-- Invalid key.
update public.ai_provider_keys set status = 'invalid' where user_id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.create_application_project('a0000000-aaaa-0000-0000-000000000003', '원문', 'h', (select s from t_args))$$,
                 'P0001', 'key_invalid', 'invalid key: key_invalid');
select is((select count(*)::int from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000003'), 0,
          'invalid key: no orphan project');
select is((select count(*)::int from public.job_descriptions where application_project_id = 'a0000000-aaaa-0000-0000-000000000003'), 0,
          'invalid key: no orphan JD');
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000001', '원문', 'h', (select s from t_args)) ->> 'created',
          'false', 'existing id: gate not checked, created false');
select throws_ok($$select public.create_application_project('a0000000-aaaa-0000-0000-000000000003', repeat('x', 50001), 'h', (select s from t_args))$$,
                 'P0001', 'invalid_raw_text', 'arguments are checked before the gate');
reset role;

-- Consent required: the disclosure consent is gone.
update public.ai_provider_keys set status = 'valid' where user_id = 'a0000000-0000-0000-0000-000000000001';
delete from public.ai_data_use_consents where user_id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.create_application_project('a0000000-aaaa-0000-0000-000000000003', '원문', 'h', (select s from t_args))$$,
                 'P0001', 'ai_consent_required', 'no consent: ai_consent_required');
select is((select count(*)::int from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000003'), 0,
          'no consent: no orphan project');
reset role;

-- Same id after consent creates normally.
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged) values
  ('a0000000-0000-0000-0000-000000000001', 'gemini', 'free', 'v2026-10-29', true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000003', '원문', 'h', (select s from t_args)) ->> 'created',
          'true', 'same id after consent: created');

-- Someone else's id stays a conflict, whatever the caller's connection.
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.create_application_project('a0000000-aaaa-0000-0000-000000000003', '원문', 'h', (select s from t_args))$$,
                 'P0001', 'application_project_id_conflict', 'another user''s id: conflict');
reset role;

select * from finish();
rollback;
