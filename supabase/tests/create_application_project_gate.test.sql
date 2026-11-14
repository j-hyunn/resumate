-- W0 Q53-1 gate, revised in R17 `[가정 R17-9]`: registering a posting runs no AI, so create_application_project
-- no longer refuses on an invalid key or a missing AI consent. Every connection state saves the posting; only
-- ai_run_allowed reflects the connection. An existing id is still a replay, someone else's id still a conflict.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated'),
  ('c0000000-0000-0000-0000-000000000003', 'c@example.test', 'authenticated', 'authenticated');

-- A: gemini free, valid, consent. C: no key at all.
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status) values
  ('a0000000-9999-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'ag01', 'valid');
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged) values
  ('a0000000-0000-0000-0000-000000000001', 'gemini', 'free', 'v2026-11-05', true);
update public.profiles set active_ai_provider = 'gemini' where id = 'a0000000-0000-0000-0000-000000000001';

create temp table t_args (s jsonb);
insert into t_args values ('[{"sid":"S1","text":"원문","start":0,"end":2}]');
grant select on t_args to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.create_application_project('c0000000-aaaa-0000-0000-000000000001', '원문', 'h', (select s from t_args), '회사', '포지션')
            - 'application_project_id' - 'job_description_id',
          '{"name":"회사 자기소개서","name_source":"user","ai_run_allowed":false,"created":true}'::jsonb,
          'no active provider: saved key-less (R17 return shape)');

set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000001', '원문', 'h', (select s from t_args)) ->> 'ai_run_allowed',
          'true', 'valid key + consent: saved, AI allowed');
reset role;

-- Invalid key: saved anyway (R17), AI not allowed.
update public.ai_provider_keys set status = 'invalid' where user_id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000003', '원문', 'h', (select s from t_args))
            - 'application_project_id' - 'job_description_id' - 'name',
          '{"name_source":"default","ai_run_allowed":false,"created":true}'::jsonb,
          'invalid key: no key_invalid gate since R17, saved with the default name');
select is((select count(*)::int from public.job_descriptions where application_project_id = 'a0000000-aaaa-0000-0000-000000000003'), 1,
          'invalid key: the JD is saved');
select throws_ok($$select public.create_application_project('a0000000-aaaa-0000-0000-000000000004', repeat('x', 50001), 'h', (select s from t_args))$$,
                 'P0001', 'invalid_raw_text', 'arguments are still checked');
reset role;

-- Consent missing: saved anyway (R17), AI not allowed.
update public.ai_provider_keys set status = 'valid' where user_id = 'a0000000-0000-0000-0000-000000000001';
delete from public.ai_data_use_consents where user_id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000005', '원문', 'h', (select s from t_args)) ->> 'ai_run_allowed',
          'false', 'no consent: no ai_consent_required gate since R17, saved, AI not allowed');
select is((select count(*)::int from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000005'), 1,
          'no consent: the project is saved');

-- Someone else's id stays a conflict, whatever the caller's connection.
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.create_application_project('a0000000-aaaa-0000-0000-000000000003', '원문', 'h', (select s from t_args))$$,
                 'P0001', 'application_project_id_conflict', 'another user''s id: conflict');
reset role;

select * from finish();
rollback;
