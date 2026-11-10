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
import * as ai04 from "@/server/ai/pipelines/AI-04";
import * as ai04in from "@/server/ai/context-pack/cover-letter-chat";
import type { ReplyNotice as Ai04ReplyNotice } from "@/server/ai/prompts/AI-04";
import { loadCareerRows } from "@/server/ai/context-pack/career-rows";
import { DOCUMENT_SLOT_RE } from "@/lib/contracts/writing-chat";
import { parseSentences } from "@/server/services/application/db";
import { loadInsightRequirements } from "@/server/services/insight/db";
import type { DeliverablePipelines, DeliverablePlan, DocumentPipelines, DocumentPlan, Log, TurnSnapshot, WritingChatPipelines } from "./types";

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
  // R15 D2: a STAR / deliverable chat always has a project; a 서류 대화 never reaches here.
  if (!chat.projectId) throw new AppError("internal_error", undefined, { status: 500 });
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
    const key = chat.returnTarget.feature === "insight" ? "insight" : "draft";
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
  if (!deliverableId || !chat.projectId) throw new AppError("internal_error", undefined, { status: 500 });
  const projectId: string = chat.projectId;
  const [deliverableRes, projectRes, skillsRes, siblingsRes] = await Promise.all([
    db.from("project_deliverables").select("id, title, body").eq("id", deliverableId).maybeSingle(),
    db.from("projects").select("id, name, start_month, end_month, is_current, role, description").eq("id", projectId).maybeSingle(),
    db.from("project_skills").select("skill_id, created_at").eq("project_id", projectId).order("created_at"),
    db.from("project_deliverables").select("id, title").eq("project_id", projectId).neq("id", deliverableId).order("sort_order").limit(20),
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
    // R15: the turn request's `style` may carry the 서류 vocabulary; only AI-13's values pass here.
    style: snap.style === "fit_length" ? null : snap.style,
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

// ---------------- AI-04 서류 대화 (R15, ai notes §2 (2)) ----------------

type DocumentLoaded = Pick<ai04in.CoverLetterChatTurnInput, "questions" | "careerRows" | "jd" | "insightSignal">;

/**
 * AI-04 input reads (app_ai_writer, RLS = this user): the 자기소개서 정본's `body.questions[]`, the
 * whole career pack (CL-Q1: every turn gets the full pack until RAG), the JD's sentences and
 * requirement rows, and the latest ready insight's strengths as a soft signal. Reads only (NFR-AI-05).
 *
 * `extraction.other_sids` (회사·직무 소개 문장) comes from the JD row, like AI-01's own split.
 */
export async function loadDocumentInputs(db: AiWriterSupabaseClient, snap: TurnSnapshot): Promise<DocumentLoaded> {
  const chat = snap.chat;
  const applicationProjectId = chat.applicationProjectId;
  const documentKind = chat.documentKind;
  if (!applicationProjectId || !documentKind) throw new AppError("internal_error", undefined, { status: 500 });
  const [docRes, jdRes, careerRows, insightRes] = await Promise.all([
    db.from("application_documents").select("body").eq("application_project_id", applicationProjectId).eq("document_kind", documentKind).maybeSingle(),
    db.from("job_descriptions").select("id, updated_at, sentences, position_title, extraction").eq("application_project_id", applicationProjectId).maybeSingle(),
    loadCareerRows(db),
    db
      .from("insights")
      .select("result, status, version_no")
      .eq("application_project_id", applicationProjectId)
      .eq("status", "ready")
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  for (const r of [docRes, jdRes, insightRes]) if (r.error) throw mapDbError(r.error);
  // The chat cascades with its application project; a missing JD is a race with a delete.
  if (!jdRes.data) throw new AppError("not_found", "대상 자기소개서를 찾을 수 없습니다.");
  const requirements = await loadInsightRequirements(db, jdRes.data.id);
  return {
    // No 정본 row yet (the chat may start before the first save): no questions, greeting case ②.
    questions: documentQuestionRows(docRes.data?.body),
    careerRows,
    jd: {
      jobDescriptionId: jdRes.data.id,
      jobDescriptionUpdatedAt: jdRes.data.updated_at,
      sentences: parseSentences(jdRes.data.sentences),
      companySids: otherSidsOf(jdRes.data.extraction),
      requirements,
      positionTitle: jdRes.data.position_title,
    },
    insightSignal: insightSignalOf(insightRes.data?.result),
  };
}

/** `application_documents.body.questions[]` → the pipeline's row shape (unknown values are dropped). */
function documentQuestionRows(body: unknown): ai04in.CoverLetterQuestionRow[] {
  const questions = (body as { questions?: unknown } | null | undefined)?.questions;
  if (!Array.isArray(questions)) return [];
  const out: ai04in.CoverLetterQuestionRow[] = [];
  for (const q of questions) {
    if (!q || typeof q !== "object") continue;
    const r = q as Record<string, unknown>;
    if (typeof r.slot !== "string" || typeof r.question_id !== "string") continue;
    out.push({
      slot: r.slot,
      question_id: r.question_id,
      question_text: typeof r.question_text === "string" ? r.question_text : "",
      template_key: (typeof r.question_class === "string" ? r.question_class : typeof r.template_key === "string" ? r.template_key : null) as ai04in.CoverLetterQuestionRow["template_key"],
      char_limit: typeof r.char_limit === "number" ? r.char_limit : null,
      count_basis: (r.count_basis === "without_spaces" ? "without_spaces" : "with_spaces") as ai04in.CoverLetterQuestionRow["count_basis"],
      user_note: typeof r.user_note === "string" ? r.user_note : null,
      answer_title: typeof r.answer_title === "string" ? r.answer_title : null,
      body: typeof r.body === "string" ? r.body : "",
    });
  }
  return out;
}

/** `job_descriptions.extraction.other_sids` (회사·직무 소개 문장; not requirement evidence). */
function otherSidsOf(extraction: unknown): string[] {
  if (!extraction || typeof extraction !== "object" || Array.isArray(extraction)) return [];
  const sids = (extraction as Record<string, unknown>).other_sids;
  return Array.isArray(sids) ? sids.filter((s): s is string => typeof s === "string") : [];
}

/** AI-02 result → the soft 강점 signal AI-04 may lean on (never a source of facts). */
function insightSignalOf(result: unknown): ai04in.CoverLetterInsightSignal {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const r = result as Record<string, unknown>;
  const strengths = Array.isArray(r.strengths)
    ? r.strengths
        .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : null))
        .filter((s): s is Record<string, unknown> => s !== null)
        .map((s) => ({ title: typeof s.title === "string" ? s.title : "", description: typeof s.description === "string" ? s.description : "" }))
        .filter((s) => s.title !== "")
    : [];
  const positioning = typeof r.positioning === "string" && r.positioning.trim() ? r.positioning : null;
  if (strengths.length === 0 && positioning === null) return null;
  return { strengths, positioning };
}

export function toDocumentTurnInput(
  snap: TurnSnapshot,
  loaded: DocumentLoaded,
  draft?: { structuredDraft: unknown; lastExtractedSequence: number },
): ai04in.CoverLetterChatTurnInput {
  const chat = snap.chat;
  const slot = snap.requestedSlot?.slot;
  const requestedSlot = slot && DOCUMENT_SLOT_RE.test(slot) ? slot : null;
  return {
    messages: chat.messages.map((m) => ({ id: m.id, sequence: m.sequence, role: m.role, content: m.content, status: m.status })),
    structuredDraft: draft ? draft.structuredDraft : chat.documentDraft,
    lastExtractedSequence: draft ? draft.lastExtractedSequence : chat.lastExtractedSequence,
    // DM 2.5.1: the S-46 form's unsaved values, in memory for this turn only (never stored or logged).
    formSnapshot: (snap.formSnapshot as ai04in.CoverLetterFormSnapshot | null) ?? null,
    requestedSlot,
    requestedSlots: requestedSlot ? [requestedSlot] : null,
    requestedAction: snap.requestedAction === "compose_draft" ? "compose_draft" : null,
    style: snap.style === "fit_length" || snap.style === "shorter" ? snap.style : null,
    isFinalReply: snap.isLastTurn,
    ...loaded,
  };
}

/** Production AI-04 pipelines: one context per turn, rebuilt once after the facts patch (draft turn). */
export function createDocumentPipelines(opts: PipelineLogOptions = {}): DocumentPipelines {
  type State = { loaded: Promise<DocumentLoaded>; ctx: Promise<ai04in.CoverLetterChatContext>; latest: Promise<ai04in.CoverLetterChatContext> };
  const states = new WeakMap<TurnSnapshot, State>();
  const stateFor = (snap: TurnSnapshot): State => {
    let st = states.get(snap);
    if (!st) {
      const loaded = loadDocumentInputs(snap.db, snap);
      const ctx = loaded.then((l) => ai04in.buildCoverLetterChatContext(toDocumentTurnInput(snap, l)));
      st = { loaded, ctx, latest: ctx };
      // A failed load is not cached (the next call may retry).
      ctx.catch(() => states.delete(snap));
      states.set(snap, st);
    }
    return st;
  };

  return {
    async plan(snapshot) {
      const plan = ai04.planCoverLetterTurn(await stateFor(snapshot).ctx);
      // reject_draft_limit is refused in prepareTurn before the message is saved; here it can only
      // come from a race (another tab's draft) — composeDecision answers it with the limit notice.
      const out: DocumentPlan = plan.kind === "reject_draft_limit" ? { kind: "compose", source: "requested_action" } : plan;
      return out;
    },
    async extract(call) {
      const ctx = await stateFor(call.snapshot).ctx;
      const result = await ai04.extract(ctx, { llm: call.llm, signal: call.signal, callKey: call.callKey, jobId: call.jobId, logger: opts.logger });
      return {
        skipped: result.skipped,
        patch: result.skipped || result.patch.ops.length === 0 ? null : result.patch,
        processedThroughSequence: result.processedThroughSequence,
        intent: result.intent,
        sensitiveAdded: result.sensitiveAdded,
      };
    },
    async decide(snapshot, after, plan) {
      const st = stateFor(snapshot);
      if (after.stored) {
        const loaded = await st.loaded;
        const through = after.processedThroughSequence ?? snapshot.chat.lastExtractedSequence;
        st.latest = Promise.resolve(ai04in.buildCoverLetterChatContext(toDocumentTurnInput(snapshot, loaded, { structuredDraft: after.stored, lastExtractedSequence: through })));
      }
      const ctx = await st.latest;
      const extracted = after.extracted ? { intent: after.extracted.intent } : null;
      const decision = ai04.composeDecision(ctx, plan, extracted);
      if (decision.action === "reply") return { action: "reply", notices: decision.notices };
      return { action: "compose", batch: decision.batch, slots: decision.batch.map((q) => q.slot) };
    },
    async *reply(call, notices) {
      const ctx = await stateFor(call.snapshot).latest;
      for await (const event of ai04.reply(ctx, { llm: call.llm, signal: call.signal, callKey: call.callKey }, notices as Ai04ReplyNotice[])) {
        if (event.type === "delta") yield { type: "delta", text: event.text };
        else if (event.type === "done") yield { type: "done" };
        else yield { type: "error", error: event.error };
      }
    },
    async *compose(call, decision) {
      const ctx = await stateFor(call.snapshot).latest;
      const batch = decision.batch as ai04in.CoverLetterQuestionContext[];
      const result = yield* ai04.compose(
        ctx,
        { llm: call.llm, signal: call.signal, callKey: call.callKey, adjustCallKey: `${call.callKey}.adjust_length`, jobId: call.jobId, logger: opts.logger },
        { batch },
      );
      return {
        outcome: result.outcome,
        patch: result.patch,
        questions: result.questions.map((q) => ({
          slot: q.slot,
          questionNo: q.questionNo,
          answerTitle: q.answerTitle,
          charCount: q.charCount,
          charLimit: q.charLimit,
          charAdjustNeeded: q.charAdjustNeeded,
          correctionApplied: q.correctionApplied,
          needsReviewBlockIds: q.needsReviewBlockIds,
          droppedBlockCount: q.droppedBlockCount,
        })),
        assistantMessage: result.assistantMessage,
      };
    },
  };
}
