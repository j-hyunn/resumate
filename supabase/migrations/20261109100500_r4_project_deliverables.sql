-- R4 project_deliverables (DM v4.4 §2.3, CR-8, PRD F-P1-18): title + markdown body under a standalone project.
-- AI evidence source (source_type 'project_deliverable'). No status column: the parent project's completion
-- decides whether deliverables enter the AI pack.

create table public.project_deliverables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null,
  title text not null,
  body text not null default '',
  sort_order smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_deliverables_id_user_id_key unique (id, user_id),
  constraint project_deliverables_project_fkey foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade,
  -- Deferred so reorder_project_deliverables can renumber inside one transaction.
  constraint project_deliverables_project_id_sort_order_key unique (project_id, sort_order)
    deferrable initially deferred,
  -- [가정] DM: screen spec 100 chars (not the AI spec's 200).
  constraint project_deliverables_title_check check (btrim(title) <> '' and char_length(title) <= 100),
  constraint project_deliverables_body_check check (char_length(body) <= 20000),
  constraint project_deliverables_sort_order_check check (sort_order >= 1)
);

create index project_deliverables_user_id_idx on public.project_deliverables (user_id);

alter table public.project_deliverables enable row level security;

-- Insert: standalone parent only, 50 per project [가정] (PRD F-P1-18 (3)), sort_order = last + 1 when omitted.
-- Security definer: it locks the parent project row to serialize concurrent inserts for the limit.
create or replace function private.project_deliverables_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exp uuid;
  v_edu uuid;
begin
  select p.experience_id, p.education_id into v_exp, v_edu
    from public.projects p
   where p.id = new.project_id and p.user_id = new.user_id
     for no key update;
  if found and num_nonnulls(v_exp, v_edu) > 0 then
    raise exception using errcode = 'P0001', message = 'deliverable_requires_standalone_project';
  end if;

  if tg_op = 'INSERT' then
    if (select count(*) from public.project_deliverables d where d.project_id = new.project_id) >= 50 then
      raise exception using errcode = 'P0001', message = 'deliverable_limit_reached';
    end if;
    if new.sort_order is null then
      select coalesce(max(d.sort_order), 0) + 1 into new.sort_order
        from public.project_deliverables d where d.project_id = new.project_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.project_deliverables_before_insert() from public;

create trigger project_deliverables_before_insert
  before insert or update of project_id on public.project_deliverables
  for each row execute function private.project_deliverables_before_insert();

-- updated_at doubles as the evidence snapshot time (DM §2.8): a pure reorder is not a content change.
create or replace function private.project_deliverables_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.title, new.body, new.project_id) is distinct from (old.title, old.body, old.project_id) then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

revoke all on function private.project_deliverables_set_updated_at() from public;

create trigger project_deliverables_set_updated_at
  before update on public.project_deliverables
  for each row execute function private.project_deliverables_set_updated_at();

create trigger project_deliverables_touch_career_data
  after insert or update or delete on public.project_deliverables
  for each row execute function private.touch_career_data_updated_at();

-- Evidence "원본 삭제됨" (DM §2.8, C-3).
create trigger project_deliverables_evidence_source_deleted
  after delete on public.project_deliverables
  for each row execute function private.evidence_mark_source_deleted('project_deliverable');

create policy project_deliverables_select_own on public.project_deliverables
  for select to authenticated using (user_id = (select auth.uid()));
create policy project_deliverables_insert_own on public.project_deliverables
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy project_deliverables_update_own on public.project_deliverables
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy project_deliverables_delete_own on public.project_deliverables
  for delete to authenticated using (user_id = (select auth.uid()));
create policy project_deliverables_select_ai_writer on public.project_deliverables
  for select to app_ai_writer using (user_id = (select private.current_uid()));

grant select, delete on table public.project_deliverables to authenticated;
grant insert (id, user_id, project_id, title, body, sort_order) on table public.project_deliverables to authenticated;
-- project_id is fixed after insert.
grant update (title, body, sort_order) on table public.project_deliverables to authenticated;
grant select on table public.project_deliverables to app_ai_writer;

-- reorder_project_deliverables (DM §2.3 [가정]): p_ordered_ids lists every deliverable of the project exactly once;
-- they become sort_order 1..n. Security invoker (user RLS).
create or replace function public.reorder_project_deliverables(p_project_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[] := coalesce(p_ordered_ids, '{}');
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if not exists (select 1 from public.projects p where p.id = p_project_id and p.user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'career_item_not_found';
  end if;

  if array_position(v_ids, null) is not null
     or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x)
     or exists (select 1 from unnest(v_ids) x
                 where not exists (select 1 from public.project_deliverables d
                                    where d.id = x and d.project_id = p_project_id))
     or (select count(*) from public.project_deliverables d where d.project_id = p_project_id)
        <> cardinality(v_ids)
  then
    raise exception using errcode = 'P0001', message = 'invalid_deliverable_order';
  end if;

  update public.project_deliverables d
     set sort_order = o.ord
    from unnest(v_ids) with ordinality as o (id, ord)
   where d.id = o.id
     and d.project_id = p_project_id
     and d.sort_order is distinct from o.ord::smallint;
end;
$$;

revoke all on function public.reorder_project_deliverables(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_project_deliverables(uuid, uuid[]) to authenticated;
