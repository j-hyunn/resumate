-- R11 OD-I6 (DM v4.11 2.7.2, 11.6 #3): BEFORE DELETE row trigger on application_projects.
-- Right before each project row goes:
--   1. its completed sessions get company_name_snapshot / position_title_snapshot from the project's JD (null when
--      there is no JD or the value is empty);
--   2. the evidence of those sessions' questions / answer evaluations / session feedback gets
--      application_project_id = null, so the evidence_links cascade leaves it alone;
--   3. its other sessions (in_progress / evaluating / evaluation_failed / abandoned) are deleted here: the existing
--      interview_sessions_cancel_jobs trigger flags their queued / running jobs, children and owner evidence go by
--      the existing cascades and owner triggers.
-- Then the original cascade runs: JD / requirements go (their source-deleted triggers mark the kept JD evidence
-- "원본 삭제됨"), the kept sessions get application_project_id = null from the FK, ai_jobs cascade.
-- Every path that deletes an application project goes through here: the user's direct delete (RLS), delete_account
-- and the inactive-account purge (they delete interview_sessions by user_id right after, so nothing is kept), and the
-- auth.users cascade (the user row is already gone: every session of the project is deleted here).
-- Lock order: application project (being deleted) -> JD (read) -> interview_sessions -> evidence_links -> ai_jobs,
-- the same order as the plain cascade.
create or replace function private.application_projects_detach_interviews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company text;
  v_position text;
  v_kept uuid[];
begin
  -- auth.users cascade (the account itself is going): nothing is kept, and updating the sessions would re-check
  -- their user_id FK against the deleted user row. Delete them here instead (same result as the user_id cascade).
  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    delete from public.interview_sessions s where s.application_project_id = old.id and s.user_id = old.user_id;
    return old;
  end if;

  select nullif(btrim(jd.company_name), ''), nullif(btrim(jd.position_title), '')
    into v_company, v_position
    from public.job_descriptions jd
   where jd.application_project_id = old.id and jd.user_id = old.user_id;

  perform 1 from public.interview_sessions s
   where s.application_project_id = old.id and s.user_id = old.user_id
   order by s.id
     for update;

  with kept as (
    update public.interview_sessions s
       set company_name_snapshot = left(v_company, 200),
           position_title_snapshot = left(v_position, 200)
     where s.application_project_id = old.id and s.user_id = old.user_id and s.status = 'completed'
    returning s.id
  )
  select coalesce(array_agg(kept.id), '{}') into v_kept from kept;

  if cardinality(v_kept) > 0 then
    update public.evidence_links el
       set application_project_id = null
     where el.user_id = old.user_id
       and el.application_project_id = old.id
       and ((el.owner_type = 'interview_question'
             and el.owner_id in (select q.id from public.interview_questions q where q.session_id = any (v_kept)))
            or (el.owner_type = 'answer_evaluation'
                and el.owner_id in (select e.id from public.answer_evaluations e where e.session_id = any (v_kept)))
            or (el.owner_type = 'session_feedback'
                and el.owner_id in (select f.id from public.session_feedbacks f where f.session_id = any (v_kept))));
  end if;

  delete from public.interview_sessions s
   where s.application_project_id = old.id and s.user_id = old.user_id and s.status <> 'completed';

  return old;
end;
$$;

revoke all on function private.application_projects_detach_interviews() from public;

create trigger application_projects_detach_interviews
  before delete on public.application_projects
  for each row execute function private.application_projects_detach_interviews();
