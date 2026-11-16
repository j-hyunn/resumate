-- DESTRUCTIVE: drops table public.jd_requirements (all rows, triggers, policies, grants) and 8 job_descriptions columns (extraction_status, extraction, extraction_job_id, extraction_provider, extraction_model, tech_keywords, requirements_hash, detected_language) with their CHECKs, FK and index; removes 'jd_requirement' from evidence_links_source_type_check. Aborts (rolls back) if the end-state assertions fail.
--
-- R17 alignment (2026-11-16), migration C of three (DM v4.16 §11.11 steps 6–8, decisions 4.24 #1·#2·#5).
-- Needs A (…004800: JD evidence rows deleted) and B (…004810: no function reads these columns / the table).

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Drops
-- ---------------------------------------------------------------------------------------------------------------
-- Table: its triggers (jd_requirements_set_updated_at, jd_requirements_evidence_source_deleted), RLS policies and
-- grants go with it.
drop table public.jd_requirements;
-- Its source_sids CHECK was the last user of jd_sids_valid (4.24 #3 "다른 사용처 없으면").
drop function private.jd_sids_valid(text[]);

-- Columns: their CHECKs (_extraction_status_check, _extraction_check, _extraction_provider_check,
-- _tech_keywords_check, _requirements_hash_check, _succeeded_check, _detected_language_check), the FK
-- job_descriptions_extraction_job_fkey, the index job_descriptions_extraction_job_id_idx and the column grants to
-- authenticated / app_ai_writer go with them.
alter table public.job_descriptions
  drop column extraction_status,
  drop column extraction,
  drop column extraction_job_id,
  drop column extraction_provider,
  drop column extraction_model,
  drop column tech_keywords,
  drop column requirements_hash,
  drop column detected_language;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. CHECK: jd_requirement is no longer an evidence source (A deleted every such row).
-- ---------------------------------------------------------------------------------------------------------------
alter table public.evidence_links drop constraint evidence_links_source_type_check;
alter table public.evidence_links add constraint evidence_links_source_type_check
  check (source_type in ('profile', 'experience', 'education', 'project', 'project_deliverable', 'skill',
                         'jd_sentence', 'user_note'));

-- ---------------------------------------------------------------------------------------------------------------
-- 8. End-state assertions (stop guard). Kept as an operator-only function so pgTAP can run it on seeded rows
--    (`[가정 R17b-db-1]`); no execute grant to any role.
-- ---------------------------------------------------------------------------------------------------------------
create function private.r17_jd_raw_text_assert()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_count bigint;
begin
  -- jd_requirement cannot exist any more (CHECK above); counted on the text so the function stays valid.
  select count(*) into v_count from public.evidence_links el where el.source_type::text = 'jd_requirement';
  if v_count > 0 then
    raise exception using errcode = 'P0001', message = 'r17_assert_failed',
      detail = v_count || ' jd_requirement evidence rows left';
  end if;
  select count(*) into v_count from public.evidence_links el
   where el.owner_type = 'application_document' and el.source_type = 'jd_sentence';
  if v_count > 0 then
    raise exception using errcode = 'P0001', message = 'r17_assert_failed',
      detail = v_count || ' application_document jd_sentence evidence rows left';
  end if;
  select count(*) into v_count from public.writing_chats w
   where w.document_kind is not null
     and jsonb_path_exists(w.structured_draft,
           'strict $.** ? (@.source_type == "jd_requirement" || @.source_type == "jd_sentence")');
  if v_count > 0 then
    raise exception using errcode = 'P0001', message = 'r17_assert_failed',
      detail = v_count || ' document chats still carry JD sources';
  end if;
  select count(*) into v_count from public.application_projects ap where ap.name is null;
  if v_count > 0 then
    raise exception using errcode = 'P0001', message = 'r17_assert_failed',
      detail = v_count || ' application projects without a name';
  end if;
  select count(*) into v_count from public.ai_jobs j
   where j.job_type = 'jd_extraction' and j.status in ('queued', 'running');
  if v_count > 0 then
    raise exception using errcode = 'P0001', message = 'r17_assert_failed',
      detail = v_count || ' jd_extraction jobs still queued / running';
  end if;
end;
$$;

revoke all on function private.r17_jd_raw_text_assert() from public;

select private.r17_jd_raw_text_assert();
