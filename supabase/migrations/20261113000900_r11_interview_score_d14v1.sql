-- R11 OD-I1 (DM v4.11 A.12 "점수 산식 d14.v1", A.13, 11.6 #7 #8; AI v4.11 4.3): interview scores are computed by the
-- server from the stored rubric grades (no AI call, D-AI-07 (a)). One formula, used by every write path and the
-- backfill:
--   private.interview_answer_score_d14v1(result)  question score from answer_evaluations.result.criteria[]
--   private.interview_apply_scores_d14v1(session, write_session)  writes the question scores of a session and, when
--     asked, the session score
-- Weights specificity 30 / intent_fit 30 / structure 20 / job_relevance 20; grades excellent 100 / good 75 /
-- fair 50 / poor 25; not_applicable leaves the criterion out and the rest is re-weighted; integer, .5 rounds up
-- (round(numeric)), max 100, method d14.v1.
--   question  scored: value + rationale "구체성 보완 필요 · 의도 부합 양호 · 구조 양호 · JD 연관성 해당 없음 → 66점"
--             unanswered: value 0, max 100, d14.v1, rationale "미응답 · 0점"
--             failed (no succeeded evaluation): not_scored, nulls — left out of the session score
--   session   round(Σ scored / (scored + unanswered)); rationale "질문 N개 중 채점 n개 평균[, 미응답 m개는 0점으로
--             포함][, 채점하지 못한 k개는 빼고 계산]"; no answered question -> scored 0 "질문 N개 모두 미응답, 0점";
--             answered >= 1 but none scored -> not_scored (value null)
-- Paths: save_answer_evaluation (question score in the same transaction), complete_interview_evaluation (unanswered +
-- session), submit_interview_session's no-answer branch (no evaluation job), backfill_interview_scores (service_role).
-- Grade display names follow AI 4.2 (우수 / 양호 / 보완 필요 / 미흡, 해당 없음).

-- Question score from one answer evaluation result. {value: int | null, rationale: text | null}. value is null when no
-- criterion can be scored (malformed result) [가정]. First entry per key wins; unknown keys / grades are ignored.
create or replace function private.interview_answer_score_d14v1(p_result jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with crit (key, label, weight, ord) as (
    values ('specificity', '구체성', 30, 1), ('intent_fit', '의도 부합', 30, 2), ('structure', '구조', 20, 3),
           ('job_relevance', 'JD 연관성', 20, 4)
  ), grade (grade, label, points) as (
    values ('excellent', '우수', 100), ('good', '양호', 75), ('fair', '보완 필요', 50), ('poor', '미흡', 25),
           ('not_applicable', '해당 없음', null::integer)
  ), raw as (
    select e ->> 'key' as key, e ->> 'grade' as grade, t.o
      from jsonb_array_elements(case when jsonb_typeof(p_result -> 'criteria') = 'array'
                                     then p_result -> 'criteria' else '[]'::jsonb end) with ordinality as t (e, o)
     where jsonb_typeof(e) = 'object'
  ), firsts as (
    select distinct on (r.key) r.key, r.grade from raw r where r.key is not null order by r.key, r.o
  ), rows as (
    select c.ord, c.label as criterion, c.weight, g.label as grade_label, g.points
      from firsts f join crit c on c.key = f.key join grade g on g.grade = f.grade
  ), agg as (
    select sum(r.weight * r.points) filter (where r.points is not null) as num,
           sum(r.weight) filter (where r.points is not null) as den,
           string_agg(r.criterion || ' ' || r.grade_label, ' · ' order by r.ord) as labels
      from rows r
  )
  select case when a.den > 0
              then jsonb_build_object('value', round(a.num::numeric / a.den)::integer,
                                      'rationale', a.labels || ' → ' || round(a.num::numeric / a.den)::integer || '점')
              else jsonb_build_object('value', null, 'rationale', null) end
    from agg a;
$$;

revoke all on function private.interview_answer_score_d14v1(jsonb) from public;

-- Writes the d14.v1 scores of one session (the caller holds the session lock). Question rows: answered with a
-- succeeded evaluation -> its score; unanswered -> 0. With p_write_session also: answered without a succeeded
-- evaluation -> not_scored, and the session score (+ score_counted_count / unanswered_count). Only rows whose values
-- change are written. Returns {answers, session_written, score_status, score_value, score_counted_count}.
create or replace function private.interview_apply_scores_d14v1(p_session_id uuid, p_write_session boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_answers integer := 0;
  v_rows integer;
  v_total integer;
  v_submitted integer;
  v_scored integer;
  v_unanswered integer;
  v_sum numeric;
  v_status text;
  v_value numeric;
  v_rationale text;
  v_written boolean := false;
begin
  with calc as (
    select a.id, private.interview_answer_score_d14v1(e.result) as s
      from public.interview_answers a
      join public.answer_evaluations e on e.answer_id = a.id and e.status = 'succeeded'
     where a.session_id = p_session_id and a.status = 'submitted'
  ), tgt as (
    select c.id,
           case when c.s ->> 'value' is null then 'not_scored' else 'scored' end as st,
           (c.s ->> 'value')::numeric as val,
           case when c.s ->> 'value' is null then null else 100::numeric end as mx,
           case when c.s ->> 'value' is null then null else 'd14.v1' end as mv,
           c.s ->> 'rationale' as rat
      from calc c
  )
  update public.interview_answers a
     set score_status = t.st, score_value = t.val, score_max = t.mx, score_method_version = t.mv,
         score_rationale = t.rat
    from tgt t
   where a.id = t.id
     and (a.score_status, a.score_value, a.score_max, a.score_method_version, a.score_rationale)
         is distinct from (t.st, t.val, t.mx, t.mv, t.rat);
  get diagnostics v_rows = row_count;
  v_answers := v_answers + v_rows;

  update public.interview_answers a
     set score_status = 'unanswered', score_value = 0, score_max = 100, score_method_version = 'd14.v1',
         score_rationale = '미응답 · 0점'
   where a.session_id = p_session_id and a.status = 'unanswered'
     and (a.score_status, a.score_value, a.score_max, a.score_method_version, a.score_rationale)
         is distinct from ('unanswered'::text, 0::numeric, 100::numeric, 'd14.v1'::text, '미응답 · 0점'::text);
  get diagnostics v_rows = row_count;
  v_answers := v_answers + v_rows;

  if not p_write_session then
    return jsonb_build_object('answers', v_answers, 'session_written', false);
  end if;

  update public.interview_answers a
     set score_status = 'not_scored', score_value = null, score_max = null, score_method_version = null,
         score_rationale = null
   where a.session_id = p_session_id and a.status = 'submitted'
     and not exists (select 1 from public.answer_evaluations e where e.answer_id = a.id and e.status = 'succeeded')
     and (a.score_status, a.score_value, a.score_max, a.score_method_version, a.score_rationale)
         is distinct from ('not_scored'::text, null::numeric, null::numeric, null::text, null::text);
  get diagnostics v_rows = row_count;
  v_answers := v_answers + v_rows;

  select count(*)::integer,
         count(*) filter (where a.status = 'submitted')::integer,
         count(*) filter (where a.status = 'submitted' and a.score_status = 'scored')::integer,
         count(*) filter (where a.status = 'unanswered')::integer,
         coalesce(sum(a.score_value) filter (where a.status = 'submitted' and a.score_status = 'scored'), 0)
    into v_total, v_submitted, v_scored, v_unanswered, v_sum
    from public.interview_answers a
   where a.session_id = p_session_id;

  if v_submitted = 0 then
    v_status := 'scored';
    v_value := 0;
    v_rationale := format('질문 %s개 모두 미응답, 0점', v_total);
  elsif v_scored = 0 then
    v_status := 'not_scored';
    v_value := null;
    v_rationale := null;
  else
    v_status := 'scored';
    v_value := round(v_sum / (v_scored + v_unanswered));
    v_rationale := format('질문 %s개 중 채점 %s개 평균', v_total, v_scored)
                   || case when v_unanswered > 0 then format(', 미응답 %s개는 0점으로 포함', v_unanswered) else '' end
                   || case when v_submitted - v_scored > 0
                           then format(', 채점하지 못한 %s개는 빼고 계산', v_submitted - v_scored) else '' end;
  end if;

  update public.interview_sessions s
     set score_status = v_status, score_value = v_value,
         score_max = case when v_status = 'scored' then 100 end, score_method_version = 'd14.v1',
         score_rationale = v_rationale, score_counted_count = v_scored, unanswered_count = v_unanswered
   where s.id = p_session_id
     and (s.score_status, s.score_value, s.score_max, s.score_method_version, s.score_rationale,
          s.score_counted_count, s.unanswered_count)
         is distinct from (v_status, v_value, case when v_status = 'scored' then 100::numeric end, 'd14.v1'::text,
                           v_rationale, v_scored, v_unanswered);
  v_written := found;

  return jsonb_build_object('answers', v_answers, 'session_written', v_written, 'score_status', v_status,
                            'score_value', v_value, 'score_counted_count', v_scored);
end;
$$;

revoke all on function private.interview_apply_scores_d14v1(uuid, boolean) from public;


-- Re-evaluation start (A9): the whole session score slot is cleared (d14.v1 now fills value / max / method too).
CREATE OR REPLACE FUNCTION private.interview_evaluation_open(p_session_id uuid, p_ai_job_id uuid, p_run_generation integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.interview_sessions s
     set status = 'evaluating', evaluation_job_id = p_ai_job_id, evaluation_run_generation = p_run_generation,
         score_status = null, score_value = null, score_max = null, score_method_version = null,
         score_rationale = null, score_counted_count = null, completed_at = null, result_viewed_at = null
   where s.id = p_session_id;
  update public.session_feedbacks f set status = 'pending' where f.session_id = p_session_id and f.status <> 'pending';
end;
$function$;

revoke all on function private.interview_evaluation_open(uuid, uuid, integer) from public;

-- save_answer_evaluation: the answer's question score is written in the same transaction (was pending_method).
CREATE OR REPLACE FUNCTION public.save_answer_evaluation(p_answer_id uuid, p_ai_job_id uuid, p_run_generation integer, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.current_uid();
  v_session_id uuid;
  v_session public.interview_sessions%rowtype;
  v_answer public.interview_answers%rowtype;
  v_job public.ai_jobs%rowtype;
  v_state text;
  v_meta jsonb;
  v_eval_id uuid;
  v_count integer;
  v_now timestamptz := now();
  v_score jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select a.session_id into v_session_id from public.interview_answers a where a.id = p_answer_id and a.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'interview_answer_not_found';
  end if;
  begin
    v_session := private.interview_lock_session(v_session_id, v_uid);
  exception when sqlstate 'P0001' then
    raise exception using errcode = 'P0001', message = 'interview_answer_not_found';
  end;
  -- OD-I6 read-only guard.
  if v_session.application_project_id is null then
    raise exception using errcode = 'P0001', message = 'interview_session_read_only';
  end if;
  select * into v_answer from public.interview_answers a where a.id = p_answer_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'interview_answer_not_found';
  end if;

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or not private.interview_job_matches(v_job, v_session, 'interview_evaluation') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  v_state := private.interview_evaluation_run_state(v_session, v_job, p_run_generation);
  if v_state = 'stale' then
    return jsonb_build_object('applied', false, 'reason', 'stale_run');
  end if;

  if v_answer.status <> 'submitted' then
    raise exception using errcode = 'P0001', message = 'answer_not_evaluable';
  end if;

  if not private.interview_result_payload_valid(p_payload) then
    raise exception using errcode = 'P0001', message = 'invalid_interview_payload';
  end if;

  v_meta := p_payload -> 'meta';
  if not private.draft_meta_matches_job(v_meta, v_job) then
    raise exception using errcode = 'P0001', message = 'invalid_ai_metadata';
  end if;

  if v_state = 'reopen' then
    perform private.interview_evaluation_open(v_session_id, p_ai_job_id, p_run_generation);
  end if;

  insert into public.answer_evaluations as e (
    user_id, session_id, answer_id, status, result, ai_job_id, run_generation, schema_version, prompt_version,
    provider, model, model_tier, connection_tier, input_hash, career_snapshot_hash, validation_report, usage,
    completed_at)
  values (
    v_uid, v_session_id, p_answer_id, 'succeeded', p_payload -> 'result', p_ai_job_id, p_run_generation,
    (v_meta ->> 'schema_version')::integer, btrim(v_meta ->> 'prompt_version'), v_job.provider,
    btrim(v_meta ->> 'model'), v_job.model_tier, v_job.connection_tier,
    btrim(p_payload -> 'hashes' ->> 'input_hash'), btrim(p_payload -> 'hashes' ->> 'career_snapshot_hash'),
    case when jsonb_typeof(v_meta -> 'validation_report') = 'object' then v_meta -> 'validation_report' end,
    case when jsonb_typeof(v_meta -> 'usage') = 'object' then v_meta -> 'usage' end,
    v_now)
  on conflict (answer_id) do update
     set status = excluded.status, result = excluded.result, ai_job_id = excluded.ai_job_id,
         run_generation = excluded.run_generation, schema_version = excluded.schema_version,
         prompt_version = excluded.prompt_version, provider = excluded.provider, model = excluded.model,
         model_tier = excluded.model_tier, connection_tier = excluded.connection_tier,
         input_hash = excluded.input_hash, career_snapshot_hash = excluded.career_snapshot_hash,
         validation_report = excluded.validation_report, usage = excluded.usage, completed_at = excluded.completed_at
  returning e.id into v_eval_id;

  delete from public.evidence_links el
   where el.owner_type = 'answer_evaluation' and el.owner_id = v_eval_id and el.user_id = v_uid;
  v_count := private.interview_insert_evidence(v_uid, v_session.application_project_id, 'answer_evaluation',
                                               v_eval_id, p_payload -> 'evidence');

  -- OD-I1 d14.v1 (AI 4.3): the model's score slot is ignored.
  v_score := private.interview_answer_score_d14v1(p_payload -> 'result');
  update public.interview_answers a
     set score_status = case when v_score ->> 'value' is null then 'not_scored' else 'scored' end,
         score_value = (v_score ->> 'value')::numeric,
         score_max = case when v_score ->> 'value' is null then null else 100 end,
         score_method_version = case when v_score ->> 'value' is null then null else 'd14.v1' end,
         score_rationale = v_score ->> 'rationale'
   where a.id = p_answer_id;

  return jsonb_build_object('applied', true, 'evaluation_id', v_eval_id, 'answer_id', p_answer_id,
                            'session_id', v_session_id, 'status', 'succeeded', 'evidence_count', v_count,
                            'completed_at', v_now,
                            'score_status', case when v_score ->> 'value' is null then 'not_scored' else 'scored' end,
                            'score_value', (v_score ->> 'value')::integer);
end;
$function$;

revoke all on function public.save_answer_evaluation(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.save_answer_evaluation(uuid, uuid, integer, jsonb) to app_ai_writer;

-- complete_interview_evaluation: completed -> unanswered question scores + the session score (d14.v1).
CREATE OR REPLACE FUNCTION public.complete_interview_evaluation(p_session_id uuid, p_ai_job_id uuid, p_run_generation integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.current_uid();
  v_session public.interview_sessions%rowtype;
  v_job public.ai_jobs%rowtype;
  v_state text;
  v_succeeded integer;
  v_feedback_ok boolean;
  v_not_scored uuid[];
  v_status text;
  v_now timestamptz := now();
  v_score jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  v_session := private.interview_lock_session(p_session_id, v_uid);
  -- OD-I6 read-only guard.
  if v_session.application_project_id is null then
    raise exception using errcode = 'P0001', message = 'interview_session_read_only';
  end if;

  select * into v_job from public.ai_jobs j where j.id = p_ai_job_id and j.user_id = v_uid;
  if not found or not private.interview_job_matches(v_job, v_session, 'interview_evaluation') then
    raise exception using errcode = 'P0001', message = 'invalid_ai_job';
  end if;

  v_state := private.interview_evaluation_run_state(v_session, v_job, p_run_generation);
  if v_state = 'stale' then
    return jsonb_build_object('applied', false, 'reason', 'stale_run');
  end if;

  v_not_scored := private.interview_mark_unscored(p_session_id);

  select count(*) into v_succeeded
    from public.interview_answers a
   where a.session_id = p_session_id and a.status = 'submitted'
     and exists (select 1 from public.answer_evaluations e where e.answer_id = a.id and e.status = 'succeeded');
  v_feedback_ok := exists (select 1 from public.session_feedbacks f
                            where f.session_id = p_session_id and f.status = 'succeeded');

  if v_succeeded > 0 and v_feedback_ok then
    v_status := 'completed';
    update public.interview_sessions s
       set status = 'completed', completed_at = v_now,
           evaluation_run_generation = p_run_generation, last_activity_at = v_now
     where s.id = p_session_id;
    v_score := private.interview_apply_scores_d14v1(p_session_id, true);
  else
    v_status := 'evaluation_failed';
    update public.session_feedbacks f set status = 'failed' where f.session_id = p_session_id and f.status = 'pending';
    update public.interview_sessions s
       set status = 'evaluation_failed', completed_at = null, score_status = 'not_scored', score_value = null, score_max = null,
           score_method_version = null, score_rationale = null, score_counted_count = null,
           evaluation_run_generation = p_run_generation, last_activity_at = v_now
     where s.id = p_session_id;
  end if;

  update public.application_projects ap set last_activity_at = v_now where ap.id = v_session.application_project_id;

  return jsonb_build_object(
    'applied', true, 'session_id', p_session_id, 'status', v_status,
    'score_status', case when v_status = 'completed' then v_score ->> 'score_status' else 'not_scored' end,
    'score_value', case when v_status = 'completed' then (v_score ->> 'score_value')::integer end,
    'score_counted_count', case when v_status = 'completed' then (v_score ->> 'score_counted_count')::integer
                                else v_succeeded end, 'not_scored_answer_ids', to_jsonb(v_not_scored),
    'completed_at', case when v_status = 'completed' then v_now end);
end;
$function$;

revoke all on function public.complete_interview_evaluation(uuid, uuid, integer) from public, anon;
grant execute on function public.complete_interview_evaluation(uuid, uuid, integer) to app_ai_writer;

-- submit_interview_session: no answered question -> completed without an evaluation job, scored 0 (R-OD-1).
CREATE OR REPLACE FUNCTION public.submit_interview_session(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_project_id uuid;
  v_session public.interview_sessions%rowtype;
  v_now timestamptz := now();
  v_answered uuid[];
  v_unanswered integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select s.application_project_id into v_project_id
    from public.interview_sessions s where s.id = p_session_id and s.user_id = v_uid;
  perform 1 from public.application_projects ap where ap.id = v_project_id for update;
  perform 1 from public.interview_answers a where a.session_id = p_session_id and a.user_id = v_uid
   order by a.id for update;
  select * into v_session from public.interview_sessions s
   where s.id = p_session_id and s.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'interview_session_not_found';
  end if;

  if v_session.submitted_at is not null then
    raise exception using errcode = 'P0001', message = 'interview_already_submitted';
  end if;
  if v_session.status <> 'in_progress' then
    raise exception using errcode = 'P0001', message = 'interview_not_in_progress';
  end if;
  if v_session.generation_status <> 'ready' then
    raise exception using errcode = 'P0001', message = 'interview_not_ready';
  end if;

  update public.interview_answers a
     set status = case when a.answer_text ~ '\S' then 'submitted' else 'unanswered' end,
         score_status = case when a.answer_text ~ '\S' then null else 'unanswered' end
   where a.session_id = p_session_id;

  select coalesce(array_agg(a.id order by q.sequence) filter (where a.status = 'submitted'), '{}'),
         count(*) filter (where a.status = 'unanswered')
    into v_answered, v_unanswered
    from public.interview_answers a
    join public.interview_questions q on q.id = a.question_id
   where a.session_id = p_session_id;

  update public.interview_sessions s
     set submitted_at = v_now,
         answered_count = cardinality(v_answered),
         unanswered_count = v_unanswered,
         last_activity_at = v_now,
         status = case when cardinality(v_answered) = 0 then 'completed' else 'evaluating' end,
         completed_at = case when cardinality(v_answered) = 0 then v_now end,
         score_status = case when cardinality(v_answered) = 0 then 'not_scored' end,
         score_counted_count = case when cardinality(v_answered) = 0 then 0 end
   where s.id = p_session_id;

  if cardinality(v_answered) = 0 then
    perform private.interview_apply_scores_d14v1(p_session_id, true);
  end if;

  update public.application_projects ap set last_activity_at = v_now where ap.id = v_session.application_project_id;

  return jsonb_build_object(
    'session_id', p_session_id,
    'status', case when cardinality(v_answered) = 0 then 'completed' else 'evaluating' end,
    'submitted_at', v_now,
    'answered_count', cardinality(v_answered),
    'unanswered_count', v_unanswered,
    'answered_answer_ids', to_jsonb(v_answered),
    'evaluation_needed', cardinality(v_answered) > 0);
end;
$function$;

revoke all on function public.submit_interview_session(uuid) from public, anon;
grant execute on function public.submit_interview_session(uuid) to authenticated;


-- ── backfill_interview_scores (A.12, 11.6 #8) ──────────────────────────────
-- Operator step after deploy: call until both counts are 0. Targets submitted sessions whose completed session score
-- is not d14.v1 yet (pending_method, or the old no-answer not_scored) or that hold a pending_method / old unanswered
-- question score. Same helper as the live paths, stored grades only: no AI call, no job, no usage record.
-- Idempotent (d14.v1 rows are not selected again); sessions locked by a running RPC are skipped (skip locked) and
-- picked up by a later call. Returns {sessions: session scores written, answers: question scores written}.
-- service_role only.
create or replace function public.backfill_interview_scores(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := coalesce(p_limit, 500);
  v_session record;
  v_res jsonb;
  v_sessions integer := 0;
  v_answers integer := 0;
begin
  if v_limit < 1 or v_limit > 10000 then
    raise exception using errcode = 'P0001', message = 'invalid_limit';
  end if;

  for v_session in
    select s.id, s.status
      from public.interview_sessions s
     where s.submitted_at is not null
       and ((s.status = 'completed' and s.score_method_version is distinct from 'd14.v1')
            or exists (select 1 from public.interview_answers a
                        where a.session_id = s.id
                          and (a.score_status = 'pending_method'
                               or (a.status = 'unanswered' and a.score_method_version is distinct from 'd14.v1'))))
     order by s.id
     limit v_limit
       for update of s skip locked
  loop
    v_res := private.interview_apply_scores_d14v1(v_session.id, v_session.status = 'completed');
    v_answers := v_answers + (v_res ->> 'answers')::integer;
    if (v_res ->> 'session_written')::boolean then
      v_sessions := v_sessions + 1;
    end if;
  end loop;

  return jsonb_build_object('sessions', v_sessions, 'answers', v_answers);
end;
$$;

revoke all on function public.backfill_interview_scores(integer) from public, anon, authenticated, app_ai_writer;
grant execute on function public.backfill_interview_scores(integer) to service_role;
