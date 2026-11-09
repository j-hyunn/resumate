-- R15 / D5 (DM 11.10 #1, §2.6 job_descriptions — CF-10·CF-A16)
-- The posting URL typed in step 1 of the add modal. The 작성 화면 "JD 상세" link opens it. Written by
-- create_application_project only (no user update grant — treated like the raw posting text), and NOT granted to
-- app_ai_writer (a URL never goes into a prompt) `[가정]`. Kept even when the fetch failed and the user pasted the
-- body by hand (UX DM-10). Tracking query strings are stored as given (they are never logged, 11.10 (3)).
alter table public.job_descriptions
  add column source_url text,
  add constraint job_descriptions_source_url_check
    check (source_url is null or (char_length(source_url) <= 2048 and source_url ~* '^https?://'));

grant select (source_url) on public.job_descriptions to authenticated;
grant select (source_url) on public.job_descriptions to service_role;

-- app_ai_writer held a table-level SELECT on job_descriptions, which would silently include every new column.
-- DM 11.10 #1 says the posting URL is not granted to the AI role, so the grant becomes column-level: every
-- existing column except source_url. A later column is then also excluded until someone grants it on purpose.
revoke select on table public.job_descriptions from app_ai_writer;
grant select (id, user_id, application_project_id, raw_text, raw_text_hash, sentences, detected_language,
              company_name, company_name_source, position_title, position_title_source, extraction_status,
              extraction, extraction_job_id, extraction_provider, extraction_model, tech_keywords,
              requirements_hash, created_at, updated_at, raw_text_edited_at)
  on public.job_descriptions to app_ai_writer;
