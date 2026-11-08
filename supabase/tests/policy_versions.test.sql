-- S1 policy_versions: public read, no writes (DM A.2).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select ok((select relrowsecurity from pg_class where oid = 'public.policy_versions'::regclass),
          'RLS enabled on policy_versions');
select is((select count(*)::int from public.policy_versions), 17, 'placeholder + 2026-11-04 + cross-border 2026-11-04.1 + 2026-11-05 + ai_data_use + privacy·ai_data_use 2026-11-08 + terms·cross_border_transfer 2026-11-08 + privacy·ai_data_use 2026-11-08.1 (R14) versions seeded');

set local role anon;
select is((select count(*)::int from public.policy_versions), 17, 'anon can read policy_versions');
select throws_ok($$insert into public.policy_versions (policy_type, version, effective_at, document_path)
                   values ('terms', 'x', now(), '/x')$$, '42501', null, 'anon cannot insert');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.policy_versions), 17, 'authenticated can read policy_versions');
select throws_ok($$update public.policy_versions set requires_reconsent = false$$, '42501', null,
                 'authenticated cannot update');

reset role;
select throws_ok($$insert into public.policy_versions (policy_type, version, effective_at, document_path)
                   values ('cookies', 'x', now(), '/x')$$, '23514', null, 'policy_type CHECK enforced');

select * from finish();
rollback;
