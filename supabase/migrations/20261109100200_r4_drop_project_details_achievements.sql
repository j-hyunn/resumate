-- R4 (DM v4.4 §2.3, §11.1): project_details (CR-2, STAR moves to projects) and achievements (CR-11) are retired.
-- Dropping the tables also drops their triggers, policies, grants and the source_writing_chat_id FKs.

drop function if exists public.reorder_project_details(uuid, uuid[]);

drop table public.achievements;
drop table public.project_details;

drop function if exists private.achievements_set_status();
drop function if exists private.project_details_before_write();
drop function if exists private.project_details_set_updated_at();
drop function if exists private.project_details_sync_project_status();
-- The v3 completion rule read project_details; v4.4 completion is a column rule in projects_set_status.
drop function if exists private.project_is_complete(uuid, text, text);

-- draft_section_sources.project_detail_ids (DM §11.1 S7 row): column, CHECK and the removal trigger function.
alter table public.draft_section_sources drop constraint draft_section_sources_project_detail_ids_check;
alter table public.draft_section_sources drop column project_detail_ids;
drop function if exists private.draft_sources_remove_project_detail();
