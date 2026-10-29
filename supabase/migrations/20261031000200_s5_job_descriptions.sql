-- S5 JD (AI-01, F-AP-01, F-P2-01·02): job_descriptions + jd_requirements (DM §2.6 v4, A.6, A.7, AI C-2) + RLS.
--
-- Write paths (DM §5):
--   * job_descriptions insert: create_application_project only. No user UPDATE / DELETE (cascade only).
--     application_project_id / raw_text / raw_text_hash / sentences are immutable for every role (D-19).
--   * extraction columns: begin_jd_extraction / apply_jd_extraction / fail_jd_extraction (app_ai_writer,
--     definer + owner check). No column grant to app_ai_writer (S4 precedent).
--   * jd_requirements: written only by apply_jd_extraction. F-P2-03 user edits are Could -> no user writes yet.
--
-- sentences: [{sid, text, start, end}] split by the server (TS splitJdSentences, C-2), possibly empty (QA-S5-01).
-- The DB checks the structure only: sid = S1, S2, ... in order, text string, 0 <= start < end. Offsets are JS UTF-16 units, so
-- they are not compared with raw_text here [가정].

-- Structural check for job_descriptions.sentences (also used by create_application_project).
create or replace function private.jd_sentences_valid(p_sentences jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_elem jsonb;
  v_ord bigint;
begin
  -- QA-S5-01: an empty array is valid (a symbols-only JD splits into 0 sentences). Saving the raw JD always
  -- succeeds; AI-01 then ends as not_a_jd without a provider call.
  if p_sentences is null or jsonb_typeof(p_sentences) <> 'array' then
    return false;
  end if;
  for v_elem, v_ord in select e, o from jsonb_array_elements(p_sentences) with ordinality as t (e, o) loop
    if jsonb_typeof(v_elem) <> 'object'
       or jsonb_typeof(v_elem -> 'sid') is distinct from 'string'
       or v_elem ->> 'sid' <> 'S' || v_ord
       or jsonb_typeof(v_elem -> 'text') is distinct from 'string'
       or jsonb_typeof(v_elem -> 'start') is distinct from 'number'
       or jsonb_typeof(v_elem -> 'end') is distinct from 'number'
       or (v_elem ->> 'start') !~ '^[0-9]+$'
       or (v_elem ->> 'end') !~ '^[0-9]+$'
       or (v_elem ->> 'start')::numeric >= (v_elem ->> 'end')::numeric then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function private.jd_sentences_valid(jsonb) from public;

-- Every element is a sentence id shape (S<n>, n >= 1). Existence against sentences is checked by the RPC.
create or replace function private.jd_sids_valid(p_sids text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_sids is not null and cardinality(p_sids) >= 1
     and coalesce((select bool_and(s is not null and s ~ '^S[1-9][0-9]*$') from unnest(p_sids) s), false);
$$;

revoke all on function private.jd_sids_valid(text[]) from public;


create table public.job_descriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  application_project_id uuid not null,
  raw_text text not null,
  raw_text_hash text not null,
  sentences jsonb not null,
  detected_language text,
  company_name text,
  company_name_source text,
  position_title text,
  position_title_source text,
  extraction_status text not null default 'pending',
  extraction jsonb,
  -- The latest extraction run. ai_jobs rows are pruned after 90 days (DM 4.4) -> set null.
  extraction_job_id uuid,
  extraction_provider text,
  extraction_model text,
  tech_keywords jsonb,
  requirements_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_descriptions_id_user_id_key unique (id, user_id),
  -- A.6: one JD per application project, deleted with it (F-AP-05).
  constraint job_descriptions_application_project_id_key unique (application_project_id),
  constraint job_descriptions_application_project_fkey foreign key (application_project_id, user_id)
    references public.application_projects (id, user_id) on delete cascade,
  constraint job_descriptions_extraction_job_fkey foreign key (extraction_job_id, user_id)
    references public.ai_jobs (id, user_id) on delete set null (extraction_job_id),
  constraint job_descriptions_raw_text_check check (char_length(raw_text) between 1 and 50000),
  constraint job_descriptions_raw_text_hash_check check (char_length(raw_text_hash) between 1 and 128),
  constraint job_descriptions_sentences_check check (private.jd_sentences_valid(sentences)),
  constraint job_descriptions_detected_language_check check (
    detected_language is null or char_length(detected_language) between 1 and 16),
  -- [가정] 200 chars: the spec gives no limit; the composed project name is cut to 100 anyway.
  constraint job_descriptions_company_name_check check (
    company_name is null or (char_length(company_name) between 1 and 200 and btrim(company_name) <> '')),
  constraint job_descriptions_company_name_source_check check (company_name_source in ('user', 'ai')),
  constraint job_descriptions_company_name_pair_check check ((company_name is null) = (company_name_source is null)),
  constraint job_descriptions_position_title_check check (
    position_title is null or (char_length(position_title) between 1 and 200 and btrim(position_title) <> '')),
  constraint job_descriptions_position_title_source_check check (position_title_source in ('user', 'ai')),
  constraint job_descriptions_position_title_pair_check check ((position_title is null) = (position_title_source is null)),
  constraint job_descriptions_extraction_status_check check (extraction_status in ('pending', 'running', 'succeeded', 'failed')),
  constraint job_descriptions_extraction_check check (extraction is null or jsonb_typeof(extraction) = 'object'),
  constraint job_descriptions_extraction_provider_check check (extraction_provider in ('openai', 'gemini', 'anthropic')),
  constraint job_descriptions_tech_keywords_check check (tech_keywords is null or jsonb_typeof(tech_keywords) = 'array'),
  constraint job_descriptions_requirements_hash_check check (
    requirements_hash is null or char_length(requirements_hash) between 1 and 128),
  -- A succeeded extraction always carries its result and provider badge (F-AI-03, F-AI-09).
  constraint job_descriptions_succeeded_check check (
    extraction_status <> 'succeeded'
    or (extraction is not null and tech_keywords is not null and requirements_hash is not null
        and extraction_provider is not null and extraction_model is not null))
);

create index job_descriptions_extraction_job_id_idx on public.job_descriptions (extraction_job_id)
  where extraction_job_id is not null;

alter table public.job_descriptions enable row level security;

-- D-19: the JD can't be replaced after creation (re-extraction is a failure retry only).
create or replace function private.job_descriptions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.application_project_id is distinct from old.application_project_id
     or new.user_id is distinct from old.user_id
     or new.raw_text is distinct from old.raw_text
     or new.raw_text_hash is distinct from old.raw_text_hash
     or new.sentences is distinct from old.sentences then
    raise exception using errcode = 'P0001', message = 'job_description_immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.job_descriptions_guard() from public;

create trigger job_descriptions_guard
  before update on public.job_descriptions
  for each row execute function private.job_descriptions_guard();

create trigger job_descriptions_set_updated_at
  before update on public.job_descriptions
  for each row execute function private.set_updated_at();

create policy job_descriptions_select_own on public.job_descriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy job_descriptions_select_ai_writer on public.job_descriptions
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select on table public.job_descriptions to authenticated, app_ai_writer;


create table public.jd_requirements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  job_description_id uuid not null,
  category text not null,
  content text not null,
  keywords text[] not null default '{}',
  importance text not null default 'normal',
  source_sids text[] not null,
  sort_order integer not null default 0,
  origin text not null default 'ai',
  is_user_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jd_requirements_id_user_id_key unique (id, user_id),
  constraint jd_requirements_job_description_fkey foreign key (job_description_id, user_id)
    references public.job_descriptions (id, user_id) on delete cascade,
  constraint jd_requirements_category_check check (category in ('responsibility', 'required', 'preferred')),
  -- [가정] 500 chars (AI-01 text is a short summary; the pipeline caps it at 300).
  constraint jd_requirements_content_check check (char_length(content) between 1 and 500 and btrim(content) <> ''),
  constraint jd_requirements_importance_check check (importance in ('high', 'normal')),
  -- AI-01 / C-2: every requirement cites at least one JD sentence.
  constraint jd_requirements_source_sids_check check (private.jd_sids_valid(source_sids)),
  constraint jd_requirements_sort_order_check check (sort_order >= 0),
  constraint jd_requirements_origin_check check (origin in ('ai', 'user'))
);

create index jd_requirements_job_description_sort_idx on public.jd_requirements (job_description_id, sort_order);

alter table public.jd_requirements enable row level security;

create trigger jd_requirements_set_updated_at
  before update on public.jd_requirements
  for each row execute function private.set_updated_at();

create policy jd_requirements_select_own on public.jd_requirements
  for select to authenticated using (user_id = (select auth.uid()));
create policy jd_requirements_select_ai_writer on public.jd_requirements
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select on table public.jd_requirements to authenticated, app_ai_writer;

-- DM §5: JD / requirements are written only through the RPCs above; service_role keeps SELECT / DELETE.
revoke insert, update, truncate, references, trigger on table public.job_descriptions from service_role;
revoke insert, update, truncate, references, trigger on table public.jd_requirements from service_role;
