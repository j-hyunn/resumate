import { describe, expect, it } from "vitest";
import { UpdateFailedJdRawTextInput } from "@/lib/contracts/application";
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
    expect(result).toEqual({ applicationProjectId: ID, jobDescriptionId: JD, extractionStatus: "pending", rawTextEditedAt: "2026-11-02T00:00:00Z", aiRunAllowed: false, warnings: ["short_jd"] });
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

describe("createApplicationProject gate (Q53-1, DM 2.11.7 path 6)", () => {
  it.each(["key_invalid", "ai_consent_required"])("%s → 409, no result", async (code) => {
    const db = fakeSupabase({}, () => {
      throw raised(code);
    });
    await expect(createApplicationProject(db.client as UserSupabaseClient, { id: ID, rawText: RAW })).rejects.toMatchObject({ code, status: 409 });
  });
});
