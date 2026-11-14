-- R17 (2026-11-14, plan _workspace/backend/R17/01_plan.md §2): JD AI processing removed, raw text used as is.
-- Dropped extraction / preview RPCs, the 9-argument create_application_project, begin_insight's JD-row gate,
-- complete_insight's jd_text_hash, the relaxed insights_ready_check, the document chat greeting, and the kept
-- (not written) jd_requirements table.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- ── 1. removed functions and trigger ──
select hasnt_function('public', 'begin_jd_extraction', 'begin_jd_extraction dropped');
select hasnt_function('public', 'apply_jd_extraction', 'apply_jd_extraction dropped');
select hasnt_function('public', 'fail_jd_extraction', 'fail_jd_extraction dropped');
select hasnt_function('public', 'purge_unused_jd_preview_outputs', 'purge_unused_jd_preview_outputs dropped');
select hasnt_function('private', 'jd_apply_extraction_result', 'jd_apply_extraction_result dropped');
select hasnt_function('private', 'jd_extraction_job_matches', 'jd_extraction_job_matches dropped');
select hasnt_function('private', 'jd_extraction_mark_failed', 'jd_extraction_mark_failed dropped');
select hasnt_function('private', 'jd_extraction_result_valid', 'jd_extraction_result_valid dropped');
select hasnt_function('private', 'ai_jobs_release_jd_extraction', 'ai_jobs_release_jd_extraction dropped');
select hasnt_trigger('public', 'ai_jobs', 'ai_jobs_release_jd_extraction', 'the jd_extraction release trigger is gone');
select hasnt_function('public', 'create_application_project',
                      array['uuid', 'text', 'text', 'jsonb', 'text', 'text', 'text', 'date', 'text', 'uuid'],
                      'the 10-argument create_application_project (p_preview_job_id) is gone');
select has_function('public', 'create_application_project',
                    array['uuid', 'text', 'text', 'jsonb', 'text', 'text', 'text', 'date', 'text'],
                    'create_application_project has 9 arguments');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'create_application_project'), 1,
          'exactly one create_application_project overload');
select ok(has_function_privilege('authenticated',
            'public.create_application_project(uuid, text, text, jsonb, text, text, text, date, text)', 'execute')
          and not has_function_privilege('anon',
            'public.create_application_project(uuid, text, text, jsonb, text, text, text, date, text)', 'execute')
          and not has_function_privilege('app_ai_writer',
            'public.create_application_project(uuid, text, text, jsonb, text, text, text, date, text)', 'execute'),
          'create_application_project: authenticated only (not anon, not app_ai_writer)');
select is_empty($$select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('public', 'private')
                     and (p.prosrc like '%jd_extraction_mark_failed%' or p.prosrc like '%jd_apply_extraction_result%'
                          or p.prosrc like '%jd_extraction_result_valid%' or p.prosrc like '%jd_extraction_job_matches%')$$,
                'no live function calls a dropped helper');
select is_empty($$select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname in ('begin_insight', 'start_document_writing_chat',
                                                                 'create_application_project')
                     and p.prosrc like '%extraction_status%'$$,
                'no gate reads extraction_status (R17-3)');

-- Legacy CHECK values stay (R17-7): an old jd_extraction job row still exists and can end without a trigger error.
insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001', '과거', 'user');
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                     extraction_status) values
  ('a0000000-dddd-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-aaaa-0000-0000-0000000000f1', '과거 공고', 'hf', '[{"sid":"S1","text":"과거 공고","start":0,"end":5}]',
   'running');
insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status,
                            run_generation, provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001', 'jd_extraction',
   'a0000000-aaaa-0000-0000-0000000000f1', 'job_description', 'a0000000-dddd-0000-0000-0000000000f1', 'running', 1,
   'gemini', 'light', 'free');
update public.job_descriptions set extraction_job_id = 'a0000000-7777-0000-0000-0000000000f1'
 where id = 'a0000000-dddd-0000-0000-0000000000f1';
select lives_ok($$update public.ai_jobs set status = 'failed', error_code = 'not_a_jd'
                   where id = 'a0000000-7777-0000-0000-0000000000f1'$$,
                'an old jd_extraction job can still fail (legacy CHECK values kept, no release trigger)');
select is((select extraction_status from public.job_descriptions where id = 'a0000000-dddd-0000-0000-0000000000f1'),
          'running', 'its JD is left as is (nothing reads extraction_status any more)');

-- ── 2. create_application_project (9 args, no gate) ──
create temp table t_s (v jsonb);
insert into t_s values ('[{"sid":"S1","text":"결제 API 설계","start":0,"end":9},{"sid":"S2","text":"Kafka 우대","start":10,"end":18}]');
grant select on t_s to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.r1', public.create_application_project('a0000000-aaaa-0000-0000-000000000001',
                    '결제 API 설계 Kafka 우대', 'rawhash1', (select v from t_s), null, '백엔드')::text, true);
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('t.r1')::jsonb) k),
          array['ai_run_allowed', 'application_project_id', 'created', 'job_description_id', 'name', 'name_source'],
          'return keys: application_project_id, job_description_id, name, name_source, ai_run_allowed, created');
select is((current_setting('t.r1')::jsonb) - 'application_project_id' - 'job_description_id',
          jsonb_build_object('name', '새 자기소개서 (' || to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ')',
                             'name_source', 'default', 'ai_run_allowed', false, 'created', true),
          'no name, no company -> application_fallback_name (position alone does not name it)');
select is((select array[raw_text_hash, extraction_status, position_title, position_title_source]
             from public.job_descriptions where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'),
          array['rawhash1', 'pending', '백엔드', 'user'],
          'JD stored with raw text hash; extraction_status stays the default pending (R17-3)');
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000002', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]', '에이비씨', null, '  내 이름 ') ->> 'name',
          '내 이름', 'p_name wins over the company');
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000003', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]', '에이비씨') ->> 'name',
          '에이비씨 자기소개서', 'company -> "{회사명} 자기소개서"');
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000001', '다른', 'h2',
            '[{"sid":"S1","text":"다른","start":0,"end":2}]') - 'application_project_id' - 'job_description_id' - 'name',
          '{"name_source":"default","ai_run_allowed":false,"created":false}'::jsonb,
          'replay with the same id: created false, same keys');
reset role;

-- A key that is invalid, and no consent: creation still succeeds.
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek,
                                     kek_id, key_last4, status)
values ('a0000000-9999-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'gemini', 'free', '\x01',
        '\x02', '\x03', 'env-v1', 'ag01', 'invalid');
update public.profiles set active_ai_provider = 'gemini' where id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000004', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]') ->> 'created',
          'true', 'invalid key: no key_invalid gate (R17-9)');
reset role;
update public.ai_provider_keys set status = 'valid' where id = 'a0000000-9999-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.create_application_project('a0000000-aaaa-0000-0000-000000000005', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]') ->> 'created',
          'true', 'valid key without consent: no ai_consent_required gate (R17-9)');
-- R17-6: a new posting is pending, so the raw-text edit RPC refuses it (behaviour kept).
select throws_ok($$select public.update_failed_jd_raw_text('a0000000-aaaa-0000-0000-000000000001', '고친 원문', 'h3',
                     '[{"sid":"S1","text":"고친 원문","start":0,"end":5}]')$$,
                 'P0001', 'jd_raw_text_locked', 'update_failed_jd_raw_text still refuses a pending JD (R17-6)');
reset role;
-- consent so the insight job below is a normal one (not needed by the RPCs, keeps the fixture realistic)
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged)
values ('a0000000-0000-0000-0000-000000000001', 'gemini', 'free', 'v2026-11-05', true);

-- A project with no JD row at all (only reachable by direct insert).
insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-0000000000a9', 'a0000000-0000-0000-0000-000000000001', '공고 없음', 'user');

-- ── 3. begin_insight: JD row gate ──
create temp table t_payload (v jsonb);
insert into t_payload values ('{
  "result": {"schema_version": 2, "requirement_matches": [{"item_key": "requirement_matches.M1", "requirement_id": "M1",
             "requirement": {"content": "결제 API 설계", "category": "responsibility", "importance": "high",
                             "sentence_ids": ["S1"]}, "status": "met"}]},
  "match_stage_result": {"matches": []},
  "hashes": {"jd_text_hash": "rawhash1", "career_snapshot_hash": "ch", "input_hash": "ih"},
  "meta": {"schema_version": 2, "prompt_version": "ai-02.v2", "provider": "gemini", "model": "gemini-x",
           "model_tier": "default", "connection_tier": "free"},
  "evidence": [{"item_key": "requirement_matches.M1", "sort_order": 0, "source_type": "jd_sentence",
                "source_id": "00000000-0000-0000-0000-000000000000", "source_field": null, "quote": "결제 API 설계",
                "source_locator": {"sid": "S1", "start": 0, "end": 9}}]
}');
update t_payload set v = jsonb_set(v, '{evidence,0,source_id}',
  to_jsonb((select id::text from public.job_descriptions
             where application_project_id = 'a0000000-aaaa-0000-0000-000000000001')));
grant select on t_payload to app_ai_writer;

-- payload validator (private; checked as postgres)
select ok(not private.insight_payload_valid(
            jsonb_set((select v from t_payload), '{hashes}', '{"requirements_hash":"rh","career_snapshot_hash":"ch","input_hash":"ih"}')),
          'payload validator: requirements_hash without jd_text_hash is refused');
select ok(private.insight_payload_valid(
            jsonb_set((select v from t_payload), '{hashes,requirements_hash}', '"rh"')),
          'payload validator: an extra requirements_hash key next to jd_text_hash is ignored');
select ok(not private.insight_payload_valid(jsonb_set((select v from t_payload), '{hashes,jd_text_hash}', '" "')),
          'payload validator: blank jd_text_hash refused');
select ok(not private.insight_payload_valid(jsonb_set((select v from t_payload), '{hashes,jd_text_hash}',
                                                      to_jsonb(repeat('x', 129)))),
          'payload validator: jd_text_hash over 128 refused');

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier) values
  ('a0000000-7777-0000-0000-000000000001', 'insight', 'a0000000-aaaa-0000-0000-000000000001', 'application_project',
   'a0000000-aaaa-0000-0000-000000000001', 'running', 1, 'gemini', 'default', 'free'),
  ('a0000000-7777-0000-0000-0000000000a9', 'insight', 'a0000000-aaaa-0000-0000-0000000000a9', 'application_project',
   'a0000000-aaaa-0000-0000-0000000000a9', 'running', 1, 'gemini', 'default', 'free');
select throws_ok($$select public.begin_insight('a0000000-aaaa-0000-0000-0000000000a9', 'a0000000-7777-0000-0000-0000000000a9')$$,
                 'P0001', 'job_description_not_found', 'begin_insight: no JD row -> job_description_not_found');
select lives_ok($$select set_config('t.i1', public.begin_insight('a0000000-aaaa-0000-0000-000000000001',
                    'a0000000-7777-0000-0000-000000000001')::text, true)$$,
                'begin_insight: a pending JD passes (no extraction needed)');

-- ── 4. complete_insight: jd_text_hash ──
select throws_ok($$select public.complete_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
                     jsonb_set((select v from t_payload), '{hashes}',
                               '{"requirements_hash":"rh","career_snapshot_hash":"ch","input_hash":"ih"}'))$$,
                 'P0001', 'invalid_insight_payload', 'complete_insight: an old-style (requirements_hash) payload is refused');
select is(public.complete_insight(current_setting('t.i1')::uuid, 'a0000000-7777-0000-0000-000000000001', 1,
            jsonb_set((select v from t_payload), '{hashes,requirements_hash}', '"rh"')) - 'completed_at' - 'insight_id'
            - 'previous_latest_id',
          '{"applied": true, "application_project_id": "a0000000-aaaa-0000-0000-000000000001", "version_no": 1,
            "status": "ready", "is_latest": true, "evidence_count": 1}'::jsonb,
          'complete_insight: applied (return shape unchanged)');
select results_eq($$select status, jd_text_hash, requirements_hash, schema_version, career_snapshot_hash, input_hash
                      from public.insights where id = current_setting('t.i1')::uuid$$,
                  $$values ('ready'::text, 'rawhash1'::text, null::text, 2, 'ch'::text, 'ih'::text)$$,
                  'complete_insight: jd_text_hash stored, requirements_hash left null (even if sent)');
select is((select array[source_type, source_locator ->> 'sid', quote] from public.evidence_links
            where owner_id = current_setting('t.i1')::uuid),
          array['jd_sentence', 'S1', '결제 API 설계'], 'jd_sentence evidence stored with the sentence quote');
reset role;

-- ── 5. insights: column and ready check ──
select has_column('public', 'insights', 'jd_text_hash', 'insights.jd_text_hash added');
select col_type_is('public', 'insights', 'jd_text_hash', 'text', 'jd_text_hash is text');
select ok(has_column_privilege('authenticated', 'public.insights', 'jd_text_hash', 'SELECT')
          and has_column_privilege('app_ai_writer', 'public.insights', 'jd_text_hash', 'SELECT')
          and not has_column_privilege('authenticated', 'public.insights', 'jd_text_hash', 'UPDATE')
          and not has_column_privilege('app_ai_writer', 'public.insights', 'jd_text_hash', 'UPDATE'),
          'jd_text_hash: readable by the user and app_ai_writer, written only through the RPC');
select throws_ok($$insert into public.insights (user_id, application_project_id, version_no, status, jd_text_hash,
                     provider, model_tier, connection_tier)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002', 1,
                           'generating', '', 'gemini', 'default', 'free')$$,
                 '23514', null, 'jd_text_hash CHECK: empty refused');
-- v1 row (requirements_hash only) is still a valid ready row; a ready row with neither hash is not.
select lives_ok($$insert into public.insights (user_id, application_project_id, version_no, status, result,
                    match_stage_result, requirements_hash, career_snapshot_hash, input_hash, schema_version,
                    prompt_version, provider, model, model_tier, connection_tier, completed_at)
                  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002', 1, 'ready',
                          '{}', '{}', 'rh', 'ch', 'ih', 1, 'pv', 'gemini', 'm', 'default', 'free', now())$$,
                'ready_check: a v1 row with requirements_hash only is valid');
select throws_ok($$insert into public.insights (user_id, application_project_id, version_no, status, result,
                     match_stage_result, career_snapshot_hash, input_hash, schema_version,
                     prompt_version, provider, model, model_tier, connection_tier, completed_at)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000003', 1, 'ready',
                           '{}', '{}', 'ch', 'ih', 1, 'pv', 'gemini', 'm', 'default', 'free', now())$$,
                 '23514', null, 'ready_check: a ready row with neither hash is refused');

-- ── 6. start_document_writing_chat greeting ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.chat', public.start_document_writing_chat('a0000000-aaaa-0000-0000-000000000003',
                    'cover_letter')::text, true);
select ok((select content not like '채용 공고의 요건을 아직%' and content like '자기소개서 문항에 답할%'
             from public.writing_chat_messages
            where writing_chat_id = current_setting('t.chat')::uuid and sequence = 1),
          'greeting: a pending JD is "ready" (R17) — the 요건 정리 전 branch is not used');
reset role;

-- ── 7. jd_requirements kept (R17-2): RLS and cascade still hold for old rows ──
insert into public.jd_requirements (id, user_id, job_description_id, category, content, source_sids, sort_order)
select 'a0000000-8888-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', jd.id, 'required', '과거 요건',
       '{S1}', 0
  from public.job_descriptions jd where jd.application_project_id = 'a0000000-aaaa-0000-0000-0000000000f1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.jd_requirements), 0, 'B cannot read A''s old requirements');
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.jd_requirements), 1, 'A still reads own old requirements (v1 insights)');
select throws_ok($$insert into public.jd_requirements (job_description_id, category, content, source_sids, sort_order)
                   select id, 'required', 'x', '{S1}', 0 from public.job_descriptions limit 1$$,
                 '42501', null, 'users still cannot write jd_requirements');
select lives_ok($$delete from public.application_projects where id = 'a0000000-aaaa-0000-0000-0000000000f1'$$,
                'A deletes the old project');
select is((select count(*)::int from public.jd_requirements), 0, 'old requirements cascade with the project');
reset role;

select * from finish();
rollback;
