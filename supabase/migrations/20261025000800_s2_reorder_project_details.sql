-- S2 RPC: reorder_project_details (DM §7 "상세 내용 순서 변경", S-10).
-- Security invoker: the caller's RLS decides which project/details are visible.
-- p_ordered_ids must list every detail of the project exactly once; they become sort_order 1..n.
-- The (project_id, sort_order) unique constraint is deferred, so renumbering inside one
-- transaction does not collide.

create or replace function public.reorder_project_details(p_project_id uuid, p_ordered_ids uuid[])
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

  -- Same set, no duplicates, no nulls.
  if array_position(v_ids, null) is not null
     or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x)
     or exists (select 1 from unnest(v_ids) x
                 where not exists (select 1 from public.project_details d
                                    where d.id = x and d.project_id = p_project_id))
     or (select count(*) from public.project_details d where d.project_id = p_project_id)
        <> cardinality(v_ids)
  then
    raise exception using errcode = 'P0001', message = 'invalid_detail_order';
  end if;

  update public.project_details d
     set sort_order = o.ord
    from unnest(v_ids) with ordinality as o (id, ord)
   where d.id = o.id
     and d.project_id = p_project_id
     and d.sort_order is distinct from o.ord::smallint;
end;
$$;

revoke all on function public.reorder_project_details(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_project_details(uuid, uuid[]) to authenticated;
