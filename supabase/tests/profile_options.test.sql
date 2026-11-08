-- R13 profile_options (DM v4.12 §2.1.1 DM-22, §5; PRD 9.7 seed).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

-- structure
select has_table('public', 'profile_options', 'profile_options exists');
select col_is_pk('public', 'profile_options', array['category', 'code'], 'PK (category, code)');
select has_index('public', 'profile_options', 'profile_options_category_sort_order_idx', 'index (category, sort_order)');
select ok((select relrowsecurity from pg_class where oid = 'public.profile_options'::regclass),
          'RLS enabled on profile_options');
select policies_are('public', 'profile_options', array['profile_options_select_all']);

-- the 7 categories are fixed by CHECK, the values are rows
select set_eq($$select distinct category from public.profile_options$$,
  array['job_search_status', 'company_type', 'industry', 'job_family', 'job_role', 'degree',
        'graduation_status'],
  'seeded categories = the 7 of the CHECK list');
select throws_ok($$insert into public.profile_options (category, code, label, sort_order)
                   values ('nope', 'x', 'x', 1)$$,
                 '23514', null, 'an unknown category is refused by the CHECK');

-- seed counts (PRD 9.7): 7 / 9 / 11 / 8 / 52 / 8 / 6
select results_eq($$select category, count(*)::int from public.profile_options group by category
                     order by category$$,
  $$values ('company_type', 9), ('degree', 8), ('graduation_status', 6), ('industry', 11),
           ('job_family', 8), ('job_role', 52), ('job_search_status', 7)$$,
  'seed counts per category');
select ok((select bool_and(is_active) from public.profile_options), 'every seeded value starts active');
select ok((select bool_and(parent_code is null) from public.profile_options where category <> 'job_role')
          and (select bool_and(parent_code is not null) from public.profile_options where category = 'job_role'),
          'parent_code only on job_role, and always there');
select is_empty($$select r.code from public.profile_options r
                   where r.category = 'job_role'
                     and not exists (select 1 from public.profile_options f
                                      where f.category = 'job_family' and f.code = r.parent_code)$$,
                'every job_role parent_code is a job_family code');
-- a few confirmed code keys (라벨 → 코드 매핑 표는 마이그레이션 20261113001500 주석)
select results_eq($$select code from public.profile_options where category = 'industry' and sort_order in (1, 2)
                     order by sort_order$$,
                  $$values ('it_software_platform'), ('b2b_saas')$$, 'industry codes 1-2');
select is((select label from public.profile_options where category = 'degree' and code = 'bachelor'),
          '학사', 'degree bachelor label');

-- RLS: authenticated reads everything, writes refused; anon reads nothing
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.profile_options), 101, 'authenticated reads every option row');
select throws_ok($$insert into public.profile_options (category, code, label, sort_order)
                   values ('degree', 'zzz', 'Z', 99)$$,
                 '42501', null, 'authenticated cannot insert options (operator only)');
select throws_ok($$update public.profile_options set label = 'x' where category = 'degree'$$,
                 '42501', null, 'authenticated cannot update options');
select throws_ok($$delete from public.profile_options where category = 'degree'$$,
                 '42501', null, 'authenticated cannot delete options');
reset role;
set local role anon;
select throws_ok($$select code from public.profile_options$$, '42501', null, 'anon cannot read options');
reset role;

-- SD-6: the AI role has no access at all
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select code from public.profile_options$$, '42501', null,
                 'app_ai_writer cannot read profile_options (SD-6)');
reset role;

select * from finish();
rollback;
