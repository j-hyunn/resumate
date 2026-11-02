-- R1 (planning decisions 2026-11-05): A7 get_account_deletion_state, A18 readiness project_fields,
-- A19 key RPC executors, A20 unified re-consent rule (save_provider_key = check_ai_run_allowed).
-- A5 / A6 are in writing_chats.test.sql, A22 in interviews.test.sql, A24 in evidence_links.test.sql / grants.test.sql.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer, service_role;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000003', 'c@example.test', 'authenticated', 'authenticated');

-- ══ A7 get_account_deletion_state ══════════════════════════════════════════
select ok((select prosecdef from pg_proc where oid = 'public.get_account_deletion_state(uuid,text)'::regprocedure),
          'A7: security definer');
select set_eq(
  $$select r.rolname::text from pg_roles r
     where r.rolname in ('anon', 'authenticated', 'app_ai_writer', 'app_key_reader', 'service_role')
       and has_function_privilege(r.oid, 'public.get_account_deletion_state(uuid,text)', 'execute')$$,
  array['service_role'], 'A7: only service_role executes get_account_deletion_state');

-- B: deletion incomplete (public data + profile gone, log written, auth user still there).
delete from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000002';
insert into public.account_deletion_logs (subject_hash, reason) values (repeat('b', 64), 'user_request');
-- C: profile missing without a log (signup trigger missing).
delete from public.profiles where id = 'cccccccc-0000-0000-0000-000000000003';

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.get_account_deletion_state('aaaaaaaa-0000-0000-0000-000000000001', repeat('a', 64)), 'active',
          'A7: profile exists -> active');
select is(public.get_account_deletion_state('bbbbbbbb-0000-0000-0000-000000000002', repeat('b', 64)), 'deletion_incomplete',
          'A7: no profile + log row -> deletion_incomplete');
select is(public.get_account_deletion_state('cccccccc-0000-0000-0000-000000000003', repeat('c', 64)), 'profile_missing',
          'A7: no profile, no log -> profile_missing');
select is(public.get_account_deletion_state('cccccccc-0000-0000-0000-000000000003', repeat('b', 64)), 'deletion_incomplete',
          'A7: the decision follows the hash the server computed (re-signup = new id = new hash)');
select throws_ok($$select public.get_account_deletion_state(null, repeat('a', 64))$$, 'P0001', 'invalid_user_id',
                 'A7: null user id');
select throws_ok($$select public.get_account_deletion_state('aaaaaaaa-0000-0000-0000-000000000001', null)$$,
                 'P0001', 'invalid_subject_hash', 'A7: null hash');
select throws_ok($$select public.get_account_deletion_state('aaaaaaaa-0000-0000-0000-000000000001', repeat('A', 64))$$,
                 'P0001', 'invalid_subject_hash', 'A7: hash must be lowercase hex (checked even when the profile exists)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.get_account_deletion_state('aaaaaaaa-0000-0000-0000-000000000001', repeat('a', 64))$$,
                 '42501', null, 'A7: authenticated cannot execute');
reset role;

-- ══ A18 readiness project_fields ═══════════════════════════════════════════
-- A: complete experience E1, draft experience E2. P1 under E1 with a complete detail but no role.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.projects (id, name) values ('aaaaaaaa-3333-0000-0000-000000000001', 'P1');
insert into public.project_details (project_id, title, situation, action)
  values ('aaaaaaaa-3333-0000-0000-000000000001', 't', 's', 'a');
select is((select status from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'), 'draft',
          'P1 stays draft (role missing)');

-- experience missing -> step 1 wins: form without suggested_project_id, but the hint is there.
select is(public.get_data_readiness() #> '{features,insight}',
          '{"ready": false, "missing": ["complete_experience", "complete_project"], "hints": ["project_fields", "profile"],
            "next_action": "form"}'::jsonb,
          'A18: experience missing -> form first (no suggested_project_id), project_fields hint present');

insert into public.experiences (id, company_name, start_month, job_rank)
  values ('aaaaaaaa-1111-0000-0000-000000000001', 'A사', '2020-01-01', 'S');

-- no AI connection (no key) -> still project_fields (step 2 comes before the no-key form).
select is(public.get_data_readiness() #> '{features,insight}',
          '{"ready": false, "missing": ["complete_project"], "hints": ["project_fields", "profile"],
            "next_action": "form", "suggested_project_id": "aaaaaaaa-3333-0000-0000-000000000001"}'::jsonb,
          'A18: project_fields -> form + suggested_project_id, no suggested_mode, same without AI connection');
select is(public.get_data_readiness() #> '{features,draft}', public.get_data_readiness() #> '{features,insight}',
          'A18: draft feature same object');
select is(public.get_data_readiness() #> '{features,job_interview}', public.get_data_readiness() #> '{features,insight}',
          'A18: job_interview feature same object');
reset role;

-- with a valid active key -> same result.
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek,
                                     kek_id, key_last4, status)
values ('aaaaaaaa-9999-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'paid',
        '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'valid');
update public.profiles set active_ai_provider = 'gemini' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_data_readiness() #> '{features,insight}',
          '{"ready": false, "missing": ["complete_project"], "hints": ["project_fields", "profile"],
            "next_action": "form", "suggested_project_id": "aaaaaaaa-3333-0000-0000-000000000001"}'::jsonb,
          'A18: same value with a usable key');

-- a newer candidate (blank name, whitespace role) wins; a project without a complete detail is not a candidate.
insert into public.projects (id, experience_id, name, role) values
  ('aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-1111-0000-0000-000000000001', '  ', 'Dev'),
  ('aaaaaaaa-3333-0000-0000-000000000003', 'aaaaaaaa-1111-0000-0000-000000000001', 'P3', 'Dev');
insert into public.project_details (project_id, title, situation, action)
  values ('aaaaaaaa-3333-0000-0000-000000000002', 't', 's', 'a');
reset role;
-- now() is fixed inside the test transaction: age P1 by hand so P2 is the newest.
alter table public.projects disable trigger projects_set_updated_at;
update public.projects set updated_at = now() - interval '1 day' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
alter table public.projects enable trigger projects_set_updated_at;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_data_readiness() #>> '{features,insight,suggested_project_id}', 'aaaaaaaa-3333-0000-0000-000000000002',
          'A18: newest candidate by updated_at');
select is(public.get_data_readiness() #> '{features,insight,hints}', '["complete_project_detail", "project_fields", "profile"]'::jsonb,
          'A18: complete_project_detail (P3) and project_fields both hinted');

-- project under a draft experience is excluded from the candidates (DM §2.2 inclusion rule).
insert into public.experiences (id, company_name) values ('aaaaaaaa-1111-0000-0000-000000000002', '임시');
update public.projects set experience_id = 'aaaaaaaa-1111-0000-0000-000000000002'
 where id = 'aaaaaaaa-3333-0000-0000-000000000002';
select is(public.get_data_readiness() #>> '{features,insight,suggested_project_id}', 'aaaaaaaa-3333-0000-0000-000000000001',
          'A18: candidate under a draft experience skipped');

-- fixing the role completes P1; P2 excluded, P3 has no complete detail -> no project_fields; ready.
update public.projects set role = 'Backend' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
select is(public.get_data_readiness() #> '{features,insight}',
          '{"ready": true, "missing": [], "hints": ["profile"]}'::jsonb,
          'A18: role filled -> ready, no project_fields');
reset role;

-- ══ A19 / A20 save_provider_key consent rule ═══════════════════════════════
-- A consented gemini paid on v2026-10-29. A newer gemini paid disclosure without re-consent comes into effect.
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'paid', 'v2026-10-29');
insert into public.ai_disclosures (provider, connection_tier, version, effective_at, requires_reconsent, document_path)
  values ('gemini', 'paid', 'v-r1-minor', now() - interval '2 minutes', false, '/policies/ai/gemini/paid/v-r1-minor');
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, provider, model_tier, connection_tier, status, heartbeat_at)
  values ('aaaaaaaa-7777-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', 'application_project',
          gen_random_uuid(), 'gemini', 'default', 'paid', 'running', now());

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'paid', '\x0a', '\x0b', '\x0c', 'env-v1',
                                   'gm02', 'v-r1-minor', 'valid', 'aaaaaaaa-9999-0000-0000-000000000001') ->> 'status', 'valid',
          'A20: a newer disclosure without requires_reconsent does not block key replacement');
select is(public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'paid', '\x0a', '\x0b', '\x0c', 'env-v1',
                                   'gm03', 'v2026-10-29', 'valid', 'aaaaaaaa-9999-0000-0000-000000000001') ->> 'key_last4', 'gm03',
          'A20: the version the consent cites is accepted too');
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'paid', '\x0a', '\x0b', '\x0c',
                   'env-v1', 'gm04', 'v-unknown', 'valid', 'aaaaaaaa-9999-0000-0000-000000000001')$$,
                 'P0001', 'consent_required', 'A20: unknown disclosure version -> consent_required');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000001'), null,
          'A20: run gate agrees (minor disclosure -> run allowed)');
reset role;

-- A disclosure that requires re-consent comes into effect -> both registration and run refuse.
insert into public.ai_disclosures (provider, connection_tier, version, effective_at, requires_reconsent, document_path)
  values ('gemini', 'paid', 'v-r1-major', now() - interval '1 minute', true, '/policies/ai/gemini/paid/v-r1-major');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'paid', '\x0a', '\x0b', '\x0c',
                   'env-v1', 'gm05', 'v-r1-major', 'valid', 'aaaaaaaa-9999-0000-0000-000000000001')$$,
                 'P0001', 'consent_required', 'A20: requires_reconsent after the consent -> consent_required');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000001'), 'consent_required',
          'A20: run gate agrees (re-consent required)');
reset role;

-- Re-consent on the major version -> both pass again.
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'paid', 'v-r1-major');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.save_provider_key('aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'paid', '\x0a', '\x0b', '\x0c', 'env-v1',
                                   'gm06', 'v-r1-major', 'valid', 'aaaaaaaa-9999-0000-0000-000000000001') ->> 'key_last4', 'gm06',
          'A20: after re-consent registration passes');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.check_ai_run_allowed('aaaaaaaa-7777-0000-0000-000000000001'), null, 'A20: after re-consent run passes');
reset role;

select * from finish();
rollback;
