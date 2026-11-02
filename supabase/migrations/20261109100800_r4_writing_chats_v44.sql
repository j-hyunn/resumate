-- R4 writing_chats v4.4 (DM §2.5, §3.3, §3.4, §5; CR-5, CR-6, CR-19, CR-20).
--   * every chat belongs to one affiliated project (project_id not null); several chats per project.
--   * status active / closed (closed = message cap reached; view / review / apply only). No abandon / resume.
--   * new: title (first user message), last_applied_at. Gone: mode, experience_id, education_id, saved_at.
--   * user session may update return_target only (status grant revoked).
--   * retired RPCs: save_writing_chat, hand_off_writing_chat, set_writing_chat_affiliation,
--     purge_unlinked_writing_chats (+ private commit / finalize helpers, detail / achievement helpers).
-- The table is empty at this point (20261109100100).

-- ── retired RPCs / helpers ──
drop function if exists public.save_writing_chat(uuid);
drop function if exists public.hand_off_writing_chat(uuid);
drop function if exists public.set_writing_chat_affiliation(uuid, uuid, uuid, boolean);
drop function if exists public.purge_unlinked_writing_chats(timestamptz, integer);
drop function if exists private.commit_writing_chat(uuid, text);
drop function if exists private.finalize_writing_chat(uuid, text, uuid);
drop function if exists private.wc_detail_index(jsonb, text, uuid);
drop function if exists private.wc_writable_numeric(jsonb);
drop function if exists private.wc_writable_month(jsonb);
drop function if exists private.wc_writable_text(jsonb);
drop function if exists private.wc_writable(jsonb);
drop function if exists private.wc_normalized_name(text);
drop function if exists public.start_writing_chat(text, uuid, jsonb);
drop function if exists private.writing_chat_greeting(text, boolean);

-- ── columns / constraints / indexes ──
alter table public.writing_chats drop constraint writing_chats_augment_project_check;
alter table public.writing_chats drop constraint writing_chats_finished_project_check;
alter table public.writing_chats drop constraint writing_chats_saved_at_check;
alter table public.writing_chats drop constraint writing_chats_mode_check;
alter table public.writing_chats drop constraint writing_chats_affiliation_check;
alter table public.writing_chats drop constraint writing_chats_status_check;
alter table public.writing_chats drop constraint writing_chats_experience_fkey;
alter table public.writing_chats drop constraint writing_chats_education_fkey;
drop index if exists public.writing_chats_user_id_project_id_idx;
drop index if exists public.writing_chats_unlinked_last_activity_idx;

alter table public.writing_chats
  drop column mode,
  drop column experience_id,
  drop column education_id,
  drop column saved_at,
  alter column project_id set not null,
  add column title text,
  add column last_applied_at timestamptz,
  add constraint writing_chats_status_check check (status in ('active', 'closed')),
  add constraint writing_chats_title_check check (char_length(title) <= 100);

-- Panel chat history (S-10): newest activity first.
create index writing_chats_project_id_last_activity_idx on public.writing_chats (project_id, last_activity_at desc);

-- ── triggers ──
-- Only active -> closed (definer RPCs). No way back (DM §2.5 v4.4).
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
  return new;
end;
$$;

revoke all on function private.writing_chats_guard() from public;

-- CR-19 (D-AI-15 (a)): chats only for affiliated projects (standalone projects have no panel).
create or replace function private.writing_chats_require_affiliated_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.projects p
                  where p.id = new.project_id and p.user_id = new.user_id
                    and num_nonnulls(p.experience_id, p.education_id) = 1) then
    raise exception using errcode = 'P0001', message = 'writing_chat_requires_affiliated_project';
  end if;
  return new;
end;
$$;

revoke all on function private.writing_chats_require_affiliated_project() from public;

create trigger writing_chats_require_affiliated_project
  before insert on public.writing_chats
  for each row execute function private.writing_chats_require_affiliated_project();

-- DM §4.2 v4.4: a running turn of a deleted chat (direct delete, project / experience cascade) is asked to cancel.
create or replace function private.writing_chats_cancel_jobs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_jobs j
     set cancel_requested_at = now()
   where j.user_id = old.user_id
     and j.job_type = 'writing_chat_turn' and j.target_type = 'writing_chat' and j.target_id = old.id
     and j.status in ('queued', 'running')
     and j.cancel_requested_at is null;
  return null;
end;
$$;

revoke all on function private.writing_chats_cancel_jobs() from public;

create trigger writing_chats_cancel_jobs
  after delete on public.writing_chats
  for each row execute function private.writing_chats_cancel_jobs();

-- ── grants: the user session updates return_target only (DM §5 v4.4) ──
revoke update on table public.writing_chats from authenticated;
grant update (return_target) on table public.writing_chats to authenticated;

-- ── structured_draft v3 (DM §2.5) ──
create or replace function private.writing_chat_empty_draft()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 3,
    'project', '{}'::jsonb,
    'star', '{}'::jsonb,
    'classification', '{}'::jsonb,
    'clarifications', '[]'::jsonb,
    'sensitive_flags_count', 0);
$$;

revoke all on function private.writing_chat_empty_draft() from public;
grant execute on function private.writing_chat_empty_draft() to authenticated, app_ai_writer;

-- ── fixed greeting (AI-12 시작 인사 [가정]; final copy is UX's): STAR state (empty / partial / full)
-- + a gate line when opened from a feature gate + the sensitive-info notice (+ free tier notice). ──
create or replace function private.writing_chat_greeting(p_project public.projects, p_gate_feature text,
                                                         p_free_tier boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_slots constant text[] := array['situation', 'task', 'action', 'result', 'learnings'];
  c_labels constant text[] := array['상황', '역할', '행동', '결과/성과', '배운 점'];
  c_questions constant text[] := array[
    '그때 어떤 상황이었나요? 팀이나 서비스 배경을 알려 주세요.',
    '그 상황에서 맡은 역할이나 해결해야 했던 목표는 무엇이었나요?',
    '그 안에서 본인이 직접 한 일은 무엇인가요?',
    '결과는 어땠나요? 수치로 알고 있는 게 있다면 함께 말해 주세요.',
    '이 경험에서 배운 점이나 다음에 다르게 할 점이 있나요?'];
  v_values text[] := array[p_project.situation, p_project.task, p_project.action, p_project.result,
                           p_project.learnings];
  v_name text := left(btrim(p_project.name), 100);
  v_filled int := 0;
  v_first int;
  v_body text;
  v_gate text := '';
begin
  for i in 1 .. 5 loop
    if nullif(btrim(v_values[i]), '') is not null then
      v_filled := v_filled + 1;
    elsif v_first is null then
      v_first := i;
    end if;
  end loop;

  if v_filled = 0 then
    v_body := '''' || v_name || '''을 함께 정리해 볼게요. 하나씩 여쭤보고, 정리한 내용은 왼쪽에 반영하기 전에 '
              || '먼저 보여 드릴게요. 이 프로젝트는 어떤 상황에서 시작됐나요?';
  elsif v_filled < 5 then
    v_body := '''' || v_name || '''에서 비어 있는 ' || c_labels[v_first] || '부터 여쭤볼게요. '
              || c_questions[v_first];
  else
    v_body := '모든 항목이 채워져 있어요. 보강하고 싶은 항목을 골라 주세요.';
  end if;

  if p_gate_feature is not null then
    v_gate := case p_gate_feature
                when 'insight' then '인사이트를'
                when 'career_description' then '경력기술서를'
                when 'cover_letter' then '자기소개서를'
                when 'job_interview' then '직무 면접을'
                else '이 기능을'
              end || ' 쓰려면 이 프로젝트의 상황과 행동이 필요해요.' || E'\n\n';
  end if;

  return v_gate || v_body
    || E'\n\n'
    || '건강·종교·노조 활동 같은 민감정보, 동료·고객의 개인정보, 회사 기밀은 말하지 말아 주세요.'
    || case when p_free_tier
         then ' 지금 연결된 AI는 무료 등급이라 입력한 내용이 공급자의 서비스 개선에 쓰일 수 있어요. 민감한 내용은 특히 조심해 주세요.'
         else '' end;
end;
$$;

revoke all on function private.writing_chat_greeting(public.projects, text, boolean) from public;

-- start_writing_chat(p_project_id, p_return_target) (DM §3.3 v4.4): security definer + ownership check.
-- Affiliated project only; draft projects are fine. No key needed to start or read a chat (PRD 3.3).
create or replace function public.start_writing_chat(p_project_id uuid, p_return_target jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_project public.projects%rowtype;
  v_return_target jsonb;
  v_free boolean;
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

  select exists (
    select 1 from public.profiles p
      join public.ai_provider_keys k on k.user_id = p.id and k.provider = p.active_ai_provider
     where p.id = v_uid and k.connection_tier = 'free')
    into v_free;

  insert into public.writing_chats (user_id, project_id, structured_draft, message_count, return_target)
  values (v_uid, p_project_id, private.writing_chat_empty_draft(), 0, v_return_target)
  returning id into v_chat_id;

  insert into public.writing_chat_messages (user_id, writing_chat_id, sequence, role, content, status)
  values (v_uid, v_chat_id, 1, 'assistant',
          private.writing_chat_greeting(v_project, v_return_target ->> 'feature', v_free), 'done');

  return v_chat_id;
end;
$$;

revoke all on function public.start_writing_chat(uuid, jsonb) from public, anon;
grant execute on function public.start_writing_chat(uuid, jsonb) to authenticated;
