/**
 * Fake AI for the Resumate AI 패널 v4.5 (client-safe, previews only — no store access).
 * Plays AI-12 question turns and AI-13 question / draft turns with the event order of the AI spec,
 * fails with `turn_error` (`?state=ai-failed*`), refuses closed chats and the 6-draft limit.
 * The panel persists the result with `recordMockTurnAction` so saves and reopening see the same draft.
 */
import type {
  DeliverableDraftBlock,
  DeliverableDraftBody,
  DeliverableFact,
  DeliverableStructuredDraft,
  ProjectStarField,
  ProjectStructuredDraft,
} from "@/types/db"
import {
  PAGE_LIMITS,
  STAR_FIELDS_ORDER,
  blocksToMarkdown,
  bodyHash,
  isBlank,
  isProjectSnapshot,
  type DeliverableChatView,
  type TurnRequest,
  type WritingChatMessageView,
} from "@/lib/data/career-v45-shared"
import type { PanelTurnEvent } from "@/lib/data/writing-chat-turn-v45"

type MockRequest = Extract<TurnRequest, { kind: "mock" }>

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("aborted", "AbortError"))
    const t = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => {
      clearTimeout(t)
      reject(new DOMException("aborted", "AbortError"))
    }, { once: true })
  })
}

function message(role: "user" | "assistant", content: string, sequence: number, userNumber: number | null): WritingChatMessageView {
  return { id: crypto.randomUUID(), sequence, role, content, status: "done", provider: role === "assistant" ? "gemini" : null, created_at: new Date().toISOString(), user_number: userNumber, is_greeting: false }
}

const STAR_REPLY: Record<ProjectStarField, string> = {
  situation: "좋아요, 배경을 정리해 둘게요. 그 상황에서 맡은 역할이나 목표는 무엇이었나요?",
  task: "역할을 정리했어요. 그 안에서 본인이 직접 한 일은 무엇인가요?",
  action: "본인이 한 일을 정리해 두었어요. 결과는 어땠나요? 수치로 알고 있는 게 있다면 함께 말해 주세요.",
  result: "결과를 정리했어요. 이 경험에서 배운 점이나 다음에 다르게 할 점이 있나요?",
  learnings: "배운 점까지 정리했어요. 제안 카드에서 확인하고 반영해 주세요.",
}

function* chunks(text: string): Generator<string> {
  for (let i = 0; i < text.length; i += 6) yield text.slice(i, i + 6)
}

/** The AI-13 draft the mocks produce (`draft-ready`, `draft-streaming`, draft turns). */
export function mockDeliverableDraft(chat: Pick<DeliverableChatView, "structured_draft">, opts: { needsReview?: boolean; rev?: number; bodyHash?: string; currentBody?: string }): DeliverableDraftBody {
  const f = chat.structured_draft.facts
  const fid = (slot: string) => f.filter((x) => x.slot === slot && x.review !== "needs_review").map((x) => x.id)
  const any = f.filter((x) => x.review !== "needs_review").map((x) => x.id).slice(0, 1)
  const ids = (slot: string) => (fid(slot).length ? fid(slot) : any)
  const blocks: DeliverableDraftBlock[] = []
  const current = opts.currentBody?.trim() ?? ""
  if (current) {
    const last = current.split("\n").filter((l) => l.trim() && !l.startsWith("#")).slice(-1)[0] ?? current.slice(0, 80)
    blocks.push({ block_id: "b0", type: "paragraph", text: last.replace(/^[-*]\s+/, ""), basis: "current_body", source_fact_ids: [], source_body_quotes: [last.slice(0, 60)], source_project_fields: [], review: "ok" })
  }
  blocks.push(
    { block_id: "b1", type: "heading", text: "무엇을 했나", level: 2, basis: "new", source_fact_ids: [], source_body_quotes: [], source_project_fields: [], review: "ok" },
    { block_id: "b2", type: "paragraph", text: "오픈소스 결제 SDK에 네트워크 오류 시 결제 승인을 다시 시도하는 재시도 모듈을 넣었다.", basis: "new", source_fact_ids: ids("scope"), source_body_quotes: [], source_project_fields: ["PRJ.name"], review: "ok" },
    { block_id: "b3", type: "heading", text: "내가 맡은 일", level: 2, basis: "new", source_fact_ids: [], source_body_quotes: [], source_project_fields: [], review: "ok" },
    { block_id: "b4", type: "bullet_list", items: ["지수 백오프 재시도 정책을 직접 구현했다", "멱등 키 설계로 중복 승인을 막았다"], basis: "new", source_fact_ids: [...ids("contribution"), ...fid("went_well")], source_body_quotes: [], source_project_fields: [], review: opts.needsReview ? "needs_review" : "ok" },
    { block_id: "b5", type: "heading", text: "잘된 점과 아쉬운 점", level: 2, basis: "new", source_fact_ids: [], source_body_quotes: [], source_project_fields: [], review: "ok" },
    { block_id: "b6", type: "paragraph", text: "리뷰어들이 멱등 키 설계를 좋게 평가했다. 팀의 문서화가 늦어 사용 가이드가 늦게 나온 점은 아쉬웠다.", basis: "new", source_fact_ids: [...ids("went_well"), ...fid("went_wrong")], source_body_quotes: [], source_project_fields: ["PRJ.description"], review: "ok" },
  )
  return {
    value: blocksToMarkdown(blocks),
    blocks,
    rev: opts.rev ?? 1,
    generated_at: new Date().toISOString(),
    base_body_hash: opts.bodyHash ?? "",
    replace_allowed: (opts.currentBody ?? "").length <= PAGE_LIMITS.replaceBodyMax,
    missing_slots: ["learnings"],
    dropped_block_count: 1,
    applied_at: null,
    applied_mode: null,
    applied_rev: null,
  }
}

function refusal(code: NonNullable<MockRequest["turn_error"]>, beforeStream: boolean): PanelTurnEvent {
  const wait = code === "rate_limited" ? new Date(Date.now() + 30_000).toISOString() : null
  return { type: "error", error_code: code, provider: "gemini", retry_after: wait, quota_resets_at: null, before_stream: beforeStream }
}

export async function* mockPanelTurn(req: MockRequest, signal: AbortSignal): AsyncGenerator<PanelTurnEvent> {
  const isDraftTurn = req.target === "deliverable" && (req.body.requested_action === "compose_draft" || /초안/.test(req.body.content))
  // refusals before the stream (no user message stored)
  if (req.message_count > PAGE_LIMITS.lastSendableCount) return yield refusal("writing_chat_closed", true)
  if (req.turn_error === "writing_chat_closed" || req.turn_error === "invalid_form_snapshot") return yield refusal(req.turn_error, true)
  if (isDraftTurn && (req.structured_draft as DeliverableStructuredDraft).draft_count >= PAGE_LIMITS.maxDrafts) {
    return yield refusal("writing_chat_draft_limit_reached", true)
  }

  await sleep(350, signal)
  const userSeq = req.next_sequence
  const userNumber = Math.floor(req.message_count / 2) + 1
  const user = message("user", req.body.content, userSeq, userNumber)
  yield { type: "turn_started", user_message: user, assistant_message_id: crypto.randomUUID(), message_count: req.message_count + 1, retry: req.retry, provider: "gemini" }

  if (req.turn_error) {
    await sleep(900, signal)
    return yield refusal(req.turn_error, false)
  }

  const finalCount = req.message_count + 2
  const closed = finalCount >= PAGE_LIMITS.messageLimit

  if (req.target === "project") {
    const snap = req.body.form_snapshot
    const star = isProjectSnapshot(snap) ? snap.star : null
    const slot = (STAR_FIELDS_ORDER as readonly string[]).includes(req.body.requested_slot ?? "")
      ? (req.body.requested_slot as ProjectStarField)
      : STAR_FIELDS_ORDER.find((f) => isBlank(star?.[f])) ?? "action"
    const reply = STAR_REPLY[slot]
    for (const part of chunks(reply)) {
      await sleep(45, signal)
      yield { type: "reply_delta", text: part }
    }
    yield { type: "reply_done", message: message("assistant", reply, userSeq + 1, null) }
    await sleep(500, signal)
    const draft = structuredClone(req.structured_draft as ProjectStructuredDraft)
    const prev = draft.star[slot]
    const formHas = !isBlank(star?.[slot])
    draft.star[slot] = {
      value: req.body.content.trim().replace(/요\.?$/, "다."),
      op: formHas ? "append" : "set",
      origin: "ai",
      source_message_ids: [user.id],
      source_quotes: [req.body.content.trim().slice(0, 40)],
      review: req.preview_state === "needs-review" ? "needs_review" : "ok",
      reviewed_at: null,
      applied_at: null,
      rev: (prev?.rev ?? 0) + 1,
    }
    yield { type: "draft_patch", structured_draft: draft, changed: [slot] }
    yield { type: "draft_flags", needs_review: draft.star[slot]?.review === "needs_review" ? [slot] : [], actor_ambiguous: [], sensitive_added: 0, sensitive_flags_count: draft.sensitive_flags_count }
    yield { type: "turn_done", message_count: finalCount, closed, ready_to_return: false, draft_count: null }
    return
  }

  // ---- AI-13 ----
  const draft = structuredClone(req.structured_draft as DeliverableStructuredDraft)
  const factSlot = req.body.requested_slot ?? "contribution"
  const newFact: DeliverableFact = {
    id: crypto.randomUUID(),
    slot: factSlot,
    text: req.body.content.trim().replace(/요\.?$/, "다."),
    actor: /우리|저희|팀/.test(req.body.content) ? "team" : "self",
    source_message_ids: [user.id],
    source_quotes: [req.body.content.trim().slice(0, 40)],
    review: "ok",
    reviewed_at: null,
    origin: "ai",
  }
  const facts = isDraftTurn && req.body.requested_action === "compose_draft" ? draft.facts : [...draft.facts, newFact]

  if (!isDraftTurn) {
    const reply = "정리해 둘게요. 잘된 점이나 아쉬웠던 점도 있었나요?"
    for (const part of chunks(reply)) {
      await sleep(45, signal)
      yield { type: "reply_delta", text: part }
    }
    yield { type: "reply_done", message: message("assistant", reply, userSeq + 1, null) }
    await sleep(400, signal)
    yield { type: "facts_patch", facts, writing_kind: draft.writing_kind }
    yield { type: "draft_flags", needs_review: [], actor_ambiguous: newFact.actor === "team" ? [newFact.id] : [], sensitive_added: 0, sensitive_flags_count: draft.sensitive_flags_count }
    yield { type: "turn_done", message_count: finalCount, closed, ready_to_return: false, draft_count: draft.draft_count }
    return
  }

  yield { type: "facts_patch", facts, writing_kind: draft.writing_kind }
  await sleep(300, signal)
  yield { type: "draft_started" }
  const slow = req.preview_state === "draft-streaming"
  await sleep(slow ? 2500 : 900, signal)
  const formBody = "body" in req.body.form_snapshot ? req.body.form_snapshot.body : ""
  const body = mockDeliverableDraft(
    { structured_draft: { ...draft, facts } },
    // UQ-S44-6: the hash of the form body this draft was made from (lets the card show the "본문 바뀜" replace check)
    { rev: (draft.deliverable.body?.rev ?? 0) + 1, currentBody: formBody, needsReview: req.preview_state === "needs-review", bodyHash: await bodyHash(formBody) },
  )
  for (const [i, block] of body.blocks.entries()) {
    await sleep(slow ? 1200 : 350, signal)
    yield { type: "draft_block", block }
    // `?state=draft-failed`: the draft turn fails midway — the previous draft stays, the count doesn't change
    if (req.preview_state === "draft-failed" && i === 1) {
      await sleep(400, signal)
      return yield refusal("provider_unavailable", false)
    }
  }
  await sleep(400, signal)
  const draftCount = draft.draft_count + 1
  yield { type: "draft_done", body, draft_count: draftCount }
  const text = `초안을 만들었어요. 확인하고 반영 방식을 골라 주세요.${body.dropped_block_count ? ` 확인되지 않은 문장 ${body.dropped_block_count}개는 뺐어요.` : ""}`
  yield { type: "reply_done", message: message("assistant", text, userSeq + 1, null) }
  yield { type: "turn_done", message_count: finalCount, closed, ready_to_return: false, draft_count: draftCount }
}
