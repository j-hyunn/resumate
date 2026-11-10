-- R15 / D6 (DM 11.10 #5, §2.6 — CF-9·CF-A8)
-- 자기소개서 목록(S-13) "최근 작성 순" = created_at desc. The existing indexes cover last_activity_at, deadline and
-- the board (stage, stage_changed_at); none backs this sort. The last_activity_at index stays until the other
-- reads that use it are checked `[가정]`.
create index application_projects_user_id_created_at_idx
  on public.application_projects (user_id, created_at desc);
