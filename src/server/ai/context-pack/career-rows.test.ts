import { describe, expect, it } from "vitest";
import type { AiWriterSupabaseClient } from "@/server/db/types";
import { loadCareerRows } from "./career-rows";

/** Records table/columns/filters; returns empty data. */
function fakeDb(error: unknown = null) {
  const calls: Array<{ table: string; columns: string; filters: Array<[string, unknown]>; single: boolean }> = [];
  const db = {
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
  return { db: db as unknown as AiWriterSupabaseClient, calls };
}

describe("loadCareerRows", () => {
  it("lists columns explicitly (app_ai_writer column grants), never display_name, complete rows only", async () => {
    const { db, calls } = fakeDb();
    const rows = await loadCareerRows(db);
    expect(rows).toEqual({ profile: null, experiences: [], educations: [], projects: [], projectDetails: [], achievements: [], skills: [], projectSkills: [] });
    expect(calls.map((c) => c.table).sort()).toEqual(
      ["achievements", "educations", "experiences", "profiles", "project_details", "project_skills", "projects", "skills"].sort(),
    );
    for (const call of calls) {
      expect(call.columns).not.toContain("*");
      expect(call.columns).not.toContain("display_name");
    }
    // QA-S3-06: profile rows carry updated_at for evidence source_snapshot_at.
    expect(calls.find((c) => c.table === "profiles")?.columns).toBe(
      "id, desired_job_title, total_years_of_experience, interested_industries, updated_at",
    );
    for (const table of ["experiences", "educations", "projects", "project_details", "achievements"]) {
      expect(calls.find((c) => c.table === table)?.filters).toEqual([["status", "complete"]]);
    }
  });

  it("maps a query error to internal_error without exposing it", async () => {
    const { db } = fakeDb({ code: "42501", message: "permission denied" });
    await expect(loadCareerRows(db)).rejects.toMatchObject({ code: "internal_error" });
  });
});
