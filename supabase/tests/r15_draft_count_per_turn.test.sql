-- R15 (R15-API-7, 리더 판정 2026-11-09): `structured_draft.draft_count`는 초안 **턴당 1**이다.
-- AI 명세 C-14 "제안 단위가 '최대 3문항'" → 한 제안 = 한 초안 턴 → 6회 = 초안 턴 6회(자소서 5문항이면 세 바퀴).
-- 산출물(2.5.0a)·STAR 분기의 기존 동작은 바뀌지 않았다(슬롯이 하나라 "연산당 = 턴당").
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');
insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '가 지원', 'user');
insert into public.experiences (id, user_id, company_name, start_month) values
  ('a0000000-1111-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'A사', '2023-01-01');
-- An affiliated project for the STAR chat, a standalone one with a deliverable for the deliverable chat.
insert into public.projects (id, user_id, experience_id, name) values
  ('a0000000-3333-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-1111-0000-0000-000000000001', 'P1');
insert into public.projects (id, user_id, name, role) values
  ('a0000000-3333-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'S1', '리드');
insert into public.project_deliverables (id, user_id, project_id, title, body) values
  ('a0000000-4d00-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-3333-0000-0000-000000000002', '회고', '');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.doc', public.start_document_writing_chat('a0000000-aaaa-0000-0000-000000000001',
                    'cover_letter')::text, true);
select set_config('t.dlv', public.start_deliverable_writing_chat('a0000000-4d00-0000-0000-000000000001')::text,
                  true);
reset role;

-- One draft turn that proposes three questions = three replace_draft ops in ONE patch call.
create function pg_temp.turn3(p_chat uuid, p_tag text) returns jsonb language sql as $$
  select public.apply_structured_draft_patch(p_chat, jsonb_build_object('ops', jsonb_build_array(
    jsonb_build_object('op', 'replace_draft', 'slot', 'q_1', 'draft', jsonb_build_object(
      'char_count', 3, 'blocks', jsonb_build_array(jsonb_build_object(
        'block_id', 'b1-' || p_tag, 'type', 'paragraph', 'text', '문항 1 본문 ' || p_tag)))),
    jsonb_build_object('op', 'replace_draft', 'slot', 'q_2', 'draft', jsonb_build_object(
      'char_count', 3, 'blocks', jsonb_build_array(jsonb_build_object(
        'block_id', 'b2-' || p_tag, 'type', 'paragraph', 'text', '문항 2 본문 ' || p_tag)))),
    jsonb_build_object('op', 'replace_draft', 'slot', 'q_3', 'draft', jsonb_build_object(
      'char_count', 3, 'blocks', jsonb_build_array(jsonb_build_object(
        'block_id', 'b3-' || p_tag, 'type', 'paragraph', 'text', '문항 3 본문 ' || p_tag)))))));
$$;
grant execute on function pg_temp.turn3(uuid, text) to app_ai_writer;
create function pg_temp.dc(p_chat uuid) returns integer language sql stable as $$
  select (structured_draft ->> 'draft_count')::integer from public.writing_chats where id = p_chat;
$$;
grant execute on function pg_temp.dc(uuid) to app_ai_writer;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';

-- ── one turn, three questions -> +1 ──
select is(pg_temp.turn3(current_setting('t.doc')::uuid, 't1') -> 'rejected', '[]'::jsonb,
          'a draft turn proposing three questions is accepted');
select is(pg_temp.dc(current_setting('t.doc')::uuid), 1,
          'draft_count = 1 after one turn with three replace_draft ops (R15-API-7)');
select is((select jsonb_array_length(structured_draft #> '{document,questions}')
             from public.writing_chats where id = current_setting('t.doc')::uuid), 3,
          'and all three questions carry a draft');

-- ── a second turn -> 2 ──
select is(pg_temp.turn3(current_setting('t.doc')::uuid, 't2') -> 'rejected', '[]'::jsonb, 'second turn accepted');
select is(pg_temp.dc(current_setting('t.doc')::uuid), 2, 'draft_count = 2 after the second turn');
-- So a 5-question cover letter (3 + 2) goes round once for 2, not 5.

-- ── a count_draft-only turn also costs 1 (AI 명세: "초안 횟수는 셈") ──
select lives_ok(format($$select public.apply_structured_draft_patch('%s',
                    '{"ops":[{"op":"count_draft"}]}')$$, current_setting('t.doc')),
                'a count_draft-only turn is accepted');
select is(pg_temp.dc(current_setting('t.doc')::uuid), 3, 'draft_count = 3 (a dropped-draft turn still counts)');

-- ── a patch with no draft op does not count ──
select lives_ok(format($$select public.apply_structured_draft_patch('%s',
                    '{"ops":[{"op":"set_tone","value":"concise"}]}')$$, current_setting('t.doc')),
                'a non-draft patch is accepted');
select is(pg_temp.dc(current_setting('t.doc')::uuid), 3, 'a patch without a draft op does not raise the count');

-- ── a rejected replace_draft does not count ──
select is(public.apply_structured_draft_patch(current_setting('t.doc')::uuid,
            '{"ops":[{"op":"replace_draft","slot":"q_1","draft":{"char_count":1,"blocks":[]}}]}'::jsonb)
            -> 'rejected' -> 0 ->> 'reason',
          'invalid_value', 'a malformed draft is rejected');
select is(pg_temp.dc(current_setting('t.doc')::uuid), 3, 'a rejected draft does not raise the count');

-- ── the limit bites after the SIXTH turn, not inside a turn ──
select is(pg_temp.turn3(current_setting('t.doc')::uuid, 't4') -> 'rejected', '[]'::jsonb, 'turn 4');
select is(pg_temp.turn3(current_setting('t.doc')::uuid, 't5') -> 'rejected', '[]'::jsonb, 'turn 5');
select is(pg_temp.turn3(current_setting('t.doc')::uuid, 't6') -> 'rejected', '[]'::jsonb, 'turn 6');
select is(pg_temp.dc(current_setting('t.doc')::uuid), 6, 'six draft turns -> draft_count = 6');
select throws_ok(format($$select pg_temp.turn3('%s', 't7')$$, current_setting('t.doc')),
                 'P0001', 'writing_chat_draft_limit_reached',
                 'the seventh draft turn is refused (DM §2.5.0b, 409)');
select is(pg_temp.dc(current_setting('t.doc')::uuid), 6, 'the refused turn left the count at 6');

-- ── regression: the deliverable branch is unchanged (one slot, so per-op = per-turn) ──
select is(public.apply_structured_draft_patch(current_setting('t.dlv')::uuid,
            $json${"ops":[{"op":"replace_draft","body":{"blocks":[
              {"block_id":"d1","type":"paragraph","text":"산출물 본문"}]}}]}$json$::jsonb) -> 'rejected',
          '[]'::jsonb, 'deliverable: a draft is accepted');
select is(pg_temp.dc(current_setting('t.dlv')::uuid), 1, 'deliverable draft_count = 1 (unchanged)');
select lives_ok(format($$select public.apply_structured_draft_patch('%s',
                    '{"ops":[{"op":"count_draft"},{"op":"count_draft"}]}')$$, current_setting('t.dlv')),
                'deliverable: two count_draft ops in one call');
select is(pg_temp.dc(current_setting('t.dlv')::uuid), 3,
          'deliverable: still one per OP (2.5.0a behaviour deliberately untouched)');

select * from finish();
rollback;
