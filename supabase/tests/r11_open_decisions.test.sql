-- R11 open decisions (DM v4.11 11.6): OD-C6 p_client_id, OD-P11 assistant row for an unanswered user message,
-- OD-L2 disclosure v2026-11-05 reconsent. R14 (RM-1): the OD-I6 kept-interview and OD-I1 score sections were
-- removed with the interview tables; application project deletion is covered in r14_remove_mock_interview.test.sql.
-- Assertions filter on this test's users: the shared local DB may hold rows from integration test runs.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();
create schema r11t;
grant usage on schema r11t to authenticated, app_ai_writer, service_role;

insert into auth.users (id, email, aud, role) values
  ('a1100000-0000-0000-0000-000000000001', 'r11a@example.test', 'authenticated', 'authenticated'),
  ('b1100000-0000-0000-0000-000000000002', 'r11b@example.test', 'authenticated', 'authenticated'),
  ('c1100000-0000-0000-0000-000000000003', 'r11c@example.test', 'authenticated', 'authenticated'),
  ('d1100000-0000-0000-0000-000000000004', 'r11d@example.test', 'authenticated', 'authenticated'),
  ('e1100000-0000-0000-0000-000000000005', 'r11e@example.test', 'authenticated', 'authenticated');

-- ══════════════════════════════════════════════════════════════════════════════
-- OD-C6 p_client_id
-- ══════════════════════════════════════════════════════════════════════════════
select has_function('public', 'save_project_page', array['uuid', 'jsonb', 'timestamp with time zone', 'jsonb', 'uuid'],
                    'save_project_page takes p_client_id');
select hasnt_function('public', 'save_project_page', array['uuid', 'jsonb', 'timestamp with time zone', 'jsonb'],
                      'old save_project_page signature dropped');
select has_function('public', 'save_project_deliverable',
                    array['uuid', 'uuid', 'text', 'text', 'timestamp with time zone', 'jsonb', 'uuid'],
                    'save_project_deliverable takes p_client_id');
select hasnt_function('public', 'save_project_deliverable',
                      array['uuid', 'uuid', 'text', 'text', 'timestamp with time zone', 'jsonb'],
                      'old save_project_deliverable signature dropped');

insert into public.experiences (id, user_id, company_name) values
  ('a1100000-1111-0000-0000-000000000002', 'a1100000-0000-0000-0000-000000000001', 'A2사');
insert into public.projects (id, user_id, name) values
  ('a1100000-3333-0000-0000-000000000009', 'a1100000-0000-0000-0000-000000000001', 'A standalone'),
  ('b1100000-3333-0000-0000-000000000009', 'b1100000-0000-0000-0000-000000000002', 'B standalone');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((public.save_project_page(null, '{"name":"새 프로젝트","experience_id":"a1100000-1111-0000-0000-000000000002"}',
             null, null, 'a1100000-3333-0000-0000-0000000000c1') ->> 'project_id')::uuid,
          'a1100000-3333-0000-0000-0000000000c1'::uuid, 'create with p_client_id: row id = p_client_id');
select set_config('t.w', public.start_writing_chat('a1100000-3333-0000-0000-0000000000c1')::text, true);
select set_config('t.m', (select message_id::text from public.append_writing_chat_message(current_setting('t.w')::uuid,
  '결과는 응답 시간이 줄었어요')), true);
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.w')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"result"}'::jsonb, 'value', '응답 시간이 줄었다',
                     'source_message_ids', jsonb_build_array(current_setting('t.m'))))))$$, 'a proposal in the new page''s chat');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
-- The screen lost the create response: it sends the same create request (p_project_id null, same client id).
select set_config('t.r1', public.save_project_page(null,
  '{"name":"새 프로젝트","experience_id":"a1100000-1111-0000-0000-000000000002","result":"응답 시간이 줄었다"}',
  '2000-01-01T00:00:00Z', jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.w'), 'field', 'result', 'rev', 1)),
  'a1100000-3333-0000-0000-0000000000c1')::text, true);
select set_config('t.r2', public.save_project_page(null,
  '{"name":"새 프로젝트","experience_id":"a1100000-1111-0000-0000-000000000002","result":"응답 시간이 줄었다"}',
  null, jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.w'), 'field', 'result', 'rev', 1)),
  'a1100000-3333-0000-0000-0000000000c1')::text, true);
select is((select count(*)::int from public.projects where name = '새 프로젝트'
              and user_id = 'a1100000-0000-0000-0000-000000000001'), 1, 'same p_client_id three times -> one row');
select is(current_setting('t.r1')::jsonb -> 'applied',
          jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.w'), 'field', 'result')),
          'replay: saved as an update of that row (expected version ignored), record applied');
select is(current_setting('t.r2')::jsonb -> 'skipped',
          jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.w'), 'field', 'result', 'reason', 'already_applied')),
          'second identical replay: already_applied');
select is((current_setting('t.r2')::jsonb ->> 'project_id')::uuid, 'a1100000-3333-0000-0000-0000000000c1'::uuid,
          'replay returns the same project id');
select is((select result from public.projects where id = 'a1100000-3333-0000-0000-0000000000c1'), '응답 시간이 줄었다',
          'replay values written');
select is(current_setting('t.r1')::jsonb ? 'created', false, 'no created field in the response');
-- update request ignores p_client_id
select is((public.save_project_page('a1100000-3333-0000-0000-0000000000c1', '{"task":"리드"}', null, null,
             'a1100000-3333-0000-0000-0000000000c2') ->> 'project_id')::uuid, 'a1100000-3333-0000-0000-0000000000c1'::uuid,
          'update request: p_client_id ignored');
select is((select count(*)::int from public.projects where id = 'a1100000-3333-0000-0000-0000000000c2'), 0,
          'update request did not create the client id row');
select throws_ok($$select public.save_project_page(null, '{"name":"x","experience_id":"a1100000-1111-0000-0000-000000000002"}',
                   null, null, 'a1100000-3333-0000-0000-000000000009')$$,
                 'P0001', 'project_not_affiliated', 'client id of a standalone project -> update rule project_not_affiliated');
select is((public.save_project_page(null, '{"name":"서버 id","experience_id":"a1100000-1111-0000-0000-000000000002"}')
             ->> 'project_id') is not null, true, 'null p_client_id: server id as before');
-- another user's id
select throws_ok($$select public.save_project_page(null, '{"name":"x","experience_id":"a1100000-1111-0000-0000-000000000002"}',
                   null, null, 'b1100000-3333-0000-0000-000000000009')$$,
                 'P0001', 'not_found', 'client id = another user''s project -> not_found');
reset role;
select is((select name from public.projects where id = 'b1100000-3333-0000-0000-000000000009'), 'B standalone',
          'B''s project untouched');

-- deliverables
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((public.save_project_deliverable(null, 'a1100000-3333-0000-0000-000000000009', '런북', '본문', null, null,
             'a1100000-4444-0000-0000-0000000000d1') ->> 'project_deliverable_id')::uuid,
          'a1100000-4444-0000-0000-0000000000d1'::uuid, 'deliverable create with p_client_id');
select is((public.save_project_deliverable(null, 'a1100000-3333-0000-0000-000000000009', '런북', '본문 2', '2000-01-01T00:00:00Z',
             null, 'a1100000-4444-0000-0000-0000000000d1') ->> 'project_deliverable_id')::uuid,
          'a1100000-4444-0000-0000-0000000000d1'::uuid, 'deliverable replay: same row, expected version ignored');
select results_eq($$select count(*)::int, max(body) from public.project_deliverables
                     where project_id = 'a1100000-3333-0000-0000-000000000009'$$,
                  $$values (1, '본문 2'::text)$$, 'deliverable: one row, replay values written');
select throws_ok($$select public.save_project_deliverable(null, 'a1100000-3333-0000-0000-0000000000c1', '런북', '본문', null, null,
                   'a1100000-4444-0000-0000-0000000000d1')$$,
                 'P0001', 'not_found', 'deliverable replay with another parent -> not_found');
reset role;
insert into public.project_deliverables (id, user_id, project_id, title, body) values
  ('b1100000-4444-0000-0000-000000000001', 'b1100000-0000-0000-0000-000000000002', 'b1100000-3333-0000-0000-000000000009', 'B', 'b');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.save_project_deliverable(null, 'a1100000-3333-0000-0000-000000000009', 't', 'b', null, null,
                   'b1100000-4444-0000-0000-000000000001')$$,
                 'P0001', 'not_found', 'deliverable client id = another user''s row -> not_found');
reset role;
select is((select body from public.project_deliverables where id = 'b1100000-4444-0000-0000-000000000001'), 'b',
          'B''s deliverable untouched');

-- ══════════════════════════════════════════════════════════════════════════════
-- OD-P11 begin_assistant_message for a user message without a reply (no RPC change)
-- ══════════════════════════════════════════════════════════════════════════════
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, status, run_generation, provider, model_tier,
                            connection_tier) values
  ('a1100000-5555-0000-0000-000000000001', 'a1100000-0000-0000-0000-000000000001', 'writing_chat_turn', 'writing_chat',
   current_setting('t.w')::uuid, 'running', 1, 'gemini', 'default', 'free');
select set_config('t.count0', (select message_count::text from public.writing_chats where id = current_setting('t.w')::uuid), true);
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
-- The chat's last message is the user message of the first turn, which never got its assistant row.
select results_eq($$select reused, (message_count - current_setting('t.count0')::smallint)::int
                      from public.begin_assistant_message(current_setting('t.w')::uuid,
                        'a1100000-5555-0000-0000-000000000001', 'gemini', 'g', 'default', 'free')$$,
                  $$values (false, 1)$$, 'last = user message without a reply -> new assistant row, counted once');
reset role;
select results_eq($$select role, status from public.writing_chat_messages where writing_chat_id = current_setting('t.w')::uuid
                     order by sequence desc limit 2$$,
                  $$values ('assistant'::text, 'streaming'::text), ('user', 'done')$$,
                  'the user message is not re-created; the new row follows it');

-- ══════════════════════════════════════════════════════════════════════════════
-- OD-L2 / OD-L2a disclosure v2026-11-05: Claude consent needs reconsent, Gemini / OpenAI do not
-- ══════════════════════════════════════════════════════════════════════════════
-- Consents recorded on v2026-10-29 (before this version). The insert guard only accepts the current version, so it is
-- bypassed for the fixture (rolled back with the test). A = Claude, B = Gemini free, F = OpenAI.
insert into auth.users (id, email, aud, role) values
  ('f1100000-0000-0000-0000-000000000006', 'r11f@example.test', 'authenticated', 'authenticated');
alter table public.ai_data_use_consents disable trigger ai_data_use_consents_before_insert;
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged, agreed_at)
values ('a1100000-0000-0000-0000-000000000001', 'anthropic', 'paid', 'v2026-10-29', false, '2026-11-01 00:00:00+09'),
       ('b1100000-0000-0000-0000-000000000002', 'gemini', 'free', 'v2026-10-29', true, '2026-11-01 00:00:00+09'),
       ('f1100000-0000-0000-0000-000000000006', 'openai', 'paid', 'v2026-10-29', false, '2026-11-01 00:00:00+09');
alter table public.ai_data_use_consents enable trigger ai_data_use_consents_before_insert;
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status) values
  (gen_random_uuid(), 'a1100000-0000-0000-0000-000000000001', 'anthropic', 'paid', '\x01', '\x02', '\x03', 'env-v1', 'an01', 'valid'),
  (gen_random_uuid(), 'b1100000-0000-0000-0000-000000000002', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'gm01', 'valid'),
  (gen_random_uuid(), 'f1100000-0000-0000-0000-000000000006', 'openai', 'paid', '\x01', '\x02', '\x03', 'env-v1', 'oa01', 'valid');
update public.profiles set active_ai_provider = 'anthropic' where id = 'a1100000-0000-0000-0000-000000000001';
update public.profiles set active_ai_provider = 'gemini' where id = 'b1100000-0000-0000-0000-000000000002';
update public.profiles set active_ai_provider = 'openai' where id = 'f1100000-0000-0000-0000-000000000006';

select results_eq($$select private.ai_consent_allows_run('a1100000-0000-0000-0000-000000000001', 'anthropic', 'paid'),
                           private.ai_consent_allows_run('b1100000-0000-0000-0000-000000000002', 'gemini', 'free'),
                           private.ai_consent_allows_run('f1100000-0000-0000-0000-000000000006', 'openai', 'paid')$$,
                  $$values (false, true, true)$$, 'run rule: Claude needs v2026-11-05, Gemini / OpenAI keep running');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'true'::jsonb,
          'Claude-consented user -> consent_required true');
set local request.jwt.claims = '{"sub":"b1100000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'false'::jsonb,
          'Gemini-consented user -> consent_required false');
set local request.jwt.claims = '{"sub":"f1100000-0000-0000-0000-000000000006","role":"authenticated"}';
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'false'::jsonb,
          'OpenAI-consented user -> consent_required false');
-- Claude reconsent on the new version clears it.
set local request.jwt.claims = '{"sub":"a1100000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version)
                  values ('anthropic', 'paid', 'v2026-11-05')$$, 'Claude reconsent on v2026-11-05');
select is(public.get_data_readiness() #> '{ai_connection,consent_required}', 'false'::jsonb,
          'after reconsent -> consent_required false');
reset role;

-- R11-DB-1 (leader decision, R-OD-15): the acknowledgement follows the disclosure row's requires_free_tier_ack.
select is((select count(*)::int from pg_constraint where conname = 'ai_data_use_consents_free_tier_acknowledged_check'), 0,
          'consent free-tier CHECK replaced by the insert guard');
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1100000-0000-0000-0000-000000000006","role":"authenticated"}';
select lives_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged)
                  values ('openai', 'free', 'v2026-11-05', false)$$, 'OpenAI free consent without acknowledgement -> ok');
select lives_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged)
                  values ('anthropic', 'free', 'v2026-11-05', false)$$, 'Claude free consent without acknowledgement -> ok');
select throws_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged)
                   values ('gemini', 'free', 'v2026-11-05', false)$$,
                 '23514', 'free_tier_acknowledgement_required', 'Gemini free consent without acknowledgement -> rejected');
select lives_ok($$insert into public.ai_data_use_consents (provider, connection_tier, disclosure_version, free_tier_acknowledged)
                  values ('gemini', 'free', 'v2026-11-05', true)$$, 'Gemini free consent with acknowledgement -> ok');
reset role;
select is((select count(*)::int from public.ai_data_use_consents
            where disclosure_version = 'v2026-10-29' and connection_tier = 'free' and not free_tier_acknowledged), 0,
          'old rows untouched (all v2026-10-29 free consents acknowledged)');

select * from finish();
rollback;
