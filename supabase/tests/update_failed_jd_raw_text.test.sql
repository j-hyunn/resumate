-- W0 Q53-2 + Q53-11 (DM 2.6.1, A.6): update_failed_jd_raw_text conditions in order, reset values, the guard trigger,
-- privileges, other users.
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();
create schema w0t;
grant usage on schema w0t to authenticated, app_ai_writer;

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- One project + JD per scenario. n -> project ...00n, JD ...00n, job ...00n.
create function w0t.pid(n int) returns uuid language sql immutable as
  $$ select ('a0000000-aaaa-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function w0t.jid(n int) returns uuid language sql immutable as
  $$ select ('a0000000-dddd-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function w0t.job(n int) returns uuid language sql immutable as
  $$ select ('a0000000-7777-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
grant execute on all functions in schema w0t to authenticated, app_ai_writer;

-- p_jd_status: JD extraction status; p_job_status / p_err: its extraction job (null = no job row).
create function w0t.mk(n int, p_jd_status text, p_job_status text default null, p_err text default null) returns void
language plpgsql as $$
declare
  v_uid uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  insert into public.application_projects (id, user_id, name, name_source)
    values (w0t.pid(n), v_uid, '프로젝트' || n, 'user');
  if p_job_status is not null then
    insert into public.ai_jobs (id, user_id, job_type, application_project_id, target_type, target_id, status, error_code,
                                run_generation, provider, model_tier, connection_tier)
    values (w0t.job(n), v_uid, 'jd_extraction', w0t.pid(n), 'job_description', w0t.jid(n), p_job_status,
            p_err, 1, 'gemini', 'light', 'free');
  end if;
  if p_jd_status = 'succeeded' then
    insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                         extraction_status, extraction, tech_keywords, requirements_hash,
                                         extraction_provider, extraction_model, extraction_job_id, detected_language,
                                         company_name, company_name_source, position_title, position_title_source)
    values (w0t.jid(n), v_uid, w0t.pid(n), '옛 원문', 'old', '[{"sid":"S1","text":"옛 원문","start":0,"end":4}]',
            'succeeded', '{"a":1}', '[]', 'rh', 'gemini', 'm', case when p_job_status is not null then w0t.job(n) end, 'ko',
            'AI 회사', 'ai', '내 포지션', 'user');
  else
    insert into public.job_descriptions (id, user_id, application_project_id, raw_text, raw_text_hash, sentences,
                                         extraction_status, extraction_job_id, extraction_provider, extraction_model,
                                         company_name, company_name_source, position_title, position_title_source)
    values (w0t.jid(n), v_uid, w0t.pid(n), '옛 원문', 'old', '[{"sid":"S1","text":"옛 원문","start":0,"end":4}]',
            p_jd_status, case when p_job_status is not null then w0t.job(n) end, 'gemini', 'm',
            '내 회사', 'user', 'AI 포지션', 'ai');
  end if;
end $$;

create function w0t.edit(n int, p_text text default '새 원문') returns jsonb language sql as $$
  select public.update_failed_jd_raw_text(w0t.pid(n), p_text, 'newhash', '[{"sid":"S1","text":"새 원문","start":0,"end":4}]');
$$;
grant execute on all functions in schema w0t to authenticated, app_ai_writer;

select w0t.mk(1, 'failed', 'failed', 'not_a_jd');
select w0t.mk(2, 'failed', 'failed', 'input_too_long');
select w0t.mk(3, 'failed', 'failed', 'safety_blocked');
select w0t.mk(4, 'running', 'failed', 'not_a_jd');         -- trigger skipped: running + failed job
select w0t.mk(5, 'succeeded');                             -- Q53-11: 0 requirements
select w0t.mk(6, 'pending');                               -- 2: before extraction / already edited
select w0t.mk(7, 'failed', 'running');                     -- 1: extraction job running (also a failed JD)
select w0t.mk(8, 'failed', 'failed', 'rate_limited');      -- 4: provider cause
select w0t.mk(9, 'failed');                                -- 4: job pruned
select w0t.mk(10, 'failed', 'failed', 'not_a_jd');         -- 3: a requirement exists
select w0t.mk(11, 'succeeded');                            -- 3: succeeded with a requirement
select w0t.mk(12, 'succeeded');                            -- 5: ready insight
select w0t.mk(13, 'succeeded');                            -- unused (R14: interview question check removed)
select w0t.mk(14, 'succeeded');                            -- 5: draft section with ai_content
select w0t.mk(15, 'succeeded');                            -- 5: jd_sentence evidence
select w0t.mk(16, 'failed', 'failed', 'not_a_jd');         -- 6: unchanged
select w0t.mk(17, 'running', 'canceled', 'canceled');      -- 2: running + canceled job is not "failed"
select w0t.mk(18, 'failed', 'failed', 'not_a_jd');         -- 1: another type's job queued
select w0t.mk(19, 'failed', 'failed', 'insufficient_data'); -- 4: not an AI-01 input cause
select w0t.mk(20, 'failed', 'failed', 'not_a_jd');         -- key-state output

insert into public.jd_requirements (user_id, job_description_id, category, content, source_sids) values
  ('a0000000-0000-0000-0000-000000000001', w0t.jid(10), 'required', 'x', '{S1}'),
  ('a0000000-0000-0000-0000-000000000001', w0t.jid(11), 'required', 'x', '{S1}');
insert into public.ai_jobs (user_id, job_type, application_project_id, target_type, target_id, status, run_generation, provider, model_tier, connection_tier)
values ('a0000000-0000-0000-0000-000000000001', 'insight', w0t.pid(18), 'application_project', w0t.pid(18), 'queued', 1, 'gemini', 'default', 'free');
insert into public.insights (user_id, application_project_id, version_no, is_latest, status, result, match_stage_result, requirements_hash, completed_at,
                             schema_version, prompt_version, provider, model, model_tier, connection_tier, input_hash, career_snapshot_hash)
values ('a0000000-0000-0000-0000-000000000001', w0t.pid(12), 1, true, 'ready', '{}', '{}', 'rh', now(), 1, 'p', 'gemini', 'm', 'default', 'free', 'i', 'c');
insert into public.drafts (id, user_id, application_project_id, draft_type, title, status)
  values ('a0000000-eeee-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000001', w0t.pid(14), 'cover_letter', 't', 'composing');
insert into public.draft_sections (user_id, draft_id, sort_order, section_kind, question_text, count_basis, ai_content, status)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-eeee-0000-0000-000000000014', 0, 'cover_letter_question', 'q', 'with_spaces', '[]', 'failed');
-- 15 owner: a section of its own project's draft; evidence through a direct row (superuser).
insert into public.drafts (id, user_id, application_project_id, draft_type, title, status)
  values ('a0000000-eeee-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', w0t.pid(15), 'cover_letter', 't', 'composing');
insert into public.draft_sections (id, user_id, draft_id, sort_order, section_kind, question_text, count_basis, status)
  values ('a0000000-e5e5-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', 'a0000000-eeee-0000-0000-000000000015', 0, 'cover_letter_question', 'q', 'with_spaces', 'pending');
insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, source_type, source_id, source_locator, sort_order)
  values ('a0000000-0000-0000-0000-000000000001', w0t.pid(15), 'draft_section', 'a0000000-e5e5-0000-0000-000000000015', 'b1',
          'jd_sentence', w0t.jid(15), '{"sid":"S1","start":0,"end":1}', 0);
update public.application_projects set last_activity_at = '2026-01-01';

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- ── refusals, in order ──
select throws_ok($$select public.update_failed_jd_raw_text(w0t.pid(1), '   ', 'h', '[]')$$, 'P0001', 'invalid_raw_text', 'blank text');
select throws_ok($$select public.update_failed_jd_raw_text(w0t.pid(1), repeat('x', 50001), 'h', '[]')$$, 'P0001', 'invalid_raw_text', 'text over 50,000');
select throws_ok($$select public.update_failed_jd_raw_text(w0t.pid(1), '새', ' ', '[]')$$, 'P0001', 'invalid_raw_text_hash', 'blank hash');
select throws_ok($$select public.update_failed_jd_raw_text(w0t.pid(1), '새', 'h', '{}')$$, 'P0001', 'invalid_sentences', 'bad sentences');
select throws_ok($$select w0t.edit(999)$$, 'P0001', 'job_description_not_found', 'unknown project');
select throws_ok($$select w0t.edit(7)$$, 'P0001', 'jd_job_in_progress', '1: extraction job running');
select throws_ok($$select w0t.edit(18)$$, 'P0001', 'jd_job_in_progress', '1: any job type on the project');
select throws_ok($$select w0t.edit(6)$$, 'P0001', 'jd_raw_text_locked', '2: pending');
select throws_ok($$select w0t.edit(17)$$, 'P0001', 'jd_raw_text_locked', '2: running + canceled job');
select throws_ok($$select w0t.edit(10)$$, 'P0001', 'jd_raw_text_locked', '3: failed with a requirement');
select throws_ok($$select w0t.edit(11)$$, 'P0001', 'jd_raw_text_locked', '3: succeeded with a requirement');
select throws_ok($$select w0t.edit(8)$$, 'P0001', 'jd_failure_not_input', '4: provider cause');
select throws_ok($$select w0t.edit(19)$$, 'P0001', 'jd_failure_not_input', '4: insufficient_data is out');
select throws_ok($$select w0t.edit(9)$$, 'P0001', 'jd_failure_not_input', '4: job pruned, cause unknown');
select throws_ok($$select w0t.edit(12)$$, 'P0001', 'jd_has_results', '5: ready insight');
select throws_ok($$select w0t.edit(14)$$, 'P0001', 'jd_has_results', '5: draft section ai_content');
select throws_ok($$select w0t.edit(15)$$, 'P0001', 'jd_has_results', '5: JD evidence');
select throws_ok($$select w0t.edit(16, '옛 원문')$$, 'P0001', 'jd_raw_text_unchanged', '6: same text');
select throws_ok($$select w0t.edit(16, E'  옛 원문\n')$$, 'P0001', 'jd_raw_text_unchanged', '6: surrounding whitespace only');
select is((select extraction_status from public.job_descriptions where id = w0t.jid(16)), 'failed', 'refusal leaves the row alone');

-- ── allowed ──
select is(public.update_failed_jd_raw_text(w0t.pid(1), '새 원문', ' newhash ', '[{"sid":"S1","text":"새 원문","start":0,"end":4}]') - 'raw_text_edited_at',
          jsonb_build_object('application_project_id', w0t.pid(1), 'job_description_id', w0t.jid(1),
                             'extraction_status', 'pending', 'ai_run_allowed', false),
          'failed + not_a_jd: return shape');
select ok((w0t.edit(2) ->> 'raw_text_edited_at') is not null, 'failed + input_too_long');
select ok((w0t.edit(3) ->> 'extraction_status') = 'pending', 'failed + safety_blocked');
select ok((w0t.edit(4) ->> 'extraction_status') = 'pending', 'running + failed job counts as failed');
select ok((w0t.edit(5) ->> 'extraction_status') = 'pending', 'Q53-11: succeeded + 0 requirements, condition 4 skipped');

-- ── values ──
select results_eq($$select raw_text, raw_text_hash, sentences -> 0 ->> 'text', extraction_status, extraction_job_id, extraction_provider, extraction_model,
                           company_name, company_name_source, position_title, position_title_source, raw_text_edited_at = now()
                      from public.job_descriptions where id = w0t.jid(1)$$,
                  $$values ('새 원문'::text, 'newhash'::text, '새 원문'::text, 'pending'::text, null::uuid, null::text, null::text,
                            '내 회사'::text, 'user'::text, null::text, null::text, true)$$,
                  'failed row reset: user value kept, AI value cleared');
select results_eq($$select detected_language, extraction, tech_keywords, requirements_hash, extraction_status,
                           company_name, company_name_source, position_title, position_title_source
                      from public.job_descriptions where id = w0t.jid(5)$$,
                  $$values (null::text, null::jsonb, null::jsonb, null::text, 'pending'::text,
                            null::text, null::text, '내 포지션'::text, 'user'::text)$$,
                  'succeeded row reset: extraction values cleared, user value kept');
select is((select (last_activity_at = now())::text || name from public.application_projects where id = w0t.pid(1)), 'true프로젝트1',
          'last_activity_at moved, name untouched');
select is((select status from public.ai_jobs where id = w0t.job(1)), 'failed', 'finished jobs untouched');
select throws_ok($$select w0t.edit(1, '또 새 원문')$$, 'P0001', 'jd_raw_text_locked', 'after an edit: pending until re-extraction');
reset role;


-- ai_run_allowed true with a usable key.
insert into public.ai_provider_keys (id, user_id, provider, connection_tier, key_ciphertext, key_nonce, wrapped_dek, kek_id, key_last4, status) values
  ('a0000000-9999-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'gemini', 'free', '\x01', '\x02', '\x03', 'env-v1', 'ag01', 'valid');
insert into public.ai_data_use_consents (user_id, provider, connection_tier, disclosure_version, free_tier_acknowledged) values
  ('a0000000-0000-0000-0000-000000000001', 'gemini', 'free', 'v2026-11-05', true);
update public.profiles set active_ai_provider = 'gemini' where id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(w0t.edit(20) ->> 'ai_run_allowed', 'true', 'ai_run_allowed reflects the connection');
reset role;

-- ── another user ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select w0t.edit(16, '남의 원문')$$, 'P0001', 'job_description_not_found', 'other user: not found');
select is((select count(*)::int from public.job_descriptions), 0, 'other user sees no JD');
reset role;
select is((select raw_text from public.job_descriptions where id = w0t.jid(16)), '옛 원문', 'other user changed nothing');

-- ── privileges ──
select ok(not has_function_privilege('anon', 'public.update_failed_jd_raw_text(uuid, text, text, jsonb)', 'execute'), 'anon: no execute');
select ok(not has_function_privilege('app_ai_writer', 'public.update_failed_jd_raw_text(uuid, text, text, jsonb)', 'execute'), 'app_ai_writer: no execute');
select ok(not has_function_privilege('service_role', 'public.update_failed_jd_raw_text(uuid, text, text, jsonb)', 'execute'), 'service_role: no execute');
select ok(has_function_privilege('authenticated', 'public.update_failed_jd_raw_text(uuid, text, text, jsonb)', 'execute'), 'authenticated: execute');
select ok(not has_table_privilege('authenticated', 'public.job_descriptions', 'update'), 'authenticated: still no update on the table');
select ok(has_column_privilege('authenticated', 'public.job_descriptions', 'raw_text_edited_at', 'select'), 'authenticated reads raw_text_edited_at');

-- ── guard trigger: every path outside one edit ──
select w0t.mk(30, 'failed', 'failed', 'not_a_jd');
select w0t.mk(31, 'pending');
select w0t.mk(32, 'succeeded');
select throws_ok($$update public.job_descriptions set raw_text = 'x' where id = w0t.jid(30)$$, 'P0001', 'job_description_immutable', 'guard: text alone');
select throws_ok($$update public.job_descriptions set raw_text = 'x', extraction_status = 'pending' where id = w0t.jid(30)$$, 'P0001', 'job_description_immutable', 'guard: no stamp');
select throws_ok($$update public.job_descriptions set raw_text = 'x', raw_text_edited_at = now() where id = w0t.jid(30)$$, 'P0001', 'job_description_immutable', 'guard: status not pending');
select throws_ok($$update public.job_descriptions set raw_text = 'x', raw_text_edited_at = now(), extraction_status = 'pending' where id = w0t.jid(31)$$, 'P0001', 'job_description_immutable', 'guard: from pending');
select throws_ok($$update public.job_descriptions set raw_text_edited_at = now() where id = w0t.jid(30)$$, 'P0001', 'job_description_immutable', 'guard: stamp alone');
select throws_ok($$update public.job_descriptions set extraction_status = 'pending', extraction = null, tech_keywords = null, requirements_hash = null where id = w0t.jid(32)$$,
                 'P0001', 'job_description_immutable', 'guard: succeeded -> pending without the stamp');
select throws_ok($$update public.job_descriptions set application_project_id = w0t.pid(31), raw_text = 'x', raw_text_edited_at = now(), extraction_status = 'pending' where id = w0t.jid(30)$$,
                 'P0001', 'job_description_immutable', 'guard: project stays immutable even with an edit');
select lives_ok($$update public.job_descriptions set raw_text = 'x', raw_text_hash = 'x', raw_text_edited_at = now(), extraction_status = 'pending', extraction = null, tech_keywords = null, requirements_hash = null where id = w0t.jid(32)$$,
                'guard: succeeded -> pending with the stamp');
select lives_ok($$update public.job_descriptions set extraction_status = 'running' where id = w0t.jid(31)$$, 'guard: ordinary status moves pass');

select * from finish();
rollback;
