-- S1 shared triggers and account-deletion cascade (DM-1, DM §0, A.1).
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

-- touch_career_data_updated_at on a stand-in career table (real tables arrive in S2).
create table public.s1_fake_career (id uuid primary key default gen_random_uuid(), user_id uuid not null);
create trigger s1_fake_career_touch after insert or update or delete on public.s1_fake_career
  for each row execute function private.touch_career_data_updated_at();

select is((select career_data_updated_at from public.profiles
            where id = 'aaaaaaaa-0000-0000-0000-000000000001'), null, 'starts null');
insert into public.s1_fake_career (user_id) values ('aaaaaaaa-0000-0000-0000-000000000001');
select isnt((select career_data_updated_at from public.profiles
              where id = 'aaaaaaaa-0000-0000-0000-000000000001'), null, 'career write touches profile');

-- set_updated_at
update public.profiles set updated_at = '2000-01-01', desired_job_title = 'x'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select ok((select updated_at > '2000-01-01' from public.profiles
            where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'set_updated_at overrides updated_at');

-- account deletion cascade
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select * from public.record_consents(
  '[{"consent_type":"terms","agreed":true},{"consent_type":"privacy_required","agreed":true},
    {"consent_type":"cross_border_transfer","agreed":true}]'::jsonb, null);
reset role;
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select count(*)::int from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
          0, 'profile removed with auth user');
select is((select count(*)::int from public.consents where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
          0, 'consents removed with auth user');

select * from finish();
rollback;
