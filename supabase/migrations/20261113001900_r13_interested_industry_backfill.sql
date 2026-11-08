-- R13 ⑤ interested_industries -> interested_industry backfill (DM v4.12 §2.1.1 ②).
-- Only rows whose array holds exactly one element whose string equals an industry label *verbatim* are
-- mapped. Everything else (0 elements, 2+, a string with no matching label) stays null and the user picks
-- again — no guessing table. Row counts go to the log (raise notice).
do $$
declare
  v_total bigint;
  v_mapped bigint;
  v_single_unmatched bigint;
  v_multi bigint;
begin
  select count(*) filter (where cardinality(p.interested_industries) > 0),
         count(*) filter (where cardinality(p.interested_industries) > 1)
    into v_total, v_multi
    from public.profiles p;

  with one as (
    select p.id, p.interested_industries[1] as label
      from public.profiles p
     where cardinality(p.interested_industries) = 1
  ), matched as (
    update public.profiles p
       set interested_industry = o.code
      from one
      join public.profile_options o on o.category = 'industry' and o.label = one.label
     where p.id = one.id
    returning p.id
  )
  select count(*) into v_mapped from matched;

  select count(*) into v_single_unmatched
    from public.profiles p
   where cardinality(p.interested_industries) = 1 and p.interested_industry is null;

  raise notice 'R13 interested_industry backfill: % profile(s) had a value, % mapped, % single-value unmatched, % had 2+ values (left null)',
    v_total, v_mapped, v_single_unmatched, v_multi;
end;
$$;
