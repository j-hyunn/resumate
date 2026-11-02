import { PostgrestError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SaveEducationInput, SaveExperienceInput, SaveProjectInput } from "@/lib/contracts/career";
import {
  compareProjectCards,
  toEducationColumns,
  toExperienceColumns,
  toExperienceDto,
  toProjectColumns,
  toProjectDto,
} from "./mappers";
import { isPrimaryKeyViolation, sameInstant, upsertRow } from "./save";

const ID = "6f1c1d2e-8a4b-4c3d-9e2f-1a2b3c4d5e6f";

describe("patch → columns", () => {
  it("maps only the keys present, months to the 1st", () => {
    const patch = SaveExperienceInput.parse({ id: ID, companyName: "A사", startMonth: "2024-03", jobRank: "" });
    expect(toExperienceColumns(patch)).toEqual({ company_name: "A사", start_month: "2024-03-01", job_rank: null });
  });
  it("isCurrent=true clears end_month unless the patch sets it", () => {
    expect(toExperienceColumns(SaveExperienceInput.parse({ id: ID, isCurrent: true }))).toEqual({ is_current: true, end_month: null });
    expect(toExperienceColumns(SaveExperienceInput.parse({ id: ID, isCurrent: false }))).toEqual({ is_current: false });
  });
  it("enrolled clears end_month", () => {
    expect(toEducationColumns(SaveEducationInput.parse({ id: ID, enrollmentStatus: "enrolled" }))).toEqual({
      enrollment_status: "enrolled",
      end_month: null,
    });
  });
  it("affiliation writes both columns", () => {
    expect(toProjectColumns(SaveProjectInput.parse({ id: ID, affiliation: { type: "education", id: ID } }))).toEqual({
      experience_id: null,
      education_id: ID,
    });
    expect(toProjectColumns(SaveProjectInput.parse({ id: ID, affiliation: { type: "none" } }))).toEqual({
      experience_id: null,
      education_id: null,
    });
    expect(toProjectColumns(SaveProjectInput.parse({ id: ID, name: "x" }))).toEqual({ name: "x" });
  });
  it("project section saves map v4.4 columns; is_current clears end_month (CR-22)", () => {
    expect(
      toProjectColumns(
        SaveProjectInput.parse({ id: ID, action: "a", competencies: ["analysis"], projectType: "improvement", linkUrl: "", isCurrent: true }),
      ),
    ).toEqual({ action: "a", competencies: ["analysis"], project_type: "improvement", link_url: null, is_current: true, end_month: null });
    expect(toProjectColumns(SaveProjectInput.parse({ id: ID, role: "BE", description: "내용" }))).toEqual({ role: "BE", description: "내용" });
  });
});

describe("row → DTO", () => {
  it("experience months become YYYY-MM", () => {
    const dto = toExperienceDto({
      id: ID,
      status: "complete",
      company_name: "A",
      start_month: "2024-03-01",
      end_month: null,
      is_current: true,
      job_rank: null,
      job_position: "BE",
      department: null,
      employment_type: "full_time",
      summary: null,
      created_at: "t",
      updated_at: "t",
    });
    expect(dto).toMatchObject({ startMonth: "2024-03", endMonth: null, isCurrent: true, employmentType: "full_time" });
  });
  it("project DTO: scope from the affiliation, months as YYYY-MM, competencies kept in order", () => {
    const base = {
      id: ID,
      status: "draft",
      experience_id: ID,
      education_id: null,
      name: "결제",
      start_month: "2024-03-01",
      end_month: null,
      is_current: true,
      project_type: "improvement",
      experience_type: null,
      competencies: ["execution", "analysis"],
      situation: "s",
      task: null,
      action: null,
      result: null,
      learnings: null,
      role: null,
      description: null,
      link_url: null,
      source_writing_chat_id: null,
      content_updated_at: "c",
      created_at: "t",
      updated_at: "t",
    };
    expect(toProjectDto(base)).toMatchObject({ scope: "affiliated", startMonth: "2024-03", isCurrent: true, competencies: ["execution", "analysis"], contentUpdatedAt: "c" });
    expect(toProjectDto({ ...base, experience_id: null }).scope).toBe("standalone");
  });
  it("project cards: start_month desc nulls last, then created_at desc", () => {
    const card = (id: string, start_month: string | null, created_at: string) => ({ id, status: "draft", name: id, project_type: null, start_month, end_month: null, is_current: false, created_at });
    const sorted = [card("a", "2023-01-01", "1"), card("b", null, "3"), card("c", "2024-01-01", "1"), card("d", "2023-01-01", "2")].sort(compareProjectCards);
    expect(sorted.map((c) => c.id)).toEqual(["c", "d", "a", "b"]);
  });
});

type Row = { id: string; status: string; created_at: string; updated_at: string };
const T0 = "2026-10-25T01:00:00.123456+00:00";
/** Never edited since creation. */
const row: Row = { id: ID, status: "draft", created_at: T0, updated_at: T0 };
/** Edited after creation. */
const edited: Row = { ...row, updated_at: "2026-10-25T01:05:00.000001+00:00" };
const okRes = (data: Row | null) => Promise.resolve({ data, error: null });
const pgErr = (code: string, message: string) => new PostgrestError({ code, message, details: "", hint: "" });
const errRes = (code: string, message: string) => Promise.resolve({ data: null, error: pgErr(code, message) });

function fakeOps(
  over: Partial<{ insert: Promise<{ data: Row | null; error: PostgrestError | null }> | null; update: Row | null; current: Row | null }> = {},
) {
  const calls: string[] = [];
  return {
    calls,
    ops: {
      insert:
        over.insert === null
          ? null
          : () => (calls.push("insert"), over.insert ?? okRes(row)),
      update: (_id: string, expected: string | undefined) => (calls.push(`update:${expected ?? "-"}`), okRes(over.update ?? null)),
      current: () => (calls.push("current"), okRes(over.current === undefined ? row : over.current)),
    },
  };
}

const PKEY = 'duplicate key value violates unique constraint "experiences_pkey"';

describe("upsertRow (auto-save flow, QA-S2-03)", () => {
  it("first save (no expectedUpdatedAt) inserts with the client id", async () => {
    const f = fakeOps();
    await expect(upsertRow({ id: ID }, true, f.ops)).resolves.toEqual(row);
    expect(f.calls).toEqual(["insert"]);
  });
  it("a retried create on a never-edited row applies, compare-and-set on updated_at = created_at", async () => {
    const f = fakeOps({ insert: errRes("23505", PKEY), update: row });
    await expect(upsertRow({ id: ID }, true, f.ops)).resolves.toEqual(row);
    expect(f.calls).toEqual(["insert", "current", `update:${T0}`]);
  });
  it("a retried empty create returns the existing row", async () => {
    const f = fakeOps({ insert: errRes("23505", PKEY) });
    await expect(upsertRow({ id: ID }, false, f.ops)).resolves.toEqual(row);
    expect(f.calls).toEqual(["insert", "current"]);
  });
  it("a delayed create after an edit → conflict, nothing written (QA-S2-08)", async () => {
    const f = fakeOps({ insert: errRes("23505", PKEY), current: edited, update: edited });
    await expect(upsertRow({ id: ID }, true, f.ops)).rejects.toMatchObject({ code: "conflict" });
    expect(f.calls).toEqual(["insert", "current"]);
    const g = fakeOps({ insert: errRes("23505", PKEY), current: edited });
    await expect(upsertRow({ id: ID }, false, g.ops)).rejects.toMatchObject({ code: "conflict" });
  });
  it("an edit racing between the read and the update → 0 rows → conflict", async () => {
    const f = fakeOps({ insert: errRes("23505", PKEY), update: null });
    await expect(upsertRow({ id: ID }, true, f.ops)).rejects.toMatchObject({ code: "conflict" });
  });
  it("another user's id collides on insert but RLS hides the row → not_found", async () => {
    const f = fakeOps({ insert: errRes("23505", PKEY), current: null });
    await expect(upsertRow({ id: ID }, true, f.ops)).rejects.toMatchObject({ code: "not_found" });
    const g = fakeOps({ insert: errRes("23505", PKEY), current: null });
    await expect(upsertRow({ id: ID }, false, g.ops)).rejects.toMatchObject({ code: "not_found" });
  });
  it("a non-pkey unique violation is not treated as a retry", async () => {
    const f = fakeOps({ insert: errRes("23505", 'duplicate key value violates unique constraint "skills_user_id_normalized_name_key"') });
    await expect(upsertRow({ id: ID }, true, f.ops)).rejects.toMatchObject({ code: "conflict" });
    expect(f.calls).toEqual(["insert"]);
  });
  it("with expectedUpdatedAt it only updates, with the concurrency filter", async () => {
    const f = fakeOps({ update: row });
    await upsertRow({ id: ID, expectedUpdatedAt: "x" }, true, f.ops);
    expect(f.calls).toEqual(["update:x"]);
  });
  it("no create possible (no parent given) → update only", async () => {
    const f = fakeOps({ insert: null, update: row });
    await upsertRow({ id: ID }, true, f.ops);
    expect(f.calls).toEqual(["update:-"]);
  });
  it("0 rows + expectedUpdatedAt + row exists → conflict", async () => {
    const f = fakeOps({ update: null });
    await expect(upsertRow({ id: ID, expectedUpdatedAt: "old" }, true, f.ops)).rejects.toMatchObject({ code: "conflict" });
  });
  it("0 rows + not visible → not_found", async () => {
    const f = fakeOps({ update: null, current: null });
    await expect(upsertRow({ id: ID, expectedUpdatedAt: "old" }, true, f.ops)).rejects.toMatchObject({ code: "not_found" });
    const g = fakeOps({ insert: null, update: null });
    await expect(upsertRow({ id: ID }, true, g.ops)).rejects.toMatchObject({ code: "not_found" });
  });
  it("an empty patch writes nothing but still checks the version", async () => {
    const f = fakeOps();
    await expect(upsertRow({ id: ID, expectedUpdatedAt: row.updated_at }, false, f.ops)).resolves.toEqual(row);
    expect(f.calls).toEqual(["current"]);
    await expect(upsertRow({ id: ID, expectedUpdatedAt: "2020-01-01T00:00:00Z" }, false, f.ops)).rejects.toMatchObject({
      code: "conflict",
    });
  });
  it("maps a composite FK miss (23503) to not_found", async () => {
    const f = fakeOps({ insert: errRes("23503", "fk") });
    await expect(upsertRow({ id: ID }, true, f.ops)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("isPrimaryKeyViolation", () => {
  it("matches only <table>_pkey", () => {
    expect(isPrimaryKeyViolation(pgErr("23505", PKEY))).toBe(true);
    expect(isPrimaryKeyViolation(pgErr("23505", 'unique constraint "project_details_project_id_sort_order_key"'))).toBe(false);
    expect(isPrimaryKeyViolation(pgErr("23503", PKEY))).toBe(false);
    expect(isPrimaryKeyViolation(null)).toBe(false);
  });
});

describe("sameInstant", () => {
  it("compares timestamps across formats", () => {
    expect(sameInstant("2026-10-25T01:00:00+00:00", "2026-10-25T10:00:00+09:00")).toBe(true);
    expect(sameInstant("2026-10-25T01:00:00Z", "2026-10-25T01:00:01Z")).toBe(false);
  });
});
