# Resumate UI Implementation Patterns

Read the section(s) your screens need. These patterns encode decisions from the planning documents; follow them so the same mechanic behaves the same way on every screen.

## Contents
1. AI response modes (sync / async job / streaming)
2. Fake AI (mock module)
3. AI lock, failure, and insufficient-data states
4. Autosave and draft status
5. Evidence chips and panel
6. Data-insufficient gate and return banner
7. Kanban board
8. Dialogs and destructive actions
9. `?state=` preview switch

---

## 1. AI response modes

Source: `03-ai-features.md` C-6. Every AI-backed screen uses exactly one of these per action; the screen spec states which.

| Mode | Used by | UI pattern |
|------|---------|------------|
| Sync | AI-01 JD extraction, AI-11 source ranking, AI-08 | Button → spinner on the button (ST-AI-SYNC) → result replaces content. Disable the trigger while running |
| Async job | AI-02 insight, AI-05 interview questions, AI-06/07 evaluation | Start → receive `job_id` → C-03 progress (stage label from `ai_jobs.progress.stage`, `done/total`) → partial results as they arrive → complete. The user may leave; completion shows the in-app toast and a menu badge. Poll every 2s in the mock (Realtime later) |
| Streaming (documents) | AI-03 career description, AI-04 cover letter | C-04, event order from the spec's C-04: `sources_selected` → `block_started` / `block_delta` / `block_completed` → (only when needed) `adjusting_length` → `validated` → `done` (or `error`). Streamed blocks are provisional; on `validated` replace the whole section (career description: the whole draft) and only then attach evidence chips, badges, and the post-generation notes. Show a stop button (sets `cancel_requested_at`) |
| Streaming (chat turn) | AI-12 project STAR chat (S-10 panel), AI-13 deliverable chat (S-44 panel) | Turn events, not blocks: `turn_started` → `reply_delta`* → `reply_done` → `draft_patch` → `draft_flags` → `turn_done` (or `error`); AI-13 draft turns add the body-draft card per the AI spec. The thread is rendered with the shadcn Chat components. [반영] fills the page form only; "저장하기" persists it. No message limit per month; only the 40-message cap per chat (greeting excluded) |

Stage labels come from the C-03 table in the screen spec — map `stage` keys to that copy in one shared constant, not per screen.

The client side of jobs and SSE lives in `src/lib/data/ai-jobs.ts` / `ai-stream-client.ts`, typed by `src/lib/contracts/ai.ts` (backend-owned). Keep the hook shapes stable — `useAiJob(jobId) → { status, progress, partial, error }`, `useAiStream(request) → { blocks, status, error, cancel }` — since both the real endpoints and the preview mock feed them. When the contract's event list changes, update the mock in the same change.

## 2. Fake AI

`src/lib/mock/ai.ts` (and `ai-stream.ts`, `writing-chat-turn*.ts`) simulates each mode with realistic timing for `?state=` previews, the state gallery, and tests — it never serves real users:

- Async job: advance through the feature's stages over ~6–12s, emit partial results for stages that have them.
- Streaming: emit blocks with deltas at ~30–60 chars per tick; first token within ~1s.
- Failure injection: a parameter (and the `?state=ai-failed` switch) makes the job/stream fail with a given `error_category` (`transient`, `input`, `timeout`, `canceled`).
- Outputs reference real fixture IDs so evidence chips resolve.

## 3. AI lock, failure, insufficient data

- **BYOK (no service usage limits):** there is no ST-LIMIT, no "N회 남음", no charging copy. AI runs on the user's own provider key.
- **C-18 AI lock:** from `getDataReadiness().ai_connection` — no active provider → lock; `key_status = 'invalid'` → C-20 `key_invalid`; `needs_check` → allowed with a C-19 caution badge. `consent_required = true` → don't lock, but open C-21 for the active provider and tier before any AI run starts.
- **C-20 failures:** copy by `failure_cause` (7 provider causes) or `error_category` + `error_code`. Every retry and re-run uses the provider active *at click time* (badge shows the active provider). Input-caused failures (`input_too_long`, `safety_blocked`, `not_a_jd`, `insufficient_data`) have no "다시 시도" — the user fixes the input and runs again. Retry refusals (409 `key_missing`, `ai_consent_required`, `key_invalid`, `ai_connection_changed`, `ai_job_not_retryable`) are request responses, not job errors. `canceled` is not shown as a failure.
- **ST-INSUFFICIENT:** render C-09 instead of running AI.

## 4. Saving and draft status

The screen spec decides which model a screen uses; don't carry one screen's model to another.

- **Page save (S-10, S-44, L-02):** the page opens empty for "new"; the row is created on the first "저장하기" or the first AI message (name required first — focus the name field instead of sending). "저장하기" sends the whole page with the expected version (`stale_write` → conflict UI) and the applied-proposal records; AI [반영] only fills the form. Leaving with unsaved changes asks first; input is preserved across the leave confirmation.
- **Section / modal save (S-08 detail panels, C-24, career add/edit modal):** explicit save per section or modal; no autosave indicator.
- **Autosave (other forms, cover-letter questions, interview answer sheets):** debounced (~800ms after the last change, plus on blur and before navigation) through the data layer; C-06 shows 저장 중… / 저장됨 HH:MM / 저장 실패 — 다시 시도. Warn before leaving only when a save failed or is in flight.
- Missing required fields → save anyway with `status = 'draft'` and show the draft note. Don't block saving on validation; validation decides draft vs complete.

## 5. Evidence chips and panel

- C-01 chip label = kind + `source_label` per the spec's label table; STAR chips show "프로젝트 · {필드}" (상황 / 역할 / 행동 / 결과·성과 / 배운 점), deliverable chips "산출물 › {제목}". There is no `project_detail` source any more (STAR lives on `projects`).
- Status: 정상 / 변경됨 (source `updated_at` > `source_snapshot_at`) / 원본 삭제됨 (`source_deleted_at`). Compute status in the data layer, not in the chip.
- Click → C-02 side sheet with quote, path breadcrumb, "원본으로 이동" (deep link with focus target), and the fixed disclaimer.
- C-15 source-utterance chips (Resumate AI panel on S-10 / S-44) share the chip's look but link to chat messages and carry review states (출처 있음 / 직접 수정 / 검토 필요 with 수락·거절 / 아직 없음).

## 6. Data-insufficient gate and return banner

- Readiness comes from `getDataReadiness()` (mirrors RPC `get_data_readiness()`); decide gate vs action only from `features.{feature}.ready / missing / next_action`.
- C-09 primary button follows `next_action` and `hints` exactly as the C-09 table in the screen spec says (targets are S-10 with the panel / an empty STAR field focused, C-23 → new S-10 page, S-43, or S-09 new experience). Don't hard-code a target table here — it changed in every planning cycle; read C-09.
- Store the return target (feature + application project + in-progress settings) when leaving; C-10 banner on every career screen re-checks readiness after each save and returns to the original screen with settings restored.

## 7. Kanban board (S-39)

- dnd-kit with pointer **and** keyboard sensors; every move also available via the card menu (C-12) and "다음 단계로".
- Optimistic move; on failure revert the card and show ST-MOVE-FAILED.
- Moving into 직무 인터뷰 / 컬처핏 opens C-14 (resume-first if a session is in progress); moving into 전형 종료 opens C-13; moving out of 전형 종료 clears the outcome (history keeps it).
- Within a column, order by most recent move (T-5).
- Narrow screens: column tabs + card menu instead of side-by-side columns (T-8).
- Announce moves to screen readers: "{카드}를 {단계}로 옮겼어요".

## 8. Dialogs and destructive actions

- Deletes go through C-05 with the impact counts from `get_deletion_impact` (through the data layer; show an error in the dialog if the impact read fails) and the spec's options and default selections; never delete without it.
- Dialogs trap focus, restore focus to the trigger on close, and close on Esc unless an action is running.

## 9. `?state=` preview switch

- A helper reads `searchParams.state` (development only) and returns an override the page passes down; production ignores it.
- Each screen documents which values it supports in the area report. Prefer the shared names: `empty`, `loading`, `error`, `not-found`, `ai-pending`, `ai-stream`, `ai-failed`, `insufficient`, `save-failed`, plus screen-specific ones (e.g. `wait-jd`, `move-failed`).
