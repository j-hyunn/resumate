-- R15 후속 3 (사용자 확정 CF-S7 = (a), 2026-11-09 — UQ-741) — 서류 저장의 기대 버전 null
-- Only public.save_application_document changes. save_project_page / save_project_deliverable / save_profile_basics
-- are untouched: their create and update are separate arguments, so a null expected version there only comes
-- from "내 내용으로 저장".
--   * A document row exists + p_expected_updated_at is null -> stale_write (409), raise detail = the current
--     updated_at as ISO 8601 UTC (R5-DB-8, the same string as before) -> api: details.current_updated_at.
--   * No row + null -> the first save, as before.
--   * A row + a value -> compared as before.
--   "내 내용으로 저장" now re-sends with the stale_write's current_updated_at instead of null (screen flow).
-- Why documents only: "create when missing, update when present" gave null two meanings (first save / forced
-- overwrite). A tab opened before the row existed had no updated_at to send, so it could replace a document
-- another tab had just created with its empty default questions.
-- Also:
--   * The check now runs right after the row lock (FOR UPDATE), i.e. before the question checks, the evidence
--     write and the 반영됨 기록 — a stale save writes nothing (DM §2.5.1). It used to sit inside the write block,
--     after the question checks; it moved up, and the copy inside the write block is gone. Only the precedence
--     between a 400 question error and a 409 stale_write changed (stale wins now).
--   * Two first saves at the same moment: FOR UPDATE locks nothing when the row does not exist yet, both reach
--     the insert and the unique (application_project_id, document_kind) key stops the second — which used to
--     come back as a raw unique_violation (500). It is now a stale_write carrying the winner's updated_at.
-- Slot numbers are never reused (DM §2.5.0b "슬롯 키 slot (확정)" — "번호는 그 서류에서 한 번 쓰면 재사용하지
-- 않는다"). The rule had no means in the record: a deleted and saved slot vanished from body, so the next visit
-- could hand out q_3 again and the chat's OLD q_3 proposal would attach to the new question (same slot / rev pass
-- the apply and the save). application_documents.slot_high_water `[가정: 이름]` keeps the highest number ever
-- saved; a NEW slot (not in the stored body) must be above it, otherwise invalid_slot (raise detail = that slot).
-- Not in meta: p_meta takes {tone} only (2.5.1). Not writable by the user (the write guard trigger). It is not
-- content, so the dedicated updated_at trigger ignores it too (else the backfill would break every expected
-- version). Order of the checks: expected version -> slot reuse -> the other question checks. Returned as
-- `slot_high_water` (one more key) so the screen does not re-read after a save.
-- QA-07 / QA-08 (backend-qa 후속 라운드 2, 리더 판정 2026-11-09) — a slot's identity is its number AND its
-- question_id:
--   1. same number as a stored slot + a DIFFERENT question_id -> a new question on a used number -> invalid_slot
--   2. same number + no question_id -> the stored question_id is inherited (no new uuid, so a user_note citation
--      keeps pointing at the same question)
--   3. a slot not in the stored body: number above slot_high_water; no question_id -> the server mints one
--   4. 반영됨 기록: a proposal whose stored question_id differs from this body's question_id for that slot ->
--      skipped 'not_found' `[가정]` (2.5.1: "the chat is not this target's"; proposal_changed is for a rev
--      mismatch). It covers a slot added in this visit and not saved yet, which rule 1 cannot see. A proposal
--      without a question_id is not compared (11.8 was undeployed, so none exists — the pipeline sends one).
--   QA-08: a proposal for a slot that is not in this save's body -> skipped 'not_found' (it used to be recorded
--      as applied although nothing of it was saved).
--   And private.wc_patch_document now refreshes the slot's question_id on every replace_draft that carries one,
--   so a draft written for a question swapped in on an unsaved slot is compared against the right question.
-- Starts from the latest definition, 20261113004670 (with the write-guard set_config lines) — not 003700.
-- 비파괴. 004660까지는 원격, 004670은 고치지 않는다. 순서: 004670 < 004690 < 004695(법무 판) < 004700(파괴, 마지막).
-- Slot high-water mark ------------------------------------------------------------------------------------------
alter table public.application_documents
  add column slot_high_water integer not null default 0,
  add constraint application_documents_slot_high_water_check check (slot_high_water >= 0);

-- updated_at moves with content only: slot_high_water joins first_copied_at as metadata (20261113004670's rule).
create or replace function private.application_documents_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'first_copied_at' - 'slot_count' - 'slot_high_water')
     = (to_jsonb(old) - 'updated_at' - 'first_copied_at' - 'slot_count' - 'slot_high_water') then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- Backfill (no remote rows yet — the code is not deployed; local / future safety). Runs as the migration owner,
-- so the write guard (API roles only) does not stop it, and the trigger above keeps every updated_at.
update public.application_documents d
   set slot_high_water = coalesce((select max(substr(q ->> 'slot', 3)::integer)
                                     from jsonb_array_elements(coalesce(d.body -> 'questions', '[]'::jsonb)) q
                                    where q ->> 'slot' ~ '^q_[0-9]{1,3}$'), 0)
 where d.slot_high_water is distinct from coalesce((select max(substr(q ->> 'slot', 3)::integer)
                                     from jsonb_array_elements(coalesce(d.body -> 'questions', '[]'::jsonb)) q
                                    where q ->> 'slot' ~ '^q_[0-9]{1,3}$'), 0);

-- save_application_document ---------------------------------------------------------------------------------------

-- The question_id a document proposal was written for (structured_draft.document.questions[].question_id).
-- null when the proposal has none or the chat is not this document's. Definer: the chat row is read for the
-- caller only.
create or replace function private.doc_proposal_question_id(p_writing_chat_id uuid, p_application_project_id uuid,
  p_document_kind text, p_slot text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_draft jsonb;
  v_qid text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  select private.wc_normalize_document_draft(w.structured_draft, w.document_kind) into v_draft
    from public.writing_chats w
   where w.id = p_writing_chat_id and w.user_id = v_uid
     and w.application_project_id = p_application_project_id and w.document_kind = p_document_kind;
  if v_draft is null then
    return null;
  end if;
  select q ->> 'question_id' into v_qid
    from jsonb_array_elements(v_draft #> '{document,questions}') q
   where q ->> 'slot' = p_slot and jsonb_typeof(q -> 'question_id') = 'string'
   limit 1;
  if v_qid is null
     or v_qid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return lower(v_qid)::uuid;
end;
$$;

revoke all on function private.doc_proposal_question_id(uuid, uuid, text, text) from public, anon, app_ai_writer,
  service_role;
grant execute on function private.doc_proposal_question_id(uuid, uuid, text, text) to authenticated;

CREATE OR REPLACE FUNCTION public.save_application_document(p_application_project_id uuid, p_document_kind text, p_body jsonb, p_meta jsonb DEFAULT NULL::jsonb, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_applied_proposals jsonb DEFAULT NULL::jsonb, p_client_id uuid DEFAULT NULL::uuid, p_application_values jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  c_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_slot_re constant text := '^q_[0-9]{1,3}$';
  c_block_id_re constant text := '^[A-Za-z0-9_.:-]{1,64}$';
  c_types constant text[] := array['heading', 'paragraph', 'bullet_list', 'numbered_list', 'table', 'quote', 'code'];
  c_templates constant text[] := array['motivation', 'job_competency', 'future_plan'];
  c_classes constant text[] := array['motivation', 'job_competency', 'future_plan', 'experience_story'];
  c_bases constant text[] := array['new', 'current_body', 'user'];
  c_max_questions constant integer := 5;          -- (v4.15 ★, CF-5)
  v_uid uuid := auth.uid();
  v_props jsonb := coalesce(nullif(p_applied_proposals, 'null'::jsonb), '[]'::jsonb);
  v_ap public.application_projects%rowtype;
  v_doc public.application_documents%rowtype;
  v_allowed text[] := private.evidence_allowed_sources('application_document');
  v_stored_count integer := 0;
  v_stored_limits jsonb := '{}'::jsonb;
  v_qs jsonb;
  v_q jsonb;
  v_out_qs jsonb := '[]'::jsonb;
  v_out_blocks jsonb;
  v_ev jsonb := '[]'::jsonb;
  v_src jsonb;
  v_src_rows jsonb := '[]'::jsonb;
  v_source_slots text[] := '{}';
  v_classes_by_slot jsonb := '{}'::jsonb;
  v_slots text[] := '{}';
  v_stored_slots text[] := '{}';
  v_high integer := 0;
  v_new_high integer := 0;
  v_reuse text;
  v_stored_qids jsonb := '{}'::jsonb;
  v_sent_qid text;
  v_body_qids jsonb := '{}'::jsonb;
  v_prop_qid uuid;
  v_block_ids text[];
  v_question_ids uuid[] := '{}';
  v_slot text;
  v_qid uuid;
  v_class text;
  v_i integer;
  v_block jsonb;
  v_e jsonb;
  v_n integer;
  v_ord integer := 0;
  v_limit integer;
  v_body_text text;
  v_filled integer := 0;
  v_meta jsonb;
  v_tone text;
  v_new_body jsonb;
  v_name_set boolean := false;
  v_name_reset boolean := false;
  v_name text;
  v_deadline_set boolean := false;
  v_deadline date;
  v_reset jsonb;
  v_el jsonb;
  v_pos bigint;
  v_reason text;
  v_results jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  -- (v4.15, CF-1 ★) only the cover letter.
  if p_document_kind is distinct from 'cover_letter' then
    raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'document_kind';
  end if;

  -- p_body = {questions: [...]} (whole overwrite, UX 회신 6). Length 0 is accepted `[가정]`.
  v_qs := p_body -> 'questions';
  if p_body is null or jsonb_typeof(p_body) <> 'object' or jsonb_typeof(v_qs) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'body.questions';
  end if;

  -- p_meta = {tone} only (CL-A3). Absent key keeps the stored value.
  if p_meta is not null and jsonb_typeof(p_meta) <> 'null' then
    if jsonb_typeof(p_meta) <> 'object'
       or exists (select 1 from jsonb_object_keys(p_meta) k where k <> 'tone') then
      raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'meta';
    end if;
    if p_meta ? 'tone' then
      if coalesce(jsonb_typeof(p_meta -> 'tone'), 'null') not in ('string', 'null')
         or (jsonb_typeof(p_meta -> 'tone') = 'string' and (p_meta ->> 'tone') not in ('concise', 'detailed')) then
        raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'meta.tone';
      end if;
      v_tone := p_meta ->> 'tone';
    end if;
  end if;

  if jsonb_typeof(v_props) <> 'array' or jsonb_array_length(v_props) > 50 then
    raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'p_applied_proposals';
  end if;

  -- p_application_values = {name, deadline} (v4.15 정렬, CF-A11 — UX DM-4). Validated before anything is written.
  if p_application_values is not null and jsonb_typeof(p_application_values) <> 'null' then
    if jsonb_typeof(p_application_values) <> 'object'
       or exists (select 1 from jsonb_object_keys(p_application_values) k where k not in ('name', 'deadline')) then
      raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'application';
    end if;
    if p_application_values ? 'name' then
      v_name_set := true;
      if coalesce(jsonb_typeof(p_application_values -> 'name'), 'null') not in ('string', 'null') then
        raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'application.name';
      end if;
      v_name := btrim(coalesce(p_application_values ->> 'name', ''));
      if v_name = '' then
        v_name_reset := true;          -- back to the default name rule (private.application_reset_name)
      elsif char_length(v_name) > 100 then
        raise exception using errcode = 'P0001', message = 'field_too_long', detail = 'application.name';
      end if;
    end if;
    if p_application_values ? 'deadline' then
      v_deadline_set := true;
      if jsonb_typeof(p_application_values -> 'deadline') = 'null' then
        v_deadline := null;
      elsif jsonb_typeof(p_application_values -> 'deadline') = 'string'
            and (p_application_values ->> 'deadline') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        begin
          v_deadline := (p_application_values ->> 'deadline')::date;
        exception when others then
          raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'application.deadline';
        end;
      else
        raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'application.deadline';
      end if;
    end if;
  end if;

  -- Lock order: application project -> document -> chats (DM §2.5.1 `[가정]`).
  select * into v_ap from public.application_projects ap
   where ap.id = p_application_project_id and ap.user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'application_project_not_found';
  end if;

  select * into v_doc from public.application_documents d
   where d.application_project_id = p_application_project_id and d.document_kind = p_document_kind
     and d.user_id = v_uid
     for update;
  if found then
    -- R15 후속 3 (CF-S7 = (a), 2026-11-09): with a document of record already there, the caller MUST name the
    -- version it edited. A null expected version used to mean both "first save" and "overwrite whatever is
    -- there" — a tab opened before the row existed had no updated_at to send and could silently replace a
    -- document another tab had just created. Null now means "first save" only. Checked right after the lock,
    -- before the question checks, the evidence and the 반영됨 기록, so a stale save writes nothing (DM §2.5.1).
    if p_expected_updated_at is null or v_doc.updated_at <> p_expected_updated_at then
      raise exception using errcode = 'P0001', message = 'stale_write',
        detail = to_char(v_doc.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    end if;
    v_stored_count := v_doc.slot_count;
    v_high := v_doc.slot_high_water;
    v_stored_slots := array(select q ->> 'slot'
                              from jsonb_array_elements(coalesce(v_doc.body -> 'questions', '[]'::jsonb)) q);
    select coalesce(jsonb_object_agg(q ->> 'slot', q -> 'question_id'), '{}'::jsonb) into v_stored_qids
      from jsonb_array_elements(coalesce(v_doc.body -> 'questions', '[]'::jsonb)) q
     where q ->> 'slot' is not null;
    select coalesce(jsonb_object_agg(e ->> 'question_id', e -> 'char_limit'), '{}'::jsonb)
      into v_stored_limits
      from jsonb_array_elements(coalesce(v_doc.body -> 'questions', '[]'::jsonb)) e
     where (e ->> 'question_id') is not null;
  end if;

  -- Slot numbers are never reused (DM §2.5.0b). A slot that was not in the stored body is a new question and its
  -- number must be above the high-water mark. Stored slots keep their number and are not checked. A malformed
  -- slot is left to the shape check below (it is an invalid_slot either way).
  -- QA-07: the identity is the number AND the question_id. The same number with another question_id is a new
  -- question sitting on a used number (rule 1). A question_id that is not a uuid is left to the shape check below.
  for v_reuse, v_sent_qid in
    select e ->> 'slot', case when jsonb_typeof(e -> 'question_id') = 'string'
                                   and (e ->> 'question_id') ~* c_uuid_re then lower(e ->> 'question_id') end
      from jsonb_array_elements(v_qs) e
     where jsonb_typeof(e) = 'object' and (e ->> 'slot') ~ c_slot_re
  loop
    if v_reuse = any (v_stored_slots) then
      if v_sent_qid is not null and jsonb_typeof(v_stored_qids -> v_reuse) = 'string'
         and v_sent_qid <> lower(v_stored_qids ->> v_reuse) then
        raise exception using errcode = 'P0001', message = 'invalid_slot', detail = v_reuse;
      end if;
    elsif substr(v_reuse, 3)::integer <= v_high then
      raise exception using errcode = 'P0001', message = 'invalid_slot', detail = v_reuse;
    end if;
  end loop;
  v_new_high := greatest(v_high, coalesce((select max(substr(e ->> 'slot', 3)::integer)
                                             from jsonb_array_elements(v_qs) e
                                            where jsonb_typeof(e) = 'object' and (e ->> 'slot') ~ c_slot_re), 0));

  -- (v4.15 정렬, CF-5 — UX DM-5) only a save that RAISES the count above 5 is refused; fixing or shrinking an
  -- existing bigger document stays possible (no such row exists — CF-M1 — but the rule is kept).
  if jsonb_array_length(v_qs) > c_max_questions and jsonb_array_length(v_qs) > v_stored_count then
    raise exception using errcode = 'P0001', message = 'too_many_questions',
      detail = c_max_questions::text || ',' || v_stored_count::text;
  end if;

  -- First pass: validate and normalize every question, and collect the evidence rows.
  for v_i in 0 .. jsonb_array_length(v_qs) - 1 loop
    v_q := v_qs -> v_i;
    if jsonb_typeof(v_q) <> 'object' then
      raise exception using errcode = 'P0001', message = 'invalid_fields',
        detail = 'questions[' || v_i::text || ']';
    end if;
    v_slot := v_q ->> 'slot';
    -- slot shape / duplicate / kind mismatch -> invalid_slot (DM §2.5.1).
    if v_slot is null or v_slot !~ c_slot_re or v_slot = any (v_slots) then
      raise exception using errcode = 'P0001', message = 'invalid_slot', detail = coalesce(v_slot, '');
    end if;
    v_slots := v_slots || v_slot;

    if v_q ? 'question_id' and jsonb_typeof(v_q -> 'question_id') = 'string'
       and (v_q ->> 'question_id') ~* c_uuid_re then
      v_qid := (v_q ->> 'question_id')::uuid;
    elsif coalesce(jsonb_typeof(v_q -> 'question_id'), 'null') = 'null'
          and jsonb_typeof(v_stored_qids -> v_slot) = 'string' then
      -- QA-07 rule 2: a stored slot sent without its id keeps its identity.
      v_qid := (v_stored_qids ->> v_slot)::uuid;
    elsif coalesce(jsonb_typeof(v_q -> 'question_id'), 'null') = 'null' then
      v_qid := gen_random_uuid();     -- a new question `[가정]`: the server mints the uuid
    else
      raise exception using errcode = 'P0001', message = 'invalid_fields',
        detail = 'questions.' || v_slot || '.question_id';
    end if;
    v_question_ids := v_question_ids || v_qid;

    if coalesce(jsonb_typeof(v_q -> 'question_text'), 'null') not in ('string', 'null') then
      raise exception using errcode = 'P0001', message = 'invalid_fields',
        detail = 'questions.' || v_slot || '.question_text';
    end if;
    if char_length(v_q ->> 'question_text') > 1000 then
      raise exception using errcode = 'P0001', message = 'field_too_long',
        detail = 'questions.' || v_slot || '.question_text';
    end if;
    if coalesce(jsonb_typeof(v_q -> 'answer_title'), 'null') not in ('string', 'null') then
      raise exception using errcode = 'P0001', message = 'invalid_fields',
        detail = 'questions.' || v_slot || '.answer_title';
    end if;
    -- (v4.15, CF-6·CF-A4 ④) the answer title is at most 100 characters.
    if char_length(btrim(coalesce(v_q ->> 'answer_title', ''))) > 100 then
      raise exception using errcode = 'P0001', message = 'field_too_long',
        detail = 'questions.' || v_slot || '.answer_title';
    end if;
    if coalesce(jsonb_typeof(v_q -> 'user_note'), 'null') not in ('string', 'null') then
      raise exception using errcode = 'P0001', message = 'invalid_fields',
        detail = 'questions.' || v_slot || '.user_note';
    end if;
    if char_length(v_q ->> 'user_note') > 300 then
      raise exception using errcode = 'P0001', message = 'field_too_long',
        detail = 'questions.' || v_slot || '.user_note';
    end if;
    if coalesce(jsonb_typeof(v_q -> 'body'), 'null') not in ('string', 'null') then
      raise exception using errcode = 'P0001', message = 'invalid_fields',
        detail = 'questions.' || v_slot || '.body';
    end if;
    v_body_text := coalesce(v_q ->> 'body', '');
    if char_length(v_body_text) > 8000 then
      raise exception using errcode = 'P0001', message = 'field_too_long',
        detail = 'questions.' || v_slot || '.body';
    end if;
    if (v_q ? 'template_key' and coalesce(jsonb_typeof(v_q -> 'template_key'), 'null') = 'string'
        and (v_q ->> 'template_key') <> all (c_templates))
       or coalesce(jsonb_typeof(v_q -> 'template_key'), 'null') not in ('string', 'null') then
      raise exception using errcode = 'P0001', message = 'invalid_fields',
        detail = 'questions.' || v_slot || '.template_key';
    end if;
    if (coalesce(jsonb_typeof(v_q -> 'question_class'), 'null') = 'string'
        and (v_q ->> 'question_class') <> all (c_classes))
       or coalesce(jsonb_typeof(v_q -> 'question_class'), 'null') not in ('string', 'null') then
      raise exception using errcode = 'P0001', message = 'invalid_fields',
        detail = 'questions.' || v_slot || '.question_class';
    end if;
    if (coalesce(jsonb_typeof(v_q -> 'count_basis'), 'null') = 'string'
        and (v_q ->> 'count_basis') not in ('with_spaces', 'without_spaces'))
       or coalesce(jsonb_typeof(v_q -> 'count_basis'), 'null') not in ('string', 'null') then
      raise exception using errcode = 'P0001', message = 'invalid_fields',
        detail = 'questions.' || v_slot || '.count_basis';
    end if;

    -- (v4.15, R-CF-16 / CF-U2) char_limit 1~10,000 is required on a new save. Exception: the stored row's same
    -- question_id was already null (only a migrated row could be — CF-M1 means it never happens).
    if coalesce(jsonb_typeof(v_q -> 'char_limit'), 'null') = 'number'
       and (v_q ->> 'char_limit') ~ '^[0-9]{1,6}$' then
      v_limit := (v_q ->> 'char_limit')::integer;
      if v_limit < 1 or v_limit > 10000 then
        raise exception using errcode = 'P0001', message = 'invalid_fields',
          detail = 'questions.' || v_slot || '.char_limit';
      end if;
    elsif coalesce(jsonb_typeof(v_q -> 'char_limit'), 'null') = 'null'
          and (v_stored_limits ? v_qid::text)
          and coalesce(jsonb_typeof(v_stored_limits -> v_qid::text), 'null') = 'null' then
      v_limit := null;
    else
      raise exception using errcode = 'P0001', message = 'invalid_fields',
        detail = 'questions.' || v_slot || '.char_limit';
    end if;

    -- Blocks (DM §2.7.3). Evidence is NOT copied into the body (DM-6 — evidence_links is the record).
    if coalesce(jsonb_typeof(v_q -> 'blocks'), 'null') not in ('array', 'null') then
      raise exception using errcode = 'P0001', message = 'invalid_fields',
        detail = 'questions.' || v_slot || '.blocks';
    end if;
    if coalesce(jsonb_array_length(v_q -> 'blocks'), 0) > 200 then
      raise exception using errcode = 'P0001', message = 'field_too_long',
        detail = 'questions.' || v_slot || '.blocks';
    end if;
    v_class := coalesce(nullif(v_q ->> 'question_class', ''), nullif(v_q ->> 'template_key', ''));
    v_classes_by_slot := v_classes_by_slot || jsonb_build_object(v_slot, to_jsonb(v_class));
    v_out_blocks := '[]'::jsonb;
    v_block_ids := '{}';
    for v_block in select e from jsonb_array_elements(coalesce(v_q -> 'blocks', '[]'::jsonb)) e loop
      if jsonb_typeof(v_block) <> 'object'
         or coalesce(v_block ->> 'block_id', '') !~ c_block_id_re
         or (v_block ->> 'block_id') = any (v_block_ids)
         or coalesce(v_block ->> 'type', '') <> all (c_types)
         or coalesce(jsonb_typeof(v_block -> 'text'), 'null') not in ('string', 'null')
         or coalesce(v_block ->> 'basis', 'new') <> all (c_bases)
         or coalesce(jsonb_typeof(v_block -> 'placeholders'), 'array') <> 'array'
         or coalesce(jsonb_typeof(v_block -> 'flags'), 'array') <> 'array'
         or coalesce(jsonb_typeof(v_block -> 'evidence'), 'array') <> 'array' then
        raise exception using errcode = 'P0001', message = 'invalid_fields',
          detail = 'questions.' || v_slot || '.blocks';
      end if;
      if char_length(v_block ->> 'text') > 5000 then
        raise exception using errcode = 'P0001', message = 'field_too_long',
          detail = 'questions.' || v_slot || '.blocks.' || (v_block ->> 'block_id') || '.text';
      end if;
      if coalesce(jsonb_array_length(v_block -> 'evidence'), 0) > 20 then
        raise exception using errcode = 'P0001', message = 'field_too_long',
          detail = 'questions.' || v_slot || '.blocks.' || (v_block ->> 'block_id') || '.evidence';
      end if;
      v_block_ids := v_block_ids || (v_block ->> 'block_id');

      for v_e in select e from jsonb_array_elements(coalesce(v_block -> 'evidence', '[]'::jsonb)) e loop
        v_ord := v_ord + 1;
        v_ev := v_ev || jsonb_build_array(private.doc_evidence_row(
          v_slot || '.blocks.' || (v_block ->> 'block_id'), v_ord, v_e, v_allowed, v_class));
      end loop;

      v_out_blocks := v_out_blocks || jsonb_build_array(jsonb_build_object(
        'block_id', v_block ->> 'block_id',
        'type', v_block ->> 'type',
        'text', v_block -> 'text',
        'basis', coalesce(v_block ->> 'basis', 'new'),
        'placeholders', coalesce(v_block -> 'placeholders', '[]'::jsonb),
        'flags', coalesce(v_block -> 'flags', '[]'::jsonb),
        'applied_writing_chat_id', v_block -> 'applied_writing_chat_id',
        'applied_rev', v_block -> 'applied_rev',
        'applied_at', v_block -> 'applied_at',
        'user_modified', coalesce(v_block -> 'user_modified', 'false'::jsonb)));
    end loop;

    -- (CF-S1) The slot-level citations `{slot}.sources.{n}` do NOT come from p_body — the screen never sends
    -- them. They come from the applied proposal's draft.sources[], below.

    -- (v4.15, CF-A4) a question whose body is empty is not counted even when it has an answer_title `[가정]`.
    if nullif(btrim(v_body_text), '') is not null then
      v_filled := v_filled + 1;
    end if;

    v_out_qs := v_out_qs || jsonb_build_array(jsonb_build_object(
      'slot', v_slot,
      'question_id', v_qid,
      'question_text', v_q -> 'question_text',
      'answer_title', to_jsonb(nullif(btrim(coalesce(v_q ->> 'answer_title', '')), '')),
      'template_key', v_q -> 'template_key',
      'question_class', v_q -> 'question_class',
      'char_limit', to_jsonb(v_limit),
      'count_basis', v_q -> 'count_basis',
      'user_note', v_q -> 'user_note',
      'body', to_jsonb(v_body_text),
      'blocks', v_out_blocks,
      'sort_order', v_i + 1));
  end loop;

  v_new_body := jsonb_build_object('questions', v_out_qs);
  v_meta := coalesce(v_doc.meta, '{}'::jsonb);
  if v_tone is not null or (p_meta is not null and jsonb_typeof(p_meta) = 'object' and p_meta ? 'tone') then
    v_meta := v_meta || jsonb_build_object('tone', to_jsonb(v_tone));
  end if;

  -- R15 후속 (A): the write guard trigger lets a user-session write through only while this transaction-local
  -- flag is on. It is switched on for the document write alone and off again right after it.
  perform set_config('app.application_document_write', 'on', true);
  if v_doc.id is null then
    begin
      insert into public.application_documents (user_id, application_project_id, document_kind, body, meta,
                                                filled_slot_count, slot_high_water)
      values (v_uid, p_application_project_id, p_document_kind, v_new_body, v_meta, v_filled, v_new_high)
      returning * into v_doc;
    exception when unique_violation then
      -- R15 후속 3: two first saves of one document at once. FOR UPDATE above found no row to lock, so both
      -- reached the insert; the unique (application_project_id, document_kind) key held this one until the other
      -- committed. The other tab's document is now the record: this save is stale (the caller re-sends with
      -- that current_updated_at to keep its own content — "내 내용으로 저장").
      select * into v_doc from public.application_documents d
       where d.application_project_id = p_application_project_id and d.document_kind = p_document_kind
         and d.user_id = v_uid;
      raise exception using errcode = 'P0001', message = 'stale_write',
        detail = to_char(v_doc.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    end;
  else
    -- Expected version: checked right after the row lock above (R15 후속 3); the row cannot have moved since.
    -- R5-DB-11: a save that changes nothing does not bump updated_at.
    if (v_new_body, v_meta, v_filled, v_new_high)
       is distinct from (v_doc.body, v_doc.meta, v_doc.filled_slot_count, v_doc.slot_high_water) then
      update public.application_documents d
         set body = v_new_body, meta = v_meta, filled_slot_count = v_filled, slot_high_water = v_new_high
       where d.id = v_doc.id and d.user_id = v_uid
      returning * into v_doc;
    end if;
  end if;
  perform set_config('app.application_document_write', 'off', true);

  -- 반영됨 기록 (DM §2.5.1 공통 규칙): after the document is written, each element in its own subtransaction.
  -- A failure here never blocks the save. (CF-S1) The slots recorded as applied here are also the slots whose
  -- `{slot}.sources.{n}` rows are replaced from that proposal, so this loop runs BEFORE the evidence write.
  -- This save's slot -> question_id (lower-case text), for the 반영됨 기록 check below.
  select coalesce(jsonb_object_agg(q ->> 'slot', lower(q ->> 'question_id')), '{}'::jsonb) into v_body_qids
    from jsonb_array_elements(v_out_qs) q;
  for v_el, v_pos in
    select e, o from jsonb_array_elements(v_props) with ordinality as t (e, o)
     order by case when jsonb_typeof(e -> 'writing_chat_id') = 'string' then lower(e ->> 'writing_chat_id') end
              nulls last, o
  loop
    v_reason := null;
    if jsonb_typeof(v_el) <> 'object'
       or jsonb_typeof(v_el -> 'writing_chat_id') is distinct from 'string'
       or (v_el ->> 'writing_chat_id') !~* c_uuid_re
       or jsonb_typeof(v_el -> 'slot') is distinct from 'string'
       or (v_el ->> 'slot') !~ c_slot_re
       or jsonb_typeof(v_el -> 'rev') is distinct from 'number'
       or (v_el ->> 'rev') !~ '^[0-9]{1,9}$' then
      v_reason := 'invalid_entry';
    elsif not ((v_el ->> 'slot') = any (v_slots)) then
      -- QA-08: the slot is not in what this save wrote.
      v_reason := 'not_found';
    else
      begin
        -- QA-07 rule 4: the proposal must have been written for the question this body has on that slot.
        v_prop_qid := private.doc_proposal_question_id((v_el ->> 'writing_chat_id')::uuid, p_application_project_id,
                                                       p_document_kind, v_el ->> 'slot');
        if v_prop_qid is not null and v_prop_qid::text is distinct from (v_body_qids ->> (v_el ->> 'slot')) then
          v_reason := 'not_found';    -- `[가정]` — 2.5.1 "the chat is not this target's"
        else
          v_reason := private.wc_mark_proposal_applied((v_el ->> 'writing_chat_id')::uuid, 'application_document',
                                                       p_application_project_id, v_el ->> 'slot',
                                                       (v_el ->> 'rev')::integer, p_document_kind);
        end if;
      exception when others then
        v_reason := 'mark_failed';
      end;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'o', v_pos, 'reason', v_reason,
      'writing_chat_id', case when jsonb_typeof(v_el) = 'object' then v_el -> 'writing_chat_id' end,
      'slot', case when jsonb_typeof(v_el) = 'object' then v_el -> 'slot' end));

    -- (CF-S1) An applied proposal replaces that slot's citation rows with its own draft.sources[],
    -- `primary` first, `n` = the array order. `role` is a proposal-only value and is not stored.
    if v_reason is null and (v_el ->> 'slot') = any (v_slots) then
      v_slot := v_el ->> 'slot';
      v_src := private.doc_proposal_sources((v_el ->> 'writing_chat_id')::uuid, p_application_project_id,
                                            p_document_kind, v_slot);
    else
      v_src := null;
    end if;
    -- A proposal without a `sources` key leaves the slot's existing citation rows alone (CF-S1 `[가정]`).
    if v_src is not null then
      v_source_slots := array(select distinct x from unnest(v_source_slots || v_slot) x);
      -- A later applied proposal for the same slot wins: drop the rows built from the earlier one.
      v_src_rows := coalesce((select jsonb_agg(r order by (r ->> 'sort_order')::integer)
                                from jsonb_array_elements(v_src_rows) r
                               where split_part(r ->> 'item_key', '.', 1) <> v_slot), '[]'::jsonb);
      v_n := 0;
      for v_e in
        select e from jsonb_array_elements(v_src) with ordinality as t (e, o)
         order by case when e ->> 'role' = 'primary' then 0 else 1 end, o
      loop
        v_n := v_n + 1;
        v_ord := v_ord + 1;
        v_src_rows := v_src_rows || jsonb_build_array(private.doc_evidence_row(
          v_slot || '.sources.' || v_n::text, v_ord, v_e - 'role', v_allowed,
          v_classes_by_slot ->> v_slot));
      end loop;
    end if;
  end loop;

  -- user_note evidence: the source is a question_id inside this body. A note whose question is gone is marked
  -- "원본 삭제됨" here, because no trigger can see inside jsonb (DM §2.8 `[가정]`, AI 요청 4).
  select coalesce(jsonb_agg(case
           when e ->> 'source_type' = 'user_note'
                and not ((e ->> 'source_id')::uuid = any (v_question_ids))
             then e || '{"source_deleted": true}'::jsonb
           else e end order by (e ->> 'sort_order')::integer), '[]'::jsonb)
    into v_ev
    from jsonb_array_elements(v_ev || v_src_rows) e;

  -- Evidence in the same transaction. A failure here rolls the save back (the evidence is part of the body).
  perform private.doc_replace_slot_evidence(v_doc.id, p_application_project_id, v_ev, v_slots, v_source_slots);

  -- Application-project header values, same transaction (DM §2.5.1 p_application_values).
  if v_name_reset then
    v_reset := private.application_reset_name(p_application_project_id);
    v_ap.name := v_reset ->> 'name';
    v_ap.name_source := v_reset ->> 'name_source';
  elsif v_name_set and v_name is distinct from v_ap.name then
    -- Not empty: the ordinary user-session update (the trigger stamps name_source = 'user').
    update public.application_projects ap set name = v_name
     where ap.id = p_application_project_id and ap.user_id = v_uid
    returning ap.name, ap.name_source into v_ap.name, v_ap.name_source;
  end if;
  if v_deadline_set and v_deadline is distinct from v_ap.deadline then
    update public.application_projects ap set deadline = v_deadline
     where ap.id = p_application_project_id and ap.user_id = v_uid
    returning ap.deadline into v_ap.deadline;
  end if;

  return jsonb_build_object(
    'application_document_id', v_doc.id,
    'document_kind', v_doc.document_kind,
    'filled_slot_count', v_doc.filled_slot_count,
    'slot_count', v_doc.slot_count,
    'slot_high_water', v_doc.slot_high_water,
    'name', v_ap.name,
    'name_source', v_ap.name_source,
    'deadline', v_ap.deadline,
    'updated_at', v_doc.updated_at,
    'applied', coalesce((select jsonb_agg(jsonb_build_object('writing_chat_id', r -> 'writing_chat_id',
                                                             'slot', r -> 'slot')
                                          order by (r ->> 'o')::bigint)
                           from jsonb_array_elements(v_results) r where r ->> 'reason' is null), '[]'::jsonb),
    'skipped', coalesce((select jsonb_agg(jsonb_build_object('writing_chat_id', r -> 'writing_chat_id',
                                                             'slot', r -> 'slot', 'reason', r -> 'reason')
                                          order by (r ->> 'o')::bigint)
                           from jsonb_array_elements(v_results) r where r ->> 'reason' is not null), '[]'::jsonb));
end;
$function$;

-- private.wc_patch_document — from its latest definition (20261113004660: draft_count per turn), with only the
-- question_id refresh on an existing slot added (QA-07).
CREATE OR REPLACE FUNCTION private.wc_patch_document(p_chat writing_chats, p_ops jsonb, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  c_ai_ops constant text[] := array['add_facts', 'replace_draft', 'count_draft', 'set_clarifications',
                                    'add_sensitive_flags', 'set_tone', 'set_question_edit_proposal'];
  c_user_ops constant text[] := array['accept_fact', 'reject_fact', 'accept_block', 'remove_block'];
  c_slot_re constant text := '^q_[0-9]{1,3}$';
  c_draft_limit constant integer := 6;   -- DM §2.5.0b: 6 per CHAT, not per slot
  c_fact_limit constant integer := 80;
  v_allowed text[] := private.evidence_allowed_sources('application_document');
  v_draft jsonb;
  v_work jsonb;
  v_user_msg_ids uuid[];
  v_op jsonb;
  v_kind text;
  v_slot text;
  v_i integer;
  v_j integer;
  v_qidx integer;
  v_reason text;
  v_rejected jsonb := '[]'::jsonb;
  v_fact jsonb;
  v_fact_id uuid;
  v_sources jsonb;
  v_quotes jsonb;
  v_text text;
  v_draft_obj jsonb;
  v_cur jsonb;
  v_blocks jsonb;
  v_block jsonb;
  v_value text;
  v_title text;
  v_slot_sources jsonb;
  v_item jsonb;
  v_idx integer;
  v_draft_turn boolean := false;   -- R15 (R15-API-7): one draft TURN, not one op
begin
  v_draft := private.wc_normalize_document_draft(p_chat.structured_draft, p_chat.document_kind);

  if p_actor = 'ai' then
    select coalesce(array_agg(m.id), '{}') into v_user_msg_ids
      from public.writing_chat_messages m
     where m.writing_chat_id = p_chat.id and m.role = 'user';
  end if;

  for v_i in 0 .. jsonb_array_length(p_ops) - 1 loop
    v_op := p_ops -> v_i;
    v_kind := v_op ->> 'op';
    if jsonb_typeof(v_op) <> 'object' or v_kind is null
       or not (v_kind = any (case when p_actor = 'ai' then c_ai_ops else c_user_ops end)) then
      raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i;
    end if;

    v_reason := null;
    v_work := v_draft;

    if v_kind = 'add_facts' then
      if jsonb_typeof(v_op -> 'facts') is distinct from 'array'
         or jsonb_array_length(v_op -> 'facts') not between 1 and c_fact_limit then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' facts';
      end if;
      for v_j in 0 .. jsonb_array_length(v_op -> 'facts') - 1 loop
        v_fact := v_op #> array['facts', v_j::text];
        v_text := btrim(v_fact ->> 'text');
        v_sources := private.wc_sources(v_fact -> 'source_message_ids', v_user_msg_ids);
        v_quotes := private.wc_quotes(v_fact -> 'source_quotes');
        v_reason := case
          when jsonb_typeof(v_fact) <> 'object'
               or jsonb_typeof(v_fact -> 'text') is distinct from 'string'
               or char_length(v_text) not between 1 and 500
               -- DM §2.5.0b: a document fact's slot is this document's slot key, not a fixed list.
               or coalesce(v_fact ->> 'slot', '') !~ c_slot_re
               or coalesce(v_fact ->> 'actor', '') not in ('self', 'team', 'unknown')
               or coalesce(v_fact ->> 'review', 'ok') not in ('ok', 'needs_review')
               or (v_fact ? 'id' and not private.wc_is_uuid(v_fact -> 'id')) then 'invalid_value'
          when v_sources is null or v_quotes is null then 'invalid_source'
          when jsonb_array_length(v_work -> 'facts') >= c_fact_limit then 'facts_limit_reached'
        end;
        if v_reason is null then
          v_fact_id := case when v_fact ? 'id' then (v_fact ->> 'id')::uuid end;
          if v_fact_id is null
             or v_fact_id = any (private.wc_uuid_array(jsonb_path_query_array(v_work -> 'facts', '$[*].id'))) then
            v_fact_id := gen_random_uuid();
          end if;
          v_work := jsonb_set(v_work, '{facts}', (v_work -> 'facts') || jsonb_build_array(jsonb_build_object(
            'id', v_fact_id, 'slot', v_fact ->> 'slot', 'text', v_text, 'actor', v_fact ->> 'actor',
            'source_message_ids', v_sources, 'source_quotes', v_quotes,
            'review', coalesce(v_fact ->> 'review', 'ok'), 'reviewed_at', null, 'origin', 'ai')));
        else
          v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
            'index', v_i, 'op', v_kind, 'fact_index', v_j, 'reason', v_reason));
        end if;
      end loop;
      v_reason := null;

    elsif v_kind in ('replace_draft', 'count_draft') then
      if coalesce((v_work ->> 'draft_count')::integer, 0) >= c_draft_limit then
        raise exception using errcode = 'P0001', message = 'writing_chat_draft_limit_reached';
      end if;
      if v_kind = 'replace_draft' then
        v_slot := v_op ->> 'slot';
        v_draft_obj := v_op -> 'draft';
        if v_slot is null or v_slot !~ c_slot_re or jsonb_typeof(v_draft_obj) is distinct from 'object' then
          raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' slot';
        end if;
        -- (v4.15, CF-A4) answer_title: text or null, <= 100 — over the limit the whole patch is invalid `[가정]`.
        if coalesce(jsonb_typeof(v_draft_obj -> 'answer_title'), 'null') not in ('string', 'null')
           or char_length(btrim(coalesce(v_draft_obj ->> 'answer_title', ''))) > 100 then
          raise exception using errcode = 'P0001', message = 'invalid_patch',
            detail = 'op ' || v_i || ' answer_title';
        end if;
        v_title := nullif(btrim(coalesce(v_draft_obj ->> 'answer_title', '')), '');
        -- (CF-S1) the slot-level citations ride on replace_draft; no new patch op is created.
        -- "no sources key" is NOT the same as "empty array": without the key the draft stores no sources, and
        -- the save RPC then keeps the slot's existing `{slot}.sources.{n}` rows. An empty array clears them.
        if v_draft_obj ? 'sources' then
          v_slot_sources := private.wc_doc_sources(v_draft_obj -> 'sources', v_allowed);
          if v_slot_sources is null then
            raise exception using errcode = 'P0001', message = 'invalid_patch',
              detail = 'op ' || v_i || ' sources';
          end if;
        else
          v_slot_sources := null;
        end if;
        if jsonb_typeof(v_draft_obj -> 'blocks') is distinct from 'array'
           or jsonb_array_length(v_draft_obj -> 'blocks') not between 1 and 200
           or coalesce(jsonb_typeof(v_draft_obj -> 'base_body_hash'), 'null') not in ('string', 'null')
           or char_length(v_draft_obj ->> 'base_body_hash') > 200
           or coalesce(jsonb_typeof(v_draft_obj -> 'replace_allowed'), 'boolean') <> 'boolean'
           or coalesce(jsonb_typeof(v_draft_obj -> 'missing_slots'), 'array') <> 'array'
           or coalesce(jsonb_array_length(v_draft_obj -> 'missing_slots'), 0) > 20
           or coalesce(jsonb_typeof(v_draft_obj -> 'dropped_block_count'), 'number') <> 'number'
           or coalesce(v_draft_obj ->> 'dropped_block_count', '0') !~ '^[0-9]{1,3}$'
           or coalesce(jsonb_typeof(v_draft_obj -> 'char_count'), 'number') <> 'number'
           or coalesce(v_draft_obj ->> 'char_count', '0') !~ '^[0-9]{1,6}$'
           or coalesce(jsonb_typeof(v_draft_obj -> 'char_limit_at_generation'), 'number') <> 'number'
           or coalesce(jsonb_typeof(v_draft_obj -> 'char_adjust_needed'), 'boolean') <> 'boolean'
           or coalesce(jsonb_typeof(v_draft_obj -> 'correction_applied'), 'boolean') <> 'boolean' then
          v_reason := 'invalid_value';
        else
          v_blocks := '[]'::jsonb;
          for v_block in select * from jsonb_array_elements(v_draft_obj -> 'blocks') loop
            v_block := private.wc_document_block(
              v_block, private.wc_uuid_array(jsonb_path_query_array(v_work -> 'facts', '$[*].id')), v_allowed);
            if v_block ? 'reason' then
              v_reason := v_block ->> 'reason';
              exit;
            end if;
            v_blocks := v_blocks || jsonb_build_array(v_block);
          end loop;
          if v_reason is null
             and (select count(distinct b ->> 'block_id') from jsonb_array_elements(v_blocks) b)
                 <> jsonb_array_length(v_blocks) then
            v_reason := 'invalid_value';
          end if;
          if v_reason is null then
            -- R5-DB-5 per slot: the DB rebuilds `value` from the blocks; answer_title is not part of it.
            v_value := private.wc_deliverable_markdown(v_blocks);
            if char_length(v_value) not between 1 and 8000 then
              v_reason := 'invalid_value';
            end if;
          end if;
          if v_reason is null then
            select (o - 1)::integer into v_qidx
              from jsonb_array_elements(v_work #> '{document,questions}') with ordinality as t (q, o)
             where q ->> 'slot' = v_slot;
            v_cur := case when v_qidx is null then '{}'::jsonb
                          else v_work #> array['document', 'questions', v_qidx::text, 'draft'] end;
            v_draft_obj := case when v_slot_sources is null then '{}'::jsonb
                                else jsonb_build_object('sources', v_slot_sources) end
              || jsonb_build_object(
              'answer_title', to_jsonb(v_title),
              'value', v_value, 'blocks', v_blocks, 'rev', private.wc_next_rev(v_cur),
              'char_count', (v_draft_obj ->> 'char_count')::integer,
              'char_limit_at_generation', v_draft_obj -> 'char_limit_at_generation',
              'char_adjust_needed', coalesce(v_draft_obj -> 'char_adjust_needed', 'false'::jsonb),
              'correction_applied', coalesce(v_draft_obj -> 'correction_applied', 'false'::jsonb),
              'generated_at', now(), 'base_body_hash', v_draft_obj -> 'base_body_hash',
              'replace_allowed', coalesce(v_draft_obj -> 'replace_allowed', 'true'::jsonb),
              'missing_slots', coalesce(v_draft_obj -> 'missing_slots', '[]'::jsonb),
              'dropped_block_count', coalesce((v_draft_obj ->> 'dropped_block_count')::integer, 0),
              'applied_at', null, 'applied_rev', null);
            if v_qidx is null then
              v_work := jsonb_set(v_work, '{document,questions}',
                (v_work #> '{document,questions}') || jsonb_build_array(jsonb_build_object(
                  'slot', v_slot,
                  'question_id', case when private.wc_is_uuid(v_op -> 'question_id')
                                      then to_jsonb(lower(v_op ->> 'question_id')) else 'null'::jsonb end,
                  'draft', v_draft_obj)));
            else
              -- R15 QA-07: the slot's question_id follows the question this draft was written for, when the op
              -- names one (a question swapped in on an unsaved slot gets a fresh draft for the NEW question).
              v_work := jsonb_set(v_work, array['document', 'questions', v_qidx::text],
                (v_work #> array['document', 'questions', v_qidx::text])
                || jsonb_build_object('draft', v_draft_obj)
                || case when private.wc_is_uuid(v_op -> 'question_id')
                        then jsonb_build_object('question_id', lower(v_op ->> 'question_id'))
                        else '{}'::jsonb end);
            end if;
          end if;
        end if;
      end if;
      -- R15 (R15-API-7, 리더 판정 2026-11-09): the count is per DRAFT TURN. A turn that proposes three
      -- questions sends three replace_draft ops and must still cost 1. The increment happens once, after the
      -- loop. The limit check above reads the unchanged count, so every op of this call sees the same value and
      -- a 6th-turn call is refused on its first draft op.
      if v_reason is null then
        v_draft_turn := true;
      end if;

    elsif v_kind = 'set_tone' then
      -- DM §2.5.0b: the tone asked for IN THIS CHAT. The canonical value is application_documents.meta.tone.
      if coalesce(jsonb_typeof(v_op -> 'value'), 'null') <> 'null'
         and (jsonb_typeof(v_op -> 'value') <> 'string'
              or (v_op ->> 'value') not in ('concise', 'detailed')) then
        v_reason := 'invalid_value';
      else
        v_work := jsonb_set(v_work, '{meta}', coalesce(v_work -> 'meta', '{}'::jsonb) || jsonb_build_object(
          'tone_requested', coalesce(v_op -> 'value', 'null'::jsonb),
          'tone_requested_at', case when coalesce(jsonb_typeof(v_op -> 'value'), 'null') = 'null'
                                    then 'null'::jsonb else to_jsonb(now()) end));
      end if;

    elsif v_kind = 'set_question_edit_proposal' then
      v_item := v_op -> 'items';
      if jsonb_typeof(v_item) is distinct from 'array' or jsonb_array_length(v_item) > 10
         or exists (
           select 1 from jsonb_array_elements(v_item) c
            where jsonb_typeof(c) <> 'object'
               or coalesce(c ->> 'op', '') not in ('add', 'update', 'remove')
               or coalesce(jsonb_typeof(c -> 'slot'), 'null') not in ('string', 'null')
               or (coalesce(jsonb_typeof(c -> 'slot'), 'null') = 'string' and (c ->> 'slot') !~ c_slot_re)
               or coalesce(jsonb_typeof(c -> 'question_text'), 'null') not in ('string', 'null')
               or char_length(c ->> 'question_text') > 1000
               or coalesce(jsonb_typeof(c -> 'char_limit'), 'null') not in ('number', 'null')) then
        raise exception using errcode = 'P0001', message = 'invalid_patch',
          detail = 'op ' || v_i || ' question_edit_proposal';
      end if;
      v_work := jsonb_set(v_work, '{document,question_edit_proposal}', coalesce((
        select jsonb_agg(jsonb_build_object('slot', c -> 'slot', 'op', c ->> 'op',
                                            'question_text', c -> 'question_text',
                                            'char_limit', c -> 'char_limit'))
          from jsonb_array_elements(v_item) c), '[]'::jsonb));

    elsif v_kind = 'set_clarifications' then
      v_item := v_op -> 'items';
      if jsonb_typeof(v_item) is distinct from 'array' or jsonb_array_length(v_item) > 50
         or exists (
           select 1 from jsonb_array_elements(v_item) c
            where jsonb_typeof(c) <> 'object'
               or coalesce(c ->> 'kind', '') not in ('actor_ambiguous', 'number_vague')
               or coalesce(jsonb_typeof(c -> 'slot'), 'null') not in ('string', 'null')
               or (coalesce(jsonb_typeof(c -> 'slot'), 'null') = 'string' and (c ->> 'slot') !~ c_slot_re)
               or coalesce(jsonb_typeof(c -> 'note'), 'null') not in ('string', 'null')
               or char_length(c ->> 'note') > 200) then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' clarifications';
      end if;
      v_work := jsonb_set(v_work, '{clarifications}', coalesce((
        select jsonb_agg(jsonb_build_object('kind', c ->> 'kind', 'slot', c ->> 'slot', 'note', c ->> 'note'))
          from jsonb_array_elements(v_item) c), '[]'::jsonb));

    elsif v_kind = 'add_sensitive_flags' then
      if jsonb_typeof(v_op -> 'count') is distinct from 'number'
         or (v_op ->> 'count')::numeric <> trunc((v_op ->> 'count')::numeric)
         or (v_op ->> 'count')::numeric not between 0 and 100 then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' count';
      end if;
      v_work := jsonb_set(v_work, '{sensitive_flags_count}',
        to_jsonb(coalesce((v_work ->> 'sensitive_flags_count')::integer, 0) + (v_op ->> 'count')::integer));

    elsif v_kind in ('accept_fact', 'reject_fact') then
      if not private.wc_is_uuid(v_op -> 'fact_id') then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' fact_id';
      end if;
      select (o - 1)::integer into v_idx
        from jsonb_array_elements(v_work -> 'facts') with ordinality as t (f, o)
       where lower(f ->> 'id') = lower(v_op ->> 'fact_id');
      if v_idx is null then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' fact_id';
      end if;
      if v_work #>> array['facts', v_idx::text, 'review'] is distinct from 'needs_review' then
        v_reason := 'invalid_review_transition';
      elsif v_kind = 'accept_fact' then
        v_work := jsonb_set(v_work, array['facts', v_idx::text],
                            (v_work #> array['facts', v_idx::text])
                            || jsonb_build_object('review', 'accepted', 'reviewed_at', now()));
      else
        v_work := jsonb_set(v_work, '{facts}', (v_work -> 'facts') - v_idx);
      end if;

    else -- accept_block / remove_block (+ slot)
      v_slot := v_op ->> 'slot';
      if v_slot is null or v_slot !~ c_slot_re
         or jsonb_typeof(v_op -> 'block_id') is distinct from 'string' then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' slot';
      end if;
      select (o - 1)::integer into v_qidx
        from jsonb_array_elements(v_work #> '{document,questions}') with ordinality as t (q, o)
       where q ->> 'slot' = v_slot;
      v_cur := case when v_qidx is null then null
                    else v_work #> array['document', 'questions', v_qidx::text, 'draft'] end;
      if jsonb_typeof(v_cur) is distinct from 'object' then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' slot';
      end if;
      select (o - 1)::integer into v_idx
        from jsonb_array_elements(coalesce(v_cur -> 'blocks', '[]'::jsonb)) with ordinality as t (b, o)
       where b ->> 'block_id' = v_op ->> 'block_id';
      if v_idx is null then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'op ' || v_i || ' block_id';
      end if;
      if coalesce(jsonb_typeof(v_cur -> 'applied_at'), 'null') <> 'null' then
        v_reason := 'field_already_applied';
      elsif v_kind = 'accept_block' then
        if v_cur #>> array['blocks', v_idx::text, 'review'] is distinct from 'needs_review' then
          v_reason := 'invalid_review_transition';
        else
          -- rev unchanged (accepting does not change the text).
          v_work := jsonb_set(v_work,
            array['document', 'questions', v_qidx::text, 'draft', 'blocks', v_idx::text, 'review'], '"accepted"');
        end if;
      else
        v_blocks := (v_cur -> 'blocks') - v_idx;
        v_work := jsonb_set(v_work, array['document', 'questions', v_qidx::text, 'draft'],
          v_cur || jsonb_build_object('blocks', v_blocks,
                                      'value', private.wc_deliverable_markdown(v_blocks),
                                      'rev', private.wc_rev(v_cur) + 1));
      end if;
    end if;

    if v_reason is null then
      v_draft := v_work;
    elsif p_actor = 'ai' then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('index', v_i, 'op', v_kind, 'reason', v_reason));
    else
      raise exception using errcode = 'P0001', message = v_reason, detail = 'op ' || v_i;
    end if;
  end loop;

  -- One draft turn = +1, whatever the number of questions it proposed. `count_draft` (a draft whose content
  -- blocks were all dropped) counts too — AI 명세 "초안 횟수는 셈".
  if v_draft_turn then
    v_draft := jsonb_set(v_draft, '{draft_count}',
                         to_jsonb(coalesce((v_draft ->> 'draft_count')::integer, 0) + 1));
  end if;

  return jsonb_build_object('structured_draft', v_draft, 'rejected', v_rejected);
end;
$function$;
