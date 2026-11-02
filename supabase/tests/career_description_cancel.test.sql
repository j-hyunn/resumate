-- W0 Q53-7 (DM 2.7.1, A.9): a stopped career description ends without blocks and back in the previous state.
-- First generation -> composing; regeneration -> new row deleted; failures stay failed; validated first stays ready;
-- begin_career_description replaces the composing row; one composing row per project.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();
create schema w0t;
grant usage on schema w0t to authenticated, app_ai_writer;

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.experiences (id, company_name, start_month, job_rank)
  values ('a0000000-1111-0000-0000-000000000001', 'A사', '2020-01-01', 'S');
insert into public.projects (id, experience_id, name, role)
  values ('a0000000-3333-0000-0000-000000000001', 'a0000000-1111-0000-0000-000000000001', '결제', 'Dev');
reset role;

insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '에이', 'user'),
  ('a0000000-aaaa-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '비', 'user');
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                     extraction_status, extraction, tech_keywords, requirements_hash,
                                     extraction_provider, extraction_model)
select ('a0000000-dddd-0000-0000-00000000000' || n)::uuid, 'a0000000-0000-0000-0000-000000000001',
       ('a0000000-aaaa-0000-0000-00000000000' || n)::uuid, '결제', 'h', '[{"sid":"S1","text":"결제","start":0,"end":2}]',
       'succeeded', '{}', '[]', 'rh', 'gemini', 'm'
  from generate_series(1, 2) n;

create temp table t_opt (v jsonb);
insert into t_opt values ('{"included_experience_ids":["a0000000-1111-0000-0000-000000000001"],
  "included_education_ids":[], "included_project_ids":["a0000000-3333-0000-0000-000000000001"],
  "project_order":["a0000000-3333-0000-0000-000000000001"], "selection_origin":"user", "tone":"detailed"}');
create temp table t_sec (v jsonb);
insert into t_sec values ('[{"section_kind":"experience","experience_id":"a0000000-1111-0000-0000-000000000001","heading":"A사"}]');
grant select on t_opt, t_sec to app_ai_writer;

create function w0t.did(n int) returns uuid language sql immutable as
  $$ select ('a0000000-eeee-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function w0t.jid(n int) returns uuid language sql immutable as
  $$ select ('a0000000-7777-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

-- A running job + begun draft n on project p. Runs as app_ai_writer.
create function w0t.start(n int, p int default 1, p_regen uuid default null) returns void language plpgsql as $$
begin
  insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation, provider, model_tier, connection_tier)
  values (w0t.jid(n), 'career_description', ('a0000000-aaaa-0000-0000-00000000000' || p)::uuid, 'draft', w0t.did(n), 'running', 1, 'gemini', 'default', 'free');
  perform public.begin_career_description(('a0000000-aaaa-0000-0000-00000000000' || p)::uuid, w0t.jid(n),
            (select v from t_opt), (select v from t_sec), null, p_regen);
end $$;
grant execute on all functions in schema w0t to app_ai_writer;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';

-- ── first generation, job canceled ──
select lives_ok($$select w0t.start(1)$$, 'D1 begun');
update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = w0t.jid(1);
select results_eq($$select status, ai_job_id, provider, model_tier, connection_tier, run_generation, options ->> 'tone', title
                      from public.drafts where id = w0t.did(1)$$,
                  $$values ('composing'::text, null::uuid, null::text, null::text, null::text, null::integer, 'detailed'::text, (select title from public.drafts where id = w0t.did(1)))$$,
                  'first generation canceled: composing, options kept, job and AI meta null');
select is((select count(*)::int from public.draft_sections where draft_id = w0t.did(1)), 0, 'first generation canceled: sections deleted');

-- ── the composing row is replaced by the next generation ──
select lives_ok($$select w0t.start(2)$$, 'D2 begun');
select is((select count(*)::int from public.drafts where id = w0t.did(1)), 0, 'begin: composing row deleted');
select is((select regenerated_from_id from public.drafts where id = w0t.did(2)), null::uuid, 'D2 is a first generation');

-- ── cancel_requested_at + runner fail RPC ──
reset role;
update public.ai_jobs set cancel_requested_at = now() where id = w0t.jid(2);
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.fail_career_description(w0t.did(2), w0t.jid(2)), true, 'fail RPC with a cancel request: handled');
select is((select status from public.drafts where id = w0t.did(2)), 'composing', 'cancel_requested_at: composing, not failed');
update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = w0t.jid(2);
select is((select status from public.drafts where id = w0t.did(2)), 'composing', 'closing the job changes nothing more');

-- ── abort: fail RPC first, no cancel flag, then the job closes canceled ──
select lives_ok($$select w0t.start(3)$$, 'D3 begun');
select is(public.fail_career_description(w0t.did(3), w0t.jid(3)), true, 'fail RPC before the close');
select is((select status from public.drafts where id = w0t.did(3)), 'failed', 'no cancel known yet: failed');
update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = w0t.jid(3);
select is((select status from public.drafts where id = w0t.did(3)), 'composing', 'job closes canceled: composing after all');

-- ── provider failure stays failed ──
select lives_ok($$select w0t.start(4)$$, 'D4 begun');
update public.ai_jobs set status = 'failed', error_code = 'rate_limited' where id = w0t.jid(4);
select results_eq($$select status, ai_job_id, provider from public.drafts where id = w0t.did(4)$$,
                  $$values ('failed'::text, w0t.jid(4), 'gemini'::text)$$, 'failure: failed, meta kept');
select is((select count(*)::int from public.draft_sections where draft_id = w0t.did(4) and status = 'failed'), 1, 'failure: sections failed');

-- ── regeneration canceled: new row gone, source untouched ──
reset role;
update public.draft_sections set status = 'ready', completed_at = now(), schema_version = 1, prompt_version = 'p', provider = 'gemini', model = 'm', model_tier = 'default', connection_tier = 'free', input_hash = 'i', career_snapshot_hash = 'c', ai_content = '[{"block_id":"b","block_kind":"bullet","text":"t"}]', edited_content = '[{"block_id":"e","block_kind":"bullet","text":"t"}]' where draft_id = w0t.did(4);
update public.drafts set status = 'ready', completed_at = now(), input_hash = 'i', career_snapshot_hash = 'c', schema_version = 1, prompt_version = 'p', model = 'm', edited_at = now()
 where id = w0t.did(4);
select set_config('t.before', (select to_jsonb(d)::text from public.drafts d where d.id = w0t.did(4)), true);
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select w0t.start(5, 1, w0t.did(4))$$, 'D5 regeneration begun');
update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = w0t.jid(5);
select is((select count(*)::int from public.drafts where id = w0t.did(5)), 0, 'regeneration canceled: new row deleted');
select is((select count(*)::int from public.draft_sections where draft_id = w0t.did(5)), 0, 'regeneration canceled: its sections deleted');
select is((select to_jsonb(d)::text from public.drafts d where d.id = w0t.did(4)), current_setting('t.before'), 'regeneration canceled: source draft untouched');
select is((select ai_content from public.draft_sections where draft_id = w0t.did(4)), '[{"block_id":"b","block_kind":"bullet","text":"t"}]'::jsonb, 'regeneration canceled: source blocks untouched');

-- ── validated first: done, a later cancel does not touch it ──
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select w0t.start(6, 2)$$, 'D6 begun on project 2');
reset role;
update public.draft_sections set status = 'ready', completed_at = now(), schema_version = 1, prompt_version = 'p', provider = 'gemini', model = 'm', model_tier = 'default', connection_tier = 'free', input_hash = 'i', career_snapshot_hash = 'c', ai_content = '[]' where draft_id = w0t.did(6);
update public.drafts set status = 'ready', completed_at = now(), input_hash = 'i', career_snapshot_hash = 'c', schema_version = 1, prompt_version = 'p', model = 'm' where id = w0t.did(6);
update public.ai_jobs set cancel_requested_at = now(), status = 'canceled', error_code = 'canceled' where id = w0t.jid(6);
select is((select status from public.drafts where id = w0t.did(6)), 'ready', 'ready first: stays ready');

-- ── stale generating under a canceled job (end trigger skipped the locked project) is settled by the next begin ──
insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, error_code, run_generation, provider, model_tier, connection_tier)
values (w0t.jid(7), 'a0000000-0000-0000-0000-000000000001', 'career_description', 'a0000000-aaaa-0000-0000-000000000002', 'draft', w0t.did(7), 'canceled', 'canceled', 1, 'gemini', 'default', 'free');
insert into public.drafts (id, user_id, application_project_id, draft_type, title, status, ai_job_id)
values (w0t.did(7), 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002', 'career_description', 't', 'generating', w0t.jid(7));
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select w0t.start(8, 2, w0t.did(7))$$, 'D8 begun, regenerating from the stale row');
select is((select count(*)::int from public.drafts where id = w0t.did(7)), 0, 'begin: stale row settled and replaced');
select is((select regenerated_from_id from public.drafts where id = w0t.did(8)), null::uuid, 'begin: a deleted source means first generation');
reset role;

-- ── one composing row per project; composing is career-description-legal; cover letters unaffected ──
insert into public.drafts (user_id, application_project_id, draft_type, title, status) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002', 'career_description', 'c1', 'composing');
select throws_ok($$insert into public.drafts (user_id, application_project_id, draft_type, title, status) values
                   ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002', 'career_description', 'c2', 'composing')$$,
                 '23505', null, 'composing career description: one per project');
select lives_ok($$insert into public.drafts (user_id, application_project_id, draft_type, title, status) values
                   ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002', 'cover_letter', 'c', 'composing'),
                   ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002', 'cover_letter', 'c', 'composing')$$,
                'cover letters may have many composing rows');

-- ── QA-W0-03: stale `failed` rows under a canceled job (fail RPC landed, then the end trigger skipped the locked project) ──
-- read.ts reads these as stopped, so begin must settle them too. Projects 3..6, jobs / drafts 20+.
insert into public.application_projects (id, user_id, name, name_source)
select ('a0000000-aaaa-0000-0000-00000000000' || n)::uuid, 'a0000000-0000-0000-0000-000000000001', 'P' || n, 'user'
  from generate_series(3, 6) n;
insert into public.job_descriptions (user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                     extraction_status, extraction, tech_keywords, requirements_hash,
                                     extraction_provider, extraction_model)
select 'a0000000-0000-0000-0000-000000000001', ('a0000000-aaaa-0000-0000-00000000000' || n)::uuid, '결제', 'h',
       '[{"sid":"S1","text":"결제","start":0,"end":2}]', 'succeeded', '{}', '[]', 'rh', 'gemini', 'm'
  from generate_series(3, 6) n;

-- Inserted already ended, so no end trigger runs: the same shape a skipped trigger leaves behind.
create function w0t.stale(n int, p int, p_draft_status text, p_job_status text, p_regen uuid default null) returns void language plpgsql as $$
begin
  insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, error_code,
                              run_generation, provider, model_tier, connection_tier)
  values (w0t.jid(n), 'a0000000-0000-0000-0000-000000000001', 'career_description',
          ('a0000000-aaaa-0000-0000-00000000000' || p)::uuid, 'draft', w0t.did(n), p_job_status,
          case when p_job_status = 'canceled' then 'canceled' else 'rate_limited' end, 1, 'gemini', 'default', 'free');
  insert into public.drafts (id, user_id, application_project_id, draft_type, title, status, ai_job_id, regenerated_from_id, run_generation, provider)
  values (w0t.did(n), 'a0000000-0000-0000-0000-000000000001', ('a0000000-aaaa-0000-0000-00000000000' || p)::uuid,
          'career_description', 'stale', p_draft_status, w0t.jid(n), p_regen, 1, 'gemini');
  insert into public.draft_sections (user_id, draft_id, sort_order, section_kind, heading, status)
  values ('a0000000-0000-0000-0000-000000000001', w0t.did(n), 0, 'standalone_projects', null, 'failed');
end $$;
create function w0t.ready(n int, p int) returns void language sql as $$
  insert into public.drafts (id, user_id, application_project_id, draft_type, title, status, completed_at, input_hash,
                             career_snapshot_hash, schema_version, prompt_version, provider, model, model_tier, connection_tier)
  values (w0t.did(n), 'a0000000-0000-0000-0000-000000000001', ('a0000000-aaaa-0000-0000-00000000000' || p)::uuid,
          'career_description', 'source', 'ready', now(), 'i', 'c', 1, 'p', 'gemini', 'm', 'default', 'free');
$$;
create function w0t.statuses(p int) returns text[] language sql as $$
  select coalesce(array_agg(d.status order by d.status), '{}') from public.drafts d
   where d.application_project_id = ('a0000000-aaaa-0000-0000-00000000000' || p)::uuid and d.draft_type = 'career_description';
$$;
grant execute on all functions in schema w0t to app_ai_writer;

-- Case 1: stale first generation. Reproduction: without settling, stopping the next run lists two composing rows.
select w0t.stale(20, 3, 'failed', 'canceled');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select w0t.start(21, 3)$$, 'QA-W0-03 first generation: next run begins');
select is((select count(*)::int from public.drafts where id = w0t.did(20)), 0, 'QA-W0-03 first generation: stale failed row is gone');
select is((select count(*)::int from public.draft_sections where draft_id = w0t.did(20)), 0, 'QA-W0-03 first generation: its sections are gone');
update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = w0t.jid(21);
select is(w0t.statuses(3), array['composing'], 'QA-W0-03 first generation: stopping the next run leaves one row, composing');
reset role;

-- Case 2: stale regeneration. Reproduction: without settling, the hidden row stays and is still counted.
select w0t.ready(22, 4);
select w0t.stale(23, 4, 'failed', 'canceled', w0t.did(22));
select set_config('t.source', (select to_jsonb(d)::text from public.drafts d where d.id = w0t.did(22)), true);
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select w0t.start(24, 4, w0t.did(22))$$, 'QA-W0-03 regeneration: next run begins');
select is((select count(*)::int from public.drafts where id = w0t.did(23)), 0, 'QA-W0-03 regeneration: stale failed row is deleted');
select is((select to_jsonb(d)::text from public.drafts d where d.id = w0t.did(22)), current_setting('t.source'), 'QA-W0-03 regeneration: source draft untouched');
select is((select regenerated_from_id from public.drafts where id = w0t.did(24)), w0t.did(22), 'QA-W0-03 regeneration: new run keeps its source');
select is(w0t.statuses(4), array['generating', 'ready'], 'QA-W0-03 regeneration: only source and new run are left');
reset role;

-- Case 3: a stored composing row and stale rows together: settling must not hit the one-composing unique index.
insert into public.drafts (id, user_id, application_project_id, draft_type, title, status)
values (w0t.did(25), 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000005', 'career_description', 'c', 'composing');
select w0t.stale(26, 5, 'failed', 'canceled');
select w0t.stale(27, 5, 'failed', 'canceled');
select w0t.stale(28, 5, 'generating', 'canceled');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select w0t.start(29, 5)$$, 'QA-W0-03 composing + several stale rows: begin does not hit the unique index');
select is(w0t.statuses(5), array['generating'], 'QA-W0-03 composing + several stale rows: only the new run is left');
reset role;

-- Case 4: real failures stay, a canceled job's row in another project stays, a stale source means first generation.
select w0t.stale(30, 6, 'failed', 'failed');
select w0t.stale(31, 6, 'failed', 'canceled');
select w0t.stale(32, 2, 'failed', 'canceled');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select w0t.start(33, 6, w0t.did(31))$$, 'QA-W0-03 scope: begin regenerating from a stale row');
select is((select status from public.drafts where id = w0t.did(30)), 'failed', 'QA-W0-03 scope: failed under a failed job is kept');
select is((select count(*)::int from public.draft_sections where draft_id = w0t.did(30)), 1, 'QA-W0-03 scope: its sections are kept');
select is((select regenerated_from_id from public.drafts where id = w0t.did(33)), null::uuid, 'QA-W0-03 scope: deleted stale source means first generation');
select is((select status from public.drafts where id = w0t.did(32)), 'failed', 'QA-W0-03 scope: another project is not touched');
reset role;

select * from finish();
rollback;
