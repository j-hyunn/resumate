-- R5 deliverable writing chats (DM v4.5 §2.3, §2.5, §2.5.0, §4.1~4.3; PA-1): target column, composite FK,
-- CHECK, immutability, start RPCs (+ form snapshot greeting), cascade (+ turn cancel), deletion impact, account
-- deletion summary.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

insert into public.experiences (id, user_id, company_name) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'A사');
-- P1 affiliated, P2 / P3 standalone (A), PB standalone (B).
insert into public.projects (id, user_id, experience_id, name) values
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-1111-0000-0000-000000000001', 'A project');
insert into public.projects (id, user_id, name) values
  ('aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'A standalone'),
  ('aaaaaaaa-3333-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'A standalone 2'),
  ('bbbbbbbb-3333-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'B standalone');
-- D1 empty body + no kind keyword, D2 retrospective title, D3 body present, D4 under P3, DB under B's project.
insert into public.project_deliverables (id, user_id, project_id, title, body) values
  ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-3333-0000-0000-000000000002', '결제 모듈 정리', ''),
  ('aaaaaaaa-4444-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-3333-0000-0000-000000000002', '결제 개편 회고', ''),
  ('aaaaaaaa-4444-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-3333-0000-0000-000000000002', '설계 문서', '## 배경' || E'\n\n' || '이미 쓴 본문'),
  ('aaaaaaaa-4444-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-3333-0000-0000-000000000003', '발표 자료', ''),
  ('bbbbbbbb-4444-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-3333-0000-0000-000000000001', 'B 산출물', '');

-- A has a free-tier active key (greeting notice).
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek,
                                     kek_id, key_last4, status)
values ('aaaaaaaa-9999-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'gemini', 'free',
        '\x01', '\x02', '\x03', 'env-v1', 'abcd', 'valid');
update public.profiles set active_ai_provider = 'gemini' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

create function pg_temp.greeting(p text) returns text language sql as
  $$ select content from public.writing_chat_messages where writing_chat_id = current_setting(p)::uuid and sequence = 1 $$;
grant execute on function pg_temp.greeting(text) to authenticated;

-- ── structure ──
select has_column('public', 'writing_chats', 'project_deliverable_id', 'writing_chats.project_deliverable_id');
select col_is_null('public', 'writing_chats', 'project_deliverable_id', 'project_deliverable_id nullable (null = STAR chat)');
select col_is_unique('public', 'project_deliverables', array['id', 'project_id', 'user_id'],
                     'project_deliverables unique (id, project_id, user_id)');
select fk_ok('public', 'writing_chats', array['project_deliverable_id', 'project_id', 'user_id'],
             'public', 'project_deliverables', array['id', 'project_id', 'user_id'],
             'composite FK writing_chats -> project_deliverables');
select is((select confdeltype from pg_constraint where conname = 'writing_chats_project_deliverable_fkey'), 'c',
          'deliverable FK cascades on delete');
select has_index('public', 'writing_chats', 'writing_chats_project_deliverable_id_last_activity_idx',
                 'S-44 history partial index');
select is((select pg_get_expr(indpred, indrelid) from pg_index
            where indexrelid = 'public.writing_chats_project_deliverable_id_last_activity_idx'::regclass),
          '(project_deliverable_id IS NOT NULL)', 'index is partial');
select has_trigger('public', 'writing_chats', 'writing_chats_check_target', 'trigger writing_chats_check_target');
select hasnt_trigger('public', 'writing_chats', 'writing_chats_require_affiliated_project', 'old target trigger gone');
select ok(not has_column_privilege('authenticated', 'public.writing_chats', 'project_deliverable_id', 'UPDATE')
          and not has_column_privilege('authenticated', 'public.writing_chats', 'project_deliverable_id', 'INSERT'),
          'authenticated cannot write project_deliverable_id');
select ok(has_column_privilege('app_ai_writer', 'public.writing_chats', 'project_deliverable_id', 'SELECT'),
          'app_ai_writer reads project_deliverable_id');

-- ── start_deliverable_writing_chat ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok($$select public.start_deliverable_writing_chat('bbbbbbbb-4444-0000-0000-000000000001')$$,
                 'P0001', 'project_deliverable_not_found', 'B''s deliverable is not found');
select throws_ok($$select public.start_deliverable_writing_chat(null)$$,
                 'P0001', 'project_deliverable_not_found', 'deliverable is required');
select throws_ok($$select public.start_deliverable_writing_chat('aaaaaaaa-4444-0000-0000-000000000001', '"x"')$$,
                 'P0001', 'invalid_form_snapshot', 'snapshot must be an object');
select throws_ok($$select public.start_deliverable_writing_chat('aaaaaaaa-4444-0000-0000-000000000001',
                   jsonb_build_object('title', 't', 'body', repeat('x', 20001)))$$,
                 'P0001', 'invalid_form_snapshot', 'snapshot body over 20,000 chars');
select throws_ok($$select public.start_deliverable_writing_chat('aaaaaaaa-4444-0000-0000-000000000001', '{"title": 3}')$$,
                 'P0001', 'invalid_form_snapshot', 'snapshot title must be text');

select lives_ok($$select set_config('t.d1', public.start_deliverable_writing_chat('aaaaaaaa-4444-0000-0000-000000000001')::text, true)$$,
                'start a deliverable chat');
select is((select (project_id, project_deliverable_id, return_target is null, status, message_count)::text
             from public.writing_chats where id = current_setting('t.d1')::uuid),
          '(aaaaaaaa-3333-0000-0000-000000000002,aaaaaaaa-4444-0000-0000-000000000001,t,active,0)',
          'project_id = the deliverable''s parent, target column set, no return_target, active, count 0');
select is((select structured_draft from public.writing_chats where id = current_setting('t.d1')::uuid),
          '{"schema_version": 1, "target": "project_deliverable", "writing_kind": null, "facts": [], "deliverable": {},
            "clarifications": [], "sensitive_flags_count": 0, "draft_count": 0}'::jsonb,
          'empty deliverable draft (DM §2.5.0), kind unknown');
select ok(pg_temp.greeting('t.d1') like '''결제 모듈 정리''을 함께 써 볼게요.%어떤 글인가요?%'
          and pg_temp.greeting('t.d1') like '%회사 기밀, 민감정보, 다른 사람의 개인정보는 쓰지 말아 주세요.%'
          and pg_temp.greeting('t.d1') like '%무료 등급%',
          'greeting: empty body + unknown kind, sensitive line, free-tier notice');
select is((select (sequence, role, ai_job_id is null)::text from public.writing_chat_messages
            where writing_chat_id = current_setting('t.d1')::uuid), '(1,assistant,t)', 'greeting is sequence 1, no job');

select lives_ok($$select set_config('t.d2', public.start_deliverable_writing_chat('aaaaaaaa-4444-0000-0000-000000000002')::text, true)$$,
                'start on a retrospective-titled deliverable');
select is((select structured_draft ->> 'writing_kind' from public.writing_chats where id = current_setting('t.d2')::uuid),
          'retrospective', 'writing_kind guessed from the title [가정]');
select ok(pg_temp.greeting('t.d2') like '''결제 개편 회고''을 회고로 정리해 볼게요. 회고하려는 일은 무엇이었나요?%',
          'greeting: empty body + kind from the title (slot 1 question)');

select lives_ok($$select set_config('t.d3', public.start_deliverable_writing_chat('aaaaaaaa-4444-0000-0000-000000000003')::text, true)$$,
                'start on a deliverable with a body');
select ok(pg_temp.greeting('t.d3') like '지금 본문을 바탕으로 더 채워 볼게요.%', 'greeting: body present');
select is((select structured_draft ->> 'writing_kind' from public.writing_chats where id = current_setting('t.d3')::uuid),
          'design_doc', 'kind guessed even when the body is present');

-- Snapshot wins over saved values for the greeting branch, and is not stored.
select lives_ok($$select set_config('t.d4', public.start_deliverable_writing_chat('aaaaaaaa-4444-0000-0000-000000000003',
                   '{"title":"기획 요약본","body":"   "}')::text, true)$$, 'start with a snapshot');
select ok(pg_temp.greeting('t.d4') like '''기획 요약본''을 기획서 요약으로 정리해 볼게요.%',
          'snapshot body (blank) and title pick the branch; 으로 after a final consonant');
select is((select title || '|' || body from public.project_deliverables where id = 'aaaaaaaa-4444-0000-0000-000000000003'),
          '설계 문서|## 배경' || E'\n\n' || '이미 쓴 본문', 'snapshot not stored on the deliverable');
select ok((select structured_draft::text not like '%기획 요약본%' from public.writing_chats
            where id = current_setting('t.d4')::uuid), 'snapshot not stored on the chat');

select lives_ok($$select set_config('t.d5', public.start_deliverable_writing_chat('aaaaaaaa-4444-0000-0000-000000000004')::text, true)$$,
                'start on P3''s deliverable');
select ok(pg_temp.greeting('t.d5') like '''발표 자료''을 발표로 정리해 볼게요.%', 'presentation: 로 after a vowel');

-- ── start_writing_chat + p_form_snapshot (STAR) ──
select throws_ok($$select public.start_writing_chat('aaaaaaaa-3333-0000-0000-000000000001', null, '{"star":"x"}')$$,
                 'P0001', 'invalid_form_snapshot', 'STAR snapshot: star must be an object');
select throws_ok($$select public.start_writing_chat('aaaaaaaa-3333-0000-0000-000000000001', null,
                   jsonb_build_object('star', jsonb_build_object('action', repeat('x', 2001))))$$,
                 'P0001', 'invalid_form_snapshot', 'STAR snapshot: field over 2,000 chars');
select lives_ok($$select set_config('t.s1', public.start_writing_chat('aaaaaaaa-3333-0000-0000-000000000001', null,
                   '{"name":"새 이름","star":{"situation":"이미 씀","task":"","action":null}}')::text, true)$$,
                'start a STAR chat with a snapshot');
select ok(pg_temp.greeting('t.s1') like '''새 이름''에서 비어 있는 역할부터 여쭤볼게요.%',
          'snapshot STAR (situation filled) picks the partial greeting though the DB STAR is empty');
select is((select (name, situation is null)::text from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          '("A project",t)', 'STAR snapshot not stored');
select is((select structured_draft ->> 'schema_version' from public.writing_chats where id = current_setting('t.s1')::uuid),
          '3', 'STAR chat keeps the v3 draft');
select lives_ok($$select set_config('t.s2', public.start_writing_chat('aaaaaaaa-3333-0000-0000-000000000001')::text, true)$$,
                'start without a snapshot (DB values)');
select ok(pg_temp.greeting('t.s2') like '''A project''을 함께 정리해 볼게요.%', 'no snapshot: DB STAR (empty)');
select throws_ok($$select public.start_writing_chat('aaaaaaaa-3333-0000-0000-000000000002')$$,
                 'P0001', 'writing_chat_requires_affiliated_project', 'still no STAR chat on a standalone project');

-- B cannot see A's deliverable chats.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.writing_chats where project_deliverable_id is not null), 0,
          'B sees none of A''s deliverable chats');
select throws_ok($$select public.start_deliverable_writing_chat('aaaaaaaa-4444-0000-0000-000000000001')$$,
                 'P0001', 'project_deliverable_not_found', 'B cannot start a chat on A''s deliverable');
reset role;

-- ── constraints / trigger / guard (as owner) ──
select throws_ok($$insert into public.writing_chats (user_id, project_id) values
                   ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000002')$$,
                 'P0001', 'writing_chat_requires_affiliated_project', 'STAR chat on a standalone project refused');
select throws_ok($$insert into public.writing_chats (user_id, project_id, project_deliverable_id) values
                   ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000003',
                    'aaaaaaaa-4444-0000-0000-000000000001')$$,
                 '23503', null, 'composite FK: the deliverable must belong to the chat''s project');
select throws_ok($$insert into public.writing_chats (user_id, project_id, project_deliverable_id) values
                   ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000001',
                    'aaaaaaaa-4444-0000-0000-000000000001')$$,
                 '23503', null, 'composite FK: a deliverable chat cannot hang off the affiliated project');
select throws_ok($$insert into public.writing_chats (user_id, project_id, project_deliverable_id) values
                   ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-3333-0000-0000-000000000002',
                    'aaaaaaaa-4444-0000-0000-000000000001')$$,
                 '23503', null, 'composite FK: same user');
select throws_ok($$insert into public.writing_chats (user_id, project_id, project_deliverable_id, return_target) values
                   ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000002',
                    'aaaaaaaa-4444-0000-0000-000000000001', '{"feature":"insight"}')$$,
                 '23514', null, 'CHECK: deliverable chat has no return_target');
select throws_ok($$update public.writing_chats set project_deliverable_id = 'aaaaaaaa-4444-0000-0000-000000000002'
                    where id = current_setting('t.d1')::uuid$$,
                 'P0001', 'invalid_writing_chat_transition', 'project_deliverable_id is fixed');
select throws_ok($$update public.writing_chats set project_deliverable_id = null where id = current_setting('t.d1')::uuid$$,
                 'P0001', 'invalid_writing_chat_transition', 'cannot turn a deliverable chat into a STAR chat');
select throws_ok($$update public.project_deliverables set project_id = 'aaaaaaaa-3333-0000-0000-000000000003'
                    where id = 'aaaaaaaa-4444-0000-0000-000000000001'$$,
                 '23503', null, 'a deliverable with chats cannot move to another project (FK)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$update public.writing_chats set return_target = '{"feature":"insight"}' where id = current_setting('t.d1')::uuid$$,
                 '23514', null, 'user cannot set return_target on a deliverable chat');
reset role;

-- ── deletion impact / cascade ──
insert into public.ai_jobs (id, user_id, job_type, target_type, target_id, provider, model_tier, connection_tier, status)
values ('aaaaaaaa-5555-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'writing_chat_turn',
        'writing_chat', current_setting('t.d1')::uuid, 'gemini', 'default', 'free', 'running');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_deletion_impact('project_deliverable', 'aaaaaaaa-4444-0000-0000-000000000001') -> 'cascade',
          '{"projects": 0, "project_deliverables": 0, "project_skills": 0, "writing_chats": 1}'::jsonb,
          'impact: deliverable -> its chats');
select is(public.get_deletion_impact('project_deliverable', 'aaaaaaaa-4444-0000-0000-000000000003') -> 'cascade' -> 'writing_chats',
          '2'::jsonb, 'impact: deliverable with two chats');
select is(public.get_deletion_impact('project', 'aaaaaaaa-3333-0000-0000-000000000002') -> 'cascade',
          '{"projects": 0, "project_deliverables": 3, "project_skills": 0, "writing_chats": 4}'::jsonb,
          'impact: standalone project -> deliverables and their chats (UX DM-7)');
select is(public.get_deletion_impact('writing_chat', current_setting('t.d1')::uuid),
          '{"message_count": 0, "last_applied_at": null}'::jsonb, 'impact: deliverable chat alone');
select is((public.get_account_deletion_summary() -> 'career' ->> 'writing_chats')::int, 7,
          'account summary counts STAR + deliverable chats in one number');

select is(public.delete_career_item('project_deliverable', 'aaaaaaaa-4444-0000-0000-000000000001') -> 'cascade' -> 'writing_chats',
          '1'::jsonb, 'delete_career_item returns the same impact');
select is((select count(*)::int from public.writing_chats where id = current_setting('t.d1')::uuid), 0,
          'deleting the deliverable deletes its chat (FK cascade)');
select is((select count(*)::int from public.writing_chat_messages where writing_chat_id = current_setting('t.d1')::uuid), 0,
          '... and its messages');
reset role;
select isnt((select cancel_requested_at from public.ai_jobs where id = 'aaaaaaaa-5555-0000-0000-000000000001'), null,
            'running turn of the cascaded chat is asked to cancel (writing_chats_cancel_jobs)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$delete from public.writing_chats where id = current_setting('t.d4')::uuid$$, 'chat-only delete');
select is((select count(*)::int from public.project_deliverables where id = 'aaaaaaaa-4444-0000-0000-000000000003'), 1,
          'deleting a chat keeps the deliverable');
select lives_ok($$select public.delete_career_item('project', 'aaaaaaaa-3333-0000-0000-000000000002')$$,
                'delete the standalone project');
select is((select count(*)::int from public.writing_chats
            where id in (current_setting('t.d2')::uuid, current_setting('t.d3')::uuid)), 0,
          'standalone project delete removes its deliverables'' chats');
select is((select count(*)::int from public.writing_chats where id = current_setting('t.d5')::uuid), 1,
          'other project''s deliverable chat untouched');
reset role;

select * from finish();
rollback;
