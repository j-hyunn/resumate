# Backend Slice Catalog

The backend is built in vertical slices: each slice ships its migrations, RPCs, server code, AI pipeline (if any), and tests together, and passes QA before the next slice starts. Order matters — later slices depend on earlier tables and infrastructure.

Section pointers are into `docs/planning/`; `DM §n` = `04-data-model.md`, `AI §x` = `03-ai-features.md`. Re-check the headings when the docs change version.

| Slice | Contents | Depends on | Spec pointers | Owners |
|-------|----------|-----------|---------------|--------|
| **S0 bootstrap** | Next.js app (App Router, TS strict) — or, if the UI harness already scaffolded it, only the backend additions; pnpm, `supabase init`, Vitest, zod env loader (`src/server/env.ts`), `.env.example`, directory layout from backend-context.md, `pnpm typecheck / lint / test` scripts | — | backend-context.md | api (lead), db (`supabase init`, local config) |
| **S1 foundation** | `profiles`, `consents` / `policy_versions`, common `updated_at` trigger, `app_ai_writer` role + grants skeleton, auth callback (magic link + Google), session middleware, Supabase clients (`server.ts`, `ai-writer.ts`) | S0 | DM §0, §2.1, A.1–A.2, §5; PRD auth (D-09) | db, api |
| **S2 career data** | `experiences`, `educations`, `projects`, `project_details`, `achievements`, `skills` / `project_skills`; status recompute (draft/complete); auto-save Server Actions; year view query; `get_data_readiness()`; `get_deletion_impact` / `delete_career_item` | S1 | DM §2.2–2.4, §4.1–4.2, §6, §7 | db, api |
| **S3 AI infrastructure** | `ai_jobs`, `usage_events` / `usage_limits` (reserve → charge / release), `evidence_links` + source-deletion trigger; Anthropic client; Career Context Pack + JD context builders; V-1 … V-8 validators; SSE helpers; job runner with `after()` + heartbeat + stalled detection | S2 | DM §2.8–2.9, A.14–A.16; AI C-1 … C-8 | ai (lead), db, api |
| **S4 AI writing chat** | `writing_chats`, `writing_chat_messages`; RPCs `append_writing_chat_message`, `apply_structured_draft_patch`, `set_writing_chat_affiliation`, `save_writing_chat`, `hand_off_writing_chat`; turn Route Handler (SSE); AI-12 extract + reply | S3 | DM §2.5, §3.3–3.4; AI AI-12; DM §7 rows for 대화 | all |
| **S5 application projects & JD** | `application_projects`, `application_stage_events`, `job_descriptions`, `jd_requirements`; `move_application_stage`, `set_application_outcome`; AI-01 JD requirement extraction (sync) | S3 | DM §2.6, A.5–A.7; AI AI-01 | db, api, ai |
| **S6 insights** | `insights`; AI-02 (async job: match → synthesize → validate) | S5 | DM §2.7, A.8; AI AI-02 | ai, api, db |
| **S7 documents** | `drafts`, `draft_sections`, `draft_section_sources`; AI-11 ranking (sync), AI-03 career description (stream), AI-04 cover letter per question (stream) | S5 | DM A.9–A.11; AI §3 | ai, api, db |
| **S8 mock interview** | `interview_sessions`, `interview_questions`, `interview_answers`, `answer_evaluations`, `session_feedbacks`; AI-05 (async), AI-06 + AI-07 (async on submit); score placeholder until D-14 | S5 | DM A.12–A.13; AI §4 | ai, api, db |
| **S9 account & retention** | `get_account_deletion_summary`, account deletion (D-11 immediate), 90-day cleanup for unlinked writing chats (Vercel Cron), `ai_jobs` 90-day retention | S4 | DM §4.3–4.4, §7 (정기 배치) | db, api |

## Wiring

Each slice from S1 on ends with a wiring step **if the UI harness has already built screens for that area** (check `docs/ui/screen-status.md`): replace the matching `src/lib/data/` function bodies with real calls (nextjs-server-api "Wiring the UI's mock data layer"). If the screens don't exist yet, skip it and record "연결 대기" in `slices.md`. When the screens appear later, "백엔드 연결해줘" runs just the wiring step for every slice marked that way.

| Slice | UI area wired |
|-------|---------------|
| S1 | A1 account (sign-in, consent) |
| S2, S4 | A2 career |
| S5, S6, S7 | A3 applications, A4 board |
| S8 | A4 interview |
| S9 | A1 account (settings, deletion) |

Should-priority items (career chat AI-09, STAR polish AI-08, retake, stage history) are added as extra slices only when the user asks.

## Slice status

The leader keeps `_workspace/backend/slices.md` up to date: one row per slice with status (`todo` / `in_progress` / `qa` / `done`), date, and open QA issues. Phase 0 of the orchestrator reads it to decide what comes next.
