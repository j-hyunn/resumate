-- S5 application_projects / job_descriptions / jd_requirements / application_stage_events:
-- RLS, cross-user isolation, column limits, create_application_project (name rules D-30, idempotency, validation).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- RLS on and the exact policy sets (DM §5).
select ok((select bool_and(relrowsecurity) from pg_class
            where oid in ('public.application_projects'::regclass, 'public.application_stage_events'::regclass,
                          'public.job_descriptions'::regclass, 'public.jd_requirements'::regclass)),
          'RLS enabled on the 4 S5 tables');
select policies_are('public', 'application_projects',
  array['application_projects_select_own', 'application_projects_update_own', 'application_projects_delete_own',
        'application_projects_select_ai_writer']);
select policies_are('public', 'application_stage_events', array['application_stage_events_select_own']);
select policies_are('public', 'job_descriptions', array['job_descriptions_select_own', 'job_descriptions_select_ai_writer']);
select policies_are('public', 'jd_requirements', array['jd_requirements_select_own', 'jd_requirements_select_ai_writer']);
select ok((select bool_and(prosecdef) from pg_proc
            where proname in ('create_application_project', 'move_application_stage', 'set_application_outcome',
                              'begin_jd_extraction', 'apply_jd_extraction', 'fail_jd_extraction')
              and pronamespace = 'public'::regnamespace),
          'S5 RPCs are security definer');

-- B has a usable key (gemini free, valid, current consent) and is the active provider.
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status)
values ('b0000000-9999-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'gemini', 'free',
        '\x01', '\x02', '\x03', 'env-v1', 'bg01', 'valid');
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged)
values ('b0000000-0000-0000-0000-000000000002', 'gemini', 'free', 'v2026-10-29', true);
update public.profiles set active_ai_provider = 'gemini' where id = 'b0000000-0000-0000-0000-000000000002';

create temp table t_s (v jsonb);
insert into t_s values ('[{"sid":"S1","text":"에이비씨페이 백엔드","start":0,"end":10},{"sid":"S2","text":"Java 경험","start":11,"end":18}]');
grant select on t_s to authenticated;

-- ── A: no key ────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000001', '에이비씨페이 백엔드' || chr(10) || 'Java 경험',
            'hash1', (select v from t_s), null, null, null, '2026-11-30') - 'job_description_id',
          '{"application_project_id":"a0000000-aaaa-0000-0000-000000000001","name":null,"name_source":"default",
            "extraction_status":"pending","ai_run_allowed":false,"created":true}'::jsonb
            || jsonb_build_object('name', '새 기업 JD (' || to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ')'),
          'no key, no company/position -> default name (KST date)');
select is((select array[stage, coalesce(stage_outcome, '-'), deadline::text] from public.application_projects
            where id = 'a0000000-aaaa-0000-0000-000000000001'),
          array['before_apply', '-', '2026-11-30'], 'new project starts at before_apply with the deadline');
select results_eq($$select event_type, from_stage, to_stage, from_outcome, to_outcome from public.application_stage_events
                    where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                  $$values ('created'::text, null::text, 'before_apply'::text, null::text, null::text)$$,
                  'created event recorded');
select is((select array[raw_text_hash, extraction_status, coalesce(company_name, '-')] from public.job_descriptions
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'),
          array['hash1', 'pending', '-'], 'JD stored pending');

select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000002', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]', '  에이비씨페이 ', '백엔드 엔지니어', null, null)
            ->> 'name',
          '에이비씨페이 – 백엔드 엔지니어', 'no key + company and position -> composed name');
select is((select name_source from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000002'),
          'user', 'composed key-less name is user-sourced [가정 2]');
select is((select array[company_name, company_name_source, position_title, position_title_source] from public.job_descriptions
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000002'),
          array['에이비씨페이', 'user', '백엔드 엔지니어', 'user'], 'user-entered company / position trimmed, source user');

select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000003', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]', '에이비씨페이', null, null, null) ->> 'name_source',
          'default', 'no key + company only -> default name');
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000004', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]', null, null, '  내 지원  ', null)
            - 'job_description_id' - 'application_project_id',
          '{"name":"내 지원","name_source":"user","extraction_status":"pending","ai_run_allowed":false,"created":true}'::jsonb,
          'user name wins');
select is(char_length(public.create_application_project('a0000000-aaaa-0000-0000-000000000005', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]', repeat('가', 80), repeat('나', 80), null, null) ->> 'name'),
          100, 'composed name cut to 100 chars');

-- Idempotent replay: same id returns the stored row; inputs are ignored.
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000004', '다른 원문', 'h2',
            '[{"sid":"S1","text":"다른","start":0,"end":2}]', null, null, '다른 이름', null)
            - 'job_description_id' - 'application_project_id',
          '{"name":"내 지원","name_source":"user","extraction_status":"pending","ai_run_allowed":false,"created":false}'::jsonb,
          'replay with the same id returns the existing row (created=false)');
select is((select count(*)::int from public.job_descriptions where application_project_id = 'a0000000-aaaa-0000-0000-000000000004'),
          1, 'replay did not create a second JD');
select is((select count(*)::int from public.application_stage_events where application_project_id = 'a0000000-aaaa-0000-0000-000000000004'),
          1, 'replay did not create a second created event');

-- Validation.
select throws_ok($$select public.create_application_project(null, '원문', 'h', '[{"sid":"S1","text":"x","start":0,"end":1}]')$$,
                 'P0001', 'invalid_id', 'null id');
select throws_ok($$select public.create_application_project(gen_random_uuid(), '   ', 'h', '[{"sid":"S1","text":"x","start":0,"end":1}]')$$,
                 'P0001', 'invalid_raw_text', 'blank raw text');
select throws_ok($$select public.create_application_project(gen_random_uuid(), repeat('a', 50001), 'h', '[{"sid":"S1","text":"x","start":0,"end":1}]')$$,
                 'P0001', 'invalid_raw_text', 'raw text over 50,000');
select lives_ok($$select public.create_application_project(gen_random_uuid(), repeat('a', 50000), 'h', '[{"sid":"S1","text":"x","start":0,"end":1}]')$$,
                'raw text of exactly 50,000 accepted');
select throws_ok($$select public.create_application_project(gen_random_uuid(), '원문', ' ', '[{"sid":"S1","text":"x","start":0,"end":1}]')$$,
                 'P0001', 'invalid_raw_text_hash', 'blank hash');
-- QA-S5-01: a JD that splits into 0 sentences is still saved (extraction then ends as not_a_jd).
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000009', '----', 'h', '[]') ->> 'extraction_status',
          'pending', 'empty sentences accepted (raw JD always saved)');
select is((select sentences from public.job_descriptions where application_project_id = 'a0000000-aaaa-0000-0000-000000000009'),
          '[]'::jsonb, 'empty sentences stored');
select throws_ok($$select public.create_application_project(gen_random_uuid(), '원문', 'h', null)$$,
                 'P0001', 'invalid_sentences', 'null sentences');
select throws_ok($$select public.create_application_project(gen_random_uuid(), '원문', 'h', '{"sid":"S1"}')$$,
                 'P0001', 'invalid_sentences', 'sentences not an array');
select throws_ok($$select public.create_application_project(gen_random_uuid(), '원문', 'h',
                   '[{"sid":"S1","text":"x","start":0,"end":1},{"sid":"S3","text":"y","start":2,"end":3}]')$$,
                 'P0001', 'invalid_sentences', 'sid gap');
select throws_ok($$select public.create_application_project(gen_random_uuid(), '원문', 'h', '[{"sid":"S1","text":"x","start":2,"end":2}]')$$,
                 'P0001', 'invalid_sentences', 'start >= end');
select throws_ok($$select public.create_application_project(gen_random_uuid(), '원문', 'h', '[{"sid":"S1","start":0,"end":1}]')$$,
                 'P0001', 'invalid_sentences', 'missing text');
select throws_ok($$select public.create_application_project(gen_random_uuid(), '원문', 'h', '[{"sid":"S1","text":"x","start":-1,"end":1}]')$$,
                 'P0001', 'invalid_sentences', 'negative start');
select throws_ok($$select public.create_application_project(gen_random_uuid(), '원문', 'h', '[{"sid":"S1","text":"x","start":0,"end":1}]',
                   null, null, repeat('a', 101))$$, 'P0001', 'invalid_name', 'name over 100');
select throws_ok($$select public.create_application_project(gen_random_uuid(), '원문', 'h', '[{"sid":"S1","text":"x","start":0,"end":1}]',
                   repeat('a', 201))$$, 'P0001', 'invalid_company_name', 'company over 200');
select throws_ok($$select public.create_application_project(gen_random_uuid(), '원문', 'h', '[{"sid":"S1","text":"x","start":0,"end":1}]',
                   null, repeat('a', 201))$$, 'P0001', 'invalid_position_title', 'position over 200');

-- Direct writes (DM §5).
select throws_ok($$insert into public.application_projects (name, name_source) values ('x', 'user')$$,
                 '42501', null, 'user cannot insert application_projects directly');
select throws_ok($$insert into public.job_descriptions (application_project_id, raw_text, raw_text_hash, sentences)
                   values ('a0000000-aaaa-0000-0000-000000000001', 'x', 'h', '[{"sid":"S1","text":"x","start":0,"end":1}]')$$,
                 '42501', null, 'user cannot insert job_descriptions');
select throws_ok($$insert into public.application_stage_events (application_project_id, event_type, to_stage)
                   values ('a0000000-aaaa-0000-0000-000000000001', 'created', 'before_apply')$$,
                 '42501', null, 'user cannot insert stage events');
select throws_ok($$update public.application_projects set stage = 'closed' where id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                 '42501', null, 'user cannot update stage directly');
select throws_ok($$update public.application_projects set stage_outcome = 'passed' where id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                 '42501', null, 'user cannot update stage_outcome directly');
select throws_ok($$update public.application_projects set stage_changed_at = now() where id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                 '42501', null, 'user cannot update stage_changed_at directly');
select throws_ok($$update public.application_projects set name_source = 'ai' where id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                 '42501', null, 'user cannot update name_source directly');
select throws_ok($$update public.job_descriptions set extraction_status = 'succeeded'$$,
                 '42501', null, 'user cannot update job_descriptions');
select throws_ok($$delete from public.job_descriptions$$, '42501', null, 'user cannot delete job_descriptions');
select throws_ok($$update public.application_stage_events set to_stage = 'closed'$$, '42501', null, 'user cannot update events');
select throws_ok($$delete from public.application_stage_events$$, '42501', null, 'user cannot delete events');

-- Allowed direct updates: name / deadline / memo (trigger: name_source = user, last_activity_at).
reset role;
update public.application_projects set last_activity_at = now() - interval '1 day'
 where id = 'a0000000-aaaa-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$update public.application_projects set name = '  에이비씨 지원  ' where id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                'user renames');
select is((select array[name, name_source, (last_activity_at > now() - interval '1 minute')::text]
             from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000001'),
          array['에이비씨 지원', 'user', 'true'], 'rename trimmed, name_source user, last_activity_at bumped');
select lives_ok($$update public.application_projects set memo = '메모', deadline = '2026-12-01'
                   where id = 'a0000000-aaaa-0000-0000-000000000001'$$, 'user edits memo and deadline');
select throws_ok($$update public.application_projects set name = '  ' where id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                 'P0001', 'invalid_name', 'blank rename refused');
select throws_ok($$update public.application_projects set name = null where id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                 'P0001', 'invalid_name', 'clearing the name refused');
select throws_ok($$update public.application_projects set name = repeat('a', 101) where id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                 'P0001', 'invalid_name', 'rename over 100 refused');
select throws_ok($$update public.application_projects set memo = repeat('a', 2001) where id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                 '23514', null, 'memo over 2,000 refused');

-- ── B: usable key ────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.create_application_project('b0000000-aaaa-0000-0000-000000000001', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]', '회사', '포지션', null, null)
            - 'job_description_id' - 'application_project_id',
          '{"name":null,"name_source":null,"extraction_status":"pending","ai_run_allowed":true,"created":true}'::jsonb,
          'usable key -> name waits for extraction (null) even with company / position');
select throws_ok($$select public.create_application_project('a0000000-aaaa-0000-0000-000000000001', '원문', 'h',
                   '[{"sid":"S1","text":"원문","start":0,"end":2}]')$$,
                 'P0001', 'application_project_id_conflict', 'another user''s id refused');

-- Cross-user isolation (B sees / changes nothing of A).
select is((select count(*)::int from public.application_projects where user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'B cannot read A projects');
select is((select count(*)::int from public.job_descriptions where user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'B cannot read A JDs');
select is((select count(*)::int from public.application_stage_events where user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'B cannot read A events');
select is_empty($$update public.application_projects set name = 'hack' where id = 'a0000000-aaaa-0000-0000-000000000001' returning id$$,
                'B cannot rename A project');
select is_empty($$delete from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000001' returning id$$,
                'B cannot delete A project');
select throws_ok($$select public.move_application_stage('a0000000-aaaa-0000-0000-000000000001', 'document')$$,
                 'P0001', 'application_project_not_found', 'B cannot move A project');
select throws_ok($$select public.set_application_outcome('a0000000-aaaa-0000-0000-000000000001', 'passed')$$,
                 'P0001', 'application_project_not_found', 'B cannot set A outcome');

-- Invalid key -> not allowed -> fallback name.
reset role;
update public.ai_provider_keys set status = 'invalid' where id = 'b0000000-9999-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.create_application_project('b0000000-aaaa-0000-0000-000000000002', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]', '회사', '포지션') ->> 'name',
          '회사 – 포지션', 'invalid key -> key-less naming');

-- Anonymous callers.
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.create_application_project(gen_random_uuid(), 'x', 'h', '[{"sid":"S1","text":"x","start":0,"end":1}]')$$,
                 '42501', null, 'anon cannot create');
select throws_ok($$select count(*) from public.application_projects$$, '42501', null, 'anon cannot read projects');
reset role;

-- JD immutability (D-19) holds for every role, owner included.
select throws_ok($$update public.job_descriptions set raw_text = 'x' where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                 'P0001', 'job_description_immutable', 'raw_text immutable');
select throws_ok($$update public.job_descriptions set sentences = '[{"sid":"S1","text":"x","start":0,"end":1}]'
                    where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                 'P0001', 'job_description_immutable', 'sentences immutable');

-- CHECKs.
select throws_ok($$update public.application_projects set stage_outcome = 'passed' where id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                 '23514', null, 'outcome only when closed');
select throws_ok($$update public.application_projects set name = null where id = 'a0000000-aaaa-0000-0000-000000000004'$$,
                 '23514', null, 'name null requires name_source null');
select throws_ok($$insert into public.jd_requirements (user_id, job_description_id, category, content, source_sids)
                   select user_id, id, 'required', 'x', '{}' from public.job_descriptions
                    where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                 '23514', null, 'requirement needs at least one source sid');
select throws_ok($$insert into public.jd_requirements (user_id, job_description_id, category, content, source_sids)
                   select user_id, id, 'required', 'x', '{X1}' from public.job_descriptions
                    where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                 '23514', null, 'source sid shape');

select * from finish();
rollback;
