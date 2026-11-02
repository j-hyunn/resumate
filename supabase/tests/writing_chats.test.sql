-- S4 writing_chats / writing_chat_messages: structure, RLS isolation, write paths, message RPCs, cap 40,
-- 다시 보내기, status guard (DM §2.5, §5; AI-12; UX S-36).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

insert into public.projects (id, user_id, name) values
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'A project'),
  ('bbbbbbbb-3333-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'B project');

-- A: free-tier active key (greeting notice). B: no key.
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek,
                                     kek_id, key_last4, status)
values ('aaaaaaaa-9999-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free',
        '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'valid');
update public.profiles set active_ai_provider = 'gemini' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ── structure ──────────────────────────────────────────────────────────────
select ok((select relrowsecurity from pg_class where oid = 'public.writing_chats'::regclass), 'writing_chats RLS on');
select ok((select relrowsecurity from pg_class where oid = 'public.writing_chat_messages'::regclass),
          'writing_chat_messages RLS on');
select policies_are('public', 'writing_chats',
  array['writing_chats_select_own', 'writing_chats_update_own', 'writing_chats_delete_own', 'writing_chats_select_ai_writer']);
select policies_are('public', 'writing_chat_messages',
  array['writing_chat_messages_select_own', 'writing_chat_messages_select_ai_writer']);
select col_default_is('public', 'writing_chats', 'status', 'active'::text, 'status default active');
select has_column('public', 'writing_chats', 'last_extracted_sequence', 'last_extracted_sequence (spec-gaps ①)');
select hasnt_column('public', 'writing_chats', 'usage_event_id', 'no usage_event_id (v4, D-34)');

-- DM §2.5: nobody (but the owner / platform superusers) can UPDATE structured_draft directly.
select is_empty(
  $$select r.rolname from pg_roles r
     where r.rolname not in ('postgres', 'supabase_admin') and not r.rolsuper
       and not pg_has_role(r.oid, 'pg_write_all_data', 'usage')
       and has_column_privilege(r.oid, 'public.writing_chats'::regclass, 'structured_draft', 'UPDATE')$$,
  'no role has UPDATE on writing_chats.structured_draft');
select set_eq(
  $$select a.attname::text || ':' || p.privilege_type
      from pg_attribute a
      cross join lateral (values ('INSERT'), ('UPDATE')) p (privilege_type)
     where a.attrelid = 'public.writing_chats'::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('authenticated', a.attrelid, a.attnum, p.privilege_type)$$,
  array['status:UPDATE', 'return_target:UPDATE'],
  'authenticated: writing_chats direct writes = UPDATE (status, return_target) only');
select ok(not has_any_column_privilege('authenticated', 'public.writing_chat_messages', 'INSERT')
          and not has_any_column_privilege('authenticated', 'public.writing_chat_messages', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.writing_chat_messages', 'DELETE'),
          'authenticated: no direct writes on writing_chat_messages');
select ok(not has_any_column_privilege('app_ai_writer', 'public.writing_chats', 'UPDATE')
          and not has_any_column_privilege('app_ai_writer', 'public.writing_chats', 'INSERT')
          and not has_any_column_privilege('app_ai_writer', 'public.writing_chat_messages', 'INSERT')
          and not has_any_column_privilege('app_ai_writer', 'public.writing_chat_messages', 'UPDATE')
          and not has_table_privilege('app_ai_writer', 'public.writing_chats', 'DELETE'),
          'app_ai_writer: no direct writes on the writing chat tables (RPCs only)');
select ok(not has_any_column_privilege('service_role', 'public.writing_chats', 'UPDATE')
          and has_table_privilege('service_role', 'public.writing_chats', 'DELETE'),
          'service_role: no UPDATE, DELETE kept for the 90-day cleanup');

-- ── start_writing_chat ─────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok($$select public.start_writing_chat('enrich_project')$$, 'P0001', 'invalid_mode', 'mode CHECK');
select throws_ok($$select public.start_writing_chat(null)$$, 'P0001', 'invalid_mode', 'null mode');
select throws_ok($$select public.start_writing_chat('augment_project')$$, 'P0001', 'project_required', 'augment needs a project');
select throws_ok($$select public.start_writing_chat('augment_project', 'bbbbbbbb-3333-0000-0000-000000000001')$$,
                 'P0001', 'project_not_found', 'augment: B''s project is not found');
select throws_ok($$select public.start_writing_chat('new_project', 'aaaaaaaa-3333-0000-0000-000000000001')$$,
                 'P0001', 'project_not_allowed', 'new_project takes no project');
select throws_ok($$select public.start_writing_chat('new_project', null, '{"feature":"insight"}')$$,
                 'P0001', 'invalid_return_target', 'return_target needs application_project_id');
select throws_ok($$select public.start_writing_chat('new_project', null,
                   '{"feature":"board","application_project_id":"aaaaaaaa-7777-0000-0000-000000000001"}')$$,
                 'P0001', 'invalid_return_target', 'return_target feature CHECK');
select throws_ok($$select public.start_writing_chat('new_project', null, '"insight"')$$,
                 'P0001', 'invalid_return_target', 'return_target must be an object');

select lives_ok($$select set_config('t.chat', public.start_writing_chat('new_project', null,
                   '{"application_project_id":"AAAAAAAA-7777-0000-0000-000000000001","feature":"job_interview","params":{"question_count":5}}')::text, true)$$,
                'start new_project chat with return_target');
select is((select (message_count, status, mode, project_id is null, structured_draft = private.writing_chat_empty_draft())::text
             from public.writing_chats where id = current_setting('t.chat')::uuid),
          '(0,active,new_project,t,t)', 'chat starts active with count 0 (greeting not counted, R1 A5) and an empty draft skeleton');
select is((select return_target - 'created_at' from public.writing_chats where id = current_setting('t.chat')::uuid),
          '{"application_project_id":"aaaaaaaa-7777-0000-0000-000000000001","feature":"job_interview","params":{"question_count":5}}'::jsonb,
          'return_target normalized');
select isnt((select return_target ->> 'created_at' from public.writing_chats where id = current_setting('t.chat')::uuid),
            null, 'return_target.created_at set by the server');
select is((select (sequence, role, status, ai_job_id is null, provider is null)::text
             from public.writing_chat_messages where writing_chat_id = current_setting('t.chat')::uuid),
          '(1,assistant,done,t,t)', 'greeting = sequence 1 assistant, no AI job, no provider');
select ok((select content like '%민감정보%' and content like '%무료 등급%' from public.writing_chat_messages
            where writing_chat_id = current_setting('t.chat')::uuid), 'greeting: sensitive-info notice + free-tier notice');

select lives_ok($$select set_config('t.aug', public.start_writing_chat('augment_project',
                   'aaaaaaaa-3333-0000-0000-000000000001')::text, true)$$, 'start augment chat');
select is((select project_id from public.writing_chats where id = current_setting('t.aug')::uuid),
          'aaaaaaaa-3333-0000-0000-000000000001'::uuid, 'augment chat bound to the project');

-- Direct writes refused.
select throws_ok($$insert into public.writing_chats (mode) values ('new_project')$$, '42501', null,
                 'no direct insert of writing_chats');
select throws_ok($$update public.writing_chats set structured_draft = '{}' where id = current_setting('t.chat')::uuid$$,
                 '42501', null, 'no direct update of structured_draft');
select throws_ok($$update public.writing_chats set message_count = 0 where id = current_setting('t.chat')::uuid$$,
                 '42501', null, 'no direct update of message_count');
select throws_ok($$insert into public.writing_chat_messages (writing_chat_id, sequence, role, content)
                   values (current_setting('t.chat')::uuid, 9, 'user', 'x')$$, '42501', null,
                 'no direct insert of messages');
select throws_ok($$update public.writing_chats set status = 'saved' where id = current_setting('t.chat')::uuid$$,
                 'P0001', 'invalid_writing_chat_transition', 'user cannot set saved directly');

-- ── append_writing_chat_message ────────────────────────────────────────────
select throws_ok($$select * from public.append_writing_chat_message(current_setting('t.chat')::uuid, '   ')$$,
                 'P0001', 'invalid_content', 'blank content');
select throws_ok($$select * from public.append_writing_chat_message(current_setting('t.chat')::uuid, repeat('x', 4001))$$,
                 'P0001', 'invalid_content', 'content > 4000');
select throws_ok($$select * from public.append_writing_chat_message(gen_random_uuid(), 'hi')$$,
                 'P0001', 'writing_chat_not_found', 'unknown chat');
select results_eq($$select sequence, message_count from public.append_writing_chat_message(current_setting('t.chat')::uuid, '  결제 프로젝트였어요 ')$$,
                  $$values (2::smallint, 1::smallint)$$, 'user message = sequence 2, count 1 (greeting not counted)');
select is((select content from public.writing_chat_messages where writing_chat_id = current_setting('t.chat')::uuid and sequence = 2),
          '결제 프로젝트였어요', 'content stored trimmed');

-- ── B isolation ────────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.writing_chats), 0, 'B sees no chats of A');
select is((select count(*)::int from public.writing_chat_messages), 0, 'B sees no messages of A');
select throws_ok($$select * from public.append_writing_chat_message(current_setting('t.chat')::uuid, 'hi')$$,
                 'P0001', 'writing_chat_not_found', 'B cannot append to A''s chat');
select lives_ok($$update public.writing_chats set status = 'abandoned' where id = current_setting('t.chat')::uuid$$,
                'B update runs');
select lives_ok($$delete from public.writing_chats where id = current_setting('t.chat')::uuid$$, 'B delete runs');
select lives_ok($$select set_config('t.bchat', public.start_writing_chat('new_project')::text, true)$$, 'B starts a chat');
select ok((select content not like '%무료 등급%' from public.writing_chat_messages
            where writing_chat_id = current_setting('t.bchat')::uuid), 'greeting without free-tier notice (no key)');
reset role;
select is((select status from public.writing_chats where id = current_setting('t.chat')::uuid), 'active',
          'A''s chat untouched by B');

-- ── assistant messages (app_ai_writer) ─────────────────────────────────────
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, provider, model_tier, connection_tier) values
  ('aaaaaaaa-5555-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'writing_chat_turn', 'writing_chat',
   current_setting('t.chat')::uuid, 'gemini', 'default', 'free'),
  ('aaaaaaaa-5555-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'insight', null, null,
   'gemini', 'default', 'free'),
  ('aaaaaaaa-5555-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'writing_chat_turn', 'writing_chat',
   current_setting('t.aug')::uuid, 'gemini', 'default', 'free');

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';

select is((select count(*)::int from public.writing_chats), 2, 'app_ai_writer reads its user''s chats');
select throws_ok($$insert into public.projects (name) values ('x')$$, '42501', null,
                 'app_ai_writer cannot insert career rows');
select throws_ok($$update public.projects set name = 'x'$$, '42501', null, 'app_ai_writer cannot update career rows');
select throws_ok($$select public.save_writing_chat(current_setting('t.chat')::uuid)$$, '42501', null,
                 'app_ai_writer cannot execute save_writing_chat');
select throws_ok($$select public.start_writing_chat('new_project')$$, '42501', null,
                 'app_ai_writer cannot start a chat');
select throws_ok($$select * from public.append_writing_chat_message(current_setting('t.chat')::uuid, 'x')$$, '42501', null,
                 'app_ai_writer cannot append user messages');

select throws_ok($$select * from public.begin_assistant_message(current_setting('t.chat')::uuid,
                   'aaaaaaaa-5555-0000-0000-000000000002', 'gemini', 'gemini-flash', 'default', 'free')$$,
                 'P0001', 'invalid_ai_job', 'job must be a writing_chat_turn');
select throws_ok($$select * from public.begin_assistant_message(current_setting('t.chat')::uuid,
                   'aaaaaaaa-5555-0000-0000-000000000003', 'gemini', 'gemini-flash', 'default', 'free')$$,
                 'P0001', 'invalid_ai_job', 'job must target this chat');
select throws_ok($$select * from public.begin_assistant_message(current_setting('t.chat')::uuid,
                   'aaaaaaaa-5555-0000-0000-000000000001', 'mistral', 'm', 'default', 'free')$$,
                 'P0001', 'invalid_ai_metadata', 'provider CHECK');
select throws_ok($$select * from public.begin_assistant_message(current_setting('t.aug')::uuid,
                   'aaaaaaaa-5555-0000-0000-000000000003', 'gemini', 'gemini-flash', 'default', 'free')$$,
                 'P0001', 'no_pending_user_message', 'no user message after the greeting');

select results_eq($$select sequence, message_count, reused, is_final from public.begin_assistant_message(current_setting('t.chat')::uuid,
                    'aaaaaaaa-5555-0000-0000-000000000001', 'gemini', 'gemini-flash', 'default', 'free')$$,
                  $$values (3::smallint, 2::smallint, false, false)$$, 'begin: new streaming row (sequence 3), count 2');
select set_config('t.reply', (select id::text from public.writing_chat_messages
                                where writing_chat_id = current_setting('t.chat')::uuid and sequence = 3), true);
select is((select (status, content, ai_job_id, provider, model, model_tier, connection_tier)::text
             from public.writing_chat_messages where id = current_setting('t.reply')::uuid),
          '(streaming,"",aaaaaaaa-5555-0000-0000-000000000001,gemini,gemini-flash,default,free)', 'assistant meta stored');
select throws_ok($$select * from public.begin_assistant_message(current_setting('t.chat')::uuid,
                   'aaaaaaaa-5555-0000-0000-000000000001', 'gemini', 'gemini-flash', 'default', 'free')$$,
                 'P0001', 'turn_in_progress', 'a fresh streaming row blocks another begin');

select throws_ok($$select public.finish_assistant_message(current_setting('t.reply')::uuid, 'streaming', 'x')$$,
                 'P0001', 'invalid_message_status', 'finish status CHECK');
select throws_ok($$select public.finish_assistant_message(current_setting('t.reply')::uuid, 'done', '  ')$$,
                 'P0001', 'invalid_content', 'done needs content');
select lives_ok($$select public.finish_assistant_message(current_setting('t.reply')::uuid, 'failed', '부분 응')$$,
                'finish as failed keeps the partial text');
select throws_ok($$select public.finish_assistant_message(current_setting('t.reply')::uuid, 'done', 'x')$$,
                 'P0001', 'invalid_message_state', 'finish only from streaming');
select throws_ok($$select public.finish_assistant_message(
                     (select id from public.writing_chat_messages where writing_chat_id = current_setting('t.chat')::uuid and sequence = 2),
                     'done', 'x')$$,
                 'P0001', 'invalid_message_state', 'finish refuses user messages');

-- 다시 보내기: same row, count unchanged.
select results_eq($$select message_id, sequence, message_count, reused from public.begin_assistant_message(current_setting('t.chat')::uuid,
                    'aaaaaaaa-5555-0000-0000-000000000001', 'anthropic', 'claude-sonnet-5-5', 'default', 'paid')$$,
                  $$select current_setting('t.reply')::uuid, 3::smallint, 2::smallint, true$$,
                  'resend reuses the failed row without counting');
select is((select (status, content, provider)::text from public.writing_chat_messages where id = current_setting('t.reply')::uuid),
          '(streaming,"",anthropic)', 'resent row is streaming again with the new provider');
select lives_ok($$select public.finish_assistant_message(current_setting('t.reply')::uuid, 'done', '언제 하셨나요?')$$,
                'finish done');
select is((select count(*)::int from public.writing_chat_messages where writing_chat_id = current_setting('t.chat')::uuid),
          3, 'three messages');
select throws_ok($$select * from public.begin_assistant_message(current_setting('t.chat')::uuid,
                   'aaaaaaaa-5555-0000-0000-000000000001', 'gemini', 'gemini-flash', 'default', 'free')$$,
                 'P0001', 'no_pending_user_message', 'last message is a done reply');

-- Client abort: api closes the streaming row as failed right away (empty content allowed) -> resend works at once.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select * from public.append_writing_chat_message(current_setting('t.aug')::uuid, '보강할게요')$$, 'aug user msg');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select set_config('t.augreply', (select message_id::text from public.begin_assistant_message(current_setting('t.aug')::uuid,
  'aaaaaaaa-5555-0000-0000-000000000003', 'gemini', 'gemini-flash', 'default', 'free')), true);
select lives_ok($$select public.finish_assistant_message(current_setting('t.augreply')::uuid, 'failed', '')$$,
                'abort: streaming -> failed immediately with no content');
select results_eq($$select message_id, reused from public.begin_assistant_message(current_setting('t.aug')::uuid,
                    'aaaaaaaa-5555-0000-0000-000000000003', 'gemini', 'gemini-flash', 'default', 'free')$$,
                  $$select current_setting('t.augreply')::uuid, true$$, 'resend right after an abort reuses the row');
select lives_ok($$select public.finish_assistant_message(current_setting('t.augreply')::uuid, 'done', '네')$$, 'aug reply done');

-- mark_writing_chat_extracted
select throws_ok($$select public.mark_writing_chat_extracted(current_setting('t.chat')::uuid, 4::smallint)$$,
                 'P0001', 'invalid_sequence', 'beyond the last message');
select is(public.mark_writing_chat_extracted(current_setting('t.chat')::uuid, 2::smallint), 2::smallint, 'marked 2');
select is(public.mark_writing_chat_extracted(current_setting('t.chat')::uuid, 1::smallint), 2::smallint, 'never moves back');
select throws_ok($$select public.mark_writing_chat_extracted('bbbbbbbb-0000-0000-0000-000000000009', 1::smallint)$$,
                 'P0001', 'writing_chat_not_found', 'unknown chat');

-- B's chat is invisible to A's AI token.
select throws_ok($$select public.mark_writing_chat_extracted(current_setting('t.bchat')::uuid, 1::smallint)$$,
                 'P0001', 'writing_chat_not_found', 'app_ai_writer (A) cannot touch B''s chat');

-- ── stale streaming row (dead turn) ────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select * from public.append_writing_chat_message(current_setting('t.chat')::uuid, '23년 3월부터요')$$,
                'user message 4');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select * from public.begin_assistant_message(current_setting('t.chat')::uuid,
                  'aaaaaaaa-5555-0000-0000-000000000001', 'gemini', 'gemini-flash', 'default', 'free')$$, 'begin reply 5');
reset role;
alter table public.writing_chat_messages disable trigger writing_chat_messages_set_updated_at;
update public.writing_chat_messages set updated_at = now() - interval '3 minutes'
 where writing_chat_id = current_setting('t.chat')::uuid and sequence = 5;
alter table public.writing_chat_messages enable trigger writing_chat_messages_set_updated_at;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select results_eq($$select sequence, message_count, reused from public.begin_assistant_message(current_setting('t.chat')::uuid,
                    'aaaaaaaa-5555-0000-0000-000000000001', 'gemini', 'gemini-flash', 'default', 'free')$$,
                  $$values (5::smallint, 4::smallint, true)$$, 'a streaming row older than 2 minutes is reused');

-- QA-S4-04: no user message while a live turn is streaming (two tabs).
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select * from public.append_writing_chat_message(current_setting('t.chat')::uuid, '팀은 4명')$$,
                 'P0001', 'turn_in_progress', 'append refused while reply 5 is live');
-- The turn job ends without finish (crash): the row is dead at once, not after 2 minutes.
reset role;
update public.ai_jobs set status = 'failed', error_code = 'stalled' where id = 'aaaaaaaa-5555-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select * from public.append_writing_chat_message(current_setting('t.chat')::uuid, '팀은 4명')$$,
                'user message 6 accepted: streaming row 5 belongs to a finished job');
reset role;
update public.ai_jobs set status = 'queued' where id = 'aaaaaaaa-5555-0000-0000-000000000001';
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select results_eq($$select sequence, reused from public.begin_assistant_message(current_setting('t.chat')::uuid,
                    'aaaaaaaa-5555-0000-0000-000000000001', 'gemini', 'gemini-flash', 'default', 'free')$$,
                  $$values (7::smallint, false)$$, 'new reply 7');
select is((select status from public.writing_chat_messages where writing_chat_id = current_setting('t.chat')::uuid and sequence = 5),
          'failed', 'dead streaming row 5 closed as failed');

-- ── cap 40 ─────────────────────────────────────────────────────────────────
select lives_ok($$select public.finish_assistant_message((select id from public.writing_chat_messages
                   where writing_chat_id = current_setting('t.chat')::uuid and sequence = 7), 'failed', '')$$, 'close 7');
reset role;
update public.writing_chats set message_count = 38 where id = current_setting('t.chat')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select results_eq($$select message_count from public.append_writing_chat_message(current_setting('t.chat')::uuid, '마지막 답')$$,
                  $$values (39::smallint)$$, 'user message accepted at 38 -> 39');
select throws_ok($$select * from public.append_writing_chat_message(current_setting('t.chat')::uuid, '하나 더')$$,
                 'P0001', 'message_limit_reached', 'no user message at 39 (no room for a reply)');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select results_eq($$select message_count, is_final from public.begin_assistant_message(current_setting('t.chat')::uuid,
                    'aaaaaaaa-5555-0000-0000-000000000001', 'gemini', 'gemini-flash', 'default', 'free')$$,
                  $$values (40::smallint, true)$$, 'the last reply fits: count 40, is_final');
select lives_ok($$select public.finish_assistant_message((select id from public.writing_chat_messages
                   where writing_chat_id = current_setting('t.chat')::uuid order by sequence desc limit 1), 'failed', '')$$,
                'last reply failed');
select results_eq($$select message_count, reused from public.begin_assistant_message(current_setting('t.chat')::uuid,
                    'aaaaaaaa-5555-0000-0000-000000000001', 'gemini', 'gemini-flash', 'default', 'free')$$,
                  $$values (40::smallint, true)$$, 'resend at the cap still works (does not count)');
reset role;
select throws_ok($$update public.writing_chats set message_count = 41 where id = current_setting('t.chat')::uuid$$,
                 '23514', null, 'message_count CHECK 0..40');

-- ── status guard ───────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$update public.writing_chats set status = 'abandoned' where id = current_setting('t.aug')::uuid$$,
                'user abandons a chat');
select throws_ok($$select * from public.append_writing_chat_message(current_setting('t.aug')::uuid, 'x')$$,
                 'P0001', 'writing_chat_not_active', 'no messages after abandoning');
-- R1 A6: abandoned -> active (다시 이어 하기) by the user session; only back to active.
select throws_ok($$update public.writing_chats set status = 'saved' where id = current_setting('t.aug')::uuid$$,
                 'P0001', 'invalid_writing_chat_transition', 'abandoned -> saved refused');
select throws_ok($$update public.writing_chats set status = 'handed_off' where id = current_setting('t.aug')::uuid$$,
                 'P0001', 'invalid_writing_chat_transition', 'abandoned -> handed_off refused');
reset role;
update public.writing_chats set last_activity_at = now() - interval '30 days' where id = current_setting('t.aug')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$update public.writing_chats set status = 'active' where id = current_setting('t.aug')::uuid$$,
                'user resumes an abandoned chat (A6)');
select results_eq($$select status, last_activity_at > now() - interval '1 minute', message_count
                     from public.writing_chats where id = current_setting('t.aug')::uuid$$,
                  $$values ('active'::text, true, 2::smallint)$$, 'resumed: active, last_activity_at = now(), count carried over (2)');
select results_eq($$select message_count from public.append_writing_chat_message(current_setting('t.aug')::uuid, '이어서 할게요')$$,
                  $$values (3::smallint)$$, 'messages accepted again after resuming (count continues)');
select lives_ok($$update public.writing_chats set status = 'abandoned' where id = current_setting('t.aug')::uuid$$,
                'abandon again');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select is_empty($$update public.writing_chats set status = 'active' where id = current_setting('t.aug')::uuid returning id$$,
                'B cannot resume A''s chat');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$update public.writing_chats set return_target = null where id = current_setting('t.aug')::uuid$$,
                'return_target stays updatable');
select throws_ok($$update public.writing_chats set return_target = '{"feature":"board"}' where id = current_setting('t.aug')::uuid$$,
                 '23514', null, 'return_target feature CHECK');
select lives_ok($$delete from public.writing_chats where id = current_setting('t.aug')::uuid$$, 'user deletes own chat');
reset role;
select is((select count(*)::int from public.writing_chat_messages where writing_chat_id = current_setting('t.aug')::uuid), 0,
          'messages cascade with the chat');

-- anon
set local role anon;
select throws_ok($$select * from public.writing_chats$$, '42501', null, 'anon cannot read writing_chats');
select throws_ok($$select public.start_writing_chat('new_project')$$, '42501', null, 'anon cannot start');
reset role;

-- not authenticated (no sub)
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$select public.start_writing_chat('new_project')$$, '42501', 'not_authenticated', 'no sub');
reset role;

-- account deletion cascades chats and messages
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select count(*)::int from public.writing_chats where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0,
          'account deletion removes chats');
select is((select count(*)::int from public.writing_chat_messages where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0,
          'account deletion removes messages');

select * from finish();
rollback;
