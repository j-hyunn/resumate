-- R4 QA round 2 fix QA-R4-05 (_workspace/backend/R4/03_backend-qa_report.md).
--   project_deliverables.sort_order gets default 0 so the generated Insert type no longer requires it.
--   The insert trigger appends (max + 1) when sort_order is null or below 1; the >= 1 CHECK is evaluated after
--   the BEFORE trigger, so an omitted value never reaches it as 0.
-- Body otherwise identical to 20261109101700_r4_qa1_fixes.

ALTER TABLE public.project_deliverables ALTER COLUMN sort_order SET DEFAULT 0;

CREATE OR REPLACE FUNCTION private.project_deliverables_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
  SET search_path TO ''
AS $function$
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
    if new.sort_order is null or new.sort_order < 1 then
      select coalesce(max(d.sort_order), 0) + 1 into new.sort_order
        from public.project_deliverables d where d.project_id = new.project_id;
    end if;
  end if;
  return new;
end;
$function$;
