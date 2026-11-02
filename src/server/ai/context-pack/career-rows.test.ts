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
    expect(rows).toEqual({ profile: null, experiences: [], educations: [], projects: [], deliverables: [], skills: [], projectSkills: [] });
    expect(calls.map((c) => c.table).sort()).toEqual(
      ["educations", "experiences", "profiles", "project_deliverables", "project_skills", "projects", "skills"].sort(),
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
    // QA-S3-06: profile rows carry updated_at for evidence source_snapshot_at.
    expect(calls.find((c) => c.table === "profiles")?.columns).toBe(
      "id, desired_job_title, total_years_of_experience, interested_industries, updated_at",
    );
    for (const table of ["experiences", "educations", "projects"]) {
      expect(calls.find((c) => c.table === table)?.filters).toEqual([["status", "complete"]]);
    }
  });

  it("maps a query error to internal_error without exposing it", async () => {
    const { db } = fakeDb({ code: "42501", message: "permission denied" });
    await expect(loadCareerRows(db)).rejects.toMatchObject({ code: "internal_error" });
  });
});
