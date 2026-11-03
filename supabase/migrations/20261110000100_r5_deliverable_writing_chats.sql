-- R5 deliverable writing chats (DM v4.5 §2.3 project_deliverables, §2.5 writing_chats, §2.5.0, §3.3, §3.7; PA-1, PA-3).
--   * project_deliverables: unique (id, project_id, user_id) — target of the chat's composite FK.
--   * writing_chats.project_deliverable_id (null = STAR chat of an affiliated project; set = deliverable chat whose
--     project_id is the deliverable's standalone parent). Composite FK cascade, no return_target on deliverable
--     chats, partial index for the S-44 history list.
--   * trigger writing_chats_check_target replaces writing_chats_require_affiliated_project (insert only).
--   * guard: target columns (project_id, project_deliverable_id) are immutable.
--   * empty drafts per target, deliverable greeting (3 kinds) with a title-keyword writing_kind guess [가정].
--   * start_writing_chat(p_project_id, p_return_target, p_form_snapshot): snapshot picks the greeting only, never
--     stored. start_deliverable_writing_chat(p_project_deliverable_id, p_form_snapshot) is new.
-- Existing STAR chats keep project_deliverable_id = null (DM §11.3: nothing to migrate).

-- ── project_deliverables ──
alter table public.project_deliverables
  add constraint project_deliverables_id_project_id_user_id_key unique (id, project_id, user_id);

-- ── writing_chats columns / constraints / index ──
alter table public.writing_chats
  add column project_deliverable_id uuid,
  add constraint writing_chats_project_deliverable_fkey foreign key (project_deliverable_id, project_id, user_id)
    references public.project_deliverables (id, project_id, user_id) on delete cascade,
  -- Deliverable chats have no gate entry (AI-13).
  add constraint writing_chats_deliverable_return_target_check
    check (project_deliverable_id is null or return_target is null);

-- S-44 chat history (newest activity first); also serves the FK cascade on deliverable delete.
create index writing_chats_project_deliverable_id_last_activity_idx
  on public.writing_chats (project_deliverable_id, last_activity_at desc)
  where project_deliverable_id is not null;

-- ── target trigger (insert) ──
drop trigger writing_chats_require_affiliated_project on public.writing_chats;
drop function private.writing_chats_require_affiliated_project();

-- DM §2.5 v4.5: STAR chat -> the project must be affiliated (CR-19). Deliverable chat -> the composite FK already
-- ties the deliverable to this project and user, and deliverables only live under standalone projects.
create or replace function private.writing_chats_check_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.project_deliverable_id is null
     and not exists (select 1 from public.projects p
                      where p.id = new.project_id and p.user_id = new.user_id
                        and num_nonnulls(p.experience_id, p.education_id) = 1) then
    raise exception using errcode = 'P0001', message = 'writing_chat_requires_affiliated_project';
  end if;
  return new;
end;
$$;

revoke all on function private.writing_chats_check_target() from public;

create trigger writing_chats_check_target
  before insert on public.writing_chats
  for each row execute function private.writing_chats_check_target();

-- ── guard: only active -> closed; target columns fixed ──
create or replace function private.writing_chats_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and not (old.status = 'active' and new.status = 'closed') then
    raise exception using errcode = 'P0001', message = 'invalid_writing_chat_transition',
      detail = old.status || ' -> ' || new.status;
  end if;
  if new.project_id is distinct from old.project_id then
    raise exception using errcode = 'P0001', message = 'invalid_writing_chat_transition',
      detail = 'project_id is fixed';
  end if;
  if new.project_deliverable_id is distinct from old.project_deliverable_id then
    raise exception using errcode = 'P0001', message = 'invalid_writing_chat_transition',
      detail = 'project_deliverable_id is fixed';
  end if;
  return new;
end;
$$;

revoke all on function private.writing_chats_guard() from public;

-- ── empty deliverable draft (DM §2.5.0) ──
create or replace function private.writing_chat_empty_deliverable_draft(p_writing_kind text default null)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'target', 'project_deliverable',
    'writing_kind', p_writing_kind,
    'facts', '[]'::jsonb,
    'deliverable', '{}'::jsonb,
    'clarifications', '[]'::jsonb,
    'sensitive_flags_count', 0,
    'draft_count', 0);
$$;

revoke all on function private.writing_chat_empty_deliverable_draft(text) from public;
grant execute on function private.writing_chat_empty_deliverable_draft(text) to authenticated, app_ai_writer;

-- AI-13 [가정]: writing_kind guessed from title keywords (first match wins), null when nothing matches.
create or replace function private.deliverable_writing_kind_guess(p_title text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_title is null then null
    when p_title ~* '(회고|retrospective|retro\M)' then 'retrospective'
    when p_title ~* '(설계|아키텍처|architecture|design doc)' then 'design_doc'
    when p_title ~* '(기획|planning)' then 'planning_summary'
    when p_title ~* '(발표|presentation|keynote)' then 'presentation'
  end;
$$;

revoke all on function private.deliverable_writing_kind_guess(text) from public;

-- '로' after a vowel or ㄹ final, '으로' otherwise (Hangul syllables); '로' for anything else.
create or replace function private.ko_particle_ro(p_word text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_word is null or p_word = '' then '로'
    when ascii(right(p_word, 1)) between 44032 and 55203
         and (ascii(right(p_word, 1)) - 44032) % 28 not in (0, 8) then '으로'
    else '로'
  end;
$$;

revoke all on function private.ko_particle_ro(text) from public;

-- Fixed deliverable greeting (AI-13 시작 인사 [가정]; final copy is UX's): empty body + unknown kind / empty body +
-- kind guessed from the title / body present, + the sensitive-info line (+ free tier notice).
create or replace function private.writing_chat_deliverable_greeting(p_title text, p_body_present boolean,
                                                                     p_writing_kind text, p_free_tier boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_title text := left(btrim(coalesce(p_title, '')), 100);
  v_label text;
  v_question text;
  v_body text;
begin
  if p_body_present then
    v_body := '지금 본문을 바탕으로 더 채워 볼게요. 보강하고 싶은 부분을 알려 주시거나, 아래 버튼으로 시작하세요.';
  elsif p_writing_kind is not null and p_writing_kind <> 'other' then
    v_label := case p_writing_kind
                 when 'planning_summary' then '기획서 요약'
                 when 'design_doc' then '설계 문서'
                 when 'retrospective' then '회고'
                 when 'presentation' then '발표'
               end;
    v_question := case p_writing_kind
                    when 'planning_summary' then '이 기획은 어떤 배경에서, 어떤 문제를 해결하려고 시작됐나요?'
                    when 'design_doc' then '이 설계로 해결하려던 문제나 요구사항은 무엇이었나요?'
                    when 'retrospective' then '회고하려는 일은 무엇이었나요? 기간과 범위를 알려 주세요.'
                    when 'presentation' then '어떤 자리에서, 누구를 대상으로 한 발표였나요?'
                  end;
    v_body := '''' || v_title || '''을 ' || v_label || private.ko_particle_ro(v_label) || ' 정리해 볼게요. ' || v_question;
  else
    v_body := '''' || v_title || '''을 함께 써 볼게요. 몇 가지 여쭤보고, 정리한 초안은 본문에 넣기 전에 먼저 보여 드릴게요. '
              || '어떤 글인가요? 기획서 요약, 설계 문서, 회고, 발표 내용처럼 알려 주세요.';
  end if;

  return v_body
    || E'\n\n'
    || '회사 기밀, 민감정보, 다른 사람의 개인정보는 쓰지 말아 주세요.'
    || case when p_free_tier
         then ' 지금 연결된 AI는 무료 등급이라 입력한 내용이 공급자의 서비스 개선에 쓰일 수 있어요. 민감한 내용은 특히 조심해 주세요.'
         else '' end;
end;
$$;

revoke all on function private.writing_chat_deliverable_greeting(text, boolean, text, boolean) from public;

-- Active key on the free tier? (greeting notice only; starting a chat needs no key — PRD 3.3).
create or replace function private.writing_chat_free_tier(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
      join public.ai_provider_keys k on k.user_id = p.id and k.provider = p.active_ai_provider
     where p.id = p_uid and k.connection_tier = 'free');
$$;

revoke all on function private.writing_chat_free_tier(uuid) from public;

-- ── start_writing_chat v4.5 (+ p_form_snapshot) ──
drop function public.start_writing_chat(uuid, jsonb);

-- DM §2.5 v4.5: p_form_snapshot (S-10 form, unsaved values) picks the greeting branch only; it is never stored.
-- Snapshot shape {name, start_month, end_month, is_current, project_type, experience_type, competencies,
-- star: {situation, task, action, result, learnings}}; only name and star are read here. Malformed -> invalid_form_snapshot.
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
       or coalesce(p_return_target ->> 'feature', '') not in ('insight', 'career_description', 'cover_letter', 'job_interview')
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

revoke all on function public.start_writing_chat(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.start_writing_chat(uuid, jsonb, jsonb) to authenticated;

-- ── start_deliverable_writing_chat (DM §2.5 v4.5, AI-13) ──
-- Snapshot shape {title, body} (S-44 form, unsaved values): picks the greeting only, never stored.
create or replace function public.start_deliverable_writing_chat(p_project_deliverable_id uuid,
                                                                 p_form_snapshot jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_d public.project_deliverables%rowtype;
  v_snap jsonb;
  v_title text;
  v_body text;
  v_kind text;
  v_chat_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select * into v_d from public.project_deliverables d where d.id = p_project_deliverable_id and d.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'project_deliverable_not_found';
  end if;

  v_title := v_d.title;
  v_body := v_d.body;
  v_snap := nullif(p_form_snapshot, 'null'::jsonb);
  if v_snap is not null then
    if jsonb_typeof(v_snap) <> 'object'
       or coalesce(jsonb_typeof(v_snap -> 'title'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_snap -> 'body'), 'null') not in ('string', 'null')
       or char_length(v_snap ->> 'title') > 100
       or char_length(v_snap ->> 'body') > 20000 then
      raise exception using errcode = 'P0001', message = 'invalid_form_snapshot';
    end if;
    if nullif(btrim(v_snap ->> 'title'), '') is not null then
      v_title := v_snap ->> 'title';
    end if;
    if v_snap ? 'body' then
      v_body := coalesce(v_snap ->> 'body', '');
    end if;
  end if;

  v_kind := private.deliverable_writing_kind_guess(v_title);

  insert into public.writing_chats (user_id, project_id, project_deliverable_id, structured_draft, message_count,
                                    return_target)
  values (v_uid, v_d.project_id, v_d.id, private.writing_chat_empty_deliverable_draft(v_kind), 0, null)
  returning id into v_chat_id;

  insert into public.writing_chat_messages (user_id, writing_chat_id, sequence, role, content, status)
  values (v_uid, v_chat_id, 1, 'assistant',
          private.writing_chat_deliverable_greeting(v_title, nullif(btrim(v_body), '') is not null, v_kind,
                                                    private.writing_chat_free_tier(v_uid)),
          'done');

  return v_chat_id;
end;
$$;

revoke all on function public.start_deliverable_writing_chat(uuid, jsonb) from public, anon;
grant execute on function public.start_deliverable_writing_chat(uuid, jsonb) to authenticated;
