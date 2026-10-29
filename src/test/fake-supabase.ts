/**
 * Test-only, tiny in-memory stand-in for the supabase-js query builder:
 * `from(t).select(cols).eq/in/is/order/limit` → `{ data, error }` (awaitable,
 * `.maybeSingle()`), `update(patch)` / `delete()` with the same filters
 * (+ `.select()`), and `rpc(name, args)` through a handler. Column lists are
 * ignored (whole rows come back). Enough for S7 service unit tests; RLS and
 * real SQL are covered by the local-stack integration tests.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export type FakeDb = {
  tables: Record<string, Row[]>;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  client: unknown;
};

export function fakeSupabase(
  tables: Record<string, Row[]>,
  rpc: (name: string, args: Record<string, unknown>) => unknown | Promise<unknown> = () => {
    throw new Error("no rpc");
  },
): FakeDb {
  const rpcCalls: FakeDb["rpcCalls"] = [];

  function query(table: string) {
    const filters: Filter[] = [];
    let mode: "select" | "update" | "delete" = "select";
    let patch: Row = {};
    let orders: Array<{ col: string; asc: boolean }> = [];
    let limit: number | null = null;

    const run = (): { data: Row[]; error: null } => {
      const rows = (tables[table] ??= []);
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      if (mode === "update") for (const r of matched) Object.assign(r, patch);
      if (mode === "delete") tables[table] = rows.filter((r) => !matched.includes(r));
      let out = [...matched];
      for (const o of [...orders].reverse()) {
        out.sort((a, b) => {
          const x = a[o.col] as string | number;
          const y = b[o.col] as string | number;
          return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
        });
      }
      if (limit !== null) out = out.slice(0, limit);
      return { data: out.map((r) => ({ ...r })), error: null };
    };

    const builder = {
      select: () => builder,
      update: (p: Row) => {
        mode = "update";
        patch = p;
        return builder;
      },
      delete: () => {
        mode = "delete";
        return builder;
      },
      eq: (col: string, value: unknown) => {
        filters.push((r) => r[col] === value);
        return builder;
      },
      in: (col: string, values: readonly unknown[]) => {
        filters.push((r) => values.includes(r[col]));
        return builder;
      },
      is: (col: string, value: unknown) => {
        filters.push((r) => (r[col] ?? null) === value);
        return builder;
      },
      order: (col: string, opts: { ascending?: boolean } = {}) => {
        orders.push({ col, asc: opts.ascending !== false });
        return builder;
      },
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      maybeSingle: async () => {
        const { data } = run();
        return { data: data[0] ?? null, error: null };
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(resolve(run()));
        } catch (err) {
          return reject ? Promise.resolve(reject(err)) : Promise.reject(err);
        }
      },
    };
    void orders;
    orders = [];
    return builder;
  }

  const client = {
    from: (table: string) => query(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      try {
        return { data: await rpc(name, args), error: null };
      } catch (err) {
        const e = err as { code?: string; message?: string };
        return { data: null, error: { code: e.code ?? "P0001", message: e.message ?? "error" } };
      }
    },
  };
  return { tables, rpcCalls, client };
}
