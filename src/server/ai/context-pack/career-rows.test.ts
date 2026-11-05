import { describe, expect, it } from "vitest";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import { loadCareerRows } from "./career-rows";
import { TOTAL_EXPERIENCE_RPC } from "./total-experience";

/** Records table/columns/filters and rpc calls; returns empty data. */
function fakeDb(error: unknown = null) {
  const calls: Array<{ table: string; columns: string; filters: Array<[string, unknown]>; single: boolean }> = [];
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      return Promise.resolve({ data: { total_months: 94, open_ended_experience_count: 1, as_of_month: "2026-11-01" }, error });
    },
    from(table: string) {
      const call = { table, columns: "", filters: [] as Array<[string, unknown]>, single: false };
      calls.push(call);
      const result = () => Promise.resolve({ data: call.single ? null : [], error });
      const builder = {
        select(columns: string) {
          call.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        maybeSingle() {
          call.single = true;
          return result();
        },
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          return result().then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as AiWriterSupabaseClient, calls, rpcs };
}

describe("loadCareerRows", () => {
  it("lists columns explicitly (app_ai_writer column grants), never reads profiles, complete rows only", async () => {
    const { db, calls } = fakeDb();
    const rows = await loadCareerRows(db, { asOf: "2026-11-05" });
    expect(rows).toEqual({
      totalExperience: { totalMonths: 94, openEndedExperienceCount: 1, asOfMonth: { year: 2026, month: 11 } },
      experiences: [],
      educations: [],
      projects: [],
      deliverables: [],
      skills: [],
      projectSkills: [],
    });
    // (v4.12, SD-6) `profiles` is not among the tables read at all.
    expect(calls.map((c) => c.table).sort()).toEqual(
      ["educations", "experiences", "project_deliverables", "project_skills", "projects", "skills"].sort(),
    );
    for (const call of calls) {
      expect(call.columns).not.toContain("*");
      expect(call.columns).not.toContain("display_name");
      expect(call.columns).not.toContain("link_url"); // C-1: never in the pack or hash
    }
    // v4.4 projects: STAR, classification, is_current, content_updated_at (evidence snapshot).
    const projectColumns = calls.find((c) => c.table === "projects")?.columns ?? "";
    for (const column of ["is_current", "project_type", "experience_type", "competencies", "situation", "task", "action", "result", "learnings", "role", "description", "content_updated_at"]) {
      expect(projectColumns).toContain(column);
    }
    // Deliverables have no status; the pack keeps those of complete standalone projects.
    expect(calls.find((c) => c.table === "project_deliverables")?.filters).toEqual([]);
    for (const table of ["experiences", "educations", "projects"]) {
      expect(calls.find((c) => c.table === table)?.filters).toEqual([["status", "complete"]]);
    }
  });

  // (v4.12, SD-2 / DM 6.2) p_as_of has no default: the caller always passes it.
  it("asks the DB function for the total experience with an explicit p_as_of", async () => {
    const { db, rpcs } = fakeDb();
    await loadCareerRows(db, { asOf: "2026-11-05" });
    expect(rpcs).toEqual([{ name: TOTAL_EXPERIENCE_RPC, args: { p_as_of: "2026-11-05" } }]);
  });

  it("defaults p_as_of to today in KST", async () => {
    const { db, rpcs } = fakeDb();
    await loadCareerRows(db);
    expect(rpcs[0].args.p_as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("maps a query error to internal_error without exposing it", async () => {
    const { db } = fakeDb({ code: "42501", message: "permission denied" });
    await expect(loadCareerRows(db)).rejects.toMatchObject({ code: "internal_error" });
  });
});
