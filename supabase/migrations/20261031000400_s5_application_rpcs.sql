-- S5 application project RPCs (DM §2.6, §5, §7; F-AP-01, F-ST-01~05; D-30 key-less JD).
--   create_application_project  user session, definer (insert is RPC-only for projects / JD / events)
--   move_application_stage      user session, definer + owner check (DM §5)
--   set_application_outcome     user session, definer + owner check (DM §5)
-- Errors: 42501 not_authenticated; P0001 with a lowercase code in `message`.

-- ── helpers ────────────────────────────────────────────────────────────────

-- "회사명 – 포지션명" (en dash), cut to the 100-char name limit (A.5). Null unless both parts are present.
create or replace function private.application_compose_name(p_company_name text, p_position_title text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(p_company_name), '') is null or nullif(btrim(p_position_title), '') is null then null
    else rtrim(left(btrim(p_company_name) || ' – ' || btrim(p_position_title), 100))
  end;
$$;

revoke all on function private.application_compose_name(text, text) from public;

-- D-30 default name "새 기업 JD (YYYY-MM-DD)", KST date of p_at [가정 1].
create or replace function private.application_default_name(p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select '새 기업 JD (' || to_char(p_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ')';
$$;

revoke all on function private.application_default_name(timestamptz) from public;

-- Name used when no extraction will fill it (key-less creation, failed extraction) [가정 1, 2]:
-- both user-known company and position -> composed name ('user'), otherwise the default name ('default').
create or replace function private.application_fallback_name(
  p_company_name text, p_position_title text, p_at timestamptz,
  out name text, out name_source text)
language sql
stable
set search_path = ''
as $$
  select coalesce(private.application_compose_name(p_company_name, p_position_title),
                  private.application_default_name(p_at)),
         case when private.application_compose_name(p_company_name, p_position_title) is null
              then 'default' else 'user' end;
$$;

revoke all on function private.application_fallback_name(text, text, timestamptz) from public;

-- D-30: may an AI job run for this user right now? Same rule as check_ai_run_allowed (S3b) applied to the
-- active provider: an active provider, its key row not invalid, and the run-time consent rule (DM 2.11.5).
-- Never reads ciphertext columns. Called only from definer RPCs.
create or replace function private.user_ai_run_allowed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select k.status <> 'invalid' and private.ai_consent_allows_run(p.id, k.provider, k.connection_tier)
      from public.profiles p
      join public.ai_provider_keys k on k.user_id = p.id and k.provider = p.active_ai_provider
     where p.id = p_user_id), false);
$$;

revoke all on function private.user_ai_run_allowed(uuid) from public;


-- ── create_application_project ─────────────────────────────────────────────
-- One transaction: application_projects + job_descriptions + `created` event (to_stage before_apply).
-- Name rule (D-30, A.5):
--   p_name given                      -> (p_name, 'user')
--   else AI can run now               -> (null, null)  = waiting for AI-01 (the action calls extraction next)
--   else                              -> application_fallback_name (composed 'user' or default 'default')
-- Idempotent on p_id (S2 rule): the caller's existing row is returned as is (created = false).
-- Returns {application_project_id, job_description_id, name, name_source, extraction_status,
--          ai_run_allowed, created}.
create or replace function public.create_application_project(
  p_id uuid,
  p_raw_text text,
  p_raw_text_hash text,
  p_sentences jsonb,
  p_company_name text default null,
  p_position_title text default null,
  p_name text default null,
  p_deadline date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(p_name), '');
  v_company text := nullif(btrim(p_company_name), '');
  v_position text := nullif(btrim(p_position_title), '');
  v_allowed boolean;
  v_name_source text;
  v_inserted uuid;
  v_owner uuid;
  v_jd_id uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_id';
  end if;
  if p_raw_text is null or btrim(p_raw_text) = '' or char_length(p_raw_text) > 50000 then
    raise exception using errcode = 'P0001', message = 'invalid_raw_text';
  end if;
  if p_raw_text_hash is null or btrim(p_raw_text_hash) = '' or char_length(p_raw_text_hash) > 128 then
    raise exception using errcode = 'P0001', message = 'invalid_raw_text_hash';
  end if;
  if not private.jd_sentences_valid(p_sentences) then
    raise exception using errcode = 'P0001', message = 'invalid_sentences';
  end if;
  if char_length(v_name) > 100 then
    raise exception using errcode = 'P0001', message = 'invalid_name';
  end if;
  if char_length(v_company) > 200 then
    raise exception using errcode = 'P0001', message = 'invalid_company_name';
  end if;
  if char_length(v_position) > 200 then
    raise exception using errcode = 'P0001', message = 'invalid_position_title';
  end if;

  v_allowed := private.user_ai_run_allowed(v_uid);

  if v_name is not null then
    v_name_source := 'user';
  elsif not v_allowed then
    select f.name, f.name_source into v_name, v_name_source
      from private.application_fallback_name(v_company, v_position, now()) f;
  end if;

  insert into public.application_projects (id, user_id, name, name_source, deadline)
  values (p_id, v_uid, v_name, v_name_source, p_deadline)
  on conflict (id) do nothing
  returning id into v_inserted;

  if v_inserted is null then
    -- Retry with the same id (or someone else's id).
    select ap.user_id, ap.name, ap.name_source into v_owner, v_name, v_name_source
      from public.application_projects ap where ap.id = p_id;
    if v_owner is distinct from v_uid then
      raise exception using errcode = 'P0001', message = 'application_project_id_conflict';
    end if;
    select jd.id, jd.extraction_status into v_jd_id, v_status
      from public.job_descriptions jd where jd.application_project_id = p_id;
    return jsonb_build_object(
      'application_project_id', p_id, 'job_description_id', v_jd_id,
      'name', v_name, 'name_source', v_name_source, 'extraction_status', v_status,
      'ai_run_allowed', v_allowed, 'created', false);
  end if;

  insert into public.job_descriptions (user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                       company_name, company_name_source, position_title, position_title_source)
  values (v_uid, p_id, p_raw_text, btrim(p_raw_text_hash), p_sentences,
          v_company, case when v_company is not null then 'user' end,
          v_position, case when v_position is not null then 'user' end)
  returning id into v_jd_id;

  insert into public.application_stage_events (user_id, application_project_id, event_type, to_stage)
  values (v_uid, p_id, 'created', 'before_apply');

  return jsonb_build_object(
    'application_project_id', p_id, 'job_description_id', v_jd_id,
    'name', v_name, 'name_source', v_name_source, 'extraction_status', 'pending',
    'ai_run_allowed', v_allowed, 'created', true);
end;
$$;

revoke all on function public.create_application_project(uuid, text, text, jsonb, text, text, text, date)
  from public, anon;
grant execute on function public.create_application_project(uuid, text, text, jsonb, text, text, text, date)
  to authenticated;


-- ── move_application_stage (DM §2.6 steps 1–5) ──────────────────────────────
-- Returns {stage, stage_outcome, stage_changed_at, changed, interview_prompt}.
--   1. same stage -> no change, no event (p_outcome ignored), interview_prompt null.
--   2. leaving closed -> stage_outcome = null (D-UX-12 (a)); the cleared value is the event's from_outcome.
--   3. p_outcome only with to_stage = 'closed' (else invalid_outcome).
--   4. stage, stage_changed_at = now(), last_activity_at = now(), `stage_changed` event.
--   5. interview_prompt (C-14): {interview_type: 'job' | 'culture_fit', in_progress_session_id: null} when
--      moving into an interview column. S8 fills in_progress_session_id (create or replace).
create or replace function public.move_application_stage(
  p_application_project_id uuid,
  p_to_stage text,
  p_outcome text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_project public.application_projects%rowtype;
  v_new_outcome text;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_to_stage is null or p_to_stage not in (
       'before_apply', 'document', 'assignment', 'job_interview', 'culture_fit_interview', 'closed') then
    raise exception using errcode = 'P0001', message = 'invalid_stage';
  end if;
  if p_outcome is not null and (p_outcome not in ('passed', 'failed') or p_to_stage <> 'closed') then
    raise exception using errcode = 'P0001', message = 'invalid_outcome';
  end if;

  select * into v_project from public.application_projects ap
   where ap.id = p_application_project_id and ap.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'application_project_not_found';
  end if;

  if v_project.stage = p_to_stage then
    return jsonb_build_object(
      'stage', v_project.stage, 'stage_outcome', v_project.stage_outcome,
      'stage_changed_at', v_project.stage_changed_at, 'changed', false, 'interview_prompt', null);
  end if;

  -- Entering closed: only the given outcome (null = 결과 미기록). Leaving closed: cleared. Other moves: null.
  v_new_outcome := case when p_to_stage = 'closed' then p_outcome end;

  update public.application_projects ap
     set stage = p_to_stage, stage_outcome = v_new_outcome,
         stage_changed_at = v_now, last_activity_at = v_now
   where ap.id = p_application_project_id;

  insert into public.application_stage_events (user_id, application_project_id, event_type,
                                               from_stage, to_stage, from_outcome, to_outcome)
  values (v_uid, p_application_project_id, 'stage_changed',
          v_project.stage, p_to_stage, v_project.stage_outcome, v_new_outcome);

  return jsonb_build_object(
    'stage', p_to_stage, 'stage_outcome', v_new_outcome, 'stage_changed_at', v_now, 'changed', true,
    'interview_prompt', case p_to_stage
      when 'job_interview' then jsonb_build_object('interview_type', 'job', 'in_progress_session_id', null)
      when 'culture_fit_interview' then jsonb_build_object('interview_type', 'culture_fit', 'in_progress_session_id', null)
    end);
end;
$$;

revoke all on function public.move_application_stage(uuid, text, text) from public, anon;
grant execute on function public.move_application_stage(uuid, text, text) to authenticated;


-- ── set_application_outcome ───────────────────────────────────────────────
-- Only while stage = 'closed' (else not_closed). p_outcome passed / failed, or null to clear it [가정 6].
-- Same value -> no event. Otherwise stage_outcome + last_activity_at, `outcome_changed` event
-- (from_stage = to_stage = 'closed'). stage_changed_at is not touched (board order = column moves).
-- Returns {stage, stage_outcome, stage_changed_at, changed}.
create or replace function public.set_application_outcome(p_application_project_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_project public.application_projects%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_outcome is not null and p_outcome not in ('passed', 'failed') then
    raise exception using errcode = 'P0001', message = 'invalid_outcome';
  end if;

  select * into v_project from public.application_projects ap
   where ap.id = p_application_project_id and ap.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'application_project_not_found';
  end if;
  if v_project.stage <> 'closed' then
    raise exception using errcode = 'P0001', message = 'not_closed';
  end if;

  if v_project.stage_outcome is not distinct from p_outcome then
    return jsonb_build_object(
      'stage', v_project.stage, 'stage_outcome', v_project.stage_outcome,
      'stage_changed_at', v_project.stage_changed_at, 'changed', false);
  end if;

  update public.application_projects ap
     set stage_outcome = p_outcome, last_activity_at = now()
   where ap.id = p_application_project_id;

  insert into public.application_stage_events (user_id, application_project_id, event_type,
                                               from_stage, to_stage, from_outcome, to_outcome)
  values (v_uid, p_application_project_id, 'outcome_changed',
          'closed', 'closed', v_project.stage_outcome, p_outcome);

  return jsonb_build_object(
    'stage', v_project.stage, 'stage_outcome', p_outcome,
    'stage_changed_at', v_project.stage_changed_at, 'changed', true);
end;
$$;

revoke all on function public.set_application_outcome(uuid, text) from public, anon;
grant execute on function public.set_application_outcome(uuid, text) to authenticated;
