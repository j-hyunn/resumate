-- S4 privilege regression (see career_first_call_privileges.test.sql for why): every writing chat path is
-- first called by its real role. Nothing touches S4 tables / functions as postgres before that role does.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$insert into public.experiences (id, company_name, start_month, job_rank)
                  values ('aaaaaaaa-1111-0000-0000-000000000001', 'A', '2020-01-01', 'S')$$, 'experience');
select lives_ok($$insert into public.projects (id, name) values ('aaaaaaaa-3333-0000-0000-000000000001', 'Old')$$,
                'augment target project');
select lives_ok($$insert into public.project_details (id, project_id, title)
                  values ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000001', 'Ep')$$,
                'augment target detail');

select lives_ok($$select set_config('test.chat', public.start_writing_chat('new_project')::text, true)$$,
                'authenticated: start_writing_chat');
select lives_ok($$select public.set_writing_chat_affiliation(current_setting('test.chat')::uuid,
                   'aaaaaaaa-1111-0000-0000-000000000001')$$, 'authenticated: set_writing_chat_affiliation');
select lives_ok($$select set_config('test.msg', (select message_id::text from public.append_writing_chat_message(
                   current_setting('test.chat')::uuid, '결제 프로젝트를 했어요')), true)$$,
                'authenticated: append_writing_chat_message');
select lives_ok($$select * from public.writing_chats$$, 'authenticated: select writing_chats');
select lives_ok($$select * from public.writing_chat_messages$$, 'authenticated: select writing_chat_messages');

reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';

select lives_ok($$select * from public.writing_chats$$, 'app_ai_writer: select writing_chats');
select lives_ok($$select * from public.writing_chat_messages$$, 'app_ai_writer: select messages');
select lives_ok($$insert into public.ai_jobs (id, job_type, target_type, target_id, provider, model_tier, connection_tier)
                  values ('aaaaaaaa-9999-0000-0000-000000000001', 'writing_chat_turn', 'writing_chat',
                          current_setting('test.chat')::uuid, 'anthropic', 'default', 'paid')$$, 'turn job');
select lives_ok($$select set_config('test.reply', (select message_id::text from public.begin_assistant_message(
                   current_setting('test.chat')::uuid, 'aaaaaaaa-9999-0000-0000-000000000001',
                   'anthropic', 'claude-sonnet-5-5', 'default', 'paid')), true)$$,
                'app_ai_writer: begin_assistant_message');
select lives_ok($$select public.finish_assistant_message(current_setting('test.reply')::uuid, 'done', '언제 하셨나요?')$$,
                'app_ai_writer: finish_assistant_message');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('test.chat')::uuid, jsonb_build_object('ops',
                   jsonb_build_array(
                     jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"name"}'::jsonb,
                       'value', '결제 프로젝트', 'source_message_ids', jsonb_build_array(current_setting('test.msg')),
                       'source_quotes', '["결제 프로젝트"]'::jsonb, 'review', 'needs_review'),
                     '{"op":"new_detail","detail_key":"D1"}'::jsonb,
                     jsonb_build_object('op', 'add_skill', 'value', 'Kafka',
                       'source_message_ids', jsonb_build_array(current_setting('test.msg'))))))$$,
                'app_ai_writer: apply_structured_draft_patch');
select lives_ok($$select public.mark_writing_chat_extracted(current_setting('test.chat')::uuid, 2::smallint)$$,
                'app_ai_writer: mark_writing_chat_extracted');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$select public.apply_structured_draft_patch(current_setting('test.chat')::uuid,
                   '{"ops":[{"op":"accept","target":{"section":"project","field":"name"}},
                            {"op":"set","target":{"section":"detail","detail_key":"D1","field":"title"},"value":"T"}]}')$$,
                'authenticated: apply_structured_draft_patch');
select lives_ok($$select set_config('test.save', public.save_writing_chat(current_setting('test.chat')::uuid)::text, true)$$,
                'authenticated: save_writing_chat');
select is((select count(*)::int from public.project_skills ps
            join public.projects p on p.id = ps.project_id where p.source_writing_chat_id = current_setting('test.chat')::uuid),
          1, 'saved project linked to its skill');

select lives_ok($$select set_config('test.chat2', public.start_writing_chat('augment_project',
                   'aaaaaaaa-3333-0000-0000-000000000001', '{"application_project_id":"aaaaaaaa-7777-0000-0000-000000000001","feature":"insight"}')::text, true)$$,
                'authenticated: start augment chat');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('test.chat2')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"detail","existing_detail_id":"aaaaaaaa-4444-0000-0000-000000000001","field":"situation"},"value":"S"},
                            {"op":"set","target":{"section":"project","field":"role"},"value":"Dev"}]}')$$,
                'authenticated: user patch on augment fields');
select lives_ok($$select public.hand_off_writing_chat(current_setting('test.chat2')::uuid)$$,
                'authenticated: hand_off_writing_chat (updates existing rows)');
select is((select situation from public.project_details where id = 'aaaaaaaa-4444-0000-0000-000000000001'), 'S',
          'hand-off filled the empty detail column');
select lives_ok($$update public.writing_chats set return_target = null where id = current_setting('test.chat2')::uuid$$,
                'authenticated: clear return_target');

select lives_ok($$select set_config('test.chat3', public.start_writing_chat('new_project')::text, true)$$, 'third chat');
select lives_ok($$update public.writing_chats set status = 'abandoned' where id = current_setting('test.chat3')::uuid$$,
                'authenticated: abandon (direct status update)');
select lives_ok($$select public.get_deletion_impact('writing_chat', current_setting('test.chat')::uuid)$$,
                'authenticated: get_deletion_impact writing_chat');
select lives_ok($$select public.delete_career_item('writing_chat', current_setting('test.chat')::uuid)$$,
                'authenticated: delete_career_item writing_chat (FK set null on career rows)');
select lives_ok($$select public.delete_career_item('project', 'aaaaaaaa-3333-0000-0000-000000000001')$$,
                'authenticated: delete project (chat cascade)');
select is((select count(*)::int from public.writing_chats), 1, 'only the abandoned chat is left');

select * from finish();
rollback;
