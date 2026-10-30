-- R1 A24 (DM §5 v4.2; 확정 2026-11-05): app_ai_writer loses its direct INSERT on evidence_links. No code wrote
-- through it, and a direct insert skips the ownership / run_generation checks. Every evidence row is written by the
-- result RPCs (security definer, owner postgres) — insights, drafts, interview questions / evaluations.
-- SELECT for app_ai_writer stays (evidence_links_select_ai_writer).

drop policy evidence_links_insert_ai_writer on public.evidence_links;

revoke insert on table public.evidence_links from app_ai_writer;
revoke insert (id, user_id, application_project_id, owner_type, owner_id, item_key, sort_order, source_type,
               source_id, source_locator, source_field, quote, quote_adjusted, source_snapshot_at, source_label)
  on table public.evidence_links from app_ai_writer;
