-- S3a (BYOK v4, D-34, decisions.md 2026-10-28 B-1): the service usage ledger is gone.
-- No reservation / charge / release and no service quota. Usage becomes the append-only
-- ai_usage_records meter (20261028000300). Forward-only: S3 migrations stay as applied.
--
-- complete_ai_job(uuid, uuid, integer, jsonb) charged a reservation; it is replaced by the
-- 3-argument v4 version in 20261028000500. sweep_stalled_ai_jobs is replaced there too (its
-- current body still references usage_events, so it is redefined before anything calls it).

drop function if exists public.complete_ai_job(uuid, uuid, integer, jsonb);
drop function if exists public.reserve_usage(text, integer, text, uuid);
drop function if exists public.charge_usage(uuid);
drop function if exists public.release_usage(uuid);
drop function if exists public.charge_usage_for_job(uuid);
drop function if exists public.release_usage_for_job(uuid);
drop function if exists public.get_usage_summary();
drop function if exists private.transition_usage_event(uuid, text);

drop table if exists public.usage_events;
drop table if exists public.usage_limits;

-- private.current_usage_period() (KST month, day 1) is kept: get_ai_usage_summary uses it.
