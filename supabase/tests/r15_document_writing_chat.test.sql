-- R15 (DM 11.8 #2·#3·#4·#5, 11.10 #8, §2.5, §2.5.0b — CL-1·CL-3·CL-A7 · v4.15 CF-1·CF-6·CF-A4):
-- the document chat target (writing_chats), start_document_writing_chat, the document branch of
-- apply_structured_draft_patch, the 반영됨 기록 path, the ai_jobs combination CHECK, and
-- start_writing_chat's return-target list.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');
insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '가 지원', 'user'),
  ('b0000000-aaaa-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', '나 지원', 'user');
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                     extraction_status)
values ('a0000000-1d00-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
        'a0000000-aaaa-0000-0000-000000000001', '원문', 'h', '[{"sid":"S1","text":"원문","start":0,"end":2}]',
        'pending');
insert into public.experiences (id, user_id, company_name, start_month) values
  ('a0000000-1111-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'A사', '2023-01-01');
insert into public.projects (id, user_id, experience_id, name) values
  ('a0000000-3333-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-1111-0000-0000-000000000001', 'P1');
insert into public.projects (id, user_id, name, role) values
  ('a0000000-3333-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'S1', '리드');

-- ── writing_chats: the three target CHECKs (DM §2.5) ──
select has_column('public', 'writing_chats', 'application_project_id', 'application_project_id added');
select has_column('public', 'writing_chats', 'document_kind', 'document_kind added');
select col_is_null('public', 'writing_chats', 'project_id', 'project_id is nullable (document chats)');
select has_index('public', 'writing_chats', 'writing_chats_application_document_last_activity_idx',
                 'S-46 chat history index');
-- CHECK 1: exactly one target.
select throws_ok($$insert into public.writing_chats (user_id, project_id, application_project_id, document_kind)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-3333-0000-0000-000000000001',
                           'a0000000-aaaa-0000-0000-000000000001', 'cover_letter')$$,
                 '23514', null, 'CHECK 1: a career target and a document target are exclusive');
-- (The BEFORE trigger writing_chats_check_target runs first and gives the named error; the CHECK is behind it.)
select throws_ok($$insert into public.writing_chats (user_id) values ('a0000000-0000-0000-0000-000000000001')$$,
                 'P0001', 'writing_chat_requires_affiliated_project', 'CHECK 1: a chat without a target is refused');
-- CHECK 2: a document chat always has a kind; nothing else has one.
select throws_ok($$insert into public.writing_chats (user_id, application_project_id)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001')$$,
                 '23514', null, 'CHECK 2: a document chat without document_kind is refused');
select throws_ok($$insert into public.writing_chats (user_id, project_id, document_kind)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-3333-0000-0000-000000000001',
                           'cover_letter')$$,
                 '23514', null, 'CHECK 2: a career chat with a document_kind is refused');
select throws_ok($$insert into public.writing_chats (user_id, application_project_id, document_kind)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
                           'career_description')$$,
                 '23514', null, 'CHECK 2: document_kind is cover_letter only (CF-1·CF-A2)');
-- Composite FK: the application project must be the caller's.
select throws_ok($$insert into public.writing_chats (user_id, application_project_id, document_kind)
                   values ('a0000000-0000-0000-0000-000000000001', 'b0000000-aaaa-0000-0000-000000000002',
                           'cover_letter')$$,
                 '23503', null, 'composite FK: another user''s application project is refused');
-- return_target is always null for a document chat (DM §2.5, 6장 U-5).
select throws_ok($$insert into public.writing_chats (user_id, application_project_id, document_kind, return_target)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
                           'cover_letter',
                           '{"feature":"cover_letter","application_project_id":"a0000000-aaaa-0000-0000-000000000001"}')$$,
                 '23514', null, 'a document chat cannot carry a return_target');

-- ── start_document_writing_chat (DM §2.5 "서류 대화") ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.start_document_writing_chat('b0000000-aaaa-0000-0000-000000000002', 'cover_letter')$$,
                 'P0001', 'application_project_not_found', 'another user''s project -> 404');
select throws_ok($$select public.start_document_writing_chat('a0000000-aaaa-0000-0000-000000000001',
                     'career_description')$$,
                 'P0001', 'invalid_fields', 'p_document_kind other than cover_letter -> invalid_fields');
select throws_ok($$select public.start_document_writing_chat('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                     '{"questions":[{"slot":"bad"}]}')$$,
                 'P0001', 'invalid_form_snapshot', 'a malformed form snapshot -> invalid_form_snapshot');
select set_config('t.chat', public.start_document_writing_chat('a0000000-aaaa-0000-0000-000000000001',
                    'cover_letter')::text, true);
select isnt(current_setting('t.chat'), '', 'start_document_writing_chat returns the new chat id (uuid)');
-- DM §2.5.1: starting a chat does NOT create the document of record.
select is((select count(*)::int from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 0,
          'start_document_writing_chat does not create the document row');
select results_eq(format($$select project_id, application_project_id::text, document_kind, return_target,
                                  structured_draft, message_count
                             from public.writing_chats where id = '%s'$$, current_setting('t.chat')),
                  $$values (null::uuid, 'a0000000-aaaa-0000-0000-000000000001'::text, 'cover_letter'::text,
                            null::jsonb,
                            '{"meta": {}, "facts": [], "target": "cover_letter", "document": {},
                              "draft_count": 0, "clarifications": [], "schema_version": 1,
                              "sensitive_flags_count": 0}'::jsonb, 0::smallint)$$,
                  'the chat row: no project, the document target, null return_target, the empty document draft');
-- Greeting shape 4 (요건 추출 전) because extraction_status is still pending.
select ok((select content like '채용 공고의 요건을 아직%' from public.writing_chat_messages
            where writing_chat_id = current_setting('t.chat')::uuid and sequence = 1),
          'greeting: the "요건 추출 전" branch, stored as sequence 1');
select ok((select content like '%민감정보%' from public.writing_chat_messages
            where writing_chat_id = current_setting('t.chat')::uuid and sequence = 1),
          'greeting: the sensitive-information line is appended');
reset role;
update public.job_descriptions
   set extraction_status = 'succeeded', extraction = '{}'::jsonb, tech_keywords = '[]'::jsonb,
       requirements_hash = 'rh', extraction_provider = 'gemini', extraction_model = 'm'
 where id = 'a0000000-1d00-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.chat2', public.start_document_writing_chat('a0000000-aaaa-0000-0000-000000000001',
                    'cover_letter', '{"questions":[{"slot":"q_1","body":"답변"},{"slot":"q_2","body":"  "}]}')::text,
                  true);
select ok((select content like '지금 쓰신 답변을 바탕으로%' from public.writing_chat_messages
            where writing_chat_id = current_setting('t.chat2')::uuid and sequence = 1),
          'greeting: the "일부 채워짐" branch is read from the form snapshot');
-- CL-A1: no limit on the number of chats per document.
select is((select count(*)::int from public.writing_chats
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 2,
          'a document may have several chats (CL-A1)');
reset role;

-- ── ai_jobs combination CHECK (DM 11.8 #3, §2.9.1) ──
-- A document turn is a writing_chat job that DOES belong to an application project.
select throws_ok(format($$insert into public.ai_jobs (user_id, job_type, target_type, target_id,
                            application_project_id, status, run_generation, provider, model_tier, connection_tier)
                          values ('a0000000-0000-0000-0000-000000000001', 'cover_letter', 'writing_chat', '%s',
                                  null, 'queued', 1, 'gemini', 'default', 'free')$$, current_setting('t.chat')),
                 '23514', null, 'cover_letter + writing_chat without an application project is refused');
select lives_ok(format($$insert into public.ai_jobs (user_id, job_type, target_type, target_id,
                           application_project_id, status, run_generation, provider, model_tier, connection_tier)
                         values ('a0000000-0000-0000-0000-000000000001', 'cover_letter', 'writing_chat', '%s',
                                 'a0000000-aaaa-0000-0000-000000000001', 'queued', 1, 'gemini', 'default', 'free')$$,
                        current_setting('t.chat')),
                'cover_letter + writing_chat + application project is accepted');
select throws_ok(format($$insert into public.ai_jobs (user_id, job_type, target_type, target_id,
                            application_project_id, status, run_generation, provider, model_tier, connection_tier)
                          values ('a0000000-0000-0000-0000-000000000001', 'writing_chat_turn', 'writing_chat', '%s',
                                  'a0000000-aaaa-0000-0000-000000000001', 'queued', 1, 'gemini', 'default', 'free')$$,
                        current_setting('t.chat2')),
                 '23514', null, 'writing_chat_turn still must not carry an application project');
-- CL-6: the per-application-project career description in-flight index is gone.
select hasnt_index('public', 'ai_jobs', 'ai_jobs_career_description_in_flight_key',
                   'the career_description in-flight index is dropped (CL-6)');
delete from public.ai_jobs;

-- ── the whole document turn (QA-01, 2026-11-09): a document turn is a `cover_letter` job on a writing_chat
--    target, so begin_assistant_message must accept that job_type. Before the fix every document turn died with
--    `invalid_ai_job` right after the user message was stored. The draft (compose) path runs for the first time
--    here: user message -> begin -> patch -> mark extracted -> finish -> complete.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(format($$select public.append_writing_chat_message('%s', '결제 지연을 줄인 경험을 쓰고 싶어요')$$,
                       current_setting('t.chat')), 'the user sends a message to the document chat');
reset role;
select set_config('t.job', gen_random_uuid()::text, true);
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, application_project_id, status,
                            run_generation, provider, model, model_tier, connection_tier)
values (current_setting('t.job')::uuid, 'a0000000-0000-0000-0000-000000000001', 'cover_letter', 'writing_chat',
        current_setting('t.chat')::uuid, 'a0000000-aaaa-0000-0000-000000000001', 'running', 1, 'gemini',
        'gemini-3-flash', 'default', 'free');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok(format($$select * from public.begin_assistant_message('%s', '%s', 'gemini', 'gemini-3-flash',
                          'default', 'free')$$, current_setting('t.chat'), current_setting('t.job')),
                'begin_assistant_message accepts a cover_letter turn job (QA-01)');
select set_config('t.msgid', (select id::text from public.writing_chat_messages
                               where writing_chat_id = current_setting('t.chat')::uuid and role = 'assistant'
                                 and status = 'streaming' limit 1), true);
select isnt(current_setting('t.msgid'), '', 'the assistant message row is streaming');
-- A turn job of a job_type this RPC does not serve is still refused.
reset role;
select set_config('t.badjob', gen_random_uuid()::text, true);
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, application_project_id, status,
                            run_generation, provider, model, model_tier, connection_tier)
values (current_setting('t.badjob')::uuid, 'a0000000-0000-0000-0000-000000000001', 'insight',
        'application_project', 'a0000000-aaaa-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001',
        'running', 1, 'gemini', 'gemini-3-flash', 'default', 'free');
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok(format($$select * from public.begin_assistant_message('%s', '%s', 'gemini', 'gemini-3-flash',
                           'default', 'free')$$, current_setting('t.chat'), current_setting('t.badjob')),
                 'P0001', 'invalid_ai_job', 'a job that is not this chat''s turn is still refused');

-- ── apply_structured_draft_patch: the document branch (DM §2.5.0b) ──
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
-- set_writing_kind belongs to the deliverable target only.
select throws_ok(format($$select public.apply_structured_draft_patch('%s',
                     '{"ops":[{"op":"set_writing_kind","value":"retrospective"}]}')$$, current_setting('t.chat')),
                 'P0001', 'invalid_patch', 'set_writing_kind is not a document op');
-- (v4.15, CF-1) the two dropped ops are not accepted either.
select throws_ok(format($$select public.apply_structured_draft_patch('%s',
                     '{"ops":[{"op":"set_source_ranking","items":[]}]}')$$, current_setting('t.chat')),
                 'P0001', 'invalid_patch', 'set_source_ranking does not exist (CF-1)');
select throws_ok(format($$select public.apply_structured_draft_patch('%s',
                     '{"ops":[{"op":"set_section_order_proposal","items":[]}]}')$$, current_setting('t.chat')),
                 'P0001', 'invalid_patch', 'set_section_order_proposal does not exist (CF-1)');
-- set_tone writes meta.tone_requested.
select lives_ok(format($$select public.apply_structured_draft_patch('%s',
                    '{"ops":[{"op":"set_tone","value":"detailed"}]}')$$, current_setting('t.chat')),
                'set_tone accepted');
select is((select structured_draft #>> '{meta,tone_requested}' from public.writing_chats
            where id = current_setting('t.chat')::uuid), 'detailed', 'meta.tone_requested stored');
-- replace_draft needs a slot, rebuilds `value` from the blocks and carries answer_title.
select throws_ok(format($$select public.apply_structured_draft_patch('%s',
                     '{"ops":[{"op":"replace_draft","draft":{"blocks":[]}}]}')$$, current_setting('t.chat')),
                 'P0001', 'invalid_patch', 'replace_draft without a slot -> invalid_patch');
select throws_ok(format($$select public.apply_structured_draft_patch('%s',
                     '{"ops":[{"op":"replace_draft","slot":"q_1","draft":{"answer_title":"%s",
                       "blocks":[{"block_id":"b1","type":"paragraph","text":"t"}],"char_count":1}}]}')$$,
                     current_setting('t.chat'), repeat('가', 101)),
                 'P0001', 'invalid_patch', 'answer_title over 100 -> invalid_patch (CF-A4 `[가정]`)');
select set_config('t.patch', $json${"ops":[{"op":"replace_draft","slot":"q_1","question_id":"a0000000-e5e5-0000-0000-000000000001",
  "draft":{"answer_title":"  제목  ","value":"무시됨","char_count":5,"char_limit_at_generation":800,
           "char_adjust_needed":false,"correction_applied":false,"base_body_hash":"sha256:x",
           "blocks":[{"block_id":"b1","type":"paragraph","text":"본문 1","basis":"new",
                      "evidence":[{"source_type":"project","source_id":"a0000000-3333-0000-0000-000000000001",
                                   "source_field":"name","quote":"P1","label":"PRJ-1"}]},
                     {"block_id":"b2","type":"paragraph","text":"본문 2","basis":"new","evidence":[]}]}}]}$json$, true);
select is(public.apply_structured_draft_patch(current_setting('t.chat')::uuid, current_setting('t.patch')::jsonb)
            -> 'rejected', '[]'::jsonb, 'replace_draft accepted');
select set_config('t.draft', (select structured_draft #>> '{document,questions,0,draft,value}'
                                from public.writing_chats where id = current_setting('t.chat')::uuid), true);
select is(current_setting('t.draft'), E'본문 1\n\n본문 2',
          'the DB rebuilds `value` from the blocks and ignores the sent value (R5-DB-5, per slot)');
select is((select structured_draft #>> '{document,questions,0,draft,answer_title}' from public.writing_chats
            where id = current_setting('t.chat')::uuid), '제목', 'answer_title stored, trimmed');
select ok((select current_setting('t.draft') not like '%제목%'), 'answer_title is not part of `value` (CF-A4)');
select is((select structured_draft #>> '{document,questions,0,draft,rev}' from public.writing_chats
            where id = current_setting('t.chat')::uuid), '1', 'rev starts at 1 for this slot');
select is((select structured_draft #>> '{document,questions,0,slot}' from public.writing_chats
            where id = current_setting('t.chat')::uuid), 'q_1', 'the question is keyed by slot');
-- 리더 판정 2026-11-09 (20261113004600): the DB stores the review / review_reason the pipeline sent and does
-- NOT force them. A block has three kinds of source (DM §2.5.0b "blocks[] 출처 3종"), so an empty `evidence[]`
-- says nothing on its own — V-4 / V-10a / V-10h are the pipeline's call.
select results_eq(format($$select b ->> 'block_id', b ->> 'review', b ->> 'review_reason'
                             from public.writing_chats w,
                                  lateral jsonb_array_elements(w.structured_draft
                                    #> '{document,questions,0,draft,blocks}') b
                            where w.id = '%s'$$, current_setting('t.chat')),
                  $$values ('b1'::text, 'ok'::text, null::text), ('b2', 'ok', null::text)$$,
                  'the review the pipeline sent is stored as it is (no forced needs_review)');
-- A block whose only source is a fact of this chat (evidence[] empty) stays ok.
-- A fact must cite a user message of this chat (V-9a); the turn above already added one.
select set_config('t.msg', (select id::text from public.writing_chat_messages
                             where writing_chat_id = current_setting('t.chat')::uuid and role = 'user'
                             order by sequence desc limit 1), true);
select set_config('t.fact', (public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                    format('{"ops":[{"op":"add_facts","facts":[{"slot":"q_3","text":"사실 하나","actor":"self",
                             "source_message_ids":["%s"]}]}]}', current_setting('t.msg'))::jsonb)
                    #>> '{structured_draft,facts,0,id}'), true);
select isnt(current_setting('t.fact'), '', 'the fact was added');
select is(public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
            format($json${"ops":[{"op":"replace_draft","slot":"q_3","draft":{"char_count":1,
              "blocks":[{"block_id":"f1","type":"paragraph","text":"사실로만 쓴 문단",
                         "source_fact_ids":["%s"],"evidence":[],"review":"ok"},
                        {"block_id":"f2","type":"paragraph","text":"지금 본문을 이어 쓴 문단",
                         "basis":"current_body","source_body_quotes":["지금 답변의 한 구절"],
                         "evidence":[],"review":"ok"},
                        {"block_id":"f3","type":"paragraph","text":"파이프라인이 검토를 요청한 문단",
                         "source_fact_ids":["%s"],"evidence":[],"review":"needs_review",
                         "review_reason":"content_unverified"}]}}]}$json$,
                   current_setting('t.fact'), current_setting('t.fact'))::jsonb) -> 'rejected',
          '[]'::jsonb, 'blocks whose only source is a fact / a body quote are accepted');
select results_eq(format($$select b ->> 'block_id', b ->> 'review', b ->> 'review_reason'
                             from public.writing_chats w,
                                  lateral jsonb_array_elements(w.structured_draft
                                    #> '{document,questions,1,draft,blocks}') b
                            where w.id = '%s'$$, current_setting('t.chat')),
                  $$values ('f1'::text, 'ok'::text, null::text),
                           ('f2', 'ok', null::text),
                           ('f3', 'needs_review', 'content_unverified')$$,
                  'source_fact_ids-only and source_body_quotes-only blocks stay ok; a sent needs_review is kept');
-- The evidence shape defence (DM §2.5.0b "DB의 V-10 방어 범위 (서류)").
select is(public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
            $json${"ops":[{"op":"replace_draft","slot":"q_2","draft":{"char_count":1,
              "blocks":[{"block_id":"b1","type":"paragraph","text":"t",
                         "evidence":[{"source_type":"interview_answer","source_id":"a0000000-3333-0000-0000-000000000001",
                                      "quote":"x"}]}]}}]}$json$::jsonb) -> 'rejected' -> 0 ->> 'reason',
          'invalid_source', 'an evidence source outside the allowed list is rejected (not raised, AI patch)');
-- Second draft of the same slot: rev increases monotonically.
select is(public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
            $json${"ops":[{"op":"replace_draft","slot":"q_1","draft":{"char_count":1,
              "blocks":[{"block_id":"b9","type":"paragraph","text":"새 본문",
                         "evidence":[{"source_type":"project","source_id":"a0000000-3333-0000-0000-000000000001",
                                      "source_field":"name","quote":"P1"}]}]}}]}$json$::jsonb) -> 'rejected',
          '[]'::jsonb, 'a second draft for the slot is accepted');
select is((select structured_draft #>> '{document,questions,0,draft,rev}' from public.writing_chats
            where id = current_setting('t.chat')::uuid), '2', 'the slot''s rev is now 2');
select is((select structured_draft #>> '{document,questions,0,draft,answer_title}' from public.writing_chats
            where id = current_setting('t.chat')::uuid), null,
          'a draft without answer_title stores null (CF-A4 ⑤)');
reset role;

-- The turn closes: the extract marker, the assistant message and the job (the draft path end to end).
select is(public.mark_writing_chat_extracted(current_setting('t.chat')::uuid, 2::smallint), 2::smallint,
          'mark_writing_chat_extracted takes the document turn');
select lives_ok(format($$select public.finish_assistant_message('%s', 'done', '초안을 만들었어요')$$,
                       current_setting('t.msgid')),
                'finish_assistant_message closes the document turn (it does not look at job_type)');
select lives_ok(format($$select public.complete_ai_job('%s', 1)$$, current_setting('t.job')),
                'complete_ai_job finishes the cover_letter turn job');
select results_eq(format($$select status, content from public.writing_chat_messages where id = '%s'$$,
                         current_setting('t.msgid')),
                  $$values ('done'::text, '초안을 만들었어요'::text)$$,
                  'the assistant message is stored done');
select is((select status from public.ai_jobs where id = current_setting('t.job')::uuid), 'succeeded',
          'the turn job ends succeeded');
reset role;

-- ── 반영됨 기록: {writing_chat_id, slot, rev} (DM §2.5.1) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.r', public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    -- The body carries the question_id the q_1 proposal was written for (QA-07 rule 4).
                    '{"questions":[{"slot":"q_1","question_id":"a0000000-e5e5-0000-0000-000000000001",
                                    "question_text":"q","char_limit":800,"count_basis":"with_spaces",
                                    "body":"새 본문","blocks":[]}]}',
                    null, null,
                    format('[{"writing_chat_id":"%s","slot":"q_1","rev":2},
                             {"writing_chat_id":"%s","slot":"q_1","rev":1},
                             {"writing_chat_id":"%s","slot":"q_9","rev":1},
                             {"writing_chat_id":"%s","slot":"bad","rev":1}]',
                           current_setting('t.chat'), current_setting('t.chat'), current_setting('t.chat'),
                           current_setting('t.chat'))::jsonb)::text, true);
select is((current_setting('t.r')::jsonb) -> 'applied' -> 0 -> 'slot', '"q_1"'::jsonb,
          'applied: the proposal whose rev matches');
select is((select jsonb_agg(e -> 'reason') from jsonb_array_elements((current_setting('t.r')::jsonb) -> 'skipped') e),
          '["already_applied", "not_found", "invalid_entry"]'::jsonb,
          'skipped reasons in judgement order: already_applied / not_found (unknown slot) / invalid_entry');
select ok((select structured_draft #>> '{document,questions,0,draft,applied_at}' is not null
             from public.writing_chats where id = current_setting('t.chat')::uuid),
          'applied_at recorded on the slot''s draft');
select is((select structured_draft #>> '{document,questions,0,draft,applied_rev}' from public.writing_chats
            where id = current_setting('t.chat')::uuid), '2', 'applied_rev recorded');
select ok((select not (structured_draft #> '{document,questions,0,draft}' ? 'applied_mode')
             from public.writing_chats where id = current_setting('t.chat')::uuid),
          'no applied_mode for a document (a document is always a replace)');
select ok((select last_applied_at is not null from public.writing_chats
            where id = current_setting('t.chat')::uuid), 'the chat''s last_applied_at is set');

-- ── start_writing_chat: career_description is no longer an accepted return target (11.10 #8) ──
select throws_ok($$select public.start_writing_chat('a0000000-3333-0000-0000-000000000001',
                     '{"feature":"career_description","application_project_id":"a0000000-aaaa-0000-0000-000000000001"}')$$,
                 'P0001', 'invalid_return_target', 'career_description return target refused (CF-1)');
select lives_ok($$select public.start_writing_chat('a0000000-3333-0000-0000-000000000001',
                    '{"feature":"cover_letter","application_project_id":"a0000000-aaaa-0000-0000-000000000001"}')$$,
                'cover_letter return target still accepted');
select lives_ok($$select public.start_writing_chat('a0000000-3333-0000-0000-000000000001',
                    '{"feature":"insight","application_project_id":"a0000000-aaaa-0000-0000-000000000001"}')$$,
                'insight return target still accepted');
reset role;
-- The table CHECK keeps R14's three values (existing rows).
select is((select array_agg(m[1] order by m[1])
             from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
            where c.conname = 'writing_chats_return_target_check'),
          array['career_description', 'cover_letter', 'feature', 'insight', 'object'],
          'the table CHECK still lists career_description (existing rows)');

-- Deleting the application project cascades to its document chats.
delete from public.application_projects where id = 'a0000000-aaaa-0000-0000-000000000001';
-- QA-04 (리더 수정 2026-11-09): 픽스처 범위로 좁힌다. 전역 count(*)는 다른 사용자의 서류 대화
-- 한 행에도 깨지고, 공유 로컬 Supabase에서 run-checks.sh를 불안정하게 만든다.
select is((select count(*)::int from public.writing_chats
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 0,
          'application project deletion cascades to its document chats');

select * from finish();
rollback;
