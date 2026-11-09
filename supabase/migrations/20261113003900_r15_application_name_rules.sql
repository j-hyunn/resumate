-- R15 / D12 (DM 11.10 #3, §2.6 "이름 규칙" — CF-9·CF-A7)
-- "회사명 – 포지션명" -> "{회사명} 자기소개서". The position title is not part of the name any more (the list's
-- second line is the position). Within the 100-character limit the company name is cut to its first 94 characters
-- (' 자기소개서' is 6) `[가정]`. No company name -> the default name ("새 자기소개서 (YYYY-MM-DD)").
-- Already saved names are NOT backfilled `[가정]` — S-13 shows both shapes for a while.
-- The signature keeps p_position_title so the callers (create_application_project, apply_jd_extraction,
-- fail_jd_extraction, application_fallback_name) do not change; the argument is ignored.
create or replace function private.application_compose_name(p_company_name text, p_position_title text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(p_company_name), '') is null then null
    else left(btrim(p_company_name), 94) || ' 자기소개서'
  end;
$$;

-- Unchanged body, re-stated so the intent is readable next to the rule above: a position title alone is not a
-- name any more, so the fallback is the default name (CF-A7).
create or replace function private.application_fallback_name(p_company_name text, p_position_title text,
  p_at timestamptz, out name text, out name_source text)
returns record
language sql
stable
set search_path = ''
as $$
  select coalesce(private.application_compose_name(p_company_name, p_position_title),
                  private.application_default_name(p_at)),
         case when private.application_compose_name(p_company_name, p_position_title) is null
              then 'default' else 'user' end;
$$;
