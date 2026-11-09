-- R15 / D14 (DM 11.10 #8, §2.5 return_target — CF-1, AI 요청 8)
-- Starting from the R14 definition (job_interview already removed). career_description leaves the accepted return
-- target list: the feature is gone (CF-1), so a new chat may only return to 인사이트 or 자소서.
-- The table CHECK (writing_chats_return_target_check, R14's 3 values) stays as is — existing rows keep their value.
-- private.writing_chat_greeting's career_description branch is left in place; no new chat can carry it `[가정]`.
create or replace function public.start_writing_chat(p_project_id uuid, p_return_target jsonb default null,
  p_form_snapshot jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_star constant text[] := array['situation', 'task', 'action', 'result', 'learnings'];
  v_uid uuid := auth.uid();
  v_project public.projects%rowtype;
  v_return_target jsonb;
  v_snap jsonb;
  v_star jsonb;
  v_field text;
  v_chat_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select * into v_project from public.projects p where p.id = p_project_id and p.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'project_not_found';
  end if;
  if num_nonnulls(v_project.experience_id, v_project.education_id) = 0 then
    raise exception using errcode = 'P0001', message = 'writing_chat_requires_affiliated_project';
  end if;

  if p_return_target is not null and jsonb_typeof(p_return_target) <> 'null' then
    if jsonb_typeof(p_return_target) <> 'object'
       -- R15 (CF-1): insight / cover_letter only.
       or coalesce(p_return_target ->> 'feature', '') not in ('insight', 'cover_letter')
       or jsonb_typeof(p_return_target -> 'application_project_id') is distinct from 'string'
       or (p_return_target ->> 'application_project_id')
            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(jsonb_typeof(p_return_target -> 'params'), 'object') not in ('object', 'null') then
      raise exception using errcode = 'P0001', message = 'invalid_return_target';
    end if;
    v_return_target := jsonb_build_object(
      'application_project_id', lower(p_return_target ->> 'application_project_id'),
      'feature', p_return_target ->> 'feature',
      'params', coalesce(nullif(p_return_target -> 'params', 'null'::jsonb), '{}'::jsonb),
      'created_at', to_jsonb(now()));
  end if;

  -- Greeting input: snapshot values win over saved ones (리더 정렬 2). Local copy only.
  v_snap := nullif(p_form_snapshot, 'null'::jsonb);
  if v_snap is not null then
    v_star := nullif(v_snap -> 'star', 'null'::jsonb);
    if jsonb_typeof(v_snap) <> 'object'
       or coalesce(jsonb_typeof(v_snap -> 'name'), 'null') not in ('string', 'null')
       or char_length(v_snap ->> 'name') > 100
       or (v_star is not null and jsonb_typeof(v_star) <> 'object') then
      raise exception using errcode = 'P0001', message = 'invalid_form_snapshot';
    end if;
    if nullif(btrim(v_snap ->> 'name'), '') is not null then
      v_project.name := v_snap ->> 'name';
    end if;
    if v_star is not null then
      foreach v_field in array c_star loop
        if v_star ? v_field then
          if coalesce(jsonb_typeof(v_star -> v_field), 'null') not in ('string', 'null')
             or char_length(v_star ->> v_field) > 2000 then
            raise exception using errcode = 'P0001', message = 'invalid_form_snapshot';
          end if;
          case v_field
            when 'situation' then v_project.situation := v_star ->> v_field;
            when 'task' then v_project.task := v_star ->> v_field;
            when 'action' then v_project.action := v_star ->> v_field;
            when 'result' then v_project.result := v_star ->> v_field;
            when 'learnings' then v_project.learnings := v_star ->> v_field;
          end case;
        end if;
      end loop;
    end if;
  end if;

  insert into public.writing_chats (user_id, project_id, structured_draft, message_count, return_target)
  values (v_uid, p_project_id, private.writing_chat_empty_draft(), 0, v_return_target)
  returning id into v_chat_id;

  insert into public.writing_chat_messages (user_id, writing_chat_id, sequence, role, content, status)
  values (v_uid, v_chat_id, 1, 'assistant',
          private.writing_chat_greeting(v_project, v_return_target ->> 'feature', private.writing_chat_free_tier(v_uid)),
          'done');

  return v_chat_id;
end;
$$;
