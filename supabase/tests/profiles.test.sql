-- S1 profiles: sign-up trigger, RLS isolation, column grants, app_ai_writer limits (DM A.1, §5).
begin;
create extension if not exists pgtap with schema extensions;
-- pgTAP lives in `extensions`; let the AI role call it inside this rolled-back test only.
grant usage on schema extensions to app_ai_writer;
select plan(22);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

select is((select count(*)::int from public.profiles
            where id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002')),
          2, 'sign-up trigger creates one profile per auth user');

select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'RLS enabled on profiles');
select policies_are('public', 'profiles',
  array['profiles_select_own', 'profiles_update_own', 'profiles_select_ai_writer']);

update public.profiles set display_name = 'B secret', career_data_updated_at = '2026-01-01'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- user A
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is((select count(*)::int from public.profiles), 1, 'A sees only own profile');
select is((select id from public.profiles), 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'the visible profile is A''s');

select lives_ok($$update public.profiles set display_name = 'A', desired_job_title = 'PM',
                    total_years_of_experience = 5, interested_industries = '{fintech}'
                   where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
                'A can update the 4 editable fields');
select is((select desired_job_title from public.profiles), 'PM', 'A update applied');

update public.profiles set display_name = 'hacked' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select throws_ok($$update public.profiles set career_data_updated_at = now()
                    where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
                 '42501', null, 'A cannot update career_data_updated_at');
select throws_ok($$update public.profiles set last_active_at = now()
                    where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
                 '42501', null, 'A cannot update last_active_at');
select throws_ok($$insert into public.profiles (id) values ('cccccccc-0000-0000-0000-000000000003')$$,
                 '42501', null, 'A cannot insert profiles');
select throws_ok($$delete from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
                 '42501', null, 'A cannot delete profiles');
select throws_ok($$update public.profiles set display_name = repeat('x', 51)
                    where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
                 '23514', null, 'display_name ≤ 50 enforced');

-- anon
reset role;
set local role anon;
select throws_ok($$select id from public.profiles$$, '42501', null, 'anon cannot read profiles');

-- app_ai_writer acting for A
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is((select count(*)::int from public.profiles), 1, 'app_ai_writer sees only the JWT user''s profile');
select throws_ok($$select display_name from public.profiles$$, '42501', null,
                 'app_ai_writer cannot read display_name');
select throws_ok($$update public.profiles set desired_job_title = 'x'$$, '42501', null,
                 'app_ai_writer cannot update profiles');

reset role;
select is((select display_name from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
          'B secret', 'A''s update on B''s row had no effect');

-- QA-03: real sign-up path runs as supabase_auth_admin, which postgres cannot SET ROLE to in
-- tests. Assert the properties that make the trigger work for any inserting role instead.
select trigger_is('auth', 'users', 'on_auth_user_created', 'private', 'handle_new_user',
                  'sign-up trigger is attached to auth.users');
select ok((select prosecdef from pg_proc where oid = 'private.handle_new_user()'::regprocedure),
          'handle_new_user is security definer (independent of the inserting role)');
select is((select proconfig from pg_proc where oid = 'private.handle_new_user()'::regprocedure),
          array['search_path=""'], 'handle_new_user pins search_path');
select is((select pg_get_userbyid(proowner) from pg_proc where oid = 'private.handle_new_user()'::regprocedure),
          'postgres', 'handle_new_user is owned by postgres (can insert into profiles)');
select ok((select tgenabled = 'O' from pg_trigger where tgname = 'on_auth_user_created'),
          'sign-up trigger is enabled');

select * from finish();
rollback;
