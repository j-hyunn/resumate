-- Inactive account deletion (privacy policy 2026-11-04: 1 year without access -> notice 30 days before -> delete;
-- a sign-in in between keeps the account). touch_last_active, notice targets / mark, due list, purge (same scope as
-- delete_account, reason 'inactivity'), incomplete deletions list, argument errors, privileges.
-- Assertions filter on this test's users: the shared local DB may hold rows from integration test runs.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- p_now used throughout: 2027-11-15 12:00 KST. 1 year before = 2026-11-15, 1 year - 30 days before = 2026-12-15.
create temp table t_now as select '2027-11-15 12:00:00+09'::timestamptz as v;
grant select on t_now to service_role, authenticated;

insert into auth.users (id, email, aud, role, last_sign_in_at) values
  -- notice target: last access 2026-12-14
  ('a1000000-0000-0000-0000-00000000000a', 'inact-a@example.test', 'authenticated', 'authenticated', null),
  -- too recent for a notice: last access 2026-12-20
  ('b1000000-0000-0000-0000-00000000000b', 'inact-b@example.test', 'authenticated', 'authenticated', null),
  -- due: noticed 2027-10-10, last access 2026-11-01
  ('c1000000-0000-0000-0000-00000000000c', 'inact-c@example.test', 'authenticated', 'authenticated', null),
  -- noticed only 26 days ago: not due yet
  ('d1000000-0000-0000-0000-00000000000d', 'inact-d@example.test', 'authenticated', 'authenticated', null),
  -- noticed 45 days ago but last access 2026-11-20 (< 1 year): not due yet
  ('e1000000-0000-0000-0000-00000000000e', 'inact-e@example.test', 'authenticated', 'authenticated', null),
  -- never active, created 2026-12-01, no e-mail: skipped for notices
  ('f1000000-0000-0000-0000-00000000000f', null, 'authenticated', 'authenticated', null);

update public.profiles set created_at = '2026-10-01 00:00:00+09', last_active_at = '2026-12-14 12:00:00+09'
 where id = 'a1000000-0000-0000-0000-00000000000a';
update public.profiles set created_at = '2026-10-01 00:00:00+09', last_active_at = '2026-12-20 12:00:00+09'
 where id = 'b1000000-0000-0000-0000-00000000000b';
update public.profiles set created_at = '2026-10-01 00:00:00+09', last_active_at = '2026-11-01 12:00:00+09',
                           inactivity_notice_sent_at = '2027-10-10 12:00:00+09'
 where id = 'c1000000-0000-0000-0000-00000000000c';
update public.profiles set created_at = '2026-10-01 00:00:00+09', last_active_at = '2026-10-15 12:00:00+09',
                           inactivity_notice_sent_at = '2027-10-20 12:00:00+09'
 where id = 'd1000000-0000-0000-0000-00000000000d';
update public.profiles set created_at = '2026-10-01 00:00:00+09', last_active_at = '2026-11-20 12:00:00+09',
                           inactivity_notice_sent_at = '2027-10-01 12:00:00+09'
 where id = 'e1000000-0000-0000-0000-00000000000e';
update public.profiles set created_at = '2026-12-01 00:00:00+09', last_active_at = null
 where id = 'f1000000-0000-0000-0000-00000000000f';

-- Some data for C (the due account) and B (kept).
insert into public.experiences (id, user_id, company_name) values
  ('c1000000-1111-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000c', 'C corp'),
  ('b1000000-1111-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000b', 'B corp');
insert into public.application_projects (id, user_id, name, name_source) values
  ('c1000000-aaaa-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000c', 'C app', 'user');

-- ── functions exist, definer, privileges ──
select has_function('private', 'delete_account_data', array['uuid', 'text', 'text'], 'shared deletion body exists');
select set_eq(
  $$select p.proname::text || ':' || r.rolname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated'), ('app_ai_writer'), ('app_key_reader'), ('service_role')) r (rolname)
     where n.nspname = 'public'
       and p.proname in ('touch_last_active', 'list_inactivity_notice_targets', 'mark_inactivity_notice_sent',
                         'list_inactive_accounts_due', 'purge_inactive_account', 'list_incomplete_account_deletions')
       and has_function_privilege(r.rolname, p.oid, 'execute')$$,
  array['touch_last_active:authenticated', 'touch_last_active:service_role',
        'list_inactivity_notice_targets:service_role', 'mark_inactivity_notice_sent:service_role',
        'list_inactive_accounts_due:service_role', 'purge_inactive_account:service_role',
        'list_incomplete_account_deletions:service_role'],
  'touch_last_active: authenticated; cron RPCs: service_role only');
select is_empty($$select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where (n.nspname, p.proname) in (('public', 'touch_last_active'), ('public', 'list_inactivity_notice_targets'),
                          ('public', 'mark_inactivity_notice_sent'), ('public', 'list_inactive_accounts_due'),
                          ('public', 'purge_inactive_account'), ('public', 'list_incomplete_account_deletions'),
                          ('private', 'delete_account_data'))
                     and not p.prosecdef$$,
                'all new functions are security definer');
select ok(not has_function_privilege('authenticated', 'private.delete_account_data(uuid, text, text)', 'execute'),
          'users cannot call the deletion body directly');

-- ── notice targets ──
set local role service_role;
select set_eq(
  $$select user_id from public.list_inactivity_notice_targets((select v from t_now))
     where user_id::text like '_1000000-0000-0000-0000-%'$$,
  array['a1000000-0000-0000-0000-00000000000a'::uuid],
  'only A: 1 year - 30 days without access, not yet told, has an e-mail');
select is((select email from public.list_inactivity_notice_targets((select v from t_now))
            where user_id = 'a1000000-0000-0000-0000-00000000000a'),
          'inact-a@example.test', 'target row carries the Auth e-mail');
select is((select count(*)::int from public.list_inactivity_notice_targets((select v from t_now) + interval '1 year')
            where user_id = 'f1000000-0000-0000-0000-00000000000f'),
          0, 'an account without an e-mail is never a notice target');
select is((select count(*)::int from public.list_inactivity_notice_targets((select v from t_now) + interval '6 days')
            where user_id = 'b1000000-0000-0000-0000-00000000000b'),
          1, 'B becomes a target once 1 year - 30 days have passed');
select is((select count(*)::int from public.list_inactivity_notice_targets((select v from t_now), 1)), 1, 'p_limit caps rows');

-- ── mark ──
select is(public.mark_inactivity_notice_sent('b1000000-0000-0000-0000-00000000000b', (select v from t_now)), false,
          'B is not marked: not inactive long enough');
select is(public.mark_inactivity_notice_sent('a1000000-0000-0000-0000-00000000000a', (select v from t_now)), true,
          'A is marked');
select is(public.mark_inactivity_notice_sent('a1000000-0000-0000-0000-00000000000a', (select v from t_now)), false,
          'marking twice is a no-op');
reset role;
select is((select inactivity_notice_sent_at from public.profiles where id = 'a1000000-0000-0000-0000-00000000000a'),
          (select v from t_now), 'A inactivity_notice_sent_at = send time');
select is((select inactivity_notice_sent_at from public.profiles where id = 'b1000000-0000-0000-0000-00000000000b'),
          null, 'B untouched');

-- ── due list ──
set local role service_role;
select set_eq(
  $$select user_id from public.list_inactive_accounts_due((select v from t_now))
     where user_id::text like '_1000000-0000-0000-0000-%'$$,
  array['c1000000-0000-0000-0000-00000000000c'::uuid],
  'only C is due: noticed >= 30 days ago and 1 year without access');
select is((select count(*)::int from public.list_inactive_accounts_due((select v from t_now) + interval '30 days')
            where user_id = 'a1000000-0000-0000-0000-00000000000a'),
          1, 'A is due 30 days after its notice');

-- ── purge ──
select is(public.purge_inactive_account('d1000000-0000-0000-0000-00000000000d', repeat('d', 64), (select v from t_now)),
          null, 'D not due yet: purge returns null');
select is(public.purge_inactive_account('e1000000-0000-0000-0000-00000000000e', repeat('e', 64), (select v from t_now)),
          null, 'E not due yet (< 1 year since last access): purge returns null');
select is((public.purge_inactive_account('c1000000-0000-0000-0000-00000000000c', repeat('c', 64), (select v from t_now))
            ->> 'deleted'), 'true', 'C purged');
select is(public.purge_inactive_account('c1000000-0000-0000-0000-00000000000c', repeat('c', 64), (select v from t_now)),
          null, 'purging again: already gone, null');
reset role;

select is((select count(*)::int from public.profiles where id = 'c1000000-0000-0000-0000-00000000000c'), 0, 'C profile deleted');
select is((select count(*)::int from public.experiences where user_id = 'c1000000-0000-0000-0000-00000000000c'), 0, 'C career deleted');
select is((select count(*)::int from public.application_projects where user_id = 'c1000000-0000-0000-0000-00000000000c'), 0,
          'C application projects deleted');
select is((select reason from public.account_deletion_logs where subject_hash = repeat('c', 64)), 'inactivity',
          'deletion log reason = inactivity');
select is((select count(*)::int from public.profiles where id in ('d1000000-0000-0000-0000-00000000000d',
                                                               'e1000000-0000-0000-0000-00000000000e')), 2,
          'D and E kept');
select is((select count(*)::int from public.experiences where user_id = 'b1000000-0000-0000-0000-00000000000b'), 1,
          'other users data kept');

-- ── incomplete deletions (Auth user left behind) ──
set local role service_role;
select ok('c1000000-0000-0000-0000-00000000000c'::uuid in (select user_id from public.list_incomplete_account_deletions(1000)),
          'C (no profile, Auth user still there) is listed for Auth cleanup');
select ok('a1000000-0000-0000-0000-00000000000a'::uuid not in (select user_id from public.list_incomplete_account_deletions(1000)),
          'accounts with a profile are not listed');
reset role;

-- ── sign-in cancels the notice ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select is(public.touch_last_active(), true, 'touch writes when a notice is pending');
select is(public.touch_last_active(), false, 'second touch within an hour does not write');
reset role;
select is((select inactivity_notice_sent_at from public.profiles where id = 'a1000000-0000-0000-0000-00000000000a'),
          null, 'touch cleared the notice');
select ok((select last_active_at from public.profiles where id = 'a1000000-0000-0000-0000-00000000000a') >= now() - interval '1 minute',
          'touch set last_active_at to now');
set local role service_role;
select is((select count(*)::int from public.list_inactive_accounts_due((select v from t_now) + interval '60 days')
            where user_id = 'a1000000-0000-0000-0000-00000000000a'),
          0, 'A is no longer due after signing in');
reset role;

-- touch only touches the caller's row; nothing without a user
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-00000000000f","role":"authenticated"}';
select is(public.touch_last_active(), true, 'F touch (never active) writes');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.touch_last_active()$$, '42501', 'not_authenticated', 'touch needs a user');
select throws_ok($$select public.list_inactive_accounts_due(now())$$, '42501', null, 'users cannot list due accounts');
select throws_ok($$select public.purge_inactive_account('b1000000-0000-0000-0000-00000000000b', repeat('b', 64), now())$$,
                 '42501', null, 'users cannot purge');
reset role;
select is((select last_active_at from public.profiles where id = 'd1000000-0000-0000-0000-00000000000d'),
          '2026-10-15 12:00:00+09'::timestamptz, 'other rows untouched by touch');

-- ── argument errors ──
set local role service_role;
select throws_ok($$select * from public.list_inactivity_notice_targets(null)$$, 'P0001', 'invalid_now', 'targets: p_now null');
select throws_ok($$select * from public.list_inactivity_notice_targets(now(), 0)$$, 'P0001', 'invalid_limit', 'targets: p_limit 0');
select throws_ok($$select * from public.list_inactive_accounts_due(now(), 1001)$$, 'P0001', 'invalid_limit', 'due: p_limit 1001');
select throws_ok($$select public.mark_inactivity_notice_sent(null, now())$$, 'P0001', 'invalid_user_id', 'mark: user null');
select throws_ok($$select public.purge_inactive_account('d1000000-0000-0000-0000-00000000000d', 'x', now())$$,
                 'P0001', 'invalid_subject_hash', 'purge: bad hash');
select throws_ok($$select * from public.list_incomplete_account_deletions(null)$$, 'P0001', 'invalid_limit', 'incomplete: p_limit null');
reset role;
select throws_ok($$select private.delete_account_data('d1000000-0000-0000-0000-00000000000d', repeat('d', 64), 'other')$$,
                 'P0001', 'invalid_reason', 'deletion body: unknown reason');

-- ── delete_account keeps reason user_request ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select is((public.delete_account(repeat('9', 64)) ->> 'deleted'), 'true', 'delete_account still works');
reset role;
select is((select reason from public.account_deletion_logs where subject_hash = repeat('9', 64)), 'user_request',
          'delete_account logs user_request');

select * from finish();
rollback;
