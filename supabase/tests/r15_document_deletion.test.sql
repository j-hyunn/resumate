-- R15 (DM 11.8 #6, §4.2, §4.3 — CL-3·CL-A6 · v4.15 CF-1·CF-A2·CF-A14):
-- get_deletion_impact / delete_career_item / get_account_deletion_summary with the cover letter of record.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');
insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'P1', 'user');
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences)
values ('a0000000-1d00-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
        'a0000000-aaaa-0000-0000-000000000001', '원문', 'h', '[{"sid":"S1","text":"원문","start":0,"end":2}]');
insert into public.experiences (id, user_id, company_name, start_month) values
  ('a0000000-1111-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'A사', '2023-01-01');
insert into public.projects (id, user_id, experience_id, name, result) values
  ('a0000000-3333-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-1111-0000-0000-000000000001', 'P1', '응답 1.2초 -> 0.7초');
insert into public.skills (id, user_id, name) values
  ('a0000000-4444-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'PostgreSQL');
insert into public.insights (user_id, application_project_id, version_no, is_latest, status, result,
                             match_stage_result, requirements_hash, career_snapshot_hash, input_hash,
                             schema_version, prompt_version, provider, model, model_tier, connection_tier,
                             completed_at)
values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 1, true, 'ready', '{}',
        '{}', 'rh', 'ch', 'ih', 1, 'pv', 'gemini', 'm', 'default', 'free', now());
insert into public.application_stage_events (user_id, application_project_id, event_type, to_stage) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'created', 'before_apply');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- A document with two questions: q_1 cites the project, q_2 cites the skill.
select set_config('t.chat', public.start_document_writing_chat('a0000000-aaaa-0000-0000-000000000001',
                    'cover_letter')::text, true);
select set_config('t.r', public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    $json${"questions":[
                      {"slot":"q_1","question_text":"q1","char_limit":800,"count_basis":"with_spaces",
                       "user_note":"메모 1","body":"본문 1",
                       "blocks":[{"block_id":"b1","type":"paragraph","text":"본문 1",
                         "evidence":[{"source_type":"project","source_id":"a0000000-3333-0000-0000-000000000001",
                                      "source_field":"result","quote":"응답 1.2초 -> 0.7초","label":"PRJ-1"}]}]},
                      {"slot":"q_2","question_text":"q2","char_limit":800,"count_basis":"with_spaces",
                       "body":"본문 2",
                       "blocks":[{"block_id":"c1","type":"paragraph","text":"본문 2",
                         "evidence":[{"source_type":"skill","source_id":"a0000000-4444-0000-0000-000000000001",
                                      "source_field":"name","quote":"PostgreSQL"}]}]}]}$json$::jsonb)::text, true);
select is((current_setting('t.r')::jsonb) -> 'filled_slot_count', '2'::jsonb, 'two questions written');

-- ── get_deletion_impact('application_project') (DM §4.2, 11.8 #6) ──
select is(public.get_deletion_impact('application_project', 'a0000000-aaaa-0000-0000-000000000001'),
          '{"cascade": {"insights": 1, "documents": 1, "document_chats": 1, "stage_events": 1}}'::jsonb,
          'application project impact: documents (0 or 1) and document_chats replace the old drafts key');
-- (v4.15 정렬, UX DM-6) entity_type = 'application_document' is not created.
select throws_ok($$select public.get_deletion_impact('application_document',
                     'a0000000-aaaa-0000-0000-000000000001')$$,
                 'P0001', 'invalid_entity_type', 'entity_type application_document is not created `[가정]`');

-- ── career deletion impact: documents / document_sections ──
select is(public.get_deletion_impact('project', 'a0000000-3333-0000-0000-000000000001') -> 'affected_results',
          '{"by_application_project": [{"application_project_id": "a0000000-aaaa-0000-0000-000000000001",
             "name": "P1", "insights": 0, "documents": 1, "document_sections": 1}]}'::jsonb,
          'deleting the project: 1 document, 1 slot (the key name document_sections is kept, v4.15)');
select is(public.get_deletion_impact('skill', 'a0000000-4444-0000-0000-000000000001') -> 'affected_results',
          '{"by_application_project": [{"application_project_id": "a0000000-aaaa-0000-0000-000000000001",
             "name": "P1", "insights": 0, "documents": 1, "document_sections": 1}]}'::jsonb,
          'deleting the skill: the other slot is the affected one');
-- A career deletion never meets a document chat (DM §2.5 "project_id is not null").
select is(public.get_deletion_impact('experience', 'a0000000-1111-0000-0000-000000000001') #> '{cascade,writing_chats}',
          '0'::jsonb, 'cascade.writing_chats does not count the document chat');

-- ── delete_career_item(keep_results): the document is untouched ──
select is(public.delete_career_item('skill', 'a0000000-4444-0000-0000-000000000001', 'delete_projects',
            'keep_results') ->> 'result_mode', 'keep_results', 'keep_results runs');
select is((select filled_slot_count from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 2,
          'keep_results: the body is untouched');
select is((select source_deleted_at is not null from public.evidence_links
            where item_key = 'q_2.blocks.c1' and user_id = 'a0000000-0000-0000-0000-000000000001'), true,
          'keep_results: the source deletion trigger only marks the evidence row');

-- ── delete_career_item(delete_results): only that question''s body / blocks / evidence are cleared ──
select is(public.delete_career_item('project', 'a0000000-3333-0000-0000-000000000001', 'delete_projects',
            'delete_results') ->> 'result_mode', 'delete_results', 'delete_results runs');
select is((select filled_slot_count from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 1,
          'the cited question is emptied, so filled_slot_count drops to 1');
select results_eq($$select q ->> 'slot', q ->> 'question_text', q ->> 'user_note', q ->> 'body',
                           jsonb_array_length(q -> 'blocks'), (q ->> 'char_limit')::int
                     from public.application_documents d,
                          lateral jsonb_array_elements(d.body -> 'questions') with ordinality as t (q, o)
                    where d.application_project_id = 'a0000000-aaaa-0000-0000-000000000001' order by o$$,
                  $$values ('q_1'::text, 'q1'::text, '메모 1'::text, ''::text, 0, 800),
                           ('q_2', 'q2', null::text, '본문 2', 1, 800)$$,
                  'the question text, note and char_limit stay; only the body and the blocks are cleared');
select is((select count(*)::int from public.evidence_links
            where owner_type = 'application_document' and user_id = 'a0000000-0000-0000-0000-000000000001'
              and item_key like 'q_1.%'), 0,
          'that slot''s evidence rows are deleted');
select is((select slot_count from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 2,
          'the question itself is not removed (slot_count unchanged)');
-- (v4.13) the document chats are NOT deleted.
select is((select count(*)::int from public.writing_chats
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 1,
          'delete_results does not delete the document chat (DM §4.2)');

-- ── get_account_deletion_summary (DM §4.3) ──
select is(public.get_account_deletion_summary() #> '{applications,drafts}', '1'::jsonb,
          '"서류 수" = documents with filled_slot_count > 0; the return key stays "drafts"');
reset role;
update public.application_documents set filled_slot_count = 0
 where application_project_id = 'a0000000-aaaa-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_account_deletion_summary() #> '{applications,drafts}', '0'::jsonb,
          'an empty cover letter is not counted');
select is(public.get_account_deletion_summary() #> '{career,writing_chats}', '1'::jsonb,
          'the AI writing chat count includes the document chat (DM §4.3)');
select is(public.get_deletion_impact('application_project', 'a0000000-aaaa-0000-0000-000000000001')
            #> '{cascade,documents}', '0'::jsonb,
          'cascade.documents follows the same filled_slot_count > 0 rule');

-- ── delete_account takes the document with it ──
select ok(public.delete_account('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
            ? 'deleted', 'delete_account runs');
reset role;
select is((select count(*)::int from public.application_documents where user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'delete_account deleted the document');

select * from finish();
rollback;
