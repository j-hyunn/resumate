-- R17 alignment (2026-11-16, DM v4.16 §11.11, decisions 4.24 #1–#5·#8·#9·#11–#14·#16): JD AI processing removed,
-- the posting is used as raw text. Migrations A (…004800 cleanup), B (…004810 RPCs), C (…004820 drops).
--   1. end state of the schema (drops, CHECKs, kept legacy values, rename)
--   2. A's cleanup code on seeded legacy rows (private.r17_jd_raw_text_cleanup) + C's stop guard (r17_jd_raw_text_assert)
--   3. create_application_project   4. update_jd_raw_text + job_descriptions_guard   5. evidence allow lists
--   6. begin_insight / complete_insight   7. start_writing_chat params   8. document greeting   9. account deletion
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Schema end state
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
select hasnt_table('public', 'jd_requirements', '#1 jd_requirements dropped');
select is_empty($$select tgname from pg_trigger where tgname like 'jd_requirements_%'$$, '#1 its triggers are gone');
select is_empty($$select a.attname from pg_attribute a
                   where a.attrelid = 'public.job_descriptions'::regclass and a.attnum > 0 and not a.attisdropped
                     and a.attname in ('extraction_status', 'extraction', 'extraction_job_id', 'extraction_provider',
                                       'extraction_model', 'tech_keywords', 'requirements_hash', 'detected_language')$$,
                '#2 the 8 extraction columns of job_descriptions are dropped');
select is_empty($$select conname from pg_constraint
                   where conname in ('job_descriptions_extraction_status_check', 'job_descriptions_extraction_check',
                                     'job_descriptions_extraction_provider_check', 'job_descriptions_tech_keywords_check',
                                     'job_descriptions_requirements_hash_check', 'job_descriptions_succeeded_check',
                                     'job_descriptions_detected_language_check', 'job_descriptions_extraction_job_fkey')$$,
                '#2 their 7 CHECKs and the FK are gone');
select hasnt_index('public', 'job_descriptions', 'job_descriptions_extraction_job_id_idx', '#2 the extraction job index is gone');
select columns_are('public', 'job_descriptions',
  array['id', 'user_id', 'application_project_id', 'raw_text', 'raw_text_hash', 'sentences', 'company_name',
        'company_name_source', 'position_title', 'position_title_source', 'created_at', 'updated_at',
        'raw_text_edited_at', 'source_url'],
  'job_descriptions keeps raw text, sentences, company / position, source_url, edit stamp');

select hasnt_function('public', 'begin_jd_extraction', '#3 begin_jd_extraction dropped');
select hasnt_function('public', 'apply_jd_extraction', '#3 apply_jd_extraction dropped');
select hasnt_function('public', 'fail_jd_extraction', '#3 fail_jd_extraction dropped');
select hasnt_function('public', 'update_failed_jd_raw_text', '#3 update_failed_jd_raw_text dropped');
select hasnt_function('public', 'purge_unused_jd_preview_outputs', '#3 purge_unused_jd_preview_outputs dropped');
select hasnt_function('private', 'jd_apply_extraction_result', '#3 jd_apply_extraction_result dropped');
select hasnt_function('private', 'jd_extraction_job_matches', '#3 jd_extraction_job_matches dropped');
select hasnt_function('private', 'jd_extraction_result_valid', '#3 jd_extraction_result_valid dropped');
select hasnt_function('private', 'jd_sids_exist', '#3 jd_sids_exist dropped');
select hasnt_function('private', 'jd_sids_valid', '#3 jd_sids_valid dropped (its last user was the jd_requirements CHECK)');
select hasnt_function('private', 'jd_extraction_mark_failed', '#3 jd_extraction_mark_failed dropped');
select hasnt_function('private', 'ai_jobs_release_jd_extraction', '#3 ai_jobs_release_jd_extraction dropped');
select hasnt_trigger('public', 'ai_jobs', 'ai_jobs_release_jd_extraction', '#3 its trigger on ai_jobs is gone');
select is_empty($$select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('public', 'private')
                     and p.proname not in ('r17_jd_raw_text_cleanup', 'r17_strip_jd_sources', 'r17_jd_raw_text_assert')
                     and (p.prosrc ~ 'jd_requirements|extraction_status|extraction_job_id|tech_keywords|detected_language'
                          or p.prosrc ~ 'jd_sids_|jd_extraction_mark_failed|jd_apply_extraction_result|jd_text_hash'
                          or p.prosrc ~ 'requirements_hash|requirements_ready|update_failed_jd_raw_text')$$,
                'no live function mentions a dropped table / column / helper');

-- #5: jd_requirement removed from the CHECK; #8: legacy values kept.
select ok((select pg_get_constraintdef(oid) not like '%jd_requirement%' and pg_get_constraintdef(oid) like '%jd_sentence%'
             from pg_constraint where conname = 'evidence_links_source_type_check'),
          '#5 evidence_links_source_type_check: jd_requirement out, jd_sentence kept');
select ok((select pg_get_constraintdef(oid) like '%jd_extraction%' from pg_constraint where conname = 'ai_jobs_job_type_check')
          and (select pg_get_constraintdef(oid) like '%jd_extraction%' from pg_constraint
                where conname = 'ai_usage_records_feature_check')
          and (select pg_get_constraintdef(oid) like '%not_a_jd%' from pg_constraint where conname = 'ai_jobs_error_code_check')
          and exists (select 1 from pg_constraint where conname = 'ai_jobs_jd_extraction_check')
          and (select pg_get_constraintdef(oid) like '%''ai''%' from pg_constraint
                where conname = 'application_projects_name_source_check'),
          '#8 legacy CHECK values kept: jd_extraction, not_a_jd, ai_jobs_jd_extraction_check, name_source ai');

-- #13: requirements_hash renamed to raw_text_hash.
select has_column('public', 'insights', 'raw_text_hash', '#13 insights.raw_text_hash');
select hasnt_column('public', 'insights', 'requirements_hash', '#13 insights.requirements_hash renamed away');
select hasnt_column('public', 'insights', 'jd_text_hash', '#13 no jd_text_hash column');
select ok(exists (select 1 from pg_constraint where conname = 'insights_raw_text_hash_check')
          and not exists (select 1 from pg_constraint where conname = 'insights_requirements_hash_check')
          and (select pg_get_constraintdef(oid) like '%raw_text_hash IS NOT NULL%' from pg_constraint
                where conname = 'insights_ready_check'),
          '#13 CHECK renamed to insights_raw_text_hash_check, ready CHECK requires raw_text_hash');
select ok(not has_column_privilege('authenticated', 'public.insights', 'raw_text_hash', 'UPDATE')
          and not has_column_privilege('app_ai_writer', 'public.insights', 'raw_text_hash', 'UPDATE')
          and has_column_privilege('authenticated', 'public.insights', 'raw_text_hash', 'SELECT')
          and has_column_privilege('app_ai_writer', 'public.insights', 'raw_text_hash', 'SELECT'),
          '#13 raw_text_hash readable by user and app_ai_writer, written only by complete_insight');

-- The one-off migration functions: no role may call them.
select ok(not has_function_privilege(r, 'private.r17_jd_raw_text_cleanup()', 'execute')
          and not has_function_privilege(r, 'private.r17_jd_raw_text_assert()', 'execute')
          and not has_function_privilege(r, 'private.r17_strip_jd_sources(jsonb)', 'execute'),
          'r17 cleanup / assert functions: no execute for ' || r)
  from unnest(array['anon', 'authenticated', 'app_ai_writer', 'app_key_reader', 'service_role']) r;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 2. Migration A's cleanup on legacy rows, migration C's stop guard
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Career data of A (sources).
insert into public.experiences (id, user_id, company_name, start_month) values
  ('a0000000-1111-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'A사', '2023-01-01');
insert into public.projects (id, user_id, experience_id, name, action) values
  ('a0000000-3333-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-1111-0000-0000-000000000001', 'P1', '인덱스 재설계');
insert into public.skills (id, user_id, name, is_manual) values
  ('a0000000-6666-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Go', true);

-- L1: legacy project with a v1 insight, a cover letter, a document chat. L2 / L3: in-flight extraction jobs.
-- L4: a "추출 대기" project (name null).
insert into public.application_projects (id, user_id, name, name_source, created_at) values
  ('a0000000-aaaa-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001', '과거 1', 'ai', now()),
  ('a0000000-aaaa-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-000000000001', '과거 2', 'user', now()),
  ('a0000000-aaaa-0000-0000-0000000000c3', 'a0000000-0000-0000-0000-000000000001', '과거 3', 'user', now()),
  ('a0000000-aaaa-0000-0000-0000000000c4', 'a0000000-0000-0000-0000-000000000001', null, null,
   '2026-03-04 20:00:00+00');   -- 2026-03-05 KST
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences)
select ('a0000000-dddd-0000-0000-0000000000c' || n)::uuid, 'a0000000-0000-0000-0000-000000000001',
       ('a0000000-aaaa-0000-0000-0000000000c' || n)::uuid, '결제 API 설계 Kafka 우대', 'lh' || n,
       '[{"sid":"S1","text":"결제 API 설계","start":0,"end":9},{"sid":"S2","text":"Kafka 우대","start":10,"end":18}]'
  from generate_series(1, 4) n;

insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status,
                            run_generation, provider, model_tier, connection_tier, output, step_outputs) values
  -- in-flight extraction jobs -> canceled
  ('a0000000-7777-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-000000000001', 'jd_extraction',
   'a0000000-aaaa-0000-0000-0000000000c2', 'job_description', 'a0000000-dddd-0000-0000-0000000000c2', 'queued', 1,
   'gemini', 'light', 'free', null, '{}'),
  ('a0000000-7777-0000-0000-0000000000c3', 'a0000000-0000-0000-0000-000000000001', 'jd_extraction',
   'a0000000-aaaa-0000-0000-0000000000c3', 'job_description', 'a0000000-dddd-0000-0000-0000000000c3', 'running', 1,
   'gemini', 'light', 'free', null, '{}'),
  -- a finished extraction job stays as it is
  ('a0000000-7777-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001', 'jd_extraction',
   'a0000000-aaaa-0000-0000-0000000000c1', 'job_description', 'a0000000-dddd-0000-0000-0000000000c1', 'succeeded', 1,
   'gemini', 'light', 'free', '{"requirements":[]}', '{"extract":{"k":1}}'),
  -- an unlinked preview job with output -> output / step_outputs emptied
  ('a0000000-7777-0000-0000-0000000000c9', 'a0000000-0000-0000-0000-000000000001', 'jd_extraction',
   null, 'jd_preview', null, 'succeeded', 1, 'gemini', 'light', 'free', '{"company_name":"x"}', '{"extract":{"k":1}}'),
  -- the v1 insight's job
  ('a0000000-7777-0000-0000-0000000000c8', 'a0000000-0000-0000-0000-000000000001', 'insight',
   'a0000000-aaaa-0000-0000-0000000000c1', 'application_project', 'a0000000-aaaa-0000-0000-0000000000c1', 'succeeded', 1,
   'gemini', 'default', 'free', null, '{}');

insert into public.insights (id, user_id, application_project_id, version_no, is_latest, status, result,
                             match_stage_result, raw_text_hash, career_snapshot_hash, input_hash, schema_version,
                             prompt_version, provider, model, model_tier, connection_tier, completed_at, ai_job_id)
values ('a0000000-1a51-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001',
        'a0000000-aaaa-0000-0000-0000000000c1', 1, true, 'ready', '{"requirement_matches":[]}', '{"matches":[]}',
        'lh1', 'ch', 'ih', 1, 'ai-02.v1', 'gemini', 'm', 'default', 'free', now(),
        'a0000000-7777-0000-0000-0000000000c8');
insert into public.application_documents (id, user_id, application_project_id, document_kind, body, filled_slot_count)
values ('a0000000-cccc-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001',
        'a0000000-aaaa-0000-0000-0000000000c1', 'cover_letter',
        '{"questions":[{"slot":"q_1","question_id":"a0000000-9a00-0000-0000-000000000001","question_text":"q",
          "body":"본문","blocks":[{"block_id":"b1","type":"paragraph","text":"본문"}]}]}', 1);

-- Legacy evidence: the JD rows are not insertable any more (allow lists, CHECK), so the guard is lifted for the
-- seeding only and put back after the cleanup (which also proves no jd_requirement row is left).
alter table public.evidence_links disable trigger evidence_links_check_source;
alter table public.evidence_links drop constraint evidence_links_source_type_check;
insert into public.evidence_links (id, user_id, application_project_id, owner_type, owner_id, item_key, sort_order,
                                   source_type, source_id, source_field, source_locator, quote) values
  -- v1 insight: career + jd_sentence rows stay, the jd_requirement row goes
  ('a0000000-e000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-0000000000c1',
   'insight', 'a0000000-1a51-0000-0000-0000000000c1', 'strengths.0', 0, 'project',
   'a0000000-3333-0000-0000-000000000001', 'action', null, '인덱스 재설계'),
  ('a0000000-e000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-0000000000c1',
   'insight', 'a0000000-1a51-0000-0000-0000000000c1', 'strengths.0', 1, 'jd_sentence',
   'a0000000-dddd-0000-0000-0000000000c1', null, '{"sid":"S1","start":0,"end":9}', '결제 API 설계'),
  ('a0000000-e000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-0000000000c1',
   'insight', 'a0000000-1a51-0000-0000-0000000000c1', 'requirement_matches.x', 0, 'jd_requirement',
   'a0000000-8888-0000-0000-000000000001', null, null, null),
  -- cover letter: the project row stays, jd_sentence and jd_requirement rows go
  ('a0000000-e000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-0000000000c1',
   'application_document', 'a0000000-cccc-0000-0000-0000000000c1', 'q_1.blocks.b1', 0, 'project',
   'a0000000-3333-0000-0000-000000000001', 'action', null, '인덱스 재설계'),
  ('a0000000-e000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-0000000000c1',
   'application_document', 'a0000000-cccc-0000-0000-0000000000c1', 'q_1.blocks.b1', 1, 'jd_sentence',
   'a0000000-dddd-0000-0000-0000000000c1', null, '{"sid":"S2","start":10,"end":18}', 'Kafka 우대'),
  ('a0000000-e000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-0000000000c1',
   'application_document', 'a0000000-cccc-0000-0000-0000000000c1', 'q_1.sources.1', 0, 'jd_requirement',
   'a0000000-8888-0000-0000-000000000002', null, null, null);
alter table public.evidence_links enable trigger evidence_links_check_source;

-- A document chat whose proposal cites the posting, and a STAR chat (not a document chat: untouched).
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.doc_chat', public.start_document_writing_chat('a0000000-aaaa-0000-0000-0000000000c1',
                    'cover_letter')::text, true);
select set_config('t.star_chat', public.start_writing_chat('a0000000-3333-0000-0000-000000000001')::text, true);
reset role;
update public.writing_chats
   set structured_draft = jsonb_set(structured_draft, '{document}', $j${"questions":[{"slot":"q_1","draft":{
         "rev":1,"value":"본문",
         "sources":[{"source_type":"jd_sentence","source_id":"a0000000-dddd-0000-0000-0000000000c1","role":"supporting"},
                    {"source_type":"project","source_id":"a0000000-3333-0000-0000-000000000001","role":"primary"}],
         "blocks":[{"block_id":"b1","type":"paragraph","text":"본문",
                    "evidence":[{"source_type":"jd_requirement","source_id":"a0000000-8888-0000-0000-000000000001"},
                                {"source_type":"skill","source_id":"a0000000-6666-0000-0000-000000000001",
                                 "source_field":"name"}]}]}}],
         "question_edit_proposal":[]}$j$::jsonb)
 where id = current_setting('t.doc_chat')::uuid;
update public.writing_chats
   set structured_draft = structured_draft || '{"probe":[{"source_type":"jd_sentence","source_id":"x"}]}'::jsonb
 where id = current_setting('t.star_chat')::uuid;
create temp table t_star_before as
  select structured_draft from public.writing_chats where id = current_setting('t.star_chat')::uuid;

-- C's stop guard fails while legacy rows remain.
select throws_ok($$select private.r17_jd_raw_text_assert()$$, 'P0001', 'r17_assert_failed',
                 'stop guard: refuses while legacy JD rows remain');

select is(private.r17_jd_raw_text_cleanup(),
          '{"jd_extraction_jobs_canceled": 2, "jd_preview_outputs_cleared": 1, "names_filled": 1,
            "jd_requirement_evidence_deleted": 2, "document_jd_sentence_evidence_deleted": 1,
            "document_chats_stripped": 1}'::jsonb,
          'cleanup: counts of what it changed');
select results_eq($$select id::text, status, coalesce(error_code, '-'), finished_at is not null from public.ai_jobs
                     where id::text like 'a0000000-7777-0000-0000-0000000000c_' order by id$$,
                  $$values ('a0000000-7777-0000-0000-0000000000c1'::text, 'succeeded'::text, '-'::text, true),
                           ('a0000000-7777-0000-0000-0000000000c2', 'canceled', 'canceled', true),
                           ('a0000000-7777-0000-0000-0000000000c3', 'canceled', 'canceled', true),
                           ('a0000000-7777-0000-0000-0000000000c8', 'succeeded', '-', true),
                           ('a0000000-7777-0000-0000-0000000000c9', 'succeeded', '-', true)$$,
                  'step 1: queued / running jd_extraction jobs canceled (canceled / finished_at), others untouched');
select results_eq($$select id::text, output, step_outputs from public.ai_jobs
                     where id in ('a0000000-7777-0000-0000-0000000000c1', 'a0000000-7777-0000-0000-0000000000c9')
                     order by id$$,
                  $$values ('a0000000-7777-0000-0000-0000000000c1'::text, '{"requirements":[]}'::jsonb,
                            '{"extract":{"k":1}}'::jsonb),
                           ('a0000000-7777-0000-0000-0000000000c9', null, '{}')$$,
                  'step 2: only the jd_preview job''s output / step_outputs are emptied');
select results_eq($$select name, name_source from public.application_projects
                     where id = 'a0000000-aaaa-0000-0000-0000000000c4'$$,
                  $$values ('새 자기소개서 (2026-03-05)'::text, 'default'::text)$$,
                  'step 2: name null -> default name of the KST creation date');
select is((select name from public.application_projects where id = 'a0000000-aaaa-0000-0000-0000000000c1'), '과거 1',
          'step 2: existing names untouched (ai-sourced too)');
select results_eq($$select id::text from public.evidence_links where user_id = 'a0000000-0000-0000-0000-000000000001'
                     order by id$$,
                  $$values ('a0000000-e000-0000-0000-000000000001'::text), ('a0000000-e000-0000-0000-000000000002'),
                           ('a0000000-e000-0000-0000-000000000004')$$,
                  'step 3: jd_requirement rows and cover-letter jd_sentence rows deleted; insight career / jd_sentence rows kept');
select results_eq($$select status, schema_version, is_latest, result from public.insights
                     where id = 'a0000000-1a51-0000-0000-0000000000c1'$$,
                  $$values ('ready'::text, 1, true, '{"requirement_matches":[]}'::jsonb)$$,
                  '#8 the schema_version 1 insight is kept as is (latest, result untouched)');
select is((select structured_draft #> '{document,questions,0,draft}' from public.writing_chats
            where id = current_setting('t.doc_chat')::uuid),
          $j${"rev":1,"value":"본문",
              "sources":[{"source_type":"project","source_id":"a0000000-3333-0000-0000-000000000001","role":"primary"}],
              "blocks":[{"block_id":"b1","type":"paragraph","text":"본문",
                         "evidence":[{"source_type":"skill","source_id":"a0000000-6666-0000-0000-000000000001",
                                      "source_field":"name"}]}]}$j$::jsonb,
          'step 4: JD source elements removed from the document proposal, the rest kept');
select is((select structured_draft ->> 'schema_version' from public.writing_chats
            where id = current_setting('t.doc_chat')::uuid), '1', 'step 4: structured_draft.schema_version unchanged');
select is((select structured_draft from public.writing_chats where id = current_setting('t.star_chat')::uuid),
          (select structured_draft from t_star_before), 'step 4: a non-document chat is not touched');

select lives_ok($$alter table public.evidence_links add constraint evidence_links_source_type_check
                    check (source_type in ('profile', 'experience', 'education', 'project', 'project_deliverable',
                                           'skill', 'jd_sentence', 'user_note'))$$,
                'after the cleanup the narrowed CHECK validates (no jd_requirement row left)');
select lives_ok($$select private.r17_jd_raw_text_assert()$$, 'stop guard: passes after the cleanup');
select is(private.r17_jd_raw_text_cleanup(),
          '{"jd_extraction_jobs_canceled": 0, "jd_preview_outputs_cleared": 0, "names_filled": 0,
            "jd_requirement_evidence_deleted": 0, "document_jd_sentence_evidence_deleted": 0,
            "document_chats_stripped": 0}'::jsonb,
          'cleanup is idempotent');

-- Each stop-guard condition on its own.
create function pg_temp.guard_after(p_sql text) returns text language plpgsql as $f$
declare
  v text;
begin
  begin
    execute p_sql;
    perform private.r17_jd_raw_text_assert();
    raise exception 'no_error';
  exception when others then
    v := sqlerrm;
  end;
  return v;
end;
$f$;
select is(pg_temp.guard_after($$update public.application_projects set name = null, name_source = null
                                 where id = 'a0000000-aaaa-0000-0000-0000000000c4'$$),
          'r17_assert_failed', 'stop guard: a name-null project');
select is(pg_temp.guard_after($$insert into public.ai_jobs (user_id, job_type, application_project_id, target_type,
                                   target_id, status, run_generation, provider, model_tier, connection_tier)
                                 values ('a0000000-0000-0000-0000-000000000001', 'jd_extraction',
                                         'a0000000-aaaa-0000-0000-0000000000c4', 'job_description',
                                         'a0000000-dddd-0000-0000-0000000000c4', 'running', 1, 'gemini', 'light', 'free')$$),
          'r17_assert_failed', 'stop guard: a running jd_extraction job');
select is(pg_temp.guard_after($$update public.writing_chats
                                   set structured_draft = jsonb_set(structured_draft, '{document,questions,0,draft,sources}',
                                         '[{"source_type":"jd_sentence","source_id":"a0000000-dddd-0000-0000-0000000000c1","role":"primary"}]')
                                 where id = current_setting('t.doc_chat')::uuid$$),
          'r17_assert_failed', 'stop guard: a document chat citing the posting');
select is(pg_temp.guard_after($$alter table public.evidence_links disable trigger evidence_links_check_source;
                                 insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id,
                                   item_key, sort_order, source_type, source_id, source_locator)
                                 values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-0000000000c1',
                                         'application_document', 'a0000000-cccc-0000-0000-0000000000c1', 'q_1.blocks.b1',
                                         5, 'jd_sentence', 'a0000000-dddd-0000-0000-0000000000c1',
                                         '{"sid":"S1","start":0,"end":9}')$$),
          'r17_assert_failed', 'stop guard: a cover-letter jd_sentence row');
select lives_ok($$select private.r17_jd_raw_text_assert()$$, 'stop guard: each probe was rolled back');

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 3. create_application_project (#9)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
select hasnt_function('public', 'create_application_project',
                      array['uuid', 'text', 'text', 'jsonb', 'text', 'text', 'text', 'date', 'text', 'uuid'],
                      '#9 the 10-argument create_application_project (p_preview_job_id) is gone');
select is((select array_agg(p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'create_application_project'),
          array['create_application_project(uuid,text,text,jsonb,text,text,text,date,text)'],
          '#9 exactly one overload, 9 arguments');
select ok(has_function_privilege('authenticated',
            'public.create_application_project(uuid, text, text, jsonb, text, text, text, date, text)', 'execute')
          and not has_function_privilege('anon',
            'public.create_application_project(uuid, text, text, jsonb, text, text, text, date, text)', 'execute')
          and not has_function_privilege('app_ai_writer',
            'public.create_application_project(uuid, text, text, jsonb, text, text, text, date, text)', 'execute'),
          '#9 create_application_project: authenticated (not anon, not app_ai_writer)');

-- An invalid active key and no consent: no gate any more.
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek,
                                     kek_id, key_last4, status)
values ('a0000000-9999-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'gemini', 'free', '\x01',
        '\x02', '\x03', 'env-v1', 'ag01', 'invalid');
update public.profiles set active_ai_provider = 'gemini' where id = 'a0000000-0000-0000-0000-000000000001';

create temp table t_s (v jsonb);
insert into t_s values ('[{"sid":"S1","text":"결제 API 설계","start":0,"end":9},{"sid":"S2","text":"Kafka 우대","start":10,"end":18}]');
grant select on t_s to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.r1', public.create_application_project('a0000000-aaaa-0000-0000-000000000001',
                    '결제 API 설계 Kafka 우대', 'rawhash1', (select v from t_s), null, '백엔드', null, '2026-12-24',
                    'https://jobs.example.test/1')::text, true);
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('t.r1')::jsonb) k),
          array['application_project_id', 'created', 'job_description_id', 'name', 'name_source'],
          '#9 return keys: application_project_id, job_description_id, created, name, name_source');
select is((current_setting('t.r1')::jsonb) - 'application_project_id' - 'job_description_id',
          jsonb_build_object('created', true, 'name_source', 'default',
                             'name', '새 자기소개서 (' || to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ')'),
          '#9 no name, no company (position only) -> application_fallback_name default, despite an invalid key');
select results_eq($$select jd.raw_text_hash, jd.position_title, jd.position_title_source, jd.source_url, ap.deadline
                      from public.job_descriptions jd join public.application_projects ap on ap.id = jd.application_project_id
                     where jd.application_project_id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                  $$values ('rawhash1'::text, '백엔드'::text, 'user'::text, 'https://jobs.example.test/1'::text,
                            '2026-12-24'::date)$$,
                  '#9 the JD keeps hash, user position, source_url; the deadline is written as given');
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000002', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]', '에이비씨', null, '  내 이름 ') - 'application_project_id'
            - 'job_description_id',
          '{"created": true, "name": "내 이름", "name_source": "user"}'::jsonb, '#9 p_name wins (user)');
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000003', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]', '에이비씨') - 'application_project_id' - 'job_description_id',
          '{"created": true, "name": "에이비씨 자기소개서", "name_source": "user"}'::jsonb,
          '#9 company -> "{회사명} 자기소개서" (user) through application_fallback_name');
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000001', '다른', 'h2',
            '[{"sid":"S1","text":"다른","start":0,"end":2}]', '딴회사') - 'application_project_id' - 'job_description_id'
            - 'name',
          '{"created": false, "name_source": "default"}'::jsonb, '#9 replay with the same id: created false, stored values');
select throws_ok($$select public.create_application_project('a0000000-aaaa-0000-0000-000000000004', '----', 'h', '[]')$$,
                 'P0001', 'jd_no_sentences', '#9 0 sentences -> jd_no_sentences');
select throws_ok($$select public.create_application_project('a0000000-aaaa-0000-0000-000000000004', '원문', 'h', '{}')$$,
                 'P0001', 'invalid_sentences', '#9 malformed sentences stay invalid_sentences');
reset role;
select is((select count(*)::int from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000004'), 0,
          '#9 jd_no_sentences creates no row');

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 4. update_jd_raw_text (#11) and the guard trigger
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
select has_function('public', 'update_jd_raw_text', array['uuid', 'text', 'text', 'jsonb'], '#11 update_jd_raw_text exists');
select ok((select prosecdef from pg_proc where oid = 'public.update_jd_raw_text(uuid, text, text, jsonb)'::regprocedure),
          '#11 update_jd_raw_text is security definer');
select ok(has_function_privilege('authenticated', 'public.update_jd_raw_text(uuid, text, text, jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.update_jd_raw_text(uuid, text, text, jsonb)', 'execute')
          and not has_function_privilege('app_ai_writer', 'public.update_jd_raw_text(uuid, text, text, jsonb)', 'execute')
          and not has_function_privilege('service_role', 'public.update_jd_raw_text(uuid, text, text, jsonb)', 'execute'),
          '#11 update_jd_raw_text: authenticated only');

-- A ready insight on P1, whose raw_text_hash matches the JD (= not stale before the edit).
insert into public.insights (id, user_id, application_project_id, version_no, is_latest, status, result,
                             match_stage_result, raw_text_hash, career_snapshot_hash, input_hash, schema_version,
                             prompt_version, provider, model, model_tier, connection_tier, completed_at)
values ('a0000000-1a51-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
        'a0000000-aaaa-0000-0000-000000000001', 1, true, 'ready', '{"gaps":[]}', '{"items":[]}', 'rawhash1', 'ch', 'ih', 2,
        'pv', 'gemini', 'm', 'default', 'free', now());
update public.application_projects set last_activity_at = '2026-01-01' where id = 'a0000000-aaaa-0000-0000-000000000001';

-- Jobs that block / do not block: insight queued (blocks), cover-letter turn running (does not).
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.p1_chat', public.start_document_writing_chat('a0000000-aaaa-0000-0000-000000000001',
                    'cover_letter')::text, true);
reset role;
insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status,
                            run_generation, provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'insight',
   'a0000000-aaaa-0000-0000-000000000001', 'application_project', 'a0000000-aaaa-0000-0000-000000000001', 'queued', 1,
   'gemini', 'default', 'free'),
  ('a0000000-7777-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'cover_letter',
   'a0000000-aaaa-0000-0000-000000000001', 'writing_chat', current_setting('t.p1_chat')::uuid, 'running', 1,
   'gemini', 'default', 'free');

create temp table t_edit (v jsonb);
insert into t_edit values ('[{"sid":"S1","text":"결제 API 설계","start":0,"end":9},{"sid":"S2","text":"Go 필수","start":10,"end":15}]');
grant select on t_edit to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.update_jd_raw_text('a0000000-aaaa-0000-0000-000000000001', '결제 API 설계 Go 필수',
                     'rawhash2', (select v from t_edit))$$,
                 'P0001', 'jd_job_in_progress', '#11 condition 3: a queued insight job -> jd_job_in_progress');
reset role;
update public.ai_jobs set status = 'running' where id = 'a0000000-7777-0000-0000-000000000011';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.update_jd_raw_text('a0000000-aaaa-0000-0000-000000000001', '결제 API 설계 Go 필수',
                     'rawhash2', (select v from t_edit))$$,
                 'P0001', 'jd_job_in_progress', '#11 condition 3: a running insight job -> jd_job_in_progress');
reset role;
update public.ai_jobs set status = 'failed', error_code = 'rate_limited' where id = 'a0000000-7777-0000-0000-000000000011';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- condition 1
select throws_ok($$select public.update_jd_raw_text('a0000000-aaaa-0000-0000-000000000001', '   ', 'h', (select v from t_edit))$$,
                 'P0001', 'invalid_raw_text', '#11 blank raw text');
select throws_ok($$select public.update_jd_raw_text('a0000000-aaaa-0000-0000-000000000001', repeat('a', 50001), 'h',
                     (select v from t_edit))$$, 'P0001', 'invalid_raw_text', '#11 raw text over 50,000');
select throws_ok($$select public.update_jd_raw_text('a0000000-aaaa-0000-0000-000000000001', '원문', ' ', (select v from t_edit))$$,
                 'P0001', 'invalid_raw_text_hash', '#11 blank hash');
select throws_ok($$select public.update_jd_raw_text('a0000000-aaaa-0000-0000-000000000001', '원문', 'h', '{"sid":"S1"}')$$,
                 'P0001', 'invalid_sentences', '#11 malformed sentences');
select throws_ok($$select public.update_jd_raw_text('a0000000-aaaa-0000-0000-000000000001', '----', 'h', '[]')$$,
                 'P0001', 'jd_no_sentences', '#11 0 sentences -> jd_no_sentences');
-- condition 2
select throws_ok($$select public.update_jd_raw_text(gen_random_uuid(), '원문', 'h', (select v from t_edit))$$,
                 'P0001', 'job_description_not_found', '#11 unknown project');
-- condition 4
select throws_ok($$select public.update_jd_raw_text('a0000000-aaaa-0000-0000-000000000001',
                     E'  결제 API 설계 Kafka 우대\n', 'rawhash1', (select v from t_s))$$,
                 'P0001', 'jd_raw_text_unchanged', '#11 same text (outer whitespace aside) -> jd_raw_text_unchanged');
-- happy path: a failed insight job and a running cover-letter turn do not block.
select set_config('t.u1', public.update_jd_raw_text('a0000000-aaaa-0000-0000-000000000001', '결제 API 설계 Go 필수',
                    'rawhash2', (select v from t_edit))::text, true);
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('t.u1')::jsonb) k),
          array['application_project_id', 'job_description_id', 'raw_text_edited_at'],
          '#11 return {application_project_id, job_description_id, raw_text_edited_at}');
select results_eq($$select raw_text, raw_text_hash, sentences -> 1 ->> 'text',
                           raw_text_edited_at = (current_setting('t.u1')::jsonb ->> 'raw_text_edited_at')::timestamptz,
                           id = (current_setting('t.u1')::jsonb ->> 'job_description_id')::uuid
                      from public.job_descriptions where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                  $$values ('결제 API 설계 Go 필수'::text, 'rawhash2'::text, 'Go 필수'::text, true, true)$$,
                  '#11 raw text, hash, sentences, raw_text_edited_at written (failed insight / running cover letter do not block)');
select ok((select last_activity_at > '2026-01-02' from public.application_projects
            where id = 'a0000000-aaaa-0000-0000-000000000001'), '#11 last_activity_at bumped');
select results_eq($$select i.raw_text_hash, i.raw_text_hash <> jd.raw_text_hash, i.status, i.is_latest
                      from public.insights i join public.job_descriptions jd on jd.application_project_id = i.application_project_id
                     where i.id = 'a0000000-1a51-0000-0000-000000000001'$$,
                  $$values ('rawhash1'::text, true, 'ready'::text, true)$$,
                  '#11 the existing insight stays, and is now stale by raw_text_hash (staleReasons.rawText)');
select results_eq($$select name, name_source, deadline from public.application_projects
                     where id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                  $$values (('새 자기소개서 (' || to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ')')::text,
                            'default'::text, '2026-12-24'::date)$$,
                  '#11 name / deadline untouched');
select lives_ok($$select public.update_jd_raw_text('a0000000-aaaa-0000-0000-000000000001', '결제 API 설계 Kafka 우대',
                    'rawhash1', (select v from t_s))$$, '#11 editing again (back to the old text) is allowed, no limit');
-- another user
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.update_jd_raw_text('a0000000-aaaa-0000-0000-000000000001', '해킹', 'h',
                     '[{"sid":"S1","text":"해킹","start":0,"end":2}]')$$,
                 'P0001', 'job_description_not_found', '#11 another user''s project -> job_description_not_found');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.update_jd_raw_text('a0000000-aaaa-0000-0000-000000000001', 'x', 'h',
                     '[{"sid":"S1","text":"x","start":0,"end":1}]')$$, '42501', null, '#11 anon cannot call it');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.update_jd_raw_text('a0000000-aaaa-0000-0000-000000000001', 'x', 'h',
                     '[{"sid":"S1","text":"x","start":0,"end":1}]')$$, '42501', null, '#11 app_ai_writer cannot call it');
reset role;

-- Guard trigger (any role, owner included).
select throws_ok($$update public.job_descriptions set raw_text = 'x'
                    where application_project_id = 'a0000000-aaaa-0000-0000-000000000002'$$,
                 'P0001', 'job_description_immutable', 'guard: raw text without raw_text_edited_at refused');
select throws_ok($$update public.job_descriptions set raw_text_edited_at = now()
                    where application_project_id = 'a0000000-aaaa-0000-0000-000000000002'$$,
                 'P0001', 'job_description_immutable', 'guard: raw_text_edited_at alone refused');
select throws_ok($$update public.job_descriptions set source_url = 'https://x.test'
                    where application_project_id = 'a0000000-aaaa-0000-0000-000000000002'$$,
                 'P0001', 'job_description_immutable', 'guard: source_url is fixed');
select lives_ok($$update public.job_descriptions set raw_text = 'x', raw_text_hash = 'hx',
                    sentences = '[{"sid":"S1","text":"x","start":0,"end":1}]', raw_text_edited_at = now()
                    where application_project_id = 'a0000000-aaaa-0000-0000-000000000002'$$,
                'guard: raw text together with raw_text_edited_at passes (no extraction_status condition)');
select lives_ok($$update public.job_descriptions set company_name = '다른', company_name_source = 'user'
                    where application_project_id = 'a0000000-aaaa-0000-0000-000000000002'$$,
                'guard: other columns are not its business');

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 5. Evidence allow lists (#12)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
select is(private.evidence_allowed_sources('insight'),
          array['experience', 'education', 'project', 'project_deliverable', 'skill', 'jd_sentence'],
          '#12 insight = career 5 + jd_sentence');
select is(private.evidence_allowed_sources('application_document'),
          array['experience', 'education', 'project', 'project_deliverable', 'skill', 'user_note'],
          '#12 application_document = career 5 + user_note');
select throws_ok($$insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key,
                     source_type, source_id)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'insight',
                           'a0000000-1a51-0000-0000-000000000001', 'gaps.0', 'jd_requirement', gen_random_uuid())$$,
                 'P0001', 'invalid_evidence_source', '#12 a jd_requirement row is refused');
select throws_ok($$insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key,
                     source_type, source_id, source_locator)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-0000000000c1',
                           'application_document', 'a0000000-cccc-0000-0000-0000000000c1', 'q_1.blocks.b1',
                           'jd_sentence', 'a0000000-dddd-0000-0000-0000000000c1', '{"sid":"S1","start":0,"end":9}')$$,
                 'P0001', 'invalid_evidence_source', '#12 a cover-letter jd_sentence row is refused');
select lives_ok($$insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key,
                    source_type, source_id, source_locator)
                  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-0000000000c1', 'insight',
                          'a0000000-1a51-0000-0000-0000000000c1', 'gaps.0', 'jd_sentence',
                          'a0000000-dddd-0000-0000-0000000000c1', '{"sid":"S1","start":0,"end":9}')$$,
                '#12 an insight jd_sentence row is accepted');
select throws_ok($$insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key,
                     source_type, source_id)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-0000000000c1', 'insight',
                           'a0000000-1a51-0000-0000-0000000000c1', 'gaps.0.sources.1', 'jd_sentence',
                           'a0000000-dddd-0000-0000-0000000000c1')$$,
                 'P0001', 'invalid_evidence_source', '#12 a jd_sentence row always needs a locator (CF-S1 slot exception gone)');
-- The save RPC refuses a JD source in a block.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-0000000000c1', 'cover_letter',
                     '{"questions":[{"slot":"q_1","question_id":"a0000000-9a00-0000-0000-000000000001","question_text":"q",
                       "body":"본문","blocks":[{"block_id":"b1","type":"paragraph","text":"본문",
                       "evidence":[{"source_type":"jd_sentence","source_id":"a0000000-dddd-0000-0000-0000000000c1",
                                    "source_locator":{"sid":"S1","start":0,"end":9}}]}]}]}'::jsonb, null,
                     (select updated_at from public.application_documents
                       where id = 'a0000000-cccc-0000-0000-0000000000c1'))$$,
                 'P0001', 'invalid_evidence_source', '#12 save_application_document: a jd_sentence block source is refused');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 6. begin_insight / complete_insight (#13)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- P5: a legacy JD with 0 sentences (direct insert: the RPCs refuse it now). P6: a project without a JD row.
insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', '문장 없음', 'user'),
  ('a0000000-aaaa-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', '공고 없음', 'user');
insert into public.job_descriptions (user_id, application_project_id, raw_text, raw_text_hash, sentences) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000005', '----', 'h0', '[]');
insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status,
                            run_generation, provider, model_tier, connection_tier)
select ('a0000000-7777-0000-0000-00000000002' || n)::uuid, 'a0000000-0000-0000-0000-000000000001', 'insight',
       ('a0000000-aaaa-0000-0000-00000000000' || n)::uuid, 'application_project',
       ('a0000000-aaaa-0000-0000-00000000000' || n)::uuid, 'running', 1, 'gemini', 'default', 'free'
  from unnest(array[1, 5, 6]) n;

create temp table t_payload (v jsonb);
insert into t_payload values ('{
  "result": {"requirement_matches": [{"match_key": "MT-1", "requirement_text": "결제 API 설계", "sids": ["S1"],
             "status": "met", "item_key": "requirement_matches.MT-1"}],
             "summary_counts": {"met": 1, "partial": 0, "no_evidence": 0}, "strengths": [], "gaps": [],
             "strategy": {"positioning": "p", "positioning_item_key": "strategy.positioning", "project_priorities": []},
             "data_sufficiency": {"level": "ok", "hints": []}},
  "match_stage_result": {"prompt_version": "ai-02.match.v3", "items": []},
  "hashes": {"raw_text_hash": "rawhash1", "career_snapshot_hash": "ch", "input_hash": "ih2"},
  "meta": {"schema_version": 2, "prompt_version": "ai-02.match.v3+ai-02.synthesize.v3+common.v5", "provider": "gemini",
           "model": "gemini-x", "model_tier": "default", "connection_tier": "free"},
  "evidence": [{"item_key": "requirement_matches.MT-1", "sort_order": 0, "source_type": "jd_sentence",
                "source_id": "00000000-0000-0000-0000-000000000000", "source_field": null, "quote": "결제 API 설계",
                "source_locator": {"sid": "S1", "start": 0, "end": 9}}]
}');
update t_payload set v = jsonb_set(v, '{evidence,0,source_id}',
  to_jsonb((select id::text from public.job_descriptions
             where application_project_id = 'a0000000-aaaa-0000-0000-000000000001')));
grant select on t_payload to app_ai_writer;

select ok(private.insight_payload_valid((select v from t_payload)), 'payload: the schema 2 template is valid');
select ok(private.insight_payload_valid(jsonb_set((select v from t_payload), '{evidence}', '[]'))
          and private.insight_payload_valid(jsonb_set((select v from t_payload), '{evidence,0}',
                '{"item_key":"strengths.0","sort_order":0,"source_type":"skill",
                  "source_id":"a0000000-6666-0000-0000-000000000001","source_field":"name"}')),
          'payload: jd_sentence evidence is optional — career-only or empty evidence is valid (AI-02 R17 writes career only)');
select ok(not private.insight_payload_valid(jsonb_set((select v from t_payload), '{meta,schema_version}', '1')),
          '#13 payload: schema_version 1 refused (only 2 is written)');
select ok(not private.insight_payload_valid(jsonb_set((select v from t_payload), '{hashes}',
            '{"jd_text_hash":"rawhash1","career_snapshot_hash":"ch","input_hash":"ih2"}')),
          '#13 payload: jd_text_hash instead of raw_text_hash refused');
select ok(not private.insight_payload_valid(jsonb_set((select v from t_payload), '{hashes}',
            '{"requirements_hash":"rawhash1","career_snapshot_hash":"ch","input_hash":"ih2"}')),
          '#13 payload: requirements_hash instead of raw_text_hash refused');
select ok(not private.insight_payload_valid(jsonb_set((select v from t_payload), '{evidence,0,source_type}', '"jd_requirement"')),
          '#13 payload: a jd_requirement evidence source refused');
select ok(not private.insight_payload_valid(jsonb_set((select v from t_payload), '{evidence,0,source_type}', '"user_note"')),
          '#13 payload: user_note is not an insight source');

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.begin_insight('a0000000-aaaa-0000-0000-000000000005', 'a0000000-7777-0000-0000-000000000025')$$,
                 'P0001', 'jd_no_sentences', '#13 begin_insight: a 0-sentence posting -> jd_no_sentences');
select throws_ok($$select public.begin_insight('a0000000-aaaa-0000-0000-000000000006', 'a0000000-7777-0000-0000-000000000026')$$,
                 'P0001', 'job_description_not_found', '#13 begin_insight: no JD row -> job_description_not_found');
select is((select count(*)::int from public.insights where application_project_id in
             ('a0000000-aaaa-0000-0000-000000000005', 'a0000000-aaaa-0000-0000-000000000006')), 0,
          '#13 begin_insight: refused starts leave no row');
select lives_ok($$select set_config('t.i1', public.begin_insight('a0000000-aaaa-0000-0000-000000000001',
                    'a0000000-7777-0000-0000-000000000021')::text, true)$$,
                '#13 begin_insight: no extraction needed');
select is(public.complete_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000021', 1,
            jsonb_set((select v from t_payload), '{hashes,raw_text_hash}', '"rawhash2"')),
          '{"applied": false, "reason": "stale_run"}'::jsonb,
          '#13 complete_insight: the posting changed since prepare (hash mismatch) -> stale_run');
select is((select status from public.insights where id = current_setting('t.i1')::uuid), 'generating',
          '#13 stale_run stored nothing');
select set_config('t.c1', public.complete_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000021', 1,
                    (select v from t_payload))::text, true);
select is((current_setting('t.c1')::jsonb) - 'completed_at' - 'insight_id',
          '{"applied": true, "application_project_id": "a0000000-aaaa-0000-0000-000000000001", "version_no": 2,
            "status": "ready", "is_latest": true, "previous_latest_id": "a0000000-1a51-0000-0000-000000000001",
            "evidence_count": 1}'::jsonb,
          '#13 complete_insight: applied (return shape unchanged)');
select results_eq($$select status, raw_text_hash, schema_version, input_hash, match_stage_result
                      from public.insights where id = current_setting('t.i1')::uuid$$,
                  $$values ('ready'::text, 'rawhash1'::text, 2, 'ih2'::text,
                            '{"prompt_version": "ai-02.match.v3", "items": []}'::jsonb)$$,
                  '#13 raw_text_hash and schema_version 2 stored');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 7. start_writing_chat: params.insight_id / insight_item_key (#14)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
insert into public.application_projects (id, user_id, name, name_source) values
  ('b0000000-aaaa-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'B', 'user');
insert into public.insights (id, user_id, application_project_id, version_no, status, provider, model_tier, connection_tier)
values ('b0000000-1a51-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
        'b0000000-aaaa-0000-0000-000000000001', 1, 'failed', 'gemini', 'default', 'free');

create function pg_temp.gate(p_params jsonb, p_project text default 'a0000000-aaaa-0000-0000-000000000001')
returns text language plpgsql as $f$
declare
  v_id uuid;
begin
  v_id := public.start_writing_chat('a0000000-3333-0000-0000-000000000001',
            jsonb_build_object('feature', 'insight', 'application_project_id', p_project, 'params', p_params));
  return 'ok';
exception when others then
  return sqlerrm;
end;
$f$;
grant execute on function pg_temp.gate(jsonb, text) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(pg_temp.gate('{"insight_id":"a0000000-1a51-0000-0000-000000000001","insight_item_key":"gaps.0"}'), 'ok',
          '#14 insight_id + insight_item_key gaps.0 of my insight on that project: accepted');
select is((select return_target -> 'params' from public.writing_chats
            where project_id = 'a0000000-3333-0000-0000-000000000001'
              and return_target #>> '{params,insight_item_key}' = 'gaps.0'),
          '{"insight_id":"a0000000-1a51-0000-0000-000000000001","insight_item_key":"gaps.0"}'::jsonb,
          '#14 the params are stored on return_target');
select is(pg_temp.gate('{"insight_id":"a0000000-1a51-0000-0000-000000000001","insight_item_key":"gaps.12"}'), 'ok',
          '#14 gaps.{n} with two digits');
select is(pg_temp.gate('{"insight_id":"a0000000-1a51-0000-0000-000000000001"}'), 'ok',
          '#14 insight_id alone is accepted `[가정 R17b-db-4]`');
select is(pg_temp.gate('{}'), 'ok', '#14 no keys: unchanged behaviour');
select is(pg_temp.gate('{"insight_item_key":"gaps.0"}'), 'invalid_return_target', '#14 insight_item_key without insight_id');
select is(pg_temp.gate('{"insight_id":"a0000000-1a51-0000-0000-000000000001","insight_item_key":"strengths.0"}'),
          'invalid_return_target', '#14 insight_item_key must be gaps.{n}');
select is(pg_temp.gate('{"insight_id":"a0000000-1a51-0000-0000-000000000001","insight_item_key":"gaps.123"}'),
          'invalid_return_target', '#14 gaps index over 2 digits');
select is(pg_temp.gate('{"insight_id":"a0000000-1a51-0000-0000-000000000001","insight_item_key":0}'),
          'invalid_return_target', '#14 insight_item_key must be a string');
select is(pg_temp.gate('{"insight_id":"not-a-uuid","insight_item_key":"gaps.0"}'), 'invalid_return_target',
          '#14 insight_id must be a uuid');
select is(pg_temp.gate('{"insight_id":null}'), 'invalid_return_target', '#14 insight_id null');
select is(pg_temp.gate('{"insight_id":"a0000000-1a51-0000-0000-000000000001","insight_item_key":"gaps.0"}',
                       'a0000000-aaaa-0000-0000-000000000002'),
          'invalid_return_target', '#14 the insight must belong to return_target.application_project_id');
select is(pg_temp.gate('{"insight_id":"b0000000-1a51-0000-0000-000000000001","insight_item_key":"gaps.0"}',
                       'b0000000-aaaa-0000-0000-000000000001'),
          'invalid_return_target', '#14 another user''s insight');
select is(pg_temp.gate(jsonb_build_object('insight_id', gen_random_uuid())), 'invalid_return_target',
          '#14 unknown insight');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 8. Document chat greeting: 3 kinds (#14)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
select hasnt_function('private', 'writing_chat_document_greeting', array['boolean', 'integer', 'integer', 'boolean'],
                      '#14 the 4-argument greeting is gone');
select ok(private.writing_chat_document_greeting(0, 0, false) like '자기소개서 문항에 답할 내용을 함께 정리해 볼게요.%',
          '#14 greeting: no body');
select ok(private.writing_chat_document_greeting(2, 1, false) like '지금 쓰신 답변을 바탕으로%', '#14 greeting: partly filled');
select ok(private.writing_chat_document_greeting(2, 2, false) like '문항을 모두 채우셨네요.%', '#14 greeting: all filled');
select ok(private.writing_chat_document_greeting(2, 2, true) like '%Google 제품 개선%'
          and private.writing_chat_document_greeting(2, 2, false) not like '%Google 제품 개선%',
          '#14 greeting: the free-tier line only on the free tier');
select is_empty($$select 1 from public.writing_chat_messages where content like '채용 공고의 요건을 아직%'$$,
                '#14 no "요건 정리 전" greeting was written');

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 9. Account deletion (#14) and isolation
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.job_descriptions where user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'B cannot read A''s JDs');
select is((select count(*)::int from public.insights where user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'B cannot read A''s insights');
reset role;
select lives_ok($$select private.delete_account_data('a0000000-0000-0000-0000-000000000001', repeat('a', 64), 'user_request')$$,
                '#14 delete_account_data runs without jd_requirements');
select is((select count(*)::int from public.job_descriptions where user_id = 'a0000000-0000-0000-0000-000000000001')
          + (select count(*)::int from public.insights where user_id = 'a0000000-0000-0000-0000-000000000001')
          + (select count(*)::int from public.evidence_links where user_id = 'a0000000-0000-0000-0000-000000000001'),
          0, '#14 A''s JDs, insights and evidence are gone');

select * from finish();
rollback;
