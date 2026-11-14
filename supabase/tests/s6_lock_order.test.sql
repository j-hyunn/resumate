-- QA-S5-06 / S6: the ai_jobs end triggers must not wait for the application_projects row (they already hold the
-- ai_jobs row; a project delete takes project -> ai_jobs). A real two-session deadlock check needs a second
-- connection (dblink), so this file pins the structure; the interleaving was reproduced manually with two psql
-- sessions (S6 db notes: pre-fix 40P01, fixed 0.05 s, no error).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- R17: the jd_extraction release path (trigger, mark_failed, fail_jd_extraction) is gone.
select hasnt_function('private', 'jd_extraction_mark_failed', array['uuid', 'uuid', 'boolean'],
                      'R17: jd_extraction_mark_failed dropped');
select has_function('private', 'insight_mark_failed', array['uuid', 'uuid', 'boolean'],
                    'insight_mark_failed(insight, job, skip_locked)');

select ok(pg_get_functiondef('private.insight_mark_failed(uuid, uuid, boolean)'::regprocedure) ~* 'for update skip locked',
          'insight_mark_failed has a SKIP LOCKED project lock');
select ok(pg_get_functiondef('private.ai_jobs_release_insight()'::regprocedure)
            ~* 'insight_mark_failed\(i\.id, new\.id, true\)',
          'insight release trigger uses the skip-locked path');
select ok(pg_get_functiondef('public.fail_insight(uuid, uuid)'::regprocedure)
            ~* 'insight_mark_failed\(p_insight_id, p_ai_job_id, false\)',
          'fail_insight keeps waiting (holds no ai_jobs lock)');

select set_eq($$select tgname::text from pg_trigger where tgrelid = 'public.ai_jobs'::regclass and not tgisinternal
                  and tgname like 'ai_jobs_release_%'$$,
              array['ai_jobs_release_insight'],
              'release triggers installed (R15: drafts trigger dropped; R17: jd_extraction trigger dropped)');

select * from finish();
rollback;
