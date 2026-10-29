-- S7 documents (F-DOC-01~04, 08, 09; AI-03 / AI-04 / AI-11): drafts, draft_sections, draft_section_sources
-- (DM A.9–A.11, §0 AI meta, §2.7, §5) + RLS + grants.
--
-- Write paths (DM §5, S5 / S6 precedent):
--   * drafts: insert only through create_cover_letter_draft (user) / begin_career_description (app_ai_writer).
--     User session updates title / edited_at / first_copied_at (column grant) and deletes its own drafts
--     (individual delete, S7 [가정 3]). AI columns are written only by definer RPCs.
--   * draft_sections: insert / delete through RPCs (cover letter question add / delete, career description begin)
--     and cascades. User session updates question_text / char_limit / count_basis / user_note / edited_content
--     (column grant). ai_content is never user-writable (AI original, AI-03 / AI-04 storage).
--   * draft_section_sources: RPC only (set_section_sources = user choice, complete_cover_letter_section = AI choice).
--   * Evidence of a section lives in evidence_links (owner_type 'draft_section', owner_id = section id,
--     item_key = block_id or sources.{n}); deleting a section deletes its links (owner_id is soft, DM-7).

-- ── shape helpers (immutable, used by CHECK constraints and RPCs) ──────────

create or replace function private.is_uuid_text(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'string'
     and (p_value #>> '{}') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
$$;

revoke all on function private.is_uuid_text(jsonb) from public;
grant execute on function private.is_uuid_text(jsonb) to authenticated, app_ai_writer;

-- Array of uuid strings (no nulls), at most p_max elements. null / missing -> p_allow_null.
create or replace function private.is_uuid_array(p_value jsonb, p_max integer, p_allow_null boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then p_allow_null
    when jsonb_typeof(p_value) <> 'array' then false
    when jsonb_array_length(p_value) > p_max then false
    else not exists (select 1 from jsonb_array_elements(p_value) e where not private.is_uuid_text(e))
  end;
$$;

revoke all on function private.is_uuid_array(jsonb, integer, boolean) from public;
grant execute on function private.is_uuid_array(jsonb, integer, boolean) to authenticated, app_ai_writer;

-- drafts.options (A.9): only the 7 known keys; id lists are uuid arrays; selection_origin in the A.9 list;
-- ranking is the copied AI-11 result (not shape-checked); tone is a short string [가정 ≤ 50].
create or replace function private.draft_options_valid(p_options jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_options is null or jsonb_typeof(p_options) <> 'object' then
    return false;
  end if;
  if exists (select 1 from jsonb_object_keys(p_options) k
              where k not in ('included_experience_ids', 'included_education_ids', 'included_project_ids',
                              'project_order', 'selection_origin', 'ranking', 'tone')) then
    return false;
  end if;
  return private.is_uuid_array(p_options -> 'included_experience_ids', 100, true)
     and private.is_uuid_array(p_options -> 'included_education_ids', 100, true)
     and private.is_uuid_array(p_options -> 'included_project_ids', 200, true)
     and private.is_uuid_array(p_options -> 'project_order', 200, true)
     and (coalesce(jsonb_typeof(p_options -> 'selection_origin'), 'null') = 'null'
          or p_options ->> 'selection_origin' in ('insight', 'ai_ranking', 'user'))
     and coalesce(jsonb_typeof(p_options -> 'ranking'), 'null') in ('array', 'object', 'null')
     and (coalesce(jsonb_typeof(p_options -> 'tone'), 'null') = 'null'
          or (jsonb_typeof(p_options -> 'tone') = 'string' and char_length(p_options ->> 'tone') <= 50));
end;
$$;

revoke all on function private.draft_options_valid(jsonb) from public;
grant execute on function private.draft_options_valid(jsonb) to authenticated, app_ai_writer;

-- Block array (A.10 ai_content / edited_content): array of <= 500 objects with block_id (1..64, [A-Za-z0-9_.:-],
-- unique in the array), block_kind (A.10 list), text (string <= 5000); optional keys type-checked only.
create or replace function private.draft_blocks_valid(p_blocks jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_block jsonb;
begin
  if p_blocks is null then
    return true;
  end if;
  if jsonb_typeof(p_blocks) <> 'array' or jsonb_array_length(p_blocks) > 500 then
    return false;
  end if;
  for v_block in select e from jsonb_array_elements(p_blocks) e loop
    if jsonb_typeof(v_block) <> 'object'
       or jsonb_typeof(v_block -> 'block_id') is distinct from 'string'
       or (v_block ->> 'block_id') !~ '^[A-Za-z0-9_.:-]{1,64}$'
       or coalesce(v_block ->> 'block_kind', '') not in ('header', 'summary', 'role_line', 'bullet', 'paragraph')
       or jsonb_typeof(v_block -> 'text') is distinct from 'string'
       or char_length(v_block ->> 'text') > 5000
       or not (coalesce(jsonb_typeof(v_block -> 'project_id'), 'null') = 'null'
               or private.is_uuid_text(v_block -> 'project_id'))
       or not private.is_uuid_array(v_block -> 'requirement_ids', 200, true)
       or coalesce(jsonb_typeof(v_block -> 'placeholders'), 'null') not in ('array', 'null')
       or coalesce(jsonb_typeof(v_block -> 'flags'), 'null') not in ('array', 'null')
       or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_block -> 'flags') = 'array'
                                                          then v_block -> 'flags' else '[]'::jsonb end) f
                   where jsonb_typeof(f) <> 'string' or char_length(f #>> '{}') > 64)
       or coalesce(jsonb_typeof(v_block -> 'generated_by'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_block -> 'user_modified'), 'null') not in ('boolean', 'null')
       or coalesce(jsonb_typeof(v_block -> 'header'), 'null') not in ('object', 'null') then
      return false;
    end if;
  end loop;
  -- block_id unique within the array.
  if (select count(distinct e ->> 'block_id') from jsonb_array_elements(p_blocks) e)
     <> jsonb_array_length(p_blocks) then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function private.draft_blocks_valid(jsonb) from public;
grant execute on function private.draft_blocks_valid(jsonb) to authenticated, app_ai_writer;


-- ── drafts (A.9 + AI meta) ─────────────────────────────────────────────────

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default private.current_uid() references auth.users (id) on delete cascade,
  application_project_id uuid not null,
  insight_id uuid,
  draft_type text not null,
  title text not null,
  status text not null,
  options jsonb not null default '{}'::jsonb,
  edited_at timestamptz,
  first_copied_at timestamptz,
  regenerated_from_id uuid,
  -- AI output common meta (DM §0). Cover letter drafts carry the meta of the last generated question (badge).
  ai_job_id uuid,
  -- Internal: the ai_jobs.run_generation that (re)opened this row (S6 QA-S6-01 manual retry). Not AI meta.
  run_generation integer,
  schema_version integer,
  prompt_version text,
  provider text,
  model text,
  model_tier text,
  connection_tier text,
  input_hash text,
  career_snapshot_hash text,
  validation_report jsonb,
  usage jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drafts_id_user_id_key unique (id, user_id),
  -- F-AP-05: deleted with the application project.
  constraint drafts_application_project_fkey foreign key (application_project_id, user_id)
    references public.application_projects (id, user_id) on delete cascade,
  constraint drafts_insight_fkey foreign key (insight_id, user_id)
    references public.insights (id, user_id) on delete set null (insight_id),
  constraint drafts_regenerated_from_fkey foreign key (regenerated_from_id, user_id)
    references public.drafts (id, user_id) on delete set null (regenerated_from_id),
  constraint drafts_ai_job_fkey foreign key (ai_job_id, user_id)
    references public.ai_jobs (id, user_id) on delete set null (ai_job_id),
  constraint drafts_draft_type_check check (draft_type in ('career_description', 'cover_letter')),
  constraint drafts_status_check check (status in ('composing', 'generating', 'ready', 'partially_failed', 'failed')),
  -- A career description is one generation (generating -> ready | failed); a cover letter aggregates its questions.
  constraint drafts_type_status_check check (
    (draft_type = 'career_description' and status in ('generating', 'ready', 'failed'))
    or (draft_type = 'cover_letter' and status in ('composing', 'generating', 'ready', 'partially_failed', 'failed'))),
  constraint drafts_title_check check (char_length(title) between 1 and 100 and btrim(title) <> ''),
  constraint drafts_options_check check (private.draft_options_valid(options)),
  constraint drafts_regenerated_from_self_check check (regenerated_from_id is distinct from id),
  constraint drafts_run_generation_check check (run_generation is null or run_generation >= 0),
  constraint drafts_schema_version_check check (schema_version is null or schema_version >= 1),
  constraint drafts_prompt_version_check check (
    prompt_version is null or char_length(prompt_version) between 1 and 200),
  constraint drafts_provider_check check (provider in ('openai', 'gemini', 'anthropic')),
  constraint drafts_model_check check (model is null or char_length(model) between 1 and 200),
  constraint drafts_model_tier_check check (model_tier in ('light', 'default', 'heavy')),
  constraint drafts_connection_tier_check check (connection_tier in ('free', 'paid')),
  constraint drafts_input_hash_check check (input_hash is null or char_length(input_hash) between 1 and 128),
  constraint drafts_career_snapshot_hash_check check (
    career_snapshot_hash is null or char_length(career_snapshot_hash) between 1 and 128),
  constraint drafts_validation_report_check check (
    validation_report is null or jsonb_typeof(validation_report) = 'object'),
  constraint drafts_usage_check check (usage is null or jsonb_typeof(usage) = 'object'),
  -- A ready career description carries its hashes and provider badge (F-AI-03, F-DOC-01 stale check).
  constraint drafts_career_description_ready_check check (
    draft_type <> 'career_description' or status <> 'ready'
    or (completed_at is not null and input_hash is not null and career_snapshot_hash is not null
        and schema_version is not null and prompt_version is not null and provider is not null
        and model is not null and model_tier is not null and connection_tier is not null))
);

-- A.9 / S7 plan indexes.
create index drafts_project_type_created_idx on public.drafts (application_project_id, draft_type, created_at desc);
create index drafts_reuse_idx on public.drafts (user_id, application_project_id, input_hash) where status = 'ready';
create index drafts_ai_job_id_idx on public.drafts (ai_job_id) where ai_job_id is not null;
create index drafts_insight_id_idx on public.drafts (insight_id) where insight_id is not null;
create index drafts_regenerated_from_id_idx on public.drafts (regenerated_from_id) where regenerated_from_id is not null;

alter table public.drafts enable row level security;

create trigger drafts_set_updated_at
  before update on public.drafts
  for each row execute function private.set_updated_at();

-- F-DOC-04: first_copied_at records the first copy only. Once set it never changes (user column grant).
create or replace function private.drafts_keep_first_copied_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.first_copied_at is not null then
    new.first_copied_at := old.first_copied_at;
  end if;
  return new;
end;
$$;

revoke all on function private.drafts_keep_first_copied_at() from public;
grant execute on function private.drafts_keep_first_copied_at() to authenticated;

create trigger drafts_keep_first_copied_at
  before update of first_copied_at on public.drafts
  for each row execute function private.drafts_keep_first_copied_at();

-- RLS (DM §5): owner reads, updates the three user columns, deletes; app_ai_writer reads. Inserts: RPC only.
create policy drafts_select_own on public.drafts
  for select to authenticated using (user_id = (select auth.uid()));
create policy drafts_update_own on public.drafts
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy drafts_delete_own on public.drafts
  for delete to authenticated using (user_id = (select auth.uid()));
create policy drafts_select_ai_writer on public.drafts
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select, delete on table public.drafts to authenticated;
grant update (title, edited_at, first_copied_at) on table public.drafts to authenticated;
grant select on table public.drafts to app_ai_writer;

revoke insert, update, truncate, references, trigger on table public.drafts from service_role;


-- ── draft_sections (A.10 + AI meta) ────────────────────────────────────────

create table public.draft_sections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default private.current_uid() references auth.users (id) on delete cascade,
  draft_id uuid not null,
  sort_order integer not null,
  section_kind text not null,
  experience_id uuid,                -- soft (DM-7): the section header survives the experience
  education_id uuid,                 -- soft
  heading text,
  question_text text,
  template_key text,
  char_limit integer,
  count_basis text,
  user_note text,
  source_selection_mode text not null default 'ai',
  sources_modified_at timestamptz,
  generation_no integer not null default 0,
  question_class text,
  status text not null default 'pending',
  ai_content jsonb,
  edited_content jsonb,
  ai_char_count integer,
  correction_applied boolean not null default false,
  validation_report jsonb,
  -- AI output common meta (DM §0, v4: sections too — a question can be regenerated with another provider).
  ai_job_id uuid,
  run_generation integer,
  schema_version integer,
  prompt_version text,
  provider text,
  model text,
  model_tier text,
  connection_tier text,
  input_hash text,
  career_snapshot_hash text,
  usage jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint draft_sections_id_user_id_key unique (id, user_id),
  constraint draft_sections_draft_fkey foreign key (draft_id, user_id)
    references public.drafts (id, user_id) on delete cascade,
  constraint draft_sections_ai_job_fkey foreign key (ai_job_id, user_id)
    references public.ai_jobs (id, user_id) on delete set null (ai_job_id),
  -- Deferred so a reorder can renumber inside one statement.
  constraint draft_sections_draft_id_sort_order_key unique (draft_id, sort_order) deferrable initially deferred,
  constraint draft_sections_sort_order_check check (sort_order >= 0),
  constraint draft_sections_section_kind_check check (section_kind in (
    'experience', 'education', 'standalone_projects', 'cover_letter_question')),
  constraint draft_sections_template_key_check check (template_key in ('motivation', 'job_competency', 'future_plan')),
  constraint draft_sections_count_basis_check check (count_basis in ('with_spaces', 'without_spaces')),
  constraint draft_sections_source_selection_mode_check check (source_selection_mode in ('ai', 'user')),
  constraint draft_sections_question_class_check check (question_class in (
    'motivation', 'job_competency', 'future_plan', 'experience_story')),
  constraint draft_sections_status_check check (status in ('pending', 'generating', 'ready', 'failed')),
  -- Section kind <-> affiliation / question columns.
  constraint draft_sections_kind_columns_check check (
    case section_kind
      when 'experience' then experience_id is not null and education_id is null
      when 'education' then education_id is not null and experience_id is null
      else experience_id is null and education_id is null
    end),
  constraint draft_sections_question_columns_check check (
    case when section_kind = 'cover_letter_question'
      then question_text is not null and count_basis is not null
      else question_text is null and template_key is null and char_limit is null and count_basis is null
           and user_note is null and question_class is null
    end),
  constraint draft_sections_heading_check check (heading is null or char_length(heading) <= 300),
  constraint draft_sections_question_text_check check (
    question_text is null or (char_length(question_text) between 1 and 1000 and btrim(question_text) <> '')),
  constraint draft_sections_char_limit_check check (char_limit between 1 and 10000),
  constraint draft_sections_user_note_check check (char_length(user_note) <= 300),
  constraint draft_sections_generation_no_check check (generation_no >= 0),
  constraint draft_sections_ai_char_count_check check (ai_char_count >= 0),
  constraint draft_sections_ai_content_check check (private.draft_blocks_valid(ai_content)),
  constraint draft_sections_edited_content_check check (private.draft_blocks_valid(edited_content)),
  constraint draft_sections_validation_report_check check (
    validation_report is null or jsonb_typeof(validation_report) = 'object'),
  constraint draft_sections_run_generation_check check (run_generation is null or run_generation >= 0),
  constraint draft_sections_schema_version_check check (schema_version is null or schema_version >= 1),
  constraint draft_sections_prompt_version_check check (
    prompt_version is null or char_length(prompt_version) between 1 and 200),
  constraint draft_sections_provider_check check (provider in ('openai', 'gemini', 'anthropic')),
  constraint draft_sections_model_check check (model is null or char_length(model) between 1 and 200),
  constraint draft_sections_model_tier_check check (model_tier in ('light', 'default', 'heavy')),
  constraint draft_sections_connection_tier_check check (connection_tier in ('free', 'paid')),
  constraint draft_sections_input_hash_check check (input_hash is null or char_length(input_hash) between 1 and 128),
  constraint draft_sections_career_snapshot_hash_check check (
    career_snapshot_hash is null or char_length(career_snapshot_hash) between 1 and 128),
  constraint draft_sections_usage_check check (usage is null or jsonb_typeof(usage) = 'object'),
  -- A ready section always has its AI original (and, for a question, the count and class).
  constraint draft_sections_ready_check check (
    status <> 'ready'
    or (ai_content is not null and completed_at is not null and provider is not null and model is not null
        and model_tier is not null and connection_tier is not null
        and (section_kind <> 'cover_letter_question' or (ai_char_count is not null and question_class is not null))))
);

create index draft_sections_draft_id_idx on public.draft_sections (draft_id, sort_order);
create index draft_sections_ai_job_id_idx on public.draft_sections (ai_job_id) where ai_job_id is not null;
create index draft_sections_experience_idx on public.draft_sections (user_id, experience_id)
  where experience_id is not null;
create index draft_sections_education_idx on public.draft_sections (user_id, education_id)
  where education_id is not null;

alter table public.draft_sections enable row level security;

create trigger draft_sections_set_updated_at
  before update on public.draft_sections
  for each row execute function private.set_updated_at();

-- A section's evidence links go with it (C-3 storage: owner_type 'draft_section', owner_id soft). Security definer:
-- no API role may delete evidence_links directly. Fires for question delete, draft delete and project cascades.
create or replace function private.draft_sections_delete_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.evidence_links el
   where el.owner_type = 'draft_section' and el.owner_id = old.id and el.user_id = old.user_id;
  return null;
end;
$$;

revoke all on function private.draft_sections_delete_evidence() from public;

create trigger draft_sections_delete_evidence
  after delete on public.draft_sections
  for each row execute function private.draft_sections_delete_evidence();

-- RLS (DM §5): owner reads and updates the user columns; app_ai_writer reads. Insert / delete: RPC + cascade.
create policy draft_sections_select_own on public.draft_sections
  for select to authenticated using (user_id = (select auth.uid()));
create policy draft_sections_update_own on public.draft_sections
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy draft_sections_select_ai_writer on public.draft_sections
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select on table public.draft_sections to authenticated;
grant update (question_text, char_limit, count_basis, user_note, edited_content)
  on table public.draft_sections to authenticated;
grant select on table public.draft_sections to app_ai_writer;

revoke insert, update, truncate, references, trigger on table public.draft_sections from service_role;


-- ── draft_section_sources (A.11, §2.7) ─────────────────────────────────────

create table public.draft_section_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default private.current_uid() references auth.users (id) on delete cascade,
  draft_section_id uuid not null,
  application_project_id uuid not null,
  experience_id uuid,                -- soft (DM-7)
  education_id uuid,                 -- soft
  project_id uuid,                   -- soft
  project_detail_ids uuid[] not null default '{}',
  role text not null,
  origin text not null,
  rationale text,
  reuse_reason text,
  requirement_ids uuid[] not null default '{}',
  sort_order integer not null default 0,
  source_label text,
  source_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint draft_section_sources_section_fkey foreign key (draft_section_id, user_id)
    references public.draft_sections (id, user_id) on delete cascade,
  constraint draft_section_sources_application_project_fkey foreign key (application_project_id, user_id)
    references public.application_projects (id, user_id) on delete cascade,
  constraint draft_section_sources_section_sort_order_key unique (draft_section_id, sort_order),
  constraint draft_section_sources_role_check check (role in ('primary', 'supporting')),
  constraint draft_section_sources_origin_check check (origin in ('ai', 'user')),
  -- DM §2.7.
  constraint draft_section_sources_target_check check (num_nonnulls(experience_id, education_id, project_id) >= 1),
  constraint draft_section_sources_affiliation_check check (num_nonnulls(experience_id, education_id) <= 1),
  constraint draft_section_sources_rationale_check check (char_length(rationale) <= 300),
  constraint draft_section_sources_reuse_reason_check check (char_length(reuse_reason) <= 300),
  constraint draft_section_sources_source_label_check check (char_length(source_label) <= 300),
  constraint draft_section_sources_sort_order_check check (sort_order >= 0),
  constraint draft_section_sources_project_detail_ids_check check (
    array_position(project_detail_ids, null) is null and cardinality(project_detail_ids) <= 20),
  constraint draft_section_sources_requirement_ids_check check (
    array_position(requirement_ids, null) is null and cardinality(requirement_ids) <= 50)
);

create index draft_section_sources_section_idx on public.draft_section_sources (draft_section_id, sort_order);
create index draft_section_sources_application_project_idx on public.draft_section_sources (application_project_id);
-- Source deletion triggers / deletion impact look-ups.
create index draft_section_sources_experience_idx on public.draft_section_sources (user_id, experience_id)
  where experience_id is not null;
create index draft_section_sources_education_idx on public.draft_section_sources (user_id, education_id)
  where education_id is not null;
create index draft_section_sources_project_idx on public.draft_section_sources (user_id, project_id)
  where project_id is not null;

alter table public.draft_section_sources enable row level security;

create trigger draft_section_sources_set_updated_at
  before update on public.draft_section_sources
  for each row execute function private.set_updated_at();

-- RLS (DM §5): owner reads; app_ai_writer reads (AI-04 "other questions' sources"). Writes: RPC only.
create policy draft_section_sources_select_own on public.draft_section_sources
  for select to authenticated using (user_id = (select auth.uid()));
create policy draft_section_sources_select_ai_writer on public.draft_section_sources
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select on table public.draft_section_sources to authenticated, app_ai_writer;

revoke insert, update, truncate, references, trigger on table public.draft_section_sources from service_role;
