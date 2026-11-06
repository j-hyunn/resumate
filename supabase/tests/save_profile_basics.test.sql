-- R13 save_profile_basics (DM v4.12 §2.1.1, §2.1.2, §7; SD-A2, R-SD-18): happy path, section-wide overwrite,
-- pair overwrite, and each of the 6 error codes.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

select is((select prosecdef from pg_proc
            where oid = 'public.save_profile_basics(jsonb, jsonb, timestamptz)'::regprocedure), false,
          'security invoker');
select ok(has_function_privilege('authenticated',
            'public.save_profile_basics(jsonb, jsonb, timestamptz)', 'execute'), 'authenticated can call');
select ok(not has_function_privilege('anon',
            'public.save_profile_basics(jsonb, jsonb, timestamptz)', 'execute'), 'anon cannot call');
select ok(not has_function_privilege('app_ai_writer',
            'public.save_profile_basics(jsonb, jsonb, timestamptz)', 'execute'),
          'app_ai_writer cannot call (SD-6)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- happy path: every field + two pairs
create temp table t_r as select public.save_profile_basics(
  '{"display_name": "제현", "job_search_status": "employed_considering",
    "interested_company_type": "startup_seed_series_a", "interested_industry": "b2b_saas",
    "highest_education_school_name": "한국대학교", "highest_education_degree": "bachelor",
    "highest_education_status": "graduated", "highest_education_start_month": "2016-03",
    "highest_education_end_month": "2020-02", "highest_education_major": "컴퓨터공학",
    "highest_education_gpa": "3.8/4.5"}'::jsonb,
  '[{"job_family": "engineering", "job_role": "backend"}, {"job_family": "data_ai"}]'::jsonb,
  null) as r;

select set_eq($$select jsonb_object_keys(r) from t_r$$, array['updated_at'], 'response is { updated_at }');
select is((select (r ->> 'updated_at')::timestamptz from t_r),
          (select updated_at from public.profiles where id = 'a0000000-0000-0000-0000-000000000001'),
          'the returned updated_at is the row''s new version');
select results_eq($$select display_name, job_search_status, interested_company_type, interested_industry,
                           highest_education_school_name, highest_education_degree, highest_education_status,
                           highest_education_start_month, highest_education_end_month,
                           highest_education_major, highest_education_gpa
                      from public.profiles where id = 'a0000000-0000-0000-0000-000000000001'$$,
  $$values ('제현', 'employed_considering', 'startup_seed_series_a', 'b2b_saas', '한국대학교', 'bachelor',
            'graduated', '2016-03-01'::date, '2020-02-01'::date, '컴퓨터공학', '3.8/4.5')$$,
  'every 내 정보 column stored');
select results_eq($$select sort_order, job_family, job_role from public.profile_job_interests
                     order by sort_order$$,
  $$values (1::smallint, 'engineering', 'backend'), (2::smallint, 'data_ai', null::text)$$,
  'pairs stored with sort_order 1..n');

-- 섹션 전체 덮어쓰기 [가정]: a key that is absent is emptied, and the pair list is replaced whole
select lives_ok($$select public.save_profile_basics('{"display_name": "제현"}'::jsonb, '[]'::jsonb, null)$$,
                'saving the section again with only display_name');
select is((select num_nonnulls(job_search_status, interested_company_type, interested_industry,
                               highest_education_school_name, highest_education_degree,
                               highest_education_status, highest_education_start_month,
                               highest_education_end_month, highest_education_major, highest_education_gpa)
             from public.profiles where id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'absent keys are written as null (section-wide overwrite)');
select is((select count(*)::int from public.profile_job_interests), 0, 'an empty list clears the pairs');
select is((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000001'),
          '제현', 'display_name kept');

-- 1. stale_write (409)
select throws_ok($$select public.save_profile_basics('{}'::jsonb, '[]'::jsonb, '2020-01-01 00:00+00')$$,
                 'P0001', 'stale_write', 'stale_write when p_expected_updated_at differs');
select lives_ok($$select public.save_profile_basics('{}'::jsonb, '[]'::jsonb,
                   (select updated_at from public.profiles
                     where id = 'a0000000-0000-0000-0000-000000000001'))$$,
                'the current updated_at passes');

-- 2. invalid_profile_option (400) — from the ④ trigger
select throws_ok($$select public.save_profile_basics('{"job_search_status": "nope"}'::jsonb, '[]'::jsonb, null)$$,
                 'P0001', 'invalid_profile_option', 'an unknown option code');
select throws_ok($$select public.save_profile_basics('{}'::jsonb,
                     '[{"job_family": "engineering", "job_role": "ux_ui_design"}]'::jsonb, null)$$,
                 'P0001', 'invalid_profile_option', 'a job_role outside its job_family');
select throws_ok($$select public.save_profile_basics('{}'::jsonb, '[{"job_role": "backend"}]'::jsonb, null)$$,
                 'P0001', 'invalid_profile_option', 'a pair without job_family');

-- 3. field_too_long (400)
select throws_ok($$select public.save_profile_basics(
                     jsonb_build_object('highest_education_school_name', repeat('x', 101)), '[]'::jsonb, null)$$,
                 'P0001', 'field_too_long', 'school name over 100');
select throws_ok($$select public.save_profile_basics(
                     jsonb_build_object('highest_education_gpa', repeat('x', 21)), '[]'::jsonb, null)$$,
                 'P0001', 'field_too_long', 'gpa over 20');
select throws_ok($$select public.save_profile_basics(
                     jsonb_build_object('display_name', repeat('x', 51)), '[]'::jsonb, null)$$,
                 'P0001', 'field_too_long', 'display_name over 50');

-- 4. invalid_period (400)
select throws_ok($$select public.save_profile_basics(
                     '{"highest_education_start_month": "2020-03", "highest_education_end_month": "2019-03"}'::jsonb,
                     '[]'::jsonb, null)$$,
                 'P0001', 'invalid_period', 'end month before start month');
select throws_ok($$select public.save_profile_basics(
                     '{"highest_education_start_month": "2020-3"}'::jsonb, '[]'::jsonb, null)$$,
                 'P0001', 'invalid_period', 'a month that is not YYYY-MM');
select lives_ok($$select public.save_profile_basics(
                    '{"highest_education_start_month": "2020-03", "highest_education_status": "enrolled"}'::jsonb,
                    '[]'::jsonb, null)$$,
                '재학 중이면 종료월을 비울 수 있다 (상태와 교차 검증하지 않는다)');

-- 5. too_many_job_interests (400) — 3쌍 이상 (상한 2쌍, SD-Q3 (가))
select throws_ok($$select public.save_profile_basics('{}'::jsonb,
                     '[{"job_family": "engineering"}, {"job_family": "data_ai"}, {"job_family": "design"}]'::jsonb,
                     null)$$,
                 'P0001', 'too_many_job_interests', 'three pairs are refused');

-- 6. duplicate_job_interest (400) — 직무를 비운 쌍끼리도 중복
select throws_ok($$select public.save_profile_basics('{}'::jsonb,
                     '[{"job_family": "engineering", "job_role": "backend"},
                       {"job_family": "engineering", "job_role": "backend"}]'::jsonb, null)$$,
                 'P0001', 'duplicate_job_interest', 'the same pair twice');
select throws_ok($$select public.save_profile_basics('{}'::jsonb,
                     '[{"job_family": "engineering"}, {"job_family": "engineering", "job_role": null}]'::jsonb,
                     null)$$,
                 'P0001', 'duplicate_job_interest', 'same job_family with an empty job_role twice');
select lives_ok($$select public.save_profile_basics('{}'::jsonb,
                    '[{"job_family": "engineering"}, {"job_family": "engineering", "job_role": "backend"}]'::jsonb,
                    null)$$,
                'family-only and family+role are different pairs');

-- the raise detail carries the duplicate pair's 1-based position (요청 R13-API-4)
create function pg_temp.dup_detail() returns text language plpgsql as $f$
declare
  v_detail text;
begin
  perform public.save_profile_basics('{}'::jsonb,
    '[{"job_family": "engineering"}, {"job_family": "data_ai"}]'::jsonb, null);
  perform public.save_profile_basics('{}'::jsonb,
    '[{"job_family": "design"}, {"job_family": "design"}]'::jsonb, null);
  return 'no error';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlerrm || '|' || coalesce(v_detail, '');
end;
$f$;
select is(pg_temp.dup_detail(), 'duplicate_job_interest|2',
          'duplicate_job_interest detail = the 1-based position of the repeated pair');

-- a failed save leaves nothing behind (one transaction)
select is((select count(*)::int from public.profile_job_interests), 2, 'the last successful save is what is stored');

-- UI-42 (DM 2.1.1): a retired code (is_active = false) is rejected only when newly chosen. Pairs are rewritten
-- with delete -> insert, so the RPC hands the trigger the codes the user already held.
select lives_ok($$select public.save_profile_basics('{}'::jsonb,
                    '[{"job_family": "engineering", "job_role": "backend"}]'::jsonb, null)$$,
                'save a pair with an active role');
reset role;
update public.profile_options set is_active = false
 where (category = 'job_role' and code = 'backend') or (category = 'job_family' and code = 'design');
set local role authenticated;
select lives_ok($$select public.save_profile_basics('{}'::jsonb,
                    '[{"job_family": "engineering", "job_role": "backend"}]'::jsonb, null)$$,
                'a retired role the user already had can be saved again');
select lives_ok($$select public.save_profile_basics('{}'::jsonb,
                    '[{"job_family": "data_ai"}, {"job_family": "engineering", "job_role": "backend"}]'::jsonb, null)$$,
                'it survives moving to another position');
select throws_ok($$select public.save_profile_basics('{}'::jsonb,
                     '[{"job_family": "design"}]'::jsonb, null)$$,
                 'P0001', 'invalid_profile_option', 'a retired family the user did not have is rejected');
select lives_ok($$select public.save_profile_basics('{}'::jsonb,
                    '[{"job_family": "data_ai"}]'::jsonb, null)$$,
                'dropping the retired pair');
select throws_ok($$select public.save_profile_basics('{}'::jsonb,
                     '[{"job_family": "engineering", "job_role": "backend"}]'::jsonb, null)$$,
                 'P0001', 'invalid_profile_option', 'once dropped, the retired role counts as newly chosen');
select is(current_setting('resumate.held_job_codes', true) is not null, true,
          'the held-codes hint is transaction-local (set by the RPC)');
reset role;
update public.profile_options set is_active = true
 where (category = 'job_role' and code = 'backend') or (category = 'job_family' and code = 'design');
set local role authenticated;

set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select public.save_profile_basics('{}'::jsonb, '[]'::jsonb, null)$$,
                 '42501', 'not_authenticated', 'no sub');
reset role;

select * from finish();
rollback;
