-- S4 save_writing_chat / hand_off_writing_chat (DM §2.5 쓰는 값 규칙, §3.3) and writing chat deletion
-- (DM §3.4, §4.1, §4.2: chat-only deletion keeps career rows, project deletion cascades chats).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

insert into public.experiences (id, user_id, company_name, start_month, job_rank) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'ABC Pay', '2020-01-01', 'S');
-- Existing manual skill written differently: linked by normalized_name.
insert into public.skills (id, user_id, name, is_manual) values
  ('aaaaaaaa-6666-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Kafka', true);
-- Augment target P: role / summary empty, team_size filled; detail D: action / result empty.
insert into public.projects (id, user_id, name, team_size) values
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Old', 3);
insert into public.project_details (id, user_id, project_id, title, situation, sort_order) values
  ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000001',
   'Ep', 'S filled', 1);

create function pg_temp.src(p text) returns jsonb language sql as $$ select jsonb_build_array(current_setting(p)) $$;
grant execute on function pg_temp.src(text) to authenticated, app_ai_writer;
create function pg_temp.f(p_field text, p_value jsonb, p_src text, p_review text default 'ok') returns jsonb language sql as $$
  select jsonb_build_object('op', 'set', 'target', '{"section":"project"}'::jsonb || jsonb_build_object('field', p_field),
                            'value', p_value, 'source_message_ids', pg_temp.src(p_src), 'review', p_review) $$;
grant execute on function pg_temp.f(text, jsonb, text, text) to authenticated, app_ai_writer;
create function pg_temp.d(p_loc jsonb, p_field text, p_value jsonb, p_src text, p_review text default 'ok') returns jsonb language sql as $$
  select jsonb_build_object('op', 'set', 'target', jsonb_build_object('section', 'detail', 'field', p_field) || p_loc,
                            'value', p_value, 'source_message_ids', pg_temp.src(p_src), 'review', p_review) $$;
grant execute on function pg_temp.d(jsonb, text, jsonb, text, text) to authenticated, app_ai_writer;

-- ── new_project chat N ─────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.n', public.start_writing_chat('new_project')::text, true);
select set_config('t.nm', (select message_id::text from public.append_writing_chat_message(current_setting('t.n')::uuid,
  '결제 프로젝트, 백엔드 리드, 23년 3월~12월, 4명, kafka와 Redis')), true);
select lives_ok($$select public.set_writing_chat_affiliation(current_setting('t.n')::uuid, 'aaaaaaaa-1111-0000-0000-000000000001')$$,
                'affiliation confirmed (column)');
reset role;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.apply_structured_draft_patch(current_setting('t.n')::uuid, jsonb_build_object('ops', jsonb_build_array(
  pg_temp.f('name', '"결제 프로젝트"', 't.nm', 'needs_review'),
  pg_temp.f('role', '"백엔드 리드"', 't.nm'),
  pg_temp.f('summary', '"요약"', 't.nm', 'needs_review'),
  pg_temp.f('start_month', '"2023-03"', 't.nm'),
  pg_temp.f('end_month', '"2023-12"', 't.nm'),
  pg_temp.f('team_size', '4', 't.nm'),
  '{"op":"new_detail","detail_key":"D1"}'::jsonb,
  pg_temp.d('{"detail_key":"D1"}', 'title', '"결제 승인 개선"', 't.nm'),
  pg_temp.d('{"detail_key":"D1"}', 'situation', '"느렸다"', 't.nm'),
  pg_temp.d('{"detail_key":"D1"}', 'action', '"인덱스 재설계"', 't.nm'),
  pg_temp.d('{"detail_key":"D1"}', 'result', '"빨라졌다"', 't.nm', 'needs_review'),
  jsonb_build_object('op', 'add_achievement', 'detail', '{"detail_key":"D1"}'::jsonb, 'fields', jsonb_build_object(
    'metric_name', jsonb_build_object('value', '응답 시간', 'source_message_ids', pg_temp.src('t.nm')),
    'value_after', jsonb_build_object('value', 0.7, 'source_message_ids', pg_temp.src('t.nm')),
    'unit', jsonb_build_object('value', '초', 'source_message_ids', pg_temp.src('t.nm'), 'review', 'needs_review'))),
  '{"op":"new_detail","detail_key":"D2"}'::jsonb,
  pg_temp.d('{"detail_key":"D2"}', 'learnings', '"배움"', 't.nm', 'needs_review'),
  jsonb_build_object('op', 'add_skill', 'value', 'kafka', 'source_message_ids', pg_temp.src('t.nm')),
  jsonb_build_object('op', 'add_skill', 'value', 'Redis', 'source_message_ids', pg_temp.src('t.nm'))
))) -> 'rejected', '[]'::jsonb, 'AI patch for N applied');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.n')::uuid,
                  '{"ops":[{"op":"accept","target":{"section":"project","field":"name"}}]}')$$, 'user accepts the name');
select is((select count(*)::int from public.projects), 1, 'nothing written to career tables before save');

select set_config('t.save', public.save_writing_chat(current_setting('t.n')::uuid)::text, true);
select is(current_setting('t.save')::jsonb - 'project_id' - 'writing_chat_id',
  '{"status":"saved","project":{"created":true,"updated":false},
    "project_details":{"created":1,"updated":0,"missing":0},"achievements":{"created":1},
    "skills":{"created":1,"linked":2},"skipped_needs_review":4}'::jsonb,
  'save result: needs_review fields skipped (summary, result, unit, D2 learnings), empty D2 not created');
select set_config('t.np', current_setting('t.save')::jsonb ->> 'project_id', true);

select is((select (name, role, summary, start_month, end_month, team_size, experience_id, education_id,
                   source_writing_chat_id = current_setting('t.n')::uuid, status)::text
             from public.projects where id = current_setting('t.np')::uuid),
          '("결제 프로젝트","백엔드 리드",,2023-03-01,2023-12-01,4,aaaaaaaa-1111-0000-0000-000000000001,,t,complete)',
          'project: accepted + ok values, months as dates, affiliation from the chat column, source, complete');
select is((select (title, situation, action, result, task, learnings, sort_order,
                   source_writing_chat_id = current_setting('t.n')::uuid, status)::text
             from public.project_details where project_id = current_setting('t.np')::uuid),
          '("결제 승인 개선",느렸다,"인덱스 재설계",,,,1,t,complete)', 'detail written, needs_review result skipped');
select is((select (a.metric_name, a.value_before, a.value_after, a.unit, a.description, a.source_writing_chat_id = current_setting('t.n')::uuid)::text
             from public.achievements a join public.project_details d on d.id = a.project_detail_id
            where d.project_id = current_setting('t.np')::uuid),
          '("응답 시간",,0.7,,,t)', 'achievement written, needs_review unit skipped');
select set_eq($$select s.name || ':' || s.is_manual from public.project_skills ps join public.skills s on s.id = ps.skill_id
                 where ps.project_id = current_setting('t.np')::uuid$$,
              array['Kafka:true', 'Redis:false'],
              'skills: kafka linked to the existing Kafka by normalized_name; Redis created as a tag skill');
select is((select (status, project_id = current_setting('t.np')::uuid, saved_at is not null)::text
             from public.writing_chats where id = current_setting('t.n')::uuid),
          '(saved,t,t)', 'chat saved with project_id and saved_at');

select throws_ok($$select public.save_writing_chat(current_setting('t.n')::uuid)$$, 'P0001', 'writing_chat_not_active',
                 'second save refused');
select throws_ok($$select public.hand_off_writing_chat(current_setting('t.n')::uuid)$$, 'P0001', 'writing_chat_not_active',
                 'hand-off after save refused');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.n')::uuid,
                   '{"ops":[{"op":"new_detail","detail_key":"D3"}]}')$$, 'P0001', 'writing_chat_not_active',
                 'saved chat is read-only');
select throws_ok($$update public.writing_chats set status = 'active' where id = current_setting('t.n')::uuid$$,
                 'P0001', 'invalid_writing_chat_transition', 'saved is final');
select throws_ok($$update public.writing_chats set status = 'abandoned' where id = current_setting('t.n')::uuid$$,
                 'P0001', 'invalid_writing_chat_transition', 'saved cannot be abandoned');

-- ── augment chat G on P ────────────────────────────────────────────────────
select set_config('t.g', public.start_writing_chat('augment_project', 'aaaaaaaa-3333-0000-0000-000000000001')::text, true);
select set_config('t.gm', (select message_id::text from public.append_writing_chat_message(current_setting('t.g')::uuid,
  '역할은 Dev, 팀은 9명, 인덱스를 고쳤고 알림이 줄었어요, 성과는 알림 수')), true);
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.apply_structured_draft_patch(current_setting('t.g')::uuid, jsonb_build_object('ops', jsonb_build_array(
  pg_temp.f('role', '"Dev"', 't.gm'),
  pg_temp.f('summary', '"요약 G"', 't.gm'),
  pg_temp.f('team_size', '9', 't.gm'),
  pg_temp.d('{"existing_detail_id":"aaaaaaaa-4444-0000-0000-000000000001"}', 'action', '"인덱스 수정"', 't.gm'),
  pg_temp.d('{"existing_detail_id":"aaaaaaaa-4444-0000-0000-000000000001"}', 'result', '"알림 감소"', 't.gm', 'needs_review'),
  jsonb_build_object('op', 'add_achievement', 'detail', '{"existing_detail_id":"aaaaaaaa-4444-0000-0000-000000000001"}'::jsonb,
    'fields', jsonb_build_object('metric_name', jsonb_build_object('value', '알림 수', 'source_message_ids', pg_temp.src('t.gm')))),
  '{"op":"new_detail","detail_key":"D1"}'::jsonb,
  pg_temp.d('{"detail_key":"D1"}', 'title', '"새 에피소드"', 't.gm'),
  jsonb_build_object('op', 'add_skill', 'value', 'Kafka', 'source_message_ids', pg_temp.src('t.gm'))
))) -> 'rejected', '[{"index":2,"op":"set","reason":"field_already_filled"}]'::jsonb, 'augment patch (team_size refused, V-9h)');
reset role;

-- The user fills P.role in the form after the patch: save must not overwrite it (save's own empty-only rule).
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
update public.projects set role = 'Form role' where id = 'aaaaaaaa-3333-0000-0000-000000000001';
select set_config('t.p_updated_at', (select updated_at::text from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'), true);

select set_config('t.hand', public.hand_off_writing_chat(current_setting('t.g')::uuid)::text, true);
select is(current_setting('t.hand')::jsonb - 'writing_chat_id',
  '{"status":"handed_off","project_id":"aaaaaaaa-3333-0000-0000-000000000001",
    "project":{"created":false,"updated":true},
    "project_details":{"created":1,"updated":1,"missing":0},"achievements":{"created":1},
    "skills":{"created":0,"linked":1},"skipped_needs_review":1}'::jsonb,
  'hand-off result (augment)');
select is((select (name, role, summary, team_size, experience_id, source_writing_chat_id = current_setting('t.g')::uuid)::text
             from public.projects where id = 'aaaaaaaa-3333-0000-0000-000000000001'),
          '(Old,"Form role","요약 G",3,,t)',
          'augment: only empty project columns filled (summary); form value and filled columns kept; affiliation unchanged');
select is((select (title, situation, action, result, source_writing_chat_id = current_setting('t.g')::uuid)::text
             from public.project_details where id = 'aaaaaaaa-4444-0000-0000-000000000001'),
          '(Ep,"S filled","인덱스 수정",,t)', 'existing detail: empty action filled, needs_review result skipped');
select is((select count(*)::int from public.achievements where project_detail_id = 'aaaaaaaa-4444-0000-0000-000000000001'), 1,
          'achievement inserted under the existing detail');
select is((select (title, status, sort_order)::text from public.project_details
            where project_id = 'aaaaaaaa-3333-0000-0000-000000000001' and id <> 'aaaaaaaa-4444-0000-0000-000000000001'),
          '("새 에피소드",draft,2)', 'new detail inserted as draft, appended to the order');
select is((select (status, saved_at is null, project_id)::text from public.writing_chats where id = current_setting('t.g')::uuid),
          '(handed_off,t,aaaaaaaa-3333-0000-0000-000000000001)', 'chat handed_off (no saved_at)');

-- ── invalid period: nothing written ────────────────────────────────────────
select set_config('t.bad', public.start_writing_chat('new_project')::text, true);
select set_config('t.badm', (select message_id::text from public.append_writing_chat_message(current_setting('t.bad')::uuid, '5월~1월')), true);
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.bad')::uuid,
                  '{"ops":[{"op":"set","target":{"section":"project","field":"start_month"},"value":"2023-05"},
                           {"op":"set","target":{"section":"project","field":"end_month"},"value":"2023-01"}]}')$$,
                'user sets a reversed period');
select set_config('t.count_before', (select count(*)::text from public.projects), true);
select throws_ok($$select public.save_writing_chat(current_setting('t.bad')::uuid)$$, 'P0001', 'invalid_period',
                 'end < start refused');
select is((select count(*)::text from public.projects), current_setting('t.count_before'), 'no project written');
select is((select status from public.writing_chats where id = current_setting('t.bad')::uuid), 'active', 'chat still active');

-- ── B isolation ────────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.save_writing_chat(current_setting('t.bad')::uuid)$$, 'P0001', 'writing_chat_not_found',
                 'B cannot save A''s chat');
select throws_ok($$select public.get_deletion_impact('writing_chat', current_setting('t.n')::uuid)$$,
                 'P0001', 'career_item_not_found', 'B cannot see A''s chat impact');
select throws_ok($$select public.delete_career_item('writing_chat', current_setting('t.n')::uuid)$$,
                 'P0001', 'career_item_not_found', 'B cannot delete A''s chat');

-- ── deletion ───────────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is(public.get_deletion_impact('writing_chat', current_setting('t.n')::uuid),
          '{"message_count": 2, "linked_saved_rows": 3}'::jsonb,
          'writing_chat impact: messages + saved rows that keep existing (project, detail, achievement)');
select is(public.get_deletion_impact('experience', 'aaaaaaaa-1111-0000-0000-000000000001', 'delete_projects') -> 'cascade' -> 'writing_chats',
          '1'::jsonb, 'experience + delete_projects counts the chats of its projects');
select is(public.get_deletion_impact('experience', 'aaaaaaaa-1111-0000-0000-000000000001') -> 'cascade' -> 'writing_chats',
          '0'::jsonb, 'experience + keep_projects deletes no chats');
select is(public.get_deletion_impact('project', 'aaaaaaaa-3333-0000-0000-000000000001') -> 'cascade' -> 'writing_chats',
          '1'::jsonb, 'project impact counts its chats');

select set_config('t.np_updated_at', (select updated_at::text from public.projects where id = current_setting('t.np')::uuid), true);
select set_config('t.nd_updated_at', (select max(updated_at)::text from public.project_details where project_id = current_setting('t.np')::uuid), true);
select is(public.delete_career_item('writing_chat', current_setting('t.n')::uuid, null, 'delete_results'),
          jsonb_build_object('entity_type', 'writing_chat', 'entity_id', current_setting('t.n')::uuid,
                             'affiliation_mode', 'keep_projects', 'result_mode', 'delete_results',
                             'message_count', 2, 'linked_saved_rows', 3),
          'delete_career_item writing_chat: echo + impact (result_mode ignored)');
select is((select count(*)::int from public.writing_chats where id = current_setting('t.n')::uuid), 0, 'chat deleted');
select is((select (count(*), count(source_writing_chat_id))::text from public.projects where id = current_setting('t.np')::uuid),
          '(1,0)', 'saved project stays, source_writing_chat_id cleared');
select is((select count(source_writing_chat_id)::int from public.project_details where project_id = current_setting('t.np')::uuid)
          + (select count(a.source_writing_chat_id)::int from public.achievements a join public.project_details d on d.id = a.project_detail_id
              where d.project_id = current_setting('t.np')::uuid),
          0, 'detail / achievement links cleared');
select is((select updated_at::text from public.projects where id = current_setting('t.np')::uuid), current_setting('t.np_updated_at'),
          'clearing the link does not bump projects.updated_at (no false "변경됨")');
select is((select max(updated_at)::text from public.project_details where project_id = current_setting('t.np')::uuid),
          current_setting('t.nd_updated_at'), 'nor project_details.updated_at');

-- Project deletion cascades its chats and their messages.
select set_config('t.gmsgs', (select count(*)::text from public.writing_chat_messages where writing_chat_id = current_setting('t.g')::uuid), true);
select ok(current_setting('t.gmsgs')::int > 0, 'G has messages');
select lives_ok($$select public.delete_career_item('project', 'aaaaaaaa-3333-0000-0000-000000000001')$$, 'delete P');
select is((select count(*)::int from public.writing_chats where id = current_setting('t.g')::uuid), 0, 'P''s chat deleted');
reset role;
select is((select count(*)::int from public.writing_chat_messages where writing_chat_id = current_setting('t.g')::uuid), 0,
          'and its messages');

-- Experience deletion (keep_projects) clears a chat's confirmed affiliation.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.set_writing_chat_affiliation(current_setting('t.bad')::uuid, 'aaaaaaaa-1111-0000-0000-000000000001')$$,
                'bad chat bound to the experience');
select lives_ok($$select public.delete_career_item('experience', 'aaaaaaaa-1111-0000-0000-000000000001')$$, 'delete experience');
select is((select (count(*), count(experience_id))::text from public.writing_chats where id = current_setting('t.bad')::uuid),
          '(1,0)', 'chat kept, experience_id set null');

select * from finish();
rollback;
