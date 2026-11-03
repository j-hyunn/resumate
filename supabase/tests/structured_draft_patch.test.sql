-- R4 apply_structured_draft_patch v3 (DM v4.4 §2.5, AI-12 v4.5 mapping, V-9a, V-9h v4.4, V-9i DB defense, CR-20,
-- R-CR-14, R-CR-15). Contract: _workspace/backend/R4/02_db_notes.md.
-- R5 (DM v4.5): field rev, V-9h lowered to set -> append, no period / classification "empty only" checks in the DB.
-- rev / new_object / deliverable-chat ops: r5_structured_draft_patch.test.sql.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

insert into public.experiences (id, user_id, company_name, start_month, job_rank) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'ABC Pay', '2020-01-01', 'S'),
  ('bbbbbbbb-1111-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'B Corp', '2020-01-01', 'S');
-- P1: empty STAR. P2: situation filled, start_month filled, experience_type chosen, is_current on.
insert into public.projects (id, user_id, experience_id, name) values
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'Pay'),
  ('bbbbbbbb-3333-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-1111-0000-0000-000000000001', 'B');
insert into public.projects (id, user_id, experience_id, name, situation, start_month, experience_type, is_current) values
  ('aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001',
   'Ops', '기존 상황', '2023-03-01', 'impact', true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.chat', public.start_writing_chat('aaaaaaaa-3333-0000-0000-000000000001')::text, true);
select set_config('t.m2', (select message_id::text from public.append_writing_chat_message(current_setting('t.chat')::uuid,
  '23년 3월부터 결제 API 병목을 APM으로 찾아 인덱스를 재설계했어요')), true);
select set_config('t.c2', public.start_writing_chat('aaaaaaaa-3333-0000-0000-000000000002')::text, true);
select set_config('t.c2m', (select message_id::text from public.append_writing_chat_message(current_setting('t.c2')::uuid,
  '장애 알림이 확 줄었어요')), true);
select set_config('t.greeting', (select id::text from public.writing_chat_messages
                                   where writing_chat_id = current_setting('t.chat')::uuid and sequence = 1), true);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('t.bchat', public.start_writing_chat('bbbbbbbb-3333-0000-0000-000000000001')::text, true);
select set_config('t.bm2', (select message_id::text from public.append_writing_chat_message(current_setting('t.bchat')::uuid, 'B says')), true);
reset role;

create function pg_temp.src(p text) returns jsonb language sql as $$ select jsonb_build_array(current_setting(p)) $$;
grant execute on function pg_temp.src(text) to authenticated, app_ai_writer;
create function pg_temp.draft(p text) returns jsonb language sql as
  $$ select structured_draft from public.writing_chats where id = current_setting(p)::uuid $$;
grant execute on function pg_temp.draft(text) to authenticated, app_ai_writer;

-- ════════ AI patches ════════
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';

select set_config('t.r', public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"start_month"}'::jsonb, 'value', '2023-03',
                     'source_message_ids', pg_temp.src('t.m2'), 'source_quotes', '["23년 3월부터"]'::jsonb),
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"action"}'::jsonb,
                     'value', '  결제 API 병목을 APM으로 찾아 인덱스를 재설계했다 ',
                     'source_message_ids', pg_temp.src('t.m2'), 'source_quotes', '["APM으로 찾아 인덱스를 재설계"]'::jsonb),
  -- append on an empty column = set
  jsonb_build_object('op', 'append', 'target', '{"section":"star","field":"situation"}'::jsonb, 'value', '결제 API 병목',
                     'source_message_ids', pg_temp.src('t.m2'), 'review', 'needs_review'),
  -- V-9a: the greeting (assistant) can't be a source
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"task"}'::jsonb, 'value', '리드',
                     'source_message_ids', pg_temp.src('t.greeting')),
  -- V-9a: a user message of another user's chat
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"result"}'::jsonb, 'value', 'x',
                     'source_message_ids', pg_temp.src('t.bm2')),
  -- no source at all
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"learnings"}'::jsonb, 'value', 'l',
                     'source_message_ids', '[]'::jsonb),
  -- invalid month value
  jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"end_month"}'::jsonb, 'value', '2023-13',
                     'source_message_ids', pg_temp.src('t.m2')),
  -- R-CR-15: is_current is never proposed
  jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"is_current"}'::jsonb, 'value', true,
                     'source_message_ids', pg_temp.src('t.m2')),
  -- CR-20 classification: filtered to CHECK keys, first 3, deduped; source ids filtered; reason kept
  jsonb_build_object('op', 'set', 'target', '{"section":"classification","field":"competencies"}'::jsonb,
                     'value', '["analysis", "made_up", "analysis", "execution", "planning", "leadership"]'::jsonb,
                     'source_message_ids', pg_temp.src('t.greeting') || pg_temp.src('t.m2'),
                     'reason', 'APM으로 원인을 분석하고 해결'),
  jsonb_build_object('op', 'set', 'target', '{"section":"classification","field":"project_type"}'::jsonb,
                     'value', 'improvement'),
  -- nothing valid left -> rejected
  jsonb_build_object('op', 'set', 'target', '{"section":"classification","field":"experience_type"}'::jsonb,
                     'value', 'hobby'),
  '{"op":"set_clarifications","items":[{"kind":"actor_ambiguous","field":"action"}]}'::jsonb,
  '{"op":"add_sensitive_flags","count":2}'::jsonb)))::text, true);

select is(current_setting('t.r')::jsonb -> 'rejected',
          '[{"index": 3, "op": "set", "reason": "invalid_source"},
            {"index": 4, "op": "set", "reason": "invalid_source"},
            {"index": 5, "op": "set", "reason": "invalid_source"},
            {"index": 6, "op": "set", "reason": "invalid_value"},
            {"index": 7, "op": "set", "reason": "field_not_patchable"},
            {"index": 10, "op": "set", "reason": "invalid_value"}]'::jsonb,
          'AI: rule-breaking ops skipped with reasons, the rest applied');
select is(pg_temp.draft('t.chat') -> 'schema_version', '3'::jsonb, 'draft stays schema_version 3');
select is(pg_temp.draft('t.chat') #> '{project,start_month}',
          jsonb_build_object('value', '2023-03', 'origin', 'ai', 'source_message_ids', pg_temp.src('t.m2'),
                             'source_quotes', '["23년 3월부터"]'::jsonb, 'review', 'ok', 'reviewed_at', null, 'applied_at', null,
                             'rev', 1),
          'period field object (no op key, rev 1)');
select is(pg_temp.draft('t.chat') #> '{star,action}',
          jsonb_build_object('value', '결제 API 병목을 APM으로 찾아 인덱스를 재설계했다', 'op', 'set', 'origin', 'ai',
                             'source_message_ids', pg_temp.src('t.m2'), 'source_quotes', '["APM으로 찾아 인덱스를 재설계"]'::jsonb,
                             'review', 'ok', 'reviewed_at', null, 'applied_at', null, 'rev', 1),
          'STAR field object: value trimmed, op set, applied_at null, rev 1');
select is(pg_temp.draft('t.chat') #>> '{star,situation,op}', 'set', 'append on an empty column is stored as set (V-9h)');
select is(pg_temp.draft('t.chat') #>> '{star,situation,review}', 'needs_review', 'needs_review kept');
select is(pg_temp.draft('t.chat') #> '{classification,competencies}',
          jsonb_build_object('value', '["analysis", "execution", "planning"]'::jsonb, 'origin', 'ai',
                             'source_message_ids', pg_temp.src('t.m2'), 'reason', 'APM으로 원인을 분석하고 해결',
                             'review', 'ok', 'reviewed_at', null, 'applied_at', null, 'rev', 1),
          'competencies: invalid keys dropped, distinct, first 3; non-user source ids dropped; reason kept');
select is(pg_temp.draft('t.chat') #> '{classification,project_type}',
          '{"value": "improvement", "origin": "ai", "source_message_ids": [], "reason": null, "review": "ok",
            "reviewed_at": null, "applied_at": null, "rev": 1}'::jsonb,
          'classification without sources / reason is fine');
select is(pg_temp.draft('t.chat') -> 'clarifications', '[{"kind": "actor_ambiguous", "field": "action"}]'::jsonb,
          'clarifications replaced');
select is(pg_temp.draft('t.chat') -> 'sensitive_flags_count', '2'::jsonb, 'sensitive flags counted');

-- same field, not applied: append adds a line (sources merged), set replaces
select is(public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'append', 'target', '{"section":"star","field":"action"}'::jsonb, 'value', '쿼리 플랜도 바꿨다',
                     'source_message_ids', pg_temp.src('t.m2'), 'source_quotes', '["인덱스를"]'::jsonb)))) -> 'rejected',
          '[]'::jsonb, 'append onto a pending proposal');
select is(pg_temp.draft('t.chat') #>> '{star,action,value}',
          E'결제 API 병목을 APM으로 찾아 인덱스를 재설계했다\n쿼리 플랜도 바꿨다', 'appended on a new line');
select is(pg_temp.draft('t.chat') #> '{star,action,source_quotes}', '["APM으로 찾아 인덱스를 재설계", "인덱스를"]'::jsonb,
          'quotes accumulate');
select is(public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"action"}'::jsonb, 'value', '인덱스를 재설계했다',
                     'source_message_ids', pg_temp.src('t.m2'))))) #>> '{structured_draft,star,action,value}',
          '인덱스를 재설계했다', 'set replaces a pending proposal');
select is(public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'append', 'target', '{"section":"star","field":"action"}'::jsonb, 'value', repeat('가', 1990),
                     'source_message_ids', pg_temp.src('t.m2'))))) -> 'rejected',
          '[{"index": 0, "op": "append", "reason": "invalid_value"}]'::jsonb, 'combined append over 2,000 chars rejected');

-- malformed patches raise
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid, '{"ops":[]}')$$,
                 'P0001', 'invalid_patch', 'empty ops');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"new_detail","detail_key":"D1"}]}')$$,
                 'P0001', 'invalid_patch', 'v1 ops (new_detail) are gone');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"project","field":"name"},"value":"x"}]}')$$,
                 'P0001', 'invalid_patch', 'name is not a proposal field');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"append","target":{"section":"classification","field":"project_type"},"value":"other"}]}')$$,
                 'P0001', 'invalid_patch', 'append is STAR-only');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"accept","target":{"section":"star","field":"situation"}}]}')$$,
                 'P0001', 'invalid_patch', 'accept is a user op');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set_clarifications","items":[{"kind":"affiliation_unclear"}]}]}')$$,
                 'P0001', 'invalid_patch', 'affiliation_unclear retired');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.bchat')::uuid,
                   '{"ops":[{"op":"add_sensitive_flags","count":1}]}')$$,
                 'P0001', 'writing_chat_not_found', 'AI token of A cannot patch B''s chat');

-- V-9h v4.5 on a project with values (P2): set on a filled STAR column is lowered to append (not refused);
-- period / classification are stored even when the saved project has a value (the app judges on the form snapshot).
select is(public.apply_structured_draft_patch(current_setting('t.c2')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"situation"}'::jsonb, 'value', '새 상황',
                     'source_message_ids', pg_temp.src('t.c2m')),
  jsonb_build_object('op', 'append', 'target', '{"section":"star","field":"situation"}'::jsonb, 'value', '장애 알림이 많았다',
                     'source_message_ids', pg_temp.src('t.c2m')),
  jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"start_month"}'::jsonb, 'value', '2023-01',
                     'source_message_ids', pg_temp.src('t.c2m')),
  jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"end_month"}'::jsonb, 'value', '2024-01',
                     'source_message_ids', pg_temp.src('t.c2m')),
  jsonb_build_object('op', 'set', 'target', '{"section":"classification","field":"experience_type"}'::jsonb,
                     'value', 'problem_solving'),
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"result"}'::jsonb, 'value', '장애 알림이 줄었다',
                     'source_message_ids', pg_temp.src('t.c2m'), 'review', 'needs_review')))) -> 'rejected',
          '[]'::jsonb, 'R5: no DB refusal for filled STAR / period / classification');
select is(pg_temp.draft('t.c2') #>> '{star,situation,op}', 'append', 'append on a filled column keeps op append');
select is(pg_temp.draft('t.c2') #>> '{star,situation,value}', E'새 상황\n장애 알림이 많았다',
          'set lowered to append on the filled column, then the append adds a line');
select is(pg_temp.draft('t.c2') #>> '{star,situation,rev}', '2', 'rev 1 (set) -> 2 (append onto it)');
select is(pg_temp.draft('t.c2') #>> '{project,start_month,value}', '2023-01', 'start_month stored though the project has one');
select is(pg_temp.draft('t.c2') #>> '{classification,experience_type,value}', 'problem_solving',
          'classification stored though the project has one (classification_already_set retired)');

reset role;

-- ════════ user patches ════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"add_sensitive_flags","count":1}]}')$$,
                 'P0001', 'invalid_patch', 'AI-only op refused for users');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"accept","target":{"section":"star","field":"action"}}]}')$$,
                 'P0001', 'invalid_review_transition', 'accept needs needs_review');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"accept","target":{"section":"star","field":"situation"}}]}')$$, 'accept needs_review');
select is(pg_temp.draft('t.chat') #>> '{star,situation,review}', 'accepted', 'accepted');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"star","field":"task"},"value":" 결제 리드 "}]}')$$,
                'user edits an empty slot');
select is(pg_temp.draft('t.chat') #> '{star,task}',
          '{"value": "결제 리드", "op": "set", "origin": "user_edit", "source_message_ids": [], "source_quotes": [],
            "review": "ok", "reviewed_at": null, "applied_at": null, "rev": 1}'::jsonb, 'user_edit field object');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"classification","field":"project_type"},"value":"migration"}]}')$$,
                'user changes the suggested classification before applying');
select is(pg_temp.draft('t.chat') #>> '{classification,project_type,origin}', 'user_edit', 'classification user_edit');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"classification","field":"experience_type"},"value":"hobby"}]}')$$,
                 'P0001', 'invalid_value', 'user classification value outside the list');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"project","field":"is_current"},"value":true}]}')$$,
                 'P0001', 'field_not_patchable', 'user cannot propose is_current either');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.c2')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"classification","field":"experience_type"},"value":"impact"}]}')$$,
                 'R5: user patch on a classification the project already has is fine');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"star","field":"learnings"},"value":null}]}')$$,
                'clearing a missing field is a no-op');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.c2')::uuid,
                   '{"ops":[{"op":"reject","target":{"section":"star","field":"situation"}}]}')$$,
                 'P0001', 'invalid_review_transition', 'reject needs needs_review');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.c2')::uuid,
                   '{"ops":[{"op":"reject","target":{"section":"star","field":"result"}}]}')$$, 'reject needs_review');
select is((pg_temp.draft('t.c2') #> '{star,result}') - 'reviewed_at',
          '{"value": null, "op": "set", "origin": "ai", "source_message_ids": [], "source_quotes": [], "review": "ok",
            "applied_at": null, "rev": 2}'::jsonb, 'rejected: value cleared, ok, rev + 1');
reset role;

-- AI cannot overwrite user_edit / accepted fields
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"task"}'::jsonb, 'value', 'ai',
                     'source_message_ids', pg_temp.src('t.m2')),
  jsonb_build_object('op', 'append', 'target', '{"section":"star","field":"situation"}'::jsonb, 'value', 'ai',
                     'source_message_ids', pg_temp.src('t.m2')),
  jsonb_build_object('op', 'set', 'target', '{"section":"classification","field":"project_type"}'::jsonb, 'value', 'other')))) -> 'rejected',
          '[{"index": 0, "op": "set", "reason": "protected_field"},
            {"index": 1, "op": "append", "reason": "protected_field"},
            {"index": 2, "op": "set", "reason": "protected_field"}]'::jsonb,
          'user_edit / accepted fields are protected from AI patches');
reset role;

-- applied fields: users can't edit them; AI patches start a new field object
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.save_project_page('aaaaaaaa-3333-0000-0000-000000000001',
            jsonb_build_object('action', pg_temp.draft('t.chat') #>> '{star,action,value}'), null,
            jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.chat'), 'field', 'action',
                                                 'rev', (pg_temp.draft('t.chat') #>> '{star,action,rev}')::int))) -> 'applied',
          jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.chat'), 'field', 'action')),
          'R5: fill + save records action as applied');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"star","field":"action"},"value":"고침"}]}')$$,
                 'P0001', 'field_already_applied', 'user cannot edit an applied field');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"action"}'::jsonb, 'value', 'x',
                     'source_message_ids', pg_temp.src('t.m2'))))) -> 'rejected',
          '[]'::jsonb, 'R5: after apply the column is filled: set is accepted (lowered to append)');
select is(pg_temp.draft('t.chat') #>> '{star,action,op}', 'append', 'lowered to op append (V-9h v4.5)');
select is((public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'append', 'target', '{"section":"star","field":"action"}'::jsonb, 'value', '모니터링도 붙였다',
                     'source_message_ids', pg_temp.src('t.m2'))))) #> '{structured_draft,star,action}') - 'source_quotes',
          jsonb_build_object('value', E'x\n모니터링도 붙였다', 'op', 'append', 'origin', 'ai', 'source_message_ids', pg_temp.src('t.m2'),
                             'review', 'ok', 'reviewed_at', null, 'applied_at', null, 'rev', 5),
          'the post-apply object takes the next append (never the applied text)');
reset role;

-- closed chat: AI refused, user allowed
update public.writing_chats set status = 'closed' where id = current_setting('t.c2')::uuid;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.c2')::uuid,
                   '{"ops":[{"op":"add_sensitive_flags","count":1}]}')$$,
                 'P0001', 'writing_chat_closed', 'AI cannot patch a closed chat');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.c2')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"star","field":"task"},"value":"운영"}]}')$$,
                'user may still edit a closed chat''s proposal [가정]');

-- actor guard (QA-S4-06): the private impl refuses a forged actor
select throws_ok($$select private.apply_structured_draft_patch_impl(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"add_sensitive_flags","count":1}]}', 'ai')$$,
                 '42501', 'actor_mismatch', 'user session cannot act as ai');
reset role;
set local role anon;
select throws_ok($$select public.apply_structured_draft_patch(gen_random_uuid(), '{"ops":[]}')$$, '42501', null,
                 'anon cannot execute');
reset role;

select * from finish();
rollback;
