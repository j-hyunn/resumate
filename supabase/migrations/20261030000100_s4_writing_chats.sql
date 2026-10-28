-- S4 AI writing chat (AI-12, F-P1-13): writing_chats + writing_chat_messages (DM §2.5, §5) + RLS + grants.
--
-- Write paths (DM §2.5 "쓰기 주체", DM-13, NFR-AI-05):
--   * structured_draft: no role gets a direct UPDATE grant. Only apply_structured_draft_patch /
--     set_writing_chat_affiliation (security definer) change it.
--   * user session: start_writing_chat (insert), append_writing_chat_message, save / hand_off RPCs, and a
--     direct column UPDATE on status (active -> abandoned only, guard trigger) and return_target.
--   * app_ai_writer: begin / finish_assistant_message, mark_writing_chat_extracted, apply_structured_draft_patch.
--     It has SELECT only on both tables; message_count / last_activity_at / assistant rows are written by
--     those definer RPCs, so the 40-message cap can't be bypassed by a direct UPDATE
--     [구현 결정, spec-gaps 2026-10-30 S4 DB].
-- last_extracted_sequence: AI-12 "미처리 발화 ID 목록" (spec-gaps 2026-10-30 ①).

create table public.writing_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mode text not null,
  project_id uuid,
  experience_id uuid,
  education_id uuid,
  status text not null default 'active',
  structured_draft jsonb not null default '{}'::jsonb,
  message_count smallint not null default 0,
  last_activity_at timestamptz not null default now(),
  saved_at timestamptz,
  return_target jsonb,
  last_extracted_sequence smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint writing_chats_id_user_id_key unique (id, user_id),
  -- NFR-PRV-06: deleting the project deletes its chats.
  constraint writing_chats_project_fkey foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  constraint writing_chats_experience_fkey foreign key (experience_id, user_id)
    references public.experiences (id, user_id) on delete set null (experience_id),
  constraint writing_chats_education_fkey foreign key (education_id, user_id)
    references public.educations (id, user_id) on delete set null (education_id),
  constraint writing_chats_affiliation_check check (num_nonnulls(experience_id, education_id) <= 1),
  constraint writing_chats_mode_check check (mode in ('new_project', 'augment_project')),
  constraint writing_chats_status_check check (status in ('active', 'saved', 'handed_off', 'abandoned')),
  -- D-34: user + AI messages, at most 40.
  constraint writing_chats_message_count_check check (message_count between 0 and 40),
  constraint writing_chats_structured_draft_check check (jsonb_typeof(structured_draft) = 'object'),
  constraint writing_chats_return_target_check check (
    return_target is null
    or (jsonb_typeof(return_target) = 'object'
        and return_target ->> 'feature' in ('insight', 'career_description', 'cover_letter', 'job_interview'))),
  constraint writing_chats_last_extracted_sequence_check check (last_extracted_sequence >= 0),
  -- [구현 결정] augment always has its target; saved / handed_off always point at the written project.
  constraint writing_chats_augment_project_check check (mode = 'new_project' or project_id is not null),
  constraint writing_chats_finished_project_check check (status not in ('saved', 'handed_off') or project_id is not null),
  constraint writing_chats_saved_at_check check ((status = 'saved') = (saved_at is not null))
);

create index writing_chats_user_id_active_idx on public.writing_chats (user_id) where status = 'active';
create index writing_chats_user_id_project_id_idx on public.writing_chats (user_id, project_id);
create index writing_chats_user_id_experience_id_idx on public.writing_chats (user_id, experience_id)
  where experience_id is not null;
create index writing_chats_user_id_education_id_idx on public.writing_chats (user_id, education_id)
  where education_id is not null;

alter table public.writing_chats enable row level security;

-- Status rules. saved / handed_off are terminal (read-only archive, DM §3.3) for every role.
-- A direct user UPDATE (column grant) may only move active -> abandoned (그만두기); saved / handed_off
-- come from save_writing_chat / hand_off_writing_chat through a definer helper (current_user = owner).
create or replace function private.writing_chats_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if old.status in ('saved', 'handed_off', 'abandoned') then
      raise exception using errcode = 'P0001', message = 'invalid_writing_chat_transition',
        detail = old.status || ' -> ' || new.status;
    end if;
    if current_user = 'authenticated' and new.status <> 'abandoned' then
      raise exception using errcode = 'P0001', message = 'invalid_writing_chat_transition',
        detail = old.status || ' -> ' || new.status;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.writing_chats_guard() from public;

create trigger writing_chats_guard
  before update on public.writing_chats
  for each row execute function private.writing_chats_guard();

create trigger writing_chats_set_updated_at
  before update on public.writing_chats
  for each row execute function private.set_updated_at();

create policy writing_chats_select_own on public.writing_chats
  for select to authenticated using (user_id = (select auth.uid()));
create policy writing_chats_update_own on public.writing_chats
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy writing_chats_delete_own on public.writing_chats
  for delete to authenticated using (user_id = (select auth.uid()));
create policy writing_chats_select_ai_writer on public.writing_chats
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select, delete on table public.writing_chats to authenticated;
-- DM §5: the only direct user updates. structured_draft is never granted to anyone.
grant update (status, return_target) on table public.writing_chats to authenticated;
grant select on table public.writing_chats to app_ai_writer;


create table public.writing_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  writing_chat_id uuid not null,
  sequence smallint not null,
  role text not null,
  content text not null,
  status text not null default 'done',
  ai_job_id uuid, -- soft reference (DM §2.5); null for user rows and the fixed greeting
  -- AI output common meta v4 (DM §0) for assistant rows; null for the greeting (no AI call).
  provider text,
  model text,
  model_tier text,
  connection_tier text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint writing_chat_messages_writing_chat_fkey foreign key (writing_chat_id, user_id)
    references public.writing_chats (id, user_id) on delete cascade,
  constraint writing_chat_messages_writing_chat_id_sequence_key unique (writing_chat_id, sequence),
  constraint writing_chat_messages_sequence_check check (sequence >= 1),
  constraint writing_chat_messages_role_check check (role in ('user', 'assistant')),
  constraint writing_chat_messages_status_check check (status in ('streaming', 'done', 'failed')),
  constraint writing_chat_messages_content_check check (char_length(content) <= 4000),
  constraint writing_chat_messages_provider_check check (provider in ('openai', 'gemini', 'anthropic')),
  constraint writing_chat_messages_model_tier_check check (model_tier in ('light', 'default', 'heavy')),
  constraint writing_chat_messages_connection_tier_check check (connection_tier in ('free', 'paid')),
  constraint writing_chat_messages_user_row_check check (
    role = 'assistant'
    or (status = 'done' and ai_job_id is null and provider is null and model is null
        and model_tier is null and connection_tier is null)),
  constraint writing_chat_messages_meta_check check (
    num_nonnulls(provider, model, model_tier, connection_tier) in (0, 4))
);

alter table public.writing_chat_messages enable row level security;

create trigger writing_chat_messages_set_updated_at
  before update on public.writing_chat_messages
  for each row execute function private.set_updated_at();

create policy writing_chat_messages_select_own on public.writing_chat_messages
  for select to authenticated using (user_id = (select auth.uid()));
create policy writing_chat_messages_select_ai_writer on public.writing_chat_messages
  for select to app_ai_writer using (user_id = (select private.current_uid()));

-- DM §5: no direct insert / update / delete; rows come from the message RPCs, deletion only by cascade.
grant select on table public.writing_chat_messages to authenticated;
grant select on table public.writing_chat_messages to app_ai_writer;

-- DM §2.5 "structured_draft 직접 update 권한은 누구에게도 주지 않는다": service_role (Supabase default
-- privileges) keeps only SELECT / DELETE, enough for the unlinked-chat 90-day cleanup cron (S9).
revoke insert, update, truncate, references, trigger on table public.writing_chats from service_role;
revoke insert, update, truncate, references, trigger on table public.writing_chat_messages from service_role;
