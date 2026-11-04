-- R9 (UP-6, DM v4.10 11.5 #1 (b)): classification proposals on the project page.
-- (a) [반영] overwrite: save_project_page records a classification proposal as applied even when the projects row
--     already has a value for that classification (the value is replaced).
-- (b) [무시]: the user `set` null on a pending classification slot keeps the slot as
--     {value: null, origin: 'ai', review: 'ok', rev + 1}. Also fixed here: the AI cannot write null into a
--     classification slot, so "value null with rev >= 2" can only come from the user's clear.
-- R10 (R9 QA-05, DM 11.5 #1 (a), 20261113000400): a later AI classification patch on a dismissed slot is rejected
--     by the RPC ('classification_dismissed', non-fatal), so a [무시] during a running turn (the pipeline's V-9i
--     reads the draft at turn start) can no longer be undone by that turn's suggestion.
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

-- ════════ R10: AI classification patch on a dismissed slot is rejected (classification_dismissed) ════════
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(pg_temp.ai_class('experience_type', '"collaboration"') -> 'rejected',
          '[{"index": 0, "op": "set", "reason": "classification_dismissed"}]'::jsonb,
          'R10: AI proposal on a dismissed slot -> rejected classification_dismissed (no exception)');
select is((pg_temp.draft() #> '{classification,experience_type}') - 'reviewed_at',
          '{"value": null, "origin": "ai", "source_message_ids": [], "reason": null, "review": "ok",
            "applied_at": null, "rev": 3}'::jsonb,
          'R10: dismissed slot left as is (value null, rev 3)');
-- An AI null on a dismissed slot is also refused, by the dismiss guard first.
select is(pg_temp.ai_class('experience_type', 'null') -> 'rejected',
          '[{"index": 0, "op": "set", "reason": "classification_dismissed"}]'::jsonb,
          'R10: AI null on a dismissed slot -> classification_dismissed');

-- ── R10 race (R9 QA-05): turn N proposes, the user dismisses while turn N+1 runs, turn N+1's patch lands ──
-- Turn N: competencies slot (absent) gets a pending proposal, rev 1. Only the dismissed op of a mixed patch is refused.
select is(public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
            jsonb_build_object('op', 'set', 'target', jsonb_build_object('section', 'classification', 'field', 'competencies'),
                               'value', '["planning"]'::jsonb, 'source_message_ids', jsonb_build_array(current_setting('t.m'))),
            jsonb_build_object('op', 'set', 'target', jsonb_build_object('section', 'classification', 'field', 'experience_type'),
                               'value', 'leadership')))) -> 'rejected',
          '[{"index": 1, "op": "set", "reason": "classification_dismissed"}]'::jsonb,
          'R10 mixed patch: only the op on the dismissed slot is rejected');
select is(pg_temp.draft() #> '{classification,competencies,value}', '["planning"]'::jsonb,
          'R10 mixed patch: the other classification op is applied');
select is(pg_temp.draft() #>> '{classification,competencies,rev}', '1', 'R10 race: turn N proposal rev 1');
-- A rev-1 slot with a value is a live proposal, not dismissed: the AI may replace it.
select is(pg_temp.ai_class('competencies', '["planning", "execution"]') -> 'rejected', '[]'::jsonb,
          'R10: AI may replace its own pending proposal (rev 1 -> 2)');
reset role;
-- User [무시] while turn N+1 is running (its V-9 context still shows the proposal).
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}';
select is(pg_temp.user_clear('competencies') -> 'rejected', '[]'::jsonb, 'R10 race: user [무시] mid-turn accepted');
select is(pg_temp.draft() #>> '{classification,competencies,rev}', '3', 'R10 race: dismissed at rev 3');
reset role;
-- Turn N+1's patch (built from the pre-[무시] draft) reaches the RPC.
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(pg_temp.ai_class('competencies', '["planning", "leadership"]') -> 'rejected',
          '[{"index": 0, "op": "set", "reason": "classification_dismissed"}]'::jsonb,
          'R10 race: the running turn''s proposal is rejected (classification_dismissed)');
select is(pg_temp.draft() #> '{classification,competencies,value}', 'null'::jsonb, 'R10 race: slot stays dismissed (value null)');
select is(pg_temp.draft() #>> '{classification,competencies,rev}', '3', 'R10 race: rev unchanged by the rejected patch');
reset role;

-- ── R10 edges ──
-- An empty object with rev 1 is not a dismissal (cannot come from the RPC; legacy/odd data): the AI may fill it.
update public.writing_chats
   set structured_draft = jsonb_set(structured_draft, '{classification,project_type}',
         '{"value": null, "origin": "ai", "source_message_ids": [], "reason": null, "review": "ok",
           "reviewed_at": null, "applied_at": null, "rev": 1}'::jsonb)
 where id = current_setting('t.chat')::uuid;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(pg_temp.ai_class('project_type', '"improvement"') -> 'rejected', '[]'::jsonb,
          'R10: empty slot with rev 1 is not dismissed -> AI proposal accepted');
select is(pg_temp.draft() #>> '{classification,project_type,rev}', '2', 'R10: rev 1 empty slot -> rev 2 proposal');
reset role;
-- The user may still pick a value on a dismissed slot; it is then a user edit, protected from the AI.
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
            jsonb_build_object('op', 'set', 'target', jsonb_build_object('section', 'classification', 'field', 'experience_type'),
                               'value', 'collaboration')))) -> 'rejected', '[]'::jsonb,
          'R10: user picks a value on a dismissed slot (accepted)');
select is(pg_temp.draft() #>> '{classification,experience_type,origin}', 'user_edit', 'R10: picked value is a user edit');
select is(pg_temp.draft() #>> '{classification,experience_type,rev}', '4', 'R10: user pick rev + 1');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(pg_temp.ai_class('experience_type', '"impact"') -> 'rejected',
          '[{"index": 0, "op": "set", "reason": "protected_field"}]'::jsonb,
          'R10: AI on the user-picked slot -> protected_field (not a dismissal)');
reset role;

select * from finish();
rollback;
