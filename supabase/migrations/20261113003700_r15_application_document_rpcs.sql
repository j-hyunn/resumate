-- R15 / D7 (DM 11.8 #4, §2.5.1 save_application_document, §2.5.0b, §2.7.3, §2.8 "서류 근거", §5
--           — CL-2·CL-3·CL-8·CL-9 · v4.15 CF-1·CF-5·CF-6·CF-A2·CF-A4·CF-A11·CF-M1)
-- Deployment stage 3. New objects only:
--   private.application_reset_name       definer, no external execute — empty name -> default name rule
--   private.doc_replace_slot_evidence    definer, no external execute — the document's evidence rows
--   private.wc_mark_document_applied     (via wc_mark_proposal_applied) 반영됨 기록 for a document slot
--   public.save_application_document     security INVOKER (user RLS) — the only way a document row is created
--   public.start_document_writing_chat   definer + ownership check — does NOT create the document row

-- ---------------------------------------------------------------------------------------------------------------
-- private.application_reset_name (v4.15 정렬, CF-A11 — UX DM-4) `[가정: 이름]`
-- An empty name in p_application_values goes back to the default name rule. A definer helper is needed because the
-- user-session update trigger (private.application_projects_user_update) refuses an empty name (invalid_name) and
-- always stamps name_source = 'user'; current_user is the owner here, so that branch is skipped.
create or replace function private.application_reset_name(p_application_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ap public.application_projects%rowtype;
  v_company text;
  v_company_source text;
  v_name text;
  v_name_source text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  select * into v_ap from public.application_projects ap
   where ap.id = p_application_project_id and ap.user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'application_project_not_found';
  end if;

  select nullif(btrim(jd.company_name), ''), jd.company_name_source into v_company, v_company_source
    from public.job_descriptions jd
   where jd.application_project_id = p_application_project_id and jd.user_id = v_uid;

  v_name := private.application_compose_name(v_company, null);
  if v_name is null then
    -- No company name: the default name. A later AI-01 extraction may build the name again (name_source default).
    v_name := private.application_default_name(v_ap.created_at);
    v_name_source := 'default';
  else
    -- CF-9: the name follows where the company name came from (user / ai).
    v_name_source := coalesce(v_company_source, 'user');
  end if;

  update public.application_projects ap
     set name = v_name, name_source = v_name_source, last_activity_at = now()
   where ap.id = p_application_project_id and ap.user_id = v_uid;

  return jsonb_build_object('name', v_name, 'name_source', v_name_source);
end;
$$;

revoke all on function private.application_reset_name(uuid) from public, anon, app_ai_writer, service_role;
-- save_application_document is security INVOKER, so the caller must be able to call its definer helpers. Same
-- shape as private.wc_mark_proposal_applied (R5): PUBLIC / anon / app_ai_writer have no execute, authenticated
-- does, and the helper re-checks ownership itself `[가정]`.
grant execute on function private.application_reset_name(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- private.doc_replace_slot_evidence (DM §2.5.1·§2.8 — CL-5 · CF-S1 2026-11-09)
-- The user path's first evidence writer (A24 "only inside a result save RPC" extended). The user session has no
-- direct insert grant on evidence_links, so this definer helper does it. Called once per save.
-- What it deletes (CF-S1):
--   * every row of a slot that was NOT sent (the question was deleted) — both kinds
--   * the block rows (`{slot}.blocks.{block_id}`) of every sent slot — they are rewritten from the body
--   * the slot-level rows (`{slot}.sources.{n}`) ONLY for the slots in p_source_slots, i.e. the slots whose
--     proposal was applied in this save. A slot that was only hand-edited keeps its existing sources rows
--     (DM §2.5.1's "슬롯마다 전부 지우고 다시 넣는다" therefore applies to the block rows) `[가정]`.
-- p_slots        = every slot in the saved body
-- p_source_slots = the slots whose `{slot}.sources.{n}` rows are replaced by p_rows
-- p_rows element: {item_key, sort_order, source_type, source_id, source_field, source_locator, quote, label,
--                  source_deleted}
create or replace function private.doc_replace_slot_evidence(
  p_application_document_id uuid,
  p_application_project_id uuid,
  p_rows jsonb,
  p_slots text[],
  p_source_slots text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if not exists (select 1 from public.application_documents d
                  where d.id = p_application_document_id and d.user_id = v_uid
                    and d.application_project_id = p_application_project_id) then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  delete from public.evidence_links el
   where el.user_id = v_uid and el.owner_type = 'application_document'
     and el.owner_id = p_application_document_id
     and (not (split_part(el.item_key, '.', 1) = any (coalesce(p_slots, '{}')))        -- slot no longer sent
          or el.item_key ~ '\.blocks\.'                                              -- block rows: always rewritten
          or split_part(el.item_key, '.', 1) = any (coalesce(p_source_slots, '{}')));  -- sources: replaced only when applied

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  insert into public.evidence_links (user_id, application_project_id, owner_type, owner_id, item_key, sort_order,
                                     source_type, source_id, source_locator, source_field, quote, quote_adjusted,
                                     source_snapshot_at, source_deleted_at, source_label)
  select v_uid, p_application_project_id, 'application_document', p_application_document_id,
         e ->> 'item_key', (e ->> 'sort_order')::integer,
         e ->> 'source_type', (e ->> 'source_id')::uuid,
         case when jsonb_typeof(e -> 'source_locator') = 'object' then e -> 'source_locator' end,
         nullif(e ->> 'source_field', ''),
         case when coalesce((e ->> 'source_deleted')::boolean, false) then null else e ->> 'quote' end,
         false,
         -- DM §2.8: project -> projects.content_updated_at, deliverable -> its updated_at, otherwise now().
         case e ->> 'source_type'
           when 'project' then (select p.content_updated_at from public.projects p
                                 where p.id = (e ->> 'source_id')::uuid and p.user_id = v_uid)
           when 'project_deliverable' then (select d.updated_at from public.project_deliverables d
                                             where d.id = (e ->> 'source_id')::uuid and d.user_id = v_uid)
           else null
         end,
         case when coalesce((e ->> 'source_deleted')::boolean, false) then v_now end,
         nullif(e ->> 'label', '')
    from jsonb_array_elements(p_rows) e;
  get diagnostics v_count = row_count;

  -- The insert trigger fills source_snapshot_at only when it is null and the source is gone; keep now() for the
  -- sources that have no snapshot column.
  update public.evidence_links el set source_snapshot_at = v_now
   where el.user_id = v_uid and el.owner_type = 'application_document'
     and el.owner_id = p_application_document_id and el.source_snapshot_at is null;

  return v_count;
end;
$$;

revoke all on function private.doc_replace_slot_evidence(uuid, uuid, jsonb, text[], text[])
  from public, anon, app_ai_writer, service_role;
grant execute on function private.doc_replace_slot_evidence(uuid, uuid, jsonb, text[], text[]) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- private.wc_mark_proposal_applied: third target kind 'application_document' (DM §2.5.1 공통 규칙).
--   p_target_id = the application project id, p_field = the slot (q_{n}), p_mode = the document kind.
--   applied_mode is not stored (a document is always a replace — there is no "덧붙이기" button, DM §2.5.0b).
create or replace function private.wc_mark_proposal_applied(p_writing_chat_id uuid, p_target_kind text,
  p_target_id uuid, p_field text, p_rev integer, p_mode text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_chat public.writing_chats%rowtype;
  v_draft jsonb;
  v_section text;
  v_path text[];
  v_obj jsonb;
  v_idx integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_target_kind is null
     or p_target_kind not in ('project', 'project_deliverable', 'application_document')
     or p_rev is null then
    return 'invalid_entry';
  end if;

  select * into v_chat from public.writing_chats w
   where w.id = p_writing_chat_id and w.user_id = v_uid
     for update;
  if not found then
    return 'not_found';
  end if;

  if p_target_kind = 'project' then
    v_section := case
      when p_field in ('situation', 'task', 'action', 'result', 'learnings') then 'star'
      when p_field in ('start_month', 'end_month') then 'project'
      when p_field in ('project_type', 'experience_type', 'competencies') then 'classification'
    end;
    if v_section is null then
      return 'invalid_entry';
    end if;
    if v_chat.project_id is distinct from p_target_id or v_chat.project_deliverable_id is not null then
      return 'not_found';
    end if;
    v_draft := private.wc_normalize_draft(v_chat.structured_draft);
    v_path := array[v_section, p_field];
  elsif p_target_kind = 'project_deliverable' then
    if p_mode is null or p_mode not in ('replace', 'append') then
      return 'invalid_entry';
    end if;
    if v_chat.project_deliverable_id is distinct from p_target_id then
      return 'not_found';
    end if;
    v_draft := private.wc_normalize_deliverable_draft(v_chat.structured_draft);
    v_path := array['deliverable', 'body'];
  else
    -- R15: a document slot. The chat must be this application project's chat of this kind (DM §2.5.1).
    if p_field is null or p_field !~ '^q_[0-9]{1,3}$' then
      return 'invalid_entry';
    end if;
    if v_chat.application_project_id is distinct from p_target_id
       or v_chat.document_kind is distinct from p_mode then
      return 'not_found';
    end if;
    v_draft := private.wc_normalize_document_draft(v_chat.structured_draft, v_chat.document_kind);
    select (o - 1)::integer into v_idx
      from jsonb_array_elements(v_draft #> '{document,questions}') with ordinality as t (q, o)
     where q ->> 'slot' = p_field;
    if v_idx is null then
      return 'not_found';
    end if;
    v_path := array['document', 'questions', v_idx::text, 'draft'];
  end if;

  v_obj := v_draft #> v_path;
  if jsonb_typeof(v_obj) is distinct from 'object' or v_obj = '{}'::jsonb then
    return 'not_found';
  end if;
  if coalesce(jsonb_typeof(v_obj -> 'applied_at'), 'null') <> 'null' then
    return 'already_applied';
  end if;
  if private.wc_rev(v_obj) <> p_rev then
    return 'proposal_changed';
  end if;
  if coalesce(jsonb_typeof(v_obj -> 'value'), 'null') = 'null' then
    return 'not_found';
  end if;

  if p_target_kind = 'project' then
    if coalesce(v_obj ->> 'review', 'ok') not in ('ok', 'accepted') then
      return 'needs_review';
    end if;
    v_obj := v_obj || jsonb_build_object('applied_at', v_now);
  else
    -- Deliverable / document: skipped only when no content block can be filled (unaccepted needs_review blocks were
    -- already left out by the fill, DM §2.5.1 / §3.3).
    if not exists (select 1 from jsonb_array_elements(coalesce(v_obj -> 'blocks', '[]'::jsonb)) b
                    where b ->> 'type' <> 'heading' and coalesce(b ->> 'review', 'ok') in ('ok', 'accepted')) then
      return 'needs_review';
    end if;
    if p_target_kind = 'project_deliverable' then
      v_obj := v_obj || jsonb_build_object('applied_at', v_now, 'applied_mode', p_mode, 'applied_rev', p_rev);
    else
      v_obj := v_obj || jsonb_build_object('applied_at', v_now, 'applied_rev', p_rev);
    end if;
  end if;

  update public.writing_chats w
     set structured_draft = jsonb_set(v_draft, v_path, v_obj),
         last_applied_at = v_now, last_activity_at = v_now
   where w.id = p_writing_chat_id;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Empty / normalized document proposal shape (DM §2.5.0b). schema_version stays 1 (11.8 is undeployed, so the
-- first version already carries answer_title — v4.15, CF-A4).
create or replace function private.writing_chat_empty_document_draft(p_document_kind text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'target', p_document_kind,
    'facts', '[]'::jsonb,
    'document', '{}'::jsonb,
    'meta', '{}'::jsonb,
    'clarifications', '[]'::jsonb,
    'sensitive_flags_count', 0,
    'draft_count', 0);
$$;

create or replace function private.wc_normalize_document_draft(p_draft jsonb, p_document_kind text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with base as (
    select private.writing_chat_empty_document_draft(p_document_kind)
           || case when p_draft ->> 'target' = p_document_kind and p_draft ->> 'schema_version' = '1'
                   then p_draft else '{}'::jsonb end as d
  )
  select jsonb_set(d, '{document}',
           jsonb_build_object(
             'questions', case when jsonb_typeof(d #> '{document,questions}') = 'array'
                               then d #> '{document,questions}' else '[]'::jsonb end,
             'question_edit_proposal', case when jsonb_typeof(d #> '{document,question_edit_proposal}') = 'array'
                                            then d #> '{document,question_edit_proposal}' else '[]'::jsonb end))
    from base;
$$;

-- Greeting for a document chat: 4 fixed shapes (DM §2.5 start RPC — 본문 없음 / 일부 / 전부 / 요건 추출 전)
-- plus the sensitive-information line and the free-tier line. Final wording belongs to UX `[가정]`.
create or replace function private.writing_chat_document_greeting(
  p_requirements_ready boolean, p_slot_count integer, p_filled_count integer, p_free_tier boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_body text;
begin
  if not p_requirements_ready then
    v_body := '채용 공고의 요건을 아직 정리하지 않았어요. 먼저 "채용 공고" 탭에서 요건을 정리하면 '
              || '공고에 맞춘 초안을 만들 수 있어요. 그때까지는 경력 데이터만으로 이야기를 정리해 볼게요.';
  elsif coalesce(p_slot_count, 0) = 0 or coalesce(p_filled_count, 0) = 0 then
    v_body := '자기소개서 문항에 답할 내용을 함께 정리해 볼게요. 어떤 경험을 쓰고 싶으신지 알려 주시거나, '
              || '아래 버튼으로 초안부터 받아 보세요.';
  elsif p_filled_count < p_slot_count then
    v_body := '지금 쓰신 답변을 바탕으로 남은 문항을 채워 볼게요. 먼저 손보고 싶은 문항이 있으면 알려 주세요.';
  else
    v_body := '문항을 모두 채우셨네요. 더 다듬고 싶은 문항이나 보강할 내용을 알려 주시면 함께 고쳐 볼게요.';
  end if;

  return v_body
    || E'\n\n'
    || '회사 기밀, 민감정보, 다른 사람의 개인정보는 쓰지 말아 주세요.'
    || case when p_free_tier
         then ' 무료 등급에서는 입력한 내용이 Google 제품 개선에 쓰이고 사람이 검토할 수 있어요. 민감정보·회사 기밀은 쓰지 마세요.'
         else '' end;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- public.start_document_writing_chat (DM §2.5 "서류 대화", 11.8 #4 — CL-1)
-- Does NOT create the document row (DM §2.5.1 "정본 행이 생기는 때" — only save_application_document does).
create or replace function public.start_document_writing_chat(
  p_application_project_id uuid,
  p_document_kind text,
  p_form_snapshot jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_snap jsonb;
  v_questions jsonb;
  v_q jsonb;
  v_requirements_ready boolean;
  v_slot_count integer := 0;
  v_filled integer := 0;
  v_chat_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  -- (v4.15, CF-1·CF-A2) only the cover letter. The argument stays for the signature `[가정]`.
  if p_document_kind is distinct from 'cover_letter' then
    raise exception using errcode = 'P0001', message = 'invalid_fields', detail = 'document_kind';
  end if;
  if not exists (select 1 from public.application_projects ap
                  where ap.id = p_application_project_id and ap.user_id = v_uid) then
    raise exception using errcode = 'P0001', message = 'application_project_not_found';
  end if;

  select jd.extraction_status = 'succeeded' into v_requirements_ready
    from public.job_descriptions jd
   where jd.application_project_id = p_application_project_id and jd.user_id = v_uid;
  v_requirements_ready := coalesce(v_requirements_ready, false);

  -- The body right now: snapshot wins over the stored row (리더 정렬 2). The snapshot is never stored.
  v_snap := nullif(p_form_snapshot, 'null'::jsonb);
  if v_snap is not null then
    v_questions := nullif(v_snap -> 'questions', 'null'::jsonb);
    if jsonb_typeof(v_snap) <> 'object'
       or (v_questions is not null and jsonb_typeof(v_questions) <> 'array')
       or coalesce(jsonb_array_length(v_questions), 0) > 20 then
      raise exception using errcode = 'P0001', message = 'invalid_form_snapshot';
    end if;
    for v_q in select e from jsonb_array_elements(coalesce(v_questions, '[]'::jsonb)) e loop
      if jsonb_typeof(v_q) <> 'object'
         or coalesce(v_q ->> 'slot', '') !~ '^q_[0-9]{1,3}$'
         or coalesce(jsonb_typeof(v_q -> 'question_text'), 'null') not in ('string', 'null')
         or char_length(v_q ->> 'question_text') > 1000
         or coalesce(jsonb_typeof(v_q -> 'answer_title'), 'null') not in ('string', 'null')
         or char_length(v_q ->> 'answer_title') > 100
         or coalesce(jsonb_typeof(v_q -> 'user_note'), 'null') not in ('string', 'null')
         or char_length(v_q ->> 'user_note') > 300
         or coalesce(jsonb_typeof(v_q -> 'body'), 'null') not in ('string', 'null')
         or char_length(v_q ->> 'body') > 8000
         or coalesce(jsonb_typeof(v_q -> 'char_limit'), 'null') not in ('number', 'null')
         or coalesce(jsonb_typeof(v_q -> 'count_basis'), 'null') not in ('string', 'null') then
        raise exception using errcode = 'P0001', message = 'invalid_form_snapshot';
      end if;
    end loop;
    v_slot_count := coalesce(jsonb_array_length(v_questions), 0);
    select count(*)::integer into v_filled
      from jsonb_array_elements(coalesce(v_questions, '[]'::jsonb)) e
     where nullif(btrim(coalesce(e ->> 'body', '')), '') is not null;
  else
    select d.slot_count,
           (select count(*)::integer from jsonb_array_elements(coalesce(d.body -> 'questions', '[]'::jsonb)) e
             where nullif(btrim(coalesce(e ->> 'body', '')), '') is not null)
      into v_slot_count, v_filled
      from public.application_documents d
     where d.application_project_id = p_application_project_id and d.document_kind = p_document_kind
       and d.user_id = v_uid;
    v_slot_count := coalesce(v_slot_count, 0);
    v_filled := coalesce(v_filled, 0);
  end if;

  insert into public.writing_chats (user_id, project_id, application_project_id, document_kind, structured_draft,
                                    message_count, return_target)
  values (v_uid, null, p_application_project_id, p_document_kind,
          private.writing_chat_empty_document_draft(p_document_kind), 0, null)
  returning id into v_chat_id;

  insert into public.writing_chat_messages (user_id, writing_chat_id, sequence, role, content, status)
  values (v_uid, v_chat_id, 1, 'assistant',
          private.writing_chat_document_greeting(v_requirements_ready, v_slot_count, v_filled,
                                                 private.writing_chat_free_tier(v_uid)),
          'done');

  return v_chat_id;
end;
$$;

revoke all on function public.start_document_writing_chat(uuid, text, jsonb) from public, anon;
grant execute on function public.start_document_writing_chat(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- private.doc_evidence_row: shape check + normalization of one evidence element of a document save
-- (DM §2.5.0b "DB의 V-10 방어 범위 (서류)" + §2.8 "검증 분담"). V-1~V-9, the number guard and the ownership check
-- are not here (the proposal stage and the insert trigger do those); the value-list rule V-8 is, as the last net.
-- Element: {source_type, source_id, source_field, source_locator, quote, label}
create or replace function private.doc_evidence_row(
  p_item_key text,
  p_sort_order integer,
  p_e jsonb,
  p_allowed text[],
  p_question_class text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_type text := p_e ->> 'source_type';
begin
  if jsonb_typeof(p_e) <> 'object'
     or coalesce(jsonb_typeof(p_e -> 'source_id'), 'null') <> 'string'
     or (p_e ->> 'source_id') !~* c_uuid_re
     or coalesce(jsonb_typeof(p_e -> 'source_field'), 'null') not in ('string', 'null')
     or coalesce(jsonb_typeof(p_e -> 'source_locator'), 'object') not in ('object', 'null')
     or coalesce(jsonb_typeof(p_e -> 'quote'), 'null') not in ('string', 'null')
     or coalesce(jsonb_typeof(p_e -> 'label'), 'null') not in ('string', 'null') then
    raise exception using errcode = 'P0001', message = 'invalid_fields', detail = p_item_key;
  end if;
  -- The allowed source list is private.evidence_allowed_sources('application_document') — the same list the
  -- insert trigger uses (DM §2.8, R-SD-9).
  if v_type is null or not (v_type = any (p_allowed)) then
    raise exception using errcode = 'P0001', message = 'invalid_evidence_source', detail = p_item_key;
  end if;
  if char_length(p_e ->> 'quote') > 2000 then
    raise exception using errcode = 'P0001', message = 'field_too_long', detail = p_item_key || '.quote';
  end if;
  if char_length(p_e ->> 'label') > 300 then
    raise exception using errcode = 'P0001', message = 'field_too_long', detail = p_item_key || '.label';
  end if;
  -- V-8 last safety net (DM §2.8): a job_competency question may not cite project.learnings.
  if p_question_class = 'job_competency' and v_type = 'project' and (p_e ->> 'source_field') = 'learnings' then
    raise exception using errcode = 'P0001', message = 'invalid_evidence_source',
      detail = p_item_key || '.learnings';
  end if;

  return jsonb_build_object(
    'item_key', p_item_key,
    'sort_order', p_sort_order,
    'source_type', v_type,
    'source_id', lower(p_e ->> 'source_id'),
    'source_field', p_e -> 'source_field',
    'source_locator', p_e -> 'source_locator',
    'quote', p_e -> 'quote',
    'label', p_e -> 'label',
    'source_deleted', false);
end;
$$;

revoke all on function private.doc_evidence_row(text, integer, jsonb, text[], text) from public, anon;
grant execute on function private.doc_evidence_row(text, integer, jsonb, text[], text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- private.doc_proposal_sources (CF-S1 2026-11-09, 사용자 결정; document PR #68 not merged here)
-- The slot-level citations of a document proposal: structured_draft.document.questions[].draft.sources[].
-- save_application_document reads them for the slots whose proposal it just recorded as applied, so a screen can
-- never present its own values as an AI-sourced citation (same property as CF-A17's preview result).
create or replace function private.doc_proposal_sources(
  p_writing_chat_id uuid,
  p_application_project_id uuid,
  p_document_kind text,
  p_slot text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_draft jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  select private.wc_normalize_document_draft(w.structured_draft, w.document_kind) into v_draft
    from public.writing_chats w
   where w.id = p_writing_chat_id and w.user_id = v_uid
     and w.application_project_id = p_application_project_id
     and w.document_kind = p_document_kind;
  if v_draft is null then
    return '[]'::jsonb;
  end if;
  -- NULL = "this proposal carries no sources key" -> the save RPC keeps the slot's existing rows.
  -- '[]'  = "no citation" -> the save RPC clears them.
  return (select q #> '{draft,sources}'
            from jsonb_array_elements(v_draft #> '{document,questions}') q
           where q ->> 'slot' = p_slot
             and jsonb_typeof(q #> '{draft,sources}') = 'array'
           limit 1);
end;
$$;

revoke all on function private.doc_proposal_sources(uuid, uuid, text, text) from public, anon, app_ai_writer,
  service_role;
grant execute on function private.doc_proposal_sources(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- public.save_application_document (DM §2.5.1 ★ — CL-2·CL-9 · v4.15 CF-1·CF-5·CF-6·CF-A4·CF-A11)
-- security INVOKER: the document is user data, written under the user's own RLS. It never looks at the key, the
-- consent or the active provider (CL-8). The target is (p_application_project_id, p_document_kind), not an id:
-- the row is created when missing and updated when present, and this RPC is the ONLY way it is created.
-- p_client_id is accepted and ignored (the unique constraint plays the idempotency key's role) `[가정]`.
create or replace function public.save_application_document(
  p_application_project_id uuid,
  p_document_kind text,
  p_body jsonb,
  p_meta jsonb default null,
  p_expected_updated_at timestamptz default null,
  p_applied_proposals jsonb default null,
  p_client_id uuid default null,
  p_application_values jsonb default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
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
$$;

revoke all on function public.save_application_document(uuid, text, jsonb, jsonb, timestamptz, jsonb, uuid, jsonb)
  from public, anon;
grant execute on function public.save_application_document(uuid, text, jsonb, jsonb, timestamptz, jsonb, uuid, jsonb)
  to authenticated;
