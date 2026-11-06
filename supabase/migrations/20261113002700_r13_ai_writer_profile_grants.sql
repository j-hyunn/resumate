-- R13 ⑬ app_ai_writer and the 내 정보 columns (DM v4.12 §2.1.5 SD-6, §5).
-- profiles is not an AI input path. The AI run path reads only active_ai_provider (gate, through the definer
-- helpers) and career_data_updated_at; it must not be able to read the 내 정보 values.
--
-- Current state (checked before writing this file): app_ai_writer has column-level select on profiles
--   (id, career_data_updated_at, updated_at, desired_job_title, interested_industries,
--    total_years_of_experience)
-- — not whole-table select, so only the three 내 정보 columns are revoked here. The new columns added in ②
-- were never granted, and no grant is given now (SD-6).
--   id / career_data_updated_at / updated_at stay: the policy filters by id and the pack's "커리어 변경됨"
--   check reads career_data_updated_at.
--   active_ai_provider is NOT granted — the gate runs inside security definer functions
--   (check_ai_run_allowed etc.), which do not need a role grant.
-- profile_job_interests and profile_options get no grant at all (①, ③ grant to authenticated only).
--
-- Breaks on purpose: src/server/ai/context-pack/career-rows.ts still selects desired_job_title /
-- total_years_of_experience / interested_industries from profiles with the app_ai_writer client. That query
-- must be removed (DM §11.7 #12, ai-pipeline-engineer) — the columns themselves disappear in ⑭.

revoke select (desired_job_title, total_years_of_experience, interested_industries)
  on table public.profiles from app_ai_writer;

-- Belt and braces: never let a future whole-table grant leak the 내 정보 columns by accident.
revoke select (job_search_status, interested_company_type, interested_industry,
               highest_education_school_name, highest_education_degree, highest_education_status,
               highest_education_start_month, highest_education_end_month,
               highest_education_major, highest_education_gpa, display_name)
  on table public.profiles from app_ai_writer;

revoke all on table public.profile_job_interests from app_ai_writer;
revoke all on table public.profile_options from app_ai_writer;
