-- R15 수정 (리더 판정 2026-11-09) — 서류 제안 블록의 `review` 강제 제거
-- 20261113003800's private.wc_document_block forced review = 'needs_review' / review_reason = 'no_evidence' on a
-- non-heading block whose `evidence[]` was empty. That went past the DB's defence range, twice over:
--   1) The judgement itself was wrong. A block has THREE kinds of source (DM §2.5.0b "blocks[] 출처 3종",
--      AI 명세 AI-04): `evidence` (career / JD) · `source_fact_ids` (facts of this chat) · `source_body_quotes`
--      (the document body right now — CL-4 이어 쓰기). "근거 0개면 needs_review" means all THREE are empty.
--      Looking at `evidence[]` alone turned every 이어 쓰기 block — the CL-4 path whose sources are chat facts or
--      quotes of the current answer — into needs_review, so the user had to accept each one.
--   2) It is not the DB's call. DM §2.5.0b "DB의 V-10 방어 범위 (서류)": the DB sees the SHAPE, LENGTH and COUNT
--      of blocks[].evidence[] only; §2.5.0a's R5-DB-6 puts "제목 외 블록은 출처 1개 이상"(V-10a) and V-10h on the
--      pipeline.
-- So the review / review_reason the pipeline sent are now stored as they are. What stays: the evidence element
-- shape / length / count checks (source_type in the DM §2.8 list, quote <= 2,000, <= 20 per block), the value
-- lists and lengths, and the V-8 last safety net in save_application_document (§2.8·§2.5.1's one named exception).
create or replace function private.wc_document_block(p_block jsonb, p_fact_ids uuid[], p_allowed text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb := private.wc_deliverable_block(p_block, p_fact_ids);
  v_ev jsonb;
begin
  if v_out ? 'reason' then
    return v_out;
  end if;
  -- DB defence range (DM §2.5.0b): the evidence elements' shape, length and count — nothing else.
  v_ev := private.wc_doc_evidence(p_block -> 'evidence', p_allowed);
  if v_ev is null then
    return jsonb_build_object('reason', 'invalid_source');
  end if;
  if coalesce(jsonb_typeof(p_block -> 'placeholders'), 'array') <> 'array'
     or coalesce(jsonb_array_length(p_block -> 'placeholders'), 0) > 20
     or coalesce(jsonb_typeof(p_block -> 'flags'), 'array') <> 'array'
     or coalesce(jsonb_array_length(p_block -> 'flags'), 0) > 20
     or coalesce(jsonb_typeof(p_block -> 'review_reason'), 'null') not in ('string', 'null')
     or char_length(p_block ->> 'review_reason') > 100 then
    return jsonb_build_object('reason', 'invalid_value');
  end if;
  -- review comes from wc_deliverable_block (value list ok / needs_review, default ok); review_reason is stored
  -- as sent. The pipeline decides both (V-4 / V-10a / V-10h).
  return v_out
    || jsonb_build_object(
         'evidence', v_ev,
         'placeholders', coalesce(p_block -> 'placeholders', '[]'::jsonb),
         'flags', coalesce(p_block -> 'flags', '[]'::jsonb),
         'review_reason', coalesce(p_block -> 'review_reason', 'null'::jsonb));
end;
$$;
