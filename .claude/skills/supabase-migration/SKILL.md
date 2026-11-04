---
name: supabase-migration
description: "Guide for implementing the Resumate data model as Supabase migrations: tables, text+CHECK enums, composite FKs (parent_id, user_id), updated_at triggers, RLS policies, the app_ai_writer role and column grants, RPC functions (security invoker/definer), evidence deletion triggers, pgTAP tests, seed data, and TypeScript type generation. Use whenever writing or fixing migration SQL, RLS policies, RPCs, DB triggers, pgTAP tests, applying migrations locally, or preparing them for the remote (production) project — file ordering, destructive-migration marking, release checks. Korean triggers: 마이그레이션 작성, 테이블 생성, RLS 정책 구현, RPC 함수 구현, DB 트리거, pgTAP 테스트, 타입 생성, 스키마 반영, 원격 반영 준비, 마이그레이션 순서. Not for planning-stage schema design documents (use data-model-spec)."
---

# Supabase Migration

The data model document (`docs/planning/04-data-model.md`) is the spec; this skill is how to turn it into SQL that Postgres enforces.

## Order of work (per slice)

1. Read the slice plan and the DM sections it points to. List every table, column, CHECK list, FK, index, policy, grant, and RPC the slice needs.
2. Write migrations — one concern per file, in dependency order (tables → triggers → RLS → grants → RPCs). Name them per "File names" below.
3. `supabase db reset` (applies all migrations + `seed.sql` locally).
4. Write pgTAP tests, `supabase test db`.
5. `supabase gen types typescript --local > src/server/db/database.types.ts`.
6. Write `02_db-engineer_notes.md` and notify teammates.
7. Remote: never applied by you during a slice. The leader's release step (orchestrator Phase 4) handles it; see "Remote (production)".

## File names

- `YYYYMMDDHHMMSS_<slice>_<what>.sql` (e.g. `…_r6_drop_old_column.sql`). The timestamp must be greater than the newest file in `supabase/migrations/` — existing files run ahead of the real date, so compute `max(now, newest + 1 second)`. Check with `ls supabase/migrations | tail -1` before naming.
- Never edit or rename a migration that has been pushed to the remote (`list_migrations` shows it). An unpushed file of this slice may be renamed to fix ordering.

## Destructive migrations

A migration that deletes or truncates rows, drops a table or a column that holds data, or rewrites data irreversibly:
- First line: `-- DESTRUCTIVE: <what is lost, which tables>`.
- Keep it in its own file, separate from additive changes, so the user can see exactly what a push will delete.
- List it in the notes under "파괴적 마이그레이션". The remote project is production — it reaches the remote only after the user confirms that data loss.
- Prefer an additive path (new column + backfill, drop later) when the spec allows it; if it doesn't, say so in the notes.

## Table rules (from DM §0)

- `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` + shared `set_updated_at()` trigger.
- `user_id uuid not null references auth.users(id) on delete cascade` on every user-data table (DM-1). Account deletion depends on this cascade; don't skip it on "child" tables.
- Parent–child: add `unique (id, user_id)` on the parent and `foreign key (parent_id, user_id) references parent(id, user_id)` on the child (DM-2). This stops a row pointing at another user's parent even if RLS were bypassed.
- Enums are `text` + `check (col in (...))` (DM-3). Copy the value list from the spec exactly and name the constraint `<table>_<col>_check` so later migrations can drop and replace it.
- Year-month values are `date` pinned to day 1 (DM-4): add `check (extract(day from col) = 1)`.
- AI results: `jsonb` + `schema_version` + the AI output common meta columns (DM §0).
- Soft references (DM-7, DM-11) are plain `uuid` columns with no FK, plus whatever trigger the spec names for "source deleted".
- Index every FK column and every query the spec's API table filters on (e.g. `ai_jobs (user_id, application_project_id, job_type, input_hash) where status = 'succeeded'`).

## RLS

- `alter table ... enable row level security;` in the same file that creates the table.
- One policy per operation, named `<table>_<op>_<who>`, matching the DM §5 matrix. Typical owner policy:
  ```sql
  create policy experiences_select_own on experiences
    for select to authenticated using (user_id = (select auth.uid()));
  ```
  Wrap `auth.uid()` in `(select ...)` so Postgres evaluates it once per query.
- "RPC only" in the matrix means: no insert/update policy for `authenticated` on those columns, and the RPC does the write. Column-restricted updates use column-level `grant update (col, ...)` rather than trying to express it in a policy.
- `app_ai_writer`: `create role app_ai_writer nologin; grant app_ai_writer to authenticator;` then explicit `grant select` / `grant insert` / `grant update (cols)` per DM §5. Its policies use `to app_ai_writer` and still check `user_id = (select auth.uid())`. Record the auth mechanism decision from S1 in the notes.
- `app_key_reader` (BYOK, DM 2.11.2): `create role app_key_reader nologin noinherit; grant app_key_reader to authenticator;` with **no table privileges at all** — only `grant execute` on `get_provider_key_secret(ai_job_id)` (security definer). That function returns the ciphertext columns only when the job is `running`, its heartbeat is recent, and a key row with the job's `user_id` and `provider` exists; everything else is refused.
- **Key ciphertext columns** (`key_ciphertext`, `key_nonce`, `wrapped_dek`, `kek_id`) get **no grant** for `anon`, `authenticated`, `app_ai_writer`, or any operator-facing role. Screens read keys through column grants on the metadata columns or the `ai_provider_keys_public` view (security invoker). Writes go through the key RPCs (DM 2.11.3), which never read the ciphertext except `save_provider_key` storing what the server sends.
- No reservation / charging / quota tables or RPCs (D-34). AI usage is the append-only `ai_usage_records` (insert by `app_ai_writer` only, no update/delete) plus the operator-maintained `ai_price_tables` (new version rows, never edited).

## RPC functions

- Signatures and return shapes come from DM §6–7. Return `jsonb` when the spec shows a JSON object; keep key names identical.
- `security invoker` unless the spec says definer. For `security definer`: `set search_path = ''`, fully qualify every name, and check ownership first (`if not exists (select 1 from public.application_projects where id = p_id and user_id = auth.uid()) then raise exception ...`).
- `revoke execute on function ... from public, anon;` then `grant execute ... to authenticated` (and/or `app_ai_writer`).
- Raise errors with a stable code the app can map: `raise exception using errcode = 'P0001', message = 'message_limit_reached';`

## pgTAP tests (minimum per slice)

- Every new user-data table: RLS enabled (`policies_are` or `row_security_enabled`), user B can't select/update/delete user A's rows.
- `app_ai_writer` can't insert/update career tables; can write what DM §5 allows.
- Key isolation (BYOK): user sessions and `app_ai_writer` can't select ciphertext columns; `get_provider_key_secret` refuses another user's job, another provider, and non-running or stale jobs; `app_key_reader` can do nothing else.
- Each RPC: happy path + each `raise` branch.
- Cascades and deletion triggers: deleting a source sets `evidence_links.quote = null` and `source_deleted_at` (C-3).
- Simulate users with `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';`.

## Remote (production)

The single remote project is production (backend-context.md "Remote environments"); there is no development branch.
- Read-only checks are fine anytime: `list_migrations` (what's applied), `list_tables`, `get_advisors`.
- The push itself is `supabase db push` on the linked project, run by the user from the release checklist (`05_release.md`). The SQL is too large for per-file MCP `apply_migration`, and the user holds the DB password. Run it yourself only if the user asks for exactly that.
- Before the push: every local-only file sorts after the remote's last applied migration; destructive files are confirmed by the user.
- After the push: `list_migrations` matches the local folder; `get_advisors` (security + performance) — compare with the accepted items in `decisions.md` and report only new ones.
- Remote types: `database.types.ts` stays generated from the local stack; if `list_tables` shows the remote differs from local after a push, report it — don't regenerate from the remote.
- If a Supabase development branch is created later (cost confirmed by the user): `list_branches`, confirm the target `project_ref` is that branch before every call, apply the same files in order, run advisors there.

## Notes template (`02_db-engineer_notes.md`, Korean)

```markdown
# {slice} DB 구현 노트
## 마이그레이션 파일
## 테이블·컬럼 (스펙 대비 차이 포함)
## RPC 시그니처와 반환 형태
## RLS·권한 요약 (DM §5 대비)
## 테스트 (`supabase test db` 결과)
## 파괴적 마이그레이션 (파일, 지워지는 데이터 — 없으면 "없음")
## 원격 반영 (반영 전이면 "미반영", 반영 뒤 list_migrations·advisors 결과)
## 스펙 차이·가정 (spec-gaps.md에 기록한 항목)
```
