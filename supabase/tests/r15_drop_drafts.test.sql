-- R15 (DM 11.8 #8·#9·#10, 배포 4단계 — CL-3 · v4.15 CF-M1): the state after the destructive migration.
-- The guard itself (step 0) cannot be asserted from pgTAP, because the tables it counts no longer exist once the
-- migration has run. It is verified against the real migration text by the command recorded in
-- _workspace/backend/R15/02_db-engineer_notes.md ("가드 검증 방법").
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ── the three tables are gone ──
select is_empty($$select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public'
                     and c.relname in ('drafts', 'draft_sections', 'draft_section_sources')$$,
                'the three drafts tables are dropped');

-- ── the old document RPCs / helpers / trigger functions are gone ──
select is_empty($$select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('public', 'private')
                     and p.proname in ('begin_career_description', 'complete_career_description',
                       'fail_career_description', 'begin_cover_letter_section', 'complete_cover_letter_section',
                       'fail_draft_section', 'create_cover_letter_draft', 'add_cover_letter_question',
                       'delete_cover_letter_question', 'reorder_cover_letter_questions', 'set_section_sources',
                       'ai_jobs_release_drafts', 'draft_sources_mark_project_deleted',
                       'draft_sources_mark_education_deleted', 'draft_sources_mark_experience_deleted',
                       'draft_source_label', 'draft_source_parent_name', 'backfill_education_display_labels',
                       'draft_recompute_status', 'draft_insert_evidence', 'draft_sections_delete_evidence',
                       'drafts_keep_first_copied_at', 'reset_cover_letter_sections', 'cancel_draft_jobs',
                       'career_deletion_draft_ids', 'career_deletion_section_ids', 'draft_blocks_valid',
                       'draft_options_valid', 'draft_default_title', 'draft_resolve_title',
                       'draft_evidence_elem_valid', 'career_description_sections_valid',
                       'cover_letter_section_draft_id', 'lock_cover_letter_draft', 'lock_cover_letter_section',
                       'draft_section_job_active', 'draft_section_mark_failed', 'draft_section_sources_json',
                       'career_description_begin_json', 'career_description_job_matches',
                       'career_description_mark_failed', 'cover_letter_begin_json',
                       'cover_letter_job_matches')$$,
                'every object of DM 11.8 #8 is dropped');
-- No surviving function body still reads the dropped tables.
select is_empty($$select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('public', 'private')
                     and p.prosrc ~ '(public\.drafts|public\.draft_sections|public\.draft_section_sources)\M'$$,
                'no surviving function body reads a dropped table');
-- The triggers that lived on surviving tables are gone with their functions.
select is_empty($$select t.tgname from pg_trigger t
                   where not t.tgisinternal
                     and t.tgname in ('ai_jobs_release_drafts', 'experiences_draft_sources_deleted',
                                      'educations_draft_sources_deleted', 'projects_draft_sources_deleted')$$,
                'the draft triggers on the surviving tables are dropped');

-- ── kept on purpose (DM 11.8 #8) ──
select has_function('private', 'education_display_name', 'private.education_display_name is kept');
select has_function('private', 'trim_js_whitespace', 'private.trim_js_whitespace is kept');

-- ── evidence_links.owner_type: draft_section removed (the guard proved 0 rows) ──
select is((select array_agg(m[1] order by m[1])
             from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
            where c.conname = 'evidence_links_owner_type_check'),
          array['application_document', 'chat_message', 'insight'],
          'owner_type = insight / chat_message / application_document');
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');
insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'P1', 'user');
insert into public.experiences (id, user_id, company_name, start_month) values
  ('a0000000-1111-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'A사', '2023-01-01');
select throws_ok($$insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id,
                     item_key, source_type, source_id, source_field)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
                           'draft_section', gen_random_uuid(), 'k', 'experience',
                           'a0000000-1111-0000-0000-000000000001', 'summary')$$,
                 -- The insert trigger (stage 3) refuses it first; the CHECK below is the second line.
                 'P0001', 'invalid_evidence_source', 'a draft_section owner is refused');
select ok((select pg_get_constraintdef(oid) not like '%draft_section%'
             from pg_constraint where conname = 'evidence_links_owner_type_check'),
          'and the CHECK no longer lists draft_section either');

-- ── values kept on purpose (CF-A3): past rows must stay valid ──
select ok((select pg_get_constraintdef(oid) like '%career_description%'
             and pg_get_constraintdef(oid) like '%draft_source_ranking%'
             from pg_constraint where conname = 'ai_jobs_job_type_check'),
          'ai_jobs.job_type keeps career_description / draft_source_ranking (past rows, CF-A3)');
select ok((select pg_get_constraintdef(oid) like '%career_description%'
             from pg_constraint where conname = 'ai_usage_records_feature_check'),
          'ai_usage_records.feature keeps career_description (13-month retention, CF-A3)');
select lives_ok($$insert into public.ai_jobs (user_id, job_type, target_type, target_id, application_project_id,
                    status, run_generation, provider, model_tier, connection_tier)
                  values ('a0000000-0000-0000-0000-000000000001', 'career_description', 'draft',
                          gen_random_uuid(), 'a0000000-aaaa-0000-0000-000000000001', 'succeeded', 1, 'gemini',
                          'default', 'free')$$,
                'ai_jobs.target_type keeps draft / draft_section (90-day retention rows)');

select * from finish();
rollback;
