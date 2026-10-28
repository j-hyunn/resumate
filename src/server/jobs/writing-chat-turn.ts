import "server-only";
import { createLlm } from "@/server/ai/llm";
import { consoleAiLogger } from "@/server/ai/log";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { UserSupabaseClient } from "@/server/db/types";
import { createDbRunGate } from "@/server/services/ai-connection/keys";
import { createTurnChatDb } from "@/server/services/writing-chat/db";
import { createWritingChatPipelines } from "@/server/services/writing-chat/pipelines";
import type { TurnDeps } from "@/server/services/writing-chat/types";
import { connections, logJobEvent } from "./app-runner";
import { createSupabaseJobStore } from "./supabase-store";
import { createSupabaseUsageStore } from "./supabase-usage";

/**
 * Production wiring of the AI-12 turn (S4). Same connection path as the job
 * runner (S3b): provider context from the user session, keys decrypted per
 * call through app_key_reader, key status + run gate through app_ai_writer.
 * The turn itself runs inside the SSE request (no after(), no next_run_at).
 */
export function createWritingChatTurnDeps(user: UserSupabaseClient, userId: string): TurnDeps {
  const conn = connections();
  const writer = createAiWriterClient(userId);
  return {
    userId,
    chats: createTurnChatDb(user, writer, logJobEvent),
    store: createSupabaseJobStore(writer),
    usage: createSupabaseUsageStore(writer),
    writer,
    providerContext: conn.context,
    keySource: conn.keysFor(userId),
    keyStatus: conn.statusFor(writer),
    // check_ai_run_allowed as this user's app_ai_writer (none in the dev-env key mode).
    runGate: conn.runGate ? createDbRunGate(writer) : null,
    createLlm: (input) => createLlm(input),
    // QA-S4-02: V-9 stats (counts) + rejections (check / field path) reach the logs; never text (C-7).
    pipelines: createWritingChatPipelines({ logger: consoleAiLogger, log: logJobEvent }),
    log: logJobEvent,
  };
}
