-- S7 career description (AI-03; DM A.9 / A.10, §2.8, §5): begin / complete / fail_career_description (job shape,
-- options / sections validation, idempotency, payload shape, evidence storage, V-8 learnings guard, run-generation
-- guard, manual retry reopen), regeneration as a new row, the ai_jobs end trigger, cross-user isolation, deletes.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.experiences (id, company_name, start_month, job_rank)
  values ('a0000000-1111-0000-0000-000000000001', 'A사', '2020-01-01', 'S');
insert into public.educations (id, institution_name, education_type, start_month)
  values ('a0000000-2222-0000-0000-000000000001', '한빛대', 'degree', '2015-03-01');
insert into public.projects (id, experience_id, education_id, name, role) values
  ('a0000000-3333-0000-0000-000000000001', 'a0000000-1111-0000-0000-000000000001', null, '결제', 'Dev'),
  ('a0000000-3333-0000-0000-000000000002', null, 'a0000000-2222-0000-0000-000000000001', '졸업 프로젝트', 'Lead'),
  ('a0000000-3333-0000-0000-000000000003', null, null, '사이드', 'Dev');
insert into public.project_details (id, project_id, title, situation, action, result, learnings) values
  ('a0000000-4444-0000-0000-000000000001', 'a0000000-3333-0000-0000-000000000001', 't1', 's1', '인덱스 재설계', 'r1', '배운 점');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
insert into public.experiences (id, company_name, start_month, job_rank)
  values ('b0000000-1111-0000-0000-000000000001', 'B사', '2020-01-01', 'S');
reset role;

insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '에이', 'ai'),
  ('a0000000-aaaa-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '대기', 'user'),
  ('b0000000-aaaa-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'B', 'user');
update public.application_projects set last_activity_at = '2026-01-01' where id = 'a0000000-aaaa-0000-0000-000000000001';
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                     extraction_status, extraction, tech_keywords, requirements_hash,
                                     extraction_provider, extraction_model) values
  ('a0000000-dddd-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
   '결제 API 설계', 'h', '[{"sid":"S1","text":"결제 API 설계","start":0,"end":9}]', 'succeeded', '{}', '[]', 'rh', 'gemini', 'm');
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences) values
  ('a0000000-dddd-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002',
   '대기', 'h', '[{"sid":"S1","text":"대기","start":0,"end":2}]');
insert into public.jd_requirements (id, user_id, job_description_id, category, content, source_sids, sort_order) values
  ('a0000000-8888-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a0000000-dddd-0000-0000-000000000001',
   'responsibility', '결제 API 설계', '{S1}', 0);

create temp table t_opt (v jsonb);
insert into t_opt values ('{"included_experience_ids":["a0000000-1111-0000-0000-000000000001"],
  "included_education_ids":["a0000000-2222-0000-0000-000000000001"],
  "included_project_ids":["a0000000-3333-0000-0000-000000000001","a0000000-3333-0000-0000-000000000002","a0000000-3333-0000-0000-000000000003"],
  "project_order":["a0000000-3333-0000-0000-000000000001"], "selection_origin":"ai_ranking",
  "ranking":[{"project_id":"a0000000-3333-0000-0000-000000000001","relevance":"high"}], "tone":"concise"}');
create temp table t_sec (v jsonb);
insert into t_sec values ('[{"section_kind":"experience","experience_id":"a0000000-1111-0000-0000-000000000001","heading":"A사"},
  {"section_kind":"education","education_id":"a0000000-2222-0000-0000-000000000001","heading":"한빛대"},
  {"section_kind":"standalone_projects","heading":null}]');
grant select on t_opt, t_sec to app_ai_writer;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier)
select v.id::uuid, v.jt, v.ap::uuid, v.tt, v.tid::uuid, v.st, 1, 'gemini', 'default', 'free'
  from (values
    ('a0000000-7777-0000-0000-000000000001', 'career_description', 'a0000000-aaaa-0000-0000-000000000001', 'draft', 'a0000000-eeee-0000-0000-000000000001', 'running'),
    ('a0000000-7777-0000-0000-000000000002', 'career_description', 'a0000000-aaaa-0000-0000-000000000001', 'application_project', 'a0000000-aaaa-0000-0000-000000000001', 'canceled'),
    ('a0000000-7777-0000-0000-000000000003', 'career_description', 'a0000000-aaaa-0000-0000-000000000002', 'draft', 'a0000000-eeee-0000-0000-000000000003', 'running'),
    ('a0000000-7777-0000-0000-000000000004', 'cover_letter', 'a0000000-aaaa-0000-0000-000000000001', 'draft', 'a0000000-eeee-0000-0000-000000000004', 'running')
  ) v (id, jt, ap, tt, tid, st);

-- QA-S7-01: one queued / running career description per application project.
select throws_ok($$insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                     provider, model_tier, connection_tier) values
                    ('a0000000-7777-0000-0000-000000000005', 'career_description', 'a0000000-aaaa-0000-0000-000000000001', 'draft',
                     'a0000000-eeee-0000-0000-000000000005', 'queued', 1, 'gemini', 'default', 'free')$$,
                 '23505', 'duplicate key value violates unique constraint "ai_jobs_career_description_in_flight_key"',
                 'QA-S7-01: second in-flight career description in the same project refused');
select is((select count(distinct application_project_id)::int from public.ai_jobs
            where job_type = 'career_description' and status in ('queued', 'running')), 2,
          'QA-S7-01: other projects may each run one at the same time');

-- ── begin: guards ──
select throws_ok($$select public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000002',
                     (select v from t_opt), (select v from t_sec))$$, 'P0001', 'invalid_ai_job', 'begin: target_type must be draft');
select throws_ok($$select public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000003',
                     (select v from t_opt), (select v from t_sec))$$, 'P0001', 'invalid_ai_job', 'begin: job of another project');
select throws_ok($$select public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000004',
                     (select v from t_opt), (select v from t_sec))$$, 'P0001', 'invalid_ai_job', 'begin: not a career_description job');
select throws_ok($$select public.begin_career_description('a0000000-aaaa-0000-0000-000000000002', 'a0000000-7777-0000-0000-000000000003',
                     (select v from t_opt), (select v from t_sec))$$, 'P0001', 'jd_not_extracted', 'begin: JD not extracted (D-30)');
select throws_ok($$select public.begin_career_description('b0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001',
                     (select v from t_opt), (select v from t_sec))$$, 'P0001', 'application_project_not_found', 'begin: B''s project');

create temp table t_begin_bad (label text, o jsonb, s jsonb, code text);
insert into t_begin_bad
select 'options unknown key', (select v || '{"color":"red"}' from t_opt), (select v from t_sec), 'invalid_draft_options'
union all select 'options no project ids', (select v - 'included_project_ids' from t_opt), (select v from t_sec), 'invalid_draft_options'
union all select 'options no origin', (select v - 'selection_origin' from t_opt), (select v from t_sec), 'invalid_draft_options'
union all select 'options bad origin', (select jsonb_set(v, '{selection_origin}', '"magic"') from t_opt), (select v from t_sec), 'invalid_draft_options'
union all select 'options bad uuid', (select jsonb_set(v, '{included_project_ids}', '["x"]') from t_opt), (select v from t_sec), 'invalid_draft_options'
union all select 'options long tone', (select jsonb_set(v, '{tone}', to_jsonb(repeat('x', 51))) from t_opt), (select v from t_sec), 'invalid_draft_options'
union all select 'sections empty', (select v from t_opt), '[]', 'invalid_draft_sections'
union all select 'sections not array', (select v from t_opt), '{}', 'invalid_draft_sections'
union all select 'experience without id', (select v from t_opt), '[{"section_kind":"experience"}]', 'invalid_draft_sections'
union all select 'B experience', (select v from t_opt), '[{"section_kind":"experience","experience_id":"b0000000-1111-0000-0000-000000000001"}]', 'invalid_draft_sections'
union all select 'duplicate experience', (select v from t_opt), '[{"section_kind":"experience","experience_id":"a0000000-1111-0000-0000-000000000001"},
                                                                {"section_kind":"experience","experience_id":"A0000000-1111-0000-0000-000000000001"}]', 'invalid_draft_sections'
union all select 'two standalone', (select v from t_opt), '[{"section_kind":"standalone_projects"},{"section_kind":"standalone_projects"}]', 'invalid_draft_sections'
union all select 'standalone with experience', (select v from t_opt), '[{"section_kind":"standalone_projects","experience_id":"a0000000-1111-0000-0000-000000000001"}]', 'invalid_draft_sections'
union all select 'question kind', (select v from t_opt), '[{"section_kind":"cover_letter_question"}]', 'invalid_draft_sections'
union all select 'long heading', (select v from t_opt), jsonb_build_array(jsonb_build_object('section_kind', 'standalone_projects', 'heading', repeat('x', 301))), 'invalid_draft_sections';
grant select on t_begin_bad to app_ai_writer;

create function pg_temp.begin_err(p_label text) returns text language plpgsql as $f$
begin
  perform public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001',
                                          (select o from t_begin_bad where label = p_label),
                                          (select s from t_begin_bad where label = p_label));
  return 'no error';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$f$;
select is_empty($$select label, pg_temp.begin_err(label), code from t_begin_bad where pg_temp.begin_err(label) <> 'P0001:' || code$$,
                'begin: bad options / sections -> their error codes');
select throws_ok($$select public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001',
                     (select v from t_opt), (select v from t_sec), gen_random_uuid())$$, 'P0001', 'insight_not_found',
                 'begin: unknown insight');
select throws_ok($$select public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001',
                     (select v from t_opt), (select v from t_sec), null, gen_random_uuid())$$, 'P0001', 'draft_not_found',
                 'begin: unknown regenerated_from');
select throws_ok($$select public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001',
                     (select v from t_opt), (select v from t_sec), null, null, repeat('x', 101))$$, 'P0001', 'invalid_title',
                 'begin: title > 100');
select is((select count(*)::int from public.drafts), 0, 'begin: errors create nothing');

-- ── begin: happy path ──
create temp table t_b (v jsonb);
grant select, insert on t_b to app_ai_writer;
insert into t_b select public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001',
                         (select v from t_opt), (select v from t_sec));
select is((select v ->> 'draft_id' from t_b), 'a0000000-eeee-0000-0000-000000000001', 'begin: draft id = job target_id');
select is((select jsonb_array_length(v -> 'sections') from t_b), 3, 'begin: 3 sections');
select results_eq($$select sort_order, section_kind, experience_id::text, education_id::text, heading, status
                      from public.draft_sections where draft_id = 'a0000000-eeee-0000-0000-000000000001' order by sort_order$$,
                  $$values (0, 'experience'::text, 'a0000000-1111-0000-0000-000000000001'::text, null::text, 'A사'::text, 'pending'::text),
                           (1, 'education', null, 'a0000000-2222-0000-0000-000000000001', '한빛대', 'pending'),
                           (2, 'standalone_projects', null, null, null, 'pending')$$,
                  'begin: sections in the server order');
select results_eq($$select draft_type, status, provider, model_tier, connection_tier, ai_job_id::text, run_generation,
                           options ->> 'selection_origin', title ~ '^경력기술서 \(\d{4}-\d{2}-\d{2}\)$'
                      from public.drafts where id = 'a0000000-eeee-0000-0000-000000000001'$$,
                  $$values ('career_description'::text, 'generating'::text, 'gemini'::text, 'default'::text, 'free'::text,
                            'a0000000-7777-0000-0000-000000000001'::text, 1, 'ai_ranking'::text, true)$$,
                  'begin: generating draft with job meta and options');
select is(public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001',
            '{}', '[]') -> 'sections', (select v -> 'sections' from t_b), 'begin: idempotent for the same job (inputs ignored)');
select is((select count(*)::int from public.draft_sections), 3, 'begin: no duplicate sections');

select set_config('t.s0', (select id::text from public.draft_sections where draft_id = 'a0000000-eeee-0000-0000-000000000001' and sort_order = 0), true);
select set_config('t.s1', (select id::text from public.draft_sections where draft_id = 'a0000000-eeee-0000-0000-000000000001' and sort_order = 1), true);
select set_config('t.s2', (select id::text from public.draft_sections where draft_id = 'a0000000-eeee-0000-0000-000000000001' and sort_order = 2), true);

-- ── complete ──
reset role;
create temp table t_cd (v jsonb);
insert into t_cd select jsonb_build_object(
  'sections', jsonb_build_array(
    jsonb_build_object('section_id', current_setting('t.s0'), 'validation_report', jsonb_build_object('flags', 1), 'blocks',
      '[{"block_id":"e1-h","block_kind":"header","text":"A사 · 2020.01 ~ 현재 · S","generated_by":"server","header":{"company_name":"A사"}},
        {"block_id":"e1-s","block_kind":"summary","text":"결제 플랫폼 백엔드 개발","generated_by":"ai"},
        {"block_id":"p1-r","block_kind":"role_line","text":"Dev","project_id":"a0000000-3333-0000-0000-000000000001"},
        {"block_id":"p1-b1","block_kind":"bullet","text":"인덱스 재설계로 응답 시간 [수치 입력 필요] 단축",
         "project_id":"a0000000-3333-0000-0000-000000000001","requirement_ids":["a0000000-8888-0000-0000-000000000001"],
         "placeholders":[{"token":"[수치 입력 필요]","hint":"응답 시간"}],"flags":["evidence_check_needed"]}]'::jsonb),
    jsonb_build_object('section_id', current_setting('t.s1'), 'blocks',
      '[{"block_id":"d1-h","block_kind":"header","text":"한빛대"},
        {"block_id":"p2-r","block_kind":"role_line","text":"Lead","project_id":"a0000000-3333-0000-0000-000000000002"}]'::jsonb),
    jsonb_build_object('section_id', current_setting('t.s2'), 'blocks', '[]'::jsonb, 'validation_report', null)),
  'hashes', '{"input_hash":"ih1","career_snapshot_hash":"ch1"}'::jsonb,
  'meta', '{"schema_version":1,"prompt_version":"ai-03.generate.v1+common.v1","provider":"gemini","model":"gemini-x",
            "model_tier":"default","connection_tier":"free","validation_report":{"removed":0},"usage":{"output_tokens":9}}'::jsonb,
  'evidence', jsonb_build_array(
    jsonb_build_object('section_id', current_setting('t.s0'), 'item_key', 'e1-s', 'sort_order', 0, 'source_type', 'experience',
                       'source_id', 'a0000000-1111-0000-0000-000000000001', 'source_field', 'summary', 'quote', null),
    jsonb_build_object('section_id', current_setting('t.s0'), 'item_key', 'p1-b1', 'sort_order', 0, 'source_type', 'project_detail',
                       'source_id', 'a0000000-4444-0000-0000-000000000001', 'source_field', 'action', 'quote', '인덱스 재설계',
                       'owner_type', 'insight', 'owner_id', 'b0000000-0000-0000-0000-000000000009'),
    jsonb_build_object('section_id', current_setting('t.s1'), 'item_key', 'p2-r', 'sort_order', 0, 'source_type', 'project',
                       'source_id', 'a0000000-3333-0000-0000-000000000002', 'source_field', 'role',
                       'source_snapshot_at', '2026-10-01T00:00:00Z', 'source_label', '졸업 프로젝트')));
grant select on t_cd to app_ai_writer;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';

select is(public.complete_career_description('a0000000-eeee-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001', 2,
            (select v from t_cd)), '{"applied": false, "reason": "stale_run"}'::jsonb, 'complete: other generation -> stale_run');
select throws_ok($$select public.complete_career_description('a0000000-eeee-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000003', 1,
                     (select v from t_cd))$$, 'P0001', 'invalid_ai_job', 'complete: job of another draft');
select throws_ok($$select public.complete_career_description(gen_random_uuid(), 'a0000000-7777-0000-0000-000000000001', 1,
                     (select v from t_cd))$$, 'P0001', 'draft_not_found', 'complete: unknown draft');
select throws_ok($$select public.complete_career_description('a0000000-eeee-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001', 1,
                     jsonb_set((select v from t_cd), '{meta,model_tier}', '"heavy"'))$$, 'P0001', 'invalid_ai_metadata',
                 'complete: model_tier differs from the job');

create temp table t_cd_bad (label text, v jsonb);
insert into t_cd_bad
select 'null', null
union all select 'sections missing', (select v - 'sections' from t_cd)
union all select 'one section missing', (select jsonb_set(v, '{sections}', (v -> 'sections') - 2) from t_cd)
union all select 'section twice', (select jsonb_set(v, '{sections,2,section_id}', to_jsonb(current_setting('t.s0'))) from t_cd)
union all select 'unknown section', (select jsonb_set(v, '{sections,2,section_id}', '"a0000000-0000-0000-0000-00000000dead"') from t_cd)
union all select 'paragraph block', (select jsonb_set(v, '{sections,1,blocks,0,block_kind}', '"paragraph"') from t_cd)
union all select 'blocks not array', (select jsonb_set(v, '{sections,2,blocks}', '{}') from t_cd)
union all select 'block id across sections', (select jsonb_set(v, '{sections,1,blocks,0,block_id}', '"e1-h"') from t_cd)
union all select 'block text too long', (select jsonb_set(v, '{sections,1,blocks,0,text}', to_jsonb(repeat('x', 5001))) from t_cd)
union all select 'block flags not strings', (select jsonb_set(v, '{sections,1,blocks,0,flags}', '[1]') from t_cd)
union all select 'section validation_report array', (select jsonb_set(v, '{sections,0,validation_report}', '[]') from t_cd)
union all select 'evidence item_key of another section', (select jsonb_set(v, '{evidence,0,section_id}', to_jsonb(current_setting('t.s1'))) from t_cd)
union all select 'evidence unknown block', (select jsonb_set(v, '{evidence,0,item_key}', '"zz"') from t_cd)
union all select 'evidence without section', (select jsonb_set(v, '{evidence,0}', (v -> 'evidence' -> 0) - 'section_id') from t_cd)
union all select 'evidence learnings (V-8)', (select jsonb_set(v, '{evidence,1,source_field}', '"learnings"') from t_cd)
union all select 'evidence jd_requirement', (select jsonb_set(jsonb_set(v, '{evidence,0,source_type}', '"jd_requirement"'),
                                                              '{evidence,0,source_field}', 'null') from t_cd)
union all select 'evidence bad field (CHECK)', (select jsonb_set(v, '{evidence,0,source_field}', '"company_name"') from t_cd)
union all select 'evidence bad timestamp', (select jsonb_set(v, '{evidence,2,source_snapshot_at}', '"soon"') from t_cd)
union all select 'input_hash missing', (select v #- '{hashes,input_hash}' from t_cd)
union all select 'usage array', (select jsonb_set(v, '{meta,usage}', '[]') from t_cd);
grant select on t_cd_bad to app_ai_writer;

create function pg_temp.cd_bad(p_label text) returns text language plpgsql as $f$
begin
  perform public.complete_career_description('a0000000-eeee-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001', 1,
                                             (select v from t_cd_bad where label = p_label));
  return 'no error';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$f$;
select is_empty($$select label, pg_temp.cd_bad(label) from t_cd_bad where pg_temp.cd_bad(label) <> 'P0001:invalid_draft_payload'$$,
                'complete: every malformed payload -> invalid_draft_payload');
select is((select count(*)::int from public.evidence_links), 0, 'complete: failed calls leave no evidence');

select is(public.complete_career_description('a0000000-eeee-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001', 1,
            (select v from t_cd)) - 'completed_at',
          '{"applied": true, "status": "ready", "draft_id": "a0000000-eeee-0000-0000-000000000001",
            "section_count": 3, "evidence_count": 3, "application_project_id": "a0000000-aaaa-0000-0000-000000000001"}'::jsonb,
          'complete: applied');
select results_eq($$select status, input_hash, career_snapshot_hash, schema_version, prompt_version, model,
                           validation_report ->> 'removed', usage ->> 'output_tokens', completed_at is not null, run_generation
                      from public.drafts where id = 'a0000000-eeee-0000-0000-000000000001'$$,
                  $$values ('ready'::text, 'ih1'::text, 'ch1'::text, 1, 'ai-03.generate.v1+common.v1'::text, 'gemini-x'::text,
                            '0'::text, '9'::text, true, 1)$$,
                  'complete: draft ready with hashes and meta');
select results_eq($$select sort_order, status, generation_no, jsonb_array_length(ai_content), model, input_hash,
                           validation_report is not null
                      from public.draft_sections where draft_id = 'a0000000-eeee-0000-0000-000000000001' order by sort_order$$,
                  $$values (0, 'ready'::text, 1, 4, 'gemini-x'::text, 'ih1'::text, true),
                           (1, 'ready', 1, 2, 'gemini-x', 'ih1', false),
                           (2, 'ready', 1, 0, 'gemini-x', 'ih1', false)$$,
                  'complete: every section ready with its blocks');
select is((select ai_content -> 0 -> 'header' ->> 'company_name' from public.draft_sections where id = current_setting('t.s0')::uuid),
          'A사', 'complete: server-filled header block stored');
select set_eq($$select owner_id::text || ':' || item_key || ':' || owner_type || ':' || application_project_id::text
                  from public.evidence_links$$,
              array[current_setting('t.s0') || ':e1-s:draft_section:a0000000-aaaa-0000-0000-000000000001',
                    current_setting('t.s0') || ':p1-b1:draft_section:a0000000-aaaa-0000-0000-000000000001',
                    current_setting('t.s1') || ':p2-r:draft_section:a0000000-aaaa-0000-0000-000000000001'],
              'complete: evidence owner = section, item_key = block_id, owner keys of the payload ignored');
select is((select source_snapshot_at from public.evidence_links where item_key = 'p2-r'), '2026-10-01T00:00:00Z'::timestamptz,
          'complete: source_snapshot_at kept');
select ok((select last_activity_at > '2026-01-02' from public.application_projects
            where id = 'a0000000-aaaa-0000-0000-000000000001'), 'complete: project last_activity_at');
select is(public.complete_career_description('a0000000-eeee-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001', 1,
            (select v from t_cd)) ->> 'applied', 'false', 'complete: second call -> stale_run');
select is(public.fail_career_description('a0000000-eeee-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001'), false,
          'fail: ready draft untouched');
select lives_ok($$select public.complete_ai_job('a0000000-7777-0000-0000-000000000001', 1)$$, 'complete_ai_job');
select is((select status from public.drafts where id = 'a0000000-eeee-0000-0000-000000000001'), 'ready',
          'end trigger leaves a ready draft alone');
select is(public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001',
            '{}', '[]') ->> 'status', 'ready', 'begin after success: idempotent (no new row)');

-- ── regeneration (new row) + fail ──
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier)
values ('a0000000-7777-0000-0000-000000000006', 'career_description', 'a0000000-aaaa-0000-0000-000000000001', 'draft',
        'a0000000-eeee-0000-0000-000000000006', 'running', 1, 'gemini', 'default', 'free');
select is(public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000006',
            (select jsonb_set(v, '{selection_origin}', '"user"') from t_opt), (select v -> 0 from t_sec) || '[]'::jsonb,
            null, 'a0000000-eeee-0000-0000-000000000001', '내 경력기술서') ->> 'draft_id',
          'a0000000-eeee-0000-0000-000000000006', 'regenerate: new draft row');
select results_eq($$select regenerated_from_id::text, title, status from public.drafts where id = 'a0000000-eeee-0000-0000-000000000006'$$,
                  $$values ('a0000000-eeee-0000-0000-000000000001'::text, '내 경력기술서'::text, 'generating'::text)$$,
                  'regenerate: regenerated_from_id and custom title');
select is((select count(*)::int from public.drafts where draft_type = 'career_description'), 2, 'regenerate: previous row kept');
select is(public.fail_career_description('a0000000-eeee-0000-0000-000000000006', 'a0000000-7777-0000-0000-000000000099'), false,
          'fail: other job -> false');
select is(public.fail_career_description('a0000000-eeee-0000-0000-000000000006', 'a0000000-7777-0000-0000-000000000006'), true,
          'fail: generating -> failed');
select results_eq($$select d.status, s.status from public.drafts d join public.draft_sections s on s.draft_id = d.id
                     where d.id = 'a0000000-eeee-0000-0000-000000000006'$$,
                  $$values ('failed'::text, 'failed'::text)$$, 'fail: sections failed too (whole retry, S7 [가정 2])');
select throws_ok($$select public.fail_career_description(gen_random_uuid(), 'a0000000-7777-0000-0000-000000000006')$$,
                 'P0001', 'draft_not_found', 'fail: unknown draft');
select is(public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000006',
            '{}', '[]') ->> 'reopened', 'false', 'begin: same-run failure is not reopened');
update public.ai_jobs set status = 'failed', error_code = 'schema_invalid' where id = 'a0000000-7777-0000-0000-000000000006';
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier)
values ('a0000000-7777-0000-0000-000000000005', 'career_description', 'a0000000-aaaa-0000-0000-000000000001', 'draft',
        'a0000000-eeee-0000-0000-000000000005', 'queued', 1, 'gemini', 'default', 'free');

-- ── end trigger + manual retry reopen ──
select is(public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000005',
            (select v from t_opt), (select v from t_sec)) ->> 'status', 'generating', 'begin with a queued job');
update public.ai_jobs set status = 'running' where id = 'a0000000-7777-0000-0000-000000000005';
update public.ai_jobs set status = 'failed', error_code = 'timeout' where id = 'a0000000-7777-0000-0000-000000000005';
select results_eq($$select status, run_generation from public.drafts where id = 'a0000000-eeee-0000-0000-000000000005'$$,
                  $$values ('failed'::text, 1)$$, 'trigger: failed job -> failed draft');
select is((select count(*)::int from public.draft_sections where draft_id = 'a0000000-eeee-0000-0000-000000000005'
            and status = 'failed'), 3, 'trigger: sections failed');
update public.ai_jobs set status = 'queued', run_generation = 2 where id = 'a0000000-7777-0000-0000-000000000005';
select is(public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000005',
            '{}', '[]') ->> 'reopened', 'true', 'begin: manual retry reopens');
select results_eq($$select d.status, d.run_generation, count(*) filter (where s.status = 'pending')::int
                      from public.drafts d join public.draft_sections s on s.draft_id = d.id
                     where d.id = 'a0000000-eeee-0000-0000-000000000005' group by d.status, d.run_generation$$,
                  $$values ('generating'::text, 2, 3)$$, 'begin: reopened draft generating, sections pending');
update public.ai_jobs set status = 'running' where id = 'a0000000-7777-0000-0000-000000000005';
update public.ai_jobs set status = 'failed', error_code = 'timeout' where id = 'a0000000-7777-0000-0000-000000000005';
update public.ai_jobs set status = 'queued', run_generation = 3 where id = 'a0000000-7777-0000-0000-000000000005';
update public.ai_jobs set status = 'running' where id = 'a0000000-7777-0000-0000-000000000005';
-- Retry without begin (step outputs kept): complete reopens the failed draft of an older generation.
select is(public.complete_career_description('a0000000-eeee-0000-0000-000000000005', 'a0000000-7777-0000-0000-000000000005', 3,
            (select jsonb_set(jsonb_set(jsonb_set(jsonb_set(v, '{evidence}', '[]'),
                    '{sections,0,section_id}', to_jsonb((select id::text from public.draft_sections where draft_id = 'a0000000-eeee-0000-0000-000000000005' and sort_order = 0))),
                    '{sections,1,section_id}', to_jsonb((select id::text from public.draft_sections where draft_id = 'a0000000-eeee-0000-0000-000000000005' and sort_order = 1))),
                    '{sections,2,section_id}', to_jsonb((select id::text from public.draft_sections where draft_id = 'a0000000-eeee-0000-0000-000000000005' and sort_order = 2)))
               from t_cd)) ->> 'applied',
          'true', 'complete: retry generation applies to the failed draft');
select lives_ok($$select public.complete_ai_job('a0000000-7777-0000-0000-000000000005', 3)$$, 'complete_ai_job (retry)');

-- canceled
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier)
values ('a0000000-7777-0000-0000-000000000007', 'career_description', 'a0000000-aaaa-0000-0000-000000000001', 'draft',
        'a0000000-eeee-0000-0000-000000000007', 'running', 1, 'gemini', 'default', 'free');
select lives_ok($$select public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000007',
                    (select v from t_opt), (select v from t_sec))$$, 'begin 7');
update public.ai_jobs set status = 'canceled', error_code = 'canceled' where id = 'a0000000-7777-0000-0000-000000000007';
select is((select status from public.drafts where id = 'a0000000-eeee-0000-0000-000000000007'), 'failed', 'trigger: canceled -> failed');
select is(public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000007',
            '{}', '[]') ->> 'status', 'failed', 'begin: canceled job does not reopen its draft');

-- A job whose target_id is a draft of another job.
insert into public.ai_jobs (id, job_type, application_project_id, target_type, target_id, status, run_generation,
                            provider, model_tier, connection_tier)
values ('a0000000-7777-0000-0000-000000000008', 'career_description', 'a0000000-aaaa-0000-0000-000000000001', 'draft',
        'a0000000-eeee-0000-0000-000000000001', 'running', 1, 'gemini', 'default', 'free');
select throws_ok($$select public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000008',
                    (select v from t_opt), (select v from t_sec))$$, 'P0001', 'invalid_ai_job',
                 'begin: target_id already used by another job''s draft');

-- ── cross-user ──
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select is((select count(*)::int from public.drafts), 0, 'B app_ai_writer sees no drafts of A');
select throws_ok($$select public.complete_career_description('a0000000-eeee-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001', 1,
                     (select v from t_cd))$$, 'P0001', 'draft_not_found', 'B app_ai_writer: complete A''s draft');
select throws_ok($$select public.fail_career_description('a0000000-eeee-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000001')$$,
                 'P0001', 'draft_not_found', 'B app_ai_writer: fail A''s draft');
select throws_ok($$select public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000008',
                    (select v from t_opt), (select v from t_sec))$$, 'P0001', 'application_project_not_found',
                 'B app_ai_writer: begin on A''s project');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.begin_career_description('a0000000-aaaa-0000-0000-000000000001', 'a0000000-7777-0000-0000-000000000008',
                    '{}', '[]')$$, '42501', null, 'authenticated cannot run AI RPCs');
select throws_ok($$update public.draft_sections set question_text = 'q' where draft_id = 'a0000000-eeee-0000-0000-000000000001'$$,
                 '23514', null, 'career section has no question text');
select lives_ok($$update public.draft_sections set edited_content = ai_content where id = current_setting('t.s0')::uuid$$,
                'user edits a career section (edited_content)');
select throws_ok($$select public.add_cover_letter_question('a0000000-eeee-0000-0000-000000000001', 'q')$$,
                 'P0001', 'draft_not_found', 'career description is not a cover letter');
select lives_ok($$delete from public.drafts where id = 'a0000000-eeee-0000-0000-000000000001'$$, 'user deletes a career description');
reset role;
select is((select count(*)::int from public.evidence_links), 0, 'delete: section evidence gone');
select is((select regenerated_from_id from public.drafts where id = 'a0000000-eeee-0000-0000-000000000006'), null,
          'delete: regenerated_from_id set null');

select * from finish();
rollback;
