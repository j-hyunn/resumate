import { describe, expect, it, vi } from "vitest";
import { DeleteAccountInput } from "@/lib/contracts/account";
import { AppError } from "@/lib/contracts/errors";
import type { UserSupabaseClient } from "@/server/db/types";
import { fakeSupabase } from "@/test/fake-supabase";
import { computeSubjectHash, deleteAccount, toAccountDeletionSummary, type DeleteAccountDeps } from "./index";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SECRET = "test-account-deletion-secret-0123456789abcdefghij";

const RAW_SUMMARY = {
  career: { experiences: 2, educations: 1, projects: 3, project_details: 5, achievements: 4, skills: 6, writing_chats: 2 },
  applications: { application_projects: 1, insights: 1, drafts: 2, interview_sessions: 1, application_stage_events: 3 },
  ai_connection: { provider_keys: 1, ai_data_use_consents: 2, usage_records: 9, has_provider_keys: true },
};

describe("toAccountDeletionSummary (DM §4.3, S-25)", () => {
  it("maps the RPC groups and sets the NFR-KEY-09 hint when keys exist", () => {
    const s = toAccountDeletionSummary(RAW_SUMMARY);
    expect(s.career).toEqual({ experiences: 2, educations: 1, projects: 3, projectDetails: 5, achievements: 4, skills: 6, writingChats: 2 });
    expect(s.applications).toEqual({ applicationProjects: 1, insights: 1, drafts: 2, interviewSessions: 1, stageEvents: 3 });
    expect(s.aiConnection).toEqual({ providerKeys: 1, dataUseConsents: 2, usageRecords: 9 });
    expect(s.recommendProviderKeyRevocation).toBe(true);
  });

  it("no hint without keys", () => {
    const raw = { ...RAW_SUMMARY, ai_connection: { provider_keys: 0, ai_data_use_consents: 0, usage_records: 0, has_provider_keys: false } };
    expect(toAccountDeletionSummary(raw).recommendProviderKeyRevocation).toBe(false);
  });

  it("rejects a malformed payload as internal_error", () => {
    expect(() => toAccountDeletionSummary(null)).toThrow(AppError);
    expect(() => toAccountDeletionSummary({ career: RAW_SUMMARY.career })).toThrow(AppError);
    expect(() => toAccountDeletionSummary({ ...RAW_SUMMARY, career: { ...RAW_SUMMARY.career, skills: -1 } })).toThrow(AppError);
  });
});

describe("DeleteAccountInput", () => {
  it("needs confirm: true", () => {
    expect(DeleteAccountInput.safeParse({ confirm: true }).success).toBe(true);
    expect(DeleteAccountInput.safeParse({ confirm: false }).success).toBe(false);
    expect(DeleteAccountInput.safeParse({}).success).toBe(false);
    expect(DeleteAccountInput.safeParse({ confirm: true, userId: USER_ID }).success).toBe(false);
  });
});

describe("computeSubjectHash (D-DM-02)", () => {
  it("is a stable keyed hash that doesn't contain the id", () => {
    const h = computeSubjectHash(USER_ID, SECRET);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(computeSubjectHash(USER_ID, SECRET));
    expect(h).not.toBe(computeSubjectHash(USER_ID, `${SECRET}x`));
    expect(h).not.toContain(USER_ID.replace(/-/g, ""));
  });
});

type Harness = {
  deps: DeleteAccountDeps;
  calls: string[];
  logs: string[];
  db: ReturnType<typeof fakeSupabase>;
};

function harness(
  opts: { rpcFails?: boolean; deadlocks?: number; authFails?: boolean; authGone?: boolean; secret?: string | undefined; signOutFails?: boolean; adminMissing?: boolean } = {},
): Harness {
  let deadlocks = opts.deadlocks ?? 0;
  const calls: string[] = [];
  const logs: string[] = [];
  const db = fakeSupabase(
    {
      ai_jobs: [
        { id: "job-running", status: "running" },
        { id: "job-queued", status: "queued" },
        { id: "job-finished", status: "succeeded" },
      ],
    },
    (name) => {
      calls.push(`rpc:${name}`);
      if (name === "request_ai_job_cancel") return { status: "running", cancel_requested_at: "2026-11-04T00:00:00Z" };
      if (name === "delete_account") {
        if (opts.rpcFails) throw Object.assign(new Error("boom"), { code: "XX000" });
        if (deadlocks > 0) {
          deadlocks--;
          throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
        }
        return null;
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  );
  const deps: DeleteAccountDeps = {
    supabase: db.client as UserSupabaseClient,
    user: { id: USER_ID },
    hashSecret: "secret" in opts ? opts.secret : SECRET,
    assertAuthAdminReady: () => {
      calls.push("assertAuthAdminReady");
      if (opts.adminMissing) throw new AppError("internal_error");
    },
    deleteAuthUser: vi.fn(async () => {
      calls.push("auth.deleteUser");
      if (opts.authFails) throw new AppError("internal_error");
      return { alreadyGone: opts.authGone === true };
    }),
    signOut: vi.fn(async () => {
      calls.push("signOut");
      if (opts.signOutFails) throw new Error("network");
    }),
    log: (event, fields) => void logs.push(JSON.stringify({ event, ...fields })),
  };
  return { deps, calls, logs, db };
}

describe("deleteAccount (FL-07)", () => {
  it("cancels in-flight jobs, then RPC with the HMAC, then Auth delete, then sign out", async () => {
    const h = harness();
    const out = await deleteAccount(h.deps);
    expect(out).toEqual({ canceledJobs: 2, authUserAlreadyGone: false });
    expect(h.calls).toEqual(["assertAuthAdminReady", "rpc:request_ai_job_cancel", "rpc:request_ai_job_cancel", "rpc:delete_account", "auth.deleteUser", "signOut"]);
    const rpc = h.db.rpcCalls.find((c) => c.name === "delete_account")!;
    expect(rpc.args).toEqual({ p_subject_hash: computeSubjectHash(USER_ID, SECRET) });
    expect(h.deps.deleteAuthUser).toHaveBeenCalledWith(USER_ID);
  });

  it("fails closed without the hash secret: nothing is called", async () => {
    const h = harness({ secret: undefined });
    await expect(deleteAccount(h.deps)).rejects.toMatchObject({ code: "internal_error" });
    expect(h.calls).toEqual([]);
  });

  it("fails closed when the Auth admin client isn't available: no cancel, no RPC (QA-S9-03)", async () => {
    const h = harness({ adminMissing: true });
    await expect(deleteAccount(h.deps)).rejects.toMatchObject({ code: "internal_error" });
    expect(h.calls).toEqual(["assertAuthAdminReady"]);
    expect(h.db.rpcCalls).toEqual([]);
  });

  it("retries delete_account once on a deadlock (40P01), then continues (QA-S9-01)", async () => {
    const h = harness({ deadlocks: 1 });
    await expect(deleteAccount(h.deps)).resolves.toMatchObject({ canceledJobs: 2 });
    expect(h.calls.filter((c) => c === "rpc:delete_account")).toHaveLength(2);
    expect(h.calls.filter((c) => c === "auth.deleteUser")).toHaveLength(1);
    const hashes = h.db.rpcCalls.filter((c) => c.name === "delete_account").map((c) => c.args.p_subject_hash);
    expect(new Set(hashes).size).toBe(1);
  });

  it("a second deadlock fails with account_deletion_busy and nothing after the RPC runs", async () => {
    const h = harness({ deadlocks: 2 });
    await expect(deleteAccount(h.deps)).rejects.toMatchObject({ code: "account_deletion_busy", status: 503 });
    expect(h.calls.filter((c) => c === "rpc:delete_account")).toHaveLength(2);
    expect(h.calls).not.toContain("auth.deleteUser");
    expect(h.calls).not.toContain("signOut");
  });

  it("RPC failure: no Auth delete, no sign out", async () => {
    const h = harness({ rpcFails: true });
    await expect(deleteAccount(h.deps)).rejects.toBeInstanceOf(AppError);
    expect(h.calls).not.toContain("auth.deleteUser");
    expect(h.calls).not.toContain("signOut");
    expect(h.logs.some((l) => l.includes('"step":"delete_account_rpc"'))).toBe(true);
  });

  it("Auth delete failure: account_deletion_incomplete, session kept so a retry can run", async () => {
    const h = harness({ authFails: true });
    await expect(deleteAccount(h.deps)).rejects.toMatchObject({ code: "account_deletion_incomplete", status: 500 });
    expect(h.calls).not.toContain("signOut");
    expect(h.logs.some((l) => l.includes('"step":"auth_delete_user"') && l.includes('"publicDataDeleted":true'))).toBe(true);
  });

  it("retry after the Auth user is already gone succeeds (idempotent)", async () => {
    const h = harness({ authGone: true });
    await expect(deleteAccount(h.deps)).resolves.toMatchObject({ authUserAlreadyGone: true });
  });

  it("a sign-out error doesn't fail the deletion", async () => {
    const h = harness({ signOutFails: true });
    await expect(deleteAccount(h.deps)).resolves.toMatchObject({ canceledJobs: 2 });
  });

  it("logs carry no user id, hash, or secret", async () => {
    for (const opts of [{}, { rpcFails: true }, { authFails: true }]) {
      const h = harness(opts);
      await deleteAccount(h.deps).catch(() => {});
      const all = h.logs.join("\n");
      expect(all).not.toContain(USER_ID);
      expect(all).not.toContain(SECRET);
      expect(all).not.toContain(computeSubjectHash(USER_ID, SECRET));
    }
  });
});
