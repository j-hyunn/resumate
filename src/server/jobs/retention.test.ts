import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/retention/route";
import { resetServerEnvCache } from "@/server/env";
import { RETENTION_BATCH_LIMIT, RETENTION_MAX_BATCHES_PER_RUN, RETENTION_PURGES, runRetentionCron } from "./retention";
import type { ServiceRoleClient } from "./service-role";

function fakeAdmin(results: Record<string, Array<number | Error>>) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      const r = results[name]?.shift();
      if (r instanceof Error) return { data: null, error: { code: "XX000", message: r.message } };
      return { data: r ?? 0, error: null };
    },
  };
  return { client: client as unknown as ServiceRoleClient, calls };
}

describe("runRetentionCron (NFR-PRV-06, DM §4.4)", () => {
  const now = new Date("2026-11-04T18:00:00.000Z");

  it("calls each purge RPC in order with p_now / p_limit and returns counts", async () => {
    const admin = fakeAdmin({ purge_unlinked_writing_chats: [2], purge_old_ai_jobs: [0], purge_old_ai_usage_records: [0], purge_old_account_deletion_logs: [1] });
    const logs: string[] = [];
    const result = await runRetentionCron(admin.client, now, (e, f) => void logs.push(JSON.stringify({ e, ...f })));
    expect(admin.calls.map((c) => c.name)).toEqual(RETENTION_PURGES.map((p) => p.rpc));
    for (const c of admin.calls) expect(c.args).toEqual({ p_now: now.toISOString(), p_limit: RETENTION_BATCH_LIMIT });
    expect(result).toEqual({ deleted: { unlinkedWritingChats: 2, aiJobs: 0, aiUsageRecords: 0, accountDeletionLogs: 1 }, hasMore: [], failed: [] });
    expect(logs).toHaveLength(1);
  });

  it("repeats a full batch up to the per-run cap, then leaves the rest for the next run", async () => {
    const full = RETENTION_BATCH_LIMIT;
    const admin = fakeAdmin({ purge_old_ai_jobs: [full, 12], purge_old_ai_usage_records: Array(RETENTION_MAX_BATCHES_PER_RUN + 1).fill(full) });
    const result = await runRetentionCron(admin.client, now);
    expect(result.deleted.aiJobs).toBe(full + 12);
    expect(result.deleted.aiUsageRecords).toBe(full * RETENTION_MAX_BATCHES_PER_RUN);
    expect(result.hasMore).toEqual(["aiUsageRecords"]);
    expect(admin.calls.filter((c) => c.name === "purge_old_ai_usage_records")).toHaveLength(RETENTION_MAX_BATCHES_PER_RUN);
  });

  it("keeps going after one purge fails, then throws internal_error", async () => {
    const admin = fakeAdmin({ purge_unlinked_writing_chats: [1], purge_old_ai_jobs: [new Error("boom")], purge_old_ai_usage_records: [3], purge_old_account_deletion_logs: [0] });
    const logs: string[] = [];
    await expect(runRetentionCron(admin.client, now, (e, f) => void logs.push(JSON.stringify({ e, ...f })))).rejects.toMatchObject({ code: "internal_error" });
    expect(admin.calls).toHaveLength(4);
    expect(logs[0]).toContain('"failed":["aiJobs"]');
    expect(logs[0]).not.toContain("boom");
  });
});

describe("GET /api/cron/retention", () => {
  afterEach(() => resetServerEnvCache());

  function stubEnv() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_JWT_SECRET", "x".repeat(32));
    vi.stubEnv("CRON_SECRET", "retention-cron-secret-0000");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    resetServerEnvCache();
  }

  it("401 without or with a wrong bearer", async () => {
    stubEnv();
    expect((await GET(new Request("http://localhost/api/cron/retention"))).status).toBe(401);
    const wrong = await GET(new Request("http://localhost/api/cron/retention", { headers: { authorization: "Bearer nope" } }));
    expect(wrong.status).toBe(401);
  });

  it("fails closed (500) when the service role key is missing", async () => {
    stubEnv();
    const res = await GET(new Request("http://localhost/api/cron/retention", { headers: { authorization: "Bearer retention-cron-secret-0000" } }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "internal_error", message: expect.any(String) } });
  });
});
