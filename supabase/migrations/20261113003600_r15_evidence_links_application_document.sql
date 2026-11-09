-- R15 / D10 (DM 11.8 #7, §2.8 "서류 근거" — CL-5 · v4.12 SD-A19 · v4.14 RM-1 · v4.15 CF-1·CF-A4·CF-M1)
-- Document evidence: owner_type = 'application_document', owner_id = the document row id, item_key =
-- '{slot}.blocks.{block_id}' or '{slot}.sources.{n}' (slot = q_{n}).
-- This file replaces private.evidence_links_check_source ONCE (DM 11.8 (2) stage 3, cl-audit 권고 11): the same
-- function carries SD-A19's profile block, so it must not be replaced twice in this cycle.
--   * owner_type CHECK gains 'application_document'. 'draft_section' stays in the list for now (its rows are 0 but
--     the value is removed only in the destructive migration, where the guard proves it); new draft_section rows
--     are refused by the trigger from here on.
--   * The per-owner allowed source list now lives in one function the trigger reads, and save_application_document uses the same list
--     (R-SD-9 — if the two differ, only the trigger refuses and the RPC lies).
--   * user_note: the "the question is gone" judgement moves out of the trigger (the question is a jsonb element,
--     not a row — AI 요청 4). save_application_document decides; the trigger only checks the shape.

alter table public.evidence_links drop constraint evidence_links_owner_type_check;
alter table public.evidence_links
  add constraint evidence_links_owner_type_check
    check (owner_type in ('insight', 'draft_section', 'chat_message', 'application_document'));

-- R15: the per-owner allowed source list, in ONE place. The insert trigger below and
-- public.save_application_document both read it (DM §2.8 "insert 트리거와 저장 RPC가 같은 목록을 쓴다", R-SD-9).
-- null = not constrained (chat_message is a Should with no producer yet).
create or replace function private.evidence_allowed_sources(p_owner_type text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  -- (v4.12, SD-A19) career sources of a new row: 5 values, profile is gone.
  select case p_owner_type
    when 'insight' then array['experience', 'education', 'project', 'project_deliverable', 'skill',
                              'jd_requirement', 'jd_sentence']
    -- (v4.14, RM-1) the mock-practice answer source is gone; a cover letter question may cite its own note.
    when 'application_document' then array['experience', 'education', 'project', 'project_deliverable', 'skill',
                                           'jd_requirement', 'jd_sentence', 'user_note']
  end;
$$;

revoke all on function private.evidence_allowed_sources(text) from public, anon;
grant execute on function private.evidence_allowed_sources(text) to authenticated;

create or replace function private.evidence_links_check_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed text[];
  v_exists boolean;
  v_jd_project uuid;
  v_sentences jsonb;
  v_sentence jsonb;
  v_sid text;
  v_start numeric;
  v_end numeric;
  v_affiliated boolean;
begin
  -- R13 (v4.12, SD-A19): profile is never a source of a new evidence row. The CHECK list keeps the value so
  -- that existing rows stay valid; this one line stops new ones, with the same code as the other source errors.
  if new.source_type = 'profile' then
    raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
      detail = 'profile is not an evidence source (v4.12)';
  end if;

  -- R15 (CL-3·CL-5): the drafts tables are gone from the design; no new row may hang off a draft section.
  -- Existing rows (0 in production, re-checked by the destructive migration's guard) stay valid.
  if new.owner_type = 'draft_section' then
    raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
      detail = 'draft_section is not an evidence owner (v4.13)';
  end if;

  -- R15: per-owner allowed sources (DM §2.8 — the same list save_application_document uses).
  v_allowed := private.evidence_allowed_sources(new.owner_type);
  if v_allowed is not null and not (new.source_type = any (v_allowed)) then
    raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
      detail = new.source_type || ' is not an allowed source of ' || new.owner_type;
  end if;

  if new.source_type = 'jd_requirement' then
    select jd.application_project_id into v_jd_project
      from public.jd_requirements r
      join public.job_descriptions jd on jd.id = r.job_description_id
     where r.id = new.source_id and r.user_id = new.user_id;
    v_exists := found;
    if v_exists and v_jd_project is distinct from new.application_project_id then
      raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
        detail = 'jd_requirement of another application project';
    end if;

  elsif new.source_type = 'jd_sentence' then
    select jd.application_project_id, jd.sentences into v_jd_project, v_sentences
      from public.job_descriptions jd
     where jd.id = new.source_id and jd.user_id = new.user_id;
    v_exists := found;
    if v_exists then
      if v_jd_project is distinct from new.application_project_id then
        raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
          detail = 'jd_sentence of another application project';
      end if;
      -- (CF-S1) A slot-level citation (`{slot}.sources.{n}`) names the posting as a whole and carries no
      -- locator; a block citation still must point at a range inside one sentence.
      if new.source_locator is null and new.item_key ~ '\.sources\.[0-9]+$' then
        return new;
      end if;
      if new.source_locator is null
         or jsonb_typeof(new.source_locator -> 'sid') is distinct from 'string'
         or jsonb_typeof(new.source_locator -> 'start') is distinct from 'number'
         or jsonb_typeof(new.source_locator -> 'end') is distinct from 'number'
         or (new.source_locator ->> 'start') !~ '^[0-9]+$'
         or (new.source_locator ->> 'end') !~ '^[0-9]+$' then
        raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
          detail = 'jd_sentence source_locator must be {sid, start, end}';
      end if;
      v_sid := new.source_locator ->> 'sid';
      v_start := (new.source_locator ->> 'start')::numeric;
      v_end := (new.source_locator ->> 'end')::numeric;
      select e into v_sentence from jsonb_array_elements(v_sentences) e where e ->> 'sid' = v_sid limit 1;
      if v_sentence is null
         or v_start >= v_end
         or v_start < (v_sentence ->> 'start')::numeric
         or v_end > (v_sentence ->> 'end')::numeric then
        raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
          detail = 'jd_sentence locator outside the JD sentences';
      end if;
    end if;

  elsif new.source_type = 'user_note' then
    -- R15 (CL-5·CL-8, AI 요청 4): source_id = application_documents.body -> questions[].question_id, a uuid inside
    -- jsonb. A trigger cannot tell "the question is gone", so save_application_document judges that and the
    -- "원본 삭제됨" marking; here only the shape is checked (source_field must be null —
    -- evidence_links_source_field_check already enforces it) and the row is taken as live.
    v_exists := true;

  elsif new.source_type = 'project' then
    -- R4 (DM v4.4 §2.8, AI V-2 DB defense): the field must fit the project kind. Affiliated projects carry STAR,
    -- standalone ones carry role / description; name / period fit both.
    select num_nonnulls(p.experience_id, p.education_id) = 1 into v_affiliated
      from public.projects p where p.id = new.source_id and p.user_id = new.user_id;
    v_exists := found;
    if v_exists
       and ((v_affiliated and new.source_field in ('role', 'description'))
            or (not v_affiliated and new.source_field in ('situation', 'task', 'action', 'result', 'learnings'))) then
      raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
        detail = 'project field does not fit the project kind';
    end if;

  else
    v_exists := case new.source_type
      -- 'profile' is refused at the top of this function (R13), so it never reaches here.
      when 'experience' then exists (select 1 from public.experiences where id = new.source_id and user_id = new.user_id)
      when 'education' then exists (select 1 from public.educations where id = new.source_id and user_id = new.user_id)
      when 'project_deliverable' then exists (select 1 from public.project_deliverables
                                                where id = new.source_id and user_id = new.user_id)
      when 'skill' then exists (select 1 from public.skills where id = new.source_id and user_id = new.user_id)
      else true
    end;
  end if;

  if not v_exists then
    new.quote := null;
    new.source_deleted_at := coalesce(new.source_deleted_at, now());
  end if;
  return new;
end;
$$;

-- R15 / CF-S1 (사용자 결정 2026-11-09; the document change is PR #68, not merged into this worktree)
-- A slot-level citation row (`{slot}.sources.{n}`) comes from the AI draft's `sources[]`, whose element is
-- {source_type, source_id, role} — it names the career item or the requirement as a whole and carries NO field.
-- evidence_links_source_field_check demands a field for every career source type, so the rule is relaxed for
-- these rows only (recognised by the item_key shape). Block evidence (`{slot}.blocks.{block_id}`) stays strict.
-- Logged in _workspace/backend/spec-gaps.md: DM §2.8's element shape and this CHECK disagreed.
alter table public.evidence_links drop constraint evidence_links_source_field_check;
alter table public.evidence_links
  add constraint evidence_links_source_field_check
    check (coalesce(
      case
        when item_key ~ '\.sources\.[0-9]+$' and source_field is null then true
        else case source_type
          when 'profile' then source_field = any (array['desired_job_title', 'total_years_of_experience',
                                                        'interested_industries'])
          when 'experience' then source_field = any (array['job_rank', 'job_position', 'department', 'summary',
                                                           'period'])
          when 'education' then source_field = any (array['institution_name', 'program_name', 'education_type',
                                                          'enrollment_status', 'period', 'description'])
          when 'project' then source_field = any (array['name', 'period', 'situation', 'task', 'action', 'result',
                                                        'learnings', 'role', 'description'])
          when 'project_deliverable' then source_field = any (array['title', 'body'])
          when 'skill' then source_field = 'name'
          else source_field is null
        end
      end, false));
