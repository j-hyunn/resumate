import { z } from "zod";
import { AppError, errorResponse } from "@/lib/contracts/errors";
import { WRITING_CHAT_TURN_TERMINAL_EVENTS, WritingChatRetryInput, WritingChatTurnInput } from "@/lib/contracts/writing-chat";
import { requireConsentedUser } from "@/server/auth/session";
import { createWritingChatTurnDeps } from "@/server/jobs/writing-chat-turn";
import { createSseResponse, type SseEvent } from "@/server/sse";
import { prepareTurn, runTurn } from "@/server/services/writing-chat/turn";

export const maxDuration = 60;

/**
 * `POST /api/writing-chats/{id}/turns` — one AI-12 conversation turn (SSE).
 * Body `{ content, requestedSlot? }`; `?retry=1` = "다시 보내기" of the last
 * failed reply (body optional `{ requestedSlot? }`, no new user message,
 * message count unchanged).
 *
 * Before the stream: auth, validation, chat checks, job + user message +
 * assistant row (JSON error responses: 400 / 404 / 409). The AI connection
 * gate answers as a stream with one `error` event (F-AI-08 lock: key_missing /
 * key_invalid). Then: turn_started → reply_delta* → reply_done → draft_patch →
 * draft_flags → turn_done | error.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/writing-chats/[id]/turns">) {
  try {
    const { id } = await ctx.params;
    if (!z.guid().safeParse(id).success) throw new AppError("not_found");
    const retry = new URL(request.url).searchParams.get("retry") === "1";
    const body: unknown = await request.json().catch(() => (retry ? {} : null));
    const parsed = retry ? WritingChatRetryInput.safeParse(body ?? {}) : WritingChatTurnInput.safeParse(body);
    if (!parsed.success) throw new AppError("invalid_input");

    const { supabase, user } = await requireConsentedUser();
    const deps = createWritingChatTurnDeps(supabase, user.id);
    const prepared = await prepareTurn(deps, {
      chatId: id,
      content: retry ? null : (parsed.data as z.output<typeof WritingChatTurnInput>).content,
      requestedSlot: parsed.data.requestedSlot,
    });

    const options = { requestSignal: request.signal, terminalEvents: WRITING_CHAT_TURN_TERMINAL_EVENTS };
    if (prepared.kind === "blocked") {
      return createSseResponse(async ({ emit }) => emit({ type: "error", code: prepared.code } as SseEvent), options);
    }
    return createSseResponse(({ emit, signal }) => runTurn(deps, prepared, emit, signal), options);
  } catch (err) {
    return errorResponse(err);
  }
}
