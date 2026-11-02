-- R4 apply_writing_chat_proposal (DM v4.4 §3.3; CR-5, CR-20, R-CR-15, T-18). Replaces the S4 save / hand-off tests.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

insert into public.experiences (id, user_id, company_name, start_month, job_rank) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'ABC Pay', '2020-01-01', 'S');
-- P1: action already written by the user, competencies chosen, is_current on.
insert into public.projects (id, user_id, experience_id, name, action, competencies, is_current) values
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001',
   'Pay', '기존 행동', '{execution}', true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.chat', public.start_writing_chat('aaaaaaaa-3333-0000-0000-000000000001')::text, true);
select set_config('t.m2', (select message_id::text from public.append_writing_chat_message(current_setting('t.chat')::uuid,
  '23년 3월부터 결제 API 병목을 찾아서 고쳤어요')), true);
reset role;

-- AI proposal: situation (ok), action (append onto the user's text), result (needs_review), start / end month,
-- classifications (competencies will be skipped: user already chose).
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"situation"}'::jsonb, 'value', '결제 API 병목',
                     'source_message_ids', jsonb_build_array(current_setting('t.m2'))),
  jsonb_build_object('op', 'append', 'target', '{"section":"star","field":"action"}'::jsonb, 'value', '병목을 찾아 고쳤다',
                     'source_message_ids', jsonb_build_array(current_setting('t.m2'))),
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"result"}'::jsonb, 'value', '빨라졌다',
                     'source_message_ids', jsonb_build_array(current_setting('t.m2')), 'review', 'needs_review'),
  jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"start_month"}'::jsonb, 'value', '2023-03',
                     'source_message_ids', jsonb_build_array(current_setting('t.m2'))),
  jsonb_build_object('op', 'set', 'target', '{"section":"classification","field":"experience_type"}'::jsonb,
                     'value', 'problem_solving', 'reason', '병목 해결'),
  jsonb_build_object('op', 'set', 'target', '{"section":"classification","field":"project_type"}'::jsonb,
                     'value', 'improvement')))) -> 'rejected',
          '[]'::jsonb, 'proposal written');
-- end_month proposal written directly (the patch RPC refuses it while is_current; apply must skip it too)
reset role;
update public.writing_chats
   set structured_draft = jsonb_set(structured_draft, '{project,end_month}',
         '{"value":"2024-01","origin":"ai","source_message_ids":[],"source_quotes":[],"review":"ok","reviewed_at":null,"applied_at":null}')
 where id = current_setting('t.chat')::uuid;

-- user picked a project_type after the suggestion (in the left section)
update public.projects set project_type = 'operation' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
alter table public.projects disable trigger projects_set_content_updated_at;
update public.projects set content_updated_at = '2000-01-01' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
alter table public.projects enable trigger projects_set_content_updated_at;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok($$select public.apply_writing_chat_proposal(current_setting('t.chat')::uuid, array['name'])$$,
                 'P0001', 'invalid_fields', 'unknown field rejected');
select throws_ok($$select public.apply_writing_chat_proposal(current_setting('t.chat')::uuid, array['is_current'])$$,
                 'P0001', 'invalid_fields', 'is_current is never applied (R-CR-15)');
select throws_ok($$select public.apply_writing_chat_proposal(current_setting('t.chat')::uuid, array[null]::text[])$$,
                 'P0001', 'invalid_fields', 'null field rejected');
select throws_ok($$select public.apply_writing_chat_proposal(gen_random_uuid())$$,
                 'P0001', 'writing_chat_not_found', 'unknown chat');

-- apply one field
select is(public.apply_writing_chat_proposal(current_setting('t.chat')::uuid, array['situation']),
          '{"applied": ["situation"], "skipped": [], "project_status": "complete"}'::jsonb,
          'apply situation: situation + existing action -> complete');
select results_eq($$select situation, source_writing_chat_id, content_updated_at > '2000-01-01'
                     from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'$$,
                  $$select '결제 API 병목'::text, current_setting('t.chat')::uuid, true$$,
                  'situation written, source_writing_chat_id = chat, content_updated_at moved');
select isnt((select structured_draft #>> '{star,situation,applied_at}' from public.writing_chats
              where id = current_setting('t.chat')::uuid), null, 'applied_at stamped');
select isnt((select last_applied_at from public.writing_chats where id = current_setting('t.chat')::uuid), null,
            'last_applied_at set');

-- apply all: append onto the user's action, needs_review / period / classification skips
select is(public.apply_writing_chat_proposal(current_setting('t.chat')::uuid),
          '{"applied": ["action", "start_month", "experience_type"],
            "skipped": [{"field": "situation", "reason": "already_applied"},
                        {"field": "result", "reason": "needs_review"},
                        {"field": "end_month", "reason": "period_already_set"},
                        {"field": "project_type", "reason": "classification_already_set"}],
            "project_status": "complete"}'::jsonb,
          'apply all: applied / skipped with reasons');
select results_eq($$select action, start_month, experience_type, project_type, competencies, end_month, is_current
                     from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'$$,
                  $$values (E'기존 행동\n병목을 찾아 고쳤다'::text, '2023-03-01'::date, 'problem_solving'::text,
                            'operation'::text, '{execution}'::text[], null::date, true)$$,
                  'action appended on a new line (user text kept), month as day 1, classification only where empty');

-- nothing left -> no error, nothing applied
select is(public.apply_writing_chat_proposal(current_setting('t.chat')::uuid, array['situation', 'learnings']),
          '{"applied": [], "skipped": [{"field": "situation", "reason": "already_applied"},
                                       {"field": "learnings", "reason": "empty"}], "project_status": "complete"}'::jsonb,
          'already applied / empty -> applied []');

-- accept the needs_review result, then apply it
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"accept","target":{"section":"star","field":"result"}}]}')$$, 'accept result');
select is(public.apply_writing_chat_proposal(current_setting('t.chat')::uuid, array['result']) -> 'applied', '["result"]'::jsonb,
          'accepted field applies');

-- 2,000-char rule: all or nothing
reset role;
update public.projects set learnings = repeat('가', 1990) where id = 'aaaaaaaa-3333-0000-0000-000000000001';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'append', 'target', '{"section":"star","field":"learnings"}'::jsonb, 'value', '열 글자가 넘는 배운 점',
                     'source_message_ids', jsonb_build_array(current_setting('t.m2'))),
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"task"}'::jsonb, 'value', '리드',
                     'source_message_ids', jsonb_build_array(current_setting('t.m2'))))))$$, 'learnings + task proposals');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.apply_writing_chat_proposal(current_setting('t.chat')::uuid)$$,
                 'P0001', 'field_too_long', 'a field over 2,000 chars rejects the whole apply');
select is((select task from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'), null,
          'nothing applied (task untouched)');
select is(public.apply_writing_chat_proposal(current_setting('t.chat')::uuid, array['task']) -> 'applied', '["task"]'::jsonb,
          'other fields still apply on their own');

-- QA-R4-02: trailing whitespace / blank lines of the current value are dropped before appending and measuring.
reset role;
update public.projects set result = '빨라졌다' || repeat(' ', 30) || E'\n\n',
                           task = repeat('가', 1990) || repeat(' ', 9)
 where id = 'aaaaaaaa-3333-0000-0000-000000000001';
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'append', 'target', '{"section":"star","field":"result"}'::jsonb, 'value', '30% 줄었다',
                     'source_message_ids', jsonb_build_array(current_setting('t.m2'))),
  jsonb_build_object('op', 'append', 'target', '{"section":"star","field":"task"}'::jsonb, 'value', '리드',
                     'source_message_ids', jsonb_build_array(current_setting('t.m2'))))))$$, 'appends onto padded values');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.apply_writing_chat_proposal(current_setting('t.chat')::uuid, array['result', 'task']) -> 'applied',
          '["task", "result"]'::jsonb, 'trimmed length fits: 1,990 + 1 + 2 <= 2,000 (untrimmed would be 2,002)');
select results_eq($$select result, char_length(task) from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'$$,
                  $$values (E'빨라졌다\n30% 줄었다'::text, 1993)$$, 'joined with exactly one newline, no blank line');

-- closed chat still applies
reset role;
update public.writing_chats set status = 'closed' where id = current_setting('t.chat')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.apply_writing_chat_proposal(current_setting('t.chat')::uuid, array['situation'])$$,
                'closed chat: apply allowed');

-- no key needed: delete the user's provider settings and apply still works (no AI call)
select is((select count(*)::int from public.ai_provider_keys_public), 0, 'A has no key');

-- deleting the chat keeps applied STAR; source_writing_chat_id set null
select lives_ok($$delete from public.writing_chats where id = current_setting('t.chat')::uuid$$, 'delete chat');
select results_eq($$select situation, source_writing_chat_id from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'$$,
                  $$values ('결제 API 병목'::text, null::uuid)$$, 'applied STAR stays, source chat link cleared');

-- B cannot apply A's chat
select set_config('t.chat2', public.start_writing_chat('aaaaaaaa-3333-0000-0000-000000000001')::text, true);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.apply_writing_chat_proposal(current_setting('t.chat2')::uuid)$$,
                 'P0001', 'writing_chat_not_found', 'B cannot apply A''s chat');
select throws_ok($$select private.wc_proposal_mark_applied(current_setting('t.chat2')::uuid, array['situation'])$$,
                 'P0001', 'writing_chat_not_found', 'B cannot reach the definer helper on A''s chat');
reset role;

-- role limits
select ok(not has_function_privilege('app_ai_writer', 'public.apply_writing_chat_proposal(uuid, text[])', 'execute'),
          'app_ai_writer cannot execute apply_writing_chat_proposal (DM-13)');
select ok(not has_function_privilege('anon', 'public.apply_writing_chat_proposal(uuid, text[])', 'execute'),
          'anon cannot execute');
select is((select prosecdef from pg_proc where oid = 'public.apply_writing_chat_proposal(uuid, text[])'::regprocedure), false,
          'security invoker (projects write under the user''s RLS)');
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select public.apply_writing_chat_proposal(gen_random_uuid())$$, '42501', 'not_authenticated', 'no sub');
reset role;

select * from finish();
rollback;
