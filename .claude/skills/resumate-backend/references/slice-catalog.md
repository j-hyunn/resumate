# Backend Slice Catalog

The backend is built in vertical slices: each slice ships its migrations, RPCs, server code, AI pipeline (if any), and tests together, and passes QA before the next slice starts. Order matters — later slices depend on earlier tables and infrastructure.

Section pointers are into `docs/planning/`; `DM §n` = `04-data-model.md`, `AI §x` = `03-ai-features.md`. Re-check the headings when the docs change version.

| Slice | Contents | Depends on | Spec pointers | Owners |
|-------|----------|-----------|---------------|--------|
| **S0 bootstrap** | Next.js app (App Router, TS strict) — or, if the UI harness already scaffolded it, only the backend additions; pnpm, `supabase init`, Vitest, zod env loader (`src/server/env.ts`), `.env.example`, directory layout from backend-context.md, `pnpm typecheck / lint / test` scripts. No service-wide LLM key (BYOK) | — | backend-context.md | api (lead), db (`supabase init`, local config) |
| **S1 foundation** | `profiles`, `consents` / `policy_versions`, common `updated_at` trigger, `app_ai_writer` and `app_key_reader` roles + grants skeleton, auth callback (magic link + Google), session refresh in `proxy.ts`, Supabase clients (`server.ts`, `ai-writer.ts`) | S0 | DM §0, §2.1, A.1–A.2, §5; PRD auth (D-09) | db, api |
| **S2 career data** | `experiences`, `educations`, `projects`, `project_details`, `achievements`, `skills` / `project_skills`; status recompute (draft/complete); auto-save Server Actions; year view query; `get_data_readiness()`; `get_deletion_impact` / `delete_career_item` | S1 | DM §2.2–2.4, §4.1–4.2, §6, §7 | db, api |
| **S3a AI execution (BYOK)** | `ai_jobs` v4 (provider / tier fixed at start, cause-based `error_code` → `error_category` / `failure_cause`, `retry_count`, `next_run_at`, `retry_wait_total_ms`, `quota_resets_at`, `retry_after`, one in-flight job per target), `ai_usage_records` + `ai_price_tables` + `get_ai_usage_summary`, `evidence_links` + source-deletion trigger; provider adapters (OpenAI / Gemini / Claude: tier → model, structured output, stream / usage / error normalization); Career Context Pack + JD context builders; V-1 … V-8 validators; SSE helpers; job runner with `after()` + heartbeat + stalled detection + C-11.3 retries scheduled via `next_run_at` + free-tier sequential mode; usage records per provider call. No reservation, charging, or quota (D-34) | S2 | DM §2.8–2.9, A.14–A.16; AI C-1 … C-13 | ai (lead), db, api |
| **S3b BYOK keys & consent** | `ai_provider_keys` (envelope encryption, no grant on ciphertext columns) + `ai_provider_keys_public`, `profiles.active_ai_provider`, `ai_data_use_consents`, `ai_disclosures` / `ai_providers`; `app_key_reader` + `get_provider_key_secret`; RPCs `save_provider_key`, `record_provider_key_check`, `mark_provider_key_invalid`, `delete_provider_key`, `set_active_ai_provider`; KMS adapter (pre-launch env master key allowed); `key_verification` jobs (C-10.5); AI settings actions; `get_data_readiness` adds `ai_connection` | S3a | DM §2.11, §5, §6 (v4); AI C-10.5, C-11; PRD F-AI-01 … 09, NFR-KEY-01 … 09 | db, api (lead), ai (verification calls) |
| **S4 AI writing chat** | `writing_chats` (`message_count <= 40`, no usage event), `writing_chat_messages` (assistant rows carry provider meta); RPCs `append_writing_chat_message`, `apply_structured_draft_patch`, `set_writing_chat_affiliation`, `save_writing_chat`, `hand_off_writing_chat`; turn Route Handler (SSE; free tier: reply then extract, sequential); AI-12 extract + reply; `source_writing_chat_id` composite FKs | S3b | DM §2.5, §3.3–3.4; AI AI-12; DM §7 rows for 대화 | all |
| **S5 application projects & JD** | `application_projects`, `application_stage_events`, `job_descriptions` (`extraction_provider` / `extraction_model`, `pending` / `default` names without a key), `jd_requirements`; `move_application_stage`, `set_application_outcome`; AI-01 JD requirement extraction (sync; right after creation with a key, otherwise on the first AI feature run, D-30); `application_project_id` FKs on `ai_jobs` / `evidence_links` / `ai_usage_records` | S3b | DM §2.6, A.5–A.7; AI AI-01 | db, api, ai |
| **S6 insights** | `insights` (+ provider meta); AI-02 (async job: match → synthesize → validate; free tier sequential batches) | S5 | DM §2.7, A.8; AI AI-02 | ai, api, db |
| **S7 documents** | `drafts`, `draft_sections` (+ provider meta), `draft_section_sources`; AI-11 ranking (sync), AI-03 career description (stream), AI-04 cover letter per question (stream) | S5 | DM A.9–A.11; AI §3 | ai, api, db |
| **S8 mock interview** | `interview_sessions` (+ `question_provider` / `question_model` / `evaluation_provider` / `evaluation_model`), `interview_questions`, `interview_answers`, `answer_evaluations`, `session_feedbacks`; AI-05 (async), AI-06 + AI-07 (async on submit; free tier one answer per step); score placeholder until D-14 | S5 | DM A.12–A.13, §2.7; AI §4 | ai, api, db |
| **S9 account & retention** | `get_account_deletion_summary` (incl. keys, consents, usage records), account deletion (D-11 immediate, keys destroyed at once), 90-day cleanup for unlinked writing chats, `ai_jobs` 90-day and `ai_usage_records` 13-month retention (Vercel Cron) | S4 | DM §4.3–4.4, §7 (정기 배치), NFR-KEY-06 | db, api |

## Wiring

Each slice from S1 on ends with a wiring step **if the UI harness has already built screens for that area** (check `docs/ui/screen-status.md`): replace the matching `src/lib/data/` function bodies with real calls (nextjs-server-api "Wiring the UI's mock data layer"). If the screens don't exist yet, skip it and record "연결 대기" in `slices.md`. When the screens appear later, "백엔드 연결해줘" runs just the wiring step for every slice marked that way.

| Slice | UI area wired |
|-------|---------------|
| S1 | A1 account (sign-in, consent) |
| S3a, S3b | AI connection settings (key registration, active provider, consent), usage meter, AI lock states and F-AI-08 failure notices on every AI entry point |
| S2, S4 | A2 career |
| S5, S6, S7 | A3 applications, A4 board |
| S8 | A4 interview |
| S9 | A1 account (settings, deletion) |

Should-priority items (career chat AI-09, STAR polish AI-08, retake, stage history) are added as extra slices only when the user asks.

## Slice status

The leader keeps `_workspace/backend/slices.md` up to date: one row per slice with status (`todo` / `in_progress` / `qa` / `done`), date, and open QA issues. Phase 0 of the orchestrator reads it to decide what comes next.
