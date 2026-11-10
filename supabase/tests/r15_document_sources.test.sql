-- R15 / CF-S1 (사용자 결정 2026-11-09; the document change is PR #68, not merged into this worktree):
-- the slot-level citations `{slot}.sources.{n}` ride on the AI draft (replace_draft.sources[]) and are written by
-- save_application_document only for the slots whose proposal it recorded as applied.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

-- R15 후속 3 (CF-S7 = (a)): with a document row present, a null expected version is now a stale_write. These
-- assertions are about the other rules, so every save here goes through this thin wrapper, which sends the
-- version the caller last saw — what the screen does — when the test passes null. Explicit versions (the stale
-- tests) pass through untouched; the null rule itself is asserted against the real RPC in
-- r15_document_save_versions.test.sql.
create schema r15s;
grant usage on schema r15s to authenticated;
create function r15s.save(p_application_project_id uuid, p_document_kind text, p_body jsonb,
  p_meta jsonb default null, p_expected_updated_at timestamptz default null, p_applied_proposals jsonb default null,
  p_client_id uuid default null, p_application_values jsonb default null)
returns jsonb language sql as $$
  select public.save_application_document(p_application_project_id, p_document_kind, p_body, p_meta,
    coalesce(p_expected_updated_at,
             (select d.updated_at from public.application_documents d
               where d.application_project_id = p_application_project_id and d.document_kind = p_document_kind)),
    p_applied_proposals, p_client_id, p_application_values);
$$;
grant execute on function r15s.save(uuid, text, jsonb, jsonb, timestamptz, jsonb, uuid, jsonb) to authenticated;

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated');
insert into public.application_projects (id, user_id, name, name_source) values
  ('a0000000-aaaa-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '가 지원', 'user');
insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences)
values ('a0000000-1d00-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
        'a0000000-aaaa-0000-0000-000000000001', '원문', 'h', '[{"sid":"S1","text":"원문","start":0,"end":2}]');
insert into public.experiences (id, user_id, company_name, start_month) values
  ('a0000000-1111-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'A사', '2023-01-01');
insert into public.projects (id, user_id, experience_id, name, result) values
  ('a0000000-3333-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'a0000000-1111-0000-0000-000000000001', 'P1', '응답 1.2초 -> 0.7초');
insert into public.skills (id, user_id, name) values
  ('a0000000-4444-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'PostgreSQL');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.chat', public.start_document_writing_chat('a0000000-aaaa-0000-0000-000000000001',
                    'cover_letter')::text, true);
reset role;

-- ── replace_draft.sources[] validation (patch time) ──
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
create function pg_temp.patch(p_sources text) returns text language plpgsql as $$
declare
  v text;
begin
  perform public.apply_structured_draft_patch(current_setting('t.chat')::uuid, format($f${"ops":[
    {"op":"replace_draft","slot":"q_1","draft":{"char_count":3,"sources":%s,
      "blocks":[{"block_id":"b1","type":"paragraph","text":"본문",
        "evidence":[{"source_type":"project","source_id":"a0000000-3333-0000-0000-000000000001",
                     "source_field":"result","quote":"응답 1.2초 -> 0.7초"}]}]}}]}$f$, p_sources)::jsonb);
  return null;
exception when others then
  get stacked diagnostics v = message_text;
  return v;
end;
$$;
grant execute on function pg_temp.patch(text) to app_ai_writer;
select is(pg_temp.patch('[{"source_type":"interview_answer","source_id":"a0000000-3333-0000-0000-000000000001",
                           "role":"primary"}]'),
          'invalid_patch', 'a source_type outside the DM §2.8 list -> invalid_patch');
select is(pg_temp.patch('[{"source_type":"project","source_id":"a0000000-3333-0000-0000-000000000001",
                           "role":"main"}]'),
          'invalid_patch', 'a role outside primary / supporting -> invalid_patch');
select is(pg_temp.patch((select '[' || string_agg(format('{"source_type":"project",
                             "source_id":"a0000000-3333-0000-0000-000000000001","role":"supporting"}'), ',')
                           || ']' from generate_series(1, 6))),
          'invalid_patch', 'more than 5 sources -> invalid_patch `[가정]`');
select is(pg_temp.patch('"x"'), 'invalid_patch', 'sources must be an array');
-- (CF-1) this is not the dropped document.source_ranking.
select is(pg_temp.patch('[{"source_type":"skill","source_id":"a0000000-4444-0000-0000-000000000001",
                           "role":"supporting"},
                          {"source_type":"project","source_id":"a0000000-3333-0000-0000-000000000001",
                           "role":"primary"},
                          {"source_type":"jd_sentence","source_id":"a0000000-1d00-0000-0000-000000000001",
                           "role":"supporting"}]'),
          null, 'a valid sources array is accepted');
select is((select jsonb_agg(e ->> 'role' order by o) from public.writing_chats w,
                  lateral jsonb_array_elements(w.structured_draft
                    #> '{document,questions,0,draft,sources}') with ordinality as t (e, o)
            where w.id = current_setting('t.chat')::uuid),
          '["supporting", "primary", "supporting"]'::jsonb,
          'sources are stored in the array order the model sent, with their role');
select ok((select not (structured_draft #> '{document,questions,0,draft}' ? 'source_ranking')
             from public.writing_chats where id = current_setting('t.chat')::uuid),
          'the dropped document.source_ranking is not revived (CF-1)');
reset role;

-- ── save: an applied proposal writes that slot's `{slot}.sources.{n}` rows ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.body', $json${"questions":[
  {"slot":"q_1","question_text":"q1","char_limit":800,"count_basis":"with_spaces","body":"본문",
   "blocks":[{"block_id":"b1","type":"paragraph","text":"본문"}]},
  {"slot":"q_2","question_text":"q2","char_limit":800,"count_basis":"with_spaces","body":"본문 2",
   "blocks":[{"block_id":"c1","type":"paragraph","text":"본문 2"}]}]}$json$, true);
select set_config('t.r', r15s.save('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    current_setting('t.body')::jsonb, null, null,
                    format('[{"writing_chat_id":"%s","slot":"q_1","rev":1}]', current_setting('t.chat'))::jsonb
                  )::text, true);
select is((current_setting('t.r')::jsonb) -> 'skipped', '[]'::jsonb, 'the proposal is recorded as applied');
select results_eq($$select item_key, source_type, source_field from public.evidence_links
                     where owner_type = 'application_document'
                       and user_id = 'a0000000-0000-0000-0000-000000000001' order by item_key$$,
                  $$values ('q_1.sources.1'::text, 'project'::text, null::text),
                           ('q_1.sources.2', 'skill', null),
                           ('q_1.sources.3', 'jd_sentence', null)$$,
                  'the applied slot gets its sources rows, `primary` first, n = the array order');
select is((select count(*)::int from public.evidence_links
            where owner_type = 'application_document' and user_id = 'a0000000-0000-0000-0000-000000000001'
              and source_label is not null), 0,
          'role is a proposal-only value and is not stored on the row');

-- ── a slot with no applied proposal keeps its sources rows; its block rows are rewritten ──
reset role;
-- Give q_2 a sources row by hand, as an earlier applied proposal would have left it.
insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, sort_order,
                                   source_type, source_id)
select 'a0000000-0000-0000-0000-000000000001', 'a0000000-aaaa-0000-0000-000000000001', 'application_document',
       d.id, 'q_2.sources.1', 99, 'project', 'a0000000-3333-0000-0000-000000000001'
  from public.application_documents d
 where d.application_project_id = 'a0000000-aaaa-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
-- Save again, with no applied proposals at all, and a changed block in each slot.
select set_config('t.r', r15s.save('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    $json${"questions":[
                      {"slot":"q_1","question_text":"q1","char_limit":800,"count_basis":"with_spaces",
                       "body":"고친 본문",
                       "blocks":[{"block_id":"b2","type":"paragraph","text":"고친 본문",
                         "evidence":[{"source_type":"project","source_id":"a0000000-3333-0000-0000-000000000001",
                                      "source_field":"result","quote":"응답 1.2초 -> 0.7초"}]}]},
                      {"slot":"q_2","question_text":"q2","char_limit":800,"count_basis":"with_spaces",
                       "body":"본문 2","blocks":[{"block_id":"c2","type":"paragraph","text":"본문 2"}]}]}$json$::jsonb
                  )::text, true);
select results_eq($$select item_key from public.evidence_links
                     where owner_type = 'application_document'
                       and user_id = 'a0000000-0000-0000-0000-000000000001' order by item_key$$,
                  $$values ('q_1.blocks.b2'::text), ('q_1.sources.1'), ('q_1.sources.2'), ('q_1.sources.3'),
                           ('q_2.sources.1')$$,
                  'no applied proposal: the sources rows of both slots survive, the block rows are rewritten');

-- ── a slot that is not sent loses both kinds ──
select set_config('t.r', r15s.save('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    '{"questions":[{"slot":"q_2","question_text":"q2","char_limit":800,
                                    "count_basis":"with_spaces","body":"본문 2","blocks":[]}]}'
                  )::text, true);
select results_eq($$select item_key from public.evidence_links
                     where owner_type = 'application_document'
                       and user_id = 'a0000000-0000-0000-0000-000000000001' order by item_key$$,
                  $$values ('q_2.sources.1'::text)$$,
                  'the deleted question loses its block rows AND its sources rows');

-- ── a later applied proposal for the same slot replaces the rows ──
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.chat2', public.start_document_writing_chat('a0000000-aaaa-0000-0000-000000000001',
                    'cover_letter')::text, true);
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.apply_structured_draft_patch(current_setting('t.chat2')::uuid,
            $json${"ops":[{"op":"replace_draft","slot":"q_2","draft":{"char_count":1,
              "sources":[{"source_type":"skill","source_id":"a0000000-4444-0000-0000-000000000001",
                          "role":"primary"}],
              "blocks":[{"block_id":"z1","type":"paragraph","text":"새 본문",
                "evidence":[{"source_type":"skill","source_id":"a0000000-4444-0000-0000-000000000001",
                             "source_field":"name","quote":"PostgreSQL"}]}]}}]}$json$::jsonb) -> 'rejected',
          '[]'::jsonb, 'the second chat proposes q_2');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.r', r15s.save('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    '{"questions":[{"slot":"q_2","question_text":"q2","char_limit":800,
                                    "count_basis":"with_spaces","body":"새 본문","blocks":[]}]}',
                    null, null,
                    format('[{"writing_chat_id":"%s","slot":"q_2","rev":1}]', current_setting('t.chat2'))::jsonb
                  )::text, true);
select results_eq($$select item_key, source_type from public.evidence_links
                     where owner_type = 'application_document'
                       and user_id = 'a0000000-0000-0000-0000-000000000001' order by item_key$$,
                  $$values ('q_2.sources.1'::text, 'skill'::text)$$,
                  'the applied proposal replaced the slot''s sources rows');

-- ── "no sources key" vs "empty array" (CF-S1 `[가정]`, aligned with the pipeline note R15-AI-2) ──
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
-- A draft WITHOUT the sources key stores none.
select is(public.apply_structured_draft_patch(current_setting('t.chat2')::uuid,
            $json${"ops":[{"op":"replace_draft","slot":"q_2","draft":{"char_count":1,
              "blocks":[{"block_id":"z2","type":"paragraph","text":"또 새 본문",
                "evidence":[{"source_type":"skill","source_id":"a0000000-4444-0000-0000-000000000001",
                             "source_field":"name","quote":"PostgreSQL"}]}]}}]}$json$::jsonb) -> 'rejected',
          '[]'::jsonb, 'a draft without a sources key is accepted');
select ok((select not (structured_draft #> '{document,questions,0,draft}' ? 'sources')
             from public.writing_chats where id = current_setting('t.chat2')::uuid),
          'no sources key in the patch -> no sources key in the draft');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.r', r15s.save('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    '{"questions":[{"slot":"q_2","question_text":"q2","char_limit":800,
                                    "count_basis":"with_spaces","body":"또 새 본문","blocks":[]}]}',
                    null, null,
                    format('[{"writing_chat_id":"%s","slot":"q_2","rev":2}]', current_setting('t.chat2'))::jsonb
                  )::text, true);
select is((current_setting('t.r')::jsonb) -> 'skipped', '[]'::jsonb, 'the keyless proposal is applied');
select results_eq($$select item_key, source_type from public.evidence_links
                     where owner_type = 'application_document'
                       and user_id = 'a0000000-0000-0000-0000-000000000001' order by item_key$$,
                  $$values ('q_2.sources.1'::text, 'skill'::text)$$,
                  'an applied proposal with NO sources key keeps the slot''s existing citation rows');
-- An EMPTY array clears them.
reset role;
set local role app_ai_writer;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"app_ai_writer"}';
select is(public.apply_structured_draft_patch(current_setting('t.chat2')::uuid,
            $json${"ops":[{"op":"replace_draft","slot":"q_2","draft":{"char_count":1,"sources":[],
              "blocks":[{"block_id":"z3","type":"paragraph","text":"세 번째 본문",
                "evidence":[{"source_type":"skill","source_id":"a0000000-4444-0000-0000-000000000001",
                             "source_field":"name","quote":"PostgreSQL"}]}]}}]}$json$::jsonb) -> 'rejected',
          '[]'::jsonb, 'a draft with an empty sources array is accepted');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('t.r', r15s.save('a0000000-aaaa-0000-0000-000000000001', 'cover_letter',
                    '{"questions":[{"slot":"q_2","question_text":"q2","char_limit":800,
                                    "count_basis":"with_spaces","body":"세 번째 본문","blocks":[]}]}',
                    null, null,
                    format('[{"writing_chat_id":"%s","slot":"q_2","rev":3}]', current_setting('t.chat2'))::jsonb
                  )::text, true);
select is((select count(*)::int from public.evidence_links
            where owner_type = 'application_document' and user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'an empty sources array clears the slot''s citation rows');

select * from finish();
rollback;
