-- R5 apply_structured_draft_patch (DM v4.5 §2.5, §2.5.0; AI-12 v4.6, AI-13): STAR rev monotonic, new_object,
-- clear keeps the slot; deliverable ops (facts, draft replace / count, limit 6, block accept / remove, markdown
-- assembly), target scoping (invalid_patch), applied draft protection.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');
insert into public.experiences (id, user_id, company_name) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'A사');
insert into public.projects (id, user_id, experience_id, name) values
  ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-1111-0000-0000-000000000001', 'A project');
insert into public.projects (id, user_id, name) values
  ('aaaaaaaa-3333-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'A standalone');
insert into public.project_deliverables (id, user_id, project_id, title, body) values
  ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-3333-0000-0000-000000000002', '결제 회고', '');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.star', public.start_writing_chat('aaaaaaaa-3333-0000-0000-000000000001')::text, true);
select set_config('t.sm', (select message_id::text from public.append_writing_chat_message(current_setting('t.star')::uuid,
  '결제 API 병목을 찾았어요')), true);
select set_config('t.dlv', public.start_deliverable_writing_chat('aaaaaaaa-4444-0000-0000-000000000001')::text, true);
select set_config('t.dm', (select message_id::text from public.append_writing_chat_message(current_setting('t.dlv')::uuid,
  '장애 대응 런북은 제가 직접 썼어요')), true);
reset role;

create function pg_temp.src(p text) returns jsonb language sql as $$ select jsonb_build_array(current_setting(p)) $$;
create function pg_temp.draft(p text) returns jsonb language sql as
  $$ select structured_draft from public.writing_chats where id = current_setting(p)::uuid $$;
grant execute on function pg_temp.src(text) to authenticated, app_ai_writer;
grant execute on function pg_temp.draft(text) to authenticated, app_ai_writer;

-- ════════ STAR: rev / new_object ════════
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.star')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"action"}'::jsonb, 'value', '병목을 찾았다',
                     'source_message_ids', pg_temp.src('t.sm')))))$$, 'AI set');
select is(pg_temp.draft('t.star') #>> '{star,action,rev}', '1', 'new slot starts at rev 1');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.star')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'append', 'target', '{"section":"star","field":"action"}'::jsonb, 'value', '인덱스를 바꿨다',
                     'source_message_ids', pg_temp.src('t.sm')))))$$, 'AI append onto the pending object');
select is(pg_temp.draft('t.star') #>> '{star,action,rev}', '2', 'value changed -> rev 2');
select is(pg_temp.draft('t.star') #>> '{star,action,value}', E'병목을 찾았다\n인덱스를 바꿨다', 'concatenated');
-- new_object: the slot is replaced (not concatenated), rev keeps going.
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.star')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'append', 'target', '{"section":"star","field":"action"}'::jsonb, 'value', '쿼리 플랜을 바꿨다',
                     'source_message_ids', pg_temp.src('t.sm'), 'new_object', true))))$$, 'AI append with new_object');
select is(pg_temp.draft('t.star') #>> '{star,action,value}', '쿼리 플랜을 바꿨다', 'new_object: fresh object, no concatenation');
select is(pg_temp.draft('t.star') #>> '{star,action,rev}', '3', 'new_object: previous rev + 1 (never back to 1)');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.star')::uuid,
                   '{"ops":[{"op":"set_clarifications","items":[],"new_object":true}]}')$$,
                 'P0001', 'invalid_patch', 'new_object only on set / append');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.star')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"task"}'::jsonb, 'value', 'x',
                     'source_message_ids', pg_temp.src('t.sm'), 'new_object', 'yes'))))$$,
                 'P0001', 'invalid_patch', 'new_object must be boolean');
-- deliverable ops are not valid on a STAR chat
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.star')::uuid, '{"ops":[{"op":"count_draft"}]}')$$,
                 'P0001', 'invalid_patch', 'STAR chat refuses deliverable ops');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.star')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"star","field":"action"},"value":"x","new_object":true}]}')$$,
                 'P0001', 'invalid_patch', 'new_object is AI-only');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.star')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"star","field":"action"},"value":"직접 고침"}]}')$$, 'user edit');
select is(pg_temp.draft('t.star') #>> '{star,action,rev}', '4', 'user edit -> rev + 1');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.star')::uuid,
                   '{"ops":[{"op":"set","target":{"section":"star","field":"action"},"value":null}]}')$$, 'user clears');
select is((pg_temp.draft('t.star') #> '{star,action}') - 'reviewed_at',
          '{"value": null, "op": "set", "origin": "ai", "source_message_ids": [], "source_quotes": [], "review": "ok",
            "applied_at": null, "rev": 5}'::jsonb,
          'clear keeps an empty, unprotected slot with rev + 1');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.star')::uuid, '{"ops":[{"op":"accept_block","block_id":"b1"}]}')$$,
                 'P0001', 'invalid_patch', 'STAR chat refuses deliverable user ops');
reset role;

set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.star')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"action"}'::jsonb, 'value', '다시 찾았다',
                     'source_message_ids', pg_temp.src('t.sm'), 'review', 'needs_review'))))$$, 'AI refills the cleared slot');
select is(pg_temp.draft('t.star') #>> '{star,action,rev}', '6', 'rev 6 after refill');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.star')::uuid,
                   '{"ops":[{"op":"accept","target":{"section":"star","field":"action"}}]}')$$, 'accept');
select is(pg_temp.draft('t.star') #>> '{star,action,rev}', '6', 'accept keeps rev');
reset role;
-- An accepted pending object is protected from plain AI patches, but new_object replaces it [가정].
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.apply_structured_draft_patch(current_setting('t.star')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'append', 'target', '{"section":"star","field":"action"}'::jsonb, 'value', 'x',
                     'source_message_ids', pg_temp.src('t.sm'))))) -> 'rejected',
          '[{"index": 0, "op": "append", "reason": "protected_field"}]'::jsonb, 'accepted object protected');
select is(((public.apply_structured_draft_patch(current_setting('t.star')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'append', 'target', '{"section":"star","field":"action"}'::jsonb, 'value', '새 문장',
                     'source_message_ids', pg_temp.src('t.sm'), 'new_object', true)))) #> '{structured_draft,star,action}')
          - 'source_quotes') - 'source_message_ids',
          '{"value": "새 문장", "op": "set", "origin": "ai", "review": "ok", "reviewed_at": null, "applied_at": null, "rev": 7}'::jsonb,
          'new_object replaces the accepted (already filled) object');

-- ════════ deliverable chat: AI ops ════════
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set', 'target', '{"section":"star","field":"action"}'::jsonb, 'value', 'x',
                     'source_message_ids', pg_temp.src('t.dm')))))$$,
                 'P0001', 'invalid_patch', 'deliverable chat refuses STAR ops');

select is(public.apply_structured_draft_patch(current_setting('t.dlv')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'set_writing_kind', 'value', 'retrospective'),
  jsonb_build_object('op', 'add_facts', 'facts', jsonb_build_array(
    jsonb_build_object('id', 'aaaaaaaa-6666-0000-0000-000000000001', 'slot', 'contribution',
                       'text', ' 결제 모듈의 장애 대응 런북을 직접 작성했다 ', 'actor', 'self',
                       'source_message_ids', pg_temp.src('t.dm'), 'source_quotes', '["런북은 제가 직접 썼어요"]'::jsonb),
    jsonb_build_object('id', 'aaaaaaaa-6666-0000-0000-000000000002', 'slot', 'went_well', 'text', '장애 알림이 줄었다',
                       'actor', 'team', 'source_message_ids', pg_temp.src('t.dm'), 'review', 'needs_review'),
    jsonb_build_object('slot', 'nope', 'text', 'x', 'actor', 'self', 'source_message_ids', pg_temp.src('t.dm')),
    jsonb_build_object('slot', 'goal', 'text', 'x', 'actor', 'self', 'source_message_ids', '[]'::jsonb),
    jsonb_build_object('slot', 'goal', 'text', 'x', 'actor', 'boss', 'source_message_ids', pg_temp.src('t.dm')))),
  jsonb_build_object('op', 'set_writing_kind', 'value', 'essay'),
  jsonb_build_object('op', 'set_clarifications', 'items', '[{"kind":"number_vague","slot":"went_well","note":"수치 없음"}]'::jsonb),
  jsonb_build_object('op', 'add_sensitive_flags', 'count', 1)))) -> 'rejected',
  '[{"index": 1, "op": "add_facts", "fact_index": 2, "reason": "invalid_value"},
    {"index": 1, "op": "add_facts", "fact_index": 3, "reason": "invalid_source"},
    {"index": 1, "op": "add_facts", "fact_index": 4, "reason": "invalid_value"},
    {"index": 2, "op": "set_writing_kind", "reason": "invalid_value"}]'::jsonb,
  'AI: facts validated one by one (slot, V-9a source, actor), unknown kind refused');
select is(jsonb_array_length(pg_temp.draft('t.dlv') -> 'facts'), 2, 'two facts stored');
select is(pg_temp.draft('t.dlv') #> '{facts,0}',
          jsonb_build_object('id', 'aaaaaaaa-6666-0000-0000-000000000001', 'slot', 'contribution',
                             'text', '결제 모듈의 장애 대응 런북을 직접 작성했다', 'actor', 'self',
                             'source_message_ids', pg_temp.src('t.dm'), 'source_quotes', '["런북은 제가 직접 썼어요"]'::jsonb,
                             'review', 'ok', 'reviewed_at', null, 'origin', 'ai'),
          'fact object (DM §2.5.0), text trimmed');
select is((pg_temp.draft('t.dlv') - 'facts'),
          '{"schema_version": 1, "target": "project_deliverable", "writing_kind": "retrospective", "deliverable": {},
            "clarifications": [{"kind": "number_vague", "slot": "went_well", "note": "수치 없음"}],
            "sensitive_flags_count": 1, "draft_count": 0}'::jsonb, 'kind / clarifications / flags');

-- replace_draft: value assembled by the DB from blocks
select is(public.apply_structured_draft_patch(current_setting('t.dlv')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'replace_draft', 'body', jsonb_build_object(
    'blocks', jsonb_build_array(
      jsonb_build_object('block_id', 'b1', 'type', 'paragraph', 'text', 'x',
                         'source_fact_ids', '["aaaaaaaa-6666-0000-0000-00000000ffff"]'::jsonb)))))))
          -> 'rejected',
          '[{"index": 0, "op": "replace_draft", "reason": "invalid_source"}]'::jsonb,
          'a block citing an unknown fact is refused (V-10a DB defense)');
select is(pg_temp.draft('t.dlv') ->> 'draft_count', '0', 'refused draft is not counted');

select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'replace_draft', 'body', jsonb_build_object(
    'value', 'ignored',
    'base_body_hash', 'sha256:abc', 'replace_allowed', true, 'missing_slots', '["went_wrong"]'::jsonb,
    'dropped_block_count', 1,
    'blocks', jsonb_build_array(
      jsonb_build_object('block_id', 'b1', 'type', 'heading', 'level', 2, 'text', '내가 맡은 일'),
      jsonb_build_object('block_id', 'b2', 'type', 'paragraph', 'text', '결제 모듈의 런북을 작성했다.', 'basis', 'new',
                         'source_fact_ids', '["aaaaaaaa-6666-0000-0000-000000000001"]'::jsonb),
      jsonb_build_object('block_id', 'b3', 'type', 'bullet_list', 'basis', 'new', 'review', 'needs_review',
                         'items', jsonb_build_array(jsonb_build_object('text', ' 알림 감소 '), jsonb_build_object('text', '대응 시간 단축',
                                                    'source_fact_ids', '["aaaaaaaa-6666-0000-0000-000000000001"]'::jsonb))),
      jsonb_build_object('block_id', 'b4', 'type', 'table', 'basis', 'current_body',
                         'rows', '[{"cells":["항목","값"]},{"cells":["알림","a|b"]}]'::jsonb),
      jsonb_build_object('block_id', 'b5', 'type', 'numbered_list', 'items', '[{"text":"하나"},{"text":"둘"}]'::jsonb),
      jsonb_build_object('block_id', 'b6', 'type', 'quote', 'text', E'인용\n둘째 줄'),
      jsonb_build_object('block_id', 'b7', 'type', 'code', 'text', 'select 1;')))))))$$,
  'AI replace_draft');
select is(pg_temp.draft('t.dlv') #>> '{deliverable,body,value}',
          E'## 내가 맡은 일\n\n결제 모듈의 런북을 작성했다.\n\n- 알림 감소\n- 대응 시간 단축\n\n'
          || E'| 항목 | 값 |\n| --- | --- |\n| 알림 | a\\|b |\n\n1. 하나\n2. 둘\n\n> 인용\n> 둘째 줄\n\n```\nselect 1;\n```',
          'value assembled deterministically from blocks (the given value is ignored)');
select is((pg_temp.draft('t.dlv') #> '{deliverable,body}') - array['value', 'blocks', 'generated_at'],
          '{"rev": 1, "base_body_hash": "sha256:abc", "replace_allowed": true, "missing_slots": ["went_wrong"],
            "dropped_block_count": 1, "applied_at": null, "applied_mode": null, "applied_rev": null}'::jsonb,
          'draft meta: rev 1, applied_* null');
select isnt(pg_temp.draft('t.dlv') #>> '{deliverable,body,generated_at}', null, 'generated_at set by the server');
select is(pg_temp.draft('t.dlv') #> '{deliverable,body,blocks,1}',
          '{"block_id": "b2", "type": "paragraph", "text": "결제 모듈의 런북을 작성했다.", "basis": "new",
            "source_fact_ids": ["aaaaaaaa-6666-0000-0000-000000000001"], "source_body_quotes": [],
            "source_project_fields": [], "review": "ok"}'::jsonb, 'stored block shape');
select is(pg_temp.draft('t.dlv') ->> 'draft_count', '1', 'draft_count + 1');

-- QA-R5-06: list items / table rows must be objects (TS StoredBlockSchema)
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid,
                   '{"ops":[{"op":"replace_draft","body":{"blocks":[{"block_id":"x","type":"bullet_list","items":["문자열 항목"]}]}}]}')$$,
                 'P0001', 'invalid_patch', 'string list item -> invalid_patch');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid,
                   '{"ops":[{"op":"replace_draft","body":{"blocks":[{"block_id":"x","type":"table","rows":[["a","b"]]}]}}]}')$$,
                 'P0001', 'invalid_patch', 'array table row -> invalid_patch');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid,
                   '{"ops":[{"op":"replace_draft","body":{"blocks":[{"block_id":"x","type":"table","rows":[{"cells":[{"text":"a"}]}]}]}}]}')$$,
                 'P0001', 'invalid_patch', 'non-string cell -> invalid_patch');
select is(public.apply_structured_draft_patch(current_setting('t.dlv')::uuid,
            '{"ops":[{"op":"replace_draft","body":{"blocks":[{"block_id":"x","type":"paragraph","text":"t","source_project_fields":["description"]}]}}]}')
          -> 'rejected', '[{"index": 0, "op": "replace_draft", "reason": "invalid_source"}]'::jsonb,
          'source_project_fields outside PRJ.* -> invalid_source');
select is(pg_temp.draft('t.dlv') ->> 'draft_count', '1', 'contract errors do not count drafts');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid, '{"ops":[{"op":"count_draft"}]}')$$,
                'count_draft (no content block left)');
select is(pg_temp.draft('t.dlv') ->> 'draft_count', '2', 'counted without a draft');
select is(pg_temp.draft('t.dlv') #>> '{deliverable,body,rev}', '1', 'count_draft keeps the draft');
reset role;

-- ════════ deliverable chat: user ops ════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid, '{"ops":[{"op":"count_draft"}]}')$$,
                 'P0001', 'invalid_patch', 'AI-only op refused for users');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid,
                   '{"ops":[{"op":"accept_fact","fact_id":"aaaaaaaa-6666-0000-0000-000000000001"}]}')$$,
                 'P0001', 'invalid_review_transition', 'accept needs a needs_review fact');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid,
                   '{"ops":[{"op":"accept_fact","fact_id":"aaaaaaaa-6666-0000-0000-00000000ffff"}]}')$$,
                 'P0001', 'invalid_patch', 'unknown fact');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid,
                   '{"ops":[{"op":"accept_fact","fact_id":"aaaaaaaa-6666-0000-0000-000000000002"}]}')$$, 'accept fact');
select is(pg_temp.draft('t.dlv') #>> '{facts,1,review}', 'accepted', 'fact accepted');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid,
                   '{"ops":[{"op":"accept_block","block_id":"b2"}]}')$$,
                 'P0001', 'invalid_review_transition', 'accept needs a needs_review block');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid,
                   '{"ops":[{"op":"remove_block","block_id":"zz"}]}')$$, 'P0001', 'invalid_patch', 'unknown block');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid,
                   '{"ops":[{"op":"accept_block","block_id":"b3"}]}')$$, 'accept block');
select is((pg_temp.draft('t.dlv') #>> '{deliverable,body,blocks,2,review}') || '/' || (pg_temp.draft('t.dlv') #>> '{deliverable,body,rev}'),
          'accepted/1', 'block accepted, rev unchanged');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid,
                   '{"ops":[{"op":"remove_block","block_id":"b4"},{"op":"remove_block","block_id":"b5"},
                            {"op":"remove_block","block_id":"b6"},{"op":"remove_block","block_id":"b7"}]}')$$,
                'remove blocks ([빼기])');
select is(pg_temp.draft('t.dlv') #>> '{deliverable,body,value}',
          E'## 내가 맡은 일\n\n결제 모듈의 런북을 작성했다.\n\n- 알림 감소\n- 대응 시간 단축', 'value reassembled');
select is(pg_temp.draft('t.dlv') #>> '{deliverable,body,rev}', '5', 'each removal rev + 1');
reset role;

-- a new AI draft replaces the body with the next rev; the 6-draft limit
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
create function pg_temp.one_block_draft() returns jsonb language sql as $$
  select jsonb_build_object('ops', jsonb_build_array(jsonb_build_object('op', 'replace_draft', 'body', jsonb_build_object(
    'blocks', jsonb_build_array(jsonb_build_object('block_id', 'n1', 'type', 'paragraph', 'text', '새 초안',
      'source_fact_ids', '["aaaaaaaa-6666-0000-0000-000000000001"]'::jsonb))))))
$$;
grant execute on function pg_temp.one_block_draft() to app_ai_writer;
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid, pg_temp.one_block_draft())$$, 'draft 3');
select is((pg_temp.draft('t.dlv') #>> '{deliverable,body,rev}') || '/' || (pg_temp.draft('t.dlv') ->> 'draft_count'),
          '6/3', 'new draft: previous rev + 1, draft_count 3');
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid,
                   '{"ops":[{"op":"count_draft"},{"op":"count_draft"},{"op":"count_draft"}]}')$$, 'drafts 4..6');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid, pg_temp.one_block_draft())$$,
                 'P0001', 'writing_chat_draft_limit_reached', 'the 7th draft is refused (draft_count = 6)');
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid, '{"ops":[{"op":"count_draft"}]}')$$,
                 'P0001', 'writing_chat_draft_limit_reached', 'counting is refused at the limit too');
select is(pg_temp.draft('t.dlv') ->> 'draft_count', '6', 'draft_count stays 6');
reset role;

-- applied draft: user block ops refused; a new AI draft would replace it (checked in r5_page_save)
update public.writing_chats
   set structured_draft = jsonb_set(structured_draft, '{deliverable,body,applied_at}', to_jsonb(now()))
 where id = current_setting('t.dlv')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid,
                   '{"ops":[{"op":"remove_block","block_id":"n1"}]}')$$,
                 'P0001', 'field_already_applied', 'block ops on an applied draft');
-- facts can still be reviewed; reject removes the fact [가정]
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select lives_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid, jsonb_build_object('ops', jsonb_build_array(
  jsonb_build_object('op', 'add_facts', 'facts', jsonb_build_array(jsonb_build_object(
    'id', 'aaaaaaaa-6666-0000-0000-000000000001', 'slot', 'learnings', 'text', '런북은 미리', 'actor', 'self',
    'source_message_ids', pg_temp.src('t.dm'), 'review', 'needs_review'))))))$$, 'AI fact with a reused id');
select is(jsonb_array_length(pg_temp.draft('t.dlv') -> 'facts'), 3, 'stored');
select isnt(pg_temp.draft('t.dlv') #>> '{facts,2,id}', 'aaaaaaaa-6666-0000-0000-000000000001',
            'a duplicate fact id is replaced by a new one');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(format($$select public.apply_structured_draft_patch(%L::uuid, '{"ops":[{"op":"reject_fact","fact_id":"%s"}]}')$$,
                       current_setting('t.dlv'), pg_temp.draft('t.dlv') #>> '{facts,2,id}'), 'reject fact');
select is(jsonb_array_length(pg_temp.draft('t.dlv') -> 'facts'), 2, 'rejected fact removed');
reset role;

-- closed deliverable chat: AI refused, user review allowed
update public.writing_chats set status = 'closed' where id = current_setting('t.dlv')::uuid;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid, '{"ops":[{"op":"add_sensitive_flags","count":1}]}')$$,
                 'P0001', 'writing_chat_closed', 'AI cannot patch a closed deliverable chat');
reset role;

-- QA-R5-01: user B (session and app_ai_writer with sub = B) cannot patch A's deliverable chat
insert into auth.users (id, email, aud, role) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');
select set_config('t.before', pg_temp.draft('t.dlv')::text, true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid,
                   '{"ops":[{"op":"remove_block","block_id":"n1"}]}')$$,
                 'P0001', 'writing_chat_not_found', 'B session cannot patch A''s deliverable chat');
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"app_ai_writer"}';
select throws_ok($$select public.apply_structured_draft_patch(current_setting('t.dlv')::uuid, '{"ops":[{"op":"add_sensitive_flags","count":1}]}')$$,
                 'P0001', 'writing_chat_not_found', 'app_ai_writer (sub = B) cannot patch A''s deliverable chat');
reset role;
select is(pg_temp.draft('t.dlv')::text, current_setting('t.before'), 'A''s deliverable draft unchanged');

select * from finish();
rollback;
