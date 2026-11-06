-- R13 private.compute_total_experience_months + the public wrapper (DM v4.12 §6.2; AI C-1; R-SD-23).
-- Month union with both ends inclusive, is_current to p_as_of, open-ended excluded and counted, draft excluded,
-- the same complete definition the context pack uses, user isolation, and no default for p_as_of.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

select is((select prosecdef from pg_proc
            where oid = 'private.compute_total_experience_months(uuid, date)'::regprocedure), true,
          'private function is security definer');
select is((select provolatile::text from pg_proc
            where oid = 'private.compute_total_experience_months(uuid, date)'::regprocedure), 's',
          'stable');
-- R-SD-23: p_as_of must be a required argument, on both the private function and the wrapper.
select is((select pronargdefaults::int from pg_proc
            where oid = 'private.compute_total_experience_months(uuid, date)'::regprocedure), 0,
          'p_as_of has no default (private)');
select is((select pronargdefaults::int from pg_proc
            where oid = 'public.compute_total_experience_months(date)'::regprocedure), 0,
          'p_as_of has no default (public wrapper)');
select ok(has_function_privilege('app_ai_writer', 'private.compute_total_experience_months(uuid, date)', 'execute')
          and has_function_privilege('authenticated', 'private.compute_total_experience_months(uuid, date)', 'execute'),
          'app_ai_writer and authenticated can execute the private function');
select ok(has_function_privilege('app_ai_writer', 'public.compute_total_experience_months(date)', 'execute')
          and has_function_privilege('authenticated', 'public.compute_total_experience_months(date)', 'execute'),
          'app_ai_writer and authenticated can execute the wrapper');
select ok(not has_function_privilege('anon', 'public.compute_total_experience_months(date)', 'execute'),
          'anon cannot call the wrapper');

-- ── fixture (A) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- E1 2023-01 ~ 2023-12 (12 months)
insert into public.experiences (id, company_name, start_month, end_month, job_rank) values
  ('a0000000-1111-0000-0000-000000000001', 'A사', '2023-01-01', '2023-12-01', 'S'),
-- E2 2023-10 ~ 2024-03: overlaps E1 by 3 months, adds 3 (union)
  ('a0000000-1111-0000-0000-000000000002', 'B사', '2023-10-01', '2024-03-01', 'S'),
-- E3 재직 중: counted up to the month of p_as_of
  ('a0000000-1111-0000-0000-000000000003', 'C사', '2026-10-01', null, 'S'),
-- E4 종료월 미입력(진행 중 아님): excluded from the total, counted in open_ended_experience_count
  ('a0000000-1111-0000-0000-000000000004', 'D사', '2015-01-01', null, 'S');
update public.experiences set is_current = true where id = 'a0000000-1111-0000-0000-000000000003';
-- E5 draft (no job_rank / job_position): never counted
insert into public.experiences (id, company_name, start_month, end_month) values
  ('a0000000-1111-0000-0000-000000000005', 'E사', '2010-01-01', '2012-12-01');
select is((select status from public.experiences where id = 'a0000000-1111-0000-0000-000000000005'), 'draft',
          'fixture: E5 is draft');
reset role;
-- B's experience must never be counted for A (inserted as owner)
insert into public.experiences (id, user_id, company_name, start_month, end_month, job_rank) values
  ('b0000000-1111-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'Z사',
   '2000-01-01', '2009-12-01', 'S');

-- 12 (E1) + 3 (E2's 2024-01..03) + 2 (E3's 2026-10, 2026-11) = 17, open ended 1 (E4)
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select results_eq($$select total_months, open_ended_experience_count, as_of_month
                      from private.compute_total_experience_months(
                        'a0000000-0000-0000-0000-000000000001', '2026-11-20')$$,
                  $$values (17, 1, '2026-11-01'::date)$$,
                  'month union, both ends inclusive, is_current to p_as_of, open-ended excluded + counted');
select results_eq($$select total_months, open_ended_experience_count, as_of_month
                      from public.compute_total_experience_months('2026-11-20')$$,
                  $$values (17, 1, '2026-11-01'::date)$$,
                  'the wrapper returns the same for the caller');
-- a later as_of adds the months of the ongoing experience
select is((select total_months from public.compute_total_experience_months('2027-01-05')), 19,
          'is_current grows with p_as_of (2 more months)');
select throws_ok($$select * from private.compute_total_experience_months(
                    'b0000000-0000-0000-0000-000000000002', '2026-11-20')$$,
                 '42501', 'not_authorized', 'A cannot compute B''s number');
select is((select total_months from public.compute_total_experience_months('2026-11-20')), 17,
          'A''s own number does not include B''s experience');
select throws_ok($$select * from private.compute_total_experience_months(
                    'a0000000-0000-0000-0000-000000000001', null)$$,
                 '22004', null, 'p_as_of null is refused');
reset role;

-- same complete definition as the pack: E1 back to draft removes only its exclusive months (9)
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
update public.experiences set job_rank = null, job_position = null
 where id = 'a0000000-1111-0000-0000-000000000001';
select is((select status from public.experiences where id = 'a0000000-1111-0000-0000-000000000001'), 'draft',
          'E1 fell back to draft');
select is((select total_months from public.compute_total_experience_months('2026-11-20')), 8,
          'a draft experience drops out of the total (same complete filter as the pack)');

-- app_ai_writer path: the role token carries the user id as sub
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is((select total_months from public.compute_total_experience_months('2026-11-20')), 8,
          'app_ai_writer gets the JWT user''s number through the wrapper');
select throws_ok($$select * from private.compute_total_experience_months(
                    'b0000000-0000-0000-0000-000000000002', '2026-11-20')$$,
                 '42501', 'not_authorized', 'app_ai_writer cannot compute another user''s number');
reset role;

-- a user with no experience
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select results_eq($$select total_months, open_ended_experience_count
                      from public.compute_total_experience_months('2026-11-20')$$,
                  $$values (120, 0)$$, 'B: 2000-01 ~ 2009-12 = 120 months, no open-ended');
reset role;

select * from finish();
rollback;
