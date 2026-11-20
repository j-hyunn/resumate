-- DESTRUCTIVE: deletes evidence_links rows (every source_type = 'jd_requirement' row; every owner_type = 'application_document' row with source_type = 'jd_sentence'), strips jd_requirement / jd_sentence source elements from document writing chats' structured_draft, clears output / step_outputs of jd_preview ai_jobs, cancels queued / running jd_extraction jobs, and renames insights.requirements_hash -> raw_text_hash overwriting every value with the JD's current raw_text_hash. No conversion, no backup table (JR-Q3 (b)).
--
-- R17 alignment (2026-11-16), migration A of three (DM v4.16 §11.11 (4), decisions 4.24 #4·#13·#16):
--   0. counts of what is about to change, as NOTICEs (the same 10 counts as _workspace/backend/R17/release-counts.md)
--   1. close in-flight jd_extraction jobs (the release trigger goes first — it calls a helper dropped in B)
--   2. empty jd_preview job outputs, backfill application_projects.name where it is null
--   3. delete JD evidence rows (no conversion)
--   4. remove JD source elements from document chat proposals
--   5. insights.requirements_hash -> raw_text_hash (value = the JD's current raw_text_hash)
-- B (…004810) replaces the functions, C (…004820) drops the extraction table / columns and asserts the end state.
-- Kept (JR-Q5): schema_version = 1 insights and their remaining evidence rows, legacy CHECK values.

-- ---------------------------------------------------------------------------------------------------------------
-- 0. Counts before anything changes (read only)
-- ---------------------------------------------------------------------------------------------------------------
do $$
declare
  v text;
begin
  raise notice 'r17 cleanup ① jd_requirements rows: %', (select count(*) from public.jd_requirements);
  select coalesce(string_agg(s || '=' || c, ', ' order by s), '-') into v
    from (select extraction_status s, count(*) c from public.job_descriptions group by 1) t;
  raise notice 'r17 cleanup ② job_descriptions by extraction_status: %', v;
  select coalesce(string_agg(coalesce(sv::text, 'null') || '/' || st || '=' || c, ', ' order by sv, st), '-') into v
    from (select schema_version sv, status st, count(*) c from public.insights group by 1, 2) t;
  raise notice 'r17 cleanup ③ insights by schema_version/status: %', v;
  select coalesce(string_agg(o || '=' || c, ', ' order by o), '-') into v
    from (select owner_type o, count(*) c from public.evidence_links where source_type = 'jd_requirement' group by 1) t;
  raise notice 'r17 cleanup ④ jd_requirement evidence by owner_type: %', v;
  raise notice 'r17 cleanup ⑤ application_document jd_sentence evidence: %',
    (select count(*) from public.evidence_links where owner_type = 'application_document' and source_type = 'jd_sentence');
  raise notice 'r17 cleanup ⑥ document chats with JD sources in structured_draft: %',
    (select count(*) from public.writing_chats w
      where w.document_kind is not null
        and jsonb_path_exists(w.structured_draft,
              'strict $.** ? (@.source_type == "jd_requirement" || @.source_type == "jd_sentence")'));
  raise notice 'r17 cleanup ⑦ queued/running jd_extraction jobs: %',
    (select count(*) from public.ai_jobs where job_type = 'jd_extraction' and status in ('queued', 'running'));
  raise notice 'r17 cleanup ⑧ jd_preview jobs with output left: %',
    (select count(*) from public.ai_jobs
      where target_type = 'jd_preview' and (output is not null or step_outputs <> '{}'::jsonb));
  raise notice 'r17 cleanup ⑨ application_projects with name null: %',
    (select count(*) from public.application_projects where name is null);
  raise notice 'r17 cleanup ⑩ job_descriptions with 0 sentences: %',
    (select count(*) from public.job_descriptions where jsonb_array_length(sentences) = 0);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. The jd_extraction release trigger forwards failed / canceled jobs to private.jd_extraction_mark_failed,
--    which B drops; it goes before the jobs are closed (DM §11.11 step 1).
-- ---------------------------------------------------------------------------------------------------------------
drop trigger if exists ai_jobs_release_jd_extraction on public.ai_jobs;
drop function if exists private.ai_jobs_release_jd_extraction();

-- ---------------------------------------------------------------------------------------------------------------
-- Steps 1–4 as one operator-only function, so the pgTAP suite can run the same code on seeded legacy rows
-- (`[가정 R17b-db-1]` — precedent: private.backfill_education_display_labels, DM §2.7). No execute grant to any
-- role; postgres only. Idempotent: a second run changes nothing.
-- ---------------------------------------------------------------------------------------------------------------

-- Removes, at any depth, array elements that are objects with source_type jd_requirement / jd_sentence
-- (document proposals keep them in document.questions[].draft.sources[] and draft.blocks[].evidence[]).
create function private.r17_strip_jd_sources(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p) = 'array' then
    return coalesce((select jsonb_agg(private.r17_strip_jd_sources(e) order by o)
                       from jsonb_array_elements(p) with ordinality as t (e, o)
                      where not (jsonb_typeof(e) = 'object'
                                 and coalesce(e ->> 'source_type', '') in ('jd_requirement', 'jd_sentence'))),
                    '[]'::jsonb);
  elsif jsonb_typeof(p) = 'object' then
    return coalesce((select jsonb_object_agg(k, private.r17_strip_jd_sources(v)) from jsonb_each(p) as t (k, v)),
                    '{}'::jsonb);
  end if;
  return p;
end;
$$;

create function private.r17_jd_raw_text_cleanup()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_jobs_canceled integer;
  v_previews_cleared integer;
  v_names_filled integer;
  v_req_evidence integer;
  v_doc_sentence_evidence integer;
  v_chats integer;
begin
  -- 1. in-flight jd_extraction jobs -> canceled (no runner handles them any more).
  update public.ai_jobs j
     set status = 'canceled', error_code = 'canceled', finished_at = now()
   where j.job_type = 'jd_extraction' and j.status in ('queued', 'running');
  get diagnostics v_jobs_canceled = row_count;

  -- 2a. preview extraction outputs (the job rows themselves age out with the normal 90-day purge).
  update public.ai_jobs j
     set output = null, step_outputs = '{}'::jsonb
   where j.target_type = 'jd_preview' and (j.output is not null or j.step_outputs <> '{}'::jsonb);
  get diagnostics v_previews_cleared = row_count;

  -- 2b. "추출 대기" names: no extraction will come to fill them (DM §2.6 이름 규칙).
  update public.application_projects ap
     set name = private.application_default_name(ap.created_at), name_source = 'default'
   where ap.name is null;
  get diagnostics v_names_filled = row_count;

  -- 3. JD evidence rows, deleted without conversion (JR-Q3 (b), JR-5). Old insights keep their other rows.
  delete from public.evidence_links el where el.source_type = 'jd_requirement';
  get diagnostics v_req_evidence = row_count;
  delete from public.evidence_links el
   where el.owner_type = 'application_document' and el.source_type = 'jd_sentence';
  get diagnostics v_doc_sentence_evidence = row_count;

  -- 4. JD source elements inside document chat proposals; the rest of each proposal stays appliable and
  --    structured_draft.schema_version is unchanged.
  update public.writing_chats w
     set structured_draft = private.r17_strip_jd_sources(w.structured_draft)
   where w.document_kind is not null
     and jsonb_path_exists(w.structured_draft,
           'strict $.** ? (@.source_type == "jd_requirement" || @.source_type == "jd_sentence")');
  get diagnostics v_chats = row_count;

  return jsonb_build_object(
    'jd_extraction_jobs_canceled', v_jobs_canceled,
    'jd_preview_outputs_cleared', v_previews_cleared,
    'names_filled', v_names_filled,
    'jd_requirement_evidence_deleted', v_req_evidence,
    'document_jd_sentence_evidence_deleted', v_doc_sentence_evidence,
    'document_chats_stripped', v_chats);
end;
$$;

revoke all on function private.r17_strip_jd_sources(jsonb) from public;
revoke all on function private.r17_jd_raw_text_cleanup() from public;

do $$
begin
  raise notice 'r17 cleanup result: %', private.r17_jd_raw_text_cleanup();
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. insights.requirements_hash -> raw_text_hash (DM §2.7.0, 4.24 #13). Value = the JD's current raw_text_hash
--    for every existing row (old rows are schema_version 1 and not shown, but stay not null for the ready CHECK).
--    updated_at is left alone (the trigger is paused for this one backfill).
-- ---------------------------------------------------------------------------------------------------------------
alter table public.insights rename column requirements_hash to raw_text_hash;
alter table public.insights rename constraint insights_requirements_hash_check to insights_raw_text_hash_check;

alter table public.insights disable trigger insights_set_updated_at;
update public.insights i
   set raw_text_hash = jd.raw_text_hash
  from public.job_descriptions jd
 where jd.application_project_id = i.application_project_id
   and i.raw_text_hash is distinct from jd.raw_text_hash;
alter table public.insights enable trigger insights_set_updated_at;

alter table public.insights drop constraint insights_ready_check;
alter table public.insights add constraint insights_ready_check
  check (status <> 'ready'
         or (result is not null and match_stage_result is not null and completed_at is not null
             and raw_text_hash is not null and career_snapshot_hash is not null and input_hash is not null
             and schema_version is not null and prompt_version is not null and provider is not null
             and model is not null and model_tier is not null and connection_tier is not null));

comment on column public.insights.raw_text_hash is
  'R17 (DM v4.16 §2.7.0): job_descriptions.raw_text_hash this insight was built on (copied at prepare). '
  'staleReasons.rawText = this <> job_descriptions.raw_text_hash. Rows before R17 hold the JD hash at migration time.';
