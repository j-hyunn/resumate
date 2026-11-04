import { describe, expect, it } from "vitest";
import { computeSubjectHash } from "@/server/services/account";
import { buildInactivityNotice, formatKstDate } from "@/server/mail/inactivity-notice";
import {
  AUTH_CLEANUP_MAX_PER_RUN,
  INACTIVITY_DELETE_MAX_PER_RUN,
  INACTIVITY_NOTICE_MAX_PER_RUN,
  NOTICE_MAX_CONSECUTIVE_FAILURES,
  inactivityDeleteOn,
  runInactiveAccountsCron,
  type InactiveAccountsDeps,
} from "./inactive-accounts";
import type { ServiceRoleClient } from "./service-role";

const SECRET = "s".repeat(16) + "abcdefghijklmnopqrstuvwxyz";
const NOW = new Date("2027-11-15T03:00:00.000Z");
const A = "a1000000-0000-0000-0000-00000000000a";
const B = "b1000000-0000-0000-0000-00000000000b";
const C = "c1000000-0000-0000-0000-00000000000c";

type RpcResult = { data: unknown; error: { code: string; message: string } | null };
type Handler = (args: Record<string, unknown>) => RpcResult;

function fakeAdmin(handlers: Record<string, Handler>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const h = handlers[name];
      return h ? h(args) : { data: [], error: null };
    },
  };
  return { client: client as unknown as ServiceRoleClient, calls };
}

const ok = (data: unknown): RpcResult => ({ data, error: null });
const fail: RpcResult = { data: null, error: { code: "XX000", message: "boom" } };

function deps(admin: ServiceRoleClient, over: Partial<InactiveAccountsDeps> = {}) {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const authDeleted: string[] = [];
  const logs: string[] = [];
  let closed = 0;
  const d: InactiveAccountsDeps = {
    admin,
    createMailer: () => ({
      send: async (to, content) => void sent.push({ to, subject: content.subject, text: content.text }),
      close: () => void closed++,
    }),
    hashSecret: SECRET,
    siteOrigin: "https://resumate.example",
    deleteAuthUser: async (id) => {
      authDeleted.push(id);
      return { alreadyGone: false };
    },
    log: (e, f) => void logs.push(JSON.stringify({ e, ...f })),
    ...over,
  };
  return { d, sent, authDeleted, logs, closed: () => closed };
}

describe("inactivityDeleteOn", () => {
  it("is 30 days after the notice, or 1 year after the last access if later", () => {
    expect(inactivityDeleteOn(new Date("2027-11-15T00:00:00Z"), new Date("2026-12-14T00:00:00Z")).toISOString()).toBe("2027-12-15T00:00:00.000Z");
    expect(inactivityDeleteOn(new Date("2027-11-15T00:00:00Z"), new Date("2026-12-20T00:00:00Z")).toISOString()).toBe("2027-12-20T00:00:00.000Z");
  });
});

describe("buildInactivityNotice", () => {
  it("names the KST deletion date and links to sign-in", () => {
    const mail = buildInactivityNotice({ deleteOn: new Date("2027-12-14T16:00:00Z"), siteOrigin: "https://resumate.example" });
    expect(formatKstDate(new Date("2027-12-14T16:00:00Z"))).toBe("2027년 12월 15일");
    expect(mail.subject).toContain("2027년 12월 15일");
    expect(mail.text).toContain("https://resumate.example/sign-in");
    expect(mail.text).toContain("로그인하면 계정이 그대로 유지됩니다");
    expect(mail.html).toContain('<a href="https://resumate.example/sign-in">');
  });
});

describe("runInactiveAccountsCron", () => {
  it("does nothing when no account is inactive", async () => {
    const admin = fakeAdmin({});
    const { d, sent, authDeleted } = deps(admin.client);
    const result = await runInactiveAccountsCron(d, NOW);
    expect(admin.calls.map((c) => c.name)).toEqual([
      "list_inactivity_notice_targets",
      "list_inactive_accounts_due",
      "list_incomplete_account_deletions",
    ]);
    expect(admin.calls[0]!.args).toEqual({ p_now: NOW.toISOString(), p_limit: INACTIVITY_NOTICE_MAX_PER_RUN });
    expect(admin.calls[1]!.args).toEqual({ p_now: NOW.toISOString(), p_limit: INACTIVITY_DELETE_MAX_PER_RUN });
    expect(admin.calls[2]!.args).toEqual({ p_limit: AUTH_CLEANUP_MAX_PER_RUN });
    expect(sent).toEqual([]);
    expect(authDeleted).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("sends the notice first, then marks it; a sign-in in between is not marked", async () => {
    const admin = fakeAdmin({
      list_inactivity_notice_targets: () =>
        ok([
          { user_id: A, email: "a@example.test", last_active_at: "2026-12-14T03:00:00Z" },
          { user_id: B, email: "b@example.test", last_active_at: "2026-12-14T03:00:00Z" },
        ]),
      mark_inactivity_notice_sent: (args) => ok(args.p_user_id === A),
    });
    const { d, sent, logs, closed } = deps(admin.client);
    const result = await runInactiveAccountsCron(d, NOW);
    expect(sent.map((s) => s.to)).toEqual(["a@example.test", "b@example.test"]);
    expect(sent[0]!.subject).toContain("2027년 12월 15일");
    const order = admin.calls.map((c) => c.name);
    expect(order.slice(0, 3)).toEqual(["list_inactivity_notice_targets", "mark_inactivity_notice_sent", "mark_inactivity_notice_sent"]);
    expect(admin.calls[1]!.args).toEqual({ p_user_id: A, p_sent_at: NOW.toISOString() });
    expect(result.notices).toEqual({ sent: 1, notMarked: 1, failed: 0 });
    expect(closed()).toBe(1);
    // counts only: no e-mail or user id in the log
    expect(logs.join()).not.toContain("example.test");
    expect(logs.join()).not.toContain(A);
  });

  it("never marks an account whose mail failed, and stops after repeated failures", async () => {
    const targets = Array.from({ length: 5 }, (_, i) => ({
      user_id: `a1000000-0000-0000-0000-00000000000${i}`,
      email: `u${i}@example.test`,
      last_active_at: "2026-12-14T03:00:00Z",
    }));
    const admin = fakeAdmin({ list_inactivity_notice_targets: () => ok(targets) });
    let attempts = 0;
    const { d } = deps(admin.client, {
      createMailer: () => ({
        send: async () => {
          attempts++;
          throw new Error("smtp down");
        },
        close: () => {},
      }),
    });
    await expect(runInactiveAccountsCron(d, NOW)).rejects.toMatchObject({ code: "internal_error" });
    expect(attempts).toBe(NOTICE_MAX_CONSECUTIVE_FAILURES);
    expect(admin.calls.some((c) => c.name === "mark_inactivity_notice_sent")).toBe(false);
  });

  it("missing Gmail settings: notices fail, deletions of already-told accounts still run", async () => {
    const admin = fakeAdmin({
      list_inactivity_notice_targets: () => ok([{ user_id: A, email: "a@example.test", last_active_at: "2026-12-14T03:00:00Z" }]),
      list_inactive_accounts_due: () => ok([{ user_id: C }]),
      purge_inactive_account: () => ok({ deleted: true }),
    });
    const { d, authDeleted, logs } = deps(admin.client, {
      createMailer: () => {
        throw new Error("GMAIL_SMTP_USER missing");
      },
    });
    await expect(runInactiveAccountsCron(d, NOW)).rejects.toMatchObject({ code: "internal_error" });
    expect(authDeleted).toEqual([C]);
    expect(logs[0]).toContain('"failed":["notices"]');
    expect(admin.calls.some((c) => c.name === "mark_inactivity_notice_sent")).toBe(false);
  });

  it("deletes due accounts with the HMAC subject hash, then the Auth user; skips accounts no longer due", async () => {
    const admin = fakeAdmin({
      list_inactive_accounts_due: () => ok([{ user_id: B }, { user_id: C }]),
      purge_inactive_account: (args) => ok(args.p_user_id === C ? { deleted: true } : null),
    });
    const { d, authDeleted } = deps(admin.client);
    const result = await runInactiveAccountsCron(d, NOW);
    const purge = admin.calls.filter((c) => c.name === "purge_inactive_account");
    expect(purge.map((c) => c.args)).toEqual([
      { p_user_id: B, p_subject_hash: computeSubjectHash(B, SECRET), p_now: NOW.toISOString() },
      { p_user_id: C, p_subject_hash: computeSubjectHash(C, SECRET), p_now: NOW.toISOString() },
    ]);
    expect(authDeleted).toEqual([C]);
    expect(result.deletions).toEqual({ deleted: 1, skipped: 1, authFailed: 0 });
  });

  it("an Auth delete failure leaves the public deletion in place (picked up by auth cleanup)", async () => {
    const admin = fakeAdmin({
      list_inactive_accounts_due: () => ok([{ user_id: C }]),
      purge_inactive_account: () => ok({ deleted: true }),
    });
    const { d } = deps(admin.client, {
      deleteAuthUser: async () => {
        throw new Error("auth down");
      },
    });
    const result = await runInactiveAccountsCron(d, NOW);
    expect(result.deletions).toEqual({ deleted: 1, skipped: 0, authFailed: 1 });
    expect(result.failed).toEqual([]);
  });

  it("auth cleanup deletes only Auth users whose deletion log exists", async () => {
    const admin = fakeAdmin({
      list_incomplete_account_deletions: () => ok([{ user_id: B }, { user_id: C }]),
      get_account_deletion_state: (args) => ok(args.p_user_id === C ? "deletion_incomplete" : "profile_missing"),
    });
    const { d, authDeleted } = deps(admin.client);
    const result = await runInactiveAccountsCron(d, NOW);
    expect(admin.calls.find((c) => c.name === "get_account_deletion_state")!.args).toEqual({
      p_user_id: B,
      p_subject_hash: computeSubjectHash(B, SECRET),
    });
    expect(authDeleted).toEqual([C]);
    expect(result.authCleanup).toEqual({ deleted: 1, skipped: 1, failed: 0 });
  });

  it("without the hash secret nothing is deleted (fail closed)", async () => {
    const admin = fakeAdmin({ list_inactive_accounts_due: () => ok([{ user_id: C }]) });
    const { d, authDeleted, logs } = deps(admin.client, { hashSecret: undefined });
    await expect(runInactiveAccountsCron(d, NOW)).rejects.toMatchObject({ code: "internal_error" });
    expect(admin.calls.map((c) => c.name)).toEqual(["list_inactivity_notice_targets"]);
    expect(authDeleted).toEqual([]);
    expect(logs[0]).toContain('"failed":["deletions","authCleanup"]');
  });

  it("a failing list RPC fails its step and the others still run", async () => {
    const admin = fakeAdmin({ list_inactivity_notice_targets: () => fail });
    const { d } = deps(admin.client);
    await expect(runInactiveAccountsCron(d, NOW)).rejects.toMatchObject({ code: "internal_error" });
    expect(admin.calls.map((c) => c.name)).toEqual([
      "list_inactivity_notice_targets",
      "list_inactive_accounts_due",
      "list_incomplete_account_deletions",
    ]);
  });
});
