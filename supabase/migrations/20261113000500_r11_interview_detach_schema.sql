-- R11 OD-I6 (DM v4.11 2.7.2, 11.6 #1 #2, A.12, A.14): a completed mock interview survives the deletion of its
-- application project.
--   * interview_sessions.application_project_id: null allowed. Null only through the application project's BEFORE
--     DELETE trigger (next migration) + this FK's set null; users have no insert / update grant on the table and the
--     create RPC always sets it.
--   * FK interview_sessions_application_project_fkey: on delete cascade -> on delete set null (application_project_id)
--     (PG 15 column list; user_id stays, same as insight_id / source_session_id).
--   * company_name_snapshot / position_title_snapshot: the JD values at deletion time (<= 200 chars like the JD).
--   * interview_sessions_detached_check: only completed sessions may be detached.
--   * evidence_links.application_project_id: null allowed for the three interview owner types only; the FK stays
--     cascade (MATCH SIMPLE: rows with a null column are neither checked nor cascaded).
-- Not destructive: no row or column is removed. The FK behavior change needs a check before db push (11.6).

alter table public.interview_sessions
  alter column application_project_id drop not null,
  add column company_name_snapshot text,
  add column position_title_snapshot text,
  add constraint interview_sessions_company_name_snapshot_check check (
    company_name_snapshot is null or char_length(company_name_snapshot) between 1 and 200),
  add constraint interview_sessions_position_title_snapshot_check check (
    position_title_snapshot is null or char_length(position_title_snapshot) between 1 and 200),
  add constraint interview_sessions_detached_check check (application_project_id is not null or status = 'completed');

alter table public.interview_sessions drop constraint interview_sessions_application_project_fkey;
alter table public.interview_sessions
  add constraint interview_sessions_application_project_fkey foreign key (application_project_id, user_id)
    references public.application_projects (id, user_id) on delete set null (application_project_id);

comment on column public.interview_sessions.application_project_id is
  'Null = the application project was deleted and this completed session was kept (OD-I6, DM 2.7.2). Read-only.';
comment on column public.interview_sessions.company_name_snapshot is
  'job_descriptions.company_name at the time the application project was deleted (OD-I6). Null while it exists.';
comment on column public.interview_sessions.position_title_snapshot is
  'job_descriptions.position_title at the time the application project was deleted (OD-I6). Null while it exists.';

alter table public.evidence_links
  alter column application_project_id drop not null,
  add constraint evidence_links_detached_check check (
    application_project_id is not null
    or owner_type in ('interview_question', 'answer_evaluation', 'session_feedback'));
