-- R13 ⑯ public.compute_total_experience_months(p_as_of date) — thin wrapper over the private function
-- (DM v4.12 §6.2; AI C-1; 요청 R13-AI-3 from the slice leader, 2026-11-05).
--
-- [가정] DM §6.2 "공개 RPC는 지금 두지 않는다" is read as "no screen-facing RPC": the context-pack assembly
-- runs in TypeScript and every DB call goes through PostgREST, which only exposes the schemas in
-- supabase/config.toml (`public`, `graphql_public`). Without a public entry point the pack cannot call the
-- function at all. The wrapper adds no logic and no new judgement — it only forwards the caller's own user id.
--
-- p_as_of has NO default here either (R-SD-23): a default would be evaluated at call time, which is the very
-- non-determinism the private signature avoids. Callers pass that run's KST date.
-- The caller's id comes from private.current_uid() (= auth.uid()), which works for the user session and for
-- app_ai_writer alike (its role token carries the user id as sub), so a caller can only ever compute its own
-- number — the private function re-checks the same thing.
create or replace function public.compute_total_experience_months(p_as_of date)
returns table (total_months integer, open_ended_experience_count integer, as_of_month date)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.compute_total_experience_months(private.current_uid(), p_as_of);
$$;

revoke all on function public.compute_total_experience_months(date) from public, anon;
grant execute on function public.compute_total_experience_months(date) to authenticated, app_ai_writer;
