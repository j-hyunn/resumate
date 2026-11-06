-- R13 ③ profile_job_interests (DM v4.12 §2.1.2; SD-A3, SD-Q3 (가) 확정 2026-11-05 — 최대 2쌍; R-SD-18).
-- 관심 직군·직무 쌍. PK (user_id, sort_order) + CHECK (sort_order between 1 and 2) caps the list at two pairs
-- without a trigger. The whole list is rewritten on every save (delete -> insert, no partial update API).
--
-- unique nulls not distinct (user_id, job_family, job_role) — PG 15+ syntax, deliberately NOT two partial
-- uniques (R-SD-18): with the default NULLS DISTINCT two rows of "same job_family + empty job_role" would both
-- pass, and that state is explicitly allowed. One constraint also means one error name for the RPC to map.

create table public.profile_job_interests (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sort_order smallint not null,
  job_family text not null,
  job_role text,
  created_at timestamptz not null default now(),
  constraint profile_job_interests_pkey primary key (user_id, sort_order),
  constraint profile_job_interests_sort_order_check check (sort_order between 1 and 2),
  constraint profile_job_interests_pair_key
    unique nulls not distinct (user_id, job_family, job_role)
);

-- No updated_at (a pair is never edited in place, DM §2.1.2).

alter table public.profile_job_interests enable row level security;

-- DM §5: select / insert / delete own rows. No update policy (the list is overwritten whole). app_ai_writer gets nothing (DM §2.1.5, SD-6).
create policy profile_job_interests_select_own on public.profile_job_interests
  for select to authenticated using (user_id = (select auth.uid()));
create policy profile_job_interests_insert_own on public.profile_job_interests
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy profile_job_interests_delete_own on public.profile_job_interests
  for delete to authenticated using (user_id = (select auth.uid()));

-- save_profile_basics is security invoker, so the user session needs the table privileges.
-- DM §5 keeps a direct insert grant that the app does not use [가정]; update is not granted
-- (the list is always overwritten whole).
grant select, insert, delete on table public.profile_job_interests to authenticated;
