-- R13 ② profiles "내 정보" columns (DM v4.12 §2.1.1; SD-2·SD-A4·SD-A17; PRD F-P1-01, 9.7).
-- All nullable / optional, used by no gate and by no AI prompt (DM §2.1.5, SD-6).
-- interested_industry (singular) replaces interested_industries text[]; the old column is dropped in ⑭ after the
-- reading code is deployed. Code values are checked against profile_options by the trigger added in ④.
-- Year-month columns are pinned to day 1 (DM-4). 최종 학력 is NOT synced with educations (SD-5): no FK, no trigger.
-- These columns do NOT touch career_data_updated_at (not career data, DM §2.1.1).

alter table public.profiles
  add column job_search_status text,
  add column interested_company_type text,
  add column interested_industry text,
  add column highest_education_school_name text,
  add column highest_education_degree text,
  add column highest_education_status text,
  add column highest_education_start_month date,
  add column highest_education_end_month date,
  add column highest_education_major text,
  add column highest_education_gpa text;

alter table public.profiles
  add constraint profiles_highest_education_school_name_check
    check (char_length(highest_education_school_name) <= 100),
  add constraint profiles_highest_education_major_check
    check (char_length(highest_education_major) <= 100),
  add constraint profiles_highest_education_gpa_check
    check (char_length(highest_education_gpa) <= 20),
  add constraint profiles_highest_education_start_month_check
    check (extract(day from highest_education_start_month) = 1),
  add constraint profiles_highest_education_end_month_check
    check (extract(day from highest_education_end_month) = 1),
  -- 재학·휴학이면 종료월을 비울 수 있다. 졸업 상태와 교차 검증하지 않는다 (DM §2.1.1).
  add constraint profiles_highest_education_period_check
    check (highest_education_end_month is null or highest_education_start_month is null
           or highest_education_end_month >= highest_education_start_month);

-- The user session writes these through save_profile_basics (security invoker, ⑦), so the column grants are
-- the same as the existing editable columns (DM §5 "profiles update 본인").
grant select, update (job_search_status, interested_company_type, interested_industry,
                      highest_education_school_name, highest_education_degree, highest_education_status,
                      highest_education_start_month, highest_education_end_month,
                      highest_education_major, highest_education_gpa)
  on table public.profiles to authenticated;

comment on column public.profiles.interested_industry is
  'profile_options category industry (single select). Replaces interested_industries (dropped in R13 ⑭).';
