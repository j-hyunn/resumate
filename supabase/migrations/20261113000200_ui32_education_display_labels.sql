-- UI32-2: an education's display name is trimmed program_name, else trimmed institution_name, else null
-- (user decision 2026-11-04, UQ-739 "근거 칩·서류 교육 이름"). Applies everywhere an education name is built for a
-- label: draft_section_sources.source_label ("부모 › 프로젝트", DM §2.7) and evidence_links.source_label (education
-- sources), including rows already stored.
-- Not destructive: no rows are deleted; source_label values of rows whose source still exists are rewritten.

-- ── helpers ─────────────────────────────────────────────────────────────────
-- Trims the same characters as JS String.prototype.trim() (ECMAScript WhiteSpace + LineTerminator): U+0009–U+000D,
-- U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. btrim() only strips U+0020,
-- so a tab-only or full-width-space (U+3000, common from Korean IMEs) name written straight through PostgREST would
-- otherwise give a different label than src/server/services/career/education-name.ts. U+0085 is not trimmed (JS
-- doesn't either).
create or replace function private.trim_js_whitespace(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select regexp_replace(
    p_value,
    '^[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+'
    || '|[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$',
    '', 'g');
$$;

revoke all on function private.trim_js_whitespace(text) from public;

create or replace function private.education_display_name(p_program_name text, p_institution_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(nullif(private.trim_js_whitespace(p_program_name), ''),
                  nullif(private.trim_js_whitespace(p_institution_name), ''));
$$;

revoke all on function private.education_display_name(text, text) from public;

-- ── label builders (20261102000200): education parent = display name ───────
create or replace function private.draft_source_parent_name(p_user_id uuid, p_experience_id uuid, p_education_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.company_name from public.experiences e where e.id = p_experience_id and e.user_id = p_user_id),
    (select private.education_display_name(ed.program_name, ed.institution_name)
       from public.educations ed where ed.id = p_education_id and ed.user_id = p_user_id));
$$;

revoke all on function private.draft_source_parent_name(uuid, uuid, uuid) from public;

-- draft_source_label and draft_sources_mark_project_deleted read draft_source_parent_name, so they follow the new
-- rule unchanged. The education delete trigger used old.institution_name directly:
create or replace function private.draft_sources_mark_education_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.education_display_name(old.program_name, old.institution_name);
begin
  update public.draft_section_sources s
     set source_deleted_at = now(),
         source_label = left(coalesce(
           case when s.project_id is null then v_name
                else v_name || ' › '
                     || (select p.name from public.projects p where p.id = s.project_id and p.user_id = s.user_id)
           end,
           s.source_label,
           v_name), 300)
   where s.user_id = old.user_id and s.education_id = old.id and s.source_deleted_at is null;
  return null;
end;
$$;

revoke all on function private.draft_sources_mark_education_deleted() from public;

-- ── backfill of stored labels ──────────────────────────────────────────────
-- Kept (not dropped after the one-time call below) so pgTAP can run the same rules on fixture rows. It is an
-- operator-only, idempotent rewrite of every user's education labels: owner postgres, execute revoked from public,
-- and no grant to anon / authenticated / service_role / app_ai_writer / app_key_reader. Never grant execute on it;
-- if it must run again (e.g. after a bulk import that bypassed the save RPCs), run it as postgres. Rows whose source is gone are left alone
-- (their label is the pre-deletion snapshot), except a deleted project under a live education, whose parent part
-- is replaced only when it matches the label format the code wrote ("<institution_name> › <project>").
--   evidence_links  : source_type = 'education', education still exists -> display name (code wrote
--                     institution_name; project labels carry no parent, so no other source_type is touched).
--   draft_section_sources, education_id set, education still exists:
--     (a) live source (source_deleted_at null; project_id null or the project exists) -> private.draft_source_label,
--         i.e. exactly what the S7 / R4 save RPCs write today ("<display> › <project>" or "<display>").
--     (b) project deleted (source_deleted_at set, project gone) and the label starts with
--         "<institution_name> › " -> "<display> › <rest>".
-- A null display name (program and institution both blank) never overwrites a label.
create or replace function private.backfill_education_display_labels()
returns table (evidence_links_updated integer, draft_sources_updated integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_el integer;
  v_live integer;
  v_deleted integer;
begin
  update public.evidence_links el
     set source_label = left(private.education_display_name(ed.program_name, ed.institution_name), 300)
    from public.educations ed
   where el.source_type = 'education'
     and ed.id = el.source_id and ed.user_id = el.user_id
     and private.education_display_name(ed.program_name, ed.institution_name) is not null
     and el.source_label is distinct from left(private.education_display_name(ed.program_name, ed.institution_name), 300);
  get diagnostics v_el = row_count;

  with c as (
    select s.id, private.draft_source_label(s.user_id, null, s.education_id, s.project_id) as label
      from public.draft_section_sources s
      join public.educations ed on ed.id = s.education_id and ed.user_id = s.user_id
     where s.source_deleted_at is null
       and (s.project_id is null
            or exists (select 1 from public.projects p where p.id = s.project_id and p.user_id = s.user_id))
  )
  update public.draft_section_sources s
     set source_label = c.label
    from c
   where s.id = c.id and c.label is not null and s.source_label is distinct from c.label;
  get diagnostics v_live = row_count;

  with c as (
    select s.id,
           left(private.education_display_name(ed.program_name, ed.institution_name) || ' › '
                || substr(s.source_label, char_length(ed.institution_name || ' › ') + 1), 300) as label
      from public.draft_section_sources s
      join public.educations ed on ed.id = s.education_id and ed.user_id = s.user_id
     where s.source_deleted_at is not null
       and s.project_id is not null
       and not exists (select 1 from public.projects p where p.id = s.project_id and p.user_id = s.user_id)
       and nullif(private.trim_js_whitespace(ed.institution_name), '') is not null
       and private.education_display_name(ed.program_name, ed.institution_name) is not null
       and left(s.source_label, char_length(ed.institution_name || ' › ')) = ed.institution_name || ' › '
  )
  update public.draft_section_sources s
     set source_label = c.label
    from c
   where s.id = c.id and s.source_label is distinct from c.label;
  get diagnostics v_deleted = row_count;

  return query select v_el, v_live + v_deleted;
end;
$$;

revoke all on function private.backfill_education_display_labels() from public;

comment on function private.backfill_education_display_labels() is
  'UI32-2 one-time backfill of education display names into evidence_links.source_label and '
  'draft_section_sources.source_label. Idempotent (only rows whose label differs are updated; nothing is deleted). '
  'Kept so pgTAP can exercise the same rules. Operator-only: execute is revoked from public and must not be granted '
  'to any client, server, or AI role; re-run only as postgres.';

select * from private.backfill_education_display_labels();
