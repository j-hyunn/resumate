-- S2 get_data_readiness() — R4: DM §6 v4.4 (D-01 v4.4, project_star / project_fields / create_project).
-- S3b: + ai_connection (DM §6 v4). The S2 cases run with a valid active key for A so the writing_chat
-- branches stay reachable; the no-key / invalid-key branches are at the end.
-- R3: A has no consent row here, so consent_required is true; its branches are in readiness_consent_required.test.sql.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- B has a ready career; it must not leak into A's readiness.
insert into public.experiences (id, user_id, company_name, start_month, job_rank)
values ('bbbbbbbb-1111-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'B', '2020-01-01', 'S');
insert into public.projects (id, user_id, experience_id, name, situation, action)
values ('bbbbbbbb-3333-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
        'bbbbbbbb-1111-0000-0000-000000000001', 'BP', 's', 'a');

-- S3b: A has a valid active Gemini key (written as owner; the key RPCs are tested elsewhere).
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek,
                                     kek_id, key_last4, status)
values ('aaaaaaaa-9999-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free',
        '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'valid');
update public.profiles set active_ai_provider = 'gemini' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- 1. empty account
select is(public.get_data_readiness(), jsonb_build_object(
  'ai_connection', '{"active_provider": "gemini", "key_status": "valid", "connection_tier": "free", "consent_required": true}'::jsonb,
  'counts', jsonb_build_object(
    'complete_experiences', 0, 'complete_educations', 0, 'complete_projects', 0,
    'projects_without_complete_star', 0, 'standalone_projects_without_description', 0,
    'draft_experiences', 0, 'draft_educations', 0, 'draft_projects', 0),
  'draft_item_ids', jsonb_build_object('experiences', '[]'::jsonb, 'educations', '[]'::jsonb,
                                       'projects', '[]'::jsonb),
  'features', jsonb_build_object(
    'insight', '{"ready": false, "missing": ["complete_experience", "complete_project"], "hints": [], "next_action": "form"}'::jsonb,
    'draft', '{"ready": false, "missing": ["complete_experience", "complete_project"], "hints": [], "next_action": "form"}'::jsonb)),
  'empty account: full §6 shape (R14: insight / draft only, no data_sufficiency), form first (B''s data not counted)');

-- 2. R13 (DM v4.12 §6-A, SD-A18·SD-6): counts has no profile_filled key, hints never contain "profile",
-- and 내 정보 alone is no longer "thin" (프로필은 데이터 양의 근거가 아니다).
update public.profiles set job_search_status = 'employed_considering'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select ok(not (public.get_data_readiness() -> 'counts' ? 'profile_filled'),
          'counts has no profile_filled key');
select is(public.get_data_readiness() #> '{features,insight,missing}', '["complete_experience", "complete_project"]'::jsonb,
          '내 정보만 채워도 게이트는 그대로 (프로필은 데이터 양의 근거가 아니다)');
select is(public.get_data_readiness() #> '{features,insight,hints}', '[]'::jsonb, 'no profile hint ever');

-- 3. education only: still not ready, still form (education does not satisfy D-01)
insert into public.educations (id, institution_name, education_type, start_month)
values ('aaaaaaaa-2222-0000-0000-000000000001', 'U', 'degree', '2014-03-01');
select is(public.get_data_readiness() #> '{features,insight}',
          '{"ready": false, "missing": ["complete_experience", "complete_project"], "hints": [], "next_action": "form"}'::jsonb,
          'education only does not satisfy D-01');
select is(public.get_data_readiness() #> '{counts,complete_educations}', '1'::jsonb, 'complete education counted');

-- 4. complete experience, no project at all → create_project (AI usable)
insert into public.experiences (id, company_name, start_month, job_position)
values ('aaaaaaaa-1111-0000-0000-000000000001', 'A', '2020-01-01', 'Dev');
select is(public.get_data_readiness() #> '{features,insight}',
          '{"ready": false, "missing": ["complete_project"], "hints": [], "next_action": "create_project"}'::jsonb,
          'no project to fill + AI usable → create_project (CR-6)');

-- 5. affiliated project with STAR missing → writing_chat + suggested_project_id + project_star
insert into public.projects (id, experience_id, name)
values ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'P1');
select is(public.get_data_readiness() #> '{features,draft}',
          '{"ready": false, "missing": ["complete_project"], "hints": ["project_star"],
            "next_action": "writing_chat", "suggested_project_id": "aaaaaaaa-3333-0000-0000-000000000001"}'::jsonb,
          'STAR-incomplete affiliated project → writing_chat with its id, no suggested_mode');
select is(public.get_data_readiness() -> 'counts',
          '{"complete_experiences": 1, "complete_educations": 1, "complete_projects": 0,
            "projects_without_complete_star": 1, "standalone_projects_without_description": 0,
            "draft_experiences": 0, "draft_educations": 0, "draft_projects": 1}'::jsonb,
          'counts for the STAR case');
select is(public.get_data_readiness() -> 'draft_item_ids',
          '{"experiences": [], "educations": [], "projects": ["aaaaaaaa-3333-0000-0000-000000000001"]}'::jsonb,
          'draft_item_ids: experiences / educations / projects only');
select is(public.get_data_readiness() #> '{features,insight,missing}', '["complete_project"]'::jsonb,
          'complete experience without complete project → only complete_project missing');

-- a standalone project without description too: STAR still wins (order 2 before 3)
insert into public.projects (id, name) values ('aaaaaaaa-3333-0000-0000-000000000002', 'Side');
select is(public.get_data_readiness() #> '{features,insight,hints}', '["project_star"]'::jsonb,
          'project_star comes before project_fields');
select is(public.get_data_readiness() #>> '{counts,standalone_projects_without_description}', '1',
          'standalone project without description counted');

-- 6. filling the STAR → ready, no next_action / suggested_* keys
update public.projects set situation = 's', action = 'a' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
select is(public.get_data_readiness() #> '{features,insight}',
          '{"ready": true, "missing": [], "hints": []}'::jsonb, 'D-01 met → ready, gate keys omitted');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_data_readiness() -> 'features') k),
          array['draft', 'insight'], 'R14: features = insight / draft only');

-- 6b. draft parent excludes complete children: move the project under a draft experience
insert into public.experiences (id, company_name) values ('aaaaaaaa-1111-0000-0000-000000000002', 'draft exp');
update public.projects set experience_id = 'aaaaaaaa-1111-0000-0000-000000000002'
 where id = 'aaaaaaaa-3333-0000-0000-000000000001';
select is(public.get_data_readiness() #> '{features,insight}',
          '{"ready": false, "missing": ["complete_project"], "hints": ["project_fields"],
            "next_action": "form", "suggested_project_id": "aaaaaaaa-3333-0000-0000-000000000002"}'::jsonb,
          'complete project under a draft experience is excluded → standalone description step (project_fields)');
select results_eq(
  $$select (r #>> '{counts,complete_projects}')::int, (r #>> '{counts,projects_without_complete_star}')::int,
           (r #>> '{counts,draft_experiences}')::int
      from (select public.get_data_readiness() r) x$$,
  $$values (0, 0, 1)$$, 'draft parent: project not counted');

-- a complete standalone project counts toward D-01 (DM §6 v4.4)
update public.projects set description = '내용' where id = 'aaaaaaaa-3333-0000-0000-000000000002';
select is(public.get_data_readiness() #> '{features,insight,ready}', 'true'::jsonb,
          'standalone project with description counts toward D-01');
update public.projects set description = null where id = 'aaaaaaaa-3333-0000-0000-000000000002';

-- an education-affiliated complete project counts
update public.projects set experience_id = null, education_id = 'aaaaaaaa-2222-0000-0000-000000000001'
 where id = 'aaaaaaaa-3333-0000-0000-000000000001';
select is(public.get_data_readiness() #> '{features,insight,ready}', 'true'::jsonb,
          'project under a complete education counts toward D-01');

-- 7. app_ai_writer gets the same answer for the JWT user
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.get_data_readiness() #> '{features,insight,ready}', 'true'::jsonb,
          'app_ai_writer can run get_data_readiness for the user');
select is(public.get_data_readiness() #>> '{counts,complete_experiences}', '1', 'app_ai_writer sees A''s counts only');

-- 9. S3b ai_connection branches. Make A not ready again: the affiliated project loses its action (STAR step).
reset role;
update public.projects set action = null where id = 'aaaaaaaa-3333-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- needs_check still allows AI runs (UX C-19) → writing_chat kept.
reset role;
update public.ai_provider_keys set status = 'needs_check' where id = 'aaaaaaaa-9999-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_data_readiness() -> 'ai_connection',
          '{"active_provider": "gemini", "key_status": "needs_check", "connection_tier": "free", "consent_required": true}'::jsonb,
          'ai_connection reports needs_check');
select is(public.get_data_readiness() #>> '{features,insight,next_action}', 'writing_chat',
          'needs_check key → writing_chat still offered');

-- invalid key → form, no suggested_* keys.
reset role;
update public.ai_provider_keys set status = 'invalid' where id = 'aaaaaaaa-9999-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_data_readiness() #> '{features,insight}',
          '{"ready": false, "missing": ["complete_project"], "hints": ["project_star"], "next_action": "form",
            "suggested_project_id": "aaaaaaaa-3333-0000-0000-000000000001"}'::jsonb,
          'invalid key → STAR step becomes form, still with the project to fill');
select ok(not (public.get_data_readiness() ? 'data_sufficiency')
          and not (public.get_data_readiness() -> 'features' ? 'culture_fit_interview'),
          'R14: no data_sufficiency anywhere, no culture_fit_interview feature');

-- app_ai_writer sees the same ai_connection (definer helper; it has no ai_provider_keys privilege).
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.get_data_readiness() -> 'ai_connection',
          '{"active_provider": "gemini", "key_status": "invalid", "connection_tier": "free", "consent_required": true}'::jsonb,
          'app_ai_writer gets A''s ai_connection');

-- key deleted → FK clears active provider → all null, form.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(public.delete_provider_key('gemini'), 'A deletes the key');
select is(public.get_data_readiness() -> 'ai_connection',
          '{"active_provider": null, "key_status": null, "connection_tier": null, "consent_required": null}'::jsonb,
          'no active provider → ai_connection all null');
select is(public.get_data_readiness() #>> '{features,draft,next_action}', 'form', 'no key → form');
reset role;
delete from public.projects where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set local role authenticated;
select is(public.get_data_readiness() #> '{features,insight}',
          '{"ready": false, "missing": ["complete_project"], "hints": [], "next_action": "form"}'::jsonb,
          'nothing to fill and no key → form instead of create_project');
select is(public.get_data_readiness() #>> '{features,draft,next_action}', 'form', 'no key → form (draft)');

-- B's key never shows in A's ai_connection.
reset role;
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek,
                                     kek_id, key_last4, status)
values ('bbbbbbbb-9999-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'openai', 'paid',
        '\x01', '\x02', '\x03', 'env-v1', 'wxyz', 'valid');
update public.profiles set active_ai_provider = 'openai' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_data_readiness() #>> '{ai_connection,active_provider}', null, 'B''s active key not visible to A');

-- 8. auth errors
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select public.get_data_readiness()$$, '42501', 'not_authenticated', 'no sub → not_authenticated');

reset role;
set local role anon;
select throws_ok($$select public.get_data_readiness()$$, '42501', null, 'anon cannot execute get_data_readiness');

select * from finish();
rollback;
