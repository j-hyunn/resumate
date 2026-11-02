-- S6 insights (AI-02; DM A.8, §2.8, §5): RLS, begin / complete / fail_insight (job matching, versioning, latest
-- swap, run-generation guard, payload shape, evidence storage), the ai_jobs end trigger, stalled-row takeover,
-- JD evidence source guard (jd_requirement / jd_sentence), cross-user isolation, and deletion cascades.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

select ok((select relrowsecurity from pg_class where oid = 'public.insights'::regclass), 'insights RLS enabled');
select policies_are('public', 'insights', array['insights_select_own', 'insights_select_ai_writer']);
select has_index('public', 'insights', 'insights_latest_key', 'unique latest index');
select has_index('public', 'insights', 'insights_reuse_idx', 'input_hash reuse index');
select has_index('public', 'insights', 'insights_project_created_idx', 'project / created_at index');

-- A's career data (as the user).
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.experiences (id, company_name, start_month, job_rank)
  values ('a0000000-1111-0000-0000-000000000001', 'A사', '2020-01-01', 'S');
insert into public.projects (id, experience_id, name, role, summary)
  values ('a0000000-3333-0000-0000-000000000001', 'a0000000-1111-0000-0000-000000000001', '결제', 'Dev', '결제 플랫폼');
insert into public.project_details (id, project_id, title, situation, action, result)
  values ('a0000000-4444-0000-0000-000000000001', 'a0000000-3333-0000-0000-000000000001', 't', 's', '인덱스 재설계', 'r');
insert into public.skills (id, name) values ('a0000000-6666-0000-0000-000000000001', 'Postgres');
reset role;

-- Application projects (as postgres for fixed ids). P1: extracted JD. P2: JD pending. P3: another extracted JD.
-- PB: B's project.
insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '에이 – 백엔드', 'ai'),
  ('a0000000-aaaa-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '대기', 'user'),
  ('a0000000-aaaa-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '씨', 'user'),
  ('b0000000-aaaa-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'B', 'user');
update public.application_projects set last_activity_at = '2026-01-01' where id = 'a0000000-aaaa-0000-0000-000000000001';
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                     extraction_status, extraction, tech_keywords, requirements_hash,
                                     extraction_provider, extraction_model) values
  ('a0000000-dddd-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   '결제 API 설계 Kafka 경험 우대', 'h',
   '[{"sid":"S1","text":"결제 API 설계","start":0,"end":9},{"sid":"S2","text":"Kafka 경험 우대","start":10,"end":21}]',
   'succeeded', '{}', '[]', 'rh', 'gemini', 'm'),
  ('a0000000-dddd-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000003',
   '다른 공고', 'h', '[{"sid":"S1","text":"다른 공고","start":0,"end":5}]',
   'succeeded', '{}', '[]', 'rh3', 'gemini', 'm'),
  ('b0000000-dddd-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'b0000000-aaaa-0000-0000-000000000001',
   'B 공고', 'h', '[{"sid":"S1","text":"B 공고","start":0,"end":4}]',
   'succeeded', '{}', '[]', 'rhb', 'gemini', 'm');
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences) values
  ('a0000000-dddd-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002',
   '대기 공고', 'h', '[{"sid":"S1","text":"대기 공고","start":0,"end":5}]');
insert into public.jd_requirements (id, user_id, job_description_id, category, content, source_sids, sort_order) values
  ('a0000000-8888-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-dddd-0000-0000-000000000001',
   'responsibility', '결제 API 설계', '{S1}', 0),
  ('a0000000-8888-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a0000000-dddd-0000-0000-000000000001',
   'preferred', 'Kafka', '{S2}', 1),
  ('a0000000-8888-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'a0000000-dddd-0000-0000-000000000003',
   'required', '다른 요건', '{S1}', 0);

-- complete_insight payload template (S6 db notes). Extra owner keys in an evidence row must be ignored.
create temp table t_payload (v jsonb);
insert into t_payload values ('{
  "result": {"schema_version": 1, "basis_note": "입력된 경력 데이터 기준 분석입니다",
             "data_sufficiency": {"level": "thin", "hints": []},
             "requirement_matches": [{"requirement_id": "a0000000-8888-0000-0000-000000000001", "status": "met",
                                      "item_key": "requirement_matches.a0000000-8888-0000-0000-000000000001"}],
             "summary_counts": {"met": 1, "partial": 0, "no_evidence": 1},
             "strengths": [{"title": "결제", "item_key": "strengths.0",
                            "requirement_ids": ["a0000000-8888-0000-0000-000000000001"]}],
             "gaps": [], "strategy": {"positioning": "p", "item_key": "strategy.positioning", "project_priorities": []}},
  "match_stage_result": {"schema_version": 1, "matches": []},
  "hashes": {"requirements_hash": "rh", "career_snapshot_hash": "ch1", "input_hash": "ih1"},
  "meta": {"schema_version": 1, "prompt_version": "ai-02.match.v1+ai-02.synthesize.v1+common.v1",
           "provider": "gemini", "model": "gemini-x", "model_tier": "default", "connection_tier": "free",
           "validation_report": {"removed_evidence": 0}, "usage": {"input_tokens": 10, "output_tokens": 5}},
  "unknown_top_level": true,
  "evidence": [
    {"item_key": "requirement_matches.a0000000-8888-0000-0000-000000000001", "sort_order": 0,
     "source_type": "project_detail", "source_id": "a0000000-4444-0000-0000-000000000001", "source_field": "action",
     "quote": "인덱스 재설계", "quote_adjusted": false, "source_locator": null, "source_snapshot_at": null,
     "source_label": "결제 / t"},
    {"item_key": "requirement_matches.a0000000-8888-0000-0000-000000000001", "sort_order": 1,
     "source_type": "jd_sentence", "source_id": "a0000000-dddd-0000-0000-000000000001", "source_field": null,
     "quote": null, "source_locator": {"sid": "S1", "start": 0, "end": 9}},
    {"item_key": "strengths.0", "sort_order": 0, "source_type": "jd_requirement",
     "source_id": "a0000000-8888-0000-0000-000000000001", "source_field": null},
    {"item_key": "strengths.0", "sort_order": 1, "source_type": "skill",
     "source_id": "a0000000-6666-0000-0000-000000000001", "source_field": "name",
     "source_snapshot_at": "2026-10-01T00:00:00Z", "quote_adjusted": true,
     "owner_type": "chat_message", "owner_id": "b0000000-0000-0000-0000-000000000009",
     "application_project_id": "b0000000-aaaa-0000-0000-000000000001", "user_id": "b0000000-0000-0000-0000-000000000002"}
  ]
}');
grant select on t_payload to app_ai_writer;

-- ── begin_insight ─────────────────────────────────────────────────────────
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';

insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000001', 'insight', 'a0000000-aaaa-0000-0000-000000000001', 'application_project',
   'a0000000-aaaa-0000-0000-000000000001', 'running', 1, 'gemini', 'default', 'free'),
  ('a0000000-7777-0000-0000-000000000002', 'insight', 'a0000000-aaaa-0000-0000-000000000002', 'application_project',
   'a0000000-aaaa-0000-0000-000000000002', 'running', 1, 'gemini', 'default', 'free'),
  ('a0000000-7777-0000-0000-000000000003', 'jd_extraction', 'a0000000-aaaa-0000-0000-000000000001', 'job_description',
   'a0000000-dddd-0000-0000-000000000001', 'running', 1, 'gemini', 'light', 'free'),
  -- insight job whose target is another project
  ('a0000000-7777-0000-0000-000000000004', 'insight', 'a0000000-aaaa-0000-0000-000000000001', 'application_project',
   'a0000000-aaaa-0000-0000-000000000003', 'running', 1, 'gemini', 'default', 'free');

select throws_ok($$select public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000003')$$,
                 'P0001', 'invalid_ai_job', 'begin: jd_extraction job refused');
select throws_ok($$select public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000004')$$,
                 'P0001', 'invalid_ai_job', 'begin: target_id must be the project');
select throws_ok($$select public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000002')$$,
                 'P0001', 'invalid_ai_job', 'begin: job of another project refused');
select throws_ok($$select public.begin_insight('a0000000-aaaa-0000-0000-000000000001', gen_random_uuid())$$,
                 'P0001', 'invalid_ai_job', 'begin: unknown job');
select throws_ok($$select public.begin_insight('a0000000-aaaa-0000-0000-000000000002', 'a0000000-7777-0000-0000-000000000002')$$,
                 'P0001', 'jd_not_extracted', 'begin: JD not extracted (D-30 runs extraction first)');
select throws_ok($$select public.begin_insight('b0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001')$$,
                 'P0001', 'application_project_not_found', 'begin: another user''s project');

select lives_ok($$select set_config('t.i1', public.begin_insight('a0000000-aaaa-0000-0000-000000000001',
                    'a0000000-7777-0000-0000-000000000001')::text, true)$$, 'begin: creates the generating row');
select results_eq($$select version_no, status, is_latest, provider, model_tier, connection_tier, ai_job_id::text, user_id::text
                      from public.insights where id = current_setting('t.i1')::uuid$$,
                  $$values (1, 'generating'::text, false, 'gemini'::text, 'default'::text, 'free'::text,
                            'a0000000-7777-0000-0000-000000000001'::text, 'a0000000-0000-0000-0000-000000000001'::text)$$,
                  'begin: version 1, generating, meta copied from the job');
select is(public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001')::text,
          current_setting('t.i1'), 'begin: same job is idempotent');
select is((select count(*)::int from public.insights), 1, 'begin: no duplicate row');

-- ── complete_insight: guards and payload shape ──────────────────────────
select is(public.complete_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000001', 2,
            (select v from t_payload)),
          '{"applied": false, "reason": "stale_run"}'::jsonb, 'complete: other run generation -> stale_run');
select throws_ok($$select public.complete_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000004', 1,
                     (select v from t_payload))$$, 'P0001', 'invalid_ai_job', 'complete: job of another row');
select throws_ok($$select public.complete_insight(gen_random_uuid(), 'a0000000-7777-0000-0000-000000000001', 1,
                     (select v from t_payload))$$, 'P0001', 'insight_not_found', 'complete: unknown insight');

create temp table t_bad (label text, v jsonb);
insert into t_bad
select 'null payload', null
union all select 'result missing', (select v - 'result' from t_payload)
union all select 'result not object', (select jsonb_set(v, '{result}', '[]') from t_payload)
union all select 'match_stage_result missing', (select v - 'match_stage_result' from t_payload)
union all select 'evidence key inside result', (select jsonb_set(v, '{result,strengths,0,evidence}', '[]') from t_payload)
union all select 'positioning_evidence inside result', (select jsonb_set(v, '{result,strategy,positioning_evidence}', '[]') from t_payload)
union all select 'empty input_hash', (select jsonb_set(v, '{hashes,input_hash}', '" "') from t_payload)
union all select 'long career hash', (select jsonb_set(v, '{hashes,career_snapshot_hash}', to_jsonb(repeat('x', 129))) from t_payload)
union all select 'hashes missing', (select v - 'hashes' from t_payload)
union all select 'schema_version 0', (select jsonb_set(v, '{meta,schema_version}', '0') from t_payload)
union all select 'schema_version string', (select jsonb_set(v, '{meta,schema_version}', '"1"') from t_payload)
union all select 'prompt_version empty', (select jsonb_set(v, '{meta,prompt_version}', '""') from t_payload)
union all select 'validation_report array', (select jsonb_set(v, '{meta,validation_report}', '[]') from t_payload)
union all select 'evidence not array', (select jsonb_set(v, '{evidence}', '{}') from t_payload)
union all select 'evidence item_key missing', (select jsonb_set(v, '{evidence,0}', (v -> 'evidence' -> 0) - 'item_key') from t_payload)
union all select 'evidence sort_order negative', (select jsonb_set(v, '{evidence,0,sort_order}', '-1') from t_payload)
union all select 'evidence bad uuid', (select jsonb_set(v, '{evidence,0,source_id}', '"x"') from t_payload)
union all select 'evidence user_note', (select jsonb_set(v, '{evidence,0,source_type}', '"user_note"') from t_payload)
union all select 'evidence writing_chat_message', (select jsonb_set(v, '{evidence,0,source_type}', '"writing_chat_message"') from t_payload)
union all select 'evidence bad field (CHECK)', (select jsonb_set(v, '{evidence,0,source_field}', '"company_name"') from t_payload)
union all select 'evidence bad timestamp', (select jsonb_set(v, '{evidence,0,source_snapshot_at}', '"yesterday-ish"') from t_payload)
union all select 'evidence locator string', (select jsonb_set(v, '{evidence,1,source_locator}', '"S1"') from t_payload)
union all select 'evidence quote too long', (select jsonb_set(v, '{evidence,0,quote}', to_jsonb(repeat('x', 2001))) from t_payload);
grant select on t_bad to app_ai_writer;

create function pg_temp.complete_bad(p_label text) returns text language plpgsql as $f$
begin
  perform public.complete_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
                                  (select v from t_bad where label = p_label));
  return 'no error';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$f$;

select set_eq($$select pg_temp.complete_bad(label) from t_bad$$,
              array['P0001:invalid_insight_payload'],
              'complete: every malformed payload -> invalid_insight_payload');

select throws_ok($$select public.complete_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
                     jsonb_set((select v from t_payload), '{meta,provider}', '"openai"'))$$,
                 'P0001', 'invalid_ai_metadata', 'complete: provider differs from the job');
select throws_ok($$select public.complete_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
                     jsonb_set((select v from t_payload), '{meta,model_tier}', '"heavy"'))$$,
                 'P0001', 'invalid_ai_metadata', 'complete: model_tier differs from the job');
select throws_ok($$select public.complete_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
                     jsonb_set((select v from t_payload), '{meta,connection_tier}', '"paid"'))$$,
                 'P0001', 'invalid_ai_metadata', 'complete: connection_tier differs from the job');
select throws_ok($$select public.complete_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
                     jsonb_set((select v from t_payload), '{meta,model}', '"  "'))$$,
                 'P0001', 'invalid_ai_metadata', 'complete: empty model');

-- JD evidence source guard through the RPC.
select throws_ok($$select public.complete_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
                     jsonb_set((select v from t_payload), '{evidence,1,source_locator}', '{"sid":"S9","start":0,"end":9}'))$$,
                 'P0001', 'invalid_evidence_source', 'complete: jd_sentence sid not in the JD');
select throws_ok($$select public.complete_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
                     jsonb_set((select v from t_payload), '{evidence,2,source_id}', '"a0000000-8888-0000-0000-000000000003"'))$$,
                 'P0001', 'invalid_evidence_source', 'complete: jd_requirement of another project');
select is((select count(*)::int from public.evidence_links), 0, 'failed completes stored no evidence');
select is((select status from public.insights where id = current_setting('t.i1')::uuid), 'generating',
          'failed completes left the row generating');

-- ── complete_insight: happy path ─────────────────────────────────────────
select set_config('t.r1', public.complete_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
                    (select v from t_payload))::text, true);
select is((current_setting('t.r1')::jsonb) - 'completed_at' - 'insight_id',
          '{"applied": true, "application_project_id": "a0000000-aaaa-0000-0000-000000000001", "version_no": 1,
            "status": "ready", "is_latest": true, "previous_latest_id": null, "evidence_count": 4}'::jsonb,
          'complete: applied, latest, 4 evidence rows');
select results_eq($$select status, is_latest, requirements_hash, career_snapshot_hash, input_hash, schema_version, prompt_version,
                           provider, model, model_tier, connection_tier, completed_at is not null,
                           result ->> 'basis_note', match_stage_result ->> 'schema_version',
                           validation_report ->> 'removed_evidence', usage ->> 'input_tokens'
                      from public.insights where id = current_setting('t.i1')::uuid$$,
                  $$values ('ready'::text, true, 'rh'::text, 'ch1'::text, 'ih1'::text, 1,
                            'ai-02.match.v1+ai-02.synthesize.v1+common.v1'::text, 'gemini'::text, 'gemini-x'::text,
                            'default'::text, 'free'::text, true, '입력된 경력 데이터 기준 분석입니다'::text, '1'::text,
                            '0'::text, '10'::text)$$,
                  'complete: result, hashes and AI meta stored');
select ok(not ((select result from public.insights where id = current_setting('t.i1')::uuid) ? 'evidence'),
          'result holds no evidence');
select results_eq($$select item_key, sort_order, source_type, source_field, quote, quote_adjusted, source_locator,
                           owner_type, owner_id::text, application_project_id::text, user_id::text,
                           source_deleted_at is null, source_label
                      from public.evidence_links order by item_key desc, sort_order$$,
                  $$values
                    ('strengths.0'::text, 0, 'jd_requirement'::text, null::text, null::text, false, null::jsonb,
                     'insight'::text, current_setting('t.i1'), 'a0000000-aaaa-0000-0000-000000000001'::text,
                     'a0000000-0000-0000-0000-000000000001'::text, true, null::text),
                    ('strengths.0', 1, 'skill', 'name', null, true, null,
                     'insight', current_setting('t.i1'), 'a0000000-aaaa-0000-0000-000000000001',
                     'a0000000-0000-0000-0000-000000000001', true, null),
                    ('requirement_matches.a0000000-8888-0000-0000-000000000001', 0, 'project_detail', 'action',
                     '인덱스 재설계', false, null,
                     'insight', current_setting('t.i1'), 'a0000000-aaaa-0000-0000-000000000001',
                     'a0000000-0000-0000-0000-000000000001', true, '결제 / t'),
                    ('requirement_matches.a0000000-8888-0000-0000-000000000001', 1, 'jd_sentence', null, null, false,
                     '{"sid":"S1","start":0,"end":9}'::jsonb,
                     'insight', current_setting('t.i1'), 'a0000000-aaaa-0000-0000-000000000001',
                     'a0000000-0000-0000-0000-000000000001', true, null)$$,
                  'complete: evidence rows mapped (owner / project / user from the row, not the payload)');
select is((select source_snapshot_at from public.evidence_links where source_type = 'skill'), '2026-10-01 00:00:00+00'::timestamptz,
          'complete: source_snapshot_at from the payload');
select ok((select source_snapshot_at is not null from public.evidence_links where source_type = 'jd_requirement'),
          'complete: missing source_snapshot_at -> now()');
select ok((select last_activity_at > '2026-01-02' from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000001'),
          'complete: project last_activity_at bumped');
select is(public.complete_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1, (select v from t_payload)),
          '{"applied": false, "reason": "stale_run"}'::jsonb, 'complete: second call -> stale_run');
select is((select count(*)::int from public.evidence_links), 4, 'second call added no evidence');
select lives_ok($$select public.complete_ai_job('a0000000-7777-0000-0000-000000000001', 1)$$, 'complete_ai_job after complete_insight');
select is((select status from public.insights where id = current_setting('t.i1')::uuid), 'ready', 'job success keeps ready row');
select is(public.fail_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000001'), false,
          'fail_insight on a ready row is a no-op');

-- ── regenerate: version 2 takes latest ──────────────────────────────────
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000011', 'insight', 'a0000000-aaaa-0000-0000-000000000001', 'application_project',
   'a0000000-aaaa-0000-0000-000000000001', 'running', 3, 'gemini', 'default', 'free');
select set_config('t.i2', public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000011')::text, true);
select is((select version_no from public.insights where id = current_setting('t.i2')::uuid), 2, 'regenerate: version 2');
select is((select id::text from public.insights where is_latest), current_setting('t.i1'), 'while generating, v1 stays latest');
select is(public.complete_insight(current_setting('t.i2')::uuid, 'a0000000-7777-0000-0000-000000000011', 3,
            jsonb_set((select v from t_payload), '{hashes,input_hash}', '"ih2"')) ->> 'previous_latest_id',
          current_setting('t.i1'), 'regenerate: previous_latest_id = v1');
select results_eq($$select version_no, is_latest from public.insights order by version_no$$,
                  $$values (1, false), (2, true)$$, 'regenerate: latest moved to v2, v1 kept (history)');
select lives_ok($$select public.complete_ai_job('a0000000-7777-0000-0000-000000000011', 3)$$, 'complete job 11');

-- ── fail_insight ────────────────────────────────────────────────────────
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000012', 'insight', 'a0000000-aaaa-0000-0000-000000000001', 'application_project',
   'a0000000-aaaa-0000-0000-000000000001', 'running', 1, 'gemini', 'default', 'free');
select set_config('t.i3', public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000012')::text, true);
select is(public.fail_insight(current_setting('t.i3')::uuid, 'a0000000-7777-0000-0000-000000000011'), false,
          'fail: other job -> false');
select is(public.fail_insight(current_setting('t.i3')::uuid, 'a0000000-7777-0000-0000-000000000012'), true, 'fail: true');
select results_eq($$select status, is_latest from public.insights where id = current_setting('t.i3')::uuid$$,
                  $$values ('failed'::text, false)$$, 'fail: row failed, not latest');
select is(public.fail_insight(current_setting('t.i3')::uuid, 'a0000000-7777-0000-0000-000000000012'), false, 'fail: again -> false');
select throws_ok($$select public.fail_insight(gen_random_uuid(), 'a0000000-7777-0000-0000-000000000012')$$,
                 'P0001', 'insight_not_found', 'fail: unknown insight');
select is(public.complete_insight(current_setting('t.i3')::uuid, 'a0000000-7777-0000-0000-000000000012', 1, (select v from t_payload)),
          '{"applied": false, "reason": "stale_run"}'::jsonb, 'complete after fail -> stale_run');
select is((select id::text from public.insights where is_latest), current_setting('t.i2'), 'failed run keeps v2 latest');
update public.ai_jobs set status = 'failed', error_code = 'schema_invalid' where id = 'a0000000-7777-0000-0000-000000000012';

-- ── ai_jobs end trigger ─────────────────────────────────────────────────
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000013', 'insight', 'a0000000-aaaa-0000-0000-000000000001', 'application_project',
   'a0000000-aaaa-0000-0000-000000000001', 'running', 1, 'gemini', 'default', 'free');
select set_config('t.i4', public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000013')::text, true);
update public.ai_jobs set status = 'failed', error_code = 'rate_limited' where id = 'a0000000-7777-0000-0000-000000000013';
select is((select status from public.insights where id = current_setting('t.i4')::uuid), 'failed', 'trigger: job failed -> row failed');

insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000014', 'insight', 'a0000000-aaaa-0000-0000-000000000001', 'application_project',
   'a0000000-aaaa-0000-0000-000000000001', 'queued', 1, 'gemini', 'default', 'free');
select set_config('t.i5', public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000014')::text, true);
update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = 'a0000000-7777-0000-0000-000000000014';
select is((select status from public.insights where id = current_setting('t.i5')::uuid), 'failed', 'trigger: job canceled -> row failed');

insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000015', 'insight', 'a0000000-aaaa-0000-0000-000000000001', 'application_project',
   'a0000000-aaaa-0000-0000-000000000001', 'running', 1, 'gemini', 'default', 'free');
select set_config('t.i6', public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000015')::text, true);
select lives_ok($$select public.complete_ai_job('a0000000-7777-0000-0000-000000000015', 1)$$, 'job succeeded without complete_insight');
select is((select status from public.insights where id = current_setting('t.i6')::uuid), 'failed',
          'trigger: job succeeded without complete_insight -> row failed');
select is((select id::text from public.insights where is_latest), current_setting('t.i2'), 'trigger never touches latest');
reset role;

-- Sweep (service_role path) -> stalled.
insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            heartbeat_at, provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000016', 'a0000000-0000-0000-0000-000000000001', 'insight',
   'a0000000-aaaa-0000-0000-000000000001', 'application_project', 'a0000000-aaaa-0000-0000-000000000001', 'running', 1,
   now() - interval '1 hour', 'gemini', 'default', 'free');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select set_config('t.i7', public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000016')::text, true);
reset role;
set local role service_role;
select lives_ok($$select public.sweep_stalled_ai_jobs(now() - interval '5 minutes')$$, 'sweep marks the job stalled');
reset role;
select results_eq($$select j.status, j.error_code, i.status from public.ai_jobs j join public.insights i on i.ai_job_id = j.id
                     where j.id = 'a0000000-7777-0000-0000-000000000016'$$,
                  $$values ('failed'::text, 'stalled'::text, 'failed'::text)$$, 'trigger: sweep stalled -> row failed');

-- Stalled-row takeover: a generating row whose job ended without the trigger (simulated) is failed by the next begin.
insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000017', 'a0000000-0000-0000-0000-000000000001', 'insight',
   'a0000000-aaaa-0000-0000-000000000001', 'application_project', 'a0000000-aaaa-0000-0000-000000000001', 'running', 1,
   'gemini', 'default', 'free');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select set_config('t.i8', public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000017')::text, true);
reset role;
alter table public.ai_jobs disable trigger ai_jobs_release_insight;
update public.ai_jobs set status = 'failed', error_code = 'timeout' where id = 'a0000000-7777-0000-0000-000000000017';
alter table public.ai_jobs enable trigger ai_jobs_release_insight;
select is((select status from public.insights where id = current_setting('t.i8')::uuid), 'generating',
          'simulated: row left generating with an ended job');
-- A generating row whose job is still queued / running blocks a new begin (defensive: the in-flight index
-- normally stops a second job first). Simulated with a running job of another target that owns a P1 row.
insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000018', 'a0000000-0000-0000-0000-000000000001', 'insight',
   'a0000000-aaaa-0000-0000-000000000003', 'application_project', 'a0000000-aaaa-0000-0000-0000000000ff', 'running', 1,
   'gemini', 'default', 'free'),
  ('a0000000-7777-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000001', 'insight',
   'a0000000-aaaa-0000-0000-000000000001', 'application_project', 'a0000000-aaaa-0000-0000-000000000001', 'running', 1,
   'gemini', 'default', 'free');
insert into public.insights (id, user_id, application_project_id, version_no, status, ai_job_id, provider, model_tier, connection_tier)
  values ('a0000000-1515-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
          100, 'generating', 'a0000000-7777-0000-0000-000000000018', 'gemini', 'default', 'free');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000020')$$,
                 'P0001', 'insight_in_progress', 'begin: another live run''s generating row -> insight_in_progress');
update public.ai_jobs set status = 'failed', error_code = 'timeout' where id = 'a0000000-7777-0000-0000-000000000018';
select is((select status from public.insights where id = 'a0000000-1515-0000-0000-000000000001'), 'failed',
          'trigger released the simulated row');
select set_config('t.i9', public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000020')::text, true);
select is((select status from public.insights where id = current_setting('t.i8')::uuid), 'failed',
          'begin: stale generating row of an ended job taken over (failed)');
select is((select version_no from public.insights where id = current_setting('t.i9')::uuid), 101,
          'begin: version_no = max + 1 over all rows (failed included)');

-- ── cross-user isolation ────────────────────────────────────────────────
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select is((select count(*)::int from public.insights), 0, 'B (app_ai_writer) sees no A insights');
select throws_ok($$select public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000020')$$,
                 'P0001', 'application_project_not_found', 'B cannot begin on A''s project');
select throws_ok($$select public.complete_insight(current_setting('t.i9')::uuid, 'a0000000-7777-0000-0000-000000000020', 1,
                     (select v from t_payload))$$, 'P0001', 'insight_not_found', 'B cannot complete A''s insight');
select throws_ok($$select public.fail_insight(current_setting('t.i9')::uuid, 'a0000000-7777-0000-0000-000000000020')$$,
                 'P0001', 'insight_not_found', 'B cannot fail A''s insight');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"role":"app_ai_writer"}';
select throws_ok($$select public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000020')$$,
                 '42501', 'not_authenticated', 'no sub -> not_authenticated');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.insights), 0, 'B (user) sees no A insights');
select is((select count(*)::int from public.evidence_links), 0, 'B (user) sees no A evidence');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.insights where status = 'ready'), 2, 'A reads own insights');
select throws_ok($$insert into public.insights (application_project_id, version_no) values ('a0000000-aaaa-0000-0000-000000000001', 50)$$,
                 '42501', null, 'user cannot insert insights');
select throws_ok($$update public.insights set is_latest = false$$, '42501', null, 'user cannot update insights');
select throws_ok($$delete from public.insights$$, '42501', null, 'user cannot delete insights directly');
select throws_ok($$select public.begin_insight('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000020')$$,
                 '42501', null, 'user session cannot call begin_insight');
reset role;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$update public.insights set is_latest = false$$, '42501', null, 'app_ai_writer cannot update insights directly');
select throws_ok($$insert into public.insights (application_project_id, version_no) values ('a0000000-aaaa-0000-0000-000000000001', 50)$$,
                 '42501', null, 'app_ai_writer cannot insert insights directly');
reset role;

-- ── CHECKs ──────────────────────────────────────────────────────────────
select throws_ok($$update public.insights set is_latest = true where id = current_setting('t.i9')::uuid$$,
                 '23514', null, 'is_latest only on ready rows');
select throws_ok($$update public.insights set is_latest = true where id = current_setting('t.i1')::uuid$$,
                 '23505', null, 'one latest per project');
select throws_ok($$update public.insights set result = null where id = current_setting('t.i1')::uuid$$,
                 '23514', null, 'ready row needs result');
select throws_ok($$update public.insights set status = 'done' where id = current_setting('t.i9')::uuid$$,
                 '23514', null, 'status CHECK');
select throws_ok($$insert into public.insights (user_id, application_project_id, version_no, status)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 1, 'failed')$$,
                 '23505', null, 'version_no unique per project');
select throws_ok($$insert into public.insights (user_id, application_project_id, version_no)
                   values ('b0000000-0000-0000-0000-000000000002', 'a0000000-aaaa-0000-0000-000000000001', 70)$$,
                 '23503', null, 'composite FK: project of another user');

-- ── evidence inserts: JD source guard ───────────────────────────────────
-- R1 A24: app_ai_writer has no direct INSERT; the guard is exercised as the owner (the result RPC path) with A's JWT.
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
create function pg_temp.ins_jd(p_type text, p_source uuid, p_locator jsonb, p_project uuid default 'a0000000-aaaa-0000-0000-000000000001')
returns uuid language sql as $f$
  insert into public.evidence_links (application_project_id, owner_type, owner_id, item_key, source_type, source_id, source_locator, quote)
  values (p_project, 'insight', current_setting('t.i9')::uuid, 'gaps.0', p_type, p_source, p_locator, 'q')
  returning id;
$f$;
select lives_ok($$select pg_temp.ins_jd('jd_sentence', 'a0000000-dddd-0000-0000-000000000001', '{"sid":"S2","start":12,"end":21}')$$,
                'jd_sentence: sub-range of S2 accepted');
select throws_ok($$select pg_temp.ins_jd('jd_sentence', 'a0000000-dddd-0000-0000-000000000001', '{"sid":"S2","start":5,"end":12}')$$,
                 'P0001', 'invalid_evidence_source', 'jd_sentence: range outside the sentence');
select throws_ok($$select pg_temp.ins_jd('jd_sentence', 'a0000000-dddd-0000-0000-000000000001', '{"sid":"S1","start":3,"end":3}')$$,
                 'P0001', 'invalid_evidence_source', 'jd_sentence: empty range');
select throws_ok($$select pg_temp.ins_jd('jd_sentence', 'a0000000-dddd-0000-0000-000000000001', null)$$,
                 'P0001', 'invalid_evidence_source', 'jd_sentence: locator required');
select throws_ok($$select pg_temp.ins_jd('jd_sentence', 'a0000000-dddd-0000-0000-000000000001', '{"sid":"S1","start":"0","end":9}')$$,
                 'P0001', 'invalid_evidence_source', 'jd_sentence: start must be a number');
select throws_ok($$select pg_temp.ins_jd('jd_sentence', 'a0000000-dddd-0000-0000-000000000003', '{"sid":"S1","start":0,"end":5}')$$,
                 'P0001', 'invalid_evidence_source', 'jd_sentence: JD of another project');
select set_config('t.e', pg_temp.ins_jd('jd_sentence', 'b0000000-dddd-0000-0000-000000000001',
                                                                 '{"sid":"S1","start":0,"end":4}')::text, true);
select ok((select source_deleted_at is not null and quote is null from public.evidence_links where id = current_setting('t.e')::uuid),
          'jd_sentence: B''s JD = not found for A -> stored as deleted');
select set_config('t.e', pg_temp.ins_jd('jd_requirement', 'a0000000-8888-0000-0000-000000000002', null)::text, true);
select ok((select source_deleted_at is null and quote = 'q' from public.evidence_links where id = current_setting('t.e')::uuid),
          'jd_requirement: same project accepted');
select throws_ok($$select pg_temp.ins_jd('jd_requirement', 'a0000000-8888-0000-0000-000000000003', null)$$,
                 'P0001', 'invalid_evidence_source', 'jd_requirement: another project');
select set_config('t.e', pg_temp.ins_jd('jd_requirement', gen_random_uuid(), null)::text, true);
select ok((select source_deleted_at is not null and quote is null from public.evidence_links where id = current_setting('t.e')::uuid),
          'jd_requirement: missing row -> stored as deleted');
reset role;

-- Requirement deletion marks its links (not an MVP path, rule only).
delete from public.jd_requirements where id = 'a0000000-8888-0000-0000-000000000002';
select is((select count(*)::int from public.evidence_links
            where source_id = 'a0000000-8888-0000-0000-000000000002' and source_deleted_at is not null and quote is null), 1,
          'jd_requirements delete marks its links');

-- ── deletion cascades ───────────────────────────────────────────────────
select ok((select count(*) from public.evidence_links where owner_type = 'insight'
             and owner_id = current_setting('t.i1')::uuid) > 0, 'v1 has evidence before project delete');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$delete from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                'user deletes the application project');
reset role;
select is((select count(*)::int from public.insights where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 0,
          'project delete cascades insights');
select is((select count(*)::int from public.evidence_links where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 0,
          'project delete cascades evidence links');

insert into public.insights (user_id, application_project_id, version_no, status)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000003', 1, 'failed');
delete from auth.users where id = 'a0000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.insights where user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'account deletion cascades insights');

select * from finish();
rollback;
