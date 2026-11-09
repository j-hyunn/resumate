-- R15 후속 3 (20261113004690) — against the REAL save_application_document:
--   CF-S7 = (a) 2026-11-09: a document row present + p_expected_updated_at null -> stale_write
--   DM §2.5.0b: a slot number is never reused (slot_high_water)
-- Scoped to this file's fixtures (leftover rows of other users cannot break it).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');
insert into public.application_projects (id, user_id, name, name_source, deadline) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '가 지원', 'user', '2026-12-01'),
  ('a0000000-aaaa-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '나 지원', 'user', null);
insert into public.experiences (id, user_id, company_name, start_month) values
  ('a0000000-1111-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'A사', '2023-01-01');
insert into public.projects (id, user_id, experience_id, name, result) values
  ('a0000000-3333-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-1111-0000-0000-000000000001', 'P1', '응답 1.2초 -> 0.7초');
insert into public.skills (id, user_id, name) values
  ('a0000000-4444-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'PostgreSQL');

create schema r15v;
grant usage on schema r15v to authenticated, app_ai_writer;
-- q_n questions with a block citing the project (so the evidence rows are visible in the "nothing changed" checks).
create function r15v.body(p_slots int[], p_text text) returns jsonb language sql immutable as $$
  select jsonb_build_object('questions', coalesce(jsonb_agg(jsonb_build_object(
    'slot', 'q_' || n, 'question_text', '문항 ' || n, 'char_limit', 800, 'count_basis', 'with_spaces',
    'body', p_text || ' ' || n,
    'blocks', jsonb_build_array(jsonb_build_object('block_id', 'b' || n, 'type', 'paragraph',
                                                   'text', p_text || ' ' || n,
      'evidence', jsonb_build_array(jsonb_build_object(
        'source_type', 'project', 'source_id', 'a0000000-3333-0000-0000-000000000001',
        'source_field', 'result', 'quote', '응답 1.2초 -> 0.7초'))))) order by n), '[]'::jsonb))
    from unnest(p_slots) n;
$$;
create function r15v.ver(p_project uuid) returns timestamptz language sql stable as $$
  select updated_at from public.application_documents
   where application_project_id = p_project and document_kind = 'cover_letter';
$$;
-- message|detail of a failed save
create function r15v.err(p_sql text) returns text language plpgsql as $$
declare
  v_msg text;
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  return v_msg || '|' || coalesce(v_detail, '');
end;
$$;
grant execute on all functions in schema r15v to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ── first save (no row) + null -> passes, as before; q_1..q_3 -> slot_high_water 3 ──
select set_config('t.r', public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    r15v.body(array[1, 2, 3], '첫 답변'))::text, true);
select is((current_setting('t.r')::jsonb) ->> 'slot_high_water', '3',
          'first save with q_1..q_3 -> slot_high_water = 3 (returned)');
select is((select slot_high_water from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 3, 'and stored');

-- A chat with an applied-able proposal, to prove a stale save records nothing.
select set_config('t.chat', public.start_document_writing_chat('a0000000-aaaa-0000-0000-000000000001',
                    'cover_letter')::text, true);
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
            $json${"ops":[{"op":"replace_draft","slot":"q_1","draft":{"char_count":1,
              "sources":[{"source_type":"skill","source_id":"a0000000-4444-0000-0000-000000000001","role":"primary"}],
              "blocks":[{"block_id":"p1","type":"paragraph","text":"제안",
                "evidence":[{"source_type":"skill","source_id":"a0000000-4444-0000-0000-000000000001",
                             "source_field":"name","quote":"PostgreSQL"}]}]}}]}$json$::jsonb) -> 'rejected',
          '[]'::jsonb, 'fixture: a q_1 proposal exists');
reset role;

-- Snapshot of everything a save could touch.
create temp table snap as
select (select row(body, meta, filled_slot_count, slot_high_water, updated_at)::text from public.application_documents
         where application_project_id = 'a0000000-aaaa-0000-0000-000000000001') as doc,
       (select string_agg(item_key || ':' || source_type, ',' order by item_key) from public.evidence_links
         where user_id = 'a0000000-0000-0000-0000-000000000001' and owner_type = 'application_document') as ev,
       (select structured_draft::text from public.writing_chats where id = current_setting('t.chat')::uuid) as chat,
       (select row(name, name_source, deadline)::text from public.application_projects
         where id = 'a0000000-aaaa-0000-0000-000000000001') as ap;
grant select on snap to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ── CF-S7: a row + null -> stale_write, with the current updated_at as detail; nothing changes ──
select is(r15v.err(format($q$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001',
                     'cover_letter', r15v.body(array[1], '덮어쓰기'), '{"tone":"detailed"}', null,
                     '[{"writing_chat_id":"%s","slot":"q_1","rev":1}]',
                     null, '{"name":"새 이름","deadline":"2027-01-01"}')$q$, current_setting('t.chat'))),
          'stale_write|' || to_char(r15v.ver('a0000000-aaaa-0000-0000-000000000001') at time zone 'UTC',
                                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'a document row + null expected version -> stale_write, detail = current updated_at (R5-DB-8)');
reset role;
select is((select row(body, meta, filled_slot_count, slot_high_water, updated_at)::text from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'),
          (select doc from snap), 'stale: body / meta / counts / slot_high_water / updated_at unchanged');
select is((select string_agg(item_key || ':' || source_type, ',' order by item_key) from public.evidence_links
            where user_id = 'a0000000-0000-0000-0000-000000000001' and owner_type = 'application_document'),
          (select ev from snap), 'stale: evidence rows unchanged');
select is((select structured_draft::text from public.writing_chats where id = current_setting('t.chat')::uuid),
          (select chat from snap), 'stale: no 반영됨 기록 (the proposal has no applied_at)');
select is((select row(name, name_source, deadline)::text from public.application_projects
            where id = 'a0000000-aaaa-0000-0000-000000000001'),
          (select ap from snap), 'stale: name / deadline unchanged');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- stale_write wins over a question error now (the check runs right after the lock).
select is(split_part(r15v.err($q$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001',
                       'cover_letter', '{"questions":[{"slot":"q_1","char_limit":null,"count_basis":"with_spaces"}]}')$q$),
                     '|', 1),
          'stale_write', 'stale_write is checked before the question checks');
-- A wrong value -> stale_write (unchanged rule).
select is(split_part(r15v.err($q$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001',
                       'cover_letter', r15v.body(array[1], 'x'), null, '2020-01-01T00:00:00Z')$q$), '|', 1),
          'stale_write', 'a row + a wrong expected version -> stale_write');

-- ── "내 내용으로 저장": resend with the stale_write's current_updated_at -> passes ──
select set_config('t.cur', split_part(r15v.err($q$select public.save_application_document(
                     'a0000000-aaaa-0000-0000-000000000001', 'cover_letter', r15v.body(array[1, 2, 3], '내 내용'))$q$),
                     '|', 2), true);
select ok(public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
            r15v.body(array[1, 2, 3], '내 내용'), null, current_setting('t.cur')::timestamptz) ? 'updated_at',
          '"내 내용으로 저장": resending with current_updated_at passes');
select is((select body #>> '{questions,0,body}' from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), '내 내용 1',
          'and the caller''s content is now the record');
-- A row + the right value -> passes (unchanged rule).
select ok(public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
            r15v.body(array[1, 2, 3], '다시'), null, r15v.ver('a0000000-aaaa-0000-0000-000000000001'))
            ? 'updated_at', 'a row + the right expected version -> passes');

-- ── slot numbers are never reused (DM §2.5.0b) ──
-- Delete q_3 and save.
select ok(public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
            r15v.body(array[1, 2], '둘만'), null, r15v.ver('a0000000-aaaa-0000-0000-000000000001'))
            ? 'updated_at', 'q_3 deleted and saved');
select is((select slot_high_water from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'), 3,
          'slot_high_water stays 3 after q_3 is gone');
select set_config('t.v', r15v.ver('a0000000-aaaa-0000-0000-000000000001')::text, true);
-- Add a new question as q_3 again -> invalid_slot, nothing changes.
select is(r15v.err(format($q$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001',
                     'cover_letter', r15v.body(array[1, 2, 3], '재사용'), null, '%s')$q$, current_setting('t.v'))),
          'invalid_slot|q_3', 'a new question reusing q_3 -> invalid_slot (raise detail = the slot)');
select is((select array[jsonb_array_length(body -> 'questions'), slot_high_water]
             from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'),
          array[2, 3], 'and nothing changed');
select is(r15v.ver('a0000000-aaaa-0000-0000-000000000001'), current_setting('t.v')::timestamptz,
          'updated_at unchanged by the refused save');
-- The next number passes and raises the mark.
select set_config('t.r', public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    r15v.body(array[1, 2, 4], '새 번호'), null, current_setting('t.v')::timestamptz)::text, true);
select is((current_setting('t.r')::jsonb) ->> 'slot_high_water', '4', 'q_4 passes and slot_high_water becomes 4');
-- Keeping the stored slots and editing one of them passes (the rule does not block stored slots).
select ok(public.save_application_document('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
            r15v.body(array[1, 2, 4], '고친 문장'), null, r15v.ver('a0000000-aaaa-0000-0000-000000000001'))
            ? 'updated_at', 'editing the stored q_1 / q_2 / q_4 passes');
-- Order of the checks: an expected-version failure comes before the slot check.
select is(split_part(r15v.err($q$select public.save_application_document('a0000000-aaaa-0000-0000-000000000001',
                       'cover_letter', r15v.body(array[1, 2, 3], 'x'))$q$), '|', 1),
          'stale_write', 'stale_write is checked before the slot reuse check');
-- No direct write can lower it (write guard).
select throws_ok($$update public.application_documents set slot_high_water = 0
                    where application_project_id = 'a0000000-aaaa-0000-0000-000000000001'$$,
                 'P0001', 'direct_write_not_allowed', 'slot_high_water cannot be lowered by a direct update');
reset role;

-- ── slot_high_water alone does not move updated_at ──
select set_config('t.v', r15v.ver('a0000000-aaaa-0000-0000-000000000001')::text, true);
update public.application_documents set slot_high_water = 9
 where application_project_id = 'a0000000-aaaa-0000-0000-000000000001';
select is(r15v.ver('a0000000-aaaa-0000-0000-000000000001'), current_setting('t.v')::timestamptz,
          'an update of slot_high_water alone keeps updated_at (it is metadata, not content)');
alter table public.application_documents disable trigger application_documents_set_updated_at;
update public.application_documents set updated_at = '2020-01-01 00:00:00+00'
 where application_project_id = 'a0000000-aaaa-0000-0000-000000000001';
alter table public.application_documents enable trigger application_documents_set_updated_at;
update public.application_documents set slot_high_water = 10
 where application_project_id = 'a0000000-aaaa-0000-0000-000000000001';
select is(r15v.ver('a0000000-aaaa-0000-0000-000000000001'), '2020-01-01 00:00:00+00'::timestamptz,
          'checked against a fixed old updated_at too (now() would hide a moved value)');

-- ── a first save on another project still passes with null ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(public.save_application_document('a0000000-aaaa-0000-0000-000000000002', 'cover_letter',
            r15v.body(array[5], '처음')) ? 'application_document_id',
          'no row + null -> passes (the first save), any slot number allowed');
select is((select slot_high_water from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000002'), 5,
          'that first save records its highest number');
reset role;

-- ── the other three save RPCs keep overwriting with null (no regression) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.p', (public.save_project_page(null, jsonb_build_object(
                    'name', 'P2', 'experience_id', 'a0000000-1111-0000-0000-000000000001')) ->> 'project_id'),
                  true);
select ok(public.save_project_page(current_setting('t.p')::uuid, '{"name":"P2 고침"}', null) ? 'updated_at',
          'save_project_page: an update with a null expected version still overwrites');
reset role;
insert into public.projects (id, user_id, name, role) values
  ('a0000000-3333-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'S', '리드');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.d', (public.save_project_deliverable(null, 'a0000000-3333-0000-0000-000000000009', '회고', '본문')
                           ->> 'project_deliverable_id'), true);
select ok(public.save_project_deliverable(current_setting('t.d')::uuid, null, '회고 고침', '본문 2', null)
            ? 'updated_at', 'save_project_deliverable: an update with null still overwrites');
-- save_profile_basics: the profile row always exists, and a null expected version still overwrites.
select ok(public.save_profile_basics('{"job_search_status":null}'::jsonb) ? 'updated_at',
          'save_profile_basics: a first save with null');
select ok(public.save_profile_basics('{"job_search_status":null}'::jsonb, null, null) ? 'updated_at',
          'save_profile_basics: a second save with null still overwrites (unchanged by CF-S7)');
reset role;

-- ══ QA-07 / QA-08 (후속 라운드 2): a slot's identity = number AND question_id. The proposals are made by
--    app_ai_writer through the real patch RPC (not hand-written jsonb), like the QA reproduction. ══
insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '다 지원', 'user');
create function r15v.q(p_slot text, p_qid text, p_text text, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('slot', p_slot, 'question_id', p_qid, 'question_text', p_text,
           'char_limit', 800, 'count_basis', 'with_spaces', 'body', p_text || ' 답변', 'blocks', '[]'::jsonb))
         || p_extra;
$$;
grant execute on function r15v.q(text, text, text, jsonb) to authenticated;
create function r15v.propose(p_chat uuid, p_slot text, p_qid text) returns jsonb language sql as $$
  select public.apply_structured_draft_patch(p_chat, jsonb_build_object('ops', jsonb_build_array(
    jsonb_build_object('op', 'replace_draft', 'slot', p_slot, 'question_id', p_qid, 'draft', jsonb_build_object(
      'char_count', 2, 'blocks', jsonb_build_array(jsonb_build_object(
        'block_id', 'x-' || p_slot, 'type', 'paragraph', 'text', p_slot || ' 제안 문장',
        'evidence', jsonb_build_array(jsonb_build_object(
          'source_type', 'skill', 'source_id', 'a0000000-4444-0000-0000-000000000001',
          'source_field', 'name', 'quote', 'PostgreSQL')))))))));
$$;
grant execute on function r15v.propose(uuid, text, text) to app_ai_writer;
create function r15v.applied(p_chat uuid, p_slot text) returns boolean language sql stable as $$
  select (q #>> '{draft,applied_at}') is not null
    from public.writing_chats w, jsonb_array_elements(w.structured_draft #> '{document,questions}') q
   where w.id = p_chat and q ->> 'slot' = p_slot;
$$;
grant execute on function r15v.applied(uuid, text) to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- q_1..q_3 with fixed question_ids; q_3 cites its own note (user_note -> its question_id).
select ok(public.save_application_document('a0000000-aaaa-0000-0000-000000000003', 'cover_letter',
            jsonb_build_object('questions', jsonb_build_array(
              r15v.q('q_1', 'a0000000-0901-0000-0000-000000000001', '문항 1'),
              r15v.q('q_2', 'a0000000-0902-0000-0000-000000000002', '문항 2'),
              r15v.q('q_3', 'a0000000-0903-0000-0000-000000000003', '문항 3',
                     jsonb_build_object('user_note', '메모 3', 'blocks', jsonb_build_array(jsonb_build_object(
                       'block_id', 'n3', 'type', 'paragraph', 'text', '문항 3 답변',
                       'evidence', jsonb_build_array(jsonb_build_object(
                         'source_type', 'user_note', 'source_id', 'a0000000-0903-0000-0000-000000000003',
                         'quote', '메모 3')))))))))
            ? 'application_document_id', 'fixture: q_1..q_3 saved with their question_ids');
select set_config('t.c3', public.start_document_writing_chat('a0000000-aaaa-0000-0000-000000000003',
                    'cover_letter')::text, true);
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(r15v.propose(current_setting('t.c3')::uuid, 'q_1', 'a0000000-0901-0000-0000-000000000001') -> 'rejected',
          '[]'::jsonb, 'fixture: AI proposal for q_1 (rev 1)');
select is(r15v.propose(current_setting('t.c3')::uuid, 'q_2', 'a0000000-0902-0000-0000-000000000002') -> 'rejected',
          '[]'::jsonb, 'fixture: AI proposal for q_2 (rev 1)');
select is(r15v.propose(current_setting('t.c3')::uuid, 'q_3', 'a0000000-0903-0000-0000-000000000003') -> 'rejected',
          '[]'::jsonb, 'fixture: AI proposal for q_3 (rev 1)');
select is(r15v.propose(current_setting('t.c3')::uuid, 'q_4', 'a0000000-0904-0000-0000-00000000000a') -> 'rejected',
          '[]'::jsonb, 'fixture: AI proposal for an unsaved q_4 written for question A');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.v3', r15v.ver('a0000000-aaaa-0000-0000-000000000003')::text, true);

-- ── S-swap: q_3 with ANOTHER question_id and another text, plus the old q_3 proposal -> invalid_slot ──
select is(r15v.err(format($q$select public.save_application_document('a0000000-aaaa-0000-0000-000000000003',
                     'cover_letter', jsonb_build_object('questions', jsonb_build_array(
                       r15v.q('q_1', 'a0000000-0901-0000-0000-000000000001', '문항 1'),
                       r15v.q('q_2', 'a0000000-0902-0000-0000-000000000002', '문항 2'),
                       r15v.q('q_3', 'a0000000-0999-0000-0000-000000000099', '바꿔 낀 다른 문항'))),
                     null, '%s', '[{"writing_chat_id":"%s","slot":"q_3","rev":1}]')$q$,
                     current_setting('t.v3'), current_setting('t.c3'))),
          'invalid_slot|q_3', 'S-swap: same number + another question_id -> invalid_slot (QA-07 rule 1)');
select is((select array[d.body #>> '{questions,2,question_id}', d.body #>> '{questions,2,question_text}']
             from public.application_documents d
            where d.application_project_id = 'a0000000-aaaa-0000-0000-000000000003'),
          array['a0000000-0903-0000-0000-000000000003', '문항 3'], 'S-swap: the stored q_3 is unchanged');
select is(r15v.ver('a0000000-aaaa-0000-0000-000000000003'), current_setting('t.v3')::timestamptz,
          'S-swap: updated_at unchanged');
select is(r15v.applied(current_setting('t.c3')::uuid, 'q_3'), false, 'S-swap: the old q_3 proposal is not applied');

-- ── S-swapnull: q_3 WITHOUT a question_id -> the stored id is inherited; the note citation stays valid ──
select set_config('t.r', public.save_application_document('a0000000-aaaa-0000-0000-000000000003', 'cover_letter',
                    jsonb_build_object('questions', jsonb_build_array(
                      r15v.q('q_1', 'a0000000-0901-0000-0000-000000000001', '문항 1'),
                      r15v.q('q_2', 'a0000000-0902-0000-0000-000000000002', '문항 2'),
                      r15v.q('q_3', null, '문항 3 고침',
                             jsonb_build_object('user_note', '메모 3', 'blocks', jsonb_build_array(jsonb_build_object(
                               'block_id', 'n3', 'type', 'paragraph', 'text', '문항 3 고침 답변',
                               'evidence', jsonb_build_array(jsonb_build_object(
                                 'source_type', 'user_note', 'source_id', 'a0000000-0903-0000-0000-000000000003',
                                 'quote', '메모 3')))))))),
                    null, current_setting('t.v3')::timestamptz,
                    format('[{"writing_chat_id":"%s","slot":"q_3","rev":1}]', current_setting('t.c3'))::jsonb
                  )::text, true);
select is((select body #>> '{questions,2,question_id}' from public.application_documents
            where application_project_id = 'a0000000-aaaa-0000-0000-000000000003'),
          'a0000000-0903-0000-0000-000000000003',
          'S-swapnull: q_3 without a question_id keeps its stored id (no new uuid — QA-07 rule 2)');
select is((select count(*)::int from public.evidence_links
            where user_id = 'a0000000-0000-0000-0000-000000000001' and owner_type = 'application_document'
              and source_type = 'user_note' and source_id = 'a0000000-0903-0000-0000-000000000003'
              and source_deleted_at is null), 1,
          'S-swapnull: the user_note citation still points at a live question');
select is((current_setting('t.r')::jsonb) -> 'applied',
          jsonb_build_array(jsonb_build_object('slot', 'q_3', 'writing_chat_id', current_setting('t.c3'))),
          'positive control: the proposal written for that same question is applied');

-- ── a slot added in this visit: proposal question_id ≠ body question_id -> skipped not_found, save succeeds ──
--    QA-08 in the same save: q_2 is deleted while its proposal is sent -> skipped not_found.
select set_config('t.r', public.save_application_document('a0000000-aaaa-0000-0000-000000000003', 'cover_letter',
                    jsonb_build_object('questions', jsonb_build_array(
                      r15v.q('q_1', 'a0000000-0901-0000-0000-000000000001', '문항 1 고침'),
                      r15v.q('q_3', 'a0000000-0903-0000-0000-000000000003', '문항 3 고침'),
                      r15v.q('q_4', 'a0000000-0904-0000-0000-00000000000b', '새 문항 B'))),
                    null, r15v.ver('a0000000-aaaa-0000-0000-000000000003'),
                    format('[{"writing_chat_id":"%1$s","slot":"q_1","rev":1},
                             {"writing_chat_id":"%1$s","slot":"q_2","rev":1},
                             {"writing_chat_id":"%1$s","slot":"q_4","rev":1}]', current_setting('t.c3'))::jsonb
                  )::text, true);
select is((current_setting('t.r')::jsonb) ->> 'slot_count', '3', 'the save itself succeeded (q_2 gone, q_4 added)');
select is((select jsonb_agg(e ->> 'slot' order by e ->> 'slot') from jsonb_array_elements(
             (current_setting('t.r')::jsonb) -> 'applied') e), '["q_1"]'::jsonb,
          'regression: same number + same question_id -> the q_1 proposal is applied');
select is((select jsonb_agg(jsonb_build_object('slot', e ->> 'slot', 'reason', e ->> 'reason') order by e ->> 'slot')
             from jsonb_array_elements((current_setting('t.r')::jsonb) -> 'skipped') e),
          '[{"slot": "q_2", "reason": "not_found"}, {"slot": "q_4", "reason": "not_found"}]'::jsonb,
          'QA-08: the deleted q_2''s proposal -> not_found; QA-07 rule 4: q_4 written for another question -> not_found');
select is(r15v.applied(current_setting('t.c3')::uuid, 'q_2'), false, 'QA-08: q_2 proposal not marked applied');
select is(r15v.applied(current_setting('t.c3')::uuid, 'q_4'), false, 'QA-07 rule 4: q_4 proposal not marked applied');
reset role;

-- The patch RPC follows the question a later draft is written for (so rule 4 compares with the right id).
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(r15v.propose(current_setting('t.c3')::uuid, 'q_4', 'a0000000-0904-0000-0000-00000000000b') -> 'rejected',
          '[]'::jsonb, 'a new q_4 draft written for question B');
reset role;
select is((select q ->> 'question_id' from public.writing_chats w,
                  jsonb_array_elements(w.structured_draft #> '{document,questions}') q
            where w.id = current_setting('t.c3')::uuid and q ->> 'slot' = 'q_4'),
          'a0000000-0904-0000-0000-00000000000b', 'the proposal''s question_id now follows the draft (B)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.save_application_document('a0000000-aaaa-0000-0000-000000000003', 'cover_letter',
            jsonb_build_object('questions', jsonb_build_array(
              r15v.q('q_1', 'a0000000-0901-0000-0000-000000000001', '문항 1 고침'),
              r15v.q('q_3', 'a0000000-0903-0000-0000-000000000003', '문항 3 고침'),
              r15v.q('q_4', 'a0000000-0904-0000-0000-00000000000b', '새 문항 B'))),
            null, r15v.ver('a0000000-aaaa-0000-0000-000000000003'),
            format('[{"writing_chat_id":"%s","slot":"q_4","rev":2}]', current_setting('t.c3'))::jsonb)
            -> 'applied' -> 0 ->> 'slot',
          'q_4', 'the q_4 draft written for B is applied to question B');
reset role;

select * from finish();
rollback;
