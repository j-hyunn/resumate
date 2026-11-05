-- R12 QA fix (2026-11-05, QA-03): the start greetings' free-tier sentence → the settled UX v5.13 wording
-- (02-user-flows.md S-10 "+ 새 대화", S-44 "무료 등급 안내(S-10과 같은 문장)"; same sentence as C-19 tooltip · C-21).
-- AI v4.11 AI-12 / AI-13 leave the copy to ux-planner ([가정]). Since R-OD-15 the sentence appears only for
-- Gemini free, so {공급자} = Google. Non-destructive: function bodies only, identical to 20261113001300 (AI-12)
-- and 20261110000100 (AI-13) except that sentence. Greetings already stored in writing_chat_messages are not changed.

-- AI-12 (body from 20261113001300 §3).
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
         then ' 무료 등급에서는 입력한 내용이 Google 제품 개선에 쓰이고 사람이 검토할 수 있어요. 민감정보·회사 기밀은 쓰지 마세요.'
         else '' end;
end;
$$;

revoke all on function private.writing_chat_greeting(public.projects, text, boolean) from public;

-- AI-13 (body from 20261110000100).
create or replace function private.writing_chat_deliverable_greeting(p_title text, p_body_present boolean,
                                                                     p_writing_kind text, p_free_tier boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_title text := left(btrim(coalesce(p_title, '')), 100);
  v_label text;
  v_question text;
  v_body text;
begin
  if p_body_present then
    v_body := '지금 본문을 바탕으로 더 채워 볼게요. 보강하고 싶은 부분을 알려 주시거나, 아래 버튼으로 시작하세요.';
  elsif p_writing_kind is not null and p_writing_kind <> 'other' then
    v_label := case p_writing_kind
                 when 'planning_summary' then '기획서 요약'
                 when 'design_doc' then '설계 문서'
                 when 'retrospective' then '회고'
                 when 'presentation' then '발표'
               end;
    v_question := case p_writing_kind
                    when 'planning_summary' then '이 기획은 어떤 배경에서, 어떤 문제를 해결하려고 시작됐나요?'
                    when 'design_doc' then '이 설계로 해결하려던 문제나 요구사항은 무엇이었나요?'
                    when 'retrospective' then '회고하려는 일은 무엇이었나요? 기간과 범위를 알려 주세요.'
                    when 'presentation' then '어떤 자리에서, 누구를 대상으로 한 발표였나요?'
                  end;
    v_body := '''' || v_title || '''을 ' || v_label || private.ko_particle_ro(v_label) || ' 정리해 볼게요. ' || v_question;
  else
    v_body := '''' || v_title || '''을 함께 써 볼게요. 몇 가지 여쭤보고, 정리한 초안은 본문에 넣기 전에 먼저 보여 드릴게요. '
              || '어떤 글인가요? 기획서 요약, 설계 문서, 회고, 발표 내용처럼 알려 주세요.';
  end if;

  return v_body
    || E'\n\n'
    || '회사 기밀, 민감정보, 다른 사람의 개인정보는 쓰지 말아 주세요.'
    || case when p_free_tier
         then ' 무료 등급에서는 입력한 내용이 Google 제품 개선에 쓰이고 사람이 검토할 수 있어요. 민감정보·회사 기밀은 쓰지 마세요.'
         else '' end;
end;
$$;

revoke all on function private.writing_chat_deliverable_greeting(text, boolean, text, boolean) from public;
