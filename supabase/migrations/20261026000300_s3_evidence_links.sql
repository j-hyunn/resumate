-- S3 AI infrastructure: evidence_links (DM §2.8, A.14, DM-6/7, AI C-3) + source deletion triggers.
-- application_project_id: plain uuid until S5 adds the composite FK (cascade) to application_projects.

create table public.evidence_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default private.current_uid() references auth.users (id) on delete cascade,
  application_project_id uuid not null,
  owner_type text not null,
  owner_id uuid not null,            -- soft reference (DM-7)
  item_key text not null,
  sort_order integer not null default 0,
  source_type text not null,
  source_id uuid not null,           -- soft reference (DM-7)
  source_locator jsonb,
  source_field text,
  quote text,                        -- nulled when the source is deleted (C-3, D-AI-04 (b))
  quote_adjusted boolean not null default false,
  source_snapshot_at timestamptz,
  source_deleted_at timestamptz,
  source_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evidence_links_owner_type_check check (owner_type in (
    'insight', 'draft_section', 'interview_question', 'answer_evaluation', 'session_feedback', 'chat_message')),
  -- DM §2.8: writing_chat_message is never stored here (DM-15).
  constraint evidence_links_source_type_check check (source_type in (
    'profile', 'experience', 'education', 'project', 'project_detail', 'achievement', 'skill',
    'jd_requirement', 'jd_sentence', 'interview_answer', 'user_note')),
  -- AI C-3 field table (V-2 enforced by the DB as well). Types without fields store null.
  constraint evidence_links_source_field_check check (coalesce(
    case source_type
      when 'profile' then source_field in ('desired_job_title', 'total_years_of_experience', 'interested_industries')
      when 'experience' then source_field in ('job_rank', 'job_position', 'department', 'summary', 'period')
      when 'education' then source_field in ('institution_name', 'program_name', 'education_type',
                                             'enrollment_status', 'period', 'description')
      when 'project' then source_field in ('name', 'role', 'team_size', 'summary', 'period')
      when 'project_detail' then source_field in ('title', 'situation', 'task', 'action', 'result', 'learnings')
      when 'achievement' then source_field in ('metric', 'description')
      when 'skill' then source_field = 'name'
      else source_field is null
    end, false)),
  constraint evidence_links_source_locator_check
    check (source_locator is null or jsonb_typeof(source_locator) = 'object'),
  constraint evidence_links_deleted_quote_check check (source_deleted_at is null or quote is null)
);

create index evidence_links_owner_idx on public.evidence_links (owner_type, owner_id);
create index evidence_links_source_idx on public.evidence_links (user_id, source_type, source_id);
create index evidence_links_application_project_id_idx on public.evidence_links (application_project_id);

alter table public.evidence_links enable row level security;

create trigger evidence_links_set_updated_at
  before update on public.evidence_links
  for each row execute function private.set_updated_at();

-- Insert guard: if a career source was deleted between context-pack build and save (or never
-- belonged to this user), store the link as already deleted so no quote of it survives.
-- JD / interview answer / note sources are checked by their own slices (S5+).
create or replace function private.evidence_links_check_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
begin
  v_exists := case new.source_type
    when 'profile' then exists (select 1 from public.profiles where id = new.source_id and id = new.user_id)
    when 'experience' then exists (select 1 from public.experiences where id = new.source_id and user_id = new.user_id)
    when 'education' then exists (select 1 from public.educations where id = new.source_id and user_id = new.user_id)
    when 'project' then exists (select 1 from public.projects where id = new.source_id and user_id = new.user_id)
    when 'project_detail' then exists (select 1 from public.project_details where id = new.source_id and user_id = new.user_id)
    when 'achievement' then exists (select 1 from public.achievements where id = new.source_id and user_id = new.user_id)
    when 'skill' then exists (select 1 from public.skills where id = new.source_id and user_id = new.user_id)
    else true
  end;

  if not v_exists then
    new.quote := null;
    new.source_deleted_at := coalesce(new.source_deleted_at, now());
  end if;
  return new;
end;
$$;

revoke all on function private.evidence_links_check_source() from public;

create trigger evidence_links_check_source
  before insert on public.evidence_links
  for each row execute function private.evidence_links_check_source();

-- Source deletion (DM §2.8, C-3): quote := null, source_deleted_at := now() on every link to the row.
-- tg_argv[0] = evidence source_type. Security definer: neither users nor app_ai_writer can update links.
create or replace function private.evidence_mark_source_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.evidence_links
     set quote = null,
         source_deleted_at = now()
   where user_id = old.user_id
     and source_type = tg_argv[0]
     and source_id = old.id
     and source_deleted_at is null;
  return null;
end;
$$;

revoke all on function private.evidence_mark_source_deleted() from public;

-- Career evidence sources. project_skills is not a source type (skill links go through skills).
create trigger experiences_evidence_source_deleted
  after delete on public.experiences
  for each row execute function private.evidence_mark_source_deleted('experience');
create trigger educations_evidence_source_deleted
  after delete on public.educations
  for each row execute function private.evidence_mark_source_deleted('education');
create trigger projects_evidence_source_deleted
  after delete on public.projects
  for each row execute function private.evidence_mark_source_deleted('project');
create trigger project_details_evidence_source_deleted
  after delete on public.project_details
  for each row execute function private.evidence_mark_source_deleted('project_detail');
create trigger achievements_evidence_source_deleted
  after delete on public.achievements
  for each row execute function private.evidence_mark_source_deleted('achievement');
create trigger skills_evidence_source_deleted
  after delete on public.skills
  for each row execute function private.evidence_mark_source_deleted('skill');

-- RLS (DM §5): user reads own links; app_ai_writer inserts/reads; nobody updates directly.
create policy evidence_links_select_own on public.evidence_links
  for select to authenticated using (user_id = (select auth.uid()));
create policy evidence_links_select_ai_writer on public.evidence_links
  for select to app_ai_writer using (user_id = (select private.current_uid()));
create policy evidence_links_insert_ai_writer on public.evidence_links
  for insert to app_ai_writer with check (user_id = (select private.current_uid()));

grant select on table public.evidence_links to authenticated, app_ai_writer;
grant insert (id, user_id, application_project_id, owner_type, owner_id, item_key, sort_order, source_type,
              source_id, source_locator, source_field, quote, quote_adjusted, source_snapshot_at, source_label)
  on table public.evidence_links to app_ai_writer;

-- QA-S3-06: profile evidence snapshot = profiles.updated_at (not career_data_updated_at).
grant select (updated_at) on table public.profiles to app_ai_writer;
