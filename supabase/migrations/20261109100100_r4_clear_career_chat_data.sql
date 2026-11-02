-- R4 (DM v4.4 §11.2 [가정]): there is no production data, so the career-child and chat data is cleared instead of
-- ported (decisions.md 2026-11-07 R4). Kept: profiles, experiences, educations, skills (manual), application data.
-- Cleared: writing_chats (+ messages), projects (+ project_details, achievements, project_skills via cascade),
-- experience-level achievements, and the evidence / draft source rows that point at them.
-- Runs before the schema changes so the new CHECKs (name not null, DM-20 shape) never meet old rows.

-- Evidence rows whose source type disappears or whose project field list changes (team_size, summary).
delete from public.evidence_links
 where source_type in ('project', 'project_detail', 'achievement');

-- Cover letter source selections that name a project (project_detail_ids are dropped next).
delete from public.draft_section_sources where project_id is not null;

-- Chats first (messages cascade); the projects' source_writing_chat_id FK is set null by this.
delete from public.writing_chats;

-- Experience-level achievements (project-detail ones go with the projects below).
delete from public.achievements;

-- Projects: project_details, project_skills (and orphan tag skills via the cleanup trigger) cascade.
delete from public.projects;
