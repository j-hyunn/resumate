-- S5: complete the application_project_id references left as plain uuids in S3 / S3a (DM §3.1, §4.1, DM-2).
--   * ai_jobs, evidence_links: deleted with the application project (F-AP-05).
--   * ai_usage_records: the usage record stays; only application_project_id becomes null (F-AP-05, D-36).
-- Assumes no existing rows point at a missing project (local data is rebuilt by `supabase db reset`).
-- A runner whose job row vanished with its project sees 0-row writes / *_not_found; api treats it as canceled.

alter table public.ai_jobs
  add constraint ai_jobs_application_project_fkey foreign key (application_project_id, user_id)
    references public.application_projects (id, user_id) on delete cascade;

alter table public.evidence_links
  add constraint evidence_links_application_project_fkey foreign key (application_project_id, user_id)
    references public.application_projects (id, user_id) on delete cascade;

alter table public.ai_usage_records
  add constraint ai_usage_records_application_project_fkey foreign key (application_project_id, user_id)
    references public.application_projects (id, user_id) on delete set null (application_project_id);

-- AI-01 job shape: the target is the JD row of the job's application project (begin_jd_extraction checks
-- that they match). target_type has no global CHECK list; this pins it for jd_extraction like
-- ai_jobs_writing_chat_turn_check does for writing_chat_turn.
alter table public.ai_jobs
  add constraint ai_jobs_jd_extraction_check check (
    job_type <> 'jd_extraction'
    or (target_type = 'job_description' and target_id is not null and application_project_id is not null));
