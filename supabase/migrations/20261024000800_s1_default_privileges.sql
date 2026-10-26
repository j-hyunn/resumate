-- S1 QA-04: stop Supabase's default privileges from opening every new object in `public`
-- to anon / authenticated. From here on each migration grants exactly what DM §5 allows.
-- Scope: objects created by `postgres` (the role migrations run as). Objects created by
-- supabase_admin keep platform defaults; postgres cannot alter those.
-- service_role keeps its default grants.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- EXECUTE to PUBLIC is a global default (it can't be revoked per schema), so revoke it globally
-- for postgres-created functions. New RPCs must `grant execute ... to authenticated` explicitly,
-- and so must any helper an RLS policy or invoker RPC calls.
alter default privileges for role postgres
  revoke execute on functions from public;
