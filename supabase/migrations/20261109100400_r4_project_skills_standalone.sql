-- R4 project_skills (DM v4.4 §2.3 skills / project_skills, CR-10, CR-18): skills attach to standalone projects only.
-- Existing affiliated rows were cleared with the projects (20261109100100). Projects can't switch scope
-- (projects_guard_scope), so checking on insert is enough.

create or replace function private.project_skills_require_standalone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.projects p
              where p.id = new.project_id and p.user_id = new.user_id
                and num_nonnulls(p.experience_id, p.education_id) > 0) then
    raise exception using errcode = 'P0001', message = 'project_skill_requires_standalone_project';
  end if;
  return new;
end;
$$;

revoke all on function private.project_skills_require_standalone() from public;

create trigger project_skills_require_standalone
  before insert or update of project_id on public.project_skills
  for each row execute function private.project_skills_require_standalone();
