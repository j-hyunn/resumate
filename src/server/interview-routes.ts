import "server-only";
import { getSiteOrigin } from "@/server/auth/site-url";
import type { UserSupabaseClient } from "@/server/db/types";
import { createAppJobRunner } from "@/server/jobs/app-runner";
import { connections } from "@/server/jobs/connections";
import { INTERVIEW_PROMPT_VERSIONS } from "@/server/jobs/interview";
import type { InterviewStartDeps } from "@/server/services/interview/start";

/** Production deps of the four S8 interview routes (the request's user session + the app runner). */
export async function interviewStartDeps(supabase: UserSupabaseClient, userId: string): Promise<InterviewStartDeps> {
  return {
    userId,
    user: supabase,
    providerContext: connections().context,
    runner: createAppJobRunner(await getSiteOrigin()),
    promptVersions: INTERVIEW_PROMPT_VERSIONS,
  };
}
