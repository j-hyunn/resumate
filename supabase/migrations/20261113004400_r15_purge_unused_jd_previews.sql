-- R15 / D15 (DM 11.10 #5a·#9, §2.6.2 "쓰이지 않은 미리 보기 작업의 정리" — CF-A17, AI 요청 1) `[가정]`
-- A preview extraction that was never linked to an application project (target_type = 'jd_preview' and
-- target_id is null) keeps its full AI-01 result in `output`. 24 hours after it finished, the result is cleared:
--   output -> null, step_outputs -> '{}'
-- The JOB ROW ITSELF stays on the ordinary 90-day retention (purge_old_ai_jobs); what is left after 24 hours is
-- params.raw_text_hash / input_hash (hashes, not the posting text) and the provider / model / token metadata.
-- The usage row keeps its 13-month retention and stays visible in the meter as "요건 추출"
-- (application_project_id null). One line for the existing ai_jobs cleanup cron.
create or replace function public.purge_unused_jd_preview_outputs(p_now timestamptz default now(),
  p_limit integer default 5000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.purge_check_args(p_now, p_limit);

  update public.ai_jobs d
     set output = null, step_outputs = '{}'::jsonb
   where d.id in (
     select j.id
       from public.ai_jobs j
      where j.job_type = 'jd_extraction'
        and j.target_type = 'jd_preview'
        and j.target_id is null
        and j.finished_at is not null
        and j.finished_at < p_now - interval '24 hours'
        and (j.output is not null or j.step_outputs <> '{}'::jsonb)
      order by j.finished_at, j.id
      limit p_limit
        for update skip locked);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_unused_jd_preview_outputs(timestamptz, integer) from public, anon, authenticated,
  app_ai_writer;
grant execute on function public.purge_unused_jd_preview_outputs(timestamptz, integer) to service_role;
