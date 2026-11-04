-- R9 (UP-6, DM v4.10 11.5 #1 (b)): classification proposals on the project page.
-- (a) [반영] overwrite: save_project_page records a classification proposal as applied even when the projects row
--     already has a value for that classification (the value is replaced).
-- (b) [무시]: the user `set` null on a pending classification slot keeps the slot as
--     {value: null, origin: 'ai', review: 'ok', rev + 1}. A later AI classification patch on that slot is still
--     accepted by the RPC today (documented here); the server pipeline (V-9i, R9 ☆3) drops it before the RPC.
--     Also fixed here: the AI cannot write null into a classification slot, so "value null with rev >= 2" can only
--     come from the user's clear (the ☆3 judgment relies on that).
-- No schema change in R9: these tests pin current RPC behavior.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('dddddddd-0000-0000-0000-000000000001', 'd@example.test', 'authenticated', 'authenticated');
insert into public.experiences (id, user_id, company_name) values
  ('dddddddd-1111-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'D사');
-- Classification already saved on the row: project_type, experience_type and competencies all have values.
insert into public.projects (id, user_id, experience_id, name, project_type, experience_type, competencies, situation) values
  ('dddddddd-3333-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   'dddddddd-1111-0000-0000-000000000001', 'D project', 'improvement', 'impact', '{analysis}', '배포가 느렸음');

set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.chat', public.start_writing_chat('dddddddd-3333-0000-0000-000000000001')::text, true);
select set_config('t.m', (select message_id::text from public.append_writing_chat_message(current_setting('t.chat')::uuid,
  '새 배포 시스템을 처음부터 만들었고 팀을 이끌었어요')), true);
reset role;

create function pg_temp.draft() returns jsonb language sql as
  $$ select structured_draft from public.writing_chats where id = current_setting('t.chat')::uuid $$;
create function pg_temp.ai_class(p_field text, p_value jsonb) returns jsonb language sql as $$
  select public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
    jsonb_build_object('op', 'set', 'target', jsonb_build_object('section', 'classification', 'field', p_field),
                       'value', p_value, 'reason', '대화 내용 기준',
                       'source_message_ids', jsonb_build_array(current_setting('t.m'))))))
$$;
create function pg_temp.user_clear(p_field text) returns jsonb language sql as $$
  select public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
    jsonb_build_object('op', 'set', 'target', jsonb_build_object('section', 'classification', 'field', p_field),
                       'value', null))))
$$;
grant execute on function pg_temp.draft() to authenticated, app_ai_writer;
grant execute on function pg_temp.ai_class(text, jsonb) to app_ai_writer;
grant execute on function pg_temp.user_clear(text) to authenticated;

-- ── AI classification proposals on a row whose classification is already filled ──
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(pg_temp.ai_class('project_type', '"new_build"') -> 'rejected', '[]'::jsonb,
          'AI project_type proposal accepted although the row already has project_type (empty-only is the app''s check)');
select is(pg_temp.ai_class('competencies', '["planning", "leadership"]') -> 'rejected', '[]'::jsonb,
          'AI competencies proposal accepted on a filled row');
select is(pg_temp.ai_class('experience_type', '"leadership"') -> 'rejected', '[]'::jsonb,
          'AI experience_type proposal accepted on a filled row');
-- The AI cannot write null into a classification slot (wc_classification_value -> invalid_value).
select is(pg_temp.ai_class('experience_type', 'null') -> 'rejected',
          '[{"index": 0, "op": "set", "reason": "invalid_value"}]'::jsonb,
          'AI null on a classification slot is rejected (invalid_value) — null slots come only from the user');
select is(pg_temp.draft() #>> '{classification,experience_type,value}', 'leadership', 'rejected AI null left the slot as is');
select is(pg_temp.draft() #>> '{classification,project_type,rev}', '1', 'project_type proposal rev 1');
reset role;

-- ════════ (a) [반영] overwrite: recorded as applied, row value replaced ════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.save', public.save_project_page('dddddddd-3333-0000-0000-000000000001',
  '{"project_type": "new_build", "competencies": ["planning", "leadership"]}'::jsonb, null,
  jsonb_build_array(
    jsonb_build_object('writing_chat_id', current_setting('t.chat'), 'field', 'project_type', 'rev', 1),
    jsonb_build_object('writing_chat_id', current_setting('t.chat'), 'field', 'competencies', 'rev', 1)))::text, true);
select is(current_setting('t.save')::jsonb -> 'applied',
          jsonb_build_array(
            jsonb_build_object('writing_chat_id', current_setting('t.chat'), 'field', 'project_type'),
            jsonb_build_object('writing_chat_id', current_setting('t.chat'), 'field', 'competencies')),
          '(a) classification proposals over existing DB values are recorded as applied');
select is(current_setting('t.save')::jsonb -> 'skipped', '[]'::jsonb, '(a) nothing skipped');
select is((select (project_type, competencies)::text from public.projects
            where id = 'dddddddd-3333-0000-0000-000000000001'),
          '(new_build,"{planning,leadership}")', '(a) row classification replaced (improvement -> new_build, analysis -> planning,leadership)');
select isnt(pg_temp.draft() #>> '{classification,project_type,applied_at}', null, '(a) project_type applied_at recorded');
select isnt(pg_temp.draft() #>> '{classification,competencies,applied_at}', null, '(a) competencies applied_at recorded');
select is(pg_temp.draft() #>> '{classification,project_type,rev}', '1', '(a) recording does not change rev');
select is((select source_writing_chat_id from public.projects where id = 'dddddddd-3333-0000-0000-000000000001'),
          current_setting('t.chat')::uuid, '(a) source_writing_chat_id = the recording chat');
-- An applied classification slot cannot be cleared ([무시] applies to pending proposals only).
select throws_ok($$select pg_temp.user_clear('project_type')$$, 'P0001', 'field_already_applied',
                 'user clear on an applied classification slot -> field_already_applied');

-- ════════ (b) [무시]: user `set` null on a pending classification slot ════════
select is(pg_temp.user_clear('experience_type') -> 'rejected', '[]'::jsonb, '(b) user clear accepted');
select is((pg_temp.draft() #> '{classification,experience_type}') - 'reviewed_at',
          '{"value": null, "origin": "ai", "source_message_ids": [], "reason": null, "review": "ok",
            "applied_at": null, "rev": 2}'::jsonb,
          '(b) slot kept: value null, origin ai, review ok, reason null, sources emptied, rev + 1');
select isnt(pg_temp.draft() #>> '{classification,experience_type,reviewed_at}', null, '(b) reviewed_at set on clear');
select is((select experience_type from public.projects where id = 'dddddddd-3333-0000-0000-000000000001'),
          'impact', '(b) clearing the proposal does not touch the saved row value');
-- A cleared slot has nothing to record: save skips it as not_found.
select is(public.save_project_page('dddddddd-3333-0000-0000-000000000001', '{}'::jsonb, null,
            jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.chat'),
                                                 'field', 'experience_type', 'rev', 2))) -> 'skipped',
          jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.chat'), 'field', 'experience_type',
                                               'reason', 'not_found')),
          '(b) recording a cleared slot is skipped (not_found)');
reset role;
-- Clearing a slot that never had a proposal is a no-op: no slot object is created.
update public.writing_chats set structured_draft = structured_draft #- '{classification,competencies}'
 where id = current_setting('t.chat')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}';
select is(pg_temp.user_clear('competencies') -> 'rejected', '[]'::jsonb, 'user clear on a missing slot accepted');
select is(coalesce(pg_temp.draft() #> '{classification,competencies}', 'null'::jsonb), 'null'::jsonb,
          'missing slot stays absent/null after a clear (no {value:null} object, so no "dismissed" mark)');
-- A second clear on an already-cleared slot bumps rev again (rev never goes back).
select is(pg_temp.user_clear('experience_type') -> 'rejected', '[]'::jsonb, 'second clear accepted');
select is(pg_temp.draft() #>> '{classification,experience_type,rev}', '3', 'second clear: rev + 1 again');
reset role;

-- ── (b) later AI classification patch on the dismissed slot: what the RPC does today ──
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(pg_temp.ai_class('experience_type', '"collaboration"') -> 'rejected', '[]'::jsonb,
          '(b) RPC today ACCEPTS an AI proposal on a dismissed slot (not protected); V-9i in the pipeline drops it');
select is((pg_temp.draft() #> '{classification,experience_type}') - 'source_message_ids',
          '{"value": "collaboration", "origin": "ai", "reason": "대화 내용 기준", "review": "ok",
            "reviewed_at": null, "applied_at": null, "rev": 4}'::jsonb,
          '(b) the dismissed slot is overwritten by the new AI proposal, rev + 1 (dismissed mark lost)');
reset role;

select * from finish();
rollback;
