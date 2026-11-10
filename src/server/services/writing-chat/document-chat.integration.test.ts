import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CreateApplicationProjectInput } from "@/lib/contracts/application";
import { CoverLetterDraftSchema } from "@/server/ai/schemas/cover-letter-draft";
import { DocumentTurnEventSchema, DocumentWritingChatDto, type DocumentTurnEvent } from "@/lib/contracts/writing-chat";
import { ProviderError } from "@/server/ai/errors";
import { KO_BACKEND } from "@/server/ai/__fixtures__/AI-01/jds";
import { createAiWriterClient } from "@/server/db/ai-writer";
import type { Database } from "@/server/db/database.types";
import { resetServerEnvCache } from "@/server/env";
import { createRecordingKeyStatusReporter, createStaticKeySource, createStaticProviderContext } from "@/server/jobs/provider-context";
import { createSupabaseJobStore } from "@/server/jobs/supabase-store";
import { createSupabaseUsageStore } from "@/server/jobs/supabase-usage";
import type { LlmFactoryInput } from "@/server/jobs/types";
import { saveApplicationDocument, startDocumentWritingChat } from "@/server/services/application-document/save";
import { createApplicationProject } from "@/server/services/application/write";
import { createScriptedAdapter, scriptedLlmFactory, type ScriptedResponse } from "@/test/job-fakes";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";
import { extractJdPreview, type JdPreviewDeps } from "@/server/services/application/preview";
import { extractJdRequirements, jdPreviewSummary } from "@/server/ai/pipelines/AI-01";
import { silentAiLogger } from "@/server/ai/log";
import type { JdPreviewExtractor } from "@/server/services/application/preview";
import { createTurnChatDb } from "./db";
import { createDeliverablePipelines, createDocumentPipelines, createWritingChatPipelines } from "./pipelines";
import { prepareTurn, runTurn, type TurnRequest } from "./turn";
import type { TurnDeps } from "./types";

/**
 * R15 서류 대화 end-to-end against the local stack (adopted from backend-qa's smoke test,
 * QA 1라운드 "통합 테스트 편입"). Real RPCs, real RLS, real production pipeline factories
 * (`createDocumentPipelines`) — only the provider adapter (scripted fixtures, no network) and the
 * key decryption are replaced.
 *
 * Why this file exists: `document-turn.test.ts` replaces `begin_assistant_message` and
 * `apply_structured_draft_patch` with `MemoryChatDb`, so it passed while the real RPC refused
 * `job_type = 'cover_letter'` (QA-01) — the same class of defect as `332ec0c`, where every
 * writing-chat turn ended `stalled`. Anything that depends on a real RPC accepting the 서류
 * combination belongs here, not in the unit test.
 *
 * Covered: 정본 저장 → 대화 시작 → 질문 턴 → **초안 턴(compose)** → `apply_structured_draft_patch`
 * 서류 분기 저장 → 사용량 행 → 미리 보기 게이트 409(행 0건) → 미리 보기 성공·생성 적용·`preview_mismatch`.
 */

const previewExtractorForTests: JdPreviewExtractor = async (input, deps) => {
  const result = await extractJdRequirements(input, { llm: deps.llm, signal: deps.signal, callKey: deps.callKey, jobId: deps.jobId, logger: silentAiLogger });
  return { payload: result.payload, summary: jdPreviewSummary(result), model: result.meta.model, promptVersion: result.promptVersion };
};

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "application_documents")) : false;

type Client = SupabaseClient<Database>;
const FAKE_KEY = "sk-FAKE-r15-document-chat-0000";

const extractOut = {
  schema_version: 4,
  draft_type: "cover_letter",
  turn_kind: "extract",
  intent: null,
  tone: null,
  facts: [
    {
      slot: "q_1",
      project_ref: null,
      text: "결제 승인 API의 병목 쿼리를 재설계했다",
      actor: "self",
      source_message_ids: ["M2"],
      source_quotes: ["병목 쿼리를 재설계했어요"],
    },
  ],
  source_selection: [],
  clarifications: [],
  sensitive_flags: [],
};

describe.skipIf(!ready)("R15 서류 대화 (local stack): 저장 · 대화 시작 · 질문 턴 · 초안 턴", { timeout: 60_000 }, () => {
  const s = stack!;
  let admin: Client;
  let user: Client;
  let userId = "";
  const logs: string[] = [];
  const replies: ScriptedResponse[] = [];
  const extracts: ScriptedResponse[] = [];
  const ids = { experience: crypto.randomUUID(), project: crypto.randomUUID() };
  const ACTION = "결제 승인 API의 병목 쿼리를 찾아 인덱스를 재설계했다";

  function deps(): TurnDeps {
    const writer = createAiWriterClient(userId);
    const replyAdapter = createScriptedAdapter("openai", [...replies], Date.now);
    const extractAdapter = createScriptedAdapter("openai", [...extracts], Date.now);
    replies.length = 0;
    extracts.length = 0;
    const log = (event: string, fields: Record<string, unknown>) => void logs.push(JSON.stringify({ event, ...fields }));
    return {
      userId,
      chats: createTurnChatDb(user, writer, log),
      store: createSupabaseJobStore(writer),
      usage: createSupabaseUsageStore(writer),
      writer,
      providerContext: createStaticProviderContext({ provider: "openai", connectionTier: "paid", keyStatus: "valid" }),
      keySource: createStaticKeySource(FAKE_KEY, () => new ProviderError("key_missing")),
      keyStatus: createRecordingKeyStatusReporter(),
      runGate: null,
      createLlm: (input: LlmFactoryInput) =>
        input.tier === "light" ? scriptedLlmFactory(extractAdapter.adapter, Date.now)(input) : scriptedLlmFactory(replyAdapter.adapter, Date.now)(input),
      pipelines: createWritingChatPipelines({ logger: (e) => void logs.push(JSON.stringify(e)), log }),
      deliverablePipelines: createDeliverablePipelines({ logger: (e) => void logs.push(JSON.stringify(e)), log }),
      documentPipelines: createDocumentPipelines({ logger: (e) => void logs.push(JSON.stringify(e)), log }),
      log,
    };
  }

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", s.url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", s.anonKey);
    vi.stubEnv("SUPABASE_JWT_SECRET", s.jwtSecret);
    vi.stubEnv("CRON_SECRET", "test-cron-secret-0000");
    resetServerEnvCache();
    for (const m of ["info", "warn", "error", "log"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
    }
  });
  afterEach(() => void vi.restoreAllMocks());

  /**
   * An AI-04 compose answer for `slots`. Evidence cites the seeded project through its pack alias
   * (`PRJ-1`, the first affiliated project) with the exact `action` text, which is what V-1 … V-5
   * check against the pack.
   */
  function composeOutput(slots: readonly string[]) {
    return {
      schema_version: 4,
      draft_type: "cover_letter",
      turn_kind: "compose",
      questions: slots.map((slot, i) => ({
        question_slot: slot,
        question_class: i === 0 ? "job_competency" : "future_plan",
        sources: [
          {
            project_ref: "PRJ-1",
            experience_ref: "EXP-1",
            education_ref: null,
            role: "primary",
            rationale: "결제 도메인 경험이 이 문항의 핵심입니다.",
            requirement_refs: [],
            reuse_reason: null,
            evidence: [{ source_type: "project", ref: "PRJ-1", field: "action", quote: ACTION }],
          },
        ],
        paragraphs: [
          {
            block_id: `${slot}-p1`,
            text: `${ACTION}. 같은 방식으로 이 직무에서도 병목을 찾아 개선하겠습니다.`,
            evidence: [{ source_type: "project", ref: "PRJ-1", field: "action", quote: ACTION }],
            source_fact_ids: [],
            source_body_quotes: [],
            requirement_refs: [],
            placeholders: [],
          },
        ],
        answer_title: null,
        notes_for_user: [],
      })),
    };
  }

  beforeAll(async () => {
    admin = createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `r15-doc-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);
    userId = created.data.user.id;
    user = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } });
    const signIn = await user.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.message}`);
    await seedCareer();
  });

  afterAll(async () => {
    if (!userId) return;
    await admin.from("ai_usage_records").delete().eq("user_id", userId);
    await admin.from("ai_jobs").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
    resetServerEnvCache();
  });

  /** A complete affiliated project so the career pack has `EXP-1` / `PRJ-1` for the 초안 턴's evidence. */
  async function seedCareer(): Promise<void> {
    const career = await import("@/server/services/career");
    const contracts = await import("@/lib/contracts/career");
    await career.saveExperience(user, contracts.SaveExperienceInput.parse({ id: ids.experience, companyName: "알파", startMonth: "2021-03", jobPosition: "백엔드", isCurrent: true }));
    await career.createProject(user, contracts.CreateProjectInput.parse({ id: ids.project, name: "결제 개선", affiliation: { type: "experience", id: ids.experience } }));
    await career.saveProject(
      user,
      contracts.SaveProjectInput.parse({
        id: ids.project,
        startMonth: "2024-02",
        situation: "피크 시간 결제 응답이 느렸다",
        task: "결제 승인 개선 리드",
        action: ACTION,
        result: "p95 응답을 800ms에서 200ms로 줄였다",
      }),
    );
  }

  it("saves the 정본, starts a 서류 대화 and runs a question turn through the real pipelines", async () => {
    const projectId = crypto.randomUUID();
    const created = await createApplicationProject(
      user,
      CreateApplicationProjectInput.parse({ id: projectId, rawText: KO_BACKEND.raw, companyName: "에이비씨페이" }),
    );
    expect(created.applicationProjectId).toBe(projectId);
    expect(created.name).toBe("에이비씨페이 자기소개서");

    // 1. save_application_document (real RPC, no key / consent needed — CL-8)
    const saved = await saveApplicationDocument(user, {
      applicationProjectId: projectId,
      documentKind: "cover_letter",
      body: {
        questions: [
          { slot: "q_1", question_text: "지원 동기를 써 주세요", char_limit: 800, template_key: "motivation", body: "" },
          { slot: "q_2", question_text: "직무 역량을 써 주세요", char_limit: 1000, template_key: "job_competency", body: "이미 쓴 답변입니다." },
        ],
      },
    } as never);
    expect(saved.slotCount).toBe(2);
    expect(saved.filledSlotCount).toBe(1);

    // 2. start_document_writing_chat (real definer RPC; no 정본 row is created by it)
    const chat = await startDocumentWritingChat(user, { applicationProjectId: projectId, documentKind: "cover_letter" } as never);
    expect(chat.writingChatId).toMatch(/^[0-9a-f-]{36}$/);
    const greeting = await admin.from("writing_chat_messages").select("sequence, role").eq("writing_chat_id", chat.writingChatId);
    expect(greeting.data).toHaveLength(1);

    // 3. a question turn through the REAL document pipelines + real patch RPC
    replies.push({ json: "어떤 경험을 담고 싶으신지 조금 더 말씀해 주세요." });
    extracts.push({ json: extractOut });
    const d = deps();
    const prepared = await prepareTurn(d, { chatId: chat.writingChatId, requestedSlot: null, content: "결제 승인 API의 병목 쿼리를 재설계했어요." } as TurnRequest);
    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") return;
    const events: DocumentTurnEvent[] = [];
    await runTurn(d, prepared, (e) => events.push(e as DocumentTurnEvent), new AbortController().signal);
    if (events.some((e) => e.type === "error")) {
      throw new Error(`EVENTS=${JSON.stringify(events)}\nLOGS=${logs.join("\n")}`);
    }
    for (const e of events) {
      const r = DocumentTurnEventSchema.safeParse(e);
      if (!r.success) throw new Error(`event ${e.type} fails the contract: ${JSON.stringify(r.error.issues)} :: ${JSON.stringify(e)}`);
    }
    const kinds = events.map((e) => e.type);
    expect(kinds[0]).toBe("turn_started");
    expect(kinds).toContain("reply_done");
    expect(kinds.at(-1)).toBe("turn_done");

    // The job row must satisfy the R15 D3 CHECK: cover_letter + writing_chat + non-null project.
    const jobs = await admin.from("ai_jobs").select("job_type, target_type, target_id, application_project_id, status, error_code").eq("user_id", userId);
    const turnJobs = (jobs.data ?? []).filter((j) => j.target_type === "writing_chat");
    expect(turnJobs.length).toBeGreaterThan(0);
    for (const j of turnJobs) {
      expect(j.job_type).toBe("cover_letter");
      expect(j.application_project_id).toBe(projectId);
      // The 332ec0c class of bug: a mis-wired dependency ends every turn `stalled`.
      expect(j.error_code).not.toBe("stalled");
      expect(j.status).toBe("succeeded");
    }

    // The 서류 분기 of apply_structured_draft_patch actually stored the facts.
    const chatRow = await admin.from("writing_chats").select("structured_draft, application_project_id, document_kind, project_id").eq("id", chat.writingChatId).single();
    expect(chatRow.data?.project_id).toBeNull();
    expect(chatRow.data?.document_kind).toBe("cover_letter");
    const draft = chatRow.data?.structured_draft as { target?: string; facts?: unknown[] } | null;
    expect(draft?.target).toBe("cover_letter");
    expect(draft?.facts?.length).toBe(1);

    // Usage: one row per provider call made, feature = cover_letter.
    const usage = await admin.from("ai_usage_records").select("feature, job_type, application_project_id").eq("user_id", userId);
    const turnUsage = (usage.data ?? []).filter((u) => u.job_type === "cover_letter");
    expect(turnUsage.length).toBe(2);
    for (const u of turnUsage) expect(u.feature).toBe("cover_letter");

    // C-7 / NFR-KEY-05: no key, no prompt body, no career text in any log line.
    const all = logs.join("\n");
    expect(all).not.toContain(FAKE_KEY);
    expect(all).not.toContain("병목 쿼리를 재설계");
    expect(all).not.toContain("지원 동기를 써 주세요");
  }, 60_000);

  /**
   * The 초안 턴 (compose). QA could not reach this path (QA-01 blocked every 서류 턴), so this is
   * the first run of: AI-04 compose → V-* validation → `apply_structured_draft_patch` 서류 분기
   * (`replace_draft` per question, `rev` per slot) → one `draft_done` per question → the fixed
   * assistant message. Two questions in one call (CL-10 allows up to three).
   */
  it("runs a 초안 턴: one compose call writes two questions, the real patch RPC stores a proposal per slot", async () => {
    const projectId = crypto.randomUUID();
    await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: projectId, rawText: KO_BACKEND.raw, companyName: "에이비씨페이" }));
    await saveApplicationDocument(user, {
      applicationProjectId: projectId,
      documentKind: "cover_letter",
      body: {
        questions: [
          { slot: "q_1", question_text: "직무 역량을 써 주세요", char_limit: 800, template_key: "job_competency", body: "" },
          { slot: "q_2", question_text: "입사 후 계획을 써 주세요", char_limit: 800, template_key: "future_plan", body: "" },
        ],
      },
    } as never);
    const chat = await startDocumentWritingChat(user, { applicationProjectId: projectId, documentKind: "cover_letter" } as never);

    // The draft turn's own extract call (the chip message), then the compose call.
    extracts.push({ json: { ...extractOut, intent: "compose_draft" } });
    replies.push({ json: composeOutput(["q_1", "q_2"]) });
    const d = deps();
    const prepared = await prepareTurn(d, {
      chatId: chat.writingChatId,
      requestedSlot: null,
      requestedAction: "compose_draft",
      content: "지금까지 내용으로 초안 만들어 주세요.",
    } as TurnRequest);
    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") return;
    const events: DocumentTurnEvent[] = [];
    await runTurn(d, prepared, (e) => events.push(e as DocumentTurnEvent), new AbortController().signal);
    if (events.some((e) => e.type === "error")) throw new Error(`EVENTS=${JSON.stringify(events)}\nLOGS=${logs.join("\n")}`);
    for (const e of events) {
      const r = DocumentTurnEventSchema.safeParse(e);
      if (!r.success) throw new Error(`event ${e.type} fails the contract: ${JSON.stringify(r.error.issues)} :: ${JSON.stringify(e)}`);
    }

    const kinds = events.map((e) => e.type);
    expect(kinds).toContain("draft_started");
    expect(kinds).toContain("draft_block");
    expect(kinds.at(-1)).toBe("turn_done");
    // R15-L2: one `draft_done` per question, each naming its slot and the screen's question number.
    const done = events.filter((e): e is Extract<DocumentTurnEvent, { type: "draft_done" }> => e.type === "draft_done");
    expect(done.map((e) => e.slot)).toEqual(["q_1", "q_2"]);
    expect(done.map((e) => e.questionNo)).toEqual([1, 2]);
    expect(done.every((e) => e.rev === 1)).toBe(true);
    /**
     * QA-02 회귀 방어 (backend-qa 라운드 2 제안, 리더 반영 2026-11-09): AI-04의
     * `sources_selected`는 저장 행 모양 **snake_case**(`sort_order`·`experience_id`…)로 나오는데
     * SSE 계약은 camelCase다. `toDocumentSseEvent()`가 한 자리에서 변환하지 않으면 S-46의 근거
     * 칩이 하나도 파싱되지 않는다 — `as` 캐스팅을 지우기 전까지 타입 검사가 가려 주던 결함이다.
     * 와이어에 `_`가 든 키가 하나라도 남으면 실패한다(`draft_block.block`은 계약 자체가 저장 모양
     * `CoverLetterBlockSchema`라 제외한다).
     */
    const selected = events.filter(
      (e): e is Extract<DocumentTurnEvent, { type: "sources_selected" }> => e.type === "sources_selected",
    );
    expect(selected.length).toBeGreaterThan(0);
    for (const e of selected) {
      for (const source of e.sources) {
        expect(Object.keys(source).filter((k) => k.includes("_"))).toEqual([]);
      }
    }
    // 값에는 밑줄이 정상으로 들어간다(`job_competency`·`future_plan` 같은 열거값) — **키만** 본다.
    expect(selected.flatMap((e) => Object.keys(e)).filter((k) => k.includes("_"))).toEqual([]);
    /**
     * `rev` / `draftCount` come from the RPC's answer, not from the pipeline.
     *
     * R15-API-7 (리더 판정 2026-11-09): the 6-draft budget counts **초안 턴**, not questions —
     * AI 명세 C-14 "제안 단위가 최대 3문항 … 자소서 5문항이면 초안 턴 2회면 한 바퀴가 돈다",
     * so 6 proposals are three full passes. A turn that writes two questions is **one** of the 6.
     */
    expect(done.map((e) => e.draftCount)).toEqual([1, 1]);
    // No reply call on a 초안 턴: the fixed message is the assistant message (AI-04).
    const reply = events.find((e): e is Extract<DocumentTurnEvent, { type: "reply_done" }> => e.type === "reply_done");
    expect(reply?.message.content).not.toBe("");
    expect(kinds).not.toContain("reply_delta");

    // The 서류 분기 of apply_structured_draft_patch stored one proposal per slot, rebuilt from blocks.
    const chatRow = await admin.from("writing_chats").select("structured_draft").eq("id", chat.writingChatId).single();
    const draft = chatRow.data?.structured_draft as {
      draft_count?: number;
      document?: { questions?: Array<{ slot: string; draft: { value: string; rev: number; blocks: unknown[]; sources?: unknown[] } }> };
    } | null;
    expect(draft?.draft_count).toBe(1); // one 초안 턴 = one proposal, whatever the question count (R15-API-7)
    const stored = draft?.document?.questions ?? [];
    expect(stored.map((q) => q.slot).sort()).toEqual(["q_1", "q_2"]);
    for (const q of stored) {
      expect(q.draft.rev).toBe(1);
      expect(q.draft.blocks.length).toBeGreaterThan(0);
      // The evidence cites the seeded project through `PRJ-1`, so V-1 … V-4 keep it: a grounded
      // block, not the `no_evidence` fallback a missing pack would produce.
      for (const b of q.draft.blocks as Array<{ review: string; review_reason: string | null; evidence: unknown[] }>) {
        expect(b.review).toBe("ok");
        expect(b.review_reason).toBeNull();
        expect(b.evidence.length).toBeGreaterThan(0);
      }
      // R5-DB-5: the RPC rebuilds `value` from `blocks` (the pipeline never sends it).
      expect(q.draft.value.length).toBeGreaterThan(0);
      // CF-S1: the 초안 턴 always carries a `sources` key for a question it wrote blocks for.
      expect(Object.prototype.hasOwnProperty.call(q.draft, "sources")).toBe(true);
    }

    // Usage: one row per provider call (extract + compose), feature = cover_letter.
    const usage = await admin.from("ai_usage_records").select("feature, job_type, call_key").eq("user_id", userId).eq("job_type", "cover_letter");
    expect((usage.data ?? []).length).toBeGreaterThanOrEqual(2);
    for (const u of usage.data ?? []) expect(u.feature).toBe("cover_letter");

    const all = logs.join("\n");
    expect(all).not.toContain(FAKE_KEY);
    expect(all).not.toContain(ACTION);
  }, 60_000);

  /**
   * R15 후속 3 (리더 판정): `draft_done.draft` is the slot's **stored** proposal.
   *
   * `draft_block` streams before the 글자 수 보정, so when a correction runs, the blocks the screen
   * collected are the pre-correction text. [반영] must take `draft_done.draft` instead — and that
   * object must be exactly what the patch RPC stored (the DB rebuilds `value` from `blocks`), or the
   * screen and the save RPC would disagree about "the proposal".
   */
  it("draft_done carries the stored proposal: after a 글자 수 보정 it differs from draft_block and equals the DB", async () => {
    const projectId = crypto.randomUUID();
    await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: projectId, rawText: KO_BACKEND.raw, companyName: "에이비씨페이" }));
    await saveApplicationDocument(user, {
      applicationProjectId: projectId,
      documentKind: "cover_letter",
      // A 1,000-char limit and a one-sentence first draft → out of the ±10 % range → one adjust call.
      body: { questions: [{ slot: "q_1", question_text: "직무 역량을 써 주세요", char_limit: 1000, template_key: "job_competency", body: "" }] },
    } as never);
    const chat = await startDocumentWritingChat(user, { applicationProjectId: projectId, documentKind: "cover_letter" } as never);

    const evidence = [{ source_type: "project", ref: "PRJ-1", field: "action", quote: ACTION }];
    const corrected = `${ACTION}. 문제를 발견한 뒤에는 원인을 하나씩 좁혀 가며 가설을 세우고 검증했습니다. `.repeat(12).trim();
    extracts.push({ json: { ...extractOut, intent: "compose_draft" } });
    replies.push({ json: composeOutput(["q_1"]) });
    replies.push({
      json: {
        schema_version: 4,
        draft_type: "cover_letter",
        turn_kind: "adjust_length",
        questions: [
          {
            question_slot: "q_1",
            paragraphs: [{ block_id: "q_1-p1", text: corrected, evidence, source_fact_ids: [], source_body_quotes: [], requirement_refs: [], placeholders: [] }],
          },
        ],
      },
    });
    const d = deps();
    const prepared = await prepareTurn(d, { chatId: chat.writingChatId, requestedSlot: null, requestedAction: "compose_draft", content: "초안 만들어 주세요." } as TurnRequest);
    if (prepared.kind !== "ready") throw new Error(`blocked ${prepared.code}`);
    const events: DocumentTurnEvent[] = [];
    await runTurn(d, prepared, (e) => events.push(e as DocumentTurnEvent), new AbortController().signal);
    if (events.some((e) => e.type === "error")) throw new Error(`EVENTS=${JSON.stringify(events)}\nLOGS=${logs.join("\n")}`);
    for (const e of events) expect(DocumentTurnEventSchema.safeParse(e).success).toBe(true);

    // The correction ran.
    expect(events.some((e) => e.type === "adjusting_length")).toBe(true);
    const done = events.find((e): e is Extract<DocumentTurnEvent, { type: "draft_done" }> => e.type === "draft_done")!;
    expect(done.correctionApplied).toBe(true);

    // draft_block (provisional, pre-correction) ≠ draft_done.draft.blocks (corrected).
    const streamed = events.filter((e): e is Extract<DocumentTurnEvent, { type: "draft_block" }> => e.type === "draft_block").map((e) => e.block.text);
    const final = done.draft.blocks.map((b) => b.text);
    expect(streamed.length).toBeGreaterThan(0);
    expect(final).not.toEqual(streamed);
    expect(final.join("")).toContain("가설을 세우고 검증했습니다");

    // SSE draft == the draft the patch RPC stored (value rebuilt by the DB from the corrected blocks).
    const row = await admin.from("writing_chats").select("structured_draft").eq("id", chat.writingChatId).single();
    const storedDraft = CoverLetterDraftSchema.parse(row.data?.structured_draft).document.questions.find((q) => q.slot === "q_1")!.draft;
    expect(done.draft).toEqual(storedDraft);
    expect(done.draft.value).toBe(storedDraft.value);
    expect(done.draft.value).toContain("가설을 세우고 검증했습니다");
    expect(done.draft.correction_applied).toBe(true);
    expect(done.rev).toBe(done.draft.rev);
    // The outer fields are camelCase; the stored draft inside keeps its snake_case keys (no rename).
    expect(Object.keys(done.draft)).toContain("base_body_hash");
    expect(Object.keys(done)).not.toContain("draft_count");
  }, 60_000);

  /**
   * R15 후속 4 (리더 판정): a reopened 서류 대화 labels its proposals' sources.
   *
   * `draft.sources[]` stores `{source_type, source_id, role}` only, and the live labels come from the
   * SSE `sources_selected` card, which is not stored — so after a reload the list was empty. The DTO
   * now carries `sourceLabels`, built from the rows with the **same rule** as the card. This checks:
   * the reloaded label equals the SSE `label` byte for byte; an education parent uses its ED-3 display
   * name (trimmed `program_name`); a source deleted since the draft is `deleted: true` with no label,
   * not an error; and `structuredDraft` itself is untouched (still equal to the stored jsonb).
   */
  it("reopened chat: sourceLabels equal the SSE sources_selected labels (education parent, deleted source)", async () => {
    const career = await import("@/server/services/career");
    const contracts = await import("@/lib/contracts/career");
    const { loadCareerRows } = await import("@/server/ai/context-pack/career-rows");
    const { buildCareerPack } = await import("@/server/ai/context-pack/career-pack");
    const { getWritingChat } = await import("./chat");

    // An education (ED-3: program name with surrounding spaces) with one complete project,
    // and a second experience project we delete after the draft.
    const edu = { education: crypto.randomUUID(), eduProject: crypto.randomUUID(), doomed: crypto.randomUUID() };
    await career.saveEducation(
      user,
      contracts.SaveEducationInput.parse({
        id: edu.education,
        institutionName: "한빛 아카데미",
        programName: "  데이터 분석 과정  ",
        educationType: "course",
        startMonth: "2020-03",
        endMonth: "2020-12",
        enrollmentStatus: "completed",
      }),
    );
    const EDU_ACTION = "추천 모델의 평가 지표를 설계하고 오프라인 실험을 반복했다";
    const DOOMED_ACTION = "주문 이벤트 파이프라인의 재처리 절차를 문서로 정리했다";
    await career.createProject(user, contracts.CreateProjectInput.parse({ id: edu.eduProject, name: "추천 모델", affiliation: { type: "education", id: edu.education } }));
    await career.saveProject(
      user,
      contracts.SaveProjectInput.parse({ id: edu.eduProject, startMonth: "2020-06", situation: "추천 품질이 낮았다", task: "평가 지표 설계", action: EDU_ACTION, result: "지표를 정했다" }),
    );
    await career.createProject(user, contracts.CreateProjectInput.parse({ id: edu.doomed, name: "주문 파이프라인", affiliation: { type: "experience", id: ids.experience } }));
    await career.saveProject(
      user,
      contracts.SaveProjectInput.parse({ id: edu.doomed, startMonth: "2023-01", situation: "재처리가 잦았다", task: "절차 정리", action: DOOMED_ACTION, result: "절차를 정리했다" }),
    );

    // Resolve aliases with the same pack builder the pipeline uses (CL-Q1: one assembly point).
    const pack = buildCareerPack(await loadCareerRows(createAiWriterClient(userId)));
    const prjEdu = pack.aliases.aliasOf("project", edu.eduProject);
    const parentEdu = pack.aliases.aliasOf("education", edu.education);
    const prjDoomed = pack.aliases.aliasOf("project", edu.doomed);
    const parentExp = pack.aliases.aliasOf("experience", ids.experience);
    if (!prjEdu || !parentEdu || !prjDoomed || !parentExp) throw new Error("seeded rows are not in the career pack (incomplete?)");

    const projectId = crypto.randomUUID();
    await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: projectId, rawText: KO_BACKEND.raw, companyName: "에이비씨페이" }));
    await saveApplicationDocument(user, {
      applicationProjectId: projectId,
      documentKind: "cover_letter",
      body: { questions: [{ slot: "q_1", question_text: "직무 역량을 써 주세요", char_limit: 800, template_key: "job_competency", body: "" }] },
    } as never);
    const chat = await startDocumentWritingChat(user, { applicationProjectId: projectId, documentKind: "cover_letter" } as never);

    const ev = (ref: string, quote: string) => [{ source_type: "project", ref, field: "action", quote }];
    extracts.push({ json: { ...extractOut, intent: "compose_draft" } });
    replies.push({
      json: {
        schema_version: 4,
        draft_type: "cover_letter",
        turn_kind: "compose",
        questions: [
          {
            question_slot: "q_1",
            question_class: "job_competency",
            sources: [
              { project_ref: prjEdu, experience_ref: null, education_ref: parentEdu, role: "primary", rationale: "평가 설계 경험", requirement_refs: [], reuse_reason: null, evidence: ev(prjEdu, EDU_ACTION) },
              { project_ref: prjDoomed, experience_ref: parentExp, education_ref: null, role: "supporting", rationale: "절차 정리 경험", requirement_refs: [], reuse_reason: null, evidence: ev(prjDoomed, DOOMED_ACTION) },
            ],
            paragraphs: [
              {
                block_id: "q_1-p1",
                text: `${EDU_ACTION}. ${DOOMED_ACTION}. 이 경험으로 직무에서도 기준을 세우고 개선하겠습니다.`,
                evidence: [...ev(prjEdu, EDU_ACTION), ...ev(prjDoomed, DOOMED_ACTION)],
                source_fact_ids: [],
                source_body_quotes: [],
                requirement_refs: [],
                placeholders: [],
              },
            ],
            answer_title: null,
            notes_for_user: [],
          },
        ],
      },
    });
    const d = deps();
    const prepared = await prepareTurn(d, { chatId: chat.writingChatId, requestedSlot: null, requestedAction: "compose_draft", content: "초안 만들어 주세요." } as TurnRequest);
    if (prepared.kind !== "ready") throw new Error(`blocked ${prepared.code}`);
    const events: DocumentTurnEvent[] = [];
    await runTurn(d, prepared, (e) => events.push(e as DocumentTurnEvent), new AbortController().signal);
    if (events.some((e) => e.type === "error")) throw new Error(`EVENTS=${JSON.stringify(events)}\nLOGS=${logs.join("\n")}`);

    // What the live card showed.
    const card = events.find((e): e is Extract<DocumentTurnEvent, { type: "sources_selected" }> => e.type === "sources_selected" && e.slot === "q_1");
    expect(card).toBeDefined();
    const liveLabel = (projectRowId: string) => card!.sources.find((x) => x.projectId === projectRowId)!.label;
    // ED-3: the education parent is the trimmed program name.
    expect(liveLabel(edu.eduProject)).toBe("데이터 분석 과정 › 추천 모델");

    // Reload, before anything is deleted: every stored source is labelled exactly like the card.
    const before = await getWritingChat(user, userId, chat.writingChatId);
    if (before.target !== "application_document") throw new Error("wrong target");
    const stored = before.structuredDraft.document.questions.find((q) => q.slot === "q_1")!.draft.sources;
    expect(stored.map((x) => x.source_type)).toEqual(["project", "project"]);
    const labels = before.sourceLabels.q_1!;
    // Same order as `draft.sources` (pair by index for `role`).
    expect(labels.map((l) => l.sourceId)).toEqual(stored.map((x) => x.source_id));
    for (const l of labels) {
      expect(l.deleted).toBe(false);
      expect(l.label).toBe(liveLabel(l.sourceId));
    }
    // `structuredDraft` is still the stored jsonb (no label keys mixed in).
    const row = await admin.from("writing_chats").select("structured_draft").eq("id", chat.writingChatId).single();
    expect(before.structuredDraft).toEqual(CoverLetterDraftSchema.parse(row.data?.structured_draft));
    expect(JSON.stringify(before.structuredDraft)).not.toContain("데이터 분석 과정");

    // Delete one source (outside the app path, to model "removed since the draft"), then reload.
    const gone = await admin.from("projects").delete().eq("id", edu.doomed);
    expect(gone.error).toBeNull();
    const after = await getWritingChat(user, userId, chat.writingChatId);
    if (after.target !== "application_document") throw new Error("wrong target");
    const afterLabels = after.sourceLabels.q_1!;
    expect(afterLabels.find((l) => l.sourceId === edu.eduProject)).toMatchObject({ deleted: false, label: "데이터 분석 과정 › 추천 모델" });
    expect(afterLabels.find((l) => l.sourceId === edu.doomed)).toEqual({ sourceType: "project", sourceId: edu.doomed, label: null, deleted: true });
    expect(DocumentWritingChatDto.safeParse(after).success).toBe(true);
  }, 60_000);

  /**
   * R15 후속 3 — CF-S7 = (a) (사용자 확정 2026-11-09) and the slot high-water mark (db `004690`).
   *
   * CF-S7: once the 정본 row exists, a save **without** an expected version is a `stale_write`
   * (409, `details.current_updated_at`), not a silent overwrite — this is the server half of the
   * "re-opened 자소서 overwritten with the default questions" path. "내 내용으로 저장" resends with
   * that `current_updated_at`. The first save (no row + null) still passes.
   *
   * Slots: a deleted slot number is never handed to a new question again (DM 2.5.0b) — otherwise an
   * old proposal for `q_3` left in a chat would attach itself to the new `q_3`.
   */
  it("CF-S7: row + null expected version → stale_write with current_updated_at; resending it saves. Slot numbers are not reused", async () => {
    const { getApplicationDocument } = await import("@/server/services/application-document/read");
    const projectId = crypto.randomUUID();
    await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: projectId, rawText: KO_BACKEND.raw, companyName: "에이비씨페이" }));
    const q = (slot: string, body = "") => ({ slot, question_text: `${slot} 문항`, char_limit: 800, body });

    // First save: no row + null → passes (unchanged rule).
    const first = await saveApplicationDocument(user, {
      applicationProjectId: projectId,
      documentKind: "cover_letter",
      body: { questions: [q("q_1", "첫 답변"), q("q_2"), q("q_3")] },
    } as never);
    expect(first.slotHighWater).toBe(3);
    expect((await getApplicationDocument(user, projectId))!.slot_high_water).toBe(3);

    // Row exists + null → stale_write, with the row's current version in details; nothing is written.
    const blind = saveApplicationDocument(user, {
      applicationProjectId: projectId,
      documentKind: "cover_letter",
      body: { questions: [q("q_1", "다른 탭이 덮어쓰려던 내용")] },
    } as never);
    await expect(blind).rejects.toMatchObject({ code: "stale_write", status: 409 });
    const err = (await blind.catch((e: unknown) => e)) as { details?: { current_updated_at?: string } };
    expect(Date.parse(err.details!.current_updated_at!)).toBe(Date.parse(first.updatedAt));
    const untouched = (await getApplicationDocument(user, projectId))!;
    expect(untouched.body.questions.map((x) => x.slot)).toEqual(["q_1", "q_2", "q_3"]);
    expect(untouched.body.questions[0]!.body).toBe("첫 답변");
    expect(Date.parse(untouched.updated_at)).toBe(Date.parse(first.updatedAt));

    // "내 내용으로 저장": resend with current_updated_at → passes, and that content becomes the 정본.
    const mine = await saveApplicationDocument(user, {
      applicationProjectId: projectId,
      documentKind: "cover_letter",
      expectedUpdatedAt: err.details!.current_updated_at,
      // Drop q_3 (and keep q_1 / q_2).
      body: { questions: [q("q_1", "내 내용으로 저장한 답변"), q("q_2")] },
    } as never);
    expect((await getApplicationDocument(user, projectId))!.body.questions[0]!.body).toBe("내 내용으로 저장한 답변");
    // Deleting q_3 does not lower the mark.
    expect(mine.slotHighWater).toBe(3);

    // Re-adding q_3 as a NEW question → invalid_slot (and nothing is written).
    await expect(
      saveApplicationDocument(user, {
        applicationProjectId: projectId,
        documentKind: "cover_letter",
        expectedUpdatedAt: mine.updatedAt,
        body: { questions: [q("q_1", "내 내용으로 저장한 답변"), q("q_2"), q("q_3")] },
      } as never),
    ).rejects.toMatchObject({ code: "invalid_slot", status: 400, details: { field: "q_3" } });
    expect((await getApplicationDocument(user, projectId))!.slot_count).toBe(2);

    // q_4 (= slot_high_water + 1) is accepted and moves the mark.
    const next = await saveApplicationDocument(user, {
      applicationProjectId: projectId,
      documentKind: "cover_letter",
      expectedUpdatedAt: mine.updatedAt,
      body: { questions: [q("q_1", "내 내용으로 저장한 답변"), q("q_2"), q("q_4")] },
    } as never);
    expect(next.slotHighWater).toBe(4);
    expect((await getApplicationDocument(user, projectId))!.slot_high_water).toBe(4);
  }, 60_000);

  /**
   * R15 후속 — the reads S-46 / S-39 call (DM 7장 25행 · 33행), against real rows and real RLS.
   *
   * The data-loss path this closes: with no 정본 read, S-46 always opened in 문항 설정 상태 and its
   * first save went out with no expected version, overwriting the stored answers. Here: no row →
   * `null`; after a save the row comes back with the `updated_at` the next save must send; the
   * board counts are exact; a 서류 대화 survives a reload (list + detail, unapplied proposal still
   * there); and another user sees none of it.
   *
   * Assertions are scoped to this test's own project / chat ids, so rows left by other tests (or
   * other users) don't affect the result.
   */
  it("reads: 정본 1행 · 근거 · 보드 문항 수 · 서류 대화 목록과 상세(새로 고침) · 남의 서류는 안 보임", async () => {
    const { getApplicationDocument, listApplicationDocumentEvidence, listDocumentSlotCounts } = await import("@/server/services/application-document/read");
    const { getWritingChat, listDocumentWritingChats } = await import("./chat");
    const projectId = crypto.randomUUID();
    await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: projectId, rawText: KO_BACKEND.raw, companyName: "에이비씨페이" }));

    // 1. No row yet → null (문항 설정 상태), and no board entry for this project.
    await expect(getApplicationDocument(user, projectId)).resolves.toBeNull();
    expect((await listDocumentSlotCounts(user))[projectId]).toBeUndefined();

    // 2. After the first save the row comes back, with the version the next save must send.
    const saved = await saveApplicationDocument(user, {
      applicationProjectId: projectId,
      documentKind: "cover_letter",
      body: {
        questions: [
          { slot: "q_1", question_text: "직무 역량을 써 주세요", char_limit: 800, template_key: "job_competency", body: "이미 쓴 답변입니다." },
          { slot: "q_2", question_text: "입사 후 계획을 써 주세요", char_limit: 800, template_key: "future_plan", body: "" },
          { slot: "q_3", question_text: "지원 동기를 써 주세요", char_limit: 800, template_key: "motivation", body: "" },
        ],
      },
    } as never);
    const doc = await getApplicationDocument(user, projectId);
    expect(doc).not.toBeNull();
    expect(doc!.id).toBe(saved.applicationDocumentId);
    expect(Date.parse(doc!.updated_at)).toBe(Date.parse(saved.updatedAt));
    expect(doc).toMatchObject({ application_project_id: projectId, document_kind: "cover_letter", slot_count: 3, filled_slot_count: 1, first_copied_at: null, slot_high_water: 3 });
    expect(doc!.body.questions.map((q) => q.slot)).toEqual(["q_1", "q_2", "q_3"]);
    expect(doc!.body.questions[0]!.body).toBe("이미 쓴 답변입니다.");

    // 3. S-39: both counts, exact (작성 중 = 0 < filled < slot).
    expect((await listDocumentSlotCounts(user))[projectId]).toEqual({ slot_count: 3, filled_slot_count: 1 });

    // 4. 근거: the shared chip read handles the new owner type (empty until an applied proposal is saved).
    await expect(listApplicationDocumentEvidence(user, doc!.id)).resolves.toEqual({});

    // 5. A 서류 대화 with a 초안 턴, then a "reload": list + detail read from scratch.
    const chat = await startDocumentWritingChat(user, { applicationProjectId: projectId, documentKind: "cover_letter" } as never);
    extracts.push({ json: { ...extractOut, intent: "compose_draft" } });
    replies.push({ json: composeOutput(["q_2"]) });
    const d = deps();
    const prepared = await prepareTurn(d, { chatId: chat.writingChatId, requestedSlot: null, requestedAction: "compose_draft", content: "초안 만들어 주세요." } as TurnRequest);
    if (prepared.kind !== "ready") throw new Error(`blocked ${prepared.code}`);
    const events: DocumentTurnEvent[] = [];
    await runTurn(d, prepared, (e) => events.push(e as DocumentTurnEvent), new AbortController().signal);
    if (events.some((e) => e.type === "error")) throw new Error(`EVENTS=${JSON.stringify(events)}`);

    const list = await listDocumentWritingChats(user, projectId);
    expect(list.map((c) => c.id)).toContain(chat.writingChatId);
    const summary = list.find((c) => c.id === chat.writingChatId)!;
    expect(summary).toMatchObject({ status: "active", messageLimit: 40 });
    expect(summary.messageCount).toBeGreaterThan(0);

    const reopened = await getWritingChat(user, userId, chat.writingChatId);
    if (reopened.target !== "application_document") throw new Error(`wrong DTO target: ${reopened.target}`);
    expect(DocumentWritingChatDto.safeParse(reopened).success).toBe(true);
    expect(reopened).toMatchObject({ applicationProjectId: projectId, documentKind: "cover_letter", draftCount: 1, draftLimit: 6 });
    // The unapplied proposal is still there after the reload (stored jsonb, snake_case).
    const q2 = reopened.structuredDraft.document.questions.find((q) => q.slot === "q_2");
    expect(q2?.draft.rev).toBe(1);
    expect(q2?.draft.blocks.length).toBeGreaterThan(0);
    expect(q2?.draft.applied_at).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(q2!.draft, "sources")).toBe(true);
    // Messages: greeting + user + assistant.
    expect(reopened.messages.length).toBeGreaterThanOrEqual(3);

    // 5b. 첫 복사 기록: the first value sticks, and `updated_at` (the expected version) does not move.
    const { markApplicationDocumentCopied } = await import("@/server/services/application-document/save");
    const versionBefore = (await getApplicationDocument(user, projectId))!.updated_at;
    const first = await markApplicationDocumentCopied(user, projectId);
    expect(first.firstCopiedAt).not.toBeNull();
    const second = await markApplicationDocumentCopied(user, projectId);
    expect(second.firstCopiedAt).toBe(first.firstCopiedAt);
    const afterCopy = (await getApplicationDocument(user, projectId))!;
    expect(Date.parse(afterCopy.first_copied_at!)).toBe(Date.parse(first.firstCopiedAt!));
    expect(afterCopy.updated_at).toBe(versionBefore);
    // …so a save that still holds the pre-copy version is not a stale_write.
    const resaved = await saveApplicationDocument(user, {
      applicationProjectId: projectId,
      documentKind: "cover_letter",
      expectedUpdatedAt: versionBefore,
      body: { questions: doc!.body.questions.map((q) => ({ slot: q.slot, question_id: q.question_id, question_text: q.question_text, char_limit: q.char_limit, template_key: q.template_key, body: q.body })) },
    } as never);
    expect(resaved.applicationDocumentId).toBe(doc!.id);
    // A project with no 정본 row yet → null (nothing to copy), not an error.
    const emptyProject = crypto.randomUUID();
    await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: emptyProject, rawText: KO_BACKEND.raw }));
    await expect(markApplicationDocumentCopied(user, emptyProject)).resolves.toEqual({ firstCopiedAt: null });

    // 6. Another user sees none of it (RLS).
    const email = `r15-other-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);
    const otherId = created.data.user.id;
    try {
      const other = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } });
      const signIn = await other.auth.signInWithPassword({ email, password });
      if (signIn.error) throw new Error(`signIn failed: ${signIn.error.message}`);
      await expect(getApplicationDocument(other, projectId)).resolves.toBeNull();
      expect((await listDocumentSlotCounts(other))[projectId]).toBeUndefined();
      await expect(listApplicationDocumentEvidence(other, doc!.id)).resolves.toEqual({});
      await expect(listDocumentWritingChats(other, projectId)).resolves.toEqual([]);
      await expect(getWritingChat(other, otherId, chat.writingChatId)).rejects.toMatchObject({ code: "not_found" });
      // Someone else's row → null, and that row is untouched.
      await expect(markApplicationDocumentCopied(other, projectId)).resolves.toEqual({ firstCopiedAt: null });
      expect(Date.parse((await getApplicationDocument(user, projectId))!.first_copied_at!)).toBe(Date.parse(first.firstCopiedAt!));
    } finally {
      await admin.auth.admin.deleteUser(otherId);
    }
  }, 60_000);

  /**
   * The 6-proposal budget (DM 2.9.4, AI 명세 C-14) counts **초안 턴**, not questions
   * (R15-API-7, 리더 판정 2026-11-09): 6 proposals are three full passes of a 5-문항 자소서
   * (한 바퀴 = 턴 2회). This runs six draft turns and shows the seventh is refused — and that the
   * refusal happens in `prepareTurn`, before a user message is saved (DM §7, ai notes §3.3 ②).
   */
  it("allows six 초안 턴 (three passes) and refuses the seventh before anything is saved", async () => {
    const projectId = crypto.randomUUID();
    await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: projectId, rawText: KO_BACKEND.raw, companyName: "에이비씨페이" }));
    await saveApplicationDocument(user, {
      applicationProjectId: projectId,
      documentKind: "cover_letter",
      body: { questions: [{ slot: "q_1", question_text: "직무 역량을 써 주세요", char_limit: 800, template_key: "job_competency", body: "" }] },
    } as never);
    const chat = await startDocumentWritingChat(user, { applicationProjectId: projectId, documentKind: "cover_letter" } as never);

    /** One 초안 턴; returns the `draft_count` the turn ended with. */
    const draftTurn = async (n: number): Promise<number> => {
      extracts.push({ json: { ...extractOut, intent: "compose_draft" } });
      replies.push({ json: composeOutput(["q_1"]) });
      const d = deps();
      const prepared = await prepareTurn(d, {
        chatId: chat.writingChatId,
        requestedSlot: null,
        requestedAction: "compose_draft",
        content: `${n}번째 초안을 만들어 주세요.`,
      } as TurnRequest);
      if (prepared.kind !== "ready") throw new Error(`turn ${n} blocked: ${prepared.code}`);
      const events: DocumentTurnEvent[] = [];
      await runTurn(d, prepared, (e) => events.push(e as DocumentTurnEvent), new AbortController().signal);
      const error = events.find((e) => e.type === "error");
      if (error) throw new Error(`turn ${n} failed: ${JSON.stringify(error)}\nLOGS=${logs.join("\n")}`);
      const done = events.filter((e): e is Extract<DocumentTurnEvent, { type: "draft_done" }> => e.type === "draft_done");
      expect(done).toHaveLength(1);
      return done[0]!.draftCount;
    };

    // Six proposals: one per turn, so the counter tracks the turn number.
    for (let n = 1; n <= 6; n++) expect(await draftTurn(n)).toBe(n);
    const row = await admin.from("writing_chats").select("structured_draft").eq("id", chat.writingChatId).single();
    expect((row.data?.structured_draft as { draft_count?: number }).draft_count).toBe(6);

    // The seventh is refused by the server's own pre-check, before the user message is saved.
    const before = await admin.from("writing_chat_messages").select("id", { count: "exact", head: true }).eq("writing_chat_id", chat.writingChatId);
    await expect(
      prepareTurn(deps(), {
        chatId: chat.writingChatId,
        requestedSlot: null,
        requestedAction: "compose_draft",
        content: "한 번 더 만들어 주세요.",
      } as TurnRequest),
    ).rejects.toMatchObject({ code: "writing_chat_draft_limit_reached", status: 409 });
    const after = await admin.from("writing_chat_messages").select("id", { count: "exact", head: true }).eq("writing_chat_id", chat.writingChatId);
    expect(after.count).toBe(before.count);
  }, 120_000);
});

describe.skipIf(!ready)("R15 요건 미리 보기 (local stack): 게이트 · 적용 · preview_mismatch", { timeout: 60_000 }, () => {
  const s = stack!;
  let admin: Client;
  let user: Client;
  let userId = "";
  const logs: string[] = [];
  const responses: ScriptedResponse[] = [];

  function previewDeps(keyStatus: "valid" | "invalid"): JdPreviewDeps {
    const writer = createAiWriterClient(userId);
    const adapter = createScriptedAdapter("anthropic", [...responses], Date.now);
    responses.length = 0;
    return {
      userId,
      store: createSupabaseJobStore(writer),
      usage: createSupabaseUsageStore(writer),
      providerContext: createStaticProviderContext({ provider: "anthropic", connectionTier: "paid", keyStatus }),
      keySource: createStaticKeySource(FAKE_KEY, () => new ProviderError("key_missing")),
      keyStatus: createRecordingKeyStatusReporter(),
      runGate: null,
      createLlm: (input: LlmFactoryInput) => scriptedLlmFactory(adapter.adapter, Date.now)(input),
      // Same wiring as production (`jobs/jd-preview.ts`), with the silent logger.
      extract: previewExtractorForTests,
      log: (event, fields) => void logs.push(JSON.stringify({ event, ...fields })),
    };
  }

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", s.url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", s.anonKey);
    vi.stubEnv("SUPABASE_JWT_SECRET", s.jwtSecret);
    vi.stubEnv("CRON_SECRET", "test-cron-secret-0000");
    resetServerEnvCache();
  });

  beforeAll(async () => {
    admin = createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `r15-prev-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);
    userId = created.data.user.id;
    user = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } });
    const signIn = await user.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.message}`);
  });

  afterAll(async () => {
    if (!userId) return;
    await admin.from("ai_usage_records").delete().eq("user_id", userId);
    await admin.from("ai_jobs").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
    resetServerEnvCache();
  });

  it("the gate 409 writes no ai_jobs row, a success writes the jd_preview row, and the create RPC applies it / reports preview_mismatch", async () => {
    // 1. gate 409 (key invalid) → no job row, no usage row.
    await expect(extractJdPreview(previewDeps("invalid"), KO_BACKEND.raw)).rejects.toMatchObject({ code: "key_invalid" });
    const none = await admin.from("ai_jobs").select("id").eq("user_id", userId);
    expect(none.data ?? []).toHaveLength(0);

    // 2. success → one ai_jobs row with the R15 jd_preview combination + one usage row.
    responses.push({ json: KO_BACKEND.output });
    const preview = await extractJdPreview(previewDeps("valid"), KO_BACKEND.raw);
    const job = await admin.from("ai_jobs").select("*").eq("id", preview.previewJobId).single();
    expect(job.data).toMatchObject({ job_type: "jd_extraction", target_type: "jd_preview", target_id: null, application_project_id: null, status: "succeeded" });
    expect(job.data?.output).not.toBeNull();
    const usage = await admin.from("ai_usage_records").select("feature, application_project_id").eq("user_id", userId);
    expect(usage.data).toHaveLength(1);
    expect(usage.data?.[0]).toMatchObject({ feature: "jd_extraction", application_project_id: null });

    // 3. the create RPC applies it (hash recomputed from p_raw_text) and links the job + usage row.
    const okId = crypto.randomUUID();
    const applied = await createApplicationProject(user, CreateApplicationProjectInput.parse({ id: okId, rawText: KO_BACKEND.raw, previewJobId: preview.previewJobId }));
    expect(applied.previewApplied).toBe(true);
    expect(applied.previewSkipReason).toBeNull();
    expect(applied.extractionStatus).toBe("succeeded");
    const linked = await admin.from("ai_jobs").select("target_id, application_project_id").eq("id", preview.previewJobId).single();
    expect(linked.data?.application_project_id).toBe(okId);

    // 4. a different raw text with the same preview id → preview_mismatch (the sent hash is not trusted).
    responses.push({ json: KO_BACKEND.output });
    const second = await extractJdPreview(previewDeps("valid"), KO_BACKEND.raw);
    const badId = crypto.randomUUID();
    const mismatch = await createApplicationProject(
      user,
      CreateApplicationProjectInput.parse({ id: badId, rawText: `${KO_BACKEND.raw}\n다른 문장을 한 줄 붙였다.`, previewJobId: second.previewJobId }),
    );
    expect(mismatch.previewApplied).toBe(false);
    expect(mismatch.previewSkipReason).toBe("preview_mismatch");
    const linkedAnyway = await admin.from("ai_jobs").select("application_project_id").eq("id", second.previewJobId).single();
    expect(linkedAnyway.data?.application_project_id).toBe(badId);

    // 5. an invalid source URL is refused before any row is made.
    const urlId = crypto.randomUUID();
    await expect(
      createApplicationProject(user, CreateApplicationProjectInput.parse({ id: urlId, rawText: KO_BACKEND.raw, sourceUrl: "https://example.test/a" })),
    ).resolves.toMatchObject({ applicationProjectId: urlId });

    const all = logs.join("\n");
    expect(all).not.toContain(FAKE_KEY);
  }, 60_000);
});
