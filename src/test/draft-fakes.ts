import type { AiProvider } from "@/lib/contracts/enums";
import { ProviderError } from "@/server/ai/errors";
import type { Llm, LlmRequest } from "@/server/ai/llm";
import type { AiWriterSupabaseClient, UserSupabaseClient } from "@/server/db/types";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext, type ProviderContext } from "@/server/jobs/provider-context";
import type { LlmFactoryInput } from "@/server/jobs/types";
import type { EnsureJdResult } from "@/server/services/application/extraction";
import { createDraftStore } from "@/server/services/drafts/db";
import type { DraftAiDeps, DraftPipelines, PipelineStreamEvent, StreamDeps } from "@/server/services/drafts/types";
import { fakeSupabase, type FakeDb } from "./fake-supabase";
import { MemoryJobStore, MemoryUsageStore, createScriptedAdapter, fakeClock, scriptedLlmFactory, type ScriptedResponse } from "./job-fakes";

/**
 * S7 draft service test kit: fake Supabase tables/RPCs (user and writer share
 * one fake), real createLlm over a scripted adapter (one usage record per
 * provider call, real C-11 errors), and small fake pipelines that call the
 * Llm the same way the real ones do (complete for AI-11; stream → block events
 * → persist → validated → done for AI-03 / AI-04).
 */

export const USER = "00000000-0000-4000-8000-000000000001";
export const AP = "00000000-0000-4000-8000-0000000000a1";
export const JD = "00000000-0000-4000-8000-0000000000d1";
export const EXP = "00000000-0000-4000-8000-0000000000e1";
export const PRJ1 = "00000000-0000-4000-8000-0000000000b1";
export const PRJ2 = "00000000-0000-4000-8000-0000000000b2";
export const REQ = "00000000-0000-4000-8000-0000000000f1";
export const KEY = "sk-test-draft-secret-0001";
export const PAID: ProviderContext = { provider: "anthropic", connectionTier: "paid", keyStatus: "valid" };
export const FREE: ProviderContext = { provider: "gemini", connectionTier: "free", keyStatus: "valid" };

const req = (callKey: string): LlmRequest => ({ feature: "test", promptVersion: "p1", callKey, systemBlocks: [], userBlocks: [], outputSchema: null });

/** A pipeline error event as the structured stream emits it. */
function errorEvent(err: unknown, emitted: boolean): PipelineStreamEvent {
  const e = err instanceof ProviderError ? err : null;
  return {
    type: "error",
    code: e ? e.code : "internal_error",
    message: "x",
    retryable: e ? e.retryable && e.beforeFirstToken && !emitted : true,
    retryAfter: e?.retryAfter?.toISOString() ?? null,
    quotaResetsAt: e?.quotaResetsAt?.toISOString() ?? null,
  };
}

/** Streams a scripted call; json = { blocks: [{ block_id, text }] } (+ sources for AI-04). */
async function* fakeStream(kind: "career" | "cover", llm: Llm, deps: StreamDeps & { adjustCallKey?: string }, seen: Seen): AsyncGenerator<PipelineStreamEvent> {
  let text = "";
  let emitted = false;
  for await (const chunk of llm.stream(req(deps.callKey))) {
    if (chunk.type === "error") {
      yield errorEvent(chunk.error, emitted);
      return;
    }
    if (chunk.type === "delta") {
      text += chunk.text;
      continue;
    }
    break;
  }
  const json = JSON.parse(text) as { blocks: Array<{ block_id: string; text: string }>; sources?: unknown[]; adjust?: boolean };
  if (kind === "cover") {
    emitted = true;
    yield { type: "sources_selected", selectionMode: "ai", questionClass: "motivation", sources: json.sources ?? [] };
  }
  for (const b of json.blocks) {
    emitted = true;
    yield { type: "block_started", blockId: b.block_id, path: "x" };
    yield { type: "block_delta", blockId: b.block_id, text: b.text };
    yield { type: "block_completed", blockId: b.block_id, block: { ...b, block_kind: kind === "cover" ? "paragraph" : "bullet", evidence: [] } };
  }
  if (kind === "cover" && json.adjust) {
    yield { type: "adjusting_length", charCount: 2000, charLimit: 1000, countBasis: "with_spaces", reasons: ["length"] };
    // The adjustment is a second provider call (same meter); its failure keeps the first text.
    try {
      await llm.complete(req(deps.adjustCallKey ?? "cover_letter.adjust"));
    } catch {
      seen.adjustFailed++;
    }
  }
  const payload = { blocks: json.blocks, hashes: { input_hash: "pipeline", career_snapshot_hash: "c1" } };
  try {
    await deps.persist(payload);
  } catch {
    yield { type: "error", code: "internal_error", message: "x", retryable: true, retryAfter: null, quotaResetsAt: null };
    return;
  }
  seen.persisted.push(payload);
  yield { type: "validated", result: { blocks: json.blocks }, validationReport: {} };
  yield { type: "done", meta: { promptVersion: "p1", model: "m-test", resultId: null } };
}

export type Seen = { persisted: unknown[]; adjustFailed: number; contexts: unknown[] };

export function fakeDraftPipelines(seen: Seen): DraftPipelines {
  return {
    ranking: {
      tier: "light",
      promptVersion: "ai-11.test",
      buildContext: () => ({ careerSnapshotHash: "c1", requirementsHash: "r1" }),
      inputHash: (p) => `rank|${p.provider}|${p.careerSnapshotHash}|${p.requirementsHash}`,
      async rank(_ctx, deps) {
        const r = await deps.llm.complete(req(deps.callKey));
        const json = JSON.parse(r.text) as { include: string[] };
        const ranking = json.include.map((id) => ({ project_id: id, relevance: "high" as const, include: true, requirement_ids: [REQ], reason: "r" }));
        return {
          includedProjectIds: json.include,
          projectOrder: json.include,
          includedExperienceIds: [EXP],
          includedEducationIds: [],
          ranking,
          output: { rankings: ranking },
          promptVersion: "ai-11.test",
          model: r.model,
        };
      },
      fromOutput(output) {
        const rankings = (output as { rankings?: Array<{ project_id: string; include: boolean }> }).rankings;
        if (!rankings) return null;
        const inc = rankings.filter((r) => r.include).map((r) => r.project_id);
        return {
          includedProjectIds: inc,
          projectOrder: inc,
          includedExperienceIds: [EXP],
          includedEducationIds: [],
          ranking: rankings.map((r) => ({ project_id: r.project_id, relevance: "high", include: r.include, requirement_ids: [], reason: "r" })),
        };
      },
      fromInsight: (priorities) => ({
        includedProjectIds: priorities.map((p) => p.project_id),
        projectOrder: priorities.map((p) => p.project_id),
        includedExperienceIds: [EXP],
        includedEducationIds: [],
      }),
      fallback: () => ({ includedProjectIds: [PRJ1, PRJ2], projectOrder: [PRJ1, PRJ2], includedExperienceIds: [EXP], includedEducationIds: [] }),
    },
    careerDescription: {
      tier: "default",
      promptVersion: "ai-03.test",
      plan: ({ options }) => ({
        options,
        sections: options.included_experience_ids.map((id, i) => ({
          sort_order: i,
          section_kind: "experience" as const,
          experience_id: id,
          education_id: null,
          heading: "회사",
          project_ids: options.included_project_ids,
        })),
        truncatedProjectIds: [],
      }),
      buildContext: (input) => {
        seen.contexts.push(input);
        return { careerSnapshotHash: "c1", requirementsHash: "r1" };
      },
      inputHash: (p) => `cd|${p.provider}|${p.model}|${p.options.included_project_ids.join(",")}|${p.options.tone}`,
      stream: (_input, deps) => fakeStream("career", deps.llm, deps, seen),
    },
    coverLetter: {
      tier: "default",
      promptVersion: "ai-04.test",
      buildContext: (input) => {
        seen.contexts.push(input);
        return { careerSnapshotHash: "c1", requirementsHash: "r1" };
      },
      inputHash: (p) => `cl|${p.provider}|${p.question.question_text}|${p.mode}`,
      stream: (_input, deps) => fakeStream("cover", deps.llm, deps, seen),
    },
  };
}

export type DraftKit = ReturnType<typeof draftKit>;

export function draftKit(opts: {
  tables?: Record<string, Array<Record<string, unknown>>>;
  rpc?: (name: string, args: Record<string, unknown>) => unknown;
  context?: ProviderContext | null;
  responses?: ScriptedResponse[];
  provider?: AiProvider;
  ensureJd?: (id: string) => Promise<EnsureJdResult>;
  readiness?: boolean;
  gate?: DraftAiDeps["runGate"];
}) {
  const clock = fakeClock();
  const store = new MemoryJobStore(clock.now);
  const usage = new MemoryUsageStore(USER);
  const keyStatus = createRecordingKeyStatusReporter();
  const context = opts.context === undefined ? PAID : opts.context;
  const adapter = createScriptedAdapter(context?.provider ?? "anthropic", opts.responses ?? [], clock.ms);
  const llmFactory = scriptedLlmFactory(adapter.adapter, clock.ms);
  const db: FakeDb = fakeSupabase(opts.tables ?? {}, opts.rpc);
  const seen: Seen = { persisted: [], adjustFailed: 0, contexts: [] };
  const ensureCalls: string[] = [];
  const sleeps: number[] = [];
  const deps: DraftAiDeps = {
    userId: USER,
    user: db.client as UserSupabaseClient,
    writer: db.client as AiWriterSupabaseClient,
    store,
    usage,
    providerContext: createStaticProviderContext(context),
    keySource: createStaticKeySource(KEY, () => new ProviderError("key_missing")),
    keyStatus,
    runGate: opts.gate ?? null,
    createLlm: (input: LlmFactoryInput) => llmFactory(input),
    drafts: createDraftStore(db.client as AiWriterSupabaseClient),
    pipelines: fakeDraftPipelines(seen),
    ensureJd: async (id) => {
      ensureCalls.push(id);
      if (opts.ensureJd) return opts.ensureJd(id);
      return { status: "already_extracted" };
    },
    loadCareerRows: async () => ({ profile: null, experiences: [], educations: [], projects: [{ id: PRJ1 } as never, { id: PRJ2 } as never], projectDetails: [], achievements: [], skills: [], projectSkills: [] }),
    getReadiness: async () =>
      ({
        features: {
          draft: opts.readiness === false ? { ready: false, missing: ["experience"], data_sufficiency: "none" } : { ready: true, data_sufficiency: "ok" },
        },
      }) as never,
    now: clock.now,
    // Waits move the fake clock (C-12 spacing, inline retry waits) and are recorded.
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
    },
  };
  return { clock, store, usage, keyStatus, adapter, db, seen, deps, ensureCalls, sleeps };
}

/** Base rows: project, JD (extracted), one requirement. */
export function baseTables(extra: Record<string, Array<Record<string, unknown>>> = {}): Record<string, Array<Record<string, unknown>>> {
  return {
    application_projects: [{ id: AP }],
    job_descriptions: [
      { id: JD, application_project_id: AP, updated_at: "2026-10-01T00:00:00Z", extraction_status: "succeeded", extraction_job_id: null, sentences: [], position_title: "백엔드", extraction: { other_sids: ["S1"] } },
    ],
    jd_requirements: [{ id: REQ, job_description_id: JD, category: "required", content: "API", importance: "high", source_sids: [], sort_order: 0, updated_at: "2026-10-01T00:00:00Z" }],
    insights: [],
    ai_jobs: [],
    drafts: [],
    draft_sections: [],
    draft_section_sources: [],
    evidence_links: [],
    ...extra,
  };
}
