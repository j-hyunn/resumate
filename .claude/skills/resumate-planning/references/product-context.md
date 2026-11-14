# Resumate Product Context (shared reference for the planning team)

Every planning agent reads this file before starting work. What is written here is **settled**; everything else is decided during planning. The planning documents in `docs/planning/` are far past the initial draft — read them (and `decisions.md`) before proposing anything that might already be decided.

## One-line definition

An AI career management service that accumulates a user's experience and project data, connects it to job descriptions (JDs) to produce insights and 자기소개서 answers. AI features run on the user's own API key (BYOK). AI mock interviews were removed from the MVP (2026-11-08, RM-1).

## Two pillars (settled)

| Pillar | Scope | Key question |
|--------|-------|--------------|
| P1. Career data management | Experiences, educations, projects (STAR per project), standalone projects and their deliverables, skills; filled in directly or through the Resumate AI writing chat | How far can we reduce input friction without the AI inventing anything? |
| P2. Application projects (JD insights & 자기소개서) | Per application: JD (pasted, or fetched server-side from a posting URL — CF-10; the JD is used as raw text with no AI processing — jd-raw-text JR-1, 2026-11-14), insight, and **one document: 자기소개서 문항 답변** (up to 5 questions, each with a user-set char limit and an answer title), written through the Resumate AI chat and anchored to P1 data. 경력기술서 was removed (2026-11-08, CF-1). The 지원 현황 board is a 4-stage kanban (before_apply · document · assignment · closed, RM-2) and needs no AI | How do we keep every output traceable to the user's own data or the JD? |

P1 is the input to P2. P1 data quality determines the quality of the whole service; keep this in mind in every design decision.

Menu (L-01, fixed): 커리어 / 자기소개서 관리 / 지원 현황 (모의 면접 removed, RM-1). Sign-in lands on 커리어. 자기소개서 관리 flow (CF-7·CF-8): list → 2-step add modal → one writing page (S-46: question setup, then writing; tabs 자소서 / 채용 공고 / 인사이트). Stage changes happen only on the board (CF-3).

## Tech stack (settled)

| Area | Choice | Planning implications |
|------|--------|----------------------|
| Frontend/server | Next.js (App Router) on Vercel (functions pinned to Seoul) | APIs via Route Handlers / Server Actions. Serverless execution time limits apply — long AI jobs use streaming or async jobs (`ai_jobs`, AI spec C-6) |
| DB/Auth/Storage | Supabase (Postgres, Auth, Storage, RLS) | Every user-data table isolates owners with RLS. pgvector only if a feature truly needs retrieval |
| LLM | **BYOK** — the user connects a key for OpenAI, Google Gemini, or Anthropic Claude; one **active provider** runs every AI feature (D-28) | Features are designed provider-neutral: a tier (`light` / `default` / `heavy`) per feature, Resumate's fixed tier → model mapping per provider (AI spec C-10.1, no automatic fallback), one canonical JSON schema converted per provider, the same server-side evidence validation for all. Failures are classified into 7 provider causes (C-11). There is no service usage limit or cost ceiling — the user pays the provider; the product shows a token/cost usage meter instead. Gemini's free tier is the recommended entry path, with its data-use terms disclosed and consented per provider and tier |

The planning team doesn't pick model IDs or prices on its own: the mapping and price table are versioned in the AI spec and confirmed against provider docs at implementation time.

## Implementation exists

The UI (`resumate-ui`) and backend (`resumate-backend`) harnesses have implemented most of the MVP against these documents. That changes how planning works:

- A planning change has a cost downstream. Each cycle ends with a "백엔드·UI 후속" list in `decisions.md` section 4 so the other harnesses know what to change.
- Implementation feeds back: backend spec gaps (`_workspace/backend/spec-gaps.md`), UI "기획 확인 필요" (`docs/ui/screen-status.md`, `_workspace/ui/*`), and Figma designs from the user are the usual inputs to a planning cycle. Treat what the code already does as evidence, not as a decision — only the user settles a decision.

## Constraints and principles

- **Planning only**: this team produces documents. No code, no applied DB migrations, no deployments.
- **Sensitive data**: careers and resumes are personal information. Reflect consent, retention, and deletion requirements from the Korean Personal Information Protection Act (PIPA), and the cross-border transfer implied by sending data to the user's provider (D-39), in the requirements.
- **Evidence-based AI**: AI must never invent experience the user does not have. Every AI output must be traceable to a specific part of the user's data or the JD; unsupported content stays a placeholder.
- **Primary user language**: Korean. Korean hiring conventions (자기소개서 문항 and their char limits, 서류·과제 전형 stages) are the default context.

## Output language

All deliverables (`_workspace/` files and `docs/planning/`) are written in **Korean**, since the user and the product are Korean. Translate template headings into Korean. Keep IDs (`F-P1-01`, `S-03`, `AI-02`, `R-05`, decision IDs such as `CR-3`, `PA-1`), table/column names, and JSON keys in English.

## Tagging rules (all deliverables)

Tags stay in Korean so they read naturally inside Korean documents:

- `[가정]` (assumption) — set provisionally without evidence; not final until the user confirms
- `[결정 필요]` (decision needed) — the user must decide; always list options and a recommendation
- `[보류]` (deferred) — pushed past the MVP
- Settled decisions are cited with their source: `확정 YYYY-MM-DD (사용자)` or `확정 (YYYY-MM-DD, 팀)`, plus the decision ID

## Glossary

The PRD glossary (`docs/planning/01-prd.md` section 8) is the single source of terms; product-planner owns it. The terms most often confused:

| Term (KO / EN) | Definition |
|----------------|------------|
| 프로젝트 / Project | A unit of work. Alone, "프로젝트" always means this — never an application |
| 경력·교육 안 프로젝트 | A project under an experience or education: name, period, 3 classifications, and one STAR (상황 / 역할 / 행동 / 결과·성과 / 배운 점) |
| 독립 프로젝트 / Standalone Project | A project with no experience/education: project info, project content, and deliverables; no STAR |
| 산출물 / Deliverable | Title + markdown body written by the user under a standalone project (`project_deliverables`); used as AI evidence. Not a file upload |
| 지원 프로젝트 / Application Project | One application: one JD plus its insight, its one document, and a board stage. On screen the application **and** its document are both "자기소개서" (CF-U3, 확정 2026-11-08 (사용자) — replaces OD-D7·U36-6's "자소서 문항 답변"); the writing-page tab is "자소서"; the menu is "자기소개서 관리". Data names stay `application_projects` / `application_documents` (`document_kind = 'cover_letter'`) |
| Resumate AI 패널 · AI 작성 대화 | The chat beside project detail (S-10), deliverable detail (S-44), and the 자기소개서 writing page (S-46); the AI only organizes what the user said (or proposes drafts from P1 data), and [반영] fills the form until "저장하기". The career context is one swappable assembly point with per-item source aliases — RAG is planned and will replace it (CL-Q1) |
| 활성 공급자 / Active Provider | The one provider whose key runs all AI features |
| 폐기된 용어 | 성과·정량 성과 (achievements), 상세 내용 (project_details), 사용량 한도, 기업 JD 관리, **경력기술서** (CF-1), **모의 면접·면접 단계** (RM-1·RM-2), 지원 프로젝트 허브 (S-31)·서류 초안 목록 (S-17)·초안 편집기 (S-19), 괄호 병기형 "자기소개서(문항 답변)" — don't reintroduce them |
