-- S4 apply_structured_draft_patch + set_writing_chat_affiliation (DM §2.5 R-29, AI-12 매핑, V-9a, V-9h,
-- protected fields, accept / reject). Contract: _workspace/backend/S4/02_db-engineer_notes.md.
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
insert into public.educations (id, user_id, institution_name, education_type, start_month) values
  ('aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'U', 'degree', '2014-03-01');
-- Augment target: name filled, role empty, summary blank.
insert into public.projects (id, user_id, name, summary) values
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Old', '  '),
  ('aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Other', null);
insert into public.project_details (id, user_id, project_id, title, situation, sort_order) values
  ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000001',
   'Ep', 'S filled', 1),
  ('aaaaaaaa-4444-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000002',
   'Elsewhere', null, 1);

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.chat', public.start_writing_chat('new_project')::text, true);
select set_config('t.m2', (select message_id::text from public.append_writing_chat_message(current_setting('t.chat')::uuid,
  'ABC Pay 다닐 때 결제 프로젝트를 했어요. 저 포함 4명이었어요')), true);
select set_config('t.aug', public.start_writing_chat('augment_project', 'aaaaaaaa-3333-0000-0000-000000000001')::text, true);
select set_config('t.am2', (select message_id::text from public.append_writing_chat_message(current_setting('t.aug')::uuid,
  '장애 알림이 확 줄었어요')), true);
select set_config('t.greeting', (select id::text from public.writing_chat_messages
                                   where writing_chat_id = current_setting('t.chat')::uuid and sequence = 1), true);
reset role;

-- B's chat with a user message (for cross-chat source checks).
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('t.bchat', public.start_writing_chat('new_project')::text, true);
select set_config('t.bm2', (select message_id::text from public.append_writing_chat_message(current_setting('t.bchat')::uuid, 'B says')), true);
reset role;

create function pg_temp.src(p text) returns jsonb language sql as $$ select jsonb_build_array(current_setting(p)) $$;
grant execute on function pg_temp.src(text) to authenticated, app_ai_writer;

-- ════════ AI patches ════════
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';

select set_config('t.r', public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"team_size"}'::jsonb, 'value', 4,
                     'source_message_ids', pg_temp.src('t.m2'), 'source_quotes', '["저 포함 4명이었어요"]'::jsonb),
  jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"name"}'::jsonb, 'value', '  결제 프로젝트 ',
                     'source_message_ids', pg_temp.src('t.m2'), 'review', 'needs_review'),
  -- V-9a: the greeting (assistant) can't be a source
  jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"role"}'::jsonb, 'value', '리드',
                     'source_message_ids', pg_temp.src('t.greeting')),
  -- V-9a: a user message of another user's chat
  jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"summary"}'::jsonb, 'value', 'x',
                     'source_message_ids', pg_temp.src('t.bm2')),
  -- no source at all
  jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"start_month"}'::jsonb, 'value', '2023-03',
                     'source_message_ids', '[]'::jsonb),
  -- invalid month value
  jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"end_month"}'::jsonb, 'value', '2023-13',
                     'source_message_ids', pg_temp.src('t.m2')),
  -- detail D1 doesn't exist yet
  jsonb_build_object('op', 'set', 'target', '{"section":"detail","detail_key":"D1","field":"action"}'::jsonb, 'value', 'a',
                     'source_message_ids', pg_temp.src('t.m2')),
  '{"op":"new_detail","detail_key":"D1"}'::jsonb,
  jsonb_build_object('op', 'set', 'target', '{"section":"detail","detail_key":"D1","field":"situation"}'::jsonb,
                     'value', '결제 프로젝트', 'source_message_ids', pg_temp.src('t.m2'), 'source_quotes', '["결제 프로젝트"]'::jsonb),
  -- existing_detail_id in a new_project chat
  jsonb_build_object('op', 'set', 'target', '{"section":"detail","existing_detail_id":"aaaaaaaa-4444-0000-0000-000000000001","field":"action"}'::jsonb,
                     'value', 'a', 'source_message_ids', pg_temp.src('t.m2')),
  jsonb_build_object('op', 'add_achievement', 'detail', '{"detail_key":"D1"}'::jsonb, 'fields', jsonb_build_object(
                     'metric_name', jsonb_build_object('value', '팀 규모', 'source_message_ids', pg_temp.src('t.m2')),
                     'value_after', jsonb_build_object('value', 4, 'source_message_ids', pg_temp.src('t.m2'), 'review', 'needs_review'))),
  jsonb_build_object('op', 'add_achievement', 'detail', '{"detail_key":"D1"}'::jsonb, 'fields', jsonb_build_object(
                     'metric_name', jsonb_build_object('value', 'bad', 'source_message_ids', pg_temp.src('t.greeting')))),
  jsonb_build_object('op', 'add_skill', 'value', 'Kafka', 'source_message_ids', pg_temp.src('t.m2'), 'source_quotes', '["Kafka"]'::jsonb),
  jsonb_build_object('op', 'add_skill', 'value', ' kafka ', 'source_message_ids', pg_temp.src('t.m2'), 'source_quotes', '["kafka로"]'::jsonb),
  jsonb_build_object('op', 'set_affiliation_suggestion', 'type', 'experience', 'id', 'aaaaaaaa-1111-0000-0000-000000000001',
                     'source_message_ids', pg_temp.src('t.m2')),
  jsonb_build_object('op', 'set_affiliation_suggestion', 'type', 'experience', 'id', 'bbbbbbbb-1111-0000-0000-000000000001',
                     'source_message_ids', pg_temp.src('t.m2')),
  '{"op":"set_clarifications","items":[{"kind":"actor_ambiguous","field":"action","detail_key":"D1","note":"free text"}]}'::jsonb,
  '{"op":"add_sensitive_flags","count":2}'::jsonb
)))::text, true);

select is(current_setting('t.r')::jsonb -> 'rejected',
  '[{"index":2,"op":"set","reason":"invalid_source"},
    {"index":3,"op":"set","reason":"invalid_source"},
    {"index":4,"op":"set","reason":"invalid_source"},
    {"index":5,"op":"set","reason":"invalid_value"},
    {"index":6,"op":"set","reason":"detail_not_found"},
    {"index":9,"op":"set","reason":"detail_not_found"},
    {"index":11,"op":"add_achievement","reason":"invalid_source"},
    {"index":15,"op":"set_affiliation_suggestion","reason":"affiliation_not_found"}]'::jsonb,
  'AI patch: rule violations are skipped and reported per op (V-9a, value, detail refs, affiliation)');

select is((select structured_draft -> 'project' -> 'team_size' from public.writing_chats where id = current_setting('t.chat')::uuid),
          jsonb_build_object('value', 4, 'origin', 'ai', 'source_message_ids', pg_temp.src('t.m2'),
                             'source_quotes', '["저 포함 4명이었어요"]'::jsonb, 'review', 'ok', 'reviewed_at', null),
          'AI field object stored per DM §2.5');
select is((select structured_draft #>> '{project,name,value}' from public.writing_chats where id = current_setting('t.chat')::uuid),
          '결제 프로젝트', 'string value trimmed');
select is((select structured_draft #>> '{project,name,review}' from public.writing_chats where id = current_setting('t.chat')::uuid),
          'needs_review', 'needs_review stored (V-9e)');
select ok((select not (structured_draft -> 'project' ? 'role') and not (structured_draft -> 'project' ? 'summary')
             from public.writing_chats where id = current_setting('t.chat')::uuid), 'rejected fields stay empty');
select is((select jsonb_array_length(structured_draft -> 'details') from public.writing_chats where id = current_setting('t.chat')::uuid),
          1, 'only D1 exists');
select is((select structured_draft #> '{details,0,achievements}' from public.writing_chats where id = current_setting('t.chat')::uuid),
          jsonb_build_array(jsonb_build_object('achievement_key', 'A1',
            'metric_name', jsonb_build_object('value', '팀 규모', 'origin', 'ai', 'source_message_ids', pg_temp.src('t.m2'),
                                              'source_quotes', '[]'::jsonb, 'review', 'ok', 'reviewed_at', null),
            'value_after', jsonb_build_object('value', 4, 'origin', 'ai', 'source_message_ids', pg_temp.src('t.m2'),
                                              'source_quotes', '[]'::jsonb, 'review', 'needs_review', 'reviewed_at', null))),
          'achievement A1 with per-field objects; the bad one was not added');
select is((select structured_draft -> 'skills' from public.writing_chats where id = current_setting('t.chat')::uuid),
          jsonb_build_array(jsonb_build_object('value', 'Kafka', 'source_message_ids', pg_temp.src('t.m2'),
                                               'source_quotes', '["Kafka", "kafka로"]'::jsonb)),
          'skills deduplicated by normalized name, sources merged');
select is((select structured_draft -> 'affiliation_suggestion' from public.writing_chats where id = current_setting('t.chat')::uuid),
          jsonb_build_object('type', 'experience', 'id', 'aaaaaaaa-1111-0000-0000-000000000001',
                             'source_message_ids', pg_temp.src('t.m2')), 'affiliation suggestion stored');
select is((select structured_draft -> 'clarifications' from public.writing_chats where id = current_setting('t.chat')::uuid),
          '[{"kind":"actor_ambiguous","field":"action","detail_key":"D1","existing_detail_id":null}]'::jsonb,
          'clarifications stored without free text');
select is((select structured_draft -> 'sensitive_flags_count' from public.writing_chats where id = current_setting('t.chat')::uuid),
          '2'::jsonb, 'sensitive flags counted only');

-- Structural errors raise for the AI too.
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid, '{"ops":[{"op":"accept","target":{"section":"project","field":"name"}}]}')$$,
                 'P0001', 'invalid_patch', 'AI cannot accept');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid, '{"ops":[{"op":"remove_skill","value":"Kafka"}]}')$$,
                 'P0001', 'invalid_patch', 'AI cannot remove skills');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid, '{"ops":[]}')$$,
                 'P0001', 'invalid_patch', 'empty ops');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid, '[]')$$,
                 'P0001', 'invalid_patch', 'patch must be an object');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"project","field":"experience_id"},"value":"x"}]}')$$,
                 'P0001', 'invalid_patch', 'affiliation is not a project field (R-28)');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"new_detail","detail_key":"X1"}]}')$$,
                 'P0001', 'invalid_patch', 'detail_key format');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.bchat')::uuid,
                   '{"ops":[{"op":"new_detail","detail_key":"D1"}]}')$$,
                 'P0001', 'writing_chat_not_found', 'A''s AI token cannot patch B''s chat');
select throws_ok($$update public.writing_chats set structured_draft = '{}'$$, '42501', null,
                 'app_ai_writer cannot update structured_draft directly');

-- QA-S4-06: the private impl checks the actor against the calling role.
select throws_ok($$select private.apply_structured_draft_patch_impl(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"new_detail","detail_key":"D5"}]}', 'user')$$,
                 '42501', 'actor_mismatch', 'app_ai_writer cannot act as the user through the impl');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select private.apply_structured_draft_patch_impl(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"add_sensitive_flags","count":1}]}', 'ai')$$,
                 '42501', 'actor_mismatch', 'a user session cannot act as the AI through the impl');
reset role;
select throws_ok($$select private.apply_structured_draft_patch_impl(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"new_detail","detail_key":"D5"}]}', 'user')$$,
                 '42501', 'actor_mismatch', 'no SET ROLE (owner / service paths) is refused too');

-- ════════ user patches ════════
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is(public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
            '{"ops":[{"op":"set","target":{"section":"project","field":"role"},"value":"백엔드 리드","source_message_ids":["ignored"]}]}') -> 'rejected',
          '[]'::jsonb, 'user set succeeds');
select is((select structured_draft -> 'project' -> 'role' from public.writing_chats where id = current_setting('t.chat')::uuid),
          '{"value":"백엔드 리드","origin":"user_edit","source_message_ids":[],"source_quotes":[],"review":"ok","reviewed_at":null}'::jsonb,
          'user value = origin user_edit, review ok, no sources');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                  '{"ops":[{"op":"accept","target":{"section":"project","field":"name"}}]}')$$, 'accept needs_review');
select is((select structured_draft #>> '{project,name,review}' from public.writing_chats where id = current_setting('t.chat')::uuid),
          'accepted', 'accepted');
select isnt((select structured_draft #>> '{project,name,reviewed_at}' from public.writing_chats where id = current_setting('t.chat')::uuid),
            null, 'reviewed_at recorded');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"accept","target":{"section":"project","field":"name"}}]}')$$,
                 'P0001', 'invalid_review_transition', 'accept only from needs_review');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"reject","target":{"section":"project","field":"team_size"}}]}')$$,
                 'P0001', 'invalid_review_transition', 'reject only from needs_review');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                  '{"ops":[{"op":"reject","target":{"section":"achievement","achievement_key":"A1","field":"value_after"}}]}')$$,
                'reject the needs_review achievement value');
select is((select (structured_draft #> '{details,0,achievements,0,value_after}') - 'reviewed_at'
             from public.writing_chats where id = current_setting('t.chat')::uuid),
          '{"value":null,"origin":"ai","source_message_ids":[],"source_quotes":[],"review":"ok"}'::jsonb,
          'reject = value null, review ok, origin stays ai');

-- Atomic for the user: the first violation raises and nothing is applied.
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"project","field":"summary"},"value":"요약"},
                            {"op":"set","target":{"section":"project","field":"team_size"},"value":0}]}')$$,
                 'P0001', 'invalid_value', 'user: invalid value raises');
select ok((select not (structured_draft -> 'project' ? 'summary') from public.writing_chats where id = current_setting('t.chat')::uuid),
          'user patch is all-or-nothing');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"detail","detail_key":"D9","field":"title"},"value":"t"}]}')$$,
                 'P0001', 'detail_not_found', 'user: unknown detail');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set_clarifications","items":[]}]}')$$,
                 'P0001', 'invalid_patch', 'user cannot use AI-only ops');

-- remove_skill / add_skill (user), remove_achievement, set null clears
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                  '{"ops":[{"op":"add_skill","value":"Redis"},{"op":"remove_skill","value":"KAFKA"},
                           {"op":"add_achievement","detail":{"detail_key":"D1"},"fields":{"metric_name":{"value":"지연"},"unit":{"value":"ms"}}},
                           {"op":"set","target":{"section":"project","field":"team_size"},"value":null}]}')$$,
                'user: add/remove skill, add achievement, clear a field');
select is((select structured_draft -> 'skills' from public.writing_chats where id = current_setting('t.chat')::uuid),
          '[{"value":"Redis","source_message_ids":[],"source_quotes":[]}]'::jsonb, 'skills after user edits');
select is((select structured_draft #>> '{details,0,achievements,1,achievement_key}' from public.writing_chats where id = current_setting('t.chat')::uuid),
          'A2', 'next achievement key A2');
select is((select structured_draft #>> '{details,0,achievements,1,metric_name,origin}' from public.writing_chats where id = current_setting('t.chat')::uuid),
          'user_edit', 'user achievement fields are user_edit');
select ok((select not (structured_draft -> 'project' ? 'team_size') from public.writing_chats where id = current_setting('t.chat')::uuid),
          'set null removes the field (empty slot again)');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                  '{"ops":[{"op":"remove_achievement","achievement_key":"A2"}]}')$$, 'remove achievement');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"remove_achievement","achievement_key":"A2"}]}')$$,
                 'P0001', 'achievement_not_found', 'removed achievement is gone');

-- ════════ protection against later AI patches ════════
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
            jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"role"}'::jsonb, 'value', 'AI role',
                               'source_message_ids', pg_temp.src('t.m2')),
            jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"name"}'::jsonb, 'value', 'AI name',
                               'source_message_ids', pg_temp.src('t.m2')),
            jsonb_build_object('op', 'set', 'target', '{"section":"achievement","achievement_key":"A1","field":"value_after"}'::jsonb,
                               'value', 5, 'source_message_ids', pg_temp.src('t.m2')),
            jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"team_size"}'::jsonb, 'value', 4,
                               'source_message_ids', pg_temp.src('t.m2'))))) -> 'rejected',
          '[{"index":0,"op":"set","reason":"protected_field"},{"index":1,"op":"set","reason":"protected_field"}]'::jsonb,
          'AI cannot overwrite user_edit or accepted fields; rejected / cleared fields can be refilled');
select is((select structured_draft #>> '{project,role,value}' from public.writing_chats where id = current_setting('t.chat')::uuid),
          '백엔드 리드', 'user_edit value kept');
select is((select structured_draft #>> '{details,0,achievements,0,value_after,value}' from public.writing_chats where id = current_setting('t.chat')::uuid),
          '5', 'rejected achievement field refilled by AI');

-- ════════ augment: V-9h ════════
select is(public.apply_structured_draft_patch(current_setting('t.aug')::uuid, jsonb_build_object('ops', jsonb_build_array(
            jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"name"}'::jsonb, 'value', 'New name',
                               'source_message_ids', pg_temp.src('t.am2')),
            jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"summary"}'::jsonb, 'value', '요약',
                               'source_message_ids', pg_temp.src('t.am2')),
            jsonb_build_object('op', 'set', 'target', '{"section":"detail","existing_detail_id":"aaaaaaaa-4444-0000-0000-000000000001","field":"situation"}'::jsonb,
                               'value', 'over', 'source_message_ids', pg_temp.src('t.am2')),
            jsonb_build_object('op', 'set', 'target', '{"section":"detail","existing_detail_id":"aaaaaaaa-4444-0000-0000-000000000001","field":"result"}'::jsonb,
                               'value', '장애 알림이 줄었다', 'source_message_ids', pg_temp.src('t.am2')),
            jsonb_build_object('op', 'set', 'target', '{"section":"detail","existing_detail_id":"aaaaaaaa-4444-0000-0000-000000000002","field":"result"}'::jsonb,
                               'value', 'x', 'source_message_ids', pg_temp.src('t.am2')),
            -- a message of the other chat of the same user is not a source either
            jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"role"}'::jsonb, 'value', 'Dev',
                               'source_message_ids', pg_temp.src('t.m2')),
            jsonb_build_object('op', 'set_affiliation_suggestion', 'type', 'education', 'id', 'aaaaaaaa-2222-0000-0000-000000000001',
                               'source_message_ids', pg_temp.src('t.am2')),
            jsonb_build_object('op', 'add_achievement', 'detail', '{"existing_detail_id":"aaaaaaaa-4444-0000-0000-000000000001"}'::jsonb,
                               'fields', jsonb_build_object('metric_name', jsonb_build_object('value', '알림 수',
                                 'source_message_ids', pg_temp.src('t.am2'))))))) -> 'rejected',
          '[{"index":0,"op":"set","reason":"field_already_filled"},
            {"index":2,"op":"set","reason":"field_already_filled"},
            {"index":4,"op":"set","reason":"detail_not_found"},
            {"index":5,"op":"set","reason":"invalid_source"},
            {"index":6,"op":"set_affiliation_suggestion","reason":"affiliation_not_editable"}]'::jsonb,
          'V-9h: filled columns of the target project / detail are refused; foreign details refused; blank counts as empty');
select is((select jsonb_array_length(structured_draft -> 'details') from public.writing_chats where id = current_setting('t.aug')::uuid),
          1, 'one item for the existing detail (created on first use)');
select is((select (structured_draft #> '{details,0}') - 'fields' - 'achievements' from public.writing_chats where id = current_setting('t.aug')::uuid),
          '{"detail_key":null,"existing_detail_id":"aaaaaaaa-4444-0000-0000-000000000001"}'::jsonb, 'existing item shape');
select is((select jsonb_array_length(structured_draft #> '{details,0,achievements}') from public.writing_chats where id = current_setting('t.aug')::uuid),
          1, 'achievement added to the existing detail item');

-- V-9h applies to the user too.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.aug')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"detail","existing_detail_id":"aaaaaaaa-4444-0000-0000-000000000001","field":"title"},"value":"x"}]}')$$,
                 'P0001', 'field_already_filled', 'user: V-9h on a filled detail column');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.aug')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"project","field":"name"},"value":"x"}]}')$$,
                 'P0001', 'field_already_filled', 'user: V-9h on a filled project column');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.aug')::uuid,
                  '{"ops":[{"op":"set","target":{"section":"detail","existing_detail_id":"aaaaaaaa-4444-0000-0000-000000000001","field":"action"},"value":"직접"}]}')$$,
                'user: empty detail column is editable');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.aug')::uuid,
                   '{"ops":[{"op":"remove_detail","existing_detail_id":"aaaaaaaa-4444-0000-0000-000000000002"}]}')$$,
                 'P0001', 'detail_not_found', 'remove_detail: unknown item');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                  '{"ops":[{"op":"remove_detail","detail_key":"D1"}]}')$$, 'remove_detail D1');
select is((select (jsonb_array_length(structured_draft -> 'details'), jsonb_array_length(structured_draft -> 'clarifications'))::text
             from public.writing_chats where id = current_setting('t.chat')::uuid),
          '(0,0)', 'detail and its clarifications removed');

-- B can't patch A's chat.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"new_detail","detail_key":"D1"}]}')$$,
                 'P0001', 'writing_chat_not_found', 'B cannot patch A''s chat');
select throws_ok($$select public.set_writing_chat_affiliation(current_setting('t.chat')::uuid, null, null, true)$$,
                 'P0001', 'writing_chat_not_found', 'B cannot touch A''s affiliation');

-- ════════ set_writing_chat_affiliation ════════
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.set_writing_chat_affiliation(current_setting('t.chat')::uuid,
                   'aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-000000000001')$$,
                 'P0001', 'invalid_affiliation', 'one affiliation at most');
select throws_ok($$select public.set_writing_chat_affiliation(current_setting('t.chat')::uuid, 'bbbbbbbb-1111-0000-0000-000000000001')$$,
                 'P0001', 'affiliation_not_found', 'B''s experience');
select throws_ok($$select public.set_writing_chat_affiliation(current_setting('t.aug')::uuid, 'aaaaaaaa-1111-0000-0000-000000000001')$$,
                 'P0001', 'affiliation_not_editable', 'augment: affiliation is read-only');
select lives_ok($$select public.set_writing_chat_affiliation(current_setting('t.chat')::uuid, null, null, true)$$,
                '[아니요]: dismiss only');
select is((select (experience_id is null, structured_draft -> 'affiliation_suggestion')::text
             from public.writing_chats where id = current_setting('t.chat')::uuid),
          '(t,null)', 'suggestion cleared, columns untouched');
select lives_ok($$select public.set_writing_chat_affiliation(current_setting('t.chat')::uuid, 'aaaaaaaa-1111-0000-0000-000000000001')$$,
                '[연결]');
select is((select (experience_id, education_id)::text from public.writing_chats where id = current_setting('t.chat')::uuid),
          '(aaaaaaaa-1111-0000-0000-000000000001,)', 'experience confirmed');
select lives_ok($$select public.set_writing_chat_affiliation(current_setting('t.chat')::uuid, null, 'aaaaaaaa-2222-0000-0000-000000000001')$$,
                'switch to education');
select is((select (experience_id, education_id)::text from public.writing_chats where id = current_setting('t.chat')::uuid),
          '(,aaaaaaaa-2222-0000-0000-000000000001)', 'education confirmed, experience cleared');

-- Not active
update public.writing_chats set status = 'abandoned' where id = current_setting('t.chat')::uuid;
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"new_detail","detail_key":"D1"}]}')$$,
                 'P0001', 'writing_chat_not_active', 'no patches on an abandoned chat');
select throws_ok($$select public.set_writing_chat_affiliation(current_setting('t.chat')::uuid, null, null, true)$$,
                 'P0001', 'writing_chat_not_active', 'no affiliation change on an abandoned chat');

-- app_ai_writer cannot call the affiliation RPC, anon nothing.
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.set_writing_chat_affiliation(current_setting('t.aug')::uuid, null, null, true)$$,
                 '42501', null, 'app_ai_writer cannot confirm affiliation');
reset role;
set local role anon;
select throws_ok($$select public.apply_structured_draft_patch(gen_random_uuid(), '{"ops":[]}')$$, '42501', null,
                 'anon cannot patch');
reset role;

select * from finish();
rollback;
