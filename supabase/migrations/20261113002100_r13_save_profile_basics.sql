-- R13 ⑦ save_profile_basics (DM v4.12 §2.1.1, §2.1.2, §7 "내 정보 저장"; SD-A2, UX 요청 3, R-SD-18).
-- One "저장" of the settings dialog's 내 정보 section = one call: profiles update + the whole 관심 직군·직무
-- pair list rewritten (delete -> insert, sort_order 1..n) in one transaction. security invoker (RLS as the user).
--
-- p_values keys are the profiles column names (display_name included). **섹션 전체 덮어쓰기** [가정]: a key that
-- is absent is written as null, because the screen saves the whole section (plan 계약 스케치). Keys that are not
-- 내 정보 columns are ignored.
-- Month values are 'YYYY-MM' strings (same convention as save_project_page); a bad shape is invalid_period.
--
-- Errors (DM §7): stale_write (409) · invalid_profile_option (400, from the ④ trigger) · field_too_long (400,
-- detail = field) · invalid_period (400) · too_many_job_interests (400, 3쌍 이상 — 상한 2쌍, SD-Q3 (가)) ·
-- duplicate_job_interest (400, 같은 (job_family, job_role) 쌍이 두 번. 직무를 비운 쌍끼리도 중복으로 본다;
-- 받은 목록을 insert 전에 검사하고 제약 위반 23505도 같은 코드로 변환한다).
create or replace function public.save_profile_basics(
  p_values jsonb,
  p_job_interests jsonb default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_max_pairs constant integer := 2;
  v_uid uuid := auth.uid();
  v_vals jsonb := coalesce(nullif(p_values, 'null'::jsonb), '{}'::jsonb);
  v_pairs jsonb := coalesce(nullif(p_job_interests, 'null'::jsonb), '[]'::jsonb);
  v_row public.profiles%rowtype;
  v_display_name text;
  v_job_search_status text;
  v_company_type text;
  v_industry text;
  v_school_name text;
  v_degree text;
  v_status text;
  v_start date;
  v_end date;
  v_major text;
  v_gpa text;
  v_field text;
  v_txt text;
  v_el jsonb;
  v_ord integer := 0;
  v_dup_pos integer;
  v_updated_at timestamptz;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if jsonb_typeof(v_vals) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid_payload', detail = 'p_values';
  end if;
  if jsonb_typeof(v_pairs) <> 'array' then
    raise exception using errcode = 'P0001', message = 'invalid_payload', detail = 'p_job_interests';
  end if;

  select * into v_row from public.profiles p where p.id = v_uid for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if p_expected_updated_at is not null and v_row.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'stale_write',
      detail = to_char(v_row.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  end if;

  -- ── text values (absent key -> null; blank-only -> null) ──
  v_display_name := nullif(btrim(v_vals ->> 'display_name'), '');
  v_job_search_status := nullif(btrim(v_vals ->> 'job_search_status'), '');
  v_company_type := nullif(btrim(v_vals ->> 'interested_company_type'), '');
  v_industry := nullif(btrim(v_vals ->> 'interested_industry'), '');
  v_school_name := nullif(btrim(v_vals ->> 'highest_education_school_name'), '');
  v_degree := nullif(btrim(v_vals ->> 'highest_education_degree'), '');
  v_status := nullif(btrim(v_vals ->> 'highest_education_status'), '');
  v_major := nullif(btrim(v_vals ->> 'highest_education_major'), '');
  v_gpa := nullif(btrim(v_vals ->> 'highest_education_gpa'), '');

  if char_length(v_display_name) > 50 then
    raise exception using errcode = 'P0001', message = 'field_too_long', detail = 'display_name';
  end if;
  if char_length(v_school_name) > 100 then
    raise exception using errcode = 'P0001', message = 'field_too_long',
      detail = 'highest_education_school_name';
  end if;
  if char_length(v_major) > 100 then
    raise exception using errcode = 'P0001', message = 'field_too_long', detail = 'highest_education_major';
  end if;
  if char_length(v_gpa) > 20 then
    raise exception using errcode = 'P0001', message = 'field_too_long', detail = 'highest_education_gpa';
  end if;

  -- ── 최종 학력 기간 ('YYYY-MM', day 1, end >= start) ──
  foreach v_field in array array['highest_education_start_month', 'highest_education_end_month'] loop
    v_txt := nullif(btrim(v_vals ->> v_field), '');
    if v_txt is not null and v_txt !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
      raise exception using errcode = 'P0001', message = 'invalid_period', detail = v_field;
    end if;
    if v_field = 'highest_education_start_month' then
      v_start := case when v_txt is null then null else to_date(v_txt || '-01', 'YYYY-MM-DD') end;
    else
      v_end := case when v_txt is null then null else to_date(v_txt || '-01', 'YYYY-MM-DD') end;
    end if;
  end loop;
  if v_end is not null and v_start is not null and v_end < v_start then
    raise exception using errcode = 'P0001', message = 'invalid_period',
      detail = 'highest_education_end_month';
  end if;

  -- ── pair list: cap, shape, in-payload duplicates (null job_role counts as a value) ──
  if jsonb_array_length(v_pairs) > c_max_pairs then
    raise exception using errcode = 'P0001', message = 'too_many_job_interests',
      detail = jsonb_array_length(v_pairs)::text;
  end if;
  for v_el in select e from jsonb_array_elements(v_pairs) e loop
    if jsonb_typeof(v_el) <> 'object' or nullif(btrim(v_el ->> 'job_family'), '') is null then
      raise exception using errcode = 'P0001', message = 'invalid_profile_option', detail = 'job_family';
    end if;
  end loop;
  -- detail = the 1-based position of the second occurrence, so the screen can mark that pair's row
  -- (요청 R13-API-4, api-engineer).
  with pairs as (
    select e.ordinality as pos,
           nullif(btrim(e.value ->> 'job_family'), '') as jf,
           nullif(btrim(e.value ->> 'job_role'), '') as jr
      from jsonb_array_elements(v_pairs) with ordinality e(value, ordinality)
  )
  select min(a.pos)::int into v_dup_pos
    from pairs a
    join pairs b on b.pos < a.pos and b.jf = a.jf and b.jr is not distinct from a.jr;
  if v_dup_pos is not null then
    raise exception using errcode = 'P0001', message = 'duplicate_job_interest',
      detail = v_dup_pos::text;
  end if;

  -- ── write ──
  update public.profiles p
     set display_name = v_display_name,
         job_search_status = v_job_search_status,
         interested_company_type = v_company_type,
         interested_industry = v_industry,
         highest_education_school_name = v_school_name,
         highest_education_degree = v_degree,
         highest_education_status = v_status,
         highest_education_start_month = v_start,
         highest_education_end_month = v_end,
         highest_education_major = v_major,
         highest_education_gpa = v_gpa
   where p.id = v_uid
  returning p.updated_at into v_updated_at;

  delete from public.profile_job_interests i where i.user_id = v_uid;

  begin
    for v_el in select e from jsonb_array_elements(v_pairs) e loop
      v_ord := v_ord + 1;
      insert into public.profile_job_interests (user_id, sort_order, job_family, job_role)
      values (v_uid, v_ord, nullif(btrim(v_el ->> 'job_family'), ''), nullif(btrim(v_el ->> 'job_role'), ''));
    end loop;
  exception
    -- The constraint is the last line of defence (concurrent saves); never surface a raw 23505.
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'duplicate_job_interest', detail = v_ord::text;
    when check_violation then
      -- sort_order between 1 and 2 (the cap above catches this first in normal use).
      raise exception using errcode = 'P0001', message = 'too_many_job_interests', detail = v_ord::text;
  end;

  return jsonb_build_object('updated_at', v_updated_at);
end;
$$;

revoke all on function public.save_profile_basics(jsonb, jsonb, timestamptz)
  from public, anon, app_ai_writer;
grant execute on function public.save_profile_basics(jsonb, jsonb, timestamptz) to authenticated;
