import { AppError } from "@/lib/contracts/errors";
import type { JdSentence } from "@/server/ai/context-pack/jd";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/**
 * Shared JD / project helpers. R17: the AI-01 extraction DB (`createJdExtractionDb`,
 * begin / apply / fail_jd_extraction) is gone with the RPCs.
 */

/** jsonb `sentences` → typed list (the DB checks the structure; malformed members are dropped). */
export function parseSentences(value: Json | null | undefined): JdSentence[] {
  if (!Array.isArray(value)) return [];
  const out: JdSentence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const s = item as Record<string, unknown>;
    if (typeof s.sid === "string" && typeof s.text === "string" && typeof s.start === "number" && typeof s.end === "number") {
      out.push({ sid: s.sid, text: s.text, start: s.start, end: s.end });
    }
  }
  return out;
}

/** Throws `not_found` unless the project exists for this user (RLS). */
export async function assertApplicationProjectOwned(user: UserSupabaseClient, applicationProjectId: string): Promise<void> {
  const { data, error } = await user.from("application_projects").select("id").eq("id", applicationProjectId).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new AppError("not_found", "자기소개서를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.", { status: 404 });
}
