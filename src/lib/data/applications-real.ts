import "server-only"
/**
 * W3: the real branch of applications.ts (S-13 / S-14 / S-15 / S-16 / S-17~S-19 reads). The screens read table
 * rows, so the summaries run the same rules as the mock (`summarize`) over real rows and take the
 * values the services decide (effective extraction status, progress counts) from the services.
 */
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { JD_RAW_TEXT_REFUSAL_CODES, type ApplicationProjectListItem } from "@/lib/contracts/application"
import { AppError, isAppError } from "@/lib/contracts/errors"
import type { MockDb } from "@/lib/mock/fixtures"
import * as applicationActions from "@/server/actions/application"
import * as insightActions from "@/server/actions/insight"
import { requireConsentedUser } from "@/server/auth/session"
import { mapDbError } from "@/server/db/errors"
import type { UserSupabaseClient } from "@/server/db/types"
import { startJdExtractionInBackground } from "@/server/jobs/jd-extraction"
import type {
  AiGateRefusalCode,
  ApplicationProject,
  ApplicationStage,
  Insight,
  InsightResult,
  JdRawTextRefusalCode,
  JdRequirement,
  JobDescription,
} from "@/types/db"
import type { AiRejected } from "./ai-errors"
import type { ApplicationSummary, JobDescriptionWithRequirements, ListApplicationsOptions, UpdateFailedJdRawTextResult } from "./applications"
import { summarize } from "./applications"
import { refusalOf, unwrap } from "./source"

export const isUuid = (id: string) => z.guid().safeParse(id).success

const FEATURE_JOB_COLUMNS =
  "id, user_id, created_at, updated_at, job_type, application_project_id, target_type, target_id, status, progress, provider, model_tier, connection_tier, error_code, error_category, failure_cause, retry_after, quota_resets_at, started_at, finished_at"

function rowsOf<T>(res: { data: T[] | null; error: Parameters<typeof mapDbError>[0] | null }): T[] {
  if (res.error) throw mapDbError(res.error)
  return res.data ?? []
}

async function toSummaries(supabase: UserSupabaseClient, items: ApplicationProjectListItem[]): Promise<ApplicationSummary[]> {
  if (items.length === 0) return []
  const ids = items.map((i) => i.id)
  const [projects, jds, insights, jobs] = await Promise.all([
    supabase.from("application_projects").select("*").in("id", ids),
    supabase.from("job_descriptions").select("id, application_project_id, company_name, position_title, extraction_status, raw_text_edited_at").in("application_project_id", ids),
    supabase.from("insights").select("id, application_project_id, status, is_latest, completed_at, updated_at, ai_job_id").in("application_project_id", ids),
    supabase.from("ai_jobs").select(FEATURE_JOB_COLUMNS).in("application_project_id", ids).order("created_at", { ascending: true }),
  ])
  const projectRows = rowsOf(projects) as unknown as ApplicationProject[]
  const db = {
    application_projects: projectRows,
    job_descriptions: rowsOf(jds),
    insights: rowsOf(insights),
    drafts: [],
    ai_jobs: rowsOf(jobs),
  } as unknown as MockDb
  return items.flatMap((item) => {
    const row = projectRows.find((p) => p.id === item.id)
    if (!row) return []
    const summary = summarize(db, row, { advanceMock: false })
    return [
      {
        ...summary,
        job_description: summary.job_description && { ...summary.job_description, extraction_status: item.extractionStatus },
        insight_state: item.progress.insight,
        draft_count: item.progress.draftCount,
      },
    ]
  })
}

export async function realListApplicationProjects(opts: ListApplicationsOptions): Promise<ApplicationSummary[]> {
  const { supabase } = await requireConsentedUser()
  const items = unwrap(await applicationActions.listApplicationProjects({ sort: opts.sort === "deadline" ? "deadline" : "recent", ...(opts.stage ? { stage: opts.stage as ApplicationStage } : {}) }))
  return toSummaries(supabase, items)
}

export async function realGetApplicationProject(id: string): Promise<ApplicationSummary | null> {
  if (!isUuid(id)) return null
  const { supabase } = await requireConsentedUser()
  const hub = await applicationActions.getApplicationHub({ id })
  if ("error" in hub && hub.error.code === "not_found") return null
  const [summary] = await toSummaries(supabase, [unwrap(hub)])
  return summary ?? null
}

// ---------------- S-14 ----------------

/** Gate refusals (Q53-1) come back from the RPC as 409 `AppError`s: nothing was inserted. */
export async function realCreateApplicationProject(input: {
  raw_text: string
  name?: string | null
  deadline?: string | null
  company_name?: string | null
  position_title?: string | null
  /** R15: the posting URL (CF-10) and the 요건 미리 보기 작업 (CF-A17), both optional. */
  source_url?: string | null
  preview_job_id?: string | null
}): Promise<ApplicationProject> {
  const created = unwrap(
    await applicationActions.createApplicationProject({
      id: randomUUID(),
      rawText: input.raw_text,
      companyName: input.company_name ?? undefined,
      positionTitle: input.position_title ?? undefined,
      name: input.name ?? undefined,
      deadline: input.deadline ?? undefined,
      sourceUrl: input.source_url ?? undefined,
      previewJobId: input.preview_job_id ?? undefined,
    }),
  )
  const { supabase, user } = await requireConsentedUser()
  // D-30: with a usable key AI-01 starts right away. A failed start leaves the JD `pending` ("요건 정리하기").
  if (created.shouldExtract) await startJdExtractionInBackground(supabase, user.id, created.applicationProjectId).catch(() => null)
  const { data, error } = await supabase.from("application_projects").select("*").eq("id", created.applicationProjectId).single()
  if (error) throw mapDbError(error)
  return data as unknown as ApplicationProject
}

// ---------------- S-15 ----------------

export async function realGetJobDescription(applicationProjectId: string): Promise<JobDescriptionWithRequirements | null> {
  if (!isUuid(applicationProjectId)) return null
  const view = await applicationActions.getJdView({ id: applicationProjectId })
  if ("error" in view && view.error.code === "not_found") return null
  const jd = unwrap(view)
  const { supabase } = await requireConsentedUser()
  const [row, requirements] = await Promise.all([
    supabase.from("job_descriptions").select("*").eq("id", jd.jobDescriptionId).single(),
    supabase.from("jd_requirements").select("*").eq("job_description_id", jd.jobDescriptionId).order("sort_order"),
  ])
  if (row.error) throw mapDbError(row.error)
  return {
    ...(row.data as unknown as JobDescription),
    // pending JDs have no keywords yet (null in the DB, W0)
    tech_keywords: (row.data.tech_keywords ?? []) as unknown as JobDescription["tech_keywords"],
    // a `running` row whose job already ended reads failed (resolveExtraction)
    extraction_status: jd.extractionStatus,
    requirements: rowsOf(requirements) as unknown as JdRequirement[],
    raw_text_editable: jd.rawTextEditable,
    raw_text_lock: jd.rawTextLock,
  }
}

const RAW_TEXT_REFUSALS = [...JD_RAW_TEXT_REFUSAL_CODES, "not_found", "invalid_input"] as const

/** spec-gaps ⑰: the DM's codes → the screen's refusal names. */
export async function realUpdateFailedJdRawText(applicationProjectId: string, rawText: string): Promise<UpdateFailedJdRawTextResult> {
  const r = refusalOf(await applicationActions.updateFailedJdRawText({ id: applicationProjectId, rawText }), RAW_TEXT_REFUSALS)
  if ("refused" in r) {
    const refused: JdRawTextRefusalCode = r.refused === "not_found" ? "job_description_not_found" : r.refused === "invalid_input" ? "invalid_raw_text" : r.refused
    return { refused }
  }
  return {
    application_project_id: r.data.applicationProjectId,
    job_description_id: r.data.jobDescriptionId,
    extraction_status: "pending",
    raw_text_edited_at: r.data.rawTextEditedAt,
    ai_run_allowed: r.data.aiRunAllowed,
  }
}

export async function realGetJdRequirement(id: string): Promise<JdRequirement | null> {
  if (!isUuid(id)) return null
  const { supabase } = await requireConsentedUser()
  const { data, error } = await supabase.from("jd_requirements").select("*").eq("id", id).maybeSingle()
  if (error) throw mapDbError(error)
  return data as unknown as JdRequirement | null
}

/**
 * "요건 정리하기" (S-15, S-17~S-19). Starts the sync extraction without holding the screen (it polls the JD).
 * Path ⑤: a connection refusal changes nothing and goes back to the run button.
 */
export async function realRetryJdExtraction(applicationProjectId: string): Promise<boolean | "already" | AiRejected> {
  if (!isUuid(applicationProjectId)) return false
  const { supabase, user } = await requireConsentedUser()
  try {
    const started = await startJdExtractionInBackground(supabase, user.id, applicationProjectId)
    if (started.status === "failed" && (started.jobId === null || started.code === "key_missing" || started.code === "key_invalid")) {
      return { rejected: started.code, refusal: started.code === "key_invalid" ? ("key_invalid" satisfies AiGateRefusalCode) : null }
    }
    return true
  } catch (err) {
    if (isAppError(err) && err.code === "extraction_in_progress") return "already"
    if (isAppError(err) && err.code === "not_found") return false
    throw err
  }
}

// ---------------- S-16 ----------------

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string")
const str = (v: unknown): string => (typeof v === "string" ? v : "")

/**
 * The stored result, with the keys evidence hangs on filled the way services/insight/read.ts fills them
 * (`item_key` may be absent in stored rows), so a chip lookup and the service read agree.
 */
export function normalizeInsightResult(value: unknown): InsightResult | null {
  if (!value || typeof value !== "object") return null
  const r = value as Obj
  const strategy = obj(r.strategy)
  const counts = obj(r.summary_counts)
  const count = (k: string) => (typeof counts[k] === "number" ? (counts[k] as number) : 0)
  const sufficiency = obj(r.data_sufficiency)
  return {
    schema_version: typeof r.schema_version === "number" ? r.schema_version : 1,
    basis_note: str(r.basis_note),
    data_sufficiency: { level: sufficiency.level === "thin" ? "thin" : "ok", hints: strs(sufficiency.hints) },
    requirement_matches: arr(r.requirement_matches).flatMap((raw) => {
      const m = obj(raw)
      const requirementId = str(m.requirement_id)
      if (!requirementId || (m.status !== "met" && m.status !== "partial" && m.status !== "no_evidence")) return []
      return [{ item_key: str(m.item_key) || `requirement_matches.${requirementId}`, requirement_id: requirementId, status: m.status, rationale: str(m.rationale), missing_aspect: typeof m.missing_aspect === "string" ? m.missing_aspect : null }]
    }),
    summary_counts: { met: count("met"), partial: count("partial"), no_evidence: count("no_evidence") },
    strengths: arr(r.strengths).map((raw, n) => {
      const s = obj(raw)
      return { item_key: str(s.item_key) || `strengths.${n}`, title: str(s.title), description: str(s.description), requirement_ids: strs(s.requirement_ids) }
    }),
    gaps: arr(r.gaps).flatMap((raw, n) => {
      const g = obj(raw)
      if (g.gap_kind !== "no_evidence" && g.gap_kind !== "partial") return []
      return [
        {
          item_key: str(g.item_key) || `gaps.${n}`,
          requirement_ids: strs(g.requirement_ids),
          gap_kind: g.gap_kind,
          description: str(g.description),
          actions: arr(g.actions).flatMap((rawAction, m) => {
            const a = obj(rawAction)
            if (a.type !== "add_data" && a.type !== "reframe" && a.type !== "prepare_answer") return []
            return [{ item_key: str(a.item_key) || `gaps.${n}.actions.${m}`, type: a.type, text: str(a.text) }]
          }),
        },
      ]
    }),
    strategy: {
      positioning: str(strategy.positioning),
      project_priorities: arr(strategy.project_priorities).flatMap((raw, n) => {
        const p = obj(raw)
        const projectId = str(p.project_id)
        if (!projectId) return []
        return [{ item_key: str(p.item_key) || `strategy.project_priorities.${n}`, rank: typeof p.rank === "number" ? p.rank : n + 1, project_id: projectId, reason: str(p.reason), requirement_ids: strs(p.requirement_ids) }]
      }),
    },
  }
}

/**
 * Latest ready insight + what is generating. A generating row counts only while its job runs (UQ-581). The
 * real job writes its row after `prepare`, so a running job without a row yet still reads as generating.
 */
export async function realGetInsightState(applicationProjectId: string): Promise<{ latest: Insight | null; generating: Insight | null }> {
  if (!isUuid(applicationProjectId)) return { latest: null, generating: null }
  const { supabase, user } = await requireConsentedUser()
  const [rows, active] = await Promise.all([
    supabase.from("insights").select("*").eq("application_project_id", applicationProjectId),
    supabase.from("ai_jobs").select("id, provider, model_tier, connection_tier, created_at").eq("application_project_id", applicationProjectId).eq("job_type", "insight").in("status", ["queued", "running"]).limit(1),
  ])
  const insights = rowsOf(rows)
  const job = rowsOf(active)[0] ?? null
  const latest = insights.find((i) => i.is_latest && i.status === "ready") ?? null
  const row = job ? (insights.find((i) => i.status === "generating" && i.ai_job_id === job.id) ?? null) : null
  const generating: Insight | null = row
    ? (row as unknown as Insight)
    : job
      ? ({
          id: job.id,
          user_id: user.id,
          application_project_id: applicationProjectId,
          ai_job_id: job.id,
          status: "generating",
          is_latest: false,
          version_no: 0,
          result: null,
          match_stage_result: null,
          requirements_hash: null,
          completed_at: null,
          provider: job.provider,
          model_tier: job.model_tier,
          connection_tier: job.connection_tier,
          created_at: job.created_at,
          updated_at: job.created_at,
        } as unknown as Insight)
      : null
  return { latest: latest ? ({ ...latest, result: normalizeInsightResult(latest.result) } as unknown as Insight) : null, generating }
}

/**
 * S-16 생성 / 다시 생성. There is one button and the reuse rule only matches the latest ready insight, so a press
 * is always a new run (`regenerate`): the only input it could reuse is the one already on screen.
 */
export async function realStartInsight(applicationProjectId: string): Promise<{ insight_id: string; job_id: string }> {
  const data = unwrap(await insightActions.startInsight({ applicationProjectId, regenerate: true }))
  if (!data.jobId) throw new AppError("internal_error", undefined, { status: 500 })
  // the real row is written by the job's first step; the job id stands in until then
  return { insight_id: data.insightId ?? data.jobId, job_id: data.jobId }
}

