-- R4 (CR-23 [가정]): default application project name "새 자기소개서 (YYYY-MM-DD)" (was "새 기업 JD (…)").
-- Existing rows keep their names.

CREATE OR REPLACE FUNCTION private.application_default_name(p_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select '새 자기소개서 (' || to_char(p_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ')';
$function$;
