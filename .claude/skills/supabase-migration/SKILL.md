---
name: supabase-migration
description: "Guide for implementing the Resumate data model as Supabase migrations: tables, text+CHECK enums, composite FKs (parent_id, user_id), updated_at triggers, RLS policies, the app_ai_writer role and column grants, RPC functions (security invoker/definer), evidence deletion triggers, pgTAP tests, seed data, and TypeScript type generation. Use whenever writing or fixing migration SQL, RLS policies, RPCs, DB triggers, pgTAP tests, or applying migrations locally or to a Supabase development branch. Korean triggers: 마이그레이션 작성, 테이블 생성, RLS 정책 구현, RPC 함수 구현, DB 트리거, pgTAP 테스트, 타입 생성, 스키마 반영, 개발 브랜치에 적용. Not for planning-stage schema design documents (use data-model-spec)."
---

# Supabase Migration

The data model document (`docs/planning/04-data-model.md`) is the spec; this skill is how to turn it into SQL that Postgres enforces.

## Order of work (per slice)

1. Read the slice plan and the DM sections it points to. List every table, column, CHECK list, FK, index, policy, grant, and RPC the slice needs.
2. Write migrations — one concern per file, in dependency order (tables → triggers → RLS → grants → RPCs).
3. `supabase db reset` (applies all migrations + `seed.sql` locally).
4. Write pgTAP tests, `supabase test db`.
5. `supabase gen types typescript --local > src/server/db/database.types.ts`.
6. Write `02_db-engineer_notes.md` and notify teammates.
7. Only if the slice plan says so: apply to the Supabase development branch (see "Remote branch").

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

## RPC functions

- Signatures and return shapes come from DM §6–7. Return `jsonb` when the spec shows a JSON object; keep key names identical.
- `security invoker` unless the spec says definer. For `security definer`: `set search_path = ''`, fully qualify every name, and check ownership first (`if not exists (select 1 from public.application_projects where id = p_id and user_id = auth.uid()) then raise exception ...`).
- `revoke execute on function ... from public, anon;` then `grant execute ... to authenticated` (and/or `app_ai_writer`).
- Raise errors with a stable code the app can map: `raise exception using errcode = 'P0001', message = 'message_limit_reached';`

## pgTAP tests (minimum per slice)

- Every new user-data table: RLS enabled (`policies_are` or `row_security_enabled`), user B can't select/update/delete user A's rows.
- `app_ai_writer` can't insert/update career tables; can write what DM §5 allows.
- Each RPC: happy path + each `raise` branch.
- Cascades and deletion triggers: deleting a source sets `evidence_links.quote = null` and `source_deleted_at` (C-3).
- Simulate users with `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';`.

## Remote branch

Allowed only for a Supabase **development branch** (backend-context.md safety policy).
1. `list_branches` and confirm the target `project_ref` belongs to a branch, not the main project. Say which one in your notes.
2. Creating a branch costs money — only after the user confirms the cost in chat.
3. Apply the same migration files in order with `apply_migration` (name = file name without timestamp). Don't paste ad-hoc SQL that isn't in `supabase/migrations/`.
4. Run `get_advisors` (security + performance) on the branch and put findings in the notes.

## Notes template (`02_db-engineer_notes.md`, Korean)

```markdown
# {slice} DB 구현 노트
## 마이그레이션 파일
## 테이블·컬럼 (스펙 대비 차이 포함)
## RPC 시그니처와 반환 형태
## RLS·권한 요약 (DM §5 대비)
## 테스트 (`supabase test db` 결과)
## 원격 브랜치 적용 여부 (project_ref, advisors 결과)
## 스펙 차이·가정 (spec-gaps.md에 기록한 항목)
```
