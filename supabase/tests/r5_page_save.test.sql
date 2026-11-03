-- R5 page-save RPCs (DM v4.5 §2.5.1, §2.3 updated_at rule, §3.3): save_project_page / save_project_deliverable —
-- create / update, refusal codes, stale_write, unchanged save, "반영됨" records (applied / skipped reasons,
-- record failure never blocks the save), source_writing_chat_id without touching updated_at, privileges.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');
insert into public.experiences (id, user_id, company_name) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'A사'),
  ('bbbbbbbb-1111-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'B사');
insert into public.educations (id, user_id, institution_name) values
  ('aaaaaaaa-2222-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'A대학');
insert into public.projects (id, user_id, name) values
  ('aaaaaaaa-3333-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000001', 'A standalone'),
  ('bbbbbbbb-3333-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-000000000002', 'B standalone');

-- Captures the detail of the error a statement raises (pgTAP's throws_ok does not check it).
create function pg_temp.err_detail(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v = pg_exception_detail;
  return v;
end;
$$;
create function pg_temp.draft(p text) returns jsonb language sql as
  $$ select structured_draft from public.writing_chats where id = current_setting(p)::uuid $$;
grant execute on function pg_temp.err_detail(text) to authenticated;
grant execute on function pg_temp.draft(text) to authenticated, app_ai_writer;

-- ── privileges ──
select is(array(select r from unnest(array['anon', 'authenticated', 'app_ai_writer', 'app_key_reader']) r
                 where has_function_privilege(r, 'public.save_project_page(uuid, jsonb, timestamptz, jsonb)', 'execute')),
          array['authenticated'], 'save_project_page: authenticated only');
select is(array(select r from unnest(array['anon', 'authenticated', 'app_ai_writer', 'app_key_reader']) r
                 where has_function_privilege(r, 'public.save_project_deliverable(uuid, uuid, text, text, timestamptz, jsonb)',
                                              'execute')),
          array['authenticated'], 'save_project_deliverable: authenticated only');
select is((select prosecdef from pg_proc where oid = 'public.save_project_page(uuid, jsonb, timestamptz, jsonb)'::regprocedure),
          false, 'save_project_page is security invoker');
select is((select prosecdef from pg_proc
            where oid = 'public.save_project_deliverable(uuid, uuid, text, text, timestamptz, jsonb)'::regprocedure),
          false, 'save_project_deliverable is security invoker');
select is((select prosecdef from pg_proc
            where oid = 'private.wc_mark_proposal_applied(uuid, text, uuid, text, integer, text)'::regprocedure),
          true, 'wc_mark_proposal_applied is a definer helper');
select ok(not has_function_privilege('anon', 'private.wc_mark_proposal_applied(uuid, text, uuid, text, integer, text)', 'execute')
          and not has_function_privilege('app_ai_writer', 'private.wc_mark_proposal_applied(uuid, text, uuid, text, integer, text)', 'execute'),
          'helper: no anon / app_ai_writer execute');
select hasnt_function('public', 'apply_writing_chat_proposal', 'apply_writing_chat_proposal is gone (DM v4.5)');
select hasnt_function('private', 'wc_proposal_mark_applied', 'old helper gone');
select hasnt_function('private', 'wc_proposal_lock', 'old lock helper gone');

-- ════════ save_project_page: create ════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok($$select public.save_project_page(null, '{"name":"  ","experience_id":"aaaaaaaa-1111-0000-0000-000000000001"}')$$,
                 'P0001', 'project_name_required', 'create: blank name');
select throws_ok($$select public.save_project_page(null, '{"experience_id":"aaaaaaaa-1111-0000-0000-000000000001"}')$$,
                 'P0001', 'project_name_required', 'create: no name');
select throws_ok($$select public.save_project_page(null, '{"name":"P"}')$$,
                 'P0001', 'project_affiliation_required', 'create: no affiliation (standalone goes through S-43)');
select throws_ok($$select public.save_project_page(null, '{"name":"P","experience_id":"aaaaaaaa-1111-0000-0000-000000000001",
                   "education_id":"aaaaaaaa-2222-0000-0000-000000000001"}')$$,
                 'P0001', 'project_affiliation_required', 'create: both affiliations');
select throws_ok($$select public.save_project_page(null, '{"name":"P","experience_id":"bbbbbbbb-1111-0000-0000-000000000001"}')$$,
                 'P0001', 'not_found', 'create: another user''s experience');
select throws_ok($$select public.save_project_page(null, '{"name":"P","experience_id":"aaaaaaaa-1111-0000-0000-000000000001","summary":"x"}')$$,
                 'P0001', 'invalid_fields', 'unknown key');
select is(pg_temp.err_detail($$select public.save_project_page(null, '{"name":"P","zz":1,"summary":"x"}')$$),
          'summary,zz', 'invalid_fields detail lists the keys');
select throws_ok($$select public.save_project_page(null, '{"name":"P","experience_id":"aaaaaaaa-1111-0000-0000-000000000001","situation":3}')$$,
                 'P0001', 'invalid_fields', 'wrong JSON type');
select throws_ok($$select public.save_project_page(null, '{"name":"P","experience_id":"not-a-uuid"}')$$,
                 'P0001', 'invalid_fields', 'malformed affiliation id');
select throws_ok($$select public.save_project_page(null, jsonb_build_object('name', repeat('가', 101),
                   'experience_id', 'aaaaaaaa-1111-0000-0000-000000000001'))$$,
                 'P0001', 'field_too_long', 'name over 100');
select is(pg_temp.err_detail($$select public.save_project_page(null, jsonb_build_object('name', 'P',
                   'experience_id', 'aaaaaaaa-1111-0000-0000-000000000001', 'result', repeat('가', 2001)))$$),
          'result', 'field_too_long detail = field');
select throws_ok($$select public.save_project_page(null, '{"name":"P","experience_id":"aaaaaaaa-1111-0000-0000-000000000001","start_month":"2024-13"}')$$,
                 'P0001', 'invalid_period', 'bad month');
select throws_ok($$select public.save_project_page(null, '{"name":"P","experience_id":"aaaaaaaa-1111-0000-0000-000000000001",
                   "start_month":"2024-05","end_month":"2024-01"}')$$,
                 'P0001', 'invalid_period', 'end before start');
select throws_ok($$select public.save_project_page(null, '{"name":"P","experience_id":"aaaaaaaa-1111-0000-0000-000000000001",
                   "is_current":true,"end_month":"2024-01"}')$$,
                 'P0001', 'invalid_period', 'is_current with an end month');
select throws_ok($$select public.save_project_page(null, '{"name":"P","experience_id":"aaaaaaaa-1111-0000-0000-000000000001","project_type":"hobby"}')$$,
                 'P0001', 'invalid_classification', 'project_type outside the list');
select throws_ok($$select public.save_project_page(null, '{"name":"P","experience_id":"aaaaaaaa-1111-0000-0000-000000000001",
                   "competencies":["analysis","planning","execution","leadership"]}')$$,
                 'P0001', 'invalid_classification', 'more than 3 competencies');
select throws_ok($$select public.save_project_page(null, '{"name":"P","experience_id":"aaaaaaaa-1111-0000-0000-000000000001",
                   "competencies":["analysis","analysis"]}')$$,
                 'P0001', 'invalid_classification', 'duplicate competencies');
select is((select count(*)::int from public.projects where experience_id is not null), 0, 'refusals wrote nothing');

select lives_ok($$select set_config('t.c', public.save_project_page(null, '{"name":" 결제 개편 ",
                   "experience_id":"aaaaaaaa-1111-0000-0000-000000000001","start_month":"2023-03","is_current":true,
                   "project_type":"improvement","competencies":["execution","analysis"],
                   "situation":"결제 지연","action":"  ","task":""}', '2000-01-01')::text, true)$$,
                'create (expected version ignored on create)');
select set_config('t.p', current_setting('t.c')::jsonb ->> 'project_id', true);
select is((current_setting('t.c')::jsonb - array['project_id', 'updated_at']),
          '{"status": "draft", "applied": [], "skipped": []}'::jsonb, 'create return shape');
select is((select (name, start_month, is_current, project_type, competencies, situation, action is null, task is null, status)::text
             from public.projects where id = current_setting('t.p')::uuid),
          '("결제 개편",2023-03-01,t,improvement,"{execution,analysis}","결제 지연",t,t,draft)',
          'stored: name trimmed, month pinned, blank STAR = null, competencies in order');
select is((current_setting('t.c')::jsonb ->> 'updated_at')::timestamptz,
          (select updated_at from public.projects where id = current_setting('t.p')::uuid), 'returned updated_at');

-- ════════ save_project_page: update ════════
reset role;
-- an old version to tell writes apart inside one transaction
alter table public.projects disable trigger projects_set_updated_at;
update public.projects set updated_at = '2026-01-01T00:00:00Z' where id = current_setting('t.p')::uuid;
alter table public.projects enable trigger projects_set_updated_at;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok($$select public.save_project_page(gen_random_uuid(), '{}')$$, 'P0001', 'not_found', 'update: unknown id');
select throws_ok($$select public.save_project_page('aaaaaaaa-3333-0000-0000-000000000009', '{}')$$,
                 'P0001', 'project_not_affiliated', 'update: standalone project');
select throws_ok($$select public.save_project_page(current_setting('t.p')::uuid, '{"action":"x"}', '2026-02-01T00:00:00Z')$$,
                 'P0001', 'stale_write', 'expected version differs');
select is(pg_temp.err_detail($$select public.save_project_page(current_setting('t.p')::uuid, '{"action":"x"}', '2026-02-01T00:00:00Z')$$),
          '2026-01-01T00:00:00.000000Z', 'stale_write detail = current updated_at');
select is((select action from public.projects where id = current_setting('t.p')::uuid), null, 'stale_write wrote nothing');
select is(public.save_project_page(current_setting('t.p')::uuid, '{"name":"결제 개편","situation":"결제 지연"}',
                                   '2026-01-01T00:00:00Z') ->> 'updated_at',
          '2026-01-01T00:00:00+00:00', 'unchanged save writes nothing: updated_at stays');
select throws_ok($$select public.save_project_page(current_setting('t.p')::uuid, '{"experience_id":null}')$$,
                 'P0001', 'project_scope_change_not_allowed', 'cannot become standalone');
select throws_ok($$select public.save_project_page(current_setting('t.p')::uuid, '{"education_id":"aaaaaaaa-2222-0000-0000-000000000001"}')$$,
                 'P0001', 'project_affiliation_required', 'education without clearing experience = both');
select lives_ok($$select public.save_project_page(current_setting('t.p')::uuid,
                   '{"experience_id":null,"education_id":"aaaaaaaa-2222-0000-0000-000000000001","action":"인덱스 재설계"}')$$,
                'move experience -> education + edit (expected version null = overwrite)');
select is((select (experience_id is null, education_id, start_month, project_type, status)::text
             from public.projects where id = current_setting('t.p')::uuid),
          '(t,aaaaaaaa-2222-0000-0000-000000000001,2023-03-01,improvement,complete)',
          'absent keys kept, moved, status recomputed by the trigger');
select isnt((select updated_at from public.projects where id = current_setting('t.p')::uuid),
            '2026-01-01T00:00:00Z'::timestamptz, 'a real change moves updated_at');

-- B cannot save A's project
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.save_project_page(current_setting('t.p')::uuid, '{"action":"B"}')$$,
                 'P0001', 'not_found', 'B gets not_found for A''s project');
reset role;

-- ════════ "반영됨" records (S-10) ════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.w1', public.start_writing_chat(current_setting('t.p')::uuid)::text, true);
select set_config('t.w2', public.start_writing_chat(current_setting('t.p')::uuid)::text, true);
select set_config('t.m1', (select message_id::text from public.append_writing_chat_message(current_setting('t.w1')::uuid,
  '결과는 응답 시간이 줄었어요')), true);
select set_config('t.m2', (select message_id::text from public.append_writing_chat_message(current_setting('t.w2')::uuid,
  '배운 점은 측정이 먼저라는 것')), true);
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.w1')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"result"}'::jsonb, 'value', '응답 시간이 줄었다',
                     'source_message_ids', jsonb_build_array(current_setting('t.m1'))),
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"task"}'::jsonb, 'value', '리드',
                     'source_message_ids', jsonb_build_array(current_setting('t.m1')), 'review', 'needs_review'),
  jsonb_build_object('op', 'set', 'target', '{"section":"classification","field":"experience_type"}'::jsonb,
                     'value', 'problem_solving'),
  jsonb_build_object('op', 'set', 'target', '{"section":"project","field":"end_month"}'::jsonb, 'value', '2024-02',
                     'source_message_ids', jsonb_build_array(current_setting('t.m1'))))))$$, 'chat 1 proposals');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.w2')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"learnings"}'::jsonb, 'value', '측정이 먼저다',
                     'source_message_ids', jsonb_build_array(current_setting('t.m2'))))))$$, 'chat 2 proposal');
-- an AI turn after the fill bumps learnings to rev 2 (proposal_changed below)
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.w2')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'append', 'target', '{"section":"star","field":"learnings"}'::jsonb, 'value', '그리고 공유',
                     'source_message_ids', jsonb_build_array(current_setting('t.m2'))))))$$, 'chat 2 changes after the fill');
reset role;

-- a separate project + chat to show "not this project's chat"
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.p2', public.save_project_page(null, '{"name":"다른 프로젝트","experience_id":"aaaaaaaa-1111-0000-0000-000000000001"}')
                          ->> 'project_id', true);
select set_config('t.w3', public.start_writing_chat(current_setting('t.p2')::uuid)::text, true);

reset role;
alter table public.projects disable trigger projects_set_updated_at;
update public.projects set updated_at = '2026-01-02T00:00:00Z' where id = current_setting('t.p')::uuid;
alter table public.projects enable trigger projects_set_updated_at;
-- record failure injection: any structured_draft write on chat w1's twin w2 raises (mark_failed path)
create function public.r5_test_boom() returns trigger language plpgsql as $$
begin
  if new.id::text = current_setting('t.boom', true) and new.structured_draft is distinct from old.structured_draft then
    raise exception 'boom';
  end if;
  return new;
end;
$$;
create trigger r5_test_boom before update on public.writing_chats for each row execute function public.r5_test_boom();

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.s', public.save_project_page(current_setting('t.p')::uuid,
  '{"result":"응답 시간이 줄었다","task":"리드","experience_type":"problem_solving","end_month":"2024-02","is_current":false,
    "learnings":"측정이 먼저다"}',
  '2026-01-02T00:00:00Z',
  jsonb_build_array(
    jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'result', 'rev', 1),
    jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'task', 'rev', 1),
    jsonb_build_object('writing_chat_id', current_setting('t.w2'), 'field', 'learnings', 'rev', 1),
    jsonb_build_object('writing_chat_id', current_setting('t.w3'), 'field', 'result', 'rev', 1),
    jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'situation', 'rev', 1),
    jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'is_current', 'rev', 1),
    jsonb_build_object('writing_chat_id', 'nope', 'field', 'result', 'rev', 1),
    '"x"'::jsonb,
    jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'experience_type', 'rev', 1),
    jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'end_month', 'rev', 1)))::text, true);
select is(current_setting('t.s')::jsonb -> 'applied',
          jsonb_build_array(
            jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'result'),
            jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'experience_type'),
            jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'end_month')),
          'applied: request order');
select is(current_setting('t.s')::jsonb -> 'skipped',
          jsonb_build_array(
            jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'task', 'reason', 'needs_review'),
            jsonb_build_object('writing_chat_id', current_setting('t.w2'), 'field', 'learnings', 'reason', 'proposal_changed'),
            jsonb_build_object('writing_chat_id', current_setting('t.w3'), 'field', 'result', 'reason', 'not_found'),
            jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'situation', 'reason', 'not_found'),
            jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'is_current', 'reason', 'invalid_entry'),
            jsonb_build_object('writing_chat_id', 'nope', 'field', 'result', 'reason', 'invalid_entry'),
            jsonb_build_object('writing_chat_id', null, 'field', null, 'reason', 'invalid_entry')),
          'skipped: needs_review / proposal_changed / not this project''s chat / no field / bad entries');
select is((select (result, task, learnings, experience_type, end_month)::text from public.projects where id = current_setting('t.p')::uuid),
          '("응답 시간이 줄었다",리드,"측정이 먼저다",problem_solving,2024-02-01)',
          'the career values are saved whatever the records say (form values, not proposal values)');
select isnt(pg_temp.draft('t.w1') #>> '{star,result,applied_at}', null, 'result stamped applied_at');
select is(pg_temp.draft('t.w1') #>> '{star,task,applied_at}', null, 'needs_review task not stamped');
select is(pg_temp.draft('t.w1') #>> '{star,result,rev}', '1', 'recording does not change rev');
select isnt((select last_applied_at from public.writing_chats where id = current_setting('t.w1')::uuid), null,
            'chat last_applied_at set');
select is((select last_applied_at from public.writing_chats where id = current_setting('t.w2')::uuid), null,
          'chat with nothing recorded keeps last_applied_at null');
select is((select source_writing_chat_id::text from public.projects where id = current_setting('t.p')::uuid),
          current_setting('t.w1'), 'source_writing_chat_id = the chat of the last recorded element');

-- already_applied, and mark_failed never blocks the save
reset role;
select set_config('t.boom', current_setting('t.w2'), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.s2', public.save_project_page(current_setting('t.p')::uuid, '{"learnings":"측정이 먼저다\n그리고 공유"}', null,
  jsonb_build_array(
    jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'result', 'rev', 1),
    jsonb_build_object('writing_chat_id', current_setting('t.w2'), 'field', 'learnings', 'rev', 2)))::text, true);
select is(current_setting('t.s2')::jsonb -> 'skipped',
          jsonb_build_array(
            jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'result', 'reason', 'already_applied'),
            jsonb_build_object('writing_chat_id', current_setting('t.w2'), 'field', 'learnings', 'reason', 'mark_failed')),
          'already_applied (another tab) and mark_failed are reported');
select is((select learnings from public.projects where id = current_setting('t.p')::uuid), E'측정이 먼저다\n그리고 공유',
          'a failed record does not block the save');
select is(pg_temp.draft('t.w2') #>> '{star,learnings,applied_at}', null, 'the failed record left the chat untouched');
reset role;
select set_config('t.boom', '', true);

-- source-only change keeps updated_at; deleting the chat (FK set null) too
select set_config('t.before', (select updated_at::text from public.projects where id = current_setting('t.p')::uuid), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.save_project_page(current_setting('t.p')::uuid, '{}', current_setting('t.before')::timestamptz,
  jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.w2'), 'field', 'learnings', 'rev', 2))) -> 'applied',
          jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.w2'), 'field', 'learnings')),
          'record-only save (no value change)');
select is((select (source_writing_chat_id::text, updated_at::text) from public.projects where id = current_setting('t.p')::uuid)::text,
          (current_setting('t.w2'), current_setting('t.before'))::text,
          'source_writing_chat_id moved, updated_at kept (DM §2.3 v4.5)');
select lives_ok($$delete from public.writing_chats where id = current_setting('t.w2')::uuid$$, 'delete the source chat');
select is((select (source_writing_chat_id is null, updated_at::text) from public.projects where id = current_setting('t.p')::uuid)::text,
          (true, current_setting('t.before'))::text, 'FK set null keeps updated_at (no stale_write for an open page)');
reset role;

-- ════════ save_project_deliverable ════════
insert into public.projects (id, user_id, name) values
  ('aaaaaaaa-3333-0000-0000-000000000010', 'aaaaaaaa-0000-0000-0000-000000000001', 'A standalone 2');
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.save_project_deliverable(null, 'aaaaaaaa-3333-0000-0000-000000000009', ' ', '')$$,
                 'P0001', 'deliverable_title_required', 'blank title');
select throws_ok($$select public.save_project_deliverable(null, 'aaaaaaaa-3333-0000-0000-000000000009', null, '')$$,
                 'P0001', 'deliverable_title_required', 'null title');
select is(pg_temp.err_detail($$select public.save_project_deliverable(null, 'aaaaaaaa-3333-0000-0000-000000000009', repeat('가', 101), '')$$),
          'title', 'title over 100 -> field_too_long(title)');
select is(pg_temp.err_detail($$select public.save_project_deliverable(null, 'aaaaaaaa-3333-0000-0000-000000000009', 't', repeat('가', 20001))$$),
          'body', 'body over 20,000 -> field_too_long(body)');
select throws_ok($$select public.save_project_deliverable(null, null, 't', '')$$, 'P0001', 'not_found', 'create needs a project');
select throws_ok($$select public.save_project_deliverable(null, 'bbbbbbbb-3333-0000-0000-000000000009', 't', '')$$,
                 'P0001', 'not_found', 'create under B''s project');
select throws_ok($$select public.save_project_deliverable(null, current_setting('t.p')::uuid, 't', '')$$,
                 'P0001', 'deliverable_requires_standalone_project', 'create under an affiliated project');
select lives_ok($$select set_config('t.dc', public.save_project_deliverable(null, 'aaaaaaaa-3333-0000-0000-000000000009',
                   ' 결제 회고 ', null)::text, true)$$, 'create a deliverable (null body = empty)');
select set_config('t.d', current_setting('t.dc')::jsonb ->> 'project_deliverable_id', true);
select is(current_setting('t.dc')::jsonb - array['project_deliverable_id', 'updated_at'],
          '{"project_id": "aaaaaaaa-3333-0000-0000-000000000009", "sort_order": 1, "applied": [], "skipped": []}'::jsonb,
          'create return shape (sort_order last)');
select is((select (title, body)::text from public.project_deliverables where id = current_setting('t.d')::uuid),
          '("결제 회고","")', 'stored trimmed title, empty body');
select is(public.save_project_deliverable(null, 'aaaaaaaa-3333-0000-0000-000000000009', '두 번째', '') ->> 'sort_order', '2',
          'next one goes last');
select throws_ok($$select public.save_project_deliverable(gen_random_uuid(), null, 't', '')$$, 'P0001', 'not_found', 'unknown id');
select throws_ok($$select public.save_project_deliverable(current_setting('t.d')::uuid, 'aaaaaaaa-3333-0000-0000-000000000010', 't', '')$$,
                 'P0001', 'not_found', 'cannot move to another project');
reset role;
alter table public.project_deliverables disable trigger project_deliverables_set_updated_at;
update public.project_deliverables set updated_at = '2026-01-01T00:00:00Z' where id = current_setting('t.d')::uuid;
alter table public.project_deliverables enable trigger project_deliverables_set_updated_at;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.save_project_deliverable(current_setting('t.d')::uuid, null, 't', 'b', '2026-03-01T00:00:00Z')$$,
                 'P0001', 'stale_write', 'deliverable stale_write');
select is(public.save_project_deliverable(current_setting('t.d')::uuid, 'aaaaaaaa-3333-0000-0000-000000000009', '결제 회고', '',
                                          '2026-01-01T00:00:00Z') ->> 'updated_at',
          '2026-01-01T00:00:00+00:00', 'unchanged deliverable save keeps updated_at');

-- deliverable chats + records
select set_config('t.dw1', public.start_deliverable_writing_chat(current_setting('t.d')::uuid)::text, true);
select set_config('t.dw2', public.start_deliverable_writing_chat(current_setting('t.d')::uuid)::text, true);
select set_config('t.dm1', (select message_id::text from public.append_writing_chat_message(current_setting('t.dw1')::uuid,
  '런북은 제가 썼어요')), true);
select set_config('t.dm2', (select message_id::text from public.append_writing_chat_message(current_setting('t.dw2')::uuid,
  '알림이 줄었어요')), true);
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.dw1')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'add_facts', 'facts', jsonb_build_array(jsonb_build_object('id', 'aaaaaaaa-6666-0000-0000-000000000001',
    'slot', 'contribution', 'text', '런북을 썼다', 'actor', 'self', 'source_message_ids', jsonb_build_array(current_setting('t.dm1'))))),
  jsonb_build_object('op', 'replace_draft', 'body', jsonb_build_object('blocks', jsonb_build_array(
    jsonb_build_object('block_id', 'b1', 'type', 'heading', 'text', '맡은 일'),
    jsonb_build_object('block_id', 'b2', 'type', 'paragraph', 'text', '런북을 썼다.',
                       'source_fact_ids', '["aaaaaaaa-6666-0000-0000-000000000001"]'::jsonb),
    jsonb_build_object('block_id', 'b3', 'type', 'paragraph', 'text', '팀 성과.', 'review', 'needs_review',
                       'source_fact_ids', '["aaaaaaaa-6666-0000-0000-000000000001"]'::jsonb)))))))$$, 'dw1 draft');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.dw2')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'add_facts', 'facts', jsonb_build_array(jsonb_build_object('id', 'aaaaaaaa-6666-0000-0000-000000000002',
    'slot', 'went_well', 'text', '알림이 줄었다', 'actor', 'team', 'source_message_ids', jsonb_build_array(current_setting('t.dm2'))))),
  jsonb_build_object('op', 'replace_draft', 'body', jsonb_build_object('blocks', jsonb_build_array(
    jsonb_build_object('block_id', 'b1', 'type', 'heading', 'text', '결과'),
    jsonb_build_object('block_id', 'b2', 'type', 'paragraph', 'text', '알림이 줄었다.', 'review', 'needs_review',
                       'source_fact_ids', '["aaaaaaaa-6666-0000-0000-000000000002"]'::jsonb)))))))$$,
  'dw2 draft with only a needs_review content block');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.ds', public.save_project_deliverable(current_setting('t.d')::uuid, null, '결제 회고',
  E'## 맡은 일\n\n런북을 썼다.', null,
  jsonb_build_array(
    jsonb_build_object('writing_chat_id', current_setting('t.dw1'), 'rev', 1, 'mode', 'replace'),
    jsonb_build_object('writing_chat_id', current_setting('t.dw2'), 'rev', 1, 'mode', 'append'),
    jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'rev', 1, 'mode', 'append'),
    jsonb_build_object('writing_chat_id', current_setting('t.dw1'), 'rev', 1, 'mode', 'overwrite'),
    jsonb_build_object('writing_chat_id', current_setting('t.dw1'), 'rev', 1)))::text, true);
select is(current_setting('t.ds')::jsonb -> 'applied',
          jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.dw1'))),
          'deliverable: one record applied (unaccepted needs_review block does not skip it)');
select is(current_setting('t.ds')::jsonb -> 'skipped',
          jsonb_build_array(
            jsonb_build_object('writing_chat_id', current_setting('t.dw2'), 'reason', 'needs_review'),
            jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'reason', 'not_found'),
            jsonb_build_object('writing_chat_id', current_setting('t.dw1'), 'reason', 'invalid_entry'),
            jsonb_build_object('writing_chat_id', current_setting('t.dw1'), 'reason', 'invalid_entry')),
          'deliverable skipped: no fillable block / STAR chat / bad mode / no mode');
select is((pg_temp.draft('t.dw1') #> '{deliverable,body}') - array['value', 'blocks', 'generated_at', 'applied_at',
                                                                 'base_body_hash', 'replace_allowed', 'missing_slots',
                                                                 'dropped_block_count'],
          '{"rev": 1, "applied_mode": "replace", "applied_rev": 1}'::jsonb, 'applied_mode / applied_rev recorded');
select isnt(pg_temp.draft('t.dw1') #>> '{deliverable,body,applied_at}', null, 'applied_at recorded');
select is((select body from public.project_deliverables where id = current_setting('t.d')::uuid),
          E'## 맡은 일\n\n런북을 썼다.', 'deliverable body saved');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dw1')::uuid,
                   '{"ops":[{"op":"accept_block","block_id":"b3"}]}')$$,
                 'P0001', 'field_already_applied', 'leftover needs_review block after apply: field_already_applied');
reset role;
-- a new AI draft after apply is a fresh, unapplied proposal with the next rev
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.dw1')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'replace_draft', 'body', jsonb_build_object('blocks', jsonb_build_array(
    jsonb_build_object('block_id', 'c1', 'type', 'paragraph', 'text', '다시 쓴 초안.',
                       'source_fact_ids', '["aaaaaaaa-6666-0000-0000-000000000001"]'::jsonb)))))))$$, 'new draft after apply');
select is((pg_temp.draft('t.dw1') #> '{deliverable,body}') - array['value', 'blocks', 'generated_at', 'base_body_hash',
                                                                 'replace_allowed', 'missing_slots', 'dropped_block_count'],
          '{"rev": 2, "applied_at": null, "applied_mode": null, "applied_rev": null}'::jsonb,
          'new draft: rev 2, applied_* cleared');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.save_project_deliverable(current_setting('t.d')::uuid, null, '결제 회고', '다시 쓴 초안.', null,
            jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.dw1'), 'rev', 1, 'mode', 'replace'))) -> 'skipped',
          jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.dw1'), 'reason', 'proposal_changed')),
          'a fill of the old draft (rev 1) is proposal_changed; the save still succeeds');
select is((select body from public.project_deliverables where id = current_setting('t.d')::uuid), '다시 쓴 초안.', 'saved');
-- deleting a deliverable chat keeps the deliverable updated_at
select set_config('t.dbefore', (select updated_at::text from public.project_deliverables where id = current_setting('t.d')::uuid), true);
select lives_ok($$delete from public.writing_chats where id = current_setting('t.dw2')::uuid$$, 'delete a deliverable chat');
select is((select updated_at::text from public.project_deliverables where id = current_setting('t.d')::uuid),
          current_setting('t.dbefore'), 'deliverable updated_at unchanged');
reset role;

-- QA-R5-01: B cannot update A's deliverable, nor record A's chat through B's own save
insert into public.project_deliverables (id, user_id, project_id, title) values
  ('bbbbbbbb-4444-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-3333-0000-0000-000000000009', 'B 산출물');
-- give A's chat dw1 a fresh unapplied draft so a stray record would show
select set_config('t.abefore', pg_temp.draft('t.dw1')::text, true);
select set_config('t.atitle', (select title || '|' || body from public.project_deliverables where id = current_setting('t.d')::uuid), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.save_project_deliverable(current_setting('t.d')::uuid, null, 'B가 고침', 'x')$$,
                 'P0001', 'not_found', 'B cannot update A''s deliverable');
select throws_ok($$select public.save_project_deliverable(null, 'aaaaaaaa-3333-0000-0000-000000000009', 'B가 만듦', 'x')$$,
                 'P0001', 'not_found', 'B cannot create under A''s project');
select is(public.save_project_deliverable('bbbbbbbb-4444-0000-0000-000000000001', null, 'B 산출물', 'b', null,
            jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.dw1'), 'rev', 2, 'mode', 'replace'))) -> 'skipped',
          jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.dw1'), 'reason', 'not_found')),
          'B passing A''s deliverable chat -> skipped not_found');
select is(public.save_project_page(null, '{"name":"B 프로젝트","experience_id":"bbbbbbbb-1111-0000-0000-000000000001"}', null,
            jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'end_month', 'rev', 1))) -> 'skipped',
          jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.w1'), 'field', 'end_month', 'reason', 'not_found')),
          'B passing A''s STAR chat -> skipped not_found');
reset role;
select is(pg_temp.draft('t.dw1')::text, current_setting('t.abefore'), 'A''s chat draft untouched by B');
select is((select title || '|' || body from public.project_deliverables where id = current_setting('t.d')::uuid),
          current_setting('t.atitle'), 'A''s deliverable untouched by B');

-- deliverable limit through the RPC
insert into public.project_deliverables (user_id, project_id, title)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000010', 'd' || g from generate_series(1, 50) g;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.save_project_deliverable(null, 'aaaaaaaa-3333-0000-0000-000000000010', '51번째', '')$$,
                 'P0001', 'deliverable_limit_reached', '50 per project');
select throws_ok($$select public.save_project_deliverable(null, 'aaaaaaaa-3333-0000-0000-000000000009', 't', '', null, '{"a":1}')$$,
                 'P0001', 'invalid_fields', 'p_applied_proposals must be an array');
reset role;

select * from finish();
rollback;
