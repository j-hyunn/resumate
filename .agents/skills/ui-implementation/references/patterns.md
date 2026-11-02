# Resumate UI Implementation Patterns

Read the section(s) your screens need. These patterns encode decisions from the planning documents; follow them so the same mechanic behaves the same way on every screen.

## Contents
1. AI response modes (sync / async job / streaming)
2. Fake AI (mock module)
3. AI failure, limit, and insufficient-data states
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
| Streaming | AI-03 career description, AI-04 cover letter, AI-12 writing chat | C-04: render blocks as `block_started` / `block_delta` / `block_completed` / `validated` / `done` / `error` events arrive; show a stop button (sets `cancel_requested_at`) |

Stage labels come from the C-03 table in the screen spec — map `stage` keys to that copy in one shared constant, not per screen.

Keep the client hook shape stable so the real backend can replace the mock: `useAiJob(jobId) → { status, progress, partial, error }` and `useAiStream(request) → { blocks, status, error, cancel }`.

## 2. Fake AI

`src/lib/mock/ai.ts` simulates each mode with realistic timing so states are visible during development:

- Async job: advance through the feature's stages over ~6–12s, emit partial results for stages that have them.
- Streaming: emit blocks with deltas at ~30–60 chars per tick; first token within ~1s.
- Failure injection: a parameter (and the `?state=ai-failed` switch) makes the job/stream fail with a given `error_category` (`transient`, `input`, `timeout`, `canceled`).
- Outputs reference real fixture IDs so evidence chips resolve.

## 3. AI failure, limit, insufficient data

- **ST-AI-FAILED:** copy chosen by `ai_jobs.error_category` (spec 3.0 common states). Always say usage was not charged, and offer retry. `canceled` is not shown as a failure. Async jobs keep completed stages and retry from the failed stage.
- **ST-LIMIT:** the trigger button is replaced/disabled with the limit message. For the AI writing chat, only *new* chats are blocked; continuing, saving, and switching to the form still work.
- **ST-INSUFFICIENT:** render C-09 instead of running AI. No usage is charged.
- **Usage hint** next to every charging button: "이번 달 {N}회 남음 · 이 작업으로 {k}회 사용". Units per feature are in the spec's "실행 버튼 사용량 안내".

## 4. Autosave and draft status

- Debounced autosave (~800ms after the last change, plus on blur and before navigation) through a server action; C-06 shows 저장 중… / 저장됨 HH:MM / 저장 실패 — 다시 시도.
- Missing required fields → save anyway with `status = 'draft'` and show the draft note. Don't block saving on validation; validation decides draft vs complete.
- Warn before leaving only when a save failed or is in flight.

## 5. Evidence chips and panel

- C-01 chip label = kind + `source_label` per the spec's label table; `project_detail` chips show "상세 내용 · {필드}" using the STAR field names (상황 / 과제 / 행동 / 결과 / 회고 및 배운 점).
- Status: 정상 / 변경됨 (source `updated_at` > `source_snapshot_at`) / 원본 삭제됨 (`source_deleted_at`). Compute status in the data layer, not in the chip.
- Click → C-02 side sheet with quote, path breadcrumb, "원본으로 이동" (deep link with focus target), and the fixed disclaimer.
- C-15 source-utterance chips (S-36) share the chip's look but link to chat messages and carry review states (출처 있음 / 직접 수정 / 검토 필요 with 수락·거절 / 아직 없음).

## 6. Data-insufficient gate and return banner

- Readiness comes from `getDataReadiness()` (mirrors RPC `get_data_readiness()`); decide gate vs action only from `features.{feature}.ready / missing / next_action`.
- C-09 primary button follows `next_action` (`writing_chat` → S-36 with `suggested_mode`, `form` → S-09). When the monthly chat limit is used up, switch to "직접 입력하기" as the spec describes.
- Store the return target (feature + application project + in-progress settings) when leaving; C-10 banner on every career screen re-checks readiness after each save and returns to the original screen with settings restored.

## 7. Kanban board (S-39)

- dnd-kit with pointer **and** keyboard sensors; every move also available via the card menu (C-12) and "다음 단계로".
- Optimistic move; on failure revert the card and show ST-MOVE-FAILED.
- Moving into 직무 인터뷰 / 컬처핏 opens C-14 (resume-first if a session is in progress); moving into 전형 종료 opens C-13; moving out of 전형 종료 clears the outcome (history keeps it).
- Within a column, order by most recent move (T-5).
- Narrow screens: column tabs + card menu instead of side-by-side columns (T-8).
- Announce moves to screen readers: "{카드}를 {단계}로 옮겼어요".

## 8. Dialogs and destructive actions

- Deletes go through C-05 with the impact counts from `get_deletion_impact` (mock it) and the spec's options and default selections; never delete without it.
- Dialogs trap focus, restore focus to the trigger on close, and close on Esc unless an action is running.

## 9. `?state=` preview switch

- A helper reads `searchParams.state` (development only) and returns an override the page passes down; production ignores it.
- Each screen documents which values it supports in the area report. Prefer the shared names: `empty`, `loading`, `error`, `not-found`, `ai-pending`, `ai-stream`, `ai-failed`, `limit`, `insufficient`, `save-failed`, plus screen-specific ones (e.g. `wait-jd`, `move-failed`).
