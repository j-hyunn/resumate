-- R15 (DM 11.10 #1·#2·#4·#5·#5a·#5b·#9, §2.6, §2.6.2 — CF-2·CF-9·CF-10·CF-A5·CF-A7·CF-A8·CF-A17, AI 요청 1~3):
-- job_descriptions.source_url, the (user_id, created_at desc) index, the jd_preview ai_jobs combination,
-- create_application_project's preview linking / applying / skipping, apply_jd_extraction's deadline branch, and
-- the unused-preview cleanup.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- Helpers: the server's sha256 hex over the SAME string it stores and splits (DM §2.6.2 normalization).
create schema r15t;
grant usage on schema r15t to authenticated, app_ai_writer;
create function r15t.h(p_text text) returns text language sql immutable as $$
  select lower(encode(extensions.digest(p_text, 'sha256'), 'hex'));
$$;
create function r15t.sents(p_text text) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('sid', 'S1', 'text', p_text, 'start', 0,
                                              'end', char_length(p_text)));
$$;
create function r15t.result(p_deadline text, p_sids jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'extraction', '{}'::jsonb, 'requirements_hash', 'rh', 'detected_language', 'ko',
    'tech_keywords', '[]'::jsonb,
    'company_name', jsonb_build_object('value', '에이비씨페이', 'source_sids', '["S1"]'::jsonb),
    'position_title', jsonb_build_object('value', '백엔드', 'source_sids', '["S1"]'::jsonb),
    'deadline', jsonb_build_object('value', p_deadline, 'source_sids', p_sids),
    'requirements', jsonb_build_array(jsonb_build_object(
      'category', 'required', 'content', 'Java', 'keywords', '["Java"]'::jsonb,
      'importance', 'normal', 'source_sids', '["S1"]'::jsonb)));
$$;

grant execute on all functions in schema r15t to authenticated, app_ai_writer;

-- ── schema (11.10 #1·#5·#5a) ──
select has_column('public', 'job_descriptions', 'source_url', 'job_descriptions.source_url added');
select has_index('public', 'application_projects', 'application_projects_user_id_created_at_idx',
                 'S-13 "최근 작성 순" index (user_id, created_at desc)');
select ok(not has_column_privilege('authenticated', 'public.job_descriptions', 'source_url', 'UPDATE'),
          'no user update grant on source_url (the create RPC writes it)');
select ok(not has_column_privilege('app_ai_writer', 'public.job_descriptions', 'source_url', 'SELECT'),
          'app_ai_writer cannot read source_url (a URL never goes into a prompt)');
select throws_ok($$insert into public.job_descriptions (user_id, application_project_id, raw_text, raw_text_hash,
                                                        sentences, source_url)
                   values ('a0000000-0000-0000-0000-000000000001', null, 'x', 'h', '[]', 'ftp://x.test')$$,
                 '23502', null, 'the CHECK and the FK both guard the row (ftp never reaches the DB)');

-- ── ai_jobs: the jd_preview combination (CF-A17) ──
select lives_ok($$insert into public.ai_jobs (id, user_id, job_type, target_type, target_id,
                    application_project_id, status, run_generation, provider, model_tier, connection_tier,
                    params, finished_at, output)
                  values ('a0000000-7777-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
                          'jd_extraction', 'jd_preview', null, null, 'succeeded', 1, 'gemini', 'light', 'free',
                          '{}'::jsonb, now(), '{}'::jsonb)$$,
                'jd_preview before linking: target_id and application_project_id both null');
select throws_ok($$insert into public.ai_jobs (user_id, job_type, target_type, target_id,
                     application_project_id, status, run_generation, provider, model_tier, connection_tier)
                   values ('a0000000-0000-0000-0000-000000000001', 'jd_extraction', 'jd_preview',
                           'a0000000-1d00-0000-0000-00000000ffff', null, 'succeeded', 1, 'gemini', 'light',
                           'free')$$,
                 '23514', null, 'jd_preview with only one of the two keys filled is refused');
delete from public.ai_jobs;

-- ── create_application_project: source_url and the preview ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.create_application_project('a0000000-aaaa-0000-0000-00000000000e', '원문', 'h',
                     '[{"sid":"S1","text":"원문","start":0,"end":2}]', null, null, null, null, 'ftp://x.test')$$,
                 'P0001', 'invalid_source_url', 'a non-http(s) source_url -> invalid_source_url (400)');
select throws_ok(format($$select public.create_application_project('a0000000-aaaa-0000-0000-00000000000e', '원문',
                     'h', '[{"sid":"S1","text":"원문","start":0,"end":2}]', null, null, null, null, '%s')$$,
                     'https://x.test/' || repeat('a', 2048)),
                 'P0001', 'invalid_source_url', 'a source_url over 2,048 characters -> invalid_source_url');
select is((select count(*)::int from public.application_projects where user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'an invalid_source_url wrote no row (the screen may resend the same p_id without it)');
select ok(public.create_application_project('a0000000-aaaa-0000-0000-00000000000e', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]', null, null, null, null,
            'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1&utm_source=x') ? 'created',
          'a valid source_url is accepted');
select is((select source_url from public.job_descriptions
            where application_project_id = 'a0000000-aaaa-0000-0000-00000000000e'),
          'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1&utm_source=x',
          'the URL is stored as given, tracking query included (DM §2.6 `[가정]`)');

-- preview_not_found: no such run / not the caller's / already linked.
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000001', '원문 A', r15t.h('원문 A'),
            r15t.sents('원문 A'), null, null, null, null, null, 'a0000000-7777-0000-0000-0000000000ff')
            ->> 'preview_skip_reason', 'preview_not_found', 'an unknown p_preview_job_id -> preview_not_found');
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000001', '원문 A', r15t.h('원문 A'),
            r15t.sents('원문 A'))->> 'created', 'false', 'the same p_id is a replay');
reset role;

-- A preview run of A, finished now, over '원문 A'.
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, application_project_id, status,
                            run_generation, provider, model, model_tier, connection_tier, params, output,
                            finished_at)
values ('a0000000-7777-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'jd_extraction',
        'jd_preview', null, null, 'succeeded', 1, 'gemini', 'gemini-3-flash', 'light', 'free',
        jsonb_build_object('raw_text_hash', r15t.h('원문 A'), 'sentence_count', 1),
        r15t.result(to_char((now() at time zone 'Asia/Seoul')::date + 10, 'YYYY-MM-DD'), '["S1"]'::jsonb),
        now());
insert into public.ai_usage_records (id, user_id, occurred_at, feature, job_type, ai_job_id, provider, model,
                                     model_tier, connection_tier, usage_source, outcome, price_table_version,
                                     estimated_cost_usd)
values ('a0000000-0e5e-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', now(), 'jd_extraction',
        'jd_extraction', 'a0000000-7777-0000-0000-000000000001', 'gemini', 'gemini-3-flash', 'light', 'free',
        'provider_reported', 'succeeded', 'v1', 0.01);
-- A preview run of B (another user).
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, application_project_id, status,
                            run_generation, provider, model, model_tier, connection_tier, params, output,
                            finished_at)
values ('b0000000-7777-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'jd_extraction',
        'jd_preview', null, null, 'succeeded', 1, 'gemini', 'gemini-3-flash', 'light', 'free',
        jsonb_build_object('raw_text_hash', r15t.h('원문 A'), 'sentence_count', 1),
        r15t.result(null, '[]'::jsonb), now());
-- An expired preview run of A.
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, application_project_id, status,
                            run_generation, provider, model, model_tier, connection_tier, params, output,
                            finished_at)
values ('a0000000-7777-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'jd_extraction',
        'jd_preview', null, null, 'succeeded', 1, 'gemini', 'gemini-3-flash', 'light', 'free',
        jsonb_build_object('raw_text_hash', r15t.h('원문 A'), 'sentence_count', 1),
        r15t.result(null, '[]'::jsonb), now() - interval '25 hours');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- Another user's run is not usable and is not linked.
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000002', '원문 A', r15t.h('원문 A'),
            r15t.sents('원문 A'), null, null, null, null, null, 'b0000000-7777-0000-0000-000000000002')
            ->> 'preview_skip_reason', 'preview_not_found', 'another user''s preview run -> preview_not_found');
-- (checked below with RLS off: ai_jobs select is per user)

reset role;
select is((select num_nonnulls(target_id, application_project_id) from public.ai_jobs
            where id = 'b0000000-7777-0000-0000-000000000002'),
          0, 'another user''s run is not linked');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- preview_expired: linked anyway (the tokens belong to this application) but not applied.
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000003', '원문 A', r15t.h('원문 A'),
            r15t.sents('원문 A'), null, null, null, null, null, 'a0000000-7777-0000-0000-000000000003')
            - 'job_description_id' - 'application_project_id' - 'name',
          '{"name_source":"default","extraction_status":"pending","ai_run_allowed":false,"created":true,
            "preview_applied":false,"preview_skip_reason":"preview_expired"}'::jsonb,
          'a run finished more than 24h ago -> preview_expired, extraction_status stays pending');
select is((select application_project_id::text from public.ai_jobs
            where id = 'a0000000-7777-0000-0000-000000000003'),
          'a0000000-aaaa-0000-0000-000000000003', 'an expired run is still linked `[가정]`');

-- preview_mismatch: the RPC recomputes the hash from p_raw_text and does not trust p_raw_text_hash (AI 요청 2).
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000004', '고친 원문',
            r15t.h('원문 A'), r15t.sents('고친 원문'), null, null, null, null, null,
            'a0000000-7777-0000-0000-000000000001') ->> 'preview_skip_reason',
          'preview_mismatch',
          'a forged p_raw_text_hash does not apply the preview: the RPC recomputes sha256 from p_raw_text');
select is((select target_id::text from public.ai_jobs where id = 'a0000000-7777-0000-0000-000000000001'),
          (select id::text from public.job_descriptions
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000004'),
          'the discarded run is linked to this application''s JD');
select is((select application_project_id::text from public.ai_usage_records
            where ai_job_id = 'a0000000-7777-0000-0000-000000000001'),
          'a0000000-aaaa-0000-0000-000000000004', 'and its usage row gets the application project');
select is((select extraction_status from public.job_descriptions
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000004'),
          'pending', 'a discarded preview leaves extraction_status pending (the server then runs AI-01 once)');
reset role;

-- A fresh, matching preview run for the apply path, with a deadline 10 days out.
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, application_project_id, status,
                            run_generation, provider, model, model_tier, connection_tier, params, output,
                            finished_at)
values ('a0000000-7777-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'jd_extraction',
        'jd_preview', null, null, 'succeeded', 1, 'gemini', 'gemini-3-flash', 'light', 'free',
        jsonb_build_object('raw_text_hash', r15t.h('원문 B'), 'sentence_count', 1),
        r15t.result(to_char((now() at time zone 'Asia/Seoul')::date + 10, 'YYYY-MM-DD'), '["S1"]'::jsonb),
        now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.r', public.create_application_project('a0000000-aaaa-0000-0000-000000000005', '원문 B',
                    'ignored-hash', r15t.sents('원문 B'), null, null, null, null, 'https://x.test/jd',
                    'a0000000-7777-0000-0000-000000000004')::text, true);
select is((current_setting('t.r')::jsonb) -> 'preview_applied', 'true'::jsonb,
          'a matching recomputed hash + sentence count applies the preview in the same transaction');
select is((current_setting('t.r')::jsonb) ->> 'extraction_status', 'succeeded', 'extraction_status = succeeded');
select is((current_setting('t.r')::jsonb) ->> 'name', '에이비씨페이 자기소개서',
          'the name is built from the extracted company name ("{회사명} 자기소개서", CF-9)');
select is((current_setting('t.r')::jsonb) ->> 'name_source', 'ai', 'name_source = ai (the blank step-2 field)');
select is((select count(*)::int from public.jd_requirements jr
             join public.job_descriptions jd on jd.id = jr.job_description_id
            where jd.application_project_id = 'a0000000-aaaa-0000-0000-000000000005'),
          1, 'the requirements of the preview run are stored');
select is((select array[company_name, company_name_source, extraction_provider, extraction_model]
             from public.job_descriptions where application_project_id = 'a0000000-aaaa-0000-0000-000000000005'),
          array['에이비씨페이', 'ai', 'gemini', 'gemini-3-flash'],
          'the run''s provider / model are recorded on the JD');
select is((select deadline from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000005'),
          ((now() at time zone 'Asia/Seoul')::date + 10),
          'the extracted deadline is written because the project had none (CF-2)');
select is((select target_id::text from public.ai_jobs where id = 'a0000000-7777-0000-0000-000000000004'),
          (select id::text from public.job_descriptions
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000005'),
          'the applied run is linked');
-- A step-2 value is never overwritten by the preview.
reset role;
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, application_project_id, status,
                            run_generation, provider, model, model_tier, connection_tier, params, output,
                            finished_at)
values ('a0000000-7777-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'jd_extraction',
        'jd_preview', null, null, 'succeeded', 1, 'gemini', 'gemini-3-flash', 'light', 'free',
        jsonb_build_object('raw_text_hash', r15t.h('원문 C'), 'sentence_count', 1),
        r15t.result(null, '[]'::jsonb), now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.r', public.create_application_project('a0000000-aaaa-0000-0000-000000000006', '원문 C',
                    r15t.h('원문 C'), r15t.sents('원문 C'), '내가 쓴 회사', null, null, '2026-12-25', null,
                    'a0000000-7777-0000-0000-000000000005')::text, true);
select is((current_setting('t.r')::jsonb) ->> 'name', '내가 쓴 회사 자기소개서',
          'the user''s step-2 company name wins and names the application (CF-A6)');
select is((select array[company_name, company_name_source, position_title, position_title_source]
             from public.job_descriptions where application_project_id = 'a0000000-aaaa-0000-0000-000000000006'),
          array['내가 쓴 회사', 'user', '백엔드', 'ai'],
          'only the blank step-2 field is filled from the extraction');
select is((select deadline from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000006'),
          '2026-12-25'::date, 'a deadline the user gave is not overwritten');
reset role;

-- ── apply_jd_extraction: the deadline branch (11.10 #4) ──
-- Each call builds its own application project + JD (the job_descriptions guard refuses succeeded -> running),
-- optionally with a deadline already set, runs AI-01's apply and returns the result.
create function r15t.extract(p_deadline text, p_sids jsonb, p_preset date default null) returns jsonb
language plpgsql as $$
declare
  v_pid uuid := gen_random_uuid();
  v_jd uuid := gen_random_uuid();
  v_job uuid := gen_random_uuid();
  v_out jsonb;
begin
  insert into public.application_projects (id, user_id, name, name_source, deadline)
  values (v_pid, 'a0000000-0000-0000-0000-000000000001', 'P', 'user', p_preset);
  insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences)
  values (v_jd, 'a0000000-0000-0000-0000-000000000001', v_pid, '원문', 'h', r15t.sents('원문'));
  insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, application_project_id, status,
                              run_generation, provider, model, model_tier, connection_tier)
  values (v_job, 'a0000000-0000-0000-0000-000000000001', 'jd_extraction', 'job_description', v_jd, v_pid,
          'running', 1, 'gemini', 'm', 'light', 'free');
  update public.job_descriptions set extraction_status = 'running', extraction_job_id = v_job where id = v_jd;
  -- Called as the migration owner: the app_ai_writer execute grant is covered by s5_first_call_privileges.
  v_out := public.apply_jd_extraction(v_jd, v_job, 1, r15t.result(p_deadline, p_sids), 'gemini', 'm');
  update public.ai_jobs set status = 'succeeded', finished_at = now() where id = v_job;
  return v_out;
end;
$$;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- A sid outside this JD's split drops the value only (the company-name rule).
select is(r15t.extract(to_char((now() at time zone 'Asia/Seoul')::date + 5, 'YYYY-MM-DD'), '["S9"]'::jsonb)
            ->> 'deadline',
          null, 'deadline.source_sids outside the split -> the value is dropped');
select is(r15t.extract('2026-02-30', '["S1"]'::jsonb) ->> 'deadline',
          null, 'a calendar-invalid date is ignored, the extraction still succeeds');
select is(r15t.extract('상시 채용', '["S1"]'::jsonb) ->> 'deadline',
          null, 'a non-date string is ignored');
select is(r15t.extract(to_char((now() at time zone 'Asia/Seoul')::date - 1, 'YYYY-MM-DD'), '["S1"]'::jsonb)
            ->> 'deadline',
          null, 'a date before KST today is not written');
select is(r15t.extract(to_char((now() at time zone 'Asia/Seoul')::date + 367, 'YYYY-MM-DD'), '["S1"]'::jsonb)
            ->> 'deadline',
          null, 'a date more than 366 days out is not written');
select is((r15t.extract(to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD'), '["S1"]'::jsonb)
            ->> 'deadline')::date,
          (now() at time zone 'Asia/Seoul')::date, 'KST today is the inclusive lower bound');
select is((r15t.extract(to_char((now() at time zone 'Asia/Seoul')::date + 366, 'YYYY-MM-DD'), '["S1"]'::jsonb)
            ->> 'deadline')::date,
          ((now() at time zone 'Asia/Seoul')::date + 366), 'today + 366 is the inclusive upper bound');
-- An old schema-1 result (no deadline key) passes through untouched.
create function r15t.extract_no_deadline() returns jsonb language plpgsql as $$
declare
  v_pid uuid := gen_random_uuid();
  v_jd uuid := gen_random_uuid();
  v_job uuid := gen_random_uuid();
begin
  insert into public.application_projects (id, user_id, name, name_source)
  values (v_pid, 'a0000000-0000-0000-0000-000000000001', 'P', 'user');
  insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences)
  values (v_jd, 'a0000000-0000-0000-0000-000000000001', v_pid, '원문', 'h', r15t.sents('원문'));
  insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, application_project_id, status,
                              run_generation, provider, model, model_tier, connection_tier)
  values (v_job, 'a0000000-0000-0000-0000-000000000001', 'jd_extraction', 'job_description', v_jd, v_pid,
          'running', 1, 'gemini', 'm', 'light', 'free');
  update public.job_descriptions set extraction_status = 'running', extraction_job_id = v_job where id = v_jd;
  return public.apply_jd_extraction(v_jd, v_job, 1, r15t.result(null, '[]'::jsonb) - 'deadline', 'gemini', 'm');
end;
$$;
select is(r15t.extract_no_deadline() ->> 'deadline', null,
          'a schema-1 result without the deadline key passes through (key missing = ignored)');
-- A user value is never overwritten by a later extraction (coalesce, CF-2).
select is((r15t.extract(to_char((now() at time zone 'Asia/Seoul')::date + 3, 'YYYY-MM-DD'), '["S1"]'::jsonb,
            '2027-01-01'::date) ->> 'deadline')::date,
          '2027-01-01'::date, 'a deadline already set is kept');

-- ── the unused-preview cleanup (11.10 #5a·#9) ──
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, application_project_id, status,
                            run_generation, provider, model, model_tier, connection_tier, params, output,
                            step_outputs, finished_at)
values ('a0000000-7777-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'jd_extraction',
        'jd_preview', null, null, 'succeeded', 1, 'gemini', 'm', 'light', 'free', '{}'::jsonb,
        '{"k":1}'::jsonb, '{"s":1}'::jsonb, now() - interval '25 hours'),
       ('a0000000-7777-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000001', 'jd_extraction',
        'jd_preview', null, null, 'succeeded', 1, 'gemini', 'm', 'light', 'free', '{}'::jsonb,
        '{"k":1}'::jsonb, '{"s":1}'::jsonb, now() - interval '23 hours');
select is(public.purge_unused_jd_preview_outputs(), 1, 'only the run finished more than 24h ago is cleared');
select results_eq($$select id::text, output, step_outputs from public.ai_jobs
                     where id in ('a0000000-7777-0000-0000-00000000000a', 'a0000000-7777-0000-0000-00000000000b')
                     order by id$$,
                  $$values ('a0000000-7777-0000-0000-00000000000a'::text, null::jsonb, '{}'::jsonb),
                           ('a0000000-7777-0000-0000-00000000000b', '{"k": 1}'::jsonb, '{"s": 1}'::jsonb)$$,
                  'output -> null and step_outputs -> {} ; the job row itself stays (90-day retention)');
select is(public.purge_unused_jd_preview_outputs(), 0, 'the cleanup is idempotent');
-- A linked run keeps its output.
select is((select output from public.ai_jobs where id = 'a0000000-7777-0000-0000-000000000004') is not null, true,
          'a linked preview run keeps its output (it is an ordinary jd_extraction run)');

select * from finish();
rollback;
