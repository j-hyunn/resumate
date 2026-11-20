import { describe, expect, it } from "vitest";
import { CreateApplicationProjectInput, UpdateJdRawTextInput } from "@/lib/contracts/application";
import { toErrorBody } from "@/lib/contracts/errors";
import { splitJdSentences } from "@/server/ai/context-pack/jd";
import { sha256Hex } from "@/server/ai/hash";
import type { UserSupabaseClient } from "@/server/db/types";
import { fakeSupabase } from "@/test/fake-supabase";
import { normalizeJdRawText } from "./raw-text";
import { createApplicationProject, updateJdRawText } from "./write";

const ID = "00000000-0000-4000-8000-0000000000a1";
const JD = "00000000-0000-4000-8000-0000000000b1";
const RAW = "  백엔드 개발자를 찾습니다. 경력 3년 이상.\n";
const raised = (message: string) => Object.assign(new Error(message), { code: "P0001" });

describe("updateJdRawText (JR-7, DM 2.6.1)", () => {
  const ok = { application_project_id: ID, job_description_id: JD, raw_text_edited_at: "2026-11-02T00:00:00Z" };

  // A3 (R15): the edit path normalizes with `normalizeJdRawText` first, then splits and hashes
  // that one string — the same code the create path uses.
  it("calls update_jd_raw_text with the normalized text, the server's sentence split and hash of the same string", async () => {
    const db = fakeSupabase({}, () => ok);
    const normalized = normalizeJdRawText(RAW);
    const result = await updateJdRawText(db.client as UserSupabaseClient, { id: ID, rawText: RAW });
    expect(db.rpcCalls).toEqual([
      {
        name: "update_jd_raw_text",
        args: { p_application_project_id: ID, p_raw_text: normalized, p_raw_text_hash: sha256Hex(normalized), p_sentences: splitJdSentences(normalized) },
      },
    ]);
    expect(result).toEqual({ applicationProjectId: ID, jobDescriptionId: JD, rawTextEditedAt: "2026-11-02T00:00:00Z", warnings: ["short_jd"] });
  });

  it.each([
    ["jd_job_in_progress", 409],
    ["jd_raw_text_unchanged", 409],
    ["jd_no_sentences", 400],
  ])("%s → AppError %i under its own code", async (code, status) => {
    const db = fakeSupabase({}, () => {
      throw raised(code);
    });
    await expect(updateJdRawText(db.client as UserSupabaseClient, { id: ID, rawText: RAW })).rejects.toMatchObject({ code, status });
  });

  it("job_description_not_found → not_found 404", async () => {
    const db = fakeSupabase({}, () => {
      throw raised("job_description_not_found");
    });
    await expect(updateJdRawText(db.client as UserSupabaseClient, { id: ID, rawText: RAW })).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("a response without the ids is our bug", async () => {
    const db = fakeSupabase({}, () => ({}));
    await expect(updateJdRawText(db.client as UserSupabaseClient, { id: ID, rawText: RAW })).rejects.toMatchObject({ code: "internal_error" });
  });

  it("input rules match S-14: not blank, at most 50,000 characters, not trimmed", () => {
    expect(UpdateJdRawTextInput.safeParse({ id: ID, rawText: "   " }).success).toBe(false);
    expect(UpdateJdRawTextInput.safeParse({ id: ID, rawText: "x".repeat(50_001) }).success).toBe(false);
    expect(UpdateJdRawTextInput.safeParse({ id: "nope", rawText: "x" }).success).toBe(false);
    expect(UpdateJdRawTextInput.parse({ id: ID, rawText: RAW }).rawText).toBe(RAW);
  });
});

describe("createApplicationProject (R17: raw text only, no AI gate)", () => {
  it("sends the 9-arg RPC (no p_preview_job_id) and maps the 5-key result (4.24 #9)", async () => {
    const db = fakeSupabase({}, () => ({ application_project_id: ID, job_description_id: JD, name: "새 자기소개서 (2026-11-14)", name_source: "default", created: true }));
    const result = await createApplicationProject(db.client as UserSupabaseClient, CreateApplicationProjectInput.parse({ id: ID, rawText: RAW, companyName: "가나다" }));
    expect(Object.keys(db.rpcCalls[0]!.args).sort()).toEqual(["p_company_name", "p_id", "p_raw_text", "p_raw_text_hash", "p_sentences"]);
    expect(result).toEqual({
      applicationProjectId: ID,
      jobDescriptionId: JD,
      name: "새 자기소개서 (2026-11-14)",
      nameSource: "default",
      displayName: "새 자기소개서 (2026-11-14)",
      created: true,
      warnings: expect.any(Array),
    });
  });

  it("jd_no_sentences (400) keeps its own code (no row)", async () => {
    const db = fakeSupabase({}, () => {
      throw raised("jd_no_sentences");
    });
    await expect(createApplicationProject(db.client as UserSupabaseClient, CreateApplicationProjectInput.parse({ id: ID, rawText: "• • •" }))).rejects.toMatchObject({ code: "jd_no_sentences", status: 400 });
  });

  it("previewJobId is no longer part of the input", () => {
    const parsed = CreateApplicationProjectInput.parse({ id: ID, rawText: RAW, previewJobId: ID });
    expect(parsed).not.toHaveProperty("previewJobId");
  });
});

// ---------------- UQ-759 (R15 후속 4): the source URL ----------------

describe("createApplicationProject source URL (UQ-759)", () => {
  const created = { application_project_id: ID, job_description_id: JD, name: null, name_source: null, created: true };
  const parse = (sourceUrl: string) => CreateApplicationProjectInput.parse({ id: ID, rawText: RAW, sourceUrl });

  it.each([
    ["HTTPS://Example.com/Jobs/42/", "https://Example.com/Jobs/42/"],
    ["Http://jobs.example.test/a?b=1", "http://jobs.example.test/a?b=1"],
    ["https://example.com/%EC%A7%81%EB%AC%B4", "https://example.com/%EC%A7%81%EB%AC%B4"],
  ])("%s passes and only the scheme is lowercased → %s", async (typed, stored) => {
    const db = fakeSupabase({}, () => created);
    await createApplicationProject(db.client as UserSupabaseClient, parse(typed));
    // Host case, path, trailing slash, query and percent-encoding are kept as typed.
    expect(db.rpcCalls[0]!.args.p_source_url).toBe(stored);
  });

  it.each(["ftp://example.com/job", "javascript:alert(1)", "example.com/job", `https://example.com/${"a".repeat(2048)}`])(
    "%s → invalid_source_url (400) under its own code, before any RPC",
    async (bad) => {
      const db = fakeSupabase({}, () => created);
      // Not a zod failure: a zod refusal would become the generic `invalid_input`.
      const input = CreateApplicationProjectInput.safeParse({ id: ID, rawText: RAW, sourceUrl: bad });
      expect(input.success).toBe(true);
      await expect(createApplicationProject(db.client as UserSupabaseClient, input.data!)).rejects.toMatchObject({ code: "invalid_source_url", status: 400 });
      expect(db.rpcCalls).toHaveLength(0);
    },
  );

  it("the code survives the action boundary (toErrorBody keeps it — no alias to invalid_input)", async () => {
    const db = fakeSupabase({}, () => created);
    const err = await createApplicationProject(db.client as UserSupabaseClient, parse("ftp://example.com/job")).catch((e: unknown) => e);
    expect(toErrorBody(err)).toMatchObject({ code: "invalid_source_url" });
  });

  it("the RPC's own invalid_source_url raise is preserved too", async () => {
    const db = fakeSupabase({}, () => {
      throw raised("invalid_source_url");
    });
    await expect(createApplicationProject(db.client as UserSupabaseClient, parse("https://example.com/job"))).rejects.toMatchObject({ code: "invalid_source_url", status: 400 });
  });
});
