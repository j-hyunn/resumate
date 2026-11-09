-- R15 후속 (리더 판정 2026-11-09, 20261113004670):
--   A. application_documents is written through save_application_document only (the write guard trigger)
--   B. mark_application_document_copied — first_copied_at written once, updated_at never moved
--   C. the S-46 / board reads work through the user session
-- Every query is scoped to this file's fixtures, so rows left behind in the local DB cannot break it (QA-04).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');
insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '가 지원', 'user'),
  ('a0000000-aaaa-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '가 지원 2', 'user'),
  ('a0000000-aaaa-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '가 지원 3', 'user'),
  ('b0000000-aaaa-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', '나 지원', 'user');
insert into public.experiences (id, user_id, company_name, start_month) values
  ('a0000000-1111-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'A사', '2023-01-01');
-- Fixture rows as the migration owner (the guard does not apply to it), with an OLD updated_at so a moved
-- updated_at is visible (now() is the transaction time and would hide it otherwise).
insert into public.application_documents (id, user_id, application_project_id, document_kind, body,
                                          filled_slot_count, updated_at)
values ('a0000000-dddd-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
        'a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
        '{"questions":[{"slot":"q_1","question_text":"q","char_limit":800,"count_basis":"with_spaces",
                        "body":"답변","blocks":[],"sort_order":1}]}', 1, '2020-01-01 00:00:00+00'),
       ('b0000000-dddd-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002',
        'b0000000-aaaa-0000-0000-000000000002', 'cover_letter', '{"questions":[]}', 0, '2020-01-01 00:00:00+00');
insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, sort_order,
                                   source_type, source_id, source_field, quote)
values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'application_document',
        'a0000000-dddd-0000-0000-000000000001', 'q_1.blocks.b1', 1, 'experience',
        'a0000000-1111-0000-0000-000000000001', 'summary', 'A사');

select has_trigger('public', 'application_documents', 'application_documents_guard_write', 'write guard trigger');
select has_function('public', 'mark_application_document_copied', array['uuid', 'text'],
                    'mark_application_document_copied(uuid, text)');
select ok(has_function_privilege('authenticated', 'public.mark_application_document_copied(uuid,text)', 'execute')
          and not has_function_privilege('anon', 'public.mark_application_document_copied(uuid,text)', 'execute')
          and not has_function_privilege('app_ai_writer', 'public.mark_application_document_copied(uuid,text)',
                                         'execute'),
          'mark_application_document_copied: authenticated only');

-- ── A. direct writes are refused, delete is not, the RPC still works ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$insert into public.application_documents (user_id, application_project_id, document_kind, body)
                   values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000002',
                           'cover_letter',
                           '{"questions":[{"slot":"q_1"},{"slot":"q_2"},{"slot":"q_3"},{"slot":"q_4"},
                                          {"slot":"q_5"},{"slot":"q_6"}]}')$$,
                 'P0001', 'direct_write_not_allowed',
                 'a direct INSERT of the user''s own row is refused (6 questions would have skipped too_many_questions)');
select throws_ok($$update public.application_documents set filled_slot_count = 99
                    where id = 'a0000000-dddd-0000-0000-000000000001'$$,
                 'P0001', 'direct_write_not_allowed',
                 'a direct UPDATE of the user''s own row is refused (filled_slot_count would drift from body)');
select throws_ok($$update public.application_documents set first_copied_at = now()
                    where id = 'a0000000-dddd-0000-0000-000000000001'$$,
                 'P0001', 'direct_write_not_allowed', 'a direct UPDATE of first_copied_at is refused too');
reset role;
select results_eq($$select filled_slot_count, first_copied_at is null from public.application_documents
                     where id = 'a0000000-dddd-0000-0000-000000000001'$$,
                  $$values (1, true)$$, 'the refused writes changed nothing');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- The save RPC still creates and updates (it switches the flag on around its own write only).
select ok(public.save_application_document('a0000000-aaaa-0000-0000-000000000002', 'cover_letter',
            '{"questions":[{"slot":"q_1","question_text":"q","char_limit":800,"count_basis":"with_spaces",
                            "body":"답변","blocks":[]}]}') ? 'application_document_id',
          'save_application_document still creates a row');
-- And the flag does not leak out of the RPC into the rest of the transaction.
select is(coalesce(current_setting('app.application_document_write', true), ''), 'off',
          'the flag is off again after the RPC returns');
select throws_ok($$update public.application_documents set filled_slot_count = 99
                    where application_project_id = 'a0000000-aaaa-0000-0000-000000000002'$$,
                 'P0001', 'direct_write_not_allowed', 'a direct write right after the RPC is still refused');
-- DELETE is not guarded (DM §2.7.3 "delete 본인").
select lives_ok($$delete from public.application_documents
                   where application_project_id = 'a0000000-aaaa-0000-0000-000000000002'$$,
                'the user can delete their own row');
reset role;
select is((select count(*)::int from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000002'), 0, 'and it is gone');
-- The definer path (delete_career_item -> reset_application_document_slots) runs as the owner and is unaffected.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.delete_career_item('experience', 'a0000000-1111-0000-0000-000000000001',
                   'delete_projects', 'delete_results')$$,
                'delete_results still resets the cited question through its definer helper');
reset role;
select is((select body #>> '{questions,0,body}' from public.application_documents
            where id = 'a0000000-dddd-0000-0000-000000000001'), '',
          'the cited question''s body was cleared by the definer path');
-- Put the old updated_at back for part B. The new updated_at trigger keeps the old value on an update that
-- changes nothing but timestamps, so it is switched off for this one fixture write (rolled back with the test).
alter table public.application_documents disable trigger application_documents_set_updated_at;
update public.application_documents set updated_at = '2020-01-01 00:00:00+00'
 where id = 'a0000000-dddd-0000-0000-000000000001';
alter table public.application_documents enable trigger application_documents_set_updated_at;
select is((select updated_at from public.application_documents
            where id = 'a0000000-dddd-0000-0000-000000000001'), '2020-01-01 00:00:00+00'::timestamptz,
          'fixture: updated_at is back to 2020');

-- ── B. mark_application_document_copied ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.mark_application_document_copied('a0000000-aaaa-0000-0000-000000000001',
                     'career_description')$$,
                 'P0001', 'invalid_fields', 'p_document_kind other than cover_letter -> invalid_fields');
select set_config('t.first', public.mark_application_document_copied('a0000000-aaaa-0000-0000-000000000001')::text,
                  true);
select isnt(current_setting('t.first'), '', 'the first call records first_copied_at and returns it');
select is((select first_copied_at from public.application_documents
            where id = 'a0000000-dddd-0000-0000-000000000001'), current_setting('t.first')::timestamptz,
          'the stored value is the returned value');
select is((select updated_at from public.application_documents
            where id = 'a0000000-dddd-0000-0000-000000000001'), '2020-01-01 00:00:00+00'::timestamptz,
          'the copy stamp does NOT move updated_at (the save RPC''s expected version)');
reset role;
-- Give the stamp a recognisable value (owner write), then copy again: the first value stays.
update public.application_documents set first_copied_at = '2021-06-01 00:00:00+00'
 where id = 'a0000000-dddd-0000-0000-000000000001';
select is((select updated_at from public.application_documents
            where id = 'a0000000-dddd-0000-0000-000000000001'), '2020-01-01 00:00:00+00'::timestamptz,
          'a write of first_copied_at alone keeps updated_at (the trigger rule itself)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.mark_application_document_copied('a0000000-aaaa-0000-0000-000000000001'),
          '2021-06-01 00:00:00+00'::timestamptz, 'a second call keeps the first value');
select is((select updated_at from public.application_documents
            where id = 'a0000000-dddd-0000-0000-000000000001'), '2020-01-01 00:00:00+00'::timestamptz,
          'and still does not move updated_at');
-- A stale_write check with the old version still passes after the copies (no false conflict between tabs).
select ok(public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
            '{"questions":[{"slot":"q_1","question_text":"q","char_limit":800,"count_basis":"with_spaces",
                            "body":"새 답변","blocks":[]}]}', null, '2020-01-01 00:00:00+00') ? 'updated_at',
          'a save with the pre-copy expected version is not a stale_write');
select isnt((select updated_at from public.application_documents
              where id = 'a0000000-dddd-0000-0000-000000000001'), '2020-01-01 00:00:00+00'::timestamptz,
            'a real content change still moves updated_at');
select is((select first_copied_at from public.application_documents
            where id = 'a0000000-dddd-0000-0000-000000000001'), '2021-06-01 00:00:00+00'::timestamptz,
          'and a save never touches first_copied_at');
-- No row yet -> null, not an error.
select is(public.mark_application_document_copied('a0000000-aaaa-0000-0000-000000000003'), null::timestamptz,
          'no document row yet -> null');
-- Another user's row -> null, and that row is unchanged.
select is(public.mark_application_document_copied('b0000000-aaaa-0000-0000-000000000002'), null::timestamptz,
          'another user''s document -> null');
reset role;
select results_eq($$select first_copied_at is null, updated_at from public.application_documents
                     where id = 'b0000000-dddd-0000-0000-000000000002'$$,
                  $$values (true, '2020-01-01 00:00:00+00'::timestamptz)$$,
                  'and that row is untouched');

-- ── C. reads through the user session (DM 7장 "서류 작성 화면 조회" · "보드 조회") ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.chat', public.start_document_writing_chat('a0000000-aaaa-0000-0000-000000000001',
                    'cover_letter')::text, true);
select results_eq($$select application_project_id::text, slot_count, filled_slot_count
                      from public.application_documents
                     where application_project_id in ('a0000000-aaaa-0000-0000-000000000001',
                                                      'b0000000-aaaa-0000-0000-000000000002')$$,
                  $$values ('a0000000-aaaa-0000-0000-000000000001'::text, 1, 1)$$,
                  'board columns: own document visible, another user''s not');
select results_eq(format($$select id::text, document_kind, structured_draft ->> 'target'
                             from public.writing_chats
                            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'
                              and document_kind = 'cover_letter' and id = '%s'$$, current_setting('t.chat')),
                  format($$values ('%s'::text, 'cover_letter'::text, 'cover_letter'::text)$$,
                         current_setting('t.chat')),
                  'the document chat and its structured_draft are readable by filter');
select is((select count(*)::int from public.writing_chat_messages
            where writing_chat_id = current_setting('t.chat')::uuid), 1,
          'its messages are readable (the greeting)');
reset role;
-- One evidence row per user on their own document (owner writes).
insert into public.skills (id, user_id, name) values
  ('a0000000-4444-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'PostgreSQL'),
  ('b0000000-4444-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Go');
insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, sort_order,
                                   source_type, source_id, source_field, quote)
values ('a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'application_document',
        'a0000000-dddd-0000-0000-000000000001', 'q_1.blocks.c1', 1, 'skill',
        'a0000000-4444-0000-0000-000000000001', 'name', 'PostgreSQL'),
       ('b0000000-0000-0000-0000-000000000002', 'b0000000-aaaa-0000-0000-000000000002', 'application_document',
        'b0000000-dddd-0000-0000-000000000002', 'q_1.blocks.c1', 1, 'skill',
        'b0000000-4444-0000-0000-000000000002', 'name', 'Go');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select results_eq($$select owner_id::text, item_key, source_type from public.evidence_links
                     where owner_type = 'application_document'
                       and owner_id in ('a0000000-dddd-0000-0000-000000000001',
                                        'b0000000-dddd-0000-0000-000000000002')$$,
                  $$values ('a0000000-dddd-0000-0000-000000000001'::text, 'q_1.blocks.c1'::text, 'skill'::text)$$,
                  'the document''s evidence rows are readable; another user''s are not');
-- B sees none of A's document area.
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 0, 'B: A''s document hidden');
select is((select count(*)::int from public.writing_chats where id = current_setting('t.chat')::uuid), 0,
          'B: A''s document chat hidden');
select is((select count(*)::int from public.writing_chat_messages
            where writing_chat_id = current_setting('t.chat')::uuid), 0, 'B: its messages hidden');
reset role;

select * from finish();
rollback;
