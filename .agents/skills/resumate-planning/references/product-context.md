# Resumate Product Context (shared reference for the planning team)

Every planning agent reads this file before starting work. What is written here is **settled**; everything else is decided during planning.

## One-line definition

An AI career management service that accumulates a user's experience and project data, connects it to job descriptions (JDs) to suggest an application strategy, and prepares the user for real interviews through AI mock interviews.

## Three pillars (settled)

| Pillar | Scope | Key question |
|--------|-------|--------------|
| P1. Career data management | Entering, structuring, and managing experiences, projects, achievements, skills | How far can we reduce input friction? How does AI help structure the data? |
| P2. JD-based insights & chat | Fit, strengths, gaps, and application direction from P1 data + a JD; Q&A via chat | How do we keep every insight anchored to the user's own data? |
| P3. AI mock interview | Questions based on JD and experience, answer evaluation, feedback | Which format (text/voice) and evaluation criteria feel closest to a real interview? |

P1 is the input to P2 and P3. P1 data quality determines the quality of the whole service; keep this in mind in every design decision.

## Tech stack (settled)

| Area | Choice | Planning implications |
|------|--------|----------------------|
| Frontend/server | Next.js (App Router) on Vercel | APIs via Route Handlers / Server Actions. Serverless execution time limits apply — long AI jobs need streaming or async processing |
| DB/Auth/Storage | Supabase (Postgres, Auth, Storage, RLS) | Every user-data table isolates owners with RLS. Files (resume PDFs, etc.) go to Storage. pgvector available if needed |
| LLM | Anthropic API (Claude) | Default `claude-sonnet-5-5`, lightweight tasks `claude-haiku-5-5`, heavy analysis `claude-opus-5-5`. Structured output via tool use / JSON schema |

## Constraints and principles

- **Planning only**: this team produces documents. No code, no applied DB migrations, no deployments.
- **Sensitive data**: careers and resumes are personal information. Reflect consent, retention, and deletion requirements from the Korean Personal Information Protection Act (PIPA) in the requirements.
- **Evidence-based AI**: AI must never invent experience the user does not have. Every AI output must be traceable to a specific part of the user's data or the JD.
- **Primary user language**: Korean. Korean hiring conventions (자기소개서, 경력기술서, 직무/인성 interviews) are the default context.

## Output language

All deliverables (`_workspace/` files and `docs/planning/`) are written in **Korean**, since the user and the product are Korean. Translate template headings into Korean. Keep IDs (`F-P1-01`, `S-03`, `AI-02`, `R-05`), table/column names, and JSON keys in English.

## Tagging rules (all deliverables)

Tags stay in Korean so they read naturally inside Korean documents:

- `[가정]` (assumption) — set provisionally without evidence; not final until the user confirms
- `[결정 필요]` (decision needed) — the user must decide; always list options and a recommendation
- `[보류]` (deferred) — pushed past the MVP

## Shared glossary (seed)

Use these terms consistently across all documents. When a new term appears, product-planner adds it to the PRD glossary and everyone else follows it.

| Term (KO / EN) | Definition |
|----------------|------------|
| 경력 / Experience | A period of employment: company, dates, role |
| 프로젝트 / Project | A unit of work, inside an experience or standalone, with role, contribution, outcomes |
| 성과 / Achievement | A quantitative or qualitative result, linked to a project or experience |
| JD / Job Description | A job posting the user registered |
| 인사이트 / Insight | Result of analyzing a JD × user data (fit, strengths, gaps, application direction) |
| 모의 면접 세션 / Interview Session | One mock interview run (a bundle of questions, answers, feedback) |
