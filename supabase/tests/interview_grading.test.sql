-- W0 Q53-3, Q53-5, Q53-10 (DM 2.7.1): answer_evaluations.error_code, fail_answer_evaluation's argument, the decision
-- table (one case per row), begin_interview_evaluation refusals and targets, mark_interview_result_viewed,
-- retry_ai_job's Q53-5 refusal, get_interview_grading_decisions ownership.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();
create schema w0t;
grant usage on schema w0t to authenticated, app_ai_writer;

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status) values
  ('a0000000-9999-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'ag01', 'valid'),
  ('a0000000-9999-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'openai', 'paid', '\x01', '\x02', '\x03', 'env-v1', 'oa01', 'valid');
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged) values
  ('a0000000-0000-0000-0000-000000000001', 'gemini', 'free', 'v2026-10-29', true),
  ('a0000000-0000-0000-0000-000000000001', 'openai', 'paid', 'v2026-10-29', false);
update public.profiles set active_ai_provider = 'gemini' where id = 'a0000000-0000-0000-0000-000000000001';

create function w0t.sid(n int) returns uuid language sql immutable as
  $$ select ('a0000000-5e55-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function w0t.jid(n int, k int default 0) returns uuid language sql immutable as
  $$ select ('a0000000-7777-' || lpad(k::text, 4, '0') || '-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function w0t.aid(n int, k int) returns uuid language sql immutable as
  $$ select ('a0000000-a115-' || lpad(k::text, 4, '0') || '-0000-' || lpad(n::text, 12, '0'))::uuid $$;

-- One session with its own project. p_answers: ok | none (submitted, no eval row) | pending | null (failed, no cause) |
-- input_too_long | safety_blocked | rate_limited | unanswered. p_job_err: the evaluation job's failure (null = no job
-- row, i.e. pruned); p_job_status defaults to failed when p_job_err is set.
create function w0t.mk(n int, p_status text, p_answers text[], p_job_err text default null, p_job_status text default null,
                           p_provider text default 'gemini', p_tier text default 'free')
returns void language plpgsql as $$
declare
  v_uid uuid := 'a0000000-0000-0000-0000-000000000001';
  v_project uuid := ('a0000000-aaaa-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
  v_job uuid;
  v_k int := 0;
  v_a text;
  v_q uuid;
begin
  insert into public.application_projects (id, user_id, name, name_source) values (v_project, v_uid, 'P' || n, 'user');
  if p_job_err is not null or p_job_status is not null then
    v_job := w0t.jid(n);
    insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, error_code,
                                run_generation, provider, model_tier, connection_tier)
    values (v_job, v_uid, 'interview_evaluation', v_project, 'interview_session', w0t.sid(n),
            coalesce(p_job_status, 'failed'), p_job_err, 1, p_provider, 'default', p_tier);
  end if;
  insert into public.interview_sessions (id, user_id, application_project_id, interview_type, data_sufficiency, status,
                                         generation_status, question_provider, question_model, submitted_at, completed_at,
                                         evaluation_job_id, evaluation_run_generation, evaluation_provider, evaluation_model)
  values (w0t.sid(n), v_uid, v_project, 'job', 'ok', p_status, 'ready', 'gemini', 'm', now(),
          case when p_status = 'completed' then now() end, v_job, 1, 'gemini', 'm');
  foreach v_a in array p_answers loop
    v_k := v_k + 1;
    v_q := gen_random_uuid();
    insert into public.interview_questions (id, user_id, session_id, sequence, source_kind, anchor, question_text, intent)
      values (v_q, v_uid, w0t.sid(n), v_k, 'values', 'general', 'q', 'i');
    insert into public.interview_answers (id, user_id, session_id, question_id, answer_text, status, score_status)
      values (w0t.aid(n, v_k), v_uid, w0t.sid(n), v_q, case when v_a = 'unanswered' then '' else 'a' end,
              case when v_a = 'unanswered' then 'unanswered' else 'submitted' end,
              case when v_a = 'unanswered' then 'unanswered' when v_a = 'ok' then 'pending_method' else 'not_scored' end);
    if v_a = 'ok' then
      insert into public.answer_evaluations (user_id, session_id, answer_id, status, result, completed_at, schema_version,
                                             prompt_version, provider, model, model_tier, connection_tier, ai_job_id)
      values (v_uid, w0t.sid(n), w0t.aid(n, v_k), 'succeeded', '{}', now(), 1, 'p', 'gemini', 'm', 'default', 'free', v_job);
    elsif v_a = 'pending' then
      insert into public.answer_evaluations (user_id, session_id, answer_id, status, ai_job_id)
      values (v_uid, w0t.sid(n), w0t.aid(n, v_k), 'pending', v_job);
    elsif v_a in ('null', 'input_too_long', 'safety_blocked', 'rate_limited') then
      insert into public.answer_evaluations (user_id, session_id, answer_id, status, error_code, ai_job_id)
      values (v_uid, w0t.sid(n), w0t.aid(n, v_k), 'failed', nullif(v_a, 'null'), v_job);
    end if;
  end loop;
end $$;

create function w0t.dec(n int) returns text language sql as
  $$ select d.decision || coalesce(':' || d.cause, '') from public.get_interview_grading_decisions(array[w0t.sid(n)]) d $$;
grant execute on all functions in schema w0t to authenticated, app_ai_writer;

-- ══ decision table ══
select w0t.mk(1, 'evaluation_failed', array['ok', 'rate_limited'], 'rate_limited');              -- targets 1
select w0t.mk(2, 'evaluation_failed', array['ok', 'null'], 'rate_limited');                      -- null cause = target
select w0t.mk(3, 'evaluation_failed', array['ok', 'none'], 'rate_limited');                      -- no row = target
select w0t.mk(4, 'evaluation_failed', array['ok', 'pending'], 'rate_limited');                   -- pending = target
select w0t.mk(5, 'evaluation_failed', array['ok', 'unanswered'], 'rate_limited');                -- resummarize
select w0t.mk(6, 'evaluation_failed', array['ok', 'input_too_long'], 'schema_invalid');          -- resummarize
select w0t.mk(7, 'evaluation_failed', array['ok'], 'safety_blocked');                            -- summary input
select w0t.mk(8, 'evaluation_failed', array['safety_blocked', 'input_too_long'], 'safety_blocked'); -- all input
select w0t.mk(9, 'evaluation_failed', array['ok']);                                              -- job pruned -> resummarize
select w0t.mk(10, 'completed', array['ok', 'rate_limited']);                                     -- regrade
select w0t.mk(11, 'completed', array['ok', 'input_too_long']);                                   -- input_only
select w0t.mk(12, 'completed', array['ok', 'unanswered']);                                       -- none
select w0t.mk(13, 'evaluating', array['ok', 'none'], null, 'running');                           -- live job -> none
select w0t.mk(14, 'evaluating', array['ok', 'none'], 'rate_limited');                            -- dead job -> effective failed
select w0t.mk(15, 'evaluating', array['safety_blocked'], 'safety_blocked');                      -- dead job, nothing to do
select w0t.mk(16, 'evaluation_failed', array['ok', 'rate_limited', 'input_too_long'], 'rate_limited'); -- mixed: input one out
select w0t.mk(17, 'completed', array['safety_blocked', 'input_too_long', 'ok']);                 -- first by sequence

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(w0t.dec(1), 'regrade', 'failed: target >= 1');
select is(w0t.dec(2), 'regrade', 'failed: null error_code is a target');
select is(w0t.dec(3), 'regrade', 'failed: submitted answer without a row is a target');
select is(w0t.dec(4), 'regrade', 'failed: pending is a target');
select is(w0t.dec(5), 'resummarize', 'failed: 0 targets, success, summary not input');
select is(w0t.dec(6), 'resummarize', 'failed: an input-caused answer does not block the summary redo');
select is(w0t.dec(7), 'input_only:safety_blocked', 'failed: 0 targets, success, summary input');
select is(w0t.dec(8), 'input_only:safety_blocked', 'failed: 0 targets, 0 success, first answer cause');
select is(w0t.dec(9), 'resummarize', 'failed: pruned job -> summary cause unknown -> not input');
select is(w0t.dec(10), 'regrade', 'completed: target >= 1');
select is(w0t.dec(11), 'input_only:input_too_long', 'completed: only input-caused left');
select is(w0t.dec(12), 'none', 'completed: nothing failed');
select is(w0t.dec(13), 'none', 'evaluating with a live job');
select is(w0t.dec(14), 'regrade', 'evaluating with an ended job reads as failed');
select is(w0t.dec(15), 'input_only:safety_blocked', 'evaluating with an ended job, nothing left');
select is((select d.regrade_target_count from public.get_interview_grading_decisions(array[w0t.sid(16)]) d), 1, 'count excludes input-caused');
select is(w0t.dec(17), 'input_only:safety_blocked', 'cause = first by question order');
select is((select count(*)::int from public.get_interview_grading_decisions(array[w0t.sid(1), w0t.sid(5), w0t.sid(999)])), 2,
          'several ids, unknown id absent');
select is((select array_agg(d.status order by d.session_id) from public.get_interview_grading_decisions(array[w0t.sid(14)]) d), array['evaluation_failed'],
          'effective status returned');

-- ══ mark_interview_result_viewed (Q53-10) ══
select is(public.mark_interview_result_viewed(w0t.sid(7)) ->> 'changed', 'true', 'viewed: failed + input_only (summary)');
select is(public.mark_interview_result_viewed(w0t.sid(8)) ->> 'changed', 'true', 'viewed: failed + input_only (answers)');
select is(public.mark_interview_result_viewed(w0t.sid(8)) ->> 'changed', 'false', 'viewed: second time no change');
select is(public.mark_interview_result_viewed(w0t.sid(1)) ->> 'changed', 'false', 'viewed: regrade possible keeps the mark');
select is(public.mark_interview_result_viewed(w0t.sid(5)) ->> 'changed', 'false', 'viewed: resummarize possible keeps the mark');
select is(public.mark_interview_result_viewed(w0t.sid(9)) ->> 'changed', 'false', 'viewed: unknown summary cause keeps the mark');
select is(public.mark_interview_result_viewed(w0t.sid(11)) ->> 'changed', 'true', 'viewed: completed + input-caused only');
select is(public.mark_interview_result_viewed(w0t.sid(12)) ->> 'changed', 'true', 'viewed: completed');
select is(public.mark_interview_result_viewed(w0t.sid(15)) ->> 'changed', 'false', 'viewed: stored evaluating stays changed false');
select is((select result_viewed_at is null from public.interview_sessions where id = w0t.sid(1)), true, 'viewed: column untouched when false');
reset role;

-- ══ begin_interview_evaluation ══
-- New job per session: starts with the same provider as the job row.
create function w0t.newjob(n int, k int) returns uuid language plpgsql as $$
begin
  insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, run_generation, provider, model_tier, connection_tier)
  values (w0t.jid(n, k), 'a0000000-0000-0000-0000-000000000001', 'interview_evaluation',
          ('a0000000-aaaa-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'interview_session', w0t.sid(n), 'running', 1, 'gemini', 'default', 'free');
  return w0t.jid(n, k);
end $$;
grant execute on all functions in schema w0t to authenticated, app_ai_writer;
select w0t.newjob(n, 1) from unnest(array[1, 5, 8, 7, 11, 12, 14, 15, 16]) n;
update public.interview_sessions set result_viewed_at = now() where id = w0t.sid(16);

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.begin_interview_evaluation(w0t.sid(8), w0t.jid(8, 1), 'gemini', 'm')$$,
                 'P0001', 'interview_evaluation_input_only', 'begin: failed + all input-caused');
select throws_ok($$select public.begin_interview_evaluation(w0t.sid(7), w0t.jid(7, 1), 'gemini', 'm')$$,
                 'P0001', 'interview_evaluation_input_only', 'begin: failed + summary input-caused');
select throws_ok($$select public.begin_interview_evaluation(w0t.sid(11), w0t.jid(11, 1), 'gemini', 'm')$$,
                 'P0001', 'interview_evaluation_input_only', 'begin: completed + only input-caused');
select throws_ok($$select public.begin_interview_evaluation(w0t.sid(12), w0t.jid(12, 1), 'gemini', 'm')$$,
                 'P0001', 'interview_evaluation_not_needed', 'begin: completed + nothing failed keeps not_needed');
select throws_ok($$select public.begin_interview_evaluation(w0t.sid(15), w0t.jid(15, 1), 'gemini', 'm')$$,
                 'P0001', 'interview_evaluation_input_only', 'begin: evaluating + dead job + nothing left (own job not counted)');
do $$
declare v_detail text;
begin
  perform public.begin_interview_evaluation(w0t.sid(8), w0t.jid(8, 1), 'gemini', 'm');
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  perform set_config('t.detail', v_detail, true);
end $$;
select is(current_setting('t.detail'), 'safety_blocked', 'begin: detail carries the cause');

select is((public.begin_interview_evaluation(w0t.sid(16), w0t.jid(16, 1), 'gemini', 'm') -> 'answers_to_evaluate' -> 0 ->> 'answer_id')::uuid,
          w0t.aid(16, 2), 'begin: the rate_limited answer is the target');
select is((select status from public.interview_sessions where id = w0t.sid(16)), 'evaluating', 'begin: session reopened');
select is((select result_viewed_at from public.interview_sessions where id = w0t.sid(16)), null::timestamptz, 'begin: A9 clears result_viewed_at');
select is((public.begin_interview_evaluation(w0t.sid(5), w0t.jid(5, 1), 'gemini', 'm') -> 'answers_to_evaluate'), '[]'::jsonb,
          'begin: resummarize has no answers to evaluate (Q53-5)');
select is((public.begin_interview_evaluation(w0t.sid(14), w0t.jid(14, 1), 'gemini', 'm') ->> 'reopened'), 'true', 'begin: evaluating + dead job with a target reopens');

-- ══ fail_answer_evaluation + error_code lifecycle ══
select is(public.fail_answer_evaluation(w0t.aid(16, 2), w0t.jid(16, 1), 'input_too_long'), true, 'fail: with a cause');
select is((select error_code from public.answer_evaluations where answer_id = w0t.aid(16, 2)), 'input_too_long', 'fail: cause stored');
select is(public.fail_answer_evaluation(w0t.aid(16, 2), w0t.jid(16, 1)), true, 'fail: two-argument call still works (default null)');
select is((select error_code from public.answer_evaluations where answer_id = w0t.aid(16, 2)), null::text, 'fail: no cause overwrites with null');
select throws_ok($$select public.fail_answer_evaluation(w0t.aid(16, 2), w0t.jid(16, 1), 'nope')$$,
                 'P0001', 'invalid_error_code', 'fail: unknown code');
select is(public.fail_answer_evaluation(w0t.aid(16, 2), w0t.jid(16, 1), 'safety_blocked'), true, 'fail: again with a cause');
select is(public.save_answer_evaluation(w0t.aid(16, 2), w0t.jid(16, 1), 1,
            jsonb_build_object('result', '{}'::jsonb, 'hashes', jsonb_build_object('input_hash', 'i', 'career_snapshot_hash', 'c'),
                               'meta', jsonb_build_object('schema_version', 1, 'prompt_version', 'p', 'provider', 'gemini', 'model', 'm',
                                                          'model_tier', 'default', 'connection_tier', 'free'),
                               'evidence', '[]'::jsonb)) ->> 'applied', 'true', 'save: applied on the failed row');
select results_eq($$select status, error_code from public.answer_evaluations where answer_id = w0t.aid(16, 2)$$,
                  $$values ('succeeded'::text, null::text)$$, 'save: success clears the cause');
reset role;

select throws_ok($$insert into public.answer_evaluations (user_id, session_id, answer_id, status, error_code)
                   values ('a0000000-0000-0000-0000-000000000001', w0t.sid(12), w0t.aid(12, 2), 'pending', 'timeout')$$,
                 '23514', null, 'CHECK: a cause only on failed rows');
select throws_ok($$update public.answer_evaluations set error_code = 'nope' where answer_id = w0t.aid(1, 2)$$,
                 '23514', null, 'CHECK: same list as ai_jobs.error_code');
select lives_ok($$update public.answer_evaluations set status = 'pending' where answer_id = w0t.aid(1, 2)$$, 'trigger: reopen');
select is((select error_code from public.answer_evaluations where answer_id = w0t.aid(1, 2)), null::text, 'trigger: reopened row has no cause');

-- answer_evaluations stay unwritable for users; the new column is readable.
select ok(has_column_privilege('authenticated', 'public.answer_evaluations', 'error_code', 'select'), 'authenticated reads error_code');
select ok(not has_column_privilege('authenticated', 'public.answer_evaluations', 'error_code', 'update'), 'authenticated cannot write error_code');
select ok(not has_column_privilege('app_ai_writer', 'public.answer_evaluations', 'error_code', 'update'), 'app_ai_writer writes it only through the RPC');
select ok(not has_function_privilege('authenticated', 'public.fail_answer_evaluation(uuid, uuid, text)', 'execute'), 'fail: authenticated no execute');
select ok(has_function_privilege('app_ai_writer', 'public.fail_answer_evaluation(uuid, uuid, text)', 'execute'), 'fail: app_ai_writer execute');
select ok(not has_function_privilege('anon', 'public.get_interview_grading_decisions(uuid[])', 'execute'), 'decisions: anon no execute');
select is((select count(*)::int from pg_proc p where p.proname = 'fail_answer_evaluation' and p.pronamespace = 'public'::regnamespace), 1, 'fail: old overload gone');

-- ══ retry_ai_job: 0 targets -> not retryable, before the connection gates (Q53-5) ══
select w0t.mk(20, 'evaluation_failed', array['ok', 'input_too_long'], 'schema_invalid');  -- 0 targets, same provider
select w0t.mk(21, 'evaluation_failed', array['ok'], 'rate_limited', null, 'openai', 'paid'); -- 0 targets, provider differs
select w0t.mk(22, 'evaluation_failed', array['ok', 'none'], 'rate_limited');              -- 1 target: retry fine
select w0t.mk(23, 'evaluation_failed', array['ok', 'none', 'input_too_long'], 'rate_limited', null, 'openai', 'paid'); -- R-63 restart

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.retry_ai_job(w0t.jid(20), 1, 'm', 'default', '{}', 'gemini', 'free')$$,
                 'P0001', 'ai_job_not_retryable', 'retry: 0 targets, same provider');
select throws_ok($$select public.retry_ai_job(w0t.jid(21), 1, 'm', 'default', '{}', 'gemini', 'free')$$,
                 'P0001', 'ai_job_not_retryable', 'retry: 0 targets, other provider');
select is(public.retry_ai_job(w0t.jid(22), 1, 'm', 'default', '{}', 'gemini', 'free') ->> 'requeued', 'true', 'retry: a target exists');
select is(public.retry_ai_job(w0t.jid(23), 1, 'm', 'default', '{}', 'gemini', 'free') ->> 'restarted', 'true', 'retry: other provider restarts');
reset role;
select is((select array_agg(status || ':' || coalesce(error_code, '-') order by answer_id) from public.answer_evaluations where session_id = w0t.sid(23)),
          array['pending:-', 'pending:-'], 'retry: R-63 reopens every row of the job and clears the cause');

-- 0 targets is checked before the gates: with no key the refusal is still not_retryable.
select w0t.mk(24, 'evaluation_failed', array['ok'], 'rate_limited');
update public.profiles set active_ai_provider = null where id = 'a0000000-0000-0000-0000-000000000001';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.retry_ai_job(w0t.jid(24), 1, 'm', 'default', '{}', 'gemini', 'free')$$,
                 'P0001', 'ai_job_not_retryable', 'retry: refusal comes before key_missing');
reset role;

-- ══ other user ══
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.get_interview_grading_decisions(array[w0t.sid(1)])), 0, 'other user: decisions empty');
select throws_ok($$select public.mark_interview_result_viewed(w0t.sid(7))$$, 'P0001', 'interview_session_not_found', 'other user: mark not found');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.get_interview_grading_decisions(array[w0t.sid(1)])$$, '42501', null, 'anon: refused');
reset role;

select * from finish();
rollback;
