---
name: data-model-spec
description: "Guide for writing and revising the Resumate data model planning document. Covers domain entities (profiles, experiences, educations, projects with STAR, deliverables, skills, writing chats, application projects with JDs, insights, the 자기소개서 document (`application_documents`), AI jobs, evidence links, provider keys and consents, usage records) and relationships, Supabase Postgres table drafts, RLS policy direction, Storage layout, AI output storage and versioning, deletion policy, and the API boundary draft. Use for ERDs, data models, schema design, table structure, RLS design, and data model revisions. Korean triggers: ERD, 데이터 모델, 스키마 설계, 테이블 구조, RLS 설계, 데이터 모델 수정. Not for applying migrations or running SQL (documents only)."
---

# Data Model Spec

This document is the blueprint that gets turned into migration SQL at implementation time. **At this stage, write documents only and don't touch the DB.**

## Order of work

1. Gather PRD features and field requests from ux-planner and ai-feature-designer.
2. Define entities and relationships, and draw the ERD.
3. Define columns per table.
4. Decide RLS, Storage, and deletion policy.
5. Write the feature ↔ entity matrix and the API boundary draft.
6. Reply to the requesters with the confirmed field names.

## The model already exists

`docs/planning/04-data-model.md` (v4.x) is implemented as Supabase migrations by the backend harness. Read its current tables before adding anything; the entity list there is the starting point, not a seed list. Removed concepts (`achievements`, `project_details`, usage ledger) stay removed unless a decision brings them back.

Because the schema is live:
- Mark every change that already-built code must follow with ★ and list it in the cycle's "백엔드 후속" section (11장 / `decisions.md` section 4), with the migration impact (new column, CHECK change, RPC signature change, backfill).
- Prefer additive changes; when a rename or drop is decided, say what happens to existing rows.
- Write field replies in the cycle's `_workspace/{slug}/dm_replies.md`, then fold them into the document.

## Supabase design rules

- Every user-owned table: `user_id uuid references auth.users` + RLS `user_id = auth.uid()` (state the direction for select/insert/update/delete separately). Child tables use composite FKs `(parent_id, user_id)`.
- Writes that AI pipelines make go through the restricted `app_ai_writer` role; provider key secrets are readable only through `app_key_reader`. State which role writes each AI-owned column.
- Common columns: `id uuid default gen_random_uuid()`, `created_at`, `updated_at`.
- AI outputs: columns if screens query or filter by field; `jsonb` + `schema_version` if rendered as a whole. If regeneration history is needed, append rows instead of overwriting.
- Evidence references the source entity's id. Decide how evidence is displayed when the source is deleted.
- Files: Storage bucket + path convention (`{user_id}/...`) + bucket policy. Parsed results are stored in tables.
- Ordered items (experience ordering, 자기소개서 questions): specify the ordering column.
- Add embeddings (pgvector) only if ai-feature-designer chose RAG.

## Deletion & retention policy

- Individual deletes: for each entity, decide how linked projects, deliverables, writing chats, and evidence references are handled (cascade / set null / soft delete), and what the C-05 delete dialog's impact read (`get_deletion_impact`) returns.
- Account deletion: deletion scope across all data and Storage files, grace period `[결정 필요]`.
- Retention periods are a product decision, so confirm them with product-planner.

## Document template

Write the document in Korean; translate the headings below. Table and column names stay in English.

```markdown
# Resumate Data Model v{N}

## 1. ERD
```mermaid
erDiagram
  profiles ||--o{ experiences : has
  ...
```
## 2. Table definitions
### {table}
- Description / related feature IDs / requested by (ux S-xx, ai AI-xx)
| Column | Type | Constraints | Description |
- RLS: select/insert/update/delete direction
- Index candidates:

## 3. Storage
## 4. Deletion & retention policy
## 5. Feature ↔ entity matrix
| Feature ID | Reads | Writes |
## 6. API boundary draft
| Operation | Mechanism (Server Action / Route Handler / streaming) | Tables read/written | Related screens |
## 7. Decisions needed
## 8. Change log
```

## Quality bar

- Every `entity.field` in ux-planner's screen specs and ai-feature-designer's input context exists in the table definitions.
- Every user-data table has an RLS direction. Missing even one could expose another user's career data.
- Table and column names are snake_case and match the glossary.
