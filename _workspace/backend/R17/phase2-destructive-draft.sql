-- DESTRUCTIVE: R17 phase 2 DRAFT — NOT APPLIED, NOT IN supabase/migrations/.
-- Drops public.jd_requirements (all rows), the job_descriptions extraction columns (extraction, requirements_hash,
-- tech_keywords, detected_language, extraction_status, extraction_job_id, extraction_provider, extraction_model),
-- insights.requirements_hash, and narrows the ai_jobs / ai_usage_records / evidence_links CHECK lists
-- (jd_extraction, jd_preview, not_a_jd, jd_requirement), deleting or rewriting the rows that still carry them.
--
-- Preconditions before turning this into a migration (each is a planning decision, not a DB one):
--   P1. What happens to v1 insights (schema_version 1, requirements_hash set) — their requirement_matches point at
--       jd_requirements ids. Options: (a) delete v1 insights + their evidence, (b) keep them but stop resolving
--       requirement text (screen shows "이전 분석"), (c) snapshot the requirement text into result jsonb first.
--       This draft does (c) then drops — least data lost. Swap section 1 if the decision is (a) or (b).
--   P2. Old jd_extraction usage rows: the usage meter shows past cost. This draft KEEPS ai_usage_records rows and
--       maps feature/job_type 'jd_extraction' → a new legacy value 'jd_extraction_legacy' is NOT possible without
--       widening the list, so the draft keeps 'jd_extraction' in ai_usage_records CHECKs (only ai_jobs narrows).
--       If the usage screen should forget them, delete the rows instead (marked below).
--   P3. Raw-text edit rule (R17-6): update_failed_jd_raw_text reads extraction_status / extraction_job_id /
--       jd_requirements. It must be redefined (or dropped) in the same migration — placeholder in section 6.
--   P4. company_name_source / position_title_source / application_projects.name_source value 'ai': old rows hold
--       it. Kept here (a value list narrowing would need a rewrite to 'user', which misstates provenance).
--
-- Order matters: evidence → insights → jd_requirements → job_descriptions → ai_jobs / usage → functions.

begin;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. v1 insights: snapshot requirement text into result, then drop requirements_hash            [loses: the hash]
-- ---------------------------------------------------------------------------------------------------------------
-- Copies {content, category, importance, sentence_ids} from jd_requirements into each v1 requirement_matches item
-- (same shape as v2's "requirement" object), so the screen can read v1 without the table.
update public.insights i
   set result = jsonb_set(i.result, '{requirement_matches}', (
         select coalesce(jsonb_agg(
                  case when r.id is null then m
                       else m || jsonb_build_object('requirement', jsonb_build_object(
                              'content', r.content, 'category', r.category, 'importance', r.importance,
                              'sentence_ids', to_jsonb(r.source_sids)))
                  end order by ord), '[]'::jsonb)
           from jsonb_array_elements(i.result -> 'requirement_matches') with ordinality as e(m, ord)
           left join public.jd_requirements r
             on r.id::text = m ->> 'requirement_id' and r.user_id = i.user_id))
 where i.schema_version = 1
   and jsonb_typeof(i.result -> 'requirement_matches') = 'array';

alter table public.insights drop constraint insights_ready_check;
alter table public.insights drop constraint insights_requirements_hash_check;
alter table public.insights drop column requirements_hash;                         -- loses: v1 requirements hash
-- v1 rows have no jd_text_hash; the ready check needs one now. Backfill from the JD's current raw_text_hash
-- (not exact — the text may have changed since — but staleness for v1 is "always stale" in the app anyway).
update public.insights i
   set jd_text_hash = jd.raw_text_hash
  from public.job_descriptions jd
 where jd.application_project_id = i.application_project_id and i.jd_text_hash is null and i.status = 'ready';
alter table public.insights add constraint insights_ready_check
  check (status <> 'ready'
         or (result is not null and match_stage_result is not null and completed_at is not null
             and jd_text_hash is not null and career_snapshot_hash is not null and input_hash is not null
             and schema_version is not null and prompt_version is not null and provider is not null
             and model is not null and model_tier is not null and connection_tier is not null));

-- ---------------------------------------------------------------------------------------------------------------
-- 2. evidence_links: jd_requirement rows                                     [loses: every jd_requirement evidence]
-- ---------------------------------------------------------------------------------------------------------------
-- They point at rows dropped in section 3. The requirement text is already inside result (section 1).
delete from public.evidence_links where source_type = 'jd_requirement';
alter table public.evidence_links drop constraint evidence_links_source_type_check;
alter table public.evidence_links add constraint evidence_links_source_type_check
  check (source_type in ('profile', 'experience', 'education', 'project', 'project_deliverable', 'skill',
                         'jd_sentence', 'user_note'));
-- TODO when applying: redefine private.evidence_links_check_source without the jd_requirement branch, and drop
-- 'jd_requirement' from private.insight_payload_valid's allowed list (and any other validator that lists it).

-- ---------------------------------------------------------------------------------------------------------------
-- 3. jd_requirements                                                      [loses: the table and all its rows]
-- ---------------------------------------------------------------------------------------------------------------
-- TODO when applying: redefine private.delete_account_data without its jd_requirements step (it references the
-- table by name and would fail at run time after the drop).
drop table public.jd_requirements;   -- triggers (set_updated_at, evidence_source_deleted) and policies go with it

-- ---------------------------------------------------------------------------------------------------------------
-- 4. job_descriptions extraction columns                       [loses: AI-01 output kept on every posting row]
-- ---------------------------------------------------------------------------------------------------------------
-- The guard trigger reads extraction_status; redefine it first (raw text immutable unless the edit RPC stamps
-- raw_text_edited_at — rule to be re-decided with R17-6).
-- TODO when applying: create or replace function private.job_descriptions_guard() ... (no extraction_status).
alter table public.job_descriptions drop constraint job_descriptions_succeeded_check;
alter table public.job_descriptions drop constraint job_descriptions_extraction_status_check;
alter table public.job_descriptions drop constraint job_descriptions_extraction_check;
alter table public.job_descriptions drop constraint job_descriptions_extraction_provider_check;
alter table public.job_descriptions drop constraint job_descriptions_requirements_hash_check;
alter table public.job_descriptions drop constraint job_descriptions_extraction_job_fkey;
drop index if exists public.job_descriptions_extraction_job_id_idx;
alter table public.job_descriptions
  drop column extraction,             -- AI-01 result jsonb
  drop column requirements_hash,
  drop column tech_keywords,
  drop column detected_language,
  drop column extraction_status,
  drop column extraction_job_id,
  drop column extraction_provider,
  drop column extraction_model;
-- Column grants on these columns disappear with them (authenticated / app_ai_writer select lists).

-- ---------------------------------------------------------------------------------------------------------------
-- 5. ai_jobs / ai_usage_records value lists                  [loses: old jd_extraction / jd_preview job rows]
-- ---------------------------------------------------------------------------------------------------------------
-- ai_jobs rows are operational (90-day retention, purge_old_ai_jobs). Usage rows reference them by ai_job_id —
-- check that FK's on-delete behaviour before running (set null expected; otherwise null them first).
delete from public.ai_jobs where job_type = 'jd_extraction';
alter table public.ai_jobs drop constraint ai_jobs_jd_extraction_check;
alter table public.ai_jobs drop constraint ai_jobs_job_type_check;
alter table public.ai_jobs add constraint ai_jobs_job_type_check
  check (job_type in ('insight', 'career_description', 'draft_source_ranking', 'cover_letter', 'writing_chat_turn',
                      'key_verification', 'writing_assist', 'chat_reply'));
update public.ai_jobs set error_code = 'schema_invalid' where error_code = 'not_a_jd';  -- none expected after delete
alter table public.ai_jobs drop constraint ai_jobs_error_code_check;
alter table public.ai_jobs add constraint ai_jobs_error_code_check
  check (error_code in ('rate_limited', 'daily_quota_exhausted', 'billing_required', 'key_invalid',
                        'model_not_available', 'provider_unavailable', 'input_too_long', 'safety_blocked',
                        'key_missing', 'schema_invalid', 'timeout', 'stalled', 'canceled', 'insufficient_data'));
-- ai_usage_records: KEPT as is (P2). If the decision is to forget them:
--   delete from public.ai_usage_records where feature = 'jd_extraction';     -- loses: past AI-01 cost history
--   then narrow ai_usage_records_feature_check / _job_type_check / _error_code_check the same way.

-- ---------------------------------------------------------------------------------------------------------------
-- 6. functions still reading the dropped columns
-- ---------------------------------------------------------------------------------------------------------------
-- TODO when applying (each must be redefined in this same migration, or the drop above fails / breaks at run time):
--   public.update_failed_jd_raw_text   (extraction_status, extraction_job_id, jd_requirements, not_a_jd) — P3
--   private.job_descriptions_guard     (extraction_status)
--   private.delete_account_data        (jd_requirements)
--   private.evidence_links_check_source (jd_requirement)
--   private.writing_chat_document_greeting — drop the p_requirements_ready parameter / "요건 정리 전" branch and
--                                       update start_document_writing_chat's call.
-- Re-run the grep from R17 db notes ("pg_proc.prosrc ~ 'extraction|requirements_hash|jd_requirement'") first.

rollback;  -- draft: never commits
