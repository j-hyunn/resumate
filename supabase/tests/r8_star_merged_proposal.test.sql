-- R8 STAR merged proposal (RQ-5, AI-12 extract v6, V-9h): AI `set` on a filled STAR column is a full-replacement
-- proposal (op set, pending value replaced; applied object -> new object, rev + 1); `append` unchanged (compat);
-- a user edit of a pending `set` proposal stays `set`; QA-01 append onto a pending set keeps set; R8-QA-4 review_reason.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('cccccccc-0000-0000-0000-000000000001', 'c@example.test', 'authenticated', 'authenticated');
insert into public.experiences (id, user_id, company_name) values
  ('cccccccc-1111-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'C사');
-- situation / action / result already saved on the project (filled columns).
insert into public.projects (id, user_id, experience_id, name, situation, action, result) values
  ('cccccccc-3333-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
   'cccccccc-1111-0000-0000-000000000001', 'C project', '배포가 40분 걸렸음', '캐시 규칙을 설계함', '배포 시간이 줄었음');

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.chat', public.start_writing_chat('cccccccc-3333-0000-0000-000000000001')::text, true);
select set_config('t.m', (select message_id::text from public.append_writing_chat_message(current_setting('t.chat')::uuid,
  '빌드 캐시도 같이 붙였어요')), true);
reset role;

create function pg_temp.src() returns jsonb language sql as $$ select jsonb_build_array(current_setting('t.m')) $$;
create function pg_temp.draft() returns jsonb language sql as
  $$ select structured_draft from public.writing_chats where id = current_setting('t.chat')::uuid $$;
create function pg_temp.ai(p_field text, p_op text, p_value text, p_new boolean default false) returns jsonb
language sql as $$
  select public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
    jsonb_build_object('op', p_op, 'target', jsonb_build_object('section', 'star', 'field', p_field), 'value', p_value,
                       'source_message_ids', pg_temp.src(), 'source_quotes', '["빌드 캐시"]'::jsonb)
    || case when p_new then '{"new_object": true}'::jsonb else '{}'::jsonb end)))
$$;
create function pg_temp.ai_rv(p_field text, p_op text, p_value text, p_review text, p_reason text) returns jsonb
language sql as $$
  select public.apply_structured_draft_patch(current_setting('t.chat')::uuid, jsonb_build_object('ops', jsonb_build_array(
    jsonb_build_object('op', p_op, 'target', jsonb_build_object('section', 'star', 'field', p_field), 'value', p_value,
                       'source_message_ids', pg_temp.src(), 'source_quotes', '["빌드 캐시"]'::jsonb,
                       'review', p_review, 'review_reason', p_reason))))
$$;
grant execute on function pg_temp.ai_rv(text, text, text, text, text) to app_ai_writer;
grant execute on function pg_temp.src() to authenticated, app_ai_writer;
grant execute on function pg_temp.draft() to authenticated, app_ai_writer;
grant execute on function pg_temp.ai(text, text, text, boolean) to app_ai_writer;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"app_ai_writer"}';

-- ── set on a filled column: stored as set (not lowered to append) ──
select is(pg_temp.ai('action', 'set', '캐시 규칙을 설계함. 빌드 캐시도 붙임') -> 'rejected', '[]'::jsonb,
          'AI set on a filled STAR column is accepted');
select is(pg_temp.draft() #>> '{star,action,op}', 'set', 'filled column: op stays set (merged proposal)');
select is(pg_temp.draft() #>> '{star,action,rev}', '1', 'first object rev 1');

-- ── second set on the same pending object: value replaced, not concatenated ──
select is(pg_temp.ai('action', 'set', '캐시 무효화 규칙과 빌드 캐시를 설계함') -> 'rejected', '[]'::jsonb,
          'second merged set on the pending object');
select is(pg_temp.draft() #>> '{star,action,value}', '캐시 무효화 규칙과 빌드 캐시를 설계함',
          'pending proposal value replaced (no concatenation)');
select is(pg_temp.draft() #>> '{star,action,op}', 'set', 'still op set');
select is(pg_temp.draft() #>> '{star,action,rev}', '2', 'value changed -> rev 2');
select is(pg_temp.draft() #> '{star,action,source_quotes}', '["빌드 캐시"]'::jsonb,
          'replacement keeps only the new sources (no merge with the old object)');
reset role;

-- ── applied proposal: the next set starts a new object with rev + 1 ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.save_project_page('cccccccc-3333-0000-0000-000000000001',
            jsonb_build_object('action', pg_temp.draft() #>> '{star,action,value}'), null,
            jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.chat'), 'field', 'action',
                                                 'rev', (pg_temp.draft() #>> '{star,action,rev}')::int))) -> 'applied',
          jsonb_build_array(jsonb_build_object('writing_chat_id', current_setting('t.chat'), 'field', 'action')),
          'merged proposal applied on save');
select isnt(pg_temp.draft() #>> '{star,action,applied_at}', null, 'applied_at recorded');
reset role;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(pg_temp.ai('action', 'set', '캐시 무효화 규칙과 빌드 캐시를 설계하고 모니터링을 붙임') -> 'rejected', '[]'::jsonb,
          'set after apply is accepted');
select is((pg_temp.draft() #> '{star,action}') - 'source_message_ids',
          '{"value": "캐시 무효화 규칙과 빌드 캐시를 설계하고 모니터링을 붙임", "op": "set", "origin": "ai",
            "source_quotes": ["빌드 캐시"], "review": "ok", "reviewed_at": null, "applied_at": null, "rev": 3}'::jsonb,
          'applied object -> fresh object, op set, applied_at null, rev + 1');

-- ── new_object on a pending set: fresh object, rev + 1 ──
select is(pg_temp.ai('action', 'set', '새로 정리한 문장임', true) -> 'rejected', '[]'::jsonb, 'set with new_object');
select is(pg_temp.draft() #>> '{star,action,value}', '새로 정리한 문장임', 'new_object: replaced');
select is(pg_temp.draft() #>> '{star,action,rev}', '4', 'new_object: rev + 1');

-- ── append (compatibility) unchanged: concatenates, op follows the filled column ──
select is(pg_temp.ai('result', 'append', '빌드도 빨라졌음') -> 'rejected', '[]'::jsonb, 'append on a filled column');
select is(pg_temp.draft() #>> '{star,result,op}', 'append', 'append on a filled column: op append');
select is(pg_temp.ai('result', 'append', '장애도 줄었음') -> 'rejected', '[]'::jsonb, 'second append');
select is(pg_temp.draft() #>> '{star,result,value}', E'빌드도 빨라졌음\n장애도 줄었음', 'append still concatenates');
select is(pg_temp.draft() #>> '{star,result,op}', 'append', 'still op append');
select is(pg_temp.draft() #>> '{star,result,rev}', '2', 'append rev 2');
-- append on an empty column is still stored as set
select is(pg_temp.ai('task', 'append', '배포 개선을 맡았음') -> 'rejected', '[]'::jsonb, 'append on an empty column');
select is(pg_temp.draft() #>> '{star,task,op}', 'set', 'append on an empty column: op set');

-- ── QA-01: append onto a pending merged set keeps op set ──
select is(pg_temp.ai('action', 'append', '알림도 붙임') -> 'rejected', '[]'::jsonb, 'append onto a pending set proposal');
select is(pg_temp.draft() #>> '{star,action,value}', E'새로 정리한 문장임\n알림도 붙임', 'append concatenates onto the proposal');
select is(pg_temp.draft() #>> '{star,action,op}', 'set', 'QA-01: op stays set (full replacement)');
select is(pg_temp.draft() #>> '{star,action,rev}', '5', 'rev + 1');

-- ── R8-QA-4: review_reason ──
select is(pg_temp.ai_rv('learnings', 'set', '캐시 설계를 익혔음', 'needs_review', 'existing_missing') -> 'rejected', '[]'::jsonb,
          'needs_review with review_reason');
select is(pg_temp.draft() #>> '{star,learnings,review_reason}', 'existing_missing', 'review_reason stored');
select is(pg_temp.ai_rv('learnings', 'append', '공유도 했음', 'ok', null) -> 'rejected', '[]'::jsonb,
          'append onto a needs_review object without a reason');
select is(pg_temp.draft() #>> '{star,learnings,review}', 'needs_review', 'review stays needs_review');
select is(pg_temp.draft() #>> '{star,learnings,review_reason}', 'existing_missing', 'old reason kept');
select is(pg_temp.ai_rv('learnings', 'set', '캐시 설계를 익혔음', 'needs_review', 'content_unverified') -> 'rejected', '[]'::jsonb,
          'set with another reason');
select is(pg_temp.draft() #>> '{star,learnings,review_reason}', 'content_unverified', 'reason replaced');
select ok(not (pg_temp.ai_rv('learnings', 'set', '캐시 설계를 익혔음', 'ok', 'content_unverified')
               #> '{structured_draft,star,learnings}' ? 'review_reason'), 'review ok: review_reason not stored');
select ok(not (pg_temp.ai('task', 'set', '배포 개선을 맡았음') #> '{structured_draft,star,task}' ? 'review_reason'),
          'missing review_reason = absent (backward compatible)');
select throws_ok($$select pg_temp.ai_rv('learnings', 'set', 'x', 'needs_review', 'other')$$,
                 'P0001', 'invalid_patch', 'unknown review_reason is invalid_patch');
select is(pg_temp.ai_rv('action', 'set', '배포 시간을 10분으로 줄였음', 'needs_review', 'content_unverified') -> 'rejected',
          '[]'::jsonb, 'needs_review action for accept');
select is(pg_temp.ai_rv('learnings', 'set', '캐시 설계를 익혔음', 'needs_review', 'existing_missing') -> 'rejected',
          '[]'::jsonb, 'needs_review learnings for user edit');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"accept","target":{"section":"star","field":"action"}}]}')$$, 'accept');
select ok(not (pg_temp.draft() #> '{star,action}' ? 'review_reason'), 'accept clears review_reason');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"star","field":"learnings"},"value":"직접 고침"}]}')$$, 'user edit');
select ok(not (pg_temp.draft() #> '{star,learnings}' ? 'review_reason'), 'user edit clears review_reason');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(pg_temp.ai_rv('task', 'set', '배포를 맡았음', 'needs_review', 'existing_missing') -> 'rejected', '[]'::jsonb,
          'needs_review task for reject');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"reject","target":{"section":"star","field":"task"}}]}')$$, 'reject');
select ok(not (pg_temp.draft() #> '{star,task}' ? 'review_reason'), 'reject clears review_reason');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"app_ai_writer"}';

-- ── protected_field unchanged for a merged set ──
select is(pg_temp.ai('situation', 'set', '배포가 40분 걸렸고 롤백이 잦았음') -> 'rejected', '[]'::jsonb,
          'merged set on situation');
reset role;

-- ── user edit ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"star","field":"situation"},"value":"배포가 40분 걸렸고 롤백이 잦았음 (직접 고침)"}]}')$$,
                'user edits a pending merged proposal');
select is(pg_temp.draft() #>> '{star,situation,op}', 'set', 'user edit of a pending set proposal stays set (replacement)');
select is(pg_temp.draft() #>> '{star,situation,origin}', 'user_edit', 'origin user_edit');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"star","field":"result"},"value":"빌드가 빨라졌음"}]}')$$,
                'user edits a pending append proposal');
select is(pg_temp.draft() #>> '{star,result,op}', 'append', 'user edit of an append proposal on a filled column: append (R5)');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.chat')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"star","field":"learnings"},"value":"캐시 설계를 배웠음"}]}')$$,
                'user writes an empty slot on an empty column');
select is(pg_temp.draft() #>> '{star,learnings,op}', 'set', 'empty column: set');
reset role;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(pg_temp.ai('situation', 'set', 'AI 재제안') -> 'rejected',
          '[{"index": 0, "op": "set", "reason": "protected_field"}]'::jsonb,
          'user_edit pending object still protected from an AI merged set');
reset role;

select * from finish();
rollback;
