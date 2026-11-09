-- R15 후속 (리더 판정 2026-11-09) — application_documents 쓰기 우회 차단 · 첫 복사 기록 RPC · 읽기 확인
-- 비파괴. 20261113003100~004660은 원격(운영)에 이미 적용됐으므로 고치지 않는다 — 이 파일 하나로 한다.
-- 파괴 파일 20261113004700보다 앞 번호(파괴가 항상 마지막). 코드 배포 전에 따로 push된다.
--
-- A. 쓰기 우회 차단
--    20261113003100 gives authenticated INSERT / UPDATE on application_documents (plus insert_own / update_own
--    policies) because save_application_document is security INVOKER (DM §2.5.1 공통 규칙). That also let a
--    signed-in user write their own row straight through PostgREST and skip every rule of the save RPC: questions
--    <= 5 (too_many_questions), char_limit required, slot shape (invalid_slot), answer_title <= 100, the evidence
--    rules, and the filled_slot_count <-> body consistency. DM §2.7.3 names save_application_document as the
--    only insert / update path. Other users' rows were always safe (RLS); this is an integrity hole, not a
--    cross-user one.
--    Fix (리더 판정): keep the RPC invoker, and refuse an INSERT / UPDATE from an API role unless the
--    transaction-local setting `app.application_document_write` is 'on' `[가정: 이름]`. Only
--    save_application_document and mark_application_document_copied switch it on (set_config(..., true) =
--    local to the transaction) around their own write, and off right after. A PostgREST client cannot set an
--    `app.*` setting: it reaches only the exposed schema's functions, and PostgREST itself sets `request.*` only.
--    Refusal code `direct_write_not_allowed` (P0001, 403 suggested) `[가정]`.
--      * DELETE is NOT guarded — DM §2.7.3 keeps "delete 본인", and the application project cascade removes the row.
--      * Definer helpers (private.reset_application_document_slots for delete_career_item, the migration owner)
--        run as the function owner, not as an API role, so the guard does not apply to them (same test as
--        private.application_projects_user_update's `current_user = 'authenticated'`).
--      * app_ai_writer has SELECT only and service_role had its writes revoked in 20261113003100; the guard
--        names them anyway as a second line.
--
-- B. 첫 복사 기록 — public.mark_application_document_copied
--    first_copied_at had no writer: the old drafts path (private.drafts_keep_first_copied_at + a column grant,
--    20261102000100) is dropped by 20261113004700. DM §2.7.3: "첫 복사 시각(PRD 7장 '초안 활용률')". S-46 [복사]
--    calls it. first_copied_at = coalesce(first_copied_at, now()) — written once, never moved.
--    It must NOT move updated_at, which is the save RPC's expected version: a copy in one tab would otherwise
--    make the other tab's next save a stale_write. The shared private.set_updated_at trigger is replaced on this
--    table by private.application_documents_set_updated_at, which keeps updated_at when nothing but
--    first_copied_at changed (same idea as R5-DB-11 "값이 바뀌지 않은 저장은 updated_at 그대로").
--
-- C. 읽기 RLS 확인 (DM 7장 "서류 작성 화면 조회" · "보드 조회") — no policy was missing:
--    application_documents_select_own, writing_chats_select_own (+ the column grants of 20261113003200 for
--    application_project_id / document_kind), writing_chat_messages_select_own and evidence_links_select_own are
--    all `user_id = auth.uid()`, so a document chat, its messages / structured_draft and the
--    owner_type = 'application_document' evidence rows read through the user session. Asserted in
--    r15_document_write_guard.test.sql; nothing is opened here.

-- A ------------------------------------------------------------------------------------------------------------
create or replace function private.application_documents_guard_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon', 'app_ai_writer', 'app_key_reader', 'service_role')
     and coalesce(current_setting('app.application_document_write', true), '') <> 'on' then
    raise exception using errcode = 'P0001', message = 'direct_write_not_allowed',
      detail = 'application_documents is written through save_application_document only';
  end if;
  return new;
end;
$$;

create trigger application_documents_guard_write
  before insert or update on public.application_documents
  for each row execute function private.application_documents_guard_write();

-- B ------------------------------------------------------------------------------------------------------------
-- updated_at moves with the document's content, never with the copy stamp. In a BEFORE trigger the stored
-- generated column slot_count is not computed yet, so it is left out of the comparison.
create or replace function private.application_documents_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'first_copied_at' - 'slot_count')
     = (to_jsonb(old) - 'updated_at' - 'first_copied_at' - 'slot_count') then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger application_documents_set_updated_at on public.application_documents;
create trigger application_documents_set_updated_at
  before update on public.application_documents
  for each row execute function private.application_documents_set_updated_at();

create function public.mark_application_document_copied(
  p_application_project_id uuid,
  p_document_kind text default 'cover_letter'
)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  -- (v4.15, CF-1·CF-A2) the same kind check as the other document RPCs.
  if p_document_kind is distinct from 'cover_letter' then
    raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'document_kind';
  end if;

  perform set_config('app.application_document_write', 'on', true);
  -- Only a row without a stamp is touched, so a repeated copy writes nothing at all.
  update public.application_documents d
     set first_copied_at = now()
   where d.application_project_id = p_application_project_id and d.document_kind = p_document_kind
     and d.user_id = v_uid and d.first_copied_at is null;
  perform set_config('app.application_document_write', 'off', true);

  -- The stored value; null when there is no row (nothing saved yet) or it is another user's (RLS hides it)
  -- `[가정]` — not an error.
  select d.first_copied_at into v_at
    from public.application_documents d
   where d.application_project_id = p_application_project_id and d.document_kind = p_document_kind
     and d.user_id = v_uid;
  return v_at;
end;
$$;

revoke all on function public.mark_application_document_copied(uuid, text) from public, anon;
grant execute on function public.mark_application_document_copied(uuid, text) to authenticated;

-- A (continued): the save RPC, from its latest definition (20261113003700 + CF-S1; 004600 / 004660 replaced other
-- functions), with only the two set_config lines added around the document write. Behaviour is unchanged.
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
    v_stored_count := v_doc.slot_count;
    select coalesce(jsonb_object_agg(e ->> 'question_id', e -> 'char_limit'), '{}'::jsonb)
      into v_stored_limits
      from jsonb_array_elements(coalesce(v_doc.body -> 'questions', '[]'::jsonb)) e
     where (e ->> 'question_id') is not null;
  end if;

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
    insert into public.application_documents (user_id, application_project_id, document_kind, body, meta,
                                              filled_slot_count)
    values (v_uid, p_application_project_id, p_document_kind, v_new_body, v_meta, v_filled)
    returning * into v_doc;
  else
    -- Expected version: the document row's updated_at, and nothing else (DM §2.5.1 — name / deadline are not
    -- written either when it is stale).
    if p_expected_updated_at is not null and v_doc.updated_at <> p_expected_updated_at then
      raise exception using errcode = 'P0001', message = 'stale_write',
        detail = to_char(v_doc.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    end if;
    -- R5-DB-11: a save that changes nothing does not bump updated_at.
    if (v_new_body, v_meta, v_filled) is distinct from (v_doc.body, v_doc.meta, v_doc.filled_slot_count) then
      update public.application_documents d
         set body = v_new_body, meta = v_meta, filled_slot_count = v_filled
       where d.id = v_doc.id and d.user_id = v_uid
      returning * into v_doc;
    end if;
  end if;
  perform set_config('app.application_document_write', 'off', true);

  -- 반영됨 기록 (DM §2.5.1 공통 규칙): after the document is written, each element in its own subtransaction.
  -- A failure here never blocks the save. (CF-S1) The slots recorded as applied here are also the slots whose
  -- `{slot}.sources.{n}` rows are replaced from that proposal, so this loop runs BEFORE the evidence write.
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
    else
      begin
        v_reason := private.wc_mark_proposal_applied((v_el ->> 'writing_chat_id')::uuid, 'application_document',
                                                     p_application_project_id, v_el ->> 'slot',
                                                     (v_el ->> 'rev')::integer, p_document_kind);
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
