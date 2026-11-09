-- R15 (DM 11.8 #1·#4, §2.5.1, §2.7.3, §2.8 — CL-2·CL-8·CL-9 · v4.15 CF-1·CF-5·CF-6·CF-A4·CF-A11):
-- application_documents (the cover letter of record) and save_application_document.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');
insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '가 지원', 'user'),
  ('b0000000-aaaa-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', '나 지원', 'user');
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                     company_name, company_name_source)
values ('a0000000-1d00-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
        'a0000000-aaaa-0000-0000-000000000001', '원문', 'h', '[{"sid":"S1","text":"원문","start":0,"end":2}]',
        '에이비씨페이', 'user');
insert into public.experiences (id, user_id, company_name, start_month) values
  ('a0000000-1111-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'A사', '2023-01-01');
insert into public.projects (id, user_id, experience_id, name, result, learnings) values
  ('a0000000-3333-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-1111-0000-0000-000000000001', 'P1', '응답 1.2초 -> 0.7초', '지표부터 본다');

-- ── schema (DM §2.7.3) ──
select has_column('public', 'application_documents', c, 'column ' || c)
  from unnest(array['id', 'user_id', 'application_project_id', 'document_kind', 'body', 'meta',
                    'filled_slot_count', 'slot_count', 'first_copied_at', 'created_at', 'updated_at']) c;
-- (v4.15, CF-M1) migration_note is not created.
select hasnt_column('public', 'application_documents', 'migration_note',
                    'no migration_note column (CF-M1)');
select col_is_unique('public', 'application_documents', array['application_project_id', 'document_kind'],
                     'unique (application_project_id, document_kind) = one row per application project');
select has_index('public', 'application_documents', 'application_documents_user_id_idx', 'common (user_id) index');
select ok(exists (select 1 from pg_trigger t where t.tgrelid = 'public.application_documents'::regclass
                   and t.tgname = 'application_documents_set_updated_at'), 'updated_at trigger installed');
select ok((select relrowsecurity from pg_class where oid = 'public.application_documents'::regclass),
          'RLS enabled in the same migration that created the table');
select policies_are('public', 'application_documents',
  array['application_documents_select_own', 'application_documents_insert_own',
        'application_documents_update_own', 'application_documents_delete_own',
        'application_documents_select_ai_writer']);

-- document_kind: one value (CF-A2); filled_slot_count >= 0.
select throws_ok($$insert into public.application_documents (user_id, application_project_id, document_kind)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
                           'career_description')$$,
                 '23514', null, 'document_kind CHECK: career_description refused (CF-1·CF-A2)');
select throws_ok($$insert into public.application_documents (user_id, application_project_id, document_kind,
                                                             filled_slot_count)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
                           'cover_letter', -1)$$,
                 '23514', null, 'filled_slot_count >= 0');

-- slot_count is a stored generated column; the save RPC never writes it.
insert into public.application_documents (id, user_id, application_project_id, document_kind, body)
values ('a0000000-dddd-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
        'a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
        '{"questions": [{"slot": "q_1"}, {"slot": "q_2"}]}'::jsonb);
select is((select slot_count from public.application_documents where id = 'a0000000-dddd-0000-0000-000000000001'),
          2, 'slot_count = jsonb_array_length(body -> questions)');
select throws_ok($$update public.application_documents set slot_count = 9
                   where id = 'a0000000-dddd-0000-0000-000000000001'$$,
                 '428C9', null, 'slot_count cannot be written directly (generated column)');
update public.application_documents set body = '{"questions": []}'::jsonb
 where id = 'a0000000-dddd-0000-0000-000000000001';
select is((select slot_count from public.application_documents where id = 'a0000000-dddd-0000-0000-000000000001'),
          0, 'slot_count follows the body');
select throws_ok($$insert into public.application_documents (user_id, application_project_id, document_kind)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
                           'cover_letter')$$,
                 '23505', null, 'a second row for the same application project is refused');

-- Composite FK (application_project_id, user_id): the project must be the same user's, and the row cascades.
select throws_ok($$insert into public.application_documents (user_id, application_project_id, document_kind)
                   values ('a0000000-0000-0000-0000-000000000001', 'b0000000-aaaa-0000-0000-000000000002',
                           'cover_letter')$$,
                 '23503', null, 'composite FK: another user''s application project is refused');

-- ── RLS (DM §5) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'),
          0, 'B does not see A''s document');
select throws_ok($$insert into public.application_documents (user_id, application_project_id, document_kind)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
                           'cover_letter')$$,
                 '42501', null, 'B cannot insert a row for A');
select is((select count(*)::int from public.application_documents
            where id = 'a0000000-dddd-0000-0000-000000000001'), 0, 'B cannot update A''s row (invisible)');
reset role;

-- app_ai_writer: SELECT only (CL-4, AI 회신 10).
select ok(has_table_privilege('app_ai_writer', 'public.application_documents', 'SELECT')
          and not has_table_privilege('app_ai_writer', 'public.application_documents', 'INSERT')
          and not has_table_privilege('app_ai_writer', 'public.application_documents', 'UPDATE')
          and not has_table_privilege('app_ai_writer', 'public.application_documents', 'DELETE'),
          'app_ai_writer: select only on application_documents');

delete from public.application_documents where id = 'a0000000-dddd-0000-0000-000000000001';

-- ── save_application_document ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- document_kind check and a missing project.
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001',
                     'career_description', '{"questions":[]}')$$,
                 'P0001', 'invalid_fields', 'p_document_kind other than cover_letter -> invalid_fields');
select throws_ok($$select public.save_application_document('b0000000-aaaa-0000-0000-000000000002', 'cover_letter',
                     '{"questions":[]}')$$,
                 'P0001', 'application_project_not_found', 'another user''s project -> application_project_not_found');
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     '{"items":[]}')$$,
                 'P0001', 'invalid_fields', 'p_body without questions -> invalid_fields');

-- Create (DM §2.5.1 "정본 행이 생기는 때": this RPC is the only creator). Length-0 questions is accepted.
select set_config('t.r', public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    '{"questions":[]}')::text, true);
select is((current_setting('t.r')::jsonb) - 'application_document_id' - 'updated_at',
          '{"document_kind":"cover_letter","filled_slot_count":0,"slot_count":0,"name":"가 지원","name_source":"user",
            "deadline":null,"applied":[],"skipped":[]}'::jsonb,
          'create: the 10 return keys, empty questions accepted');
select is((select count(*)::int from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 1, 'exactly one row created');

-- Question validation.
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     '{"questions":[{"slot":"s_1","question_text":"q","char_limit":800,"count_basis":"with_spaces"}]}')$$,
                 'P0001', 'invalid_slot', 'slot must match ^q_[0-9]{1,3}$ (CF-1: no s_{n})');
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     '{"questions":[{"slot":"q_1","char_limit":800,"count_basis":"with_spaces"},
                                    {"slot":"q_1","char_limit":800,"count_basis":"with_spaces"}]}')$$,
                 'P0001', 'invalid_slot', 'duplicate slot -> invalid_slot');
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     '{"questions":[{"slot":"q_1","question_text":"q","count_basis":"with_spaces"}]}')$$,
                 'P0001', 'invalid_fields', 'char_limit is required on a new save (R-CF-16)');
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     '{"questions":[{"slot":"q_1","char_limit":null,"count_basis":"with_spaces"}]}')$$,
                 'P0001', 'invalid_fields', 'char_limit null -> invalid_fields');
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     '{"questions":[{"slot":"q_1","char_limit":10001,"count_basis":"with_spaces"}]}')$$,
                 'P0001', 'invalid_fields', 'char_limit over 10,000 -> invalid_fields');
select throws_ok(format($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001',
                     'cover_letter', '{"questions":[{"slot":"q_1","char_limit":800,"count_basis":"with_spaces",
                     "answer_title":"%s"}]}')$$, repeat('가', 101)),
                 'P0001', 'field_too_long', 'answer_title over 100 -> field_too_long (CF-6·CF-A4 ④)');
select throws_ok(format($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001',
                     'cover_letter', '{"questions":[{"slot":"q_1","char_limit":800,"count_basis":"with_spaces",
                     "question_text":"%s"}]}')$$, repeat('가', 1001)),
                 'P0001', 'field_too_long', 'question_text over 1,000 -> field_too_long');
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     '{"questions":[{"slot":"q_1","char_limit":800,"count_basis":"sometimes"}]}')$$,
                 'P0001', 'invalid_fields', 'count_basis outside the list -> invalid_fields');
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     '{"questions":[]}', '{"tone":"formal"}')$$,
                 'P0001', 'invalid_fields', 'p_meta.tone outside the list -> invalid_fields');
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     '{"questions":[]}', '{"font":"a"}')$$,
                 'P0001', 'invalid_fields', 'p_meta accepts only tone');

-- 문항 <= 5 (CF-5): refused only when the save RAISES the count above 5.
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     (select jsonb_build_object('questions', jsonb_agg(jsonb_build_object(
                        'slot', 'q_' || n, 'char_limit', 800, 'count_basis', 'with_spaces')))
                        from generate_series(1, 6) n))$$,
                 'P0001', 'too_many_questions', '6 questions -> too_many_questions');
-- R5-DB-8: the detail string the API turns into details {limit, current}.
create function pg_temp.save_detail(p_body jsonb) returns text language plpgsql as $$
declare
  v_msg text;
  v_detail text;
begin
  perform public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter', p_body);
  return null;
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || '|' || coalesce(v_detail, '');
end;
$$;
select is(pg_temp.save_detail((select jsonb_build_object('questions', jsonb_agg(jsonb_build_object(
            'slot', 'q_' || n, 'char_limit', 800, 'count_basis', 'with_spaces')))
            from generate_series(1, 6) n)),
          'too_many_questions|5,0',
          'too_many_questions raise detail = ''5,{current}'' (R5-DB-8; current = the stored count, 0 here)');

-- Save 3 questions with bodies, blocks and evidence.
select set_config('t.body', $json${"questions": [
  {"slot": "q_1", "question_text": "지원 동기", "char_limit": 800, "count_basis": "with_spaces",
   "template_key": "motivation", "question_class": "motivation", "answer_title": "  제목  ", "user_note": "메모",
   "body": "답변 1",
   "blocks": [{"block_id": "b1", "type": "paragraph", "text": "답변 1", "basis": "new",
               "evidence": [{"source_type": "project", "source_id": "a0000000-3333-0000-0000-000000000001",
                             "source_field": "result", "quote": "응답 1.2초 -> 0.7초", "label": "PRJ-1"}]}]},
  {"slot": "q_2", "question_text": "직무 역량", "char_limit": 1000, "count_basis": "without_spaces",
   "template_key": "job_competency", "body": "답변 2", "blocks": []},
  {"slot": "q_3", "question_text": "제목만", "char_limit": 500, "count_basis": "with_spaces",
   "answer_title": "제목만 있음", "body": "   ", "blocks": []}]}$json$, true);
select set_config('t.r', public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    current_setting('t.body')::jsonb, '{"tone":"concise"}')::text, true);
-- (v4.15, CF-A4) a question whose body is empty is not counted even with an answer_title.
select is((current_setting('t.r')::jsonb) -> 'filled_slot_count', '2'::jsonb,
          'filled_slot_count: the title-only question is not counted');
select is((current_setting('t.r')::jsonb) -> 'slot_count', '3'::jsonb, 'slot_count = 3');
select is((select body -> 'questions' -> 0 ->> 'answer_title' from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'),
          '제목', 'answer_title is trimmed');
select is((select array_agg((q ->> 'sort_order')::int order by o)
             from public.application_documents d,
                  lateral jsonb_array_elements(d.body -> 'questions') with ordinality as t (q, o)
            where d.application_project_id = 'a0000000-aaaa-0000-0000-000000000001'),
          array[1, 2, 3], 'sort_order re-assigned from 1 in the order received');
select is((select meta ->> 'tone' from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'),
          'concise', 'p_meta.tone stored');
-- Evidence is not copied into the body (DM §2.7.3 "근거는 이 테이블에 복제하지 않는다").
select ok((select not (d.body -> 'questions' -> 0 -> 'blocks' -> 0 ? 'evidence')
             from public.application_documents d
            where d.application_project_id = 'a0000000-aaaa-0000-0000-000000000001'),
          'blocks keep no evidence copy in the body');
select results_eq($$select item_key, source_type, source_field, source_label from public.evidence_links
                     where owner_type = 'application_document'
                       and user_id = 'a0000000-0000-0000-0000-000000000001' order by item_key$$,
                  $$values ('q_1.blocks.b1'::text, 'project'::text, 'result'::text, 'PRJ-1'::text)$$,
                  'evidence row written with item_key {slot}.blocks.{block_id}');
select is((select source_snapshot_at from public.evidence_links
            where item_key = 'q_1.blocks.b1' and user_id = 'a0000000-0000-0000-0000-000000000001'),
          (select content_updated_at from public.projects where id = 'a0000000-3333-0000-0000-000000000001'),
          'project evidence snapshot = projects.content_updated_at (DM §2.8)');

-- Stale write.
select set_config('t.ts', (select updated_at::text from public.application_documents
                            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), true);
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     '{"questions":[]}', null, '2020-01-01T00:00:00Z')$$,
                 'P0001', 'stale_write', 'a wrong expected version -> stale_write, nothing written');
select is((select slot_count from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 3,
          'stale_write wrote nothing');

-- A slot that is not sent is deleted, and its evidence with it.
select set_config('t.r', public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    '{"questions":[{"slot":"q_2","question_text":"직무 역량","char_limit":1000,
                                    "count_basis":"without_spaces","body":"답변 2","blocks":[]}]}',
                    null, current_setting('t.ts')::timestamptz)::text, true);
select is((current_setting('t.r')::jsonb) -> 'slot_count', '1'::jsonb, 'slots not sent are deleted');
select is((select count(*)::int from public.evidence_links
            where owner_type = 'application_document' and user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'the deleted slot''s evidence rows are gone');

-- V-8 last safety net (DM §2.8): a job_competency question may not cite project.learnings.
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     '{"questions":[{"slot":"q_2","question_text":"직무 역량","char_limit":1000,
                       "count_basis":"without_spaces","body":"답변","question_class":"job_competency",
                       "blocks":[{"block_id":"b1","type":"paragraph","text":"답변",
                         "evidence":[{"source_type":"project","source_id":"a0000000-3333-0000-0000-000000000001",
                                      "source_field":"learnings","quote":"지표부터 본다"}]}]}]}')$$,
                 'P0001', 'invalid_evidence_source', 'job_competency question + project.learnings refused (V-8)');
-- An allowed source list violation uses the same list as the insert trigger.
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     '{"questions":[{"slot":"q_2","question_text":"q","char_limit":1000,
                       "count_basis":"without_spaces","body":"답변",
                       "blocks":[{"block_id":"b1","type":"paragraph","text":"답변",
                         "evidence":[{"source_type":"profile","source_id":"a0000000-0000-0000-0000-000000000001",
                                      "source_field":"desired_job_title","quote":"x"}]}]}]}')$$,
                 'P0001', 'invalid_evidence_source', 'profile is not an allowed document source (SD-A19)');
-- Evidence failure rolls the whole save back.
select is((select body -> 'questions' -> 0 ->> 'question_text' from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'),
          '직무 역량', 'a refused evidence row left the previous body in place');

-- user_note evidence whose question is gone is stored as "원본 삭제됨" (the RPC judges — AI 요청 4).
select set_config('t.qid', gen_random_uuid()::text, true);
select set_config('t.r', public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    format($json${"questions":[{"slot":"q_2","question_text":"q","char_limit":1000,
                      "count_basis":"with_spaces","question_id":"%s","body":"답변",
                      "blocks":[{"block_id":"b1","type":"paragraph","text":"답변",
                        "evidence":[{"source_type":"user_note","source_id":"%s","quote":"메모"},
                                    {"source_type":"user_note","source_id":"%s","quote":"사라진 메모"}]}]}]}$json$,
                      current_setting('t.qid'), current_setting('t.qid'),
                      '00000000-0000-0000-0000-0000000000ff')::jsonb)::text, true);
select results_eq($$select source_id::text, quote, source_deleted_at is not null from public.evidence_links
                     where owner_type = 'application_document' and source_type = 'user_note'
                       and user_id = 'a0000000-0000-0000-0000-000000000001'
                     order by source_deleted_at nulls first$$,
                  format($$values ('%s'::text, '메모'::text, false),
                                  ('00000000-0000-0000-0000-0000000000ff', null::text, true)$$,
                         current_setting('t.qid')),
                  'user_note: a note of a question in this body is live, one of a gone question is marked deleted');

-- p_application_values (CF-A11): name / deadline in the same transaction.
select set_config('t.ts', (select updated_at::text from public.application_documents
                            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), true);
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     '{"questions":[]}', null, null, null, null, '{"deadline":"2026-02-30"}')$$,
                 'P0001', 'invalid_fields', 'a calendar-invalid deadline -> invalid_fields');
select throws_ok($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     '{"questions":[]}', null, null, null, null, '{"memo":"x"}')$$,
                 'P0001', 'invalid_fields', 'p_application_values accepts only name / deadline');
select throws_ok(format($$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001',
                     'cover_letter', '{"questions":[]}', null, null, null, null,
                     '{"name":"%s"}')$$, repeat('가', 101)),
                 'P0001', 'field_too_long', 'name over 100 -> field_too_long (application.name)');
select set_config('t.r', public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    '{"questions":[]}', null, null, null, null,
                    '{"name":"  내가 쓴 이름  ","deadline":"2026-12-01"}')::text, true);
select is((current_setting('t.r')::jsonb) - 'application_document_id' - 'updated_at',
          '{"document_kind":"cover_letter","filled_slot_count":0,"slot_count":0,"name":"내가 쓴 이름",
            "name_source":"user","deadline":"2026-12-01","applied":[],"skipped":[]}'::jsonb,
          'p_application_values: name (user) and deadline written, returned in the same call');
-- An empty name goes back to the default name rule through private.application_reset_name.
select set_config('t.r', public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    '{"questions":[]}', null, null, null, null, '{"name":"   "}')::text, true);
select is((current_setting('t.r')::jsonb) - 'application_document_id' - 'updated_at' - 'deadline',
          '{"document_kind":"cover_letter","filled_slot_count":0,"slot_count":0,"name":"에이비씨페이 자기소개서",
            "name_source":"user","applied":[],"skipped":[]}'::jsonb,
          'an empty name returns to "{회사명} 자기소개서" (the company name source decides name_source)');

-- CL-8: no key, no consent, no active provider is required.
select is((select count(*)::int from public.ai_provider_keys_public), 0, 'the caller has no provider key');
select ok((current_setting('t.r')::jsonb) ? 'application_document_id',
          'the save succeeds without an AI connection (CL-8)');

reset role;

-- The application project cascade takes the document with it (composite FK on delete cascade).
delete from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000001';
select is((select count(*)::int from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'),
          0, 'deleting the application project cascades to its document');
select is((select count(*)::int from public.evidence_links
            where owner_type = 'application_document' and user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'and to its evidence rows');

select * from finish();
rollback;
