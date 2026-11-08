/**
 * ai_jobs (async job mode) read/write. Server only. Client polling goes through server actions in
 * ./actions.ts → useAiJob(), so the hook's shape didn't change.
 * Real path: the same runner and services as the /api/ai-jobs routes (wake on poll, retry, cancel).
 * Mock path: `?state=` / `/dev/` previews only (`isPreviewRequest`). A plain request never reads the mock store.
 */
import type { AiErrorCode, AiJob, AiJobType, NameSource } from "@/types/db"
import { clone, mockRequest } from "@/lib/mock/store"
import type { MockDb } from "@/lib/mock/fixtures"
import { advanceMockJob, recordMockUsage, retryMockJob } from "@/lib/mock/ai"
import { routes } from "@/lib/routes"
import { ensureJdRequirementsInDb } from "./applications"
import { applicationDisplayName } from "./labels"
import { isPreviewRequest } from "./source"
import { isAppError } from "@/lib/contracts/errors"
import { getSiteOrigin } from "@/server/auth/site-url"
import { requireConsentedUser, requireUser } from "@/server/auth/session"
import { createAppJobRunner } from "@/server/jobs/app-runner"
import { loadActiveJobViewRows, loadJobViewRow, loadLatestJobViewRow, requestCancel } from "@/server/services/ai-jobs"

/** Async-job view model for C-03 / completion toast */
export interface AiJobView extends AiJob {
  application_name: string | null
  /** completion toast copy (C-03) */
  done_message: string
  /** "보기" target */
  result_href: string | null
}

function jobView(db: MockDb, job: AiJob): AiJobView {
  return toJobView(job, db.application_projects.find((a) => a.id === job.application_project_id) ?? null)
}

function toJobView(job: AiJob, ap: { id: string; name: string | null; name_source: NameSource | null; created_at: string } | null): AiJobView {
  const name = ap ? applicationDisplayName(ap.name, ap.name_source, ap.created_at) : null
  let result_href: string | null = null
  // [UI-가정] C-03 copy pattern
  let done_message = "AI 작업이 끝났어요"
  if (ap) {
    switch (job.job_type) {
      case "insight":
        result_href = routes.applicationInsight(ap.id)
        done_message = `${name} 인사이트가 준비됐어요`
        break
    }
  }
  return { ...job, application_name: name, done_message, result_href }
}

type RealJobRow = NonNullable<Awaited<ReturnType<typeof loadJobViewRow>>>

/** The view's internal columns have no user grant, and screens don't read them. */
function realJobView(row: RealJobRow): AiJobView {
  const { application_projects: ap, ...job } = row
  // QA-W5-10: internals no screen reads stay on the server (`model` stays: the C-19 tooltip shows it).
  const aiJob = { ...job, params: null, step_outputs: {}, run_generation: 0, input_hash: null, prompt_version: null, usage: null, output: null } as unknown as AiJob
  return toJobView(
    aiJob,
    ap && job.application_project_id
      ? { id: job.application_project_id, name: ap.name, name_source: ap.name_source as NameSource | null, created_at: ap.created_at }
      : null,
  )
}

async function realJobById(jobId: string): Promise<AiJobView | null> {
  const row = await loadJobViewRow((await requireUser()).supabase, jobId)
  return row ? realJobView(row) : null
}

/** Mock AI-02 stage-1 matches for an application's requirements (deterministic by order). */
function mockMatches(db: MockDb, applicationProjectId: string) {
  const jd = db.job_descriptions.find((j) => j.application_project_id === applicationProjectId)
  const reqs = db.jd_requirements.filter((r) => r.job_description_id === jd?.id).sort((a, b) => a.sort_order - b.sort_order)
  const statuses = ["met", "partial", "no_evidence"] as const
  return reqs.map((r, i) => ({
    item_key: `requirement_matches.${r.id}`,
    requirement_id: r.id,
    status: statuses[i % 3],
    rationale: "입력된 경력 데이터 기준 판단입니다.",
    missing_aspect: i % 3 === 0 ? null : "구체적인 본인 기여",
  }))
}

/** Apply the mock job's progress to the rows it produces (partial results, completion). */
function syncEffects(db: MockDb, job: AiJob, terminalNow: boolean) {
  const now = new Date().toISOString()

  // AI-02 stage 1 partial result: fill match_stage_result per finished batch (A3 UQ-65)
  if (job.job_type === "insight") {
    const insight = db.insights.find((i) => i.ai_job_id === job.id)
    const p = job.progress
    if (insight && p && p.stage !== "prepare") {
      const total = p.stage === "match" ? (p.total ?? 1) : (job.params?.mock_units as number | undefined) ?? p.total ?? 1
      const done = p.stage === "match" ? (p.done ?? 0) : total
      if (done > 0 && (insight.match_stage_result?.batches_done ?? 0) < done) {
        const all = mockMatches(db, insight.application_project_id)
        const per = Math.ceil(all.length / Math.max(1, total))
        insight.match_stage_result = {
          schema_version: 1,
          batches_done: done,
          batches_total: total,
          requirement_matches: all.slice(0, Math.min(all.length, per * done)),
        }
      }
    }
  }

  if (!terminalNow) return

  // C-13: one usage row per provider call (failed calls too). No reserve/charge (D-34).
  if (job.status !== "canceled")
    recordMockUsage(db, {
      // a `prepare` failure never reached this job's own AI call: the failed call is the requirement extraction
      job_type: job.params?.mock_fail_at_prepare === true ? "jd_extraction" : job.job_type,
      ai_job_id: job.id,
      application_project_id: job.application_project_id,
      provider: job.provider,
      connection_tier: job.connection_tier ?? "free",
      outcome: job.status === "succeeded" ? "succeeded" : "failed",
      error_code: job.error_code,
      calls: job.status === "succeeded" ? Math.max(1, Number(job.params?.mock_units ?? 1)) : 1,
    })

  if (job.job_type === "insight") {
    const insight = db.insights.find((i) => i.ai_job_id === job.id)
    if (insight && job.status === "succeeded") {
      const matches = mockMatches(db, insight.application_project_id)
      for (const other of db.insights.filter((i) => i.application_project_id === insight.application_project_id)) other.is_latest = false
      Object.assign(insight, {
        status: "ready",
        is_latest: true,
        completed_at: now,
        updated_at: now,
        result: {
          schema_version: 1,
          basis_note: "입력된 경력 데이터 기준 분석입니다",
          data_sufficiency: { level: "ok", hints: [] },
          requirement_matches: matches,
          summary_counts: {
            met: matches.filter((m) => m.status === "met").length,
            partial: matches.filter((m) => m.status === "partial").length,
            no_evidence: matches.filter((m) => m.status === "no_evidence").length,
          },
          strengths: [],
          gaps: [],
          strategy: { positioning: "결제·커머스 도메인 경험을 앞세웁니다.", project_priorities: [] },
        },
      })
    }
    if (insight && job.status !== "succeeded") Object.assign(insight, { status: "failed", updated_at: now })
  }
}

function refresh(db: MockDb, job: AiJob) {
  const terminal = advanceMockJob(job, db)
  syncEffects(db, job, terminal)
}

export async function getAiJob(id: string): Promise<AiJobView | null> {
  if (!(await isPreviewRequest())) {
    // Same side effects as GET /api/ai-jobs/{id} (B-4): wakes a due job, fails a stalled one.
    const { user } = await requireConsentedUser()
    try {
      await createAppJobRunner(await getSiteOrigin()).getStatus({ jobId: id, userId: user.id })
    } catch (err) {
      if (isAppError(err) && err.code === "not_found") return null
      throw err
    }
    return realJobById(id)
  }
  const db = await mockRequest(60)
  const job = db.ai_jobs.find((j) => j.id === id)
  if (!job) return null
  refresh(db, job)
  return clone(jobView(db, job))
}

/** Running/queued jobs plus jobs that finished in the last `sinceMs` (for completion toasts). */
export async function listActiveAiJobs(sinceMs = 15_000): Promise<AiJobView[]> {
  if (!(await isPreviewRequest())) {
    // The shell's watcher runs on S-25 too (A7), so no consent gate on this read.
    return (await loadActiveJobViewRows((await requireUser()).supabase, new Date(Date.now() - sinceMs).toISOString())).map(realJobView)
  }
  const db = await mockRequest(60)
  const cutoff = Date.now() - sinceMs
  const out: AiJobView[] = []
  for (const job of db.ai_jobs) {
    if (job.job_type === "writing_chat_turn" || job.job_type === "jd_extraction") continue
    const wasActive = job.status === "queued" || job.status === "running"
    if (wasActive) refresh(db, job)
    const recent = job.finished_at && Date.parse(job.finished_at) >= cutoff
    if (job.status === "queued" || job.status === "running" || recent) out.push(jobView(db, job))
  }
  return clone(out)
}

/** Latest job for a target. `jobType` narrows the type. */
export async function getLatestJobFor(
  targetType: string,
  targetId: string,
  opts?: { jobType?: AiJobType },
): Promise<AiJobView | null> {
  if (!(await isPreviewRequest())) {
    const row = await loadLatestJobViewRow((await requireUser()).supabase, targetType, targetId, opts?.jobType)
    return row ? realJobView(row) : null
  }
  const db = await mockRequest(60)
  const job = [...db.ai_jobs]
    .reverse()
    .find(
      (j) =>
        j.target_type === targetType &&
        j.target_id === targetId &&
        (!opts?.jobType || j.job_type === opts.jobType),
    )
  if (!job) return null
  refresh(db, job)
  return clone(jobView(db, job))
}

/** Sets cancel_requested_at (C-04 중단 / FL-06). */
export async function cancelAiJob(id: string): Promise<void> {
  if (!(await isPreviewRequest())) {
    // POST /api/ai-jobs/{id}/cancel
    const { supabase, user } = await requireConsentedUser()
    const { status } = await requestCancel(supabase, id)
    if (status === "queued") await createAppJobRunner(await getSiteOrigin()).settleCancelIfQueued({ jobId: id, userId: user.id })
    return
  }
  const db = await mockRequest(60)
  const job = db.ai_jobs.find((j) => j.id === id)
  if (job && (job.status === "queued" || job.status === "running")) job.cancel_requested_at = new Date().toISOString()
}

/**
 * C-20 "다시 시도" on the same row (POST /api/ai-jobs/{id}/retry, 04 §2.9.1 경우 (1), A1 변경).
 * Path ② order (04 §2.11.7): not found → null; queued / running → that job (follow, 202);
 * then retryGate() — ai_job_not_retryable (request-scoped types, input-caused failures, rows that
 * are not `failed`) → key_missing → key_invalid → ai_consent_required → ai_connection_changed —
 * thrown as MockAiError (withAiGuard → `{ rejected, refusal }`, nothing changed).
 * Runs on the **current** active provider / tier: different from the job row → restart from
 * `prepare` and reopen every result row the job wrote (R-63); same → resume, reopen failed rows.
 */
export async function retryAiJob(id: string, opts?: { fail?: AiErrorCode | null; rate_wait?: boolean }): Promise<AiJobView | null> {
  if (!(await isPreviewRequest())) {
    // POST /api/ai-jobs/{id}/retry. A 409 throws AppError → withAiGuard → `{ rejected, refusal }`.
    const { user } = await requireConsentedUser()
    try {
      const started = await createAppJobRunner(await getSiteOrigin()).retryJob({ jobId: id, userId: user.id })
      return realJobById(started.jobId)
    } catch (err) {
      if (isAppError(err) && err.code === "not_found") return null
      throw err
    }
  }
  const db = await mockRequest()
  const job = db.ai_jobs.find((j) => j.id === id)
  if (!job) return null
  if (job.status === "queued" || job.status === "running") {
    refresh(db, job)
    return clone(jobView(db, job))
  }
  const prepareFailed = job.params?.mock_fail_at_prepare === true
  retryMockJob(job, opts, db)
  // `prepare`부터 다시 (S-16): the requirements are extracted again; the same failure ends the job the same way
  if (prepareFailed && job.application_project_id) {
    const extraction = await ensureJdRequirementsInDb(db, job.application_project_id)
    if (extraction.failed) Object.assign(job, { params: { ...job.params, mock_fail: extraction.failed, mock_fail_at_prepare: true } })
  }
  // the rows the job produces go back to their in-progress state (UQ-49, R-63)
  if (job.job_type === "insight") {
    const insight = db.insights.find((i) => i.ai_job_id === job.id)
    if (insight) insight.status = "generating"
  }
  return clone(jobView(db, job))
}

/**
 * Mock: advances this application's running async jobs and writes what they produced. For rules that
 * read "no job is running" (update_failed_jd_raw_text condition 1). AI-01 jobs have their own path.
 */
export function refreshApplicationJobs(db: MockDb, applicationProjectId: string) {
  for (const job of db.ai_jobs) {
    if (job.application_project_id !== applicationProjectId || job.job_type === "jd_extraction") continue
    if (job.status === "queued" || job.status === "running") refresh(db, job)
  }
}
