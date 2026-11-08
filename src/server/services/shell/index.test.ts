import { describe, expect, it } from "vitest";
import { loadPolicyVersions } from "./index";

type Row = { policy_type: string; version: string; effective_at: string };

/** Minimal query builder that applies `.lte` / `.order` like PostgREST would. */
function fakeDb(rows: Row[]) {
  const orders: Array<[string, boolean]> = [];
  const builder = {
    select: () => builder,
    lte: (_col: string, iso: string) => {
      rows = rows.filter((r) => r.effective_at <= iso);
      return builder;
    },
    order: (col: string, opts: { ascending: boolean }) => {
      orders.push([col, opts.ascending]);
      return builder;
    },
    then: (resolve: (v: { data: Row[]; error: null }) => void) => {
      const sorted = [...rows].sort((a, b) => {
        for (const [col, asc] of orders) {
          const x = a[col as keyof Row];
          const y = b[col as keyof Row];
          if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
        }
        return 0;
      });
      resolve({ data: sorted, error: null });
    },
  };
  return { db: { from: () => builder } as unknown as Parameters<typeof loadPolicyVersions>[0], orders };
}

describe("loadPolicyVersions (R14-DB-6)", () => {
  const at = "2026-11-08T00:00:00+09:00";
  const rows: Row[] = [
    { policy_type: "privacy", version: "2026-11-05", effective_at: "2026-11-05T00:00:00+09:00" },
    { policy_type: "privacy", version: "2026-11-08", effective_at: at },
    { policy_type: "privacy", version: "2026-11-08.1", effective_at: at },
    { policy_type: "ai_data_use", version: "2026-11-08.1", effective_at: at },
    { policy_type: "ai_data_use", version: "2026-11-08", effective_at: at },
    { policy_type: "terms", version: "2026-11-08", effective_at: at },
  ];

  it("orders by effective_at desc, then version desc — the DB tie-break", async () => {
    const { db, orders } = fakeDb(rows);
    await loadPolicyVersions(db, new Date("2026-11-09T00:00:00Z"));
    expect(orders).toEqual([
      ["effective_at", false],
      ["version", false],
    ]);
  });

  it("the first row per type (what lib/data/account picks) is 2026-11-08.1 on a same-day tie", async () => {
    const { db } = fakeDb(rows);
    const out = await loadPolicyVersions(db, new Date("2026-11-09T00:00:00Z"));
    const first = (type: string) => out.find((r) => r.policy_type === type)?.version;
    expect(first("privacy")).toBe("2026-11-08.1");
    expect(first("ai_data_use")).toBe("2026-11-08.1");
    expect(first("terms")).toBe("2026-11-08");
  });
});
