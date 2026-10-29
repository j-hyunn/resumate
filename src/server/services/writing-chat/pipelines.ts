import { selectGateRequirements, type GateRequirement, type GateRequirementRow } from "@/server/ai/context-pack/gate-requirements";
import { buildWritingChatContext, type WritingChatContext, type WritingChatTurnInput } from "@/server/ai/context-pack/writing-chat";
import { extract, reply } from "@/server/ai/pipelines/AI-12";
import { isEmptyDraftPatch } from "@/server/ai/schemas/structured-draft";
import { mapDbError } from "@/server/db/errors";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import { getDataReadiness } from "@/server/services/career/rpc";
import type { AiLogger } from "@/server/ai/log";
import type { RequirementCategory, RequirementImportance } from "@/lib/contracts/enums";
import type { Log, TurnSnapshot, WritingChatPipelines } from "./types";

/**
 * Production AI-12 pipelines (ai-pipeline `extract` / `reply`, notes §0).
 * Builds `WritingChatTurnInput` once per turn from the snapshot plus the
 * context reads the pack needs (app_ai_writer: affiliation candidates, the
 * augment target, desired job title, readiness for gate chats). Reads only —
 * the turn never writes career tables (NFR-AI-05).
 */

type Loaded = Omit<WritingChatTurnInput, "mode" | "messages" | "structuredDraft" | "lastExtractedSequence" | "requestedSlot" | "isFinalReply">;

async function loadPackInputs(db: AiWriterSupabaseClient, snap: TurnSnapshot): Promise<Loaded> {
  const chat = snap.chat;
  const [exps, edus, profile, project, details] = await Promise.all([
    db.from("experiences").select("id, company_name, start_month, end_month, is_current, status").order("start_month", { ascending: false, nullsFirst: false }),
    db.from("educations").select("id, institution_name, program_name, start_month, end_month, status").order("start_month", { ascending: false, nullsFirst: false }),
    db.from("profiles").select("desired_job_title").eq("id", chat.userId).maybeSingle(),
    chat.mode === "augment_project" && chat.projectId
      ? db.from("projects").select("id, name, role, summary, start_month, end_month, team_size").eq("id", chat.projectId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    chat.mode === "augment_project" && chat.projectId
      ? db
          .from("project_details")
          .select("id, status, sort_order, title, situation, task, action, result, learnings")
          .eq("project_id", chat.projectId)
          .order("sort_order")
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [exps, edus, profile, project, details]) if (r.error) throw mapDbError(r.error);

  const experiences = exps.data ?? [];
  const educations = edus.data ?? [];
  const parent = chat.experienceId
    ? experiences.find((e) => e.id === chat.experienceId)
    : chat.educationId
      ? educations.find((e) => e.id === chat.educationId)
      : undefined;

  let gate: WritingChatTurnInput["gate"] = null;
  let gateRequirements: GateRequirement[] = [];
  if (chat.returnTarget) {
    const [readiness, requirements] = await Promise.all([getDataReadiness(db), loadGateRequirements(db, chat.returnTarget.application_project_id)]);
    const key = chat.returnTarget.feature === "insight" ? "insight" : chat.returnTarget.feature === "job_interview" ? "job_interview" : "draft";
    const f = readiness.features[key];
    gate = { feature: chat.returnTarget.feature, missing: f.ready ? [] : f.missing };
    gateRequirements = requirements;
  }

  const p = project.data;
  return {
    affiliation: {
      experienceId: chat.experienceId,
      educationId: chat.educationId,
      parentStatus: parent ? (parent.status === "complete" ? "complete" : "draft") : null,
    },
    candidates: {
      experiences: experiences.map((e) => ({ id: e.id, companyName: e.company_name, startMonth: e.start_month, endMonth: e.end_month, isCurrent: e.is_current })),
      educations: educations.map((e) => ({ id: e.id, institutionName: e.institution_name, programName: e.program_name, startMonth: e.start_month, endMonth: e.end_month })),
    },
    augmentTarget: p
      ? {
          project: { id: p.id, name: p.name, role: p.role, summary: p.summary, startMonth: p.start_month, endMonth: p.end_month, teamSize: p.team_size },
          details: (details.data ?? []).map((d) => ({
            id: d.id,
            status: d.status === "complete" ? ("complete" as const) : ("draft" as const),
            sortOrder: d.sort_order,
            title: d.title,
            situation: d.situation,
            task: d.task,
            action: d.action,
            result: d.result,
            learnings: d.learnings,
          })),
        }
      : null,
    desiredJobTitle: profile.data?.desired_job_title ?? null,
    gate,
    gateRequirements,
  };
}

/**
 * R-31 (S5): the gate's JD requirements for the reply call — high importance
 * first, then requirements with weak career evidence (ai `selectGateRequirements`).
 * No JD, no requirements yet, or the project was deleted → [] (no block).
 * Reads as app_ai_writer (RLS: this user's rows only); never writes.
 */
export async function loadGateRequirements(db: AiWriterSupabaseClient, applicationProjectId: string): Promise<GateRequirement[]> {
  const jd = await db.from("job_descriptions").select("id").eq("application_project_id", applicationProjectId).maybeSingle();
  if (jd.error) throw mapDbError(jd.error);
  if (!jd.data) return [];
  const [reqs, skills, projects, details] = await Promise.all([
    db.from("jd_requirements").select("id, category, content, keywords, importance, sort_order").eq("job_description_id", jd.data.id).order("sort_order"),
    db.from("skills").select("name, normalized_name"),
    db.from("projects").select("name, role, summary").eq("status", "complete"),
    db.from("project_details").select("title, situation, task, action, result").eq("status", "complete"),
  ]);
  for (const r of [reqs, skills, projects, details]) if (r.error) throw mapDbError(r.error);
  const rows: GateRequirementRow[] = (reqs.data ?? []).map((r) => ({
    id: r.id,
    category: r.category as RequirementCategory,
    content: r.content,
    keywords: r.keywords ?? [],
    importance: r.importance as RequirementImportance,
    sort_order: r.sort_order,
  }));
  if (rows.length === 0) return [];
  const texts: string[] = [];
  for (const p of projects.data ?? []) texts.push(...[p.name, p.role, p.summary].filter((t): t is string => !!t));
  for (const d of details.data ?? []) texts.push(...[d.title, d.situation, d.task, d.action, d.result].filter((t): t is string => !!t));
  return selectGateRequirements(rows, {
    skillNames: (skills.data ?? []).map((s) => s.normalized_name ?? s.name),
    texts,
  });
}

export function toTurnInput(snap: TurnSnapshot, loaded: Loaded): WritingChatTurnInput {
  const chat = snap.chat;
  return {
    mode: chat.mode,
    // The pack keeps `done` only (failed replies never reach the model, AI-12).
    messages: chat.messages.map((m) => ({ id: m.id, sequence: m.sequence, role: m.role, content: m.content, status: m.status })),
    structuredDraft: chat.structuredDraft,
    lastExtractedSequence: chat.lastExtractedSequence,
    requestedSlot: snap.requestedSlot
      ? { slot: snap.requestedSlot.slot, detail_key: snap.requestedSlot.detailKey, existing_detail_id: snap.requestedSlot.existingDetailId }
      : null,
    // begin_assistant_message.is_final (no further user message fits after this reply).
    isFinalReply: snap.isLastTurn,
    ...loaded,
  };
}

export type PipelineLogOptions = {
  /** QA-S4-02: V-9 validation stats (counts only) per extract; default silent. */
  logger?: AiLogger;
  /** Turn log (ids / codes / counts): V-9 rejections as check + field path, never text. */
  log?: Log;
};

export function createWritingChatPipelines(opts: PipelineLogOptions = {}): WritingChatPipelines {
  // One context per turn (both calls share the C-8 prefix).
  const contexts = new WeakMap<TurnSnapshot, Promise<WritingChatContext>>();
  const contextFor = (snap: TurnSnapshot): Promise<WritingChatContext> => {
    let ctx = contexts.get(snap);
    if (!ctx) {
      ctx = loadPackInputs(snap.db, snap).then((loaded) => buildWritingChatContext(toTurnInput(snap, loaded)));
      // A failed load is not cached (the other call may retry).
      ctx.catch(() => contexts.delete(snap));
      contexts.set(snap, ctx);
    }
    return ctx;
  };

  return {
    async *reply(call) {
      const ctx = await contextFor(call.snapshot);
      for await (const event of reply(ctx, { llm: call.llm, signal: call.signal, callKey: call.callKey })) {
        if (event.type === "delta") yield { type: "delta", text: event.text };
        else if (event.type === "done") yield { type: "done" };
        else yield { type: "error", error: event.error };
      }
    },
    async extract(call) {
      const ctx = await contextFor(call.snapshot);
      const result = await extract(ctx, { llm: call.llm, signal: call.signal, callKey: call.callKey, jobId: call.jobId, logger: opts.logger });
      if (result.skipped) return { skipped: true, patch: null, processedThroughSequence: null };
      if (result.rejections.length > 0) {
        // AI-12: rejected patches are logged by check number and field only (no source text).
        opts.log?.("writing_chat.v9_rejected", {
          jobId: call.jobId,
          count: result.rejections.length,
          checks: [...new Set(result.rejections.map((r) => r.check))].sort().join(","),
          targets: [...new Set(result.rejections.map((r) => r.target))].slice(0, 20).join(","),
        });
      }
      return {
        skipped: false,
        patch: isEmptyDraftPatch(result.patch) ? null : result.patch,
        processedThroughSequence: result.processedThroughSequence,
      };
    },
  };
}
