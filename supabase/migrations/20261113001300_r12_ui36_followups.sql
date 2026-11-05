-- R12 (2026-11-05): backend follow-ups of UI runs 36·37 (spec-gaps UI36-6·UI36-10, decisions.md 4.13, UX v5.14
-- U36-2·U36-5·U36-6, AI v4.11 C-7.1 R-OD-15). Non-destructive: inserts + function bodies only.
--
-- 1. policy_versions 2026-11-05 for privacy · terms · cross_border_transfer (docs/legal/ 2026-11-05 revision):
--    Anthropic inference region (cross-border, privacy §6, OD-L2a) and the dropped "정량 성과" (privacy §1·§6,
--    terms §2, U36-5). The processing purpose and items only shrink or are clarified, so no reconsent (U36-5).
--    Effective from 2026-11-05 KST so S-30 shows the new versions as soon as this is applied.
-- 2. New cover_letter drafts' default title "자소서 문항 답변 (YYYY-MM-DD)" (D-UX-23 / U36-2): "자기소개서" is the
--    application project's screen name since CR-23.
-- 3. AI-12 fixed greeting gate line for cover_letter → "자소서 문항 답변을" (U36-6, same name as the
--    TS prompt label `GATE_FEATURE_LABEL`).
-- 4. R-OD-15: the greeting's free-tier data-use sentence only where the provider uses inputs for training
--    (AI C-7.1) — Gemini free. `writing_chat_free_tier` is what start_writing_chat / start_deliverable_writing_chat
--    pass to the greeting; it no longer answers true for OpenAI / Anthropic free keys.

-- 1 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
insert into public.policy_versions (policy_type, version, effective_at, requires_reconsent, document_path)
values
  ('terms',                 '2026-11-05', '2026-11-05 00:00:00+09', false, '/policies/terms/2026-11-05'),
  ('privacy',               '2026-11-05', '2026-11-05 00:00:00+09', false, '/policies/privacy/2026-11-05'),
  ('cross_border_transfer', '2026-11-05', '2026-11-05 00:00:00+09', false, '/policies/cross_border_transfer/2026-11-05')
on conflict (policy_type, version) do nothing;

-- 2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Default title "{종류} (YYYY-MM-DD)" in KST (S7 [가정 5]; cover_letter name D-UX-23, U36-2).
create or replace function private.draft_default_title(p_draft_type text)
returns text
language sql
stable
set search_path = ''
as $$
  select case p_draft_type when 'career_description' then '경력기술서' else '자소서 문항 답변' end
         || ' (' || to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ')';
$$;

revoke all on function private.draft_default_title(text) from public;

-- 3 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Same body as 20261109100800 except the cover_letter gate label (U36-6).
create or replace function private.writing_chat_greeting(p_project public.projects, p_gate_feature text,
                                                         p_free_tier boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_slots constant text[] := array['situation', 'task', 'action', 'result', 'learnings'];
  c_labels constant text[] := array['상황', '역할', '행동', '결과/성과', '배운 점'];
  c_questions constant text[] := array[
    '그때 어떤 상황이었나요? 팀이나 서비스 배경을 알려 주세요.',
    '그 상황에서 맡은 역할이나 해결해야 했던 목표는 무엇이었나요?',
    '그 안에서 본인이 직접 한 일은 무엇인가요?',
    '결과는 어땠나요? 수치로 알고 있는 게 있다면 함께 말해 주세요.',
    '이 경험에서 배운 점이나 다음에 다르게 할 점이 있나요?'];
  v_values text[] := array[p_project.situation, p_project.task, p_project.action, p_project.result,
                           p_project.learnings];
  v_name text := left(btrim(p_project.name), 100);
  v_filled int := 0;
  v_first int;
  v_body text;
  v_gate text := '';
begin
  for i in 1 .. 5 loop
    if nullif(btrim(v_values[i]), '') is not null then
      v_filled := v_filled + 1;
    elsif v_first is null then
      v_first := i;
    end if;
  end loop;

  if v_filled = 0 then
    v_body := '''' || v_name || '''을 함께 정리해 볼게요. 하나씩 여쭤보고, 정리한 내용은 왼쪽에 반영하기 전에 '
              || '먼저 보여 드릴게요. 이 프로젝트는 어떤 상황에서 시작됐나요?';
  elsif v_filled < 5 then
    v_body := '''' || v_name || '''에서 비어 있는 ' || c_labels[v_first] || '부터 여쭤볼게요. '
              || c_questions[v_first];
  else
    v_body := '모든 항목이 채워져 있어요. 보강하고 싶은 항목을 골라 주세요.';
  end if;

  if p_gate_feature is not null then
    v_gate := case p_gate_feature
                when 'insight' then '인사이트를'
                when 'career_description' then '경력기술서를'
                when 'cover_letter' then '자소서 문항 답변을'
                when 'job_interview' then '직무 면접을'
                else '이 기능을'
              end || ' 쓰려면 이 프로젝트의 상황과 행동이 필요해요.' || E'\n\n';
  end if;

  return v_gate || v_body
    || E'\n\n'
    || '건강·종교·노조 활동 같은 민감정보, 동료·고객의 개인정보, 회사 기밀은 말하지 말아 주세요.'
    || case when p_free_tier
         then ' 지금 연결된 AI는 무료 등급이라 입력한 내용이 공급자의 서비스 개선에 쓰일 수 있어요. 민감한 내용은 특히 조심해 주세요.'
         else '' end;
end;
$$;

revoke all on function private.writing_chat_greeting(public.projects, text, boolean) from public;

-- 4 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- R-OD-15 (AI v4.11 C-7.1): only Gemini free uses inputs for training → only then the free-tier sentence.
create or replace function private.writing_chat_free_tier(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
      join public.ai_provider_keys k on k.user_id = p.id and k.provider = p.active_ai_provider
     where p.id = p_uid and k.provider = 'gemini' and k.connection_tier = 'free');
$$;

revoke all on function private.writing_chat_free_tier(uuid) from public;
