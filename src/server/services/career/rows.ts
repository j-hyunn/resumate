import type { PostgrestError } from "@supabase/supabase-js";
import { AppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/**
 * Whole career rows (DM v4.4) as the user (RLS) for the wired data layer (`src/lib/data/career.ts`, W2). The
 * screens read table rows, not the S2 DTOs. DM §2.4: tens of rows per user, read once and joined in memory.
 */

type Res<T> = { data: T | null; error: PostgrestError | null };

function rowsOf<T>(res: Res<T[]>): T[] {
  if (res.error) throw mapDbError(res.error);
  return res.data ?? [];
}

function rowOf<T>(res: { data: T; error: PostgrestError | null }): T {
  if (res.error) throw mapDbError(res.error);
  return res.data;
}

export async function loadCareerRows(supabase: UserSupabaseClient) {
  const [experiences, educations, projects, deliverables, skills, links, chats] = await Promise.all([
    supabase.from("experiences").select("*"),
    supabase.from("educations").select("*"),
    supabase.from("projects").select("*").order("created_at"),
    supabase.from("project_deliverables").select("*").order("project_id").order("sort_order"),
    supabase.from("skills").select("*").order("name"),
    supabase.from("project_skills").select("*").order("created_at"),
    supabase.from("writing_chats").select("*").order("last_activity_at", { ascending: false }),
  ]);
  return {
    experiences: rowsOf(experiences),
    educations: rowsOf(educations),
    projects: rowsOf(projects),
    project_deliverables: rowsOf(deliverables),
    skills: rowsOf(skills),
    project_skills: rowsOf(links),
    writing_chats: rowsOf(chats),
  };
}

export async function loadProfileRow(supabase: UserSupabaseClient, userId: string) {
  const row = rowOf(await supabase.from("profiles").select("*").eq("id", userId).maybeSingle());
  if (!row) throw new AppError("not_found");
  return row;
}

export async function loadExperienceRow(supabase: UserSupabaseClient, id: string) {
  return rowOf(await supabase.from("experiences").select("*").eq("id", id).maybeSingle());
}

export async function loadEducationRow(supabase: UserSupabaseClient, id: string) {
  return rowOf(await supabase.from("educations").select("*").eq("id", id).maybeSingle());
}

export async function loadProjectRow(supabase: UserSupabaseClient, id: string) {
  return rowOf(await supabase.from("projects").select("*").eq("id", id).maybeSingle());
}

/** Skills linked to one project (S-10 사용 기술). */
export async function loadProjectSkillRows(supabase: UserSupabaseClient, projectId: string) {
  const links = rowsOf(await supabase.from("project_skills").select("skill_id").eq("project_id", projectId));
  if (links.length === 0) return [];
  return rowsOf(await supabase.from("skills").select("*").in("id", links.map((l) => l.skill_id)));
}

/** Chats of one project, latest activity first (S-10 패널 대화 기록). */
export async function loadProjectWritingChatRows(supabase: UserSupabaseClient, projectId: string) {
  return rowsOf(await supabase.from("writing_chats").select("*").eq("project_id", projectId).order("last_activity_at", { ascending: false }));
}

/**
 * One chat with its messages. A `streaming` reply whose turn job is no longer running comes back as
 * `failed` (same rule as `getWritingChat`'s DTO), so the screen offers "다시 보내기".
 */
export async function loadWritingChatWithMessages(supabase: UserSupabaseClient, chatId: string) {
  const chat = rowOf(await supabase.from("writing_chats").select("*").eq("id", chatId).maybeSingle());
  if (!chat) return null;
  const messages = rowsOf(await supabase.from("writing_chat_messages").select("*").eq("writing_chat_id", chatId).order("sequence"));
  const streamingJobs = messages.filter((m) => m.status === "streaming" && m.ai_job_id).map((m) => m.ai_job_id as string);
  const running = new Set(
    streamingJobs.length === 0
      ? []
      : rowsOf(await supabase.from("ai_jobs").select("id").in("id", streamingJobs).in("status", ["queued", "running"])).map((j) => j.id),
  );
  return {
    chat,
    messages: messages.map((m) => (m.status === "streaming" && !(m.ai_job_id && running.has(m.ai_job_id)) ? { ...m, status: "failed" } : m)),
  };
}

/** S-36: the cause of each failed turn, from its ai_jobs row (error_code, retry_after, quota_resets_at). */
export async function loadTurnFailureJobs(supabase: UserSupabaseClient, jobIds: string[]) {
  if (jobIds.length === 0) return [];
  return rowsOf(await supabase.from("ai_jobs").select("id, error_code, provider, retry_after, quota_resets_at").in("id", jobIds));
}
