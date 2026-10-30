import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/contracts/errors";
import type { Database } from "@/server/db/database.types";
import { runRetentionCron } from "@/server/jobs/retention";
import { deleteAuthUser } from "@/server/jobs/service-role";
import { hasPsql, hasTable, isStackReady, readLocalSupabase, runPsql } from "@/test/local-supabase";
import { computeSubjectHash, deleteAccount, getAccountDeletionSummary } from "./index";

/**
 * S9 end-to-end against the local stack (plan API 5 "로컬 DB 통합"):
 * a user with rows in every public user_id table (S1 … S8) → S-25 summary
 * counts → deleteAccount (Auth delete fails once → retry is idempotent) →
 * 0 public rows, no auth user, one de-identified log row, the other user
 * untouched. Then the retention cron with the service role at each boundary.
 * Fixtures go in via psql as the local superuser. Skips without the stack,
 * the S9 migrations, or psql.
 */

const stack = readLocalSupabase();
const ready =
  stack?.dbUrl !== undefined && hasPsql() ? (await isStackReady(stack)) && (await hasTable(stack, "account_deletion_logs")) : false;

type Client = SupabaseClient<Database>;
const SECRET = "integration-account-deletion-secret-0123456789ABCDEFGH";
const ALL_SLICES = fileURLToPath(new URL("./__fixtures__/all-slices.sql", import.meta.url));
const RETENTION = fileURLToPath(new URL("./__fixtures__/retention.sql", import.meta.url));

// Many psql round trips per test; the full suite runs files in parallel.
describe.skipIf(!ready)("account deletion + retention (local stack)", { timeout: 30_000 }, () => {
  const s = stack!;
  const db = s.dbUrl!;
  let admin: Client;
  const created: string[] = [];
  const logs: string[] = [];

  async function newUser(prefix: string): Promise<{ id: string; email: string; client: Client }> {
    const email = `${prefix}-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.code}`);
    created.push(data.user.id);
    const client = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.code}`);
    runPsql(db, { file: ALL_SLICES }, { uid: data.user.id });
    return { id: data.user.id, email, client };
  }

  /** Public tables with a user_id column, from the catalog (a new table is picked up automatically). */
  function userTables(): string[] {
    return runPsql(db, {
      sql: "select table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where table_schema = 'public' and column_name = 'user_id' and table_type = 'BASE TABLE' order by 1",
    }).split("\n");
  }

  function countsFor(uid: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const t of userTables()) out[t] = Number(runPsql(db, { sql: `select count(*) from public.${t} where user_id = '${uid}'` }));
    out.profiles = Number(runPsql(db, { sql: `select count(*) from public.profiles where id = '${uid}'` }));
    return out;
  }

  beforeAll(() => {
    admin = createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false } });
  });

  afterAll(async () => {
    for (const id of created) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
      runPsql(db, { sql: `delete from public.account_deletion_logs where subject_hash = '${computeSubjectHash(id, SECRET)}'` });
    }
  });

  it("summary → delete (with one failed Auth delete) → nothing left, other user intact", async () => {
    const target = await newUser("s9-target");
    const other = await newUser("s9-other");

    // The fixture filled every user_id table (guards the fixture against new tables).
    const before = countsFor(target.id);
    for (const [table, n] of Object.entries(before)) expect(n, `fixture row in ${table}`).toBeGreaterThan(0);
    const otherBefore = countsFor(other.id);

    // S-25 summary (DM §4.3).
    const summary = await getAccountDeletionSummary(target.client);
    expect(summary).toEqual({
      career: { experiences: 1, educations: 1, projects: 1, projectDetails: 1, achievements: 1, skills: 1, writingChats: 1 },
      applications: { applicationProjects: 1, insights: 1, drafts: 1, interviewSessions: 1, stageEvents: 1 },
      aiConnection: { providerKeys: 1, dataUseConsents: 1, usageRecords: 1 },
      recommendProviderKeyRevocation: true,
    });

    const base = {
      supabase: target.client,
      user: { id: target.id },
      hashSecret: SECRET,
      assertAuthAdminReady: () => {},
      signOut: async () => void (await target.client.auth.signOut({ scope: "local" })),
      log: (event: string, fields: Record<string, unknown>) => void logs.push(JSON.stringify({ event, ...fields })),
    };

    // 1st attempt: the RPC commits, the Auth delete fails.
    await expect(
      deleteAccount({
        ...base,
        deleteAuthUser: async () => {
          throw new AppError("internal_error");
        },
      }),
    ).rejects.toMatchObject({ code: "account_deletion_incomplete" });
    expect(Object.values(countsFor(target.id)).every((n) => n === 0)).toBe(true);

    // Retry with the same session: RPC passes idempotently, then the real Auth delete.
    const retry = await deleteAccount({ ...base, deleteAuthUser: (id) => deleteAuthUser(id, admin) });
    expect(retry).toEqual({ canceledJobs: 0, authUserAlreadyGone: false });

    // 0 public rows (every user_id table + profiles).
    const after = countsFor(target.id);
    for (const [table, n] of Object.entries(after)) expect(n, `rows left in ${table}`).toBe(0);

    // No auth user.
    const lookup = await admin.auth.admin.getUserById(target.id);
    expect(lookup.data.user).toBeNull();
    expect(Number(runPsql(db, { sql: `select count(*) from auth.users where id = '${target.id}'` }))).toBe(0);

    // Exactly one de-identified log row (D-DM-02).
    const hash = computeSubjectHash(target.id, SECRET);
    const rows = runPsql(db, { sql: `select row_to_json(l)::text from public.account_deletion_logs l where subject_hash = '${hash}'` })
      .split("\n")
      .filter(Boolean);
    expect(rows).toHaveLength(1);
    const row = JSON.parse(rows[0]!) as Record<string, unknown>;
    expect(row.reason).toBe("user_request");
    expect(row.db_deleted_at).not.toBeNull();
    expect(rows[0]).not.toContain(target.id);
    expect(rows[0]).not.toContain(target.email);

    // The other user is untouched.
    expect(countsFor(other.id)).toEqual(otherBefore);

    // Logs: steps and counts only.
    const all = logs.join("\n");
    expect(all).not.toContain(target.id);
    expect(all).not.toContain(target.email);
    expect(all).not.toContain(hash);
  });

  it("in-flight jobs get a cancel request before the delete", async () => {
    const u = await newUser("s9-jobs");
    const out = await deleteAccount({
      supabase: u.client,
      user: { id: u.id },
      hashSecret: SECRET,
      assertAuthAdminReady: () => {},
      deleteAuthUser: (id) => deleteAuthUser(id, admin),
      signOut: async () => {},
      log: () => {},
    });
    // The all-slices fixture has one running writing_chat_turn job.
    expect(out.canceledJobs).toBe(1);
    expect(Number(runPsql(db, { sql: `select count(*) from public.ai_jobs where user_id = '${u.id}'` }))).toBe(0);
  });

  it("the user session can't call the purge RPCs", async () => {
    const u = await newUser("s9-noperm");
    const res = await u.client.rpc("purge_old_ai_jobs", { p_now: new Date().toISOString() });
    expect(res.error).not.toBeNull();
  });

  it("retention cron (service role) purges only past each boundary", async () => {
    const u = await newUser("s9-retention");
    const now = new Date();
    const out = runPsql(db, { file: RETENTION }, { uid: u.id, now: now.toISOString() });
    const ids = Object.fromEntries(
      out
        .split("\n")
        .filter((l) => l.includes("|"))
        .map((l) => l.split("|") as [string, string]),
    );
    const exists = (table: string, label: string) => Number(runPsql(db, { sql: `select count(*) from public.${table} where id = '${ids[label]}'` })) === 1;

    const result = await runRetentionCron(admin, now);
    expect(result.failed).toEqual([]);
    expect(result.deleted.unlinkedWritingChats).toBeGreaterThanOrEqual(1);

    expect(exists("writing_chats", "chat_unlinked_91d")).toBe(false);
    expect(exists("writing_chats", "chat_unlinked_89d")).toBe(true);
    expect(exists("writing_chats", "chat_linked_400d")).toBe(true);
    expect(exists("ai_jobs", "job_done_91d")).toBe(false);
    expect(exists("ai_jobs", "job_done_89d")).toBe(true);
    expect(exists("ai_jobs", "job_queued_200d")).toBe(true);
    expect(exists("ai_usage_records", "usage_month_minus_13")).toBe(false);
    expect(exists("ai_usage_records", "usage_month_minus_12")).toBe(true);
    expect(exists("account_deletion_logs", "log_3y_plus")).toBe(false);
    expect(exists("account_deletion_logs", "log_3y_minus")).toBe(true);

    // Clean up the 3y-minus log row (no user FK, so the user delete won't take it).
    runPsql(db, { sql: `delete from public.account_deletion_logs where id = '${ids.log_3y_minus}'` });
  });
});
