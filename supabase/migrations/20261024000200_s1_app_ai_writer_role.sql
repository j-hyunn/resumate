-- S1 foundation: AI work DB role (DM-13, DM §5).
-- The server signs a short-lived JWT with role = app_ai_writer and sub = user id;
-- PostgREST (authenticator) switches into this role so RLS still sees the user's id.
-- Table grants are added per table in the migration that creates the table.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_ai_writer') then
    create role app_ai_writer nologin noinherit;
  end if;
end;
$$;

grant app_ai_writer to authenticator;

grant usage on schema public to app_ai_writer;
grant usage on schema private to app_ai_writer;
grant execute on function private.current_uid() to app_ai_writer;
