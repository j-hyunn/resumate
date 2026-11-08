import { selectGateRequirements, type GateRequirement, type GateRequirementRow } from "@/server/ai/context-pack/gate-requirements";
import { buildWritingChatContext, type ProjectFormSnapshot as AiProjectFormSnapshot, type WritingChatContext, type WritingChatTurnInput } from "@/server/ai/context-pack/writing-chat";
import type { DeliverableChatTurnInput, DeliverableFormSnapshot as AiDeliverableFormSnapshot } from "@/server/ai/context-pack/deliverable-chat";
import { isDeliverableSlot } from "@/server/ai/context-pack/deliverable-slots";
import { extract, reply } from "@/server/ai/pipelines/AI-12";
import * as ai13 from "@/server/ai/pipelines/AI-13";
import type { ReplyNotice } from "@/server/ai/prompts/AI-13";
import { isEmptyDraftPatch } from "@/server/ai/schemas/structured-draft";
import { AppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import { getDataReadiness } from "@/server/services/career/rpc";
import type { AiLogger } from "@/server/ai/log";
import { WRITING_CHAT_SLOTS, type RequirementCategory, type RequirementImportance } from "@/lib/contracts/enums";
import type { DeliverablePipelines, DeliverablePlan, Log, TurnSnapshot, WritingChatPipelines } from "./types";

/**
 * Production AI-12 pipelines v4.5 (ai-pipeline `extract` / `reply`, ai notes §5).
 * Builds `WritingChatTurnInput` once per turn from the snapshot plus the context reads the
 * pack needs (app_ai_writer: the chat's project row read fresh every turn + its parent's name /
 * status, readiness and JD requirements for gate chats; **no `profiles` read** — R13 SD-6). Reads only — the
 * turn never writes career tables (NFR-AI-05).
 */

// R13 (v4.12, SD-6 / DM 2.1.5): the pack no longer reads `profiles` — 내 정보는 어떤 프롬프트에도 들어가지 않는다.
type Loaded = Pick<WritingChatTurnInput, "project" | "gate" | "gateRequirements">;

async function loadPackInputs(db: AiWriterSupabaseClient, snap: TurnSnapshot): Promise<Loaded> {
  const chat = snap.chat;
  const [projectRes] = await Promise.all([
    db
      .from("projects")
      .select("id, name, start_month, end_month, is_current, experience_id, education_id, project_type, experience_type, competencies, situation, task, action, result, learnings")
      .eq("id", chat.projectId)
      .maybeSingle(),
  ]);
  for (const r of [projectRes]) if (r.error) throw mapDbError(r.error);
  const p = projectRes.data;
  // The chat cascades with its project; a missing row here is a race with a delete.
  if (!p) throw new AppError("not_found", "대상 프로젝트를 찾을 수 없습니다.");

  const parentRes = p.experience_id
    ? await db.from("experiences").select("company_name, status").eq("id", p.experience_id).maybeSingle()
    : await db.from("educations").select("institution_name, status").eq("id", p.education_id ?? "").maybeSingle();
  if (parentRes.error) throw mapDbError(parentRes.error);
  const parentRow = parentRes.data as { company_name?: string | null; institution_name?: string | null; status: string } | null;

  let gate: WritingChatTurnInput["gate"] = null;
  let gateRequirements: GateRequirement[] = [];
  if (chat.returnTarget) {
    const [readiness, requirements] = await Promise.all([getDataReadiness(db), loadGateRequirements(db, chat.returnTarget.application_project_id)]);
    const key = chat.returnTarget.feature === "insight" ? "insight" : chat.returnTarget.feature === "job_interview" ? "job_interview" : "draft";
    const f = readiness.features[key];
    gate = { feature: chat.returnTarget.feature, missing: f.ready ? [] : f.missing };
    gateRequirements = requirements;
  }

  return {
    project: {
      id: p.id,
      name: p.name,
      startMonth: p.start_month,
      endMonth: p.end_month,
      isCurrent: p.is_current,
      parent: {
        type: p.experience_id ? "experience" : "education",
        name: (p.experience_id ? parentRow?.company_name : parentRow?.institution_name) ?? null,
        status: parentRow?.status === "complete" ? "complete" : "draft",
      },
      projectType: p.project_type,
      experienceType: p.experience_type,
      competencies: p.competencies ?? [],
      situation: p.situation,
      task: p.task,
      action: p.action,
      result: p.result,
      learnings: p.learnings,
    },
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
  const [reqs, skills, projects, deliverables] = await Promise.all([
    db.from("jd_requirements").select("id, category, content, keywords, importance, sort_order").eq("job_description_id", jd.data.id).order("sort_order"),
    db.from("skills").select("name, normalized_name"),
    db.from("projects").select("name, situation, task, action, result, role, description").eq("status", "complete"),
    db.from("project_deliverables").select("title"),
  ]);
  for (const r of [reqs, skills, projects, deliverables]) if (r.error) throw mapDbError(r.error);
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
  // v4.4 (ai notes §5.1): complete projects' STAR / role / description + deliverable titles.
  for (const p of projects.data ?? []) texts.push(...[p.name, p.situation, p.task, p.action, p.result, p.role, p.description].filter((t): t is string => !!t));
  for (const d of deliverables.data ?? []) if (d.title) texts.push(d.title);
  return selectGateRequirements(rows, {
    skillNames: (skills.data ?? []).map((s) => s.normalized_name ?? s.name),
    texts,
  });
}

export function toTurnInput(snap: TurnSnapshot, loaded: Loaded): WritingChatTurnInput {
  const chat = snap.chat;
  return {
    // The pack keeps `done` only (failed replies never reach the model, AI-12).
    messages: chat.messages.map((m) => ({ id: m.id, sequence: m.sequence, role: m.role, content: m.content, status: m.status })),
    structuredDraft: chat.structuredDraft,
    lastExtractedSequence: chat.lastExtractedSequence,
    // STAR chats only take AI-12 slots (checked by the turn service).
    requestedSlot: snap.requestedSlot && isStarChatSlot(snap.requestedSlot.slot) ? { slot: snap.requestedSlot.slot } : null,
    // begin_assistant_message.is_final (no further user message fits after this reply).
    isFinalReply: snap.isLastTurn,
    // v4.6 (PA-3): the S-10 form's unsaved values win over the DB row (validated by the turn service).
    formSnapshot: (snap.formSnapshot as AiProjectFormSnapshot | null) ?? null,
    ...loaded,
  };
}

function isStarChatSlot(slot: string): slot is (typeof WRITING_CHAT_SLOTS)[number] {
  return (WRITING_CHAT_SLOTS as readonly string[]).includes(slot);
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
      if (result.skipped) return { skipped: true, patch: null, processedThroughSequence: null, flags: null };
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
        flags: result.flags,
      };
    },
    async turnState(snapshot) {
      try {
        const ctx = await contextFor(snapshot);
        const p = ctx.input.project;
        return {
          project: { star: { situation: p.situation, task: p.task, action: p.action, result: p.result, learnings: p.learnings }, startMonth: p.startMonth },
          readyToReturn: ctx.focus.readyToReturn,
        };
      } catch {
        return null;
      }
    },
  };
}

// ---------------- AI-13 deliverable chats (ai notes §3.2–3.3) ----------------

// R13 (SD-6): `desiredJobTitle` is gone from the pack input too.
type DeliverableLoaded = Pick<DeliverableChatTurnInput, "deliverable" | "project" | "siblingTitles">;

/**
 * AI-13 input reads (app_ai_writer, RLS = this user): the deliverable row, its parent standalone
 * project (name, period, role, description — no link_url) + skills, the other deliverables' titles
 * (≤ 20, not a source), desired job title. Reads only (NFR-AI-05).
 */
export async function loadDeliverableInputs(db: AiWriterSupabaseClient, snap: TurnSnapshot): Promise<DeliverableLoaded> {
  const chat = snap.chat;
  const deliverableId = chat.projectDeliverableId;
  if (!deliverableId) throw new AppError("internal_error", undefined, { status: 500 });
  const [deliverableRes, projectRes, skillsRes, siblingsRes] = await Promise.all([
    db.from("project_deliverables").select("id, title, body").eq("id", deliverableId).maybeSingle(),
    db.from("projects").select("id, name, start_month, end_month, is_current, role, description").eq("id", chat.projectId).maybeSingle(),
    db.from("project_skills").select("skill_id, created_at").eq("project_id", chat.projectId).order("created_at"),
    db.from("project_deliverables").select("id, title").eq("project_id", chat.projectId).neq("id", deliverableId).order("sort_order").limit(20),
  ]);
  for (const r of [deliverableRes, projectRes, skillsRes, siblingsRes]) if (r.error) throw mapDbError(r.error);
  const d = deliverableRes.data;
  const p = projectRes.data;
  // The chat cascades with its deliverable / project; a missing row is a race with a delete.
  if (!d || !p) throw new AppError("not_found", "대상 산출물을 찾을 수 없습니다.");
  const skillIds = (skillsRes.data ?? []).map((r) => r.skill_id);
  let skills: string[] = [];
  if (skillIds.length > 0) {
    const names = await db.from("skills").select("id, name").in("id", skillIds);
    if (names.error) throw mapDbError(names.error);
    const byId = new Map((names.data ?? []).map((r) => [r.id, r.name]));
    skills = skillIds.map((id) => byId.get(id)).filter((n): n is string => !!n);
  }
  return {
    deliverable: { id: d.id, title: d.title, body: d.body ?? "" },
    project: {
      id: p.id,
      name: p.name,
      startMonth: p.start_month,
      endMonth: p.end_month,
      isCurrent: p.is_current,
      role: p.role,
      description: p.description,
      skills,
    },
    siblingTitles: (siblingsRes.data ?? []).map((r) => r.title),
  };
}

export function toDeliverableTurnInput(
  snap: TurnSnapshot,
  loaded: DeliverableLoaded,
  draft?: { structuredDraft: unknown; lastExtractedSequence: number },
): DeliverableChatTurnInput {
  const chat = snap.chat;
  const slot = snap.requestedSlot?.slot;
  return {
    messages: chat.messages.map((m) => ({ id: m.id, sequence: m.sequence, role: m.role, content: m.content, status: m.status })),
    structuredDraft: draft ? draft.structuredDraft : chat.deliverableDraft,
    lastExtractedSequence: draft ? draft.lastExtractedSequence : chat.lastExtractedSequence,
    // v4.6 (PA-3): the S-44 form's unsaved title / body (validated by the turn service, never stored).
    formSnapshot: (snap.formSnapshot as AiDeliverableFormSnapshot | null) ?? null,
    requestedSlot: slot && isDeliverableSlot(slot) ? slot : null,
    requestedAction: snap.requestedAction,
    style: snap.style,
    isFinalReply: snap.isLastTurn,
    ...loaded,
  };
}

/** Production AI-13 pipelines: one context per turn, rebuilt once after the facts patch (draft turn). */
export function createDeliverablePipelines(opts: PipelineLogOptions = {}): DeliverablePipelines {
  type State = { loaded: Promise<DeliverableLoaded>; ctx: Promise<ai13.DeliverableChatContext>; latest: Promise<ai13.DeliverableChatContext> };
  const states = new WeakMap<TurnSnapshot, State>();
  const stateFor = (snap: TurnSnapshot): State => {
    let st = states.get(snap);
    if (!st) {
      const loaded = loadDeliverableInputs(snap.db, snap);
      const ctx = loaded.then((l) => ai13.buildDeliverableChatContext(toDeliverableTurnInput(snap, l)));
      st = { loaded, ctx, latest: ctx };
      // A failed load is not cached (the next call may retry).
      ctx.catch(() => states.delete(snap));
      states.set(snap, st);
    }
    return st;
  };

  return {
    async plan(snapshot) {
      const plan = ai13.planDeliverableTurn(await stateFor(snapshot).ctx);
      // reject_draft_limit is refused in prepareTurn before the message is saved; here it can only
      // come from a race (another tab's draft) — composeDecision answers it with the limit notice.
      const out: DeliverablePlan = plan.kind === "reject_draft_limit" ? { kind: "compose", source: "requested_action" } : plan;
      return out;
    },
    async extract(call) {
      const ctx = await stateFor(call.snapshot).ctx;
      const result = await ai13.extract(ctx, { llm: call.llm, signal: call.signal, callKey: call.callKey, jobId: call.jobId, logger: opts.logger });
      if (result.rejections.length > 0) {
        // Rejected facts: check numbers only (C-7).
        opts.log?.("writing_chat.v10_facts_rejected", {
          jobId: call.jobId,
          count: result.rejections.length,
          checks: [...new Set(result.rejections.map((r) => r.check))].sort().join(","),
        });
      }
      return {
        skipped: result.skipped,
        patch: result.skipped || result.patch.ops.length === 0 ? null : result.patch,
        processedThroughSequence: result.processedThroughSequence,
        intent: result.intent,
        style: result.style,
        sensitiveAdded: result.sensitiveAdded,
      };
    },
    async decide(snapshot, after, plan) {
      const st = stateFor(snapshot);
      if (after.stored) {
        const loaded = await st.loaded;
        const through = after.processedThroughSequence ?? snapshot.chat.lastExtractedSequence;
        st.latest = Promise.resolve(
          ai13.buildDeliverableChatContext(toDeliverableTurnInput(snapshot, loaded, { structuredDraft: after.stored, lastExtractedSequence: through })),
        );
      }
      const ctx = await st.latest;
      const extracted = after.extracted ? { intent: after.extracted.intent, style: after.extracted.style } : null;
      return ai13.composeDecision(ctx, plan, extracted);
    },
    async *reply(call, notices) {
      const ctx = await stateFor(call.snapshot).latest;
      for await (const event of ai13.reply(ctx, { llm: call.llm, signal: call.signal, callKey: call.callKey }, notices as ReplyNotice[])) {
        if (event.type === "delta") yield { type: "delta", text: event.text };
        else if (event.type === "done") yield { type: "done" };
        else yield { type: "error", error: event.error };
      }
    },
    async *compose(call, style) {
      const ctx = await stateFor(call.snapshot).latest;
      const result = yield* ai13.compose(ctx, { llm: call.llm, signal: call.signal, callKey: call.callKey, jobId: call.jobId, logger: opts.logger }, { style });
      return { outcome: result.outcome, patch: result.patch, validation: { needsReviewBlockIds: result.validation.needsReviewBlockIds }, assistantMessage: result.assistantMessage };
    },
  };
}
