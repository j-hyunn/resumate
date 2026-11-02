-- S3b: key decryption DB role (DM 2.11.2, DM §5, DM-16, NFR-KEY-03/07/08).
-- The job runner signs a short-lived JWT with role = app_key_reader and sub = user id (same mechanism as
-- app_ai_writer, S1). The role has NO table privileges at all; its only privilege is EXECUTE on
-- public.get_provider_key_secret(uuid), granted in the migration that creates that function.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_key_reader') then
    create role app_key_reader nologin noinherit;
  end if;
end;
$$;

grant app_key_reader to authenticator;

-- PostgREST needs schema usage to resolve the RPC. No usage on `private`: the function is security
-- definer and reaches everything it needs as its owner.
grant usage on schema public to app_key_reader;
