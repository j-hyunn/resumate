-- R15 / D3 + D4 (DM 11.8 #3, 11.10 #5a, §2.9.1, §2.6.2 — CL-1·CL-A8·CL-6·CF-A17)
-- 1) Document turns are writing_chat jobs that DO belong to an application project (usage and board attribution),
--    so the "writing_chat target => no application project" rule is split per job_type.
-- 2) The career-description-per-project in-flight index goes (CL-6, Q-DM-11): the per-chat in-flight unique index
--    already stops two turns in one chat, and a per-project lock would stop a user from using a document's two
--    chats alternately. The API code drops the career_description_in_progress rejection with it.
-- 3) jd_extraction may now run without a target (the preview run of 추가 모달 [다음], CF-A17).
-- Deployment stage 2. Conditionally irreversible: once a cover_letter + writing_chat job row exists (after the
-- code deployment), the old CHECK cannot come back for at least 90 days (ai_jobs retention).

-- writing_chat_turn: unchanged (target_type writing_chat, no application project).
-- career_description / cover_letter with target_type = 'writing_chat': application project required.
--   (v4.15, CF-A3 / AI 요청 7) career_description stays in the list although no new row is created with it;
--   the old career_description rows carry target_type = 'draft' and are not touched by this CHECK.
alter table public.ai_jobs
  add constraint ai_jobs_document_chat_turn_check
    check (target_type is distinct from 'writing_chat'
           or job_type not in ('career_description', 'cover_letter')
           or application_project_id is not null);

-- CL-6: drop the per-application-project career description in-flight index.
drop index public.ai_jobs_career_description_in_flight_key;

-- CF-A17: the preview extraction has no target row before it is linked, and both keys are filled when
-- create_application_project links it. ai_jobs_in_flight_target_key does not bite (NULLS DISTINCT).
alter table public.ai_jobs drop constraint ai_jobs_jd_extraction_check;
alter table public.ai_jobs
  add constraint ai_jobs_jd_extraction_check
    check (job_type <> 'jd_extraction'
           or (target_type = 'job_description' and target_id is not null and application_project_id is not null)
           or (target_type = 'jd_preview' and (target_id is null) = (application_project_id is null)));
