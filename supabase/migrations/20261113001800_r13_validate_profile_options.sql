-- R13 ④ private.validate_profile_options() (DM v4.12 §2.1.1 DM-22, §2.1.2).
-- There is no FK from profiles / profile_job_interests to profile_options: the target category is a constant,
-- not a stored column. One BEFORE insert/update trigger per table checks each value against its category and
-- raises invalid_profile_option (400) when it is not there.
--   A code that does not exist in its category is always refused.
--   is_active = false is refused only for a *newly chosen* value (the app never offers it); re-saving the value
--   the row already holds passes, so a user whose pick was retired can still save the rest of the section
--   [가정] (DM §2.1.1).
--   job_role must exist in category job_role with parent_code = job_family (DM §2.1.2).

-- Shared check. p_is_new = the value is being chosen now (insert, or changed by this update).
create or replace function private.profile_option_check(p_category text, p_code text, p_is_new boolean,
                                                        p_detail text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_active boolean;
begin
  if p_code is null then
    return;
  end if;
  select o.is_active into v_active from public.profile_options o
   where o.category = p_category and o.code = p_code;
  if not found or (p_is_new and not v_active) then
    raise exception using errcode = 'P0001', message = 'invalid_profile_option', detail = p_detail;
  end if;
end;
$$;

revoke all on function private.profile_option_check(text, text, boolean, text) from public;

create or replace function private.validate_profile_options()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_insert boolean := tg_op = 'INSERT';
  v_parent text;
  v_active boolean;
  v_held text;
begin
  if tg_table_name = 'profiles' then
    perform private.profile_option_check('job_search_status', new.job_search_status,
      v_insert or new.job_search_status is distinct from old.job_search_status, 'job_search_status');
    perform private.profile_option_check('company_type', new.interested_company_type,
      v_insert or new.interested_company_type is distinct from old.interested_company_type,
      'interested_company_type');
    perform private.profile_option_check('industry', new.interested_industry,
      v_insert or new.interested_industry is distinct from old.interested_industry, 'interested_industry');
    perform private.profile_option_check('degree', new.highest_education_degree,
      v_insert or new.highest_education_degree is distinct from old.highest_education_degree,
      'highest_education_degree');
    perform private.profile_option_check('graduation_status', new.highest_education_status,
      v_insert or new.highest_education_status is distinct from old.highest_education_status,
      'highest_education_status');
    return new;
  end if;

  -- profile_job_interests: job_family, then job_role under that family.
  -- UI-42: save_profile_basics rewrites pairs (delete -> insert) and records the codes the user held
  -- before the delete; a held code is "not newly chosen", so a retired one may be saved again.
  v_held := ',' || coalesce(current_setting('resumate.held_job_codes', true), '') || ',';
  perform private.profile_option_check('job_family', new.job_family,
    (v_insert and position(',family:' || new.job_family || ',' in v_held) = 0)
      or (not v_insert and new.job_family is distinct from old.job_family), 'job_family');

  if new.job_role is not null then
    select o.is_active, o.parent_code into v_active, v_parent from public.profile_options o
     where o.category = 'job_role' and o.code = new.job_role;
    if not found
       or (((v_insert and position(',role:' || new.job_role || ',' in v_held) = 0)
            or (not v_insert and new.job_role is distinct from old.job_role)) and not v_active) then
      raise exception using errcode = 'P0001', message = 'invalid_profile_option', detail = 'job_role';
    end if;
    if v_parent is distinct from new.job_family then
      -- QA-R13-02: detail is the field name (same convention as every other branch), so api's
      -- details.field can move focus to that select.
      raise exception using errcode = 'P0001', message = 'invalid_profile_option', detail = 'job_role';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_profile_options() from public;

create trigger profiles_validate_profile_options
  before insert or update on public.profiles
  for each row execute function private.validate_profile_options();

create trigger profile_job_interests_validate_profile_options
  before insert or update on public.profile_job_interests
  for each row execute function private.validate_profile_options();
