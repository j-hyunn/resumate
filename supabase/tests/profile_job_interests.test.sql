-- R13 profile_job_interests + private.validate_profile_options (DM v4.12 §2.1.2, §2.1.1 DM-22; SD-A3, R-SD-18).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

select col_is_pk('public', 'profile_job_interests', array['user_id', 'sort_order'], 'PK (user_id, sort_order)');
select ok((select relrowsecurity from pg_class where oid = 'public.profile_job_interests'::regclass),
          'RLS enabled on profile_job_interests');
select policies_are('public', 'profile_job_interests',
  array['profile_job_interests_select_own', 'profile_job_interests_insert_own',
        'profile_job_interests_delete_own']);
-- R-SD-18: the pair unique must be NULLS NOT DISTINCT, not two partial uniques.
select ok((select pg_get_constraintdef(oid) like '%NULLS NOT DISTINCT%'
            from pg_constraint where conname = 'profile_job_interests_pair_key'),
          'pair unique is NULLS NOT DISTINCT (R-SD-18)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$insert into public.profile_job_interests (sort_order, job_family, job_role)
                  values (1, 'engineering', 'backend')$$, 'a valid pair is stored');
select lives_ok($$insert into public.profile_job_interests (sort_order, job_family, job_role)
                  values (2, 'data_ai', null)$$, '직군만 고른 쌍도 허용');
select is((select count(*)::int from public.profile_job_interests), 2, 'two pairs stored');

-- 최대 2쌍 (SD-Q3 (가)): the CHECK, not a trigger, stops the third
select throws_ok($$insert into public.profile_job_interests (sort_order, job_family, job_role)
                   values (3, 'design', 'ux_ui_design')$$,
                 '23514', null, 'a third pair is refused (sort_order between 1 and 2)');

-- 같은 직군 + 직무 null 두 행 거부 (NULLS NOT DISTINCT)
delete from public.profile_job_interests where sort_order = 2;
select lives_ok($$insert into public.profile_job_interests (sort_order, job_family, job_role)
                  values (2, 'design', null)$$, 'first design pair without a role');
delete from public.profile_job_interests where sort_order = 2;
insert into public.profile_job_interests (sort_order, job_family, job_role) values (2, 'design', null);
select throws_ok($$update public.profile_job_interests set job_family = 'design', job_role = null
                    where sort_order = 1$$,
                 '42501', null, 'no update grant on the pair list (overwrite only)');
-- insert path: two rows of "same job_family + empty job_role"
delete from public.profile_job_interests;
insert into public.profile_job_interests (sort_order, job_family, job_role) values (1, 'design', null);
select throws_ok($$insert into public.profile_job_interests (sort_order, job_family, job_role)
                   values (2, 'design', null)$$,
                 '23505', null, 'same job_family + empty job_role twice is refused');
select lives_ok($$insert into public.profile_job_interests (sort_order, job_family, job_role)
                  values (2, 'design', 'ux_ui_design')$$,
                'same family with a role is a different pair');
delete from public.profile_job_interests where sort_order = 2;
insert into public.profile_job_interests (sort_order, job_family, job_role) values (2, 'design', 'ux_ui_design');
select throws_ok($$insert into public.profile_job_interests (sort_order, job_family, job_role)
                   values (1, 'design', 'ux_ui_design')$$,
                 '23505', null, 'the very same pair twice is refused');

-- ── validation trigger (DM-22) ──
delete from public.profile_job_interests;
select throws_ok($$insert into public.profile_job_interests (sort_order, job_family) values (1, 'nope')$$,
                 'P0001', 'invalid_profile_option', 'an unknown job_family code is refused');
select throws_ok($$insert into public.profile_job_interests (sort_order, job_family, job_role)
                   values (1, 'engineering', 'ux_ui_design')$$,
                 'P0001', 'invalid_profile_option', 'a job_role of another job_family is refused');
select throws_ok($$insert into public.profile_job_interests (sort_order, job_family, job_role)
                   values (1, 'engineering', 'bachelor')$$,
                 'P0001', 'invalid_profile_option', 'a code from another category is refused');
-- QA-R13-02: the raise detail is the field name on every branch (api maps it to details.field for focus)
create function pg_temp.option_detail(p_sql text) returns text language plpgsql as $f$
declare
  v_detail text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlerrm || '|' || coalesce(v_detail, '');
end;
$f$;
select is(pg_temp.option_detail($q$insert into public.profile_job_interests (sort_order, job_family, job_role)
                                   values (1, 'engineering', 'ux_ui_design')$q$),
          'invalid_profile_option|job_role',
          'the job_family mismatch branch raises detail = job_role (a field name, not a sentence)');
select is(pg_temp.option_detail($q$update public.profiles set highest_education_degree = 'nope'
                                    where id = 'a0000000-0000-0000-0000-000000000001'$q$),
          'invalid_profile_option|highest_education_degree',
          'profiles branches raise detail = the column name');
select throws_ok($$update public.profiles set job_search_status = 'graduated'
                    where id = 'a0000000-0000-0000-0000-000000000001'$$,
                 'P0001', 'invalid_profile_option',
                 'profiles: a code from another category is refused');
select throws_ok($$update public.profiles set interested_industry = 'nope'
                    where id = 'a0000000-0000-0000-0000-000000000001'$$,
                 'P0001', 'invalid_profile_option', 'profiles: an unknown industry code is refused');
reset role;

-- is_active = false: refused as a new choice, passes when the row already holds it
update public.profiles set highest_education_degree = 'mba'
 where id = 'a0000000-0000-0000-0000-000000000001';
update public.profile_options set is_active = false where category = 'degree' and code = 'mba';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$update public.profiles set highest_education_major = '경영학',
                      highest_education_degree = 'mba'
                   where id = 'a0000000-0000-0000-0000-000000000001'$$,
                'an inactive value the row already holds can be saved again');
select lives_ok($$update public.profiles set highest_education_degree = 'mba'
                   where id = 'b0000000-0000-0000-0000-000000000002'$$,
                'B''s row is invisible to A, so the update touches nothing');
reset role;
select is((select highest_education_degree from public.profiles
            where id = 'b0000000-0000-0000-0000-000000000002'), null,
          'B''s profile was not changed (checked as owner)');
update public.profiles set highest_education_degree = null
 where id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$update public.profiles set highest_education_degree = 'mba'
                    where id = 'a0000000-0000-0000-0000-000000000001'$$,
                 'P0001', 'invalid_profile_option', 'choosing an inactive value anew is refused');
reset role;
update public.profile_options set is_active = true where category = 'degree' and code = 'mba';

-- ── isolation ──
insert into public.profile_job_interests (user_id, sort_order, job_family)
  values ('b0000000-0000-0000-0000-000000000002', 1, 'marketing');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.profile_job_interests), 0, 'A does not see B''s pairs');
select throws_ok($$insert into public.profile_job_interests (user_id, sort_order, job_family)
                   values ('b0000000-0000-0000-0000-000000000002', 2, 'design')$$,
                 '42501', null, 'A cannot insert a pair for B');
delete from public.profile_job_interests;
reset role;
select is((select count(*)::int from public.profile_job_interests
            where user_id = 'b0000000-0000-0000-0000-000000000002'), 1, 'B''s pair survived A''s delete');

-- SD-6: the AI role has no access
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select job_family from public.profile_job_interests$$, '42501', null,
                 'app_ai_writer cannot read profile_job_interests (SD-6)');
reset role;

select * from finish();
rollback;
