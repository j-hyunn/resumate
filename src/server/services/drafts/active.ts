import { AppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/**
 * QA-S7-07: "생성 중" = an ai_jobs row targeting this question (cover_letter) or
 * this draft (career_description) is queued / running — the same rule as the
 * read (`effectiveSectionStatus`) and the DB guard `draft_section_job_active`.
 * It covers the prepare / D-30 extraction window (the job exists, the row is
 * still pending) and ignores a leftover `generating` row whose job ended.
 */
export async function hasActiveDraftJob(user: UserSupabaseClient, target: { sectionId?: string; draftId?: string }): Promise<boolean> {
  const targets = [target.sectionId, target.draftId].filter((x): x is string => Boolean(x));
  if (targets.length === 0) return false;
  const { data, error } = await user
    .from("ai_jobs")
    .select("id")
    .in("job_type", ["cover_letter", "career_description"])
    .in("target_id", targets)
    .in("status", ["queued", "running"])
    .limit(1);
  if (error) throw mapDbError(error);
  return (data ?? []).length > 0;
}

export const sectionGenerating = () => new AppError("section_generating", "이 문항의 초안을 만들고 있어요. 생성이 끝난 뒤 다시 시도해 주세요.", { status: 409 });

export async function assertNotGenerating(user: UserSupabaseClient, target: { sectionId?: string; draftId?: string }): Promise<void> {
  if (await hasActiveDraftJob(user, target)) throw sectionGenerating();
}
