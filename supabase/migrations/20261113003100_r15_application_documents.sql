-- R15 / D1 (DM 11.8 #1, §2.7.3, CL-9·CL-3·CL-5·CL-8, v4.15 CF-A2·CF-5·CF-6·CF-M1)
-- application_documents: the cover letter of record. One row per application project (document_kind has a single
-- value, CF-A2). The chat (writing_chats.structured_draft) only holds proposals; this row is what the user
-- confirmed. No migration_note column (CF-M1 — nothing is migrated).
-- Deployment stage 1: nothing writes this table yet; save_application_document (stage 3) is the only creator.

create table public.application_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  application_project_id uuid not null,
  document_kind text not null,
  body jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  filled_slot_count integer not null default 0,
  -- UX DM-7: question count (empty answers counted too) as a stored generated column, so the board query does not
  -- read the whole body jsonb and the value can never drift from it (the save RPC never writes it).
  slot_count integer generated always as (
    case when jsonb_typeof(body -> 'questions') = 'array'
         then jsonb_array_length(body -> 'questions') else 0 end) stored,
  first_copied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- (v4.15, CF-1·CF-A2) cover_letter is the only kind; the column stays so the evidence / deletion / RPC shapes
  -- do not have to be rewritten if another kind ever returns.
  constraint application_documents_document_kind_check check (document_kind in ('cover_letter')),
  constraint application_documents_filled_slot_count_check check (filled_slot_count >= 0),
  constraint application_documents_body_check check (jsonb_typeof(body) = 'object'),
  constraint application_documents_meta_check check (jsonb_typeof(meta) = 'object'),
  -- = one row per application project; also the main read path and the "서류 수" aggregate index.
  constraint application_documents_project_kind_key unique (application_project_id, document_kind),
  -- DM-12: ownership key. The composite FK makes "the project is the same user's" a DB fact.
  constraint application_documents_application_project_fkey
    foreign key (application_project_id, user_id)
    references public.application_projects (id, user_id) on delete cascade
);

create index application_documents_user_id_idx on public.application_documents (user_id);

create trigger application_documents_set_updated_at
  before update on public.application_documents
  for each row execute function private.set_updated_at();

alter table public.application_documents enable row level security;

-- DM §5: select / delete own. insert / update go through save_application_document (security invoker), which runs
-- with the caller's privileges and therefore needs the grant; screens do not write the table directly
-- (same compromise as profile_job_interests, DM §5) `[가정]`.
create policy application_documents_select_own on public.application_documents
  for select to authenticated using (user_id = (select auth.uid()));
create policy application_documents_insert_own on public.application_documents
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy application_documents_update_own on public.application_documents
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy application_documents_delete_own on public.application_documents
  for delete to authenticated using (user_id = (select auth.uid()));

-- app_ai_writer: SELECT only (CL-4, AI 회신 10) — the turn's backup path for "the body right now"
-- (form_snapshot wins). No write grant.
create policy application_documents_select_ai_writer on public.application_documents
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select, insert, update, delete on public.application_documents to authenticated;
grant select on public.application_documents to app_ai_writer;
-- service_role: account deletion only (DM §4.5 delete_account deletes every user table explicitly). Supabase
-- default privileges grant ALL to service_role on a new public table, so the writes are revoked again here.
revoke insert, update, truncate, references, trigger on table public.application_documents from service_role;

comment on table public.application_documents is
  'Cover letter of record per application project (DM §2.7.3). body = {questions: [...]}; written only by save_application_document.';
