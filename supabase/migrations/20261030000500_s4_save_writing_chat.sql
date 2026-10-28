-- S4: save_writing_chat / hand_off_writing_chat (DM §2.5 쓰는 값 규칙, §3.3; AI-12 저장; NFR-AI-05, DM-13).
-- Security invoker: every career write runs as the user (RLS + column grants). No AI call.
-- Shared rules (v3.2): write a field only when review in (ok, accepted) and it has a value; needs_review
-- fields are skipped (T-18). augment_project fills only empty columns of existing rows and inserts new
-- details. Affiliation comes from writing_chats.experience_id / education_id (T-19); augment never changes
-- the project's affiliation. Skills link by normalized_name. Created / filled rows get
-- source_writing_chat_id. Completion (draft / complete) is left to the S2 status triggers.
-- The final writing_chats update (status, project_id, saved_at) needs columns the user can't update
-- directly, so it goes through a definer helper.

-- Writable value of a field object, or null.
create or replace function private.wc_writable(p_field jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_field) is distinct from 'object' then null
    when coalesce(p_field ->> 'review', '') not in ('ok', 'accepted') then null
    when p_field -> 'value' is null or jsonb_typeof(p_field -> 'value') = 'null' then null
    when jsonb_typeof(p_field -> 'value') = 'string' and btrim(p_field ->> 'value') = '' then null
    else p_field -> 'value'
  end;
$$;

create or replace function private.wc_writable_text(p_field jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(private.wc_writable(p_field) #>> '{}');
$$;

create or replace function private.wc_writable_month(p_field jsonb)
returns date
language sql
immutable
set search_path = ''
as $$
  select to_date(private.wc_writable(p_field) #>> '{}' || '-01', 'YYYY-MM-DD');
$$;

create or replace function private.wc_writable_numeric(p_field jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select (private.wc_writable(p_field) #>> '{}')::numeric;
$$;

revoke all on function private.wc_writable(jsonb) from public;
revoke all on function private.wc_writable_text(jsonb) from public;
revoke all on function private.wc_writable_month(jsonb) from public;
revoke all on function private.wc_writable_numeric(jsonb) from public;
grant execute on function private.wc_writable(jsonb) to authenticated;
grant execute on function private.wc_writable_text(jsonb) to authenticated;
grant execute on function private.wc_writable_month(jsonb) to authenticated;
grant execute on function private.wc_writable_numeric(jsonb) to authenticated;

-- Final state change. Definer: the user has no UPDATE grant on project_id / saved_at, and
-- writing_chats_guard only lets the owner role set saved / handed_off.
create or replace function private.finalize_writing_chat(p_writing_chat_id uuid, p_status text, p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('saved', 'handed_off') then
    raise exception using errcode = 'P0001', message = 'invalid_writing_chat_transition';
  end if;
  update public.writing_chats w
     set status = p_status,
         project_id = p_project_id,
         saved_at = case when p_status = 'saved' then now() end,
         last_activity_at = now()
   where w.id = p_writing_chat_id and w.user_id = auth.uid() and w.status = 'active'
     and (w.mode = 'new_project' or w.project_id = p_project_id);
  if not found then
    raise exception using errcode = 'P0001', message = 'writing_chat_not_active';
  end if;
end;
$$;

revoke all on function private.finalize_writing_chat(uuid, text, uuid) from public;
grant execute on function private.finalize_writing_chat(uuid, text, uuid) to authenticated;


create or replace function private.commit_writing_chat(p_writing_chat_id uuid, p_status text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_detail_fields constant text[] := array['title', 'situation', 'task', 'action', 'result', 'learnings'];
  v_uid uuid := auth.uid();
  v_chat public.writing_chats%rowtype;
  v_draft jsonb;
  v_p jsonb;
  v_project public.projects%rowtype;
  v_project_id uuid;
  v_project_created boolean := false;
  v_project_updated boolean := false;
  v_start date;
  v_end date;
  v_item jsonb;
  v_detail public.project_details%rowtype;
  v_detail_id uuid;
  v_f text;
  v_val text;
  v_changed boolean;
  v_ach jsonb;
  v_skill jsonb;
  v_skill_name text;
  v_skill_id uuid;
  v_n integer;
  v_details_created integer := 0;
  v_details_updated integer := 0;
  v_details_missing integer := 0;
  v_ach_created integer := 0;
  v_skills_created integer := 0;
  v_skills_linked integer := 0;
  v_skipped integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select * into v_chat from public.writing_chats w
   where w.id = p_writing_chat_id and w.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'writing_chat_not_found';
  end if;
  if v_chat.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'writing_chat_not_active';
  end if;

  v_draft := private.wc_normalize_draft(v_chat.structured_draft);
  v_p := v_draft -> 'project';

  -- needs_review fields left behind (reported back for the confirmation copy).
  select count(*) into v_skipped
    from (
      select f.value from jsonb_each(v_p) f
      union all
      select f.value from jsonb_array_elements(v_draft -> 'details') d
        cross join lateral jsonb_each(coalesce(d -> 'fields', '{}'::jsonb)) f
      union all
      select f.value from jsonb_array_elements(v_draft -> 'details') d
        cross join lateral jsonb_array_elements(coalesce(d -> 'achievements', '[]'::jsonb)) a
        cross join lateral jsonb_each(a - 'achievement_key') f
    ) x
   where jsonb_typeof(x.value) = 'object' and x.value ->> 'review' = 'needs_review';

  -- ── project ──
  if v_chat.mode = 'new_project' then
    v_start := private.wc_writable_month(v_p -> 'start_month');
    v_end := private.wc_writable_month(v_p -> 'end_month');
    if v_start is not null and v_end is not null and v_end < v_start then
      raise exception using errcode = 'P0001', message = 'invalid_period';
    end if;
    insert into public.projects (experience_id, education_id, name, role, summary, start_month, end_month,
                                 team_size, source_writing_chat_id)
    values (v_chat.experience_id, v_chat.education_id,
            private.wc_writable_text(v_p -> 'name'), private.wc_writable_text(v_p -> 'role'),
            private.wc_writable_text(v_p -> 'summary'), v_start, v_end,
            private.wc_writable_numeric(v_p -> 'team_size')::smallint, p_writing_chat_id)
    returning id into v_project_id;
    v_project_created := true;
  else
    v_project_id := v_chat.project_id;
    select * into v_project from public.projects p where p.id = v_project_id and p.user_id = v_uid for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'writing_chat_not_found';
    end if;
    -- Only empty columns (blank text counts as empty, like the status triggers).
    v_project.name := coalesce(nullif(btrim(v_project.name), ''), private.wc_writable_text(v_p -> 'name'), v_project.name);
    v_project.role := coalesce(nullif(btrim(v_project.role), ''), private.wc_writable_text(v_p -> 'role'), v_project.role);
    v_project.summary := coalesce(nullif(btrim(v_project.summary), ''), private.wc_writable_text(v_p -> 'summary'),
                                  v_project.summary);
    v_project.start_month := coalesce(v_project.start_month, private.wc_writable_month(v_p -> 'start_month'));
    v_project.end_month := coalesce(v_project.end_month, private.wc_writable_month(v_p -> 'end_month'));
    v_project.team_size := coalesce(v_project.team_size, private.wc_writable_numeric(v_p -> 'team_size')::smallint);
    if v_project.start_month is not null and v_project.end_month is not null
       and v_project.end_month < v_project.start_month then
      raise exception using errcode = 'P0001', message = 'invalid_period';
    end if;
    update public.projects p
       set name = v_project.name, role = v_project.role, summary = v_project.summary,
           start_month = v_project.start_month, end_month = v_project.end_month, team_size = v_project.team_size,
           source_writing_chat_id = p_writing_chat_id
     where p.id = v_project_id
       and (p.name, p.role, p.summary, p.start_month, p.end_month, p.team_size)
           is distinct from (v_project.name, v_project.role, v_project.summary, v_project.start_month,
                             v_project.end_month, v_project.team_size);
    v_project_updated := found;
  end if;

  -- ── details + achievements ──
  for v_item in select * from jsonb_array_elements(v_draft -> 'details') loop
    v_detail_id := null;

    if v_item ->> 'existing_detail_id' is not null then
      if v_chat.mode = 'augment_project' then
        select * into v_detail from public.project_details d
         where d.id = (v_item ->> 'existing_detail_id')::uuid and d.project_id = v_project_id and d.user_id = v_uid
           for update;
      end if;
      if v_chat.mode <> 'augment_project' or not found then
        v_details_missing := v_details_missing + 1; -- deleted since the chat referenced it
        continue;
      end if;
      v_detail_id := v_detail.id;
      v_changed := false;
      foreach v_f in array c_detail_fields loop
        v_val := private.wc_writable_text(v_item -> 'fields' -> v_f);
        if v_val is not null and nullif(btrim(to_jsonb(v_detail) ->> v_f), '') is null then
          v_detail := jsonb_populate_record(v_detail, jsonb_build_object(v_f, v_val));
          v_changed := true;
        end if;
      end loop;
      if v_changed then
        update public.project_details d
           set title = v_detail.title, situation = v_detail.situation, task = v_detail.task,
               action = v_detail.action, result = v_detail.result, learnings = v_detail.learnings,
               source_writing_chat_id = p_writing_chat_id
         where d.id = v_detail_id;
        v_details_updated := v_details_updated + 1;
      end if;
    else
      -- New detail: only when something in it is writable.
      if not exists (select 1 from unnest(c_detail_fields) f
                      where private.wc_writable(v_item -> 'fields' -> f) is not null)
         and not exists (select 1 from jsonb_array_elements(coalesce(v_item -> 'achievements', '[]'::jsonb)) a
                           cross join lateral jsonb_each(a - 'achievement_key') f
                          where private.wc_writable(f.value) is not null) then
        continue;
      end if;
      insert into public.project_details (project_id, title, situation, task, action, result, learnings,
                                          source_writing_chat_id)
      values (v_project_id,
              private.wc_writable_text(v_item -> 'fields' -> 'title'),
              private.wc_writable_text(v_item -> 'fields' -> 'situation'),
              private.wc_writable_text(v_item -> 'fields' -> 'task'),
              private.wc_writable_text(v_item -> 'fields' -> 'action'),
              private.wc_writable_text(v_item -> 'fields' -> 'result'),
              private.wc_writable_text(v_item -> 'fields' -> 'learnings'),
              p_writing_chat_id)
      returning id into v_detail_id;
      v_details_created := v_details_created + 1;
    end if;

    for v_ach in select * from jsonb_array_elements(coalesce(v_item -> 'achievements', '[]'::jsonb)) loop
      if private.wc_writable(v_ach -> 'metric_name') is null and private.wc_writable(v_ach -> 'value_before') is null
         and private.wc_writable(v_ach -> 'value_after') is null and private.wc_writable(v_ach -> 'unit') is null then
        continue;
      end if;
      insert into public.achievements (project_detail_id, metric_name, value_before, value_after, unit,
                                       source_writing_chat_id)
      values (v_detail_id,
              private.wc_writable_text(v_ach -> 'metric_name'),
              private.wc_writable_numeric(v_ach -> 'value_before'),
              private.wc_writable_numeric(v_ach -> 'value_after'),
              private.wc_writable_text(v_ach -> 'unit'),
              p_writing_chat_id);
      v_ach_created := v_ach_created + 1;
    end loop;
  end loop;

  -- ── skills (normalized_name match, tag-created skills are is_manual = false) ──
  for v_skill in select * from jsonb_array_elements(v_draft -> 'skills') loop
    v_skill_name := btrim(v_skill ->> 'value');
    if v_skill_name is null or char_length(v_skill_name) not between 1 and 50 then
      continue;
    end if;
    select s.id into v_skill_id from public.skills s
     where s.user_id = v_uid and s.normalized_name = private.wc_normalized_name(v_skill_name);
    if not found then
      insert into public.skills (name, is_manual) values (v_skill_name, false) returning id into v_skill_id;
      v_skills_created := v_skills_created + 1;
    end if;
    insert into public.project_skills (project_id, skill_id) values (v_project_id, v_skill_id)
    on conflict (project_id, skill_id) do nothing;
    get diagnostics v_n = row_count;
    v_skills_linked := v_skills_linked + v_n;
  end loop;

  perform private.finalize_writing_chat(p_writing_chat_id, p_status, v_project_id);

  return jsonb_build_object(
    'writing_chat_id', p_writing_chat_id,
    'status', p_status,
    'project_id', v_project_id,
    'project', jsonb_build_object('created', v_project_created, 'updated', v_project_updated),
    'project_details', jsonb_build_object('created', v_details_created, 'updated', v_details_updated,
                                          'missing', v_details_missing),
    'achievements', jsonb_build_object('created', v_ach_created),
    'skills', jsonb_build_object('created', v_skills_created, 'linked', v_skills_linked),
    'skipped_needs_review', v_skipped);
end;
$$;

revoke all on function private.commit_writing_chat(uuid, text) from public;
grant execute on function private.commit_writing_chat(uuid, text) to authenticated;

create or replace function public.save_writing_chat(p_writing_chat_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.commit_writing_chat(p_writing_chat_id, 'saved');
$$;

create or replace function public.hand_off_writing_chat(p_writing_chat_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.commit_writing_chat(p_writing_chat_id, 'handed_off');
$$;

revoke all on function public.save_writing_chat(uuid) from public, anon;
revoke all on function public.hand_off_writing_chat(uuid) from public, anon;
grant execute on function public.save_writing_chat(uuid) to authenticated;
grant execute on function public.hand_off_writing_chat(uuid) to authenticated;
