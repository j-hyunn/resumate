-- S6 career deletion impact on insights (DM §4.2, F-COM-04): get_deletion_impact.by_application_project[] and
-- delete_career_item(result_mode) per insight version, latest re-pick [가정 S6-3].
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.test', 'authenticated', 'authenticated');

-- A's career (as the user):
--   E1 ─ PR1 ─ D1 ─ ACH1        E2 ─ ACH2 (experience-level)        SK1 (skill)
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.experiences (id, company_name, start_month, job_rank) values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'E1', '2020-01-01', 'S'),
  ('aaaaaaaa-1111-0000-0000-000000000002', 'E2', '2018-01-01', 'J');
insert into public.projects (id, experience_id, name, role)
  values ('aaaaaaaa-3333-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'PR1', 'Dev');
insert into public.project_details (id, project_id, title, situation, action)
  values ('aaaaaaaa-4444-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000001', 'D1', 's', '인덱스 재설계');
insert into public.achievements (id, project_detail_id, experience_id, description) values
  ('aaaaaaaa-5555-0000-0000-000000000001', 'aaaaaaaa-4444-0000-0000-000000000001', null, 'ach1'),
  ('aaaaaaaa-5555-0000-0000-000000000002', null, 'aaaaaaaa-1111-0000-0000-000000000002', 'ach2');
insert into public.skills (id, name) values ('aaaaaaaa-6666-0000-0000-000000000001', 'Postgres');
reset role;

-- Application projects (names chosen to check ordering): AP1 'B 프로젝트', AP2 'A 프로젝트'.
insert into public.application_projects (id, user_id, name, name_source) values
  ('aaaaaaaa-aaaa-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'B 프로젝트', 'user'),
  ('aaaaaaaa-aaaa-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'A 프로젝트', 'user'),
  ('bbbbbbbb-aaaa-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'BB', 'user');

create function pg_temp.ready_insight(p_id uuid, p_user uuid, p_project uuid, p_version int, p_latest boolean)
returns void language sql as $f$
  insert into public.insights (id, user_id, application_project_id, version_no, is_latest, status, result,
                               match_stage_result, requirements_hash, career_snapshot_hash, input_hash, schema_version,
                               prompt_version, provider, model, model_tier, connection_tier, completed_at)
  values (p_id, p_user, p_project, p_version, p_latest, 'ready', '{}', '{}', 'rh', 'ch', 'ih', 1, 'pv', 'gemini', 'm',
          'default', 'free', now());
$f$;
create function pg_temp.link(p_owner uuid, p_project uuid, p_type text, p_source uuid, p_field text, p_user uuid default 'aaaaaaaa-0000-0000-0000-000000000001')
returns void language sql as $f$
  insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, source_type,
                                     source_id, source_field, quote)
  values (p_user, p_project, 'insight', p_owner, 'strengths.0', p_type, p_source, p_field,
          case when p_field in ('action', 'description') then 'q' end);
$f$;

-- AP1: I1 v1 ready (cites SK1, ACH2), I2 v2 ready latest (cites D1), I3 v3 failed.
-- AP2: I4 v1 ready latest (cites ACH1 twice).
-- B: IB cites a random id (never counted for A).
select pg_temp.ready_insight('aaaaaaaa-1010-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-0000-0000-000000000001', 1, false);
select pg_temp.ready_insight('aaaaaaaa-1010-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-0000-0000-000000000001', 2, true);
insert into public.insights (id, user_id, application_project_id, version_no, status)
  values ('aaaaaaaa-1010-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-0000-0000-000000000001', 3, 'failed');
select pg_temp.ready_insight('aaaaaaaa-1010-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-0000-0000-000000000002', 1, true);
select pg_temp.ready_insight('bbbbbbbb-1010-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-aaaa-0000-0000-000000000001', 1, true);
select pg_temp.link('aaaaaaaa-1010-0000-0000-000000000001', 'aaaaaaaa-aaaa-0000-0000-000000000001', 'skill', 'aaaaaaaa-6666-0000-0000-000000000001', 'name');
select pg_temp.link('aaaaaaaa-1010-0000-0000-000000000001', 'aaaaaaaa-aaaa-0000-0000-000000000001', 'achievement', 'aaaaaaaa-5555-0000-0000-000000000002', 'description');
select pg_temp.link('aaaaaaaa-1010-0000-0000-000000000002', 'aaaaaaaa-aaaa-0000-0000-000000000001', 'project_detail', 'aaaaaaaa-4444-0000-0000-000000000001', 'action');
select pg_temp.link('aaaaaaaa-1010-0000-0000-000000000004', 'aaaaaaaa-aaaa-0000-0000-000000000002', 'achievement', 'aaaaaaaa-5555-0000-0000-000000000001', 'description');
select pg_temp.link('aaaaaaaa-1010-0000-0000-000000000004', 'aaaaaaaa-aaaa-0000-0000-000000000002', 'achievement', 'aaaaaaaa-5555-0000-0000-000000000001', 'metric');
select pg_temp.link('bbbbbbbb-1010-0000-0000-000000000001', 'bbbbbbbb-aaaa-0000-0000-000000000001', 'skill', gen_random_uuid(), 'name',
                    'bbbbbbbb-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

create function pg_temp.by_project(p_type text, p_id uuid, p_mode text default 'keep_projects') returns jsonb
language sql as $f$
  select public.get_deletion_impact(p_type, p_id, p_mode) -> 'affected_results' -> 'by_application_project';
$f$;

select is(pg_temp.by_project('project', 'aaaaaaaa-3333-0000-0000-000000000001'),
          '[{"application_project_id": "aaaaaaaa-aaaa-0000-0000-000000000002", "name": "A 프로젝트", "insights": 1,
             "drafts": 0, "draft_sections": 0, "interview_sessions": 0},
            {"application_project_id": "aaaaaaaa-aaaa-0000-0000-000000000001", "name": "B 프로젝트", "insights": 1,
             "drafts": 0, "draft_sections": 0, "interview_sessions": 0}]'::jsonb,
          'project: cascade (detail, its achievement) counted per application project, ordered by name');
select is(pg_temp.by_project('project_detail', 'aaaaaaaa-4444-0000-0000-000000000001'),
          pg_temp.by_project('project', 'aaaaaaaa-3333-0000-0000-000000000001'), 'project_detail: detail + its achievement');
select is(pg_temp.by_project('achievement', 'aaaaaaaa-5555-0000-0000-000000000001'),
          '[{"application_project_id": "aaaaaaaa-aaaa-0000-0000-000000000002", "name": "A 프로젝트", "insights": 1,
             "drafts": 0, "draft_sections": 0, "interview_sessions": 0}]'::jsonb,
          'achievement: two links of one insight count once');
select is(pg_temp.by_project('skill', 'aaaaaaaa-6666-0000-0000-000000000001'),
          '[{"application_project_id": "aaaaaaaa-aaaa-0000-0000-000000000001", "name": "B 프로젝트", "insights": 1,
             "drafts": 0, "draft_sections": 0, "interview_sessions": 0}]'::jsonb, 'skill');
select is(pg_temp.by_project('experience', 'aaaaaaaa-1111-0000-0000-000000000001'), '[]'::jsonb,
          'experience keep_projects: projects stay -> no impact');
select is(jsonb_array_length(pg_temp.by_project('experience', 'aaaaaaaa-1111-0000-0000-000000000001', 'delete_projects')), 2,
          'experience delete_projects: its projects'' citations count');
select is(pg_temp.by_project('experience', 'aaaaaaaa-1111-0000-0000-000000000002') -> 0 ->> 'insights', '1',
          'experience: experience-level achievement cascade counted');
select is(public.get_deletion_impact('project', 'aaaaaaaa-3333-0000-0000-000000000001') -> 'cascade',
          '{"projects": 0, "project_details": 1, "achievements": 1, "project_skills": 0, "writing_chats": 0}'::jsonb,
          'cascade counts unchanged');

-- keep_results: insight stays, its link is marked deleted (S3 trigger).
select lives_ok($$select public.delete_career_item('skill', 'aaaaaaaa-6666-0000-0000-000000000001', 'keep_projects', 'keep_results')$$,
                'delete skill, keep results');
select results_eq($$select count(*)::int, bool_and(quote is null and source_deleted_at is not null)
                      from public.evidence_links where source_id = 'aaaaaaaa-6666-0000-0000-000000000001'$$,
                  $$values (1, true)$$, 'keep_results: link marked source deleted');
select ok(exists (select 1 from public.insights where id = 'aaaaaaaa-1010-0000-0000-000000000001'), 'keep_results: insight kept');

-- delete_results: the citing insight versions go (with their links); AP1 latest falls back to v1.
select is(public.delete_career_item('project', 'aaaaaaaa-3333-0000-0000-000000000001', 'keep_projects', 'delete_results')
            -> 'affected_results' -> 'by_application_project' -> 1 ->> 'insights',
          '1', 'delete_results: return carries the impact computed before deletion');
select set_eq($$select id::text from public.insights$$,
              array['aaaaaaaa-1010-0000-0000-000000000001', 'aaaaaaaa-1010-0000-0000-000000000003'],
              'delete_results: I2 (AP1 latest) and I4 (AP2) deleted; I1 and failed I3 stay');
select is((select count(*)::int from public.evidence_links
            where owner_id in ('aaaaaaaa-1010-0000-0000-000000000002', 'aaaaaaaa-1010-0000-0000-000000000004')), 0,
          'delete_results: their evidence links deleted');
select results_eq($$select id::text, is_latest from public.insights order by version_no$$,
                  $$values ('aaaaaaaa-1010-0000-0000-000000000001'::text, true), ('aaaaaaaa-1010-0000-0000-000000000003', false)$$,
                  'delete_results: newest remaining ready row (v1) becomes latest, failed row never');
select is((select count(*)::int from public.insights where application_project_id = 'aaaaaaaa-aaaa-0000-0000-000000000002'), 0,
          'AP2 has no insight left (no latest)');

select lives_ok($$select public.delete_career_item('experience', 'aaaaaaaa-1111-0000-0000-000000000002', 'keep_projects', 'delete_results')$$,
                'delete E2 (experience-level achievement cited by I1)');
select is((select count(*)::int from public.insights where is_latest), 0, 'no ready row left -> no latest');
select throws_ok($$select public.delete_career_item('skill', gen_random_uuid(), 'keep_projects', 'drop')$$,
                 'P0001', 'invalid_result_mode', 'result_mode still validated');
select is(private.delete_insights_by_ids(array['bbbbbbbb-1010-0000-0000-000000000001'::uuid]), 0,
          'definer helper deletes only the caller''s rows');
reset role;
select ok(exists (select 1 from public.insights where id = 'bbbbbbbb-1010-0000-0000-000000000001'), 'B''s insight untouched');

-- B's impact never counts A's links.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
insert into public.skills (id, name) values ('bbbbbbbb-6666-0000-0000-000000000001', 'Postgres');
select is(public.get_deletion_impact('skill', 'bbbbbbbb-6666-0000-0000-000000000001') -> 'affected_results' -> 'by_application_project',
          '[]'::jsonb, 'B: no impact from unrelated links');
reset role;

select * from finish();
rollback;
