/**
 * S-19 reconnect (C-04 "이탈 시 서버가 끝까지 생성·저장"): the runs that go on without this screen's stream — after a
 * reload, or on coming back from another page. Key "draft" = the career description, otherwise a cover-letter
 * section id; value = the ai_jobs id the screen follows. `current` = what this screen is streaming itself.
 */
export function remoteRunTargets(
  draft: { draft_type: string; status: string; ai_job_id: string | null },
  sections: ReadonlyArray<{ id: string; status: string; ai_job_id: string | null }>,
  current: string | null,
): Record<string, string> {
  const runs: Record<string, string> = {}
  if (draft.draft_type === "cover_letter") {
    for (const s of sections) if (s.status === "generating" && s.ai_job_id && current !== s.id) runs[s.id] = s.ai_job_id
  } else if (draft.status === "generating" && draft.ai_job_id && current !== "draft") runs.draft = draft.ai_job_id
  return runs
}
