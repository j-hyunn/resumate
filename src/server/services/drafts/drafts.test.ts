import { describe, expect, it } from "vitest";
import { DraftStreamEventSchema, type DraftStreamEvent } from "@/lib/contracts/draft";
import { AppError } from "@/lib/contracts/errors";
import { resolveModel } from "@/server/ai/providers/models";
import { normalizeErrorEvent } from "@/server/sse";
import { AP, EXP, FREE, JD, KEY, PRJ1, PRJ2, baseTables, draftKit } from "@/test/draft-fakes";
import { USAGE_SETTLE_WORST_MS } from "@/server/jobs/constants";
import { REQUEST_BUDGET_MS, prepareCareerDescription, runCareerDescription } from "./career-description";
import { prepareCoverLetterSection, runCoverLetterSection } from "./cover-letter";
import { rankDraftSourcesForProject } from "./ranking";

/**
 * S7 AI paths (S7 plan "계약 — API" 1–3, 6): ranking's three sources + the
 * R1 A23 failure answer (empty, selectionOrigin user); R1 A13 (no extraction
 * inside generation); AI-03 / AI-04 SSE event order, persist → complete, failure →
 * fail RPC + job failed, retry only before the first event, the client gone
 * mid-stream (the run still saves), and one usage record per provider call.
 */

const DRAFT = "00000000-0000-4000-8000-0000000000c1";
const SEC = "00000000-0000-4000-8000-0000000000c2";
const SEC2 = "00000000-0000-4000-8000-0000000000c3";

const draftRpc = (calls: string[], opts: { completeApplied?: boolean } = {}) => (name: string, args: Record<string, unknown>) => {
  calls.push(name);
  switch (name) {
    case "begin_career_description":
      return { draft_id: DRAFT, reopened: false, sections: [{ section_id: SEC, sort_order: 0, section_kind: "experience", experience_id: EXP, education_id: null, heading: "회사" }] };
    case "complete_career_description":
    case "complete_cover_letter_section":
      return opts.completeApplied === false ? { applied: false, reason: "stale_run" } : { applied: true };
    case "fail_career_description":
    case "fail_draft_section":
      return true;
    case "begin_cover_letter_section":
      return { section_id: args.p_section_id, draft_id: DRAFT, generation_no: 0, source_selection_mode: "ai", reopened: false };
    default:
      throw new Error(`unexpected rpc ${name}`);
  }
};

const cdInput = { includedExperienceIds: [EXP], includedEducationIds: [], includedProjectIds: [PRJ1], projectOrder: [PRJ1], selectionOrigin: "user" as const };
const blocks = (n: number) => ({ blocks: Array.from({ length: n }, (_, i) => ({ block_id: `b${i + 1}`, text: `불릿 ${i + 1}` })) });

/** What the client would see on the wire (error events normalized like createSseResponse does). */
function collect() {
  const events: DraftStreamEvent[] = [];
  return { events, emit: (e: unknown) => events.push(normalizeErrorEvent(e as { type: string }) as DraftStreamEvent) };
}
const types = (events: DraftStreamEvent[]) => events.map((e) => e.type);

describe("draft-source-ranking (AI-11, sync)", () => {
  it("422 without the readiness minimum, before any AI", async () => {
    const k = draftKit({ tables: baseTables(), readiness: false });
    const out = await rankDraftSourcesForProject(k.deps, AP, { refresh: false });
    expect(out.kind).toBe("insufficient_data");
    expect(k.store.jobs.size).toBe(0);
  });

  it("(1) latest insight → its priorities, no call", async () => {
    const tables = baseTables({ insights: [{ id: "ins-1", application_project_id: AP, is_latest: true, status: "ready", result: { strategy: { project_priorities: [{ project_id: PRJ2, rank: 1 }] } } }] });
    const k = draftKit({ tables });
    const out = await rankDraftSourcesForProject(k.deps, AP, { refresh: false });
    expect(out).toMatchObject({ kind: "ok", data: { selectionOrigin: "insight", insightId: "ins-1", includedProjectIds: [PRJ2], failed: false, reason: null } });
    expect(k.store.jobs.size).toBe(0);
    expect(k.usage.records).toHaveLength(0);
  });

  it("(2) same hash already ranked → reuse ai_jobs.output, no call", async () => {
    const tables = baseTables({
      ai_jobs: [{ id: "job-old", application_project_id: AP, job_type: "draft_source_ranking", provider: "anthropic", input_hash: "rank|anthropic|c1|r1", status: "succeeded", finished_at: "2026-10-27T00:00:00Z", output: { rankings: [{ project_id: PRJ1, include: true }] } }],
    });
    const k = draftKit({ tables });
    const out = await rankDraftSourcesForProject(k.deps, AP, { refresh: false });
    expect(out).toMatchObject({ kind: "ok", data: { selectionOrigin: "ai_ranking", failed: false, reused: true, jobId: "job-old", includedProjectIds: [PRJ1] } });
    expect(k.usage.records).toHaveLength(0);
  });

  it("(3) AI-11 call → ai_ranking, job succeeded, one usage record (meter career_description)", async () => {
    const k = draftKit({ tables: baseTables(), responses: [{ json: { include: [PRJ2, PRJ1] } }] });
    const out = await rankDraftSourcesForProject(k.deps, AP, { refresh: false });
    expect(out).toMatchObject({ kind: "ok", data: { selectionOrigin: "ai_ranking", failed: false, reused: false, includedProjectIds: [PRJ2, PRJ1] } });
    const job = [...k.store.jobs.values()][0]!;
    expect(job).toMatchObject({ jobType: "draft_source_ranking", targetType: "application_project", targetId: AP, status: "succeeded", modelTier: "light" });
    expect(k.usage.records).toHaveLength(1);
    expect(k.usage.records[0]).toMatchObject({ feature: "career_description", jobType: "draft_source_ranking" });
    expect(k.keyStatus.successes).toHaveLength(1);
  });

  const EMPTY = { includedExperienceIds: [], includedEducationIds: [], includedProjectIds: [], projectOrder: [], ranking: null };

  it("A23: AI-11 failure → no substitute selection (empty, selectionOrigin user, no error), job failed, every call recorded", async () => {
    const k = draftKit({ tables: baseTables(), responses: [{ error: "schema_invalid" }, { error: "schema_invalid" }] });
    const out = await rankDraftSourcesForProject(k.deps, AP, { refresh: false });
    expect(out).toEqual({ kind: "ok", data: { selectionOrigin: "user", failed: true, reason: "schema_invalid", reused: false, insightId: null, jobId: expect.any(String), ...EMPTY } });
    expect([...k.store.jobs.values()][0]).toMatchObject({ status: "failed", errorCode: "schema_invalid" });
    expect(k.usage.records).toHaveLength(2); // first try + one immediate retry (C-11.3)
  });

  it("no key → failed answer without a job; key_invalid on the call marks the key", async () => {
    const none = draftKit({ tables: baseTables(), context: null });
    expect(await rankDraftSourcesForProject(none.deps, AP, { refresh: false })).toMatchObject({ data: { selectionOrigin: "user", failed: true, reason: "key_missing", ...EMPTY } });
    expect(none.store.jobs.size).toBe(0);

    const bad = draftKit({ tables: baseTables(), responses: [{ error: "key_invalid" }] });
    expect(await rankDraftSourcesForProject(bad.deps, AP, { refresh: false })).toMatchObject({ data: { selectionOrigin: "user", failed: true, reason: "key_invalid", ...EMPTY } });
    expect(bad.keyStatus.invalidated).toHaveLength(1);
  });

  it("A13: a JD without requirements is never extracted here → failed answer, no job, no provider call", async () => {
    for (const [status, reason] of [["pending", "jd_not_extracted"], ["failed", "jd_not_extracted"], ["running", "extraction_in_progress"]] as const) {
      const tables = baseTables();
      tables.job_descriptions![0]!.extraction_status = status;
      const k = draftKit({ tables, responses: [{ json: { include: [PRJ1] } }] });
      const out = await rankDraftSourcesForProject(k.deps, AP, { refresh: false });
      expect(out).toMatchObject({ kind: "ok", data: { selectionOrigin: "user", failed: true, reason, ...EMPTY } });
      expect(k.store.jobs.size).toBe(0);
      expect(k.usage.records).toHaveLength(0);
      expect(k.adapter.calls).toHaveLength(0);
    }
  });

  it("A23: AI-11 picks no project → failed answer (empty), not a substitute", async () => {
    const k = draftKit({ tables: baseTables(), responses: [{ json: { include: [] } }] });
    const out = await rankDraftSourcesForProject(k.deps, AP, { refresh: false });
    expect(out).toMatchObject({ kind: "ok", data: { selectionOrigin: "user", failed: true, reason: "no_rankable_projects", ...EMPTY } });
  });
});

describe("career description (AI-03, SSE)", () => {
  it("streams block events → validated → done, persists through complete_career_description, completes the job", async () => {
    const calls: string[] = [];
    const k = draftKit({ tables: baseTables(), rpc: draftRpc(calls), responses: [{ json: blocks(2) }] });
    const prepared = await prepareCareerDescription(k.deps, AP, { ...cdInput, tone: "concise" });
    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") return;
    const { events, emit } = collect();
    await runCareerDescription(k.deps, prepared, emit);

    for (const e of events) expect(DraftStreamEventSchema.safeParse(e).success).toBe(true);
    expect(types(events)).toEqual([
      "generation_started",
      "block_started",
      "block_delta",
      "block_completed",
      "block_started",
      "block_delta",
      "block_completed",
      "validated",
      "done",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "done", draftId: DRAFT, reused: false });
    expect(calls).toEqual(["begin_career_description", "complete_career_description"]);
    const job = [...k.store.jobs.values()][0]!;
    expect(job).toMatchObject({ jobType: "career_description", targetType: "draft", status: "succeeded" });
    // The draft id is the job target (db notes: the api makes the UUID first).
    expect(k.db.rpcCalls[0]!.args).toMatchObject({ p_ai_job_id: job.id, p_options: expect.objectContaining({ tone: "concise", selection_origin: "user" }) });
    const completeArgs = k.db.rpcCalls[1]!.args as { p_payload: { hashes: { input_hash: string } } };
    expect(completeArgs.p_payload.hashes.input_hash).toMatch(/^cd\|anthropic\|/);
    expect(k.usage.records).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  it("422 on an empty plan, 409 while the JD is extracted elsewhere / not extracted (A13); no key → blocked (one SSE error)", async () => {
    const k = draftKit({ tables: baseTables() });
    await expect(prepareCareerDescription(k.deps, AP, { ...cdInput, includedExperienceIds: [] })).rejects.toMatchObject({ code: "empty_selection", status: 422 });

    const running = baseTables();
    running.job_descriptions![0]!.extraction_status = "running";
    await expect(prepareCareerDescription(draftKit({ tables: running }).deps, AP, cdInput)).rejects.toMatchObject({ code: "extraction_in_progress" });

    for (const status of ["pending", "failed"]) {
      const t = baseTables();
      t.job_descriptions![0]!.extraction_status = status;
      const kk = draftKit({ tables: t, responses: [{ json: blocks(1) }] });
      await expect(prepareCareerDescription(kk.deps, AP, cdInput)).rejects.toMatchObject({ code: "jd_not_extracted", status: 409 });
      expect(kk.store.jobs.size).toBe(0);
      expect(kk.adapter.calls).toHaveLength(0);
    }

    const none = draftKit({ tables: baseTables(), context: null });
    expect(await prepareCareerDescription(none.deps, AP, cdInput)).toEqual({ kind: "blocked", code: "key_missing" });
  });

  it("C-6 reuse: an identical ready draft → done(reused) without a call; regenerate skips it", async () => {
    const tables = baseTables({
      drafts: [{ id: "old-draft", application_project_id: AP, draft_type: "career_description", status: "ready", input_hash: `cd|anthropic|${resolveModel("anthropic", "default")}|${PRJ1}|null`, created_at: "2026-10-01" }],
    });
    const k = draftKit({ tables });
    const prepared = await prepareCareerDescription(k.deps, AP, cdInput);
    if (prepared.kind !== "ready") throw new Error("not ready");
    expect(prepared.reusedDraftId).toBe("old-draft");
    const { events, emit } = collect();
    await runCareerDescription(k.deps, prepared, emit);
    expect(events).toEqual([expect.objectContaining({ type: "done", draftId: "old-draft", reused: true })]);
    expect(k.usage.records).toHaveLength(0);
    expect(k.store.jobs.size).toBe(0);
    // QA-S7-08: an unknown / foreign original → 404 before any job.
    await expect(prepareCareerDescription(k.deps, AP, { ...cdInput, regeneratedFromId: "00000000-0000-4000-8000-00000000aaaa" })).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(k.store.jobs.size).toBe(0);
    const regen = await prepareCareerDescription(k.deps, AP, { ...cdInput, regeneratedFromId: "old-draft" });
    expect(regen.kind === "ready" && regen.reusedDraftId).toBe(null);
    if (regen.kind === "ready") {
      await regen.run!.fail({ code: "canceled", retryAfter: null, quotaResetsAt: null });
      await regen.run!.close();
    }
  });

  it("error before the first event is retried once (timeout policy); after a block it is not", async () => {
    const calls: string[] = [];
    const k = draftKit({ tables: baseTables(), rpc: draftRpc(calls), responses: [{ error: "provider_unavailable" }, { json: blocks(1) }] });
    const prepared = await prepareCareerDescription(k.deps, AP, cdInput);
    if (prepared.kind !== "ready") throw new Error("not ready");
    const { events, emit } = collect();
    await runCareerDescription(k.deps, prepared, emit);
    expect(events.at(-1)?.type).toBe("done");
    expect(k.usage.records).toHaveLength(2); // the failed call is recorded too (C-13)
  });

  it("provider failure → fail_career_description + job failed (retry_after) + one error event", async () => {
    const calls: string[] = [];
    const k = draftKit({ tables: baseTables(), rpc: draftRpc(calls), responses: [{ error: "rate_limited", retryAfterMs: 90_000 }] });
    const prepared = await prepareCareerDescription(k.deps, AP, cdInput);
    if (prepared.kind !== "ready") throw new Error("not ready");
    const { events, emit } = collect();
    await runCareerDescription(k.deps, prepared, emit);
    expect(types(events)).toEqual(["generation_started", "error"]);
    expect(events.at(-1)).toMatchObject({ code: "rate_limited", category: "provider_limit", retryable: true });
    expect((events.at(-1) as { retryAfter: string | null }).retryAfter).not.toBeNull();
    expect(calls).toEqual(["begin_career_description", "fail_career_description"]);
    expect([...k.store.jobs.values()][0]).toMatchObject({ status: "failed", errorCode: "rate_limited" });
    expect(k.keyStatus.failures).toEqual([expect.objectContaining({ cause: "rate_limited" })]);
  });

  it("stale run at persist → error, job not completed", async () => {
    const calls: string[] = [];
    const k = draftKit({ tables: baseTables(), rpc: draftRpc(calls, { completeApplied: false }), responses: [{ json: blocks(1) }] });
    const prepared = await prepareCareerDescription(k.deps, AP, cdInput);
    if (prepared.kind !== "ready") throw new Error("not ready");
    const { events, emit } = collect();
    await runCareerDescription(k.deps, prepared, emit);
    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect([...k.store.jobs.values()][0]!.status).not.toBe("succeeded");
  });

  it("QA-S7-01: one career description in flight per project → 409 career_description_in_progress with its job id", async () => {
    const k = draftKit({ tables: baseTables(), rpc: draftRpc([]) });
    const first = await prepareCareerDescription(k.deps, AP, cdInput);
    if (first.kind !== "ready") throw new Error("not ready");
    const firstJobId = first.run!.job.id;
    // The fake user-session table mirrors the in-flight row the DB would show.
    k.db.tables.ai_jobs!.push({ id: firstJobId, application_project_id: AP, job_type: "career_description", status: "running" });
    const err = await prepareCareerDescription(k.deps, AP, cdInput).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "career_description_in_progress", status: 409, details: { jobId: firstJobId } });
    expect(k.store.jobs.size).toBe(1);
    // A dead invocation (no heartbeat for 75 s+) is closed and replaced.
    k.clock.advance(80_000);
    const again = await prepareCareerDescription(k.deps, AP, cdInput);
    expect(again.kind).toBe("ready");
    expect(k.store.jobs.get(firstJobId)).toMatchObject({ status: "failed", errorCode: "stalled" });
    for (const p of [first, again]) {
      if (p.kind === "ready") {
        await p.run!.fail({ code: "canceled", retryAfter: null, quotaResetsAt: null });
        await p.run!.close();
      }
    }
  });

  it("QA-S7-09: complete says stale_run (reset / deleted meanwhile) → canceled, not a system error", async () => {
    const k = draftKit({ tables: baseTables(), rpc: draftRpc([], { completeApplied: false }), responses: [{ json: blocks(1) }] });
    const prepared = await prepareCareerDescription(k.deps, AP, cdInput);
    if (prepared.kind !== "ready") throw new Error("not ready");
    const { events, emit } = collect();
    await runCareerDescription(k.deps, prepared, emit);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "canceled" });
    expect([...k.store.jobs.values()][0]).toMatchObject({ status: "canceled" });
  });

  it("client gone mid-stream (emit throws): the run still saves and completes", async () => {
    const calls: string[] = [];
    const k = draftKit({ tables: baseTables(), rpc: draftRpc(calls), responses: [{ json: blocks(3) }] });
    const prepared = await prepareCareerDescription(k.deps, AP, cdInput);
    if (prepared.kind !== "ready") throw new Error("not ready");
    let n = 0;
    await runCareerDescription(k.deps, prepared, () => {
      if (++n > 2) throw new Error("stream closed");
    });
    expect(calls).toContain("complete_career_description");
    expect([...k.store.jobs.values()][0]!.status).toBe("succeeded");
  });

  it("A13: generation gets the whole budget (no extraction inside the request)", async () => {
    const k = draftKit({ tables: baseTables(), rpc: draftRpc([]) });
    const prepared = await prepareCareerDescription(k.deps, AP, cdInput);
    if (prepared.kind !== "ready") throw new Error("not ready");
    expect(prepared.run!.remaining()).toBeGreaterThanOrEqual(REQUEST_BUDGET_MS - USAGE_SETTLE_WORST_MS);
  });
});

describe("cover letter question (AI-04, SSE)", () => {
  const coverTables = (mode: "ai" | "user" = "ai") =>
    baseTables({
      drafts: [{ id: DRAFT, application_project_id: AP, draft_type: "cover_letter", status: "composing" }],
      draft_sections: [
        { id: SEC, draft_id: DRAFT, section_kind: "cover_letter_question", status: "pending", question_text: "지원 동기", template_key: "motivation", char_limit: 1000, count_basis: "with_spaces", user_note: null, source_selection_mode: mode, updated_at: "2026-10-01", sort_order: 0 },
        { id: SEC2, draft_id: DRAFT, section_kind: "cover_letter_question", status: "ready", question_text: "직무 역량", template_key: "job_competency", char_limit: 1000, count_basis: "with_spaces", user_note: null, source_selection_mode: "ai", updated_at: "2026-10-01", sort_order: 1 },
      ],
      draft_section_sources: [
        { draft_section_id: SEC2, experience_id: EXP, education_id: null, project_id: PRJ2, project_detail_ids: [], role: "primary", origin: "ai", sort_order: 0, source_deleted_at: null },
        { draft_section_id: SEC, experience_id: EXP, education_id: null, project_id: PRJ1, project_detail_ids: [], role: "primary", origin: "user", sort_order: 0, source_deleted_at: null },
      ],
    });

  it("sources_selected → paragraphs → adjusting_length → validated → done; two calls recorded; other question's primary project passed", async () => {
    const calls: string[] = [];
    const k = draftKit({ tables: coverTables(), rpc: draftRpc(calls), responses: [{ json: { ...blocks(2), adjust: true, sources: [] } }, { json: { ok: true } }] });
    const prepared = await prepareCoverLetterSection(k.deps, SEC);
    if (prepared.kind !== "ready") throw new Error("not ready");
    const { events, emit } = collect();
    await runCoverLetterSection(k.deps, prepared, emit);
    for (const e of events) expect(DraftStreamEventSchema.safeParse(e).success).toBe(true);
    expect(types(events)).toEqual([
      "generation_started",
      "sources_selected",
      "block_started",
      "block_delta",
      "block_completed",
      "block_started",
      "block_delta",
      "block_completed",
      "adjusting_length",
      "validated",
      "done",
    ]);
    expect(events[1]).toMatchObject({ sectionId: SEC });
    expect(events.at(-1)).toMatchObject({ draftId: DRAFT, sectionId: SEC });
    expect(calls).toEqual(["begin_cover_letter_section", "complete_cover_letter_section"]);
    expect(k.usage.records.map((r) => r.callKey)).toEqual(["cover_letter.generate", "cover_letter.adjust"]);
    expect(k.usage.records.every((r) => r.feature === "cover_letter")).toBe(true);
    const ctx = k.seen.contexts[0] as { mode: string; userSources: unknown[]; otherSections: Array<{ primary_project_ids: string[] }>; companySids: string[] };
    expect(ctx.mode).toBe("ai");
    expect(ctx.userSources).toEqual([]);
    expect(ctx.otherSections).toEqual([{ question_text: "직무 역량", primary_project_ids: [PRJ2] }]);
    expect(ctx.companySids).toEqual(["S1"]);
    expect([...k.store.jobs.values()][0]).toMatchObject({ jobType: "cover_letter", targetType: "draft_section", targetId: SEC, status: "succeeded" });
  });

  it("user mode: the user's source rows go to the pipeline", async () => {
    const k = draftKit({ tables: coverTables("user"), rpc: draftRpc([]), responses: [{ json: blocks(1) }] });
    const prepared = await prepareCoverLetterSection(k.deps, SEC);
    if (prepared.kind !== "ready") throw new Error("not ready");
    await runCoverLetterSection(k.deps, prepared, () => {});
    const ctx = k.seen.contexts[0] as { mode: string; userSources: Array<{ project_id: string }> };
    expect(ctx.mode).toBe("user");
    expect(ctx.userSources.map((s) => s.project_id)).toEqual([PRJ1]);
  });

  it("one generation per question: a second request while one runs → 409 section_in_progress", async () => {
    const k = draftKit({ tables: coverTables(), rpc: draftRpc([]) });
    const first = await prepareCoverLetterSection(k.deps, SEC);
    expect(first.kind).toBe("ready");
    await expect(prepareCoverLetterSection(k.deps, SEC)).rejects.toMatchObject({ code: "section_in_progress", status: 409 });
    if (first.kind === "ready") {
      await first.run.fail({ code: "canceled", retryAfter: null, quotaResetsAt: null });
      await first.run.close();
    }
  });

  it("failure after the first event: no retry, fail_draft_section, job failed", async () => {
    const calls: string[] = [];
    const k = draftKit({ tables: coverTables(), rpc: draftRpc(calls), responses: [{ errorAfterChunks: "provider_unavailable", json: blocks(1), chunks: 3 }] });
    const prepared = await prepareCoverLetterSection(k.deps, SEC);
    if (prepared.kind !== "ready") throw new Error("not ready");
    const { events, emit } = collect();
    await runCoverLetterSection(k.deps, prepared, emit);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "provider_unavailable" });
    expect(calls).toEqual(["begin_cover_letter_section", "fail_draft_section"]);
    expect(k.usage.records).toHaveLength(1);
  });

  it("not a question / not found → 404; readiness → 422; run gate refusal → blocked", async () => {
    const k = draftKit({ tables: coverTables() });
    await expect(prepareCoverLetterSection(k.deps, "00000000-0000-4000-8000-00000000ffff")).rejects.toBeInstanceOf(AppError);
    expect((await prepareCoverLetterSection(draftKit({ tables: coverTables(), readiness: false }).deps, SEC)).kind).toBe("insufficient_data");
    const gated = draftKit({ tables: coverTables(), gate: async () => "key_missing" });
    expect(await prepareCoverLetterSection(gated.deps, SEC)).toEqual({ kind: "blocked", code: "key_missing" });
    expect([...gated.store.jobs.values()][0]).toMatchObject({ status: "failed", errorCode: "key_missing" });
  });

  it("A13: a JD without requirements → 409 jd_not_extracted before any job or provider call", async () => {
    for (const [status, code] of [["pending", "jd_not_extracted"], ["failed", "jd_not_extracted"], ["running", "extraction_in_progress"]] as const) {
      const tables = coverTables();
      tables.job_descriptions![0]!.extraction_status = status;
      const k = draftKit({ tables, rpc: draftRpc([]), responses: [{ json: blocks(1) }] });
      await expect(prepareCoverLetterSection(k.deps, SEC)).rejects.toMatchObject({ code, status: 409 });
      expect(k.store.jobs.size).toBe(0);
      expect(k.adapter.calls).toHaveLength(0);
    }
    void JD;
  });

  it("QA-S7-03: free tier keeps 6 s between calls — generate → adjust, and across consecutive question requests", async () => {
    const k = draftKit({
      tables: coverTables(),
      context: FREE,
      rpc: draftRpc([]),
      responses: [{ json: { ...blocks(1), adjust: true } }, { json: { ok: true } }, { json: blocks(1) }],
    });
    const first = await prepareCoverLetterSection(k.deps, SEC);
    if (first.kind !== "ready") throw new Error("not ready");
    await runCoverLetterSection(k.deps, first, () => {});
    // No earlier call → no wait; generate → adjust waits the full spacing.
    expect(k.sleeps).toEqual([6_000]);
    expect(k.usage.records.map((r) => r.callKey)).toEqual(["cover_letter.generate", "cover_letter.adjust"]);

    // "전체 생성": the next question right after waits from the persisted last call.
    k.clock.advance(2_000);
    const second = await prepareCoverLetterSection(k.deps, SEC2);
    if (second.kind !== "ready") throw new Error("not ready");
    await runCoverLetterSection(k.deps, second, () => {});
    expect(k.sleeps).toEqual([6_000, 4_000]);
  });

  it("QA-S7-03: paid tier never waits", async () => {
    const k = draftKit({ tables: coverTables(), rpc: draftRpc([]), responses: [{ json: { ...blocks(1), adjust: true } }, { json: { ok: true } }] });
    const p = await prepareCoverLetterSection(k.deps, SEC);
    if (p.kind !== "ready") throw new Error("not ready");
    await runCoverLetterSection(k.deps, p, () => {});
    expect(k.sleeps).toEqual([]);
  });
});
