-- R15 (DM 11.10 #1·#2·#4·#5·#5a·#5b·#9, §2.6, §2.6.2 — CF-2·CF-9·CF-10·CF-A5·CF-A7·CF-A8·CF-A17, AI 요청 1~3):
-- job_descriptions.source_url, the (user_id, created_at desc) index, the jd_preview ai_jobs combination (CHECK kept
-- for old rows), and create_application_project's source_url.
-- R17: the preview linking / applying / skipping, apply_jd_extraction's deadline branch, and the unused-preview
-- cleanup were removed with those functions (r17_jd_raw_text.test.sql checks they are gone).
begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to app_ai_writer;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- ── schema (11.10 #1·#5·#5a) ──
select has_column('public', 'job_descriptions', 'source_url', 'job_descriptions.source_url added');
select has_index('public', 'application_projects', 'application_projects_user_id_created_at_idx',
                 'S-13 "최근 작성 순" index (user_id, created_at desc)');
select ok(not has_column_privilege('authenticated', 'public.job_descriptions', 'source_url', 'UPDATE'),
          'no user update grant on source_url (the create RPC writes it)');
select ok(not has_column_privilege('app_ai_writer', 'public.job_descriptions', 'source_url', 'SELECT'),
          'app_ai_writer cannot read source_url (a URL never goes into a prompt)');
select throws_ok($$insert into public.job_descriptions (user_id, application_project_id, raw_text, raw_text_hash,
                                                        sentences, source_url)
                   values ('a0000000-0000-0000-0000-000000000001', null, 'x', 'h', '[]', 'ftp://x.test')$$,
                 '23502', null, 'the CHECK and the FK both guard the row (ftp never reaches the DB)');

-- ── ai_jobs: the jd_preview combination (CF-A17) ──
select lives_ok($$insert into public.ai_jobs (id, user_id, job_type, target_type, target_id,
                    application_project_id, status, run_generation, provider, model_tier, connection_tier,
                    params, finished_at, output)
                  values ('a0000000-7777-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
                          'jd_extraction', 'jd_preview', null, null, 'succeeded', 1, 'gemini', 'light', 'free',
                          '{}'::jsonb, now(), '{}'::jsonb)$$,
                'jd_preview before linking: target_id and application_project_id both null');
select throws_ok($$insert into public.ai_jobs (user_id, job_type, target_type, target_id,
                     application_project_id, status, run_generation, provider, model_tier, connection_tier)
                   values ('a0000000-0000-0000-0000-000000000001', 'jd_extraction', 'jd_preview',
                           'a0000000-1d00-0000-0000-00000000ffff', null, 'succeeded', 1, 'gemini', 'light',
                           'free')$$,
                 '23514', null, 'jd_preview with only one of the two keys filled is refused');
delete from public.ai_jobs;

-- ── create_application_project: source_url and the preview ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.create_application_project('a0000000-aaaa-0000-0000-00000000000e', '원문', 'h',
                     '[{"sid":"S1","text":"원문","start":0,"end":2}]', null, null, null, null, 'ftp://x.test')$$,
                 'P0001', 'invalid_source_url', 'a non-http(s) source_url -> invalid_source_url (400)');
select throws_ok(format($$select public.create_application_project('a0000000-aaaa-0000-0000-00000000000e', '원문',
                     'h', '[{"sid":"S1","text":"원문","start":0,"end":2}]', null, null, null, null, '%s')$$,
                     'https://x.test/' || repeat('a', 2048)),
                 'P0001', 'invalid_source_url', 'a source_url over 2,048 characters -> invalid_source_url');
select is((select count(*)::int from public.application_projects where user_id = 'a0000000-0000-0000-0000-000000000001'), 0,
          'an invalid_source_url wrote no row (the screen may resend the same p_id without it)');
select ok(public.create_application_project('a0000000-aaaa-0000-0000-00000000000e', '원문', 'h',
            '[{"sid":"S1","text":"원문","start":0,"end":2}]', null, null, null, null,
            'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1&utm_source=x') ? 'created',
          'a valid source_url is accepted');
select is((select source_url from public.job_descriptions
            where application_project_id = 'a0000000-aaaa-0000-0000-00000000000e'),
          'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=1&utm_source=x',
          'the URL is stored as given, tracking query included (DM §2.6 `[가정]`)');

reset role;

select * from finish();
rollback;
