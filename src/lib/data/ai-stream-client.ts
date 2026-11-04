/**
 * Client-side SSE reader for the real AI routes (C-6): `useAiStream` / `useChatTurnStream` take
 * `{ endpoint, body }` and get the same event union they get from the mock generators, so their state
 * machines and return shapes didn't change. Previews keep passing the mock request.
 * Wire format and event names: src/lib/contracts/{ai,draft,writing-chat}.ts (camelCase → snake_case here).
 */
import type { AiErrorCode, AiProviderName, DraftBlockFlag } from "@/types/db"
import type { BlockStreamEvent, ChatTurnEvent, GenerationNotesPayload, OmittedProject, StreamErrorEvent, StreamSource, ValidatedBlock } from "@/lib/mock/ai-stream"
import { previewPathsOf } from "./writing-chat-slots"

/** A real stream request: POST JSON to a Route Handler that answers SSE (or a JSON error before the stream). */
export interface RealStreamRequest {
  endpoint: string
  body?: unknown
}

export function isRealStreamRequest(request: object): request is RealStreamRequest {
  return "endpoint" in request
}

type Raw = Record<string, unknown>

/** Parses `event:` / `data:` frames. Only `data` matters: the JSON carries `type` too. */
export async function* readSse(response: Response): AsyncGenerator<Raw> {
  if (!response.body) return
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      let end: number
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const name = frame.split("\n").find((l) => l.startsWith("event:"))?.slice(6).trim()
        const data = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n")
        if (!data) continue
        const parsed = JSON.parse(data) as Raw
        yield name && !parsed.type ? { type: name, ...parsed } : parsed
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function errorEventOf(raw: Raw, provider: AiProviderName | null): StreamErrorEvent {
  const code = raw.code === "internal_error" || typeof raw.code !== "string" ? "schema_invalid" : raw.code
  return {
    type: "error",
    error_code: code as AiErrorCode,
    provider,
    retry_after: (raw.retryAfter as string | null | undefined) ?? null,
    quota_resets_at: (raw.quotaResetsAt as string | null | undefined) ?? null,
  }
}

/**
 * A refusal before the stream opens (JSON `{ error: { code } }`, 409 / 422 / 429). The hooks show it
 * as a failed run. Non-AI codes fall to the system failure copy.
 */
async function openStream(request: RealStreamRequest, signal: AbortSignal): Promise<Response | StreamErrorEvent> {
  const response = await fetch(request.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(request.body ?? {}),
    signal,
  })
  if (response.ok && response.headers.get("content-type")?.includes("text/event-stream")) return response
  const payload = (await response.json().catch(() => null)) as { error?: Raw } | null
  return errorEventOf(payload?.error ?? {}, null)
}

function validatedBlocks(result: unknown): ValidatedBlock[] {
  const out: ValidatedBlock[] = []
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (!value || typeof value !== "object") return
    const o = value as Raw
    if (typeof o.block_id === "string" && typeof o.text === "string") {
      out.push({
        block_id: o.block_id,
        text: o.text,
        flags: (Array.isArray(o.flags) ? o.flags : []) as DraftBlockFlag[],
        // AI-03 / AI-04: blocks carry no evidence; the chips are `result.evidence` with `item_key = block_id`
        evidence_count: Array.isArray((result as Raw | null)?.evidence) ? ((result as Raw).evidence as Raw[]).filter((e) => e.item_key === o.block_id).length : 0,
      })
      return
    }
    Object.values(o).forEach(walk)
  }
  walk(result)
  return out
}

function notesOf(result: unknown): GenerationNotesPayload | undefined {
  if (!result || typeof result !== "object") return undefined
  const r = result as { omitted?: unknown[]; notes_for_user?: string[]; char_adjust_needed?: boolean }
  // QA-W5-01: AI-03 sends `{ project_id, reason }`; the editor turns it into "회사 › 프로젝트 — 이유"
  const omitted = r.omitted?.flatMap((o): Array<OmittedProject | string> => {
    if (typeof o === "string") return o.trim() ? [o] : []
    const item = (o ?? {}) as Raw
    if (typeof item.project_id === "string") return [{ project_id: item.project_id, reason: typeof item.reason === "string" ? item.reason : "" }]
    return typeof item.label === "string" && item.label.trim() ? [item.label] : []
  })
  if (!omitted?.length && !r.notes_for_user?.length && !r.char_adjust_needed) return undefined
  return { omitted, notes_for_user: r.notes_for_user, char_adjust_needed: r.char_adjust_needed }
}

/**
 * `validated` replaces its section's blocks with the confirmed set. A real stream's provisional blocks have no
 * section_id, so they belong to whichever section `validated` names. Another section's blocks stay, provisional or
 * confirmed (a mock plan streams several sections in one run).
 */
export function replaceSectionBlocks<B extends { section_id?: string; state: string }>(prev: B[], key: string, confirmed: B[]): B[] {
  const inSection = (b: B) => (b.section_id ?? "") === key || (!b.section_id && b.state !== "validated")
  const firstIndex = prev.findIndex(inSection)
  const rest = prev.filter((b) => !inSection(b))
  const at = firstIndex < 0 ? rest.length : Math.min(firstIndex, rest.length)
  return [...rest.slice(0, at), ...confirmed, ...rest.slice(at)]
}

/** AI-03 / AI-04 SSE → the block events `useAiStream` handles. */
export async function* realBlockStream(request: RealStreamRequest, signal: AbortSignal): AsyncGenerator<BlockStreamEvent> {
  const opened = await openStream(request, signal)
  if (!(opened instanceof Response)) {
    yield opened
    return
  }
  let provider: AiProviderName | null = null
  let sectionId: string | undefined
  for await (const ev of readSse(opened)) {
    switch (ev.type) {
      case "generation_started":
        provider = ev.provider as AiProviderName
        sectionId = (ev.sectionId as string | null) ?? undefined
        break
      case "sources_selected":
        yield {
          type: "sources_selected",
          sources: (ev.sources as Raw[]).map(
            (s): StreamSource => ({
              label: String(s.label ?? ""),
              rationale: String(s.rationale ?? ""),
              role: s.role as StreamSource["role"],
              origin: ev.selectionMode === "user" ? "user" : "ai",
              requirement_ids: s.requirement_ids as string[],
            }),
          ),
        }
        break
      case "block_started":
        yield { type: "block_started", block_id: String(ev.blockId) }
        break
      case "block_delta":
        yield { type: "block_delta", block_id: String(ev.blockId), delta: String(ev.text ?? "") }
        break
      case "block_completed":
        yield { type: "block_completed", block_id: String(ev.blockId) }
        break
      case "adjusting_length":
        yield { type: "adjusting_length", section_id: ev.sectionId as string, current_chars: Number(ev.charCount), char_limit: Number(ev.charLimit) }
        break
      case "validated":
        yield { type: "validated", section_id: sectionId, blocks: validatedBlocks(ev.result), notes: notesOf(ev.result) }
        break
      case "done":
        yield { type: "done", ...(typeof ev.draftId === "string" ? { draft_id: ev.draftId } : {}), ...(ev.reused === true ? { reused: true } : {}) }
        return
      case "error":
        yield errorEventOf(ev, provider)
        return
    }
  }
}

/** AI-12 turn SSE → the chat events `useChatTurnStream` handles. */
export async function* realChatTurn(request: RealStreamRequest, signal: AbortSignal): AsyncGenerator<ChatTurnEvent> {
  const opened = await openStream(request, signal)
  if (!(opened instanceof Response)) {
    yield opened
    return
  }
  let provider: AiProviderName | null = null
  // `needsReview` comes in the event after the one with the draft
  let draft: unknown = null
  for await (const ev of readSse(opened)) {
    switch (ev.type) {
      case "turn_started":
        provider = ev.provider as AiProviderName
        break
      case "reply_delta":
        yield { type: "reply_delta", delta: String(ev.text ?? "") }
        break
      case "reply_done":
        yield { type: "reply_done" }
        break
      case "draft_patch":
        draft = ev.structuredDraft
        yield { type: "draft_patch", paths: previewPathsOf(draft, ev.changed) }
        break
      case "draft_flags":
        yield {
          type: "draft_flags",
          needs_review: previewPathsOf(draft, ev.needsReview),
          actor_ambiguous: [],
          sensitive: Number(ev.sensitiveAdded ?? 0),
        }
        break
      case "turn_done":
        yield { type: "turn_done" }
        return
      case "error":
        yield errorEventOf(ev, provider)
        return
    }
  }
}
