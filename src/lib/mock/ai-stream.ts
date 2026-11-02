/**
 * Fake AI — streaming mode (03 C-6), client-safe (no store access).
 *
 * Emits the same event names the real SSE Route Handlers will send:
 * - block streams (AI-03 career description, AI-04 cover letter), v5.3 C-04 order:
 *   `sources_selected`? → (`block_started` → `block_delta`* → `block_completed`)* →
 *   `adjusting_length`? → `validated` (per section: the whole confirmed block set + notes) → `done` | `error`.
 *   Streamed blocks are provisional; `validated` replaces the section (career description: the draft).
 * - writing chat turn (AI-12): `reply_delta`* → `reply_done` → `draft_patch` → `draft_flags` → `turn_done` | `error`
 *
 * Timing: first token within ~1s, ~30–60 chars per tick.
 */
import type { AiErrorCode, AiProviderName, DraftBlockFlag, DraftSourceOrigin, DraftSourceRole } from "@/types/db"
import { failureTimestamps } from "@/lib/data/ai-errors"

/** AI-04 `sources_selected` card (선택 카드 먼저 표시). role/origin/requirement_ids for C-11 badges (A3 UQ-83). */
export interface StreamSource {
  label: string
  rationale: string
  role?: DraftSourceRole
  origin?: DraftSourceOrigin
  requirement_ids?: string[]
}

/**
 * v4 (UQ-239 / A2 request 9): a failed stream carries what C-20 needs — the cause, the provider it
 * ran on and the retry / reset times (same shape as the ai_jobs columns).
 */
export interface StreamErrorEvent {
  type: "error"
  error_code: AiErrorCode
  provider: AiProviderName | null
  retry_after: string | null
  quota_resets_at: string | null
}


/**
 * A14 request-path failure: rate_limited / provider_unavailable fail at once (no auto wait) with a
 * short `retry_after` the "다시 보내기" / "다시 시도" button counts down to.
 */
function errorEvent(code: AiErrorCode, provider: AiProviderName | null | undefined, retryAfterSec = 20): StreamErrorEvent {
  const ts = failureTimestamps(code)
  return {
    type: "error",
    error_code: code,
    provider: provider ?? null,
    quota_resets_at: ts.quota_resets_at,
    retry_after: ts.retry_after ? new Date(Date.now() + retryAfterSec * 1000).toISOString() : null,
  }
}

/**
 * A project AI-03 left out (`validated.result.omitted[]`): the screen names it from the C-11 source tree and words
 * the reason (QA-W5-01). `reason` is `user_excluded` | `low_relevance` (03 AI-03); anything else gets a plain line.
 */
export interface OmittedProject {
  project_id: string
  reason: string
}

/** S-19 생성 직후 안내 (A21: not stored — only sent with `validated`) */
export interface GenerationNotesPayload {
  /** career description: items left out — a real run's projects, or the mock's ready line ("항목 — 이유") */
  omitted?: Array<OmittedProject | string>
  notes_for_user?: string[]
  /** cover letter: the answer is outside 90–110 % of the limit after adjustment */
  char_adjust_needed?: boolean
}

/** One confirmed block in a `validated` event (block ids are final here) */
export interface ValidatedBlock {
  block_id: string
  text: string
  flags: DraftBlockFlag[]
  evidence_count: number
}


export type BlockStreamEvent =
  | { type: "sources_selected"; sources: StreamSource[] }
  | { type: "block_started"; block_id: string }
  | { type: "block_delta"; block_id: string; delta: string }
  | { type: "block_completed"; block_id: string }
  | {
      type: "validated"
      /** cover letter: the 문항 (draft_sections.id); omitted = the whole career description */
      section_id?: string
      blocks: ValidatedBlock[]
      notes?: GenerationNotesPayload
    }
  | { type: "adjusting_length"; section_id?: string; current_chars: number; char_limit: number }
  | { type: "done" }
  | StreamErrorEvent

export type ChatTurnEvent =
  | { type: "reply_delta"; delta: string }
  | { type: "reply_done" }
  | { type: "draft_patch"; paths: string[] }
  | { type: "draft_flags"; needs_review: string[]; actor_ambiguous: string[]; sensitive: number }
  | { type: "turn_done" }
  | StreamErrorEvent

export interface MockBlockSpec {
  block_id: string
  text: string
  flags?: DraftBlockFlag[]
  evidence_count?: number
  /** cover letter 문항 id — one `validated` per section; omitted → one `validated` for all blocks */
  section_id?: string
}

export interface MockBlockStreamOptions {
  blocks: MockBlockSpec[]
  /** AI-04: emit `sources_selected` first */
  sources?: StreamSource[]
  /** fail after N blocks completed */
  failAfterBlocks?: number
  fail?: AiErrorCode
  /** provider the generation runs on (from the prepare* plan) — copied into the error event */
  provider?: AiProviderName | null
  /** v5.3: emit `adjusting_length` before `validated` ({현재 n자 / 제한 m자}) */
  adjustLength?: { current_chars: number; char_limit: number }
  /** v5.3: S-19 생성 직후 안내 sent with `validated` */
  notes?: GenerationNotesPayload
  /** v5.3 A14: seconds until a failed request-path call may be sent again (default 20) */
  retryAfterSeconds?: number
  /** ms between ticks */
  tickMs?: number
  signal?: AbortSignal
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t)
        reject(new DOMException("aborted", "AbortError"))
      },
      { once: true },
    )
  })

function chunks(text: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    const size = 30 + Math.floor(Math.random() * 31)
    out.push(text.slice(i, i + size))
    i += size
  }
  return out
}

export async function* mockBlockStream(opts: MockBlockStreamOptions): AsyncGenerator<BlockStreamEvent> {
  const tick = opts.tickMs ?? 120
  await sleep(700, opts.signal)
  if (opts.sources) {
    yield { type: "sources_selected", sources: opts.sources }
    await sleep(600, opts.signal)
  }
  // group blocks by section (insertion order); a section is confirmed when its last block ends
  const sections: Array<{ section_id?: string; blocks: MockBlockSpec[] }> = []
  for (const block of opts.blocks) {
    const last = sections[sections.length - 1]
    if (last && last.section_id === block.section_id) last.blocks.push(block)
    else sections.push({ section_id: block.section_id, blocks: [block] })
  }
  let completed = 0
  for (const section of sections) {
    for (const block of section.blocks) {
      if (opts.fail && completed >= (opts.failAfterBlocks ?? 0)) {
        yield errorEvent(opts.fail, opts.provider, opts.retryAfterSeconds)
        return
      }
      yield { type: "block_started", block_id: block.block_id }
      for (const delta of chunks(block.text)) {
        await sleep(tick, opts.signal)
        yield { type: "block_delta", block_id: block.block_id, delta }
      }
      yield { type: "block_completed", block_id: block.block_id }
      await sleep(250, opts.signal)
      completed += 1
    }
    if (opts.adjustLength) {
      yield { type: "adjusting_length", section_id: section.section_id, ...opts.adjustLength }
      await sleep(1_200, opts.signal)
    }
    // "마무리 중": validation runs before the confirmed blocks arrive
    await sleep(900, opts.signal)
    yield {
      type: "validated",
      section_id: section.section_id,
      blocks: section.blocks.map((b) => ({
        block_id: b.block_id,
        text: b.text,
        flags: b.flags ?? [],
        evidence_count: b.evidence_count ?? 1,
      })),
      notes: opts.notes,
    }
  }
  if (opts.fail) {
    yield errorEvent(opts.fail, opts.provider, opts.retryAfterSeconds)
    return
  }
  yield { type: "done" }
}

export interface MockChatTurnOptions {
  reply: string
  patchPaths?: string[]
  needsReview?: string[]
  actorAmbiguous?: string[]
  sensitive?: number
  fail?: AiErrorCode
  provider?: AiProviderName | null
  /** v5.3 A14: seconds until a failed turn may be sent again (default 20) */
  retryAfterSeconds?: number
  tickMs?: number
  signal?: AbortSignal
}

export async function* mockChatTurn(opts: MockChatTurnOptions): AsyncGenerator<ChatTurnEvent> {
  const tick = opts.tickMs ?? 90
  await sleep(800, opts.signal)
  if (opts.fail) {
    yield errorEvent(opts.fail, opts.provider, opts.retryAfterSeconds)
    return
  }
  for (const delta of chunks(opts.reply)) {
    await sleep(tick, opts.signal)
    yield { type: "reply_delta", delta }
  }
  yield { type: "reply_done" }
  await sleep(500, opts.signal)
  yield { type: "draft_patch", paths: opts.patchPaths ?? [] }
  yield {
    type: "draft_flags",
    needs_review: opts.needsReview ?? [],
    actor_ambiguous: opts.actorAmbiguous ?? [],
    sensitive: opts.sensitive ?? 0,
  }
  yield { type: "turn_done" }
}
