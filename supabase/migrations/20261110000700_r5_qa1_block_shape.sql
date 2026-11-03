-- R5 QA round 1 fix QA-R5-06 (_workspace/backend/R5/03_backend-qa_report.md): the stored draft block shape now
-- matches the TS StoredBlockSchema, so a stored draft always parses on the app side.
--   * list items must be objects {text, source_*}; table rows must be objects {cells: string[], source_*}.
--     A string item / array row / non-string cell raises invalid_patch (a contract break, not a content rejection).
--   * source_project_fields must be one of PRJ.description / PRJ.role / PRJ.skills / PRJ.name / PRJ.period
--     (TS PROJECT_SOURCE_FIELDS); otherwise the block is rejected as invalid_source like other bad sources.
-- The markdown assembler is unchanged (it still reads both shapes; only objects reach it now).
-- Bodies otherwise identical to 20261110000200_r5_structured_draft_patch_v4.

create or replace function private.wc_block_sources(p jsonb, p_fact_ids uuid[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_facts jsonb := coalesce(nullif(p -> 'source_fact_ids', 'null'::jsonb), '[]'::jsonb);
  v_quotes jsonb := private.wc_quotes(p -> 'source_body_quotes');
  v_fields jsonb := coalesce(nullif(p -> 'source_project_fields', 'null'::jsonb), '[]'::jsonb);
begin
  if jsonb_typeof(v_facts) <> 'array' or jsonb_array_length(v_facts) > 40
     or exists (select 1 from jsonb_array_elements(v_facts) e
                 where not private.wc_is_uuid(e) or not ((e #>> '{}')::uuid = any (coalesce(p_fact_ids, '{}')))) then
    return null;
  end if;
  if v_quotes is null then
    return null;
  end if;
  if jsonb_typeof(v_fields) <> 'array' or jsonb_array_length(v_fields) > 10
     or exists (select 1 from jsonb_array_elements(v_fields) e
                 where jsonb_typeof(e) <> 'string'
                    or (e #>> '{}') not in ('PRJ.description', 'PRJ.role', 'PRJ.skills', 'PRJ.name', 'PRJ.period')) then
    return null;
  end if;
  return jsonb_build_object(
    'source_fact_ids', (select coalesce(jsonb_agg(distinct lower(e #>> '{}')), '[]'::jsonb) from jsonb_array_elements(v_facts) e),
    'source_body_quotes', v_quotes,
    'source_project_fields', v_fields);
end;
$$;

revoke all on function private.wc_block_sources(jsonb, uuid[]) from public;

create or replace function private.wc_deliverable_block(p_block jsonb, p_fact_ids uuid[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_type text := p_block ->> 'type';
  v_src jsonb;
  v_out jsonb;
  v_el jsonb;
  v_cells jsonb;
begin
  if jsonb_typeof(p_block) <> 'object'
     or jsonb_typeof(p_block -> 'block_id') is distinct from 'string'
     or char_length(p_block ->> 'block_id') not between 1 and 50
     or v_type is null
     or v_type not in ('heading', 'paragraph', 'bullet_list', 'numbered_list', 'table', 'quote', 'code')
     or coalesce(p_block ->> 'basis', 'new') not in ('new', 'current_body')
     or coalesce(jsonb_typeof(p_block -> 'basis'), 'null') not in ('string', 'null')
     or coalesce(p_block ->> 'review', 'ok') not in ('ok', 'needs_review') then
    return jsonb_build_object('reason', 'invalid_value');
  end if;

  v_src := private.wc_block_sources(p_block, p_fact_ids);
  if v_src is null then
    return jsonb_build_object('reason', 'invalid_source');
  end if;

  v_out := jsonb_build_object('block_id', p_block ->> 'block_id', 'type', v_type);

  if v_type = 'heading' then
    if coalesce(jsonb_typeof(p_block -> 'level'), 'null') not in ('number', 'null')
       or coalesce(p_block ->> 'level', '2') !~ '^[1-6]$'
       or jsonb_typeof(p_block -> 'text') is distinct from 'string'
       or char_length(btrim(p_block ->> 'text')) not between 1 and 500
       or p_block ->> 'text' ~ E'[\\r\\n]' then
      return jsonb_build_object('reason', 'invalid_value');
    end if;
    v_out := v_out || jsonb_build_object('level', coalesce((p_block ->> 'level')::integer, 2),
                                         'text', btrim(p_block ->> 'text'));
  elsif v_type in ('paragraph', 'quote', 'code') then
    if jsonb_typeof(p_block -> 'text') is distinct from 'string'
       or char_length(btrim(p_block ->> 'text')) not between 1 and 8000 then
      return jsonb_build_object('reason', 'invalid_value');
    end if;
    v_out := v_out || jsonb_build_object('text', p_block ->> 'text');
  elsif v_type in ('bullet_list', 'numbered_list') then
    if jsonb_typeof(p_block -> 'items') is distinct from 'array'
       or jsonb_array_length(p_block -> 'items') not between 1 and 100 then
      return jsonb_build_object('reason', 'invalid_value');
    end if;
    for v_el in select * from jsonb_array_elements(p_block -> 'items') loop
      -- QA-R5-06: items are objects {text, sources} (TS StoredListItemSchema); anything else breaks the contract.
      if jsonb_typeof(v_el) <> 'object' or jsonb_typeof(v_el -> 'text') is distinct from 'string' then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'list item must be an object';
      end if;
      if char_length(coalesce(private.wc_md_text(v_el), '')) not between 1 and 2000 then
        return jsonb_build_object('reason', 'invalid_value');
      end if;
      if private.wc_block_sources(v_el, p_fact_ids) is null then
        return jsonb_build_object('reason', 'invalid_source');
      end if;
    end loop;
    v_out := v_out || jsonb_build_object('items', p_block -> 'items');
  else -- table
    if jsonb_typeof(p_block -> 'rows') is distinct from 'array'
       or jsonb_array_length(p_block -> 'rows') not between 1 and 100 then
      return jsonb_build_object('reason', 'invalid_value');
    end if;
    for v_el in select * from jsonb_array_elements(p_block -> 'rows') loop
      -- QA-R5-06: rows are objects {cells: string[], sources} (TS StoredTableRowSchema).
      v_cells := v_el -> 'cells';
      if jsonb_typeof(v_el) <> 'object' or jsonb_typeof(v_cells) is distinct from 'array'
         or exists (select 1 from jsonb_array_elements(v_cells) c where jsonb_typeof(c) <> 'string') then
        raise exception using errcode = 'P0001', message = 'invalid_patch', detail = 'table row must be {cells: string[]}';
      end if;
      if jsonb_array_length(v_cells) not between 1 and 20
         or exists (select 1 from jsonb_array_elements(v_cells) c where char_length(c #>> '{}') > 1000) then
        return jsonb_build_object('reason', 'invalid_value');
      end if;
      if private.wc_block_sources(v_el, p_fact_ids) is null then
        return jsonb_build_object('reason', 'invalid_source');
      end if;
    end loop;
    v_out := v_out || jsonb_build_object('rows', p_block -> 'rows');
  end if;

  return v_out
    || jsonb_build_object('basis', case when v_type = 'heading' then p_block ->> 'basis'
                                        else coalesce(p_block ->> 'basis', 'new') end)
    || v_src
    || jsonb_build_object('review', coalesce(p_block ->> 'review', 'ok'));
end;
$$;

revoke all on function private.wc_deliverable_block(jsonb, uuid[]) from public;
