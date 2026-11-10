import { describe, expect, it } from "vitest";
import type { UserSupabaseClient } from "@/server/db/types";
import { fakeSupabase } from "@/test/fake-supabase";
import { getApplicationDocument, listDocumentSlotCounts } from "./read";

/**
 * R15 후속 reads (DM 7장 25행 · 33행). The local-stack test (`document-chat.integration.test.ts`)
 * covers RLS and the real rows; this pins the mapping and the "never read `body` for the board" rule.
 */

const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const DOC = "00000000-0000-4000-8000-0000000000d1";

const row = {
  id: DOC,
  user_id: "u",
  created_at: "2026-11-09T00:00:00.000Z",
  updated_at: "2026-11-09T01:00:00.000Z",
  application_project_id: PROJECT,
  document_kind: "cover_letter",
  body: { questions: [{ slot: "q_1", question_id: "x", sort_order: 1, body: "답변", blocks: [] }] },
  meta: { tone: "concise" },
  filled_slot_count: 1,
  slot_count: 1,
  first_copied_at: null,
};

/** Records the column list of every `select` (fakeSupabase ignores it). */
function capturing(tables: Record<string, Record<string, unknown>[]>) {
  const db = fakeSupabase(tables);
  const selects: string[] = [];
  const client = db.client as { from: (t: string) => { select: (cols: string) => unknown } };
  const from = client.from.bind(client);
  client.from = (t: string) => {
    const q = from(t);
    const select = q.select.bind(q);
    q.select = (cols: string) => {
      selects.push(cols);
      return select(cols);
    };
    return q;
  };
  return { client: client as unknown as UserSupabaseClient, selects };
}

describe("getApplicationDocument", () => {
  it("returns the 정본 row with updated_at (the next save's expected version) and first_copied_at", async () => {
    const { client } = capturing({ application_documents: [row] });
    await expect(getApplicationDocument(client, PROJECT)).resolves.toEqual(row);
  });

  it("null when there is no row yet → 문항 설정 상태", async () => {
    const { client } = capturing({ application_documents: [] });
    await expect(getApplicationDocument(client, PROJECT)).resolves.toBeNull();
  });

  it("only the requested project's row (another project's document is not returned)", async () => {
    const { client } = capturing({ application_documents: [{ ...row, application_project_id: OTHER }] });
    await expect(getApplicationDocument(client, PROJECT)).resolves.toBeNull();
  });
});

describe("listDocumentSlotCounts (S-39)", () => {
  it("keys both counts by application_project_id", async () => {
    const { client } = capturing({
      application_documents: [
        { ...row, slot_count: 3, filled_slot_count: 1 },
        { ...row, id: "d2", application_project_id: OTHER, slot_count: 2, filled_slot_count: 2 },
      ],
    });
    await expect(listDocumentSlotCounts(client)).resolves.toEqual({
      [PROJECT]: { slot_count: 3, filled_slot_count: 1 },
      [OTHER]: { slot_count: 2, filled_slot_count: 2 },
    });
  });

  it("never reads `body` (that is what the generated slot_count column is for, DM 2.7.3)", async () => {
    const { client, selects } = capturing({ application_documents: [row] });
    await listDocumentSlotCounts(client);
    expect(selects).toHaveLength(1);
    expect(selects[0]).not.toMatch(/\bbody\b/);
    expect(selects[0]).toMatch(/slot_count/);
  });

  it("no documents → an empty record", async () => {
    const { client } = capturing({ application_documents: [] });
    await expect(listDocumentSlotCounts(client)).resolves.toEqual({});
  });
});
