import { describe, expect, it } from "vitest";
import { CreateApplicationProjectInput, UpdateFailedJdRawTextInput } from "@/lib/contracts/application";
import { toErrorBody } from "@/lib/contracts/errors";
import { splitJdSentences } from "@/server/ai/context-pack/jd";
import { sha256Hex } from "@/server/ai/hash";
import type { UserSupabaseClient } from "@/server/db/types";
import { fakeSupabase } from "@/test/fake-supabase";
import { normalizeJdRawText } from "./raw-text";
import { createApplicationProject, updateFailedJdRawText } from "./write";

const ID = "00000000-0000-4000-8000-0000000000a1";
const JD = "00000000-0000-4000-8000-0000000000b1";
const RAW = "  백엔드 개발자를 찾습니다. 경력 3년 이상.\n";
const raised = (message: string) => Object.assign(new Error(message), { code: "P0001" });

describe("updateFailedJdRawText (Q53-2, DM 2.6.1)", () => {
  const ok = { application_project_id: ID, job_description_id: JD, extraction_status: "pending", raw_text_edited_at: "2026-11-02T00:00:00Z", ai_run_allowed: false };

  // A3 (R15): the edit path normalizes with `normalizeJdRawText` first, then splits and hashes
  // that one string — the same code the create path and the preview route use.
  it("sends the normalized text with the server's sentence split and hash of the same string", async () => {
    const db = fakeSupabase({}, () => ok);
    const normalized = normalizeJdRawText(RAW);
    const result = await updateFailedJdRawText(db.client as UserSupabaseClient, { id: ID, rawText: RAW });
    expect(db.rpcCalls).toEqual([
      {
        name: "update_failed_jd_raw_text",
        args: { p_application_project_id: ID, p_raw_text: normalized, p_raw_text_hash: sha256Hex(normalized), p_sentences: splitJdSentences(normalized) },
      },
    ]);
    expect(result).toEqual({ applicationProjectId: ID, jobDescriptionId: JD, rawTextEditedAt: "2026-11-02T00:00:00Z", aiRunAllowed: false, warnings: ["short_jd"] });
  });

  it("reports ai_run_allowed but never starts anything", async () => {
    const db = fakeSupabase({}, () => ({ ...ok, ai_run_allowed: true }));
    await expect(updateFailedJdRawText(db.client as UserSupabaseClient, { id: ID, rawText: RAW })).resolves.toMatchObject({ aiRunAllowed: true });
    expect(db.rpcCalls).toHaveLength(1);
  });

  it.each(["jd_job_in_progress", "jd_raw_text_locked", "jd_failure_not_input", "jd_has_results", "jd_raw_text_unchanged"])("%s → AppError 409", async (code) => {
    const db = fakeSupabase({}, () => {
      throw raised(code);
    });
    await expect(updateFailedJdRawText(db.client as UserSupabaseClient, { id: ID, rawText: RAW })).rejects.toMatchObject({ code, status: 409 });
  });

  it("a response without the ids is our bug", async () => {
    const db = fakeSupabase({}, () => ({}));
    await expect(updateFailedJdRawText(db.client as UserSupabaseClient, { id: ID, rawText: RAW })).rejects.toMatchObject({ code: "internal_error" });
  });

  it("input rules match S-14: not blank, at most 50,000 characters, not trimmed", () => {
    expect(UpdateFailedJdRawTextInput.safeParse({ id: ID, rawText: "   " }).success).toBe(false);
    expect(UpdateFailedJdRawTextInput.safeParse({ id: ID, rawText: "x".repeat(50_001) }).success).toBe(false);
    expect(UpdateFailedJdRawTextInput.safeParse({ id: "nope", rawText: "x" }).success).toBe(false);
    expect(UpdateFailedJdRawTextInput.parse({ id: ID, rawText: RAW }).rawText).toBe(RAW);
  });
});

describe("createApplicationProject (R17: raw text only, no AI gate)", () => {
  it("sends the 9-arg RPC (no p_preview_job_id) and returns no extraction / preview fields", async () => {
    const db = fakeSupabase({}, () => ({ application_project_id: ID, job_description_id: JD, name: "새 자기소개서 (2026-11-14)", name_source: "default", ai_run_allowed: true, created: true }));
    const result = await createApplicationProject(db.client as UserSupabaseClient, CreateApplicationProjectInput.parse({ id: ID, rawText: RAW, companyName: "가나다" }));
    expect(Object.keys(db.rpcCalls[0]!.args).sort()).toEqual(["p_company_name", "p_id", "p_raw_text", "p_raw_text_hash", "p_sentences"]);
    expect(result).toEqual({
      applicationProjectId: ID,
      jobDescriptionId: JD,
      name: "새 자기소개서 (2026-11-14)",
      nameSource: "default",
      displayName: "새 자기소개서 (2026-11-14)",
      aiRunAllowed: true,
      created: true,
      warnings: expect.any(Array),
    });
  });

  it("previewJobId is no longer part of the input", () => {
    const parsed = CreateApplicationProjectInput.parse({ id: ID, rawText: RAW, previewJobId: ID });
    expect(parsed).not.toHaveProperty("previewJobId");
  });
});

// ---------------- UQ-759 (R15 후속 4): the source URL ----------------

describe("createApplicationProject source URL (UQ-759)", () => {
  const created = { application_project_id: ID, job_description_id: JD, name: null, name_source: null, ai_run_allowed: false, created: true };
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
