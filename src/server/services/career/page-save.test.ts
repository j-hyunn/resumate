import { describe, expect, it } from "vitest";
import { SaveProjectDeliverableInput, SaveProjectPageInput } from "@/lib/contracts/career";
import type { UserSupabaseClient } from "@/server/db/types";
import { saveProjectDeliverable, saveProjectPage } from "./page-save";

/** R11 OD-C6 (DM 2.5.1): `clientId` → `p_client_id` on create only. */

const U1 = "00000000-0000-4000-8000-000000000101";
const CLIENT = "00000000-0000-4000-8000-0000000000c6";
const NOW = "2026-11-05T00:00:00.000Z";

function fakeRpc(data: unknown) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data, error: null };
    },
  } as unknown as UserSupabaseClient;
  return { client, calls };
}

const pageResult = { project_id: CLIENT, status: "draft", updated_at: NOW, applied: [], skipped: [] };
const deliverableResult = { project_deliverable_id: CLIENT, project_id: U1, sort_order: 0, updated_at: NOW, applied: [], skipped: [] };

describe("page save p_client_id (R11 OD-C6)", () => {
  it("contract: optional uuid", () => {
    expect(SaveProjectPageInput.safeParse({ projectId: null, clientId: CLIENT, values: {} }).success).toBe(true);
    expect(SaveProjectPageInput.safeParse({ projectId: null, clientId: "nope", values: {} }).success).toBe(false);
    expect(SaveProjectDeliverableInput.safeParse({ projectDeliverableId: null, projectId: U1, clientId: CLIENT, title: "t", body: null }).success).toBe(true);
    expect(SaveProjectDeliverableInput.safeParse({ projectDeliverableId: null, projectId: U1, clientId: 1, title: "t", body: null }).success).toBe(false);
  });

  it("S-10 create sends p_client_id; edit and create without it don't", async () => {
    const create = fakeRpc(pageResult);
    const r = await saveProjectPage(create.client, SaveProjectPageInput.parse({ projectId: null, clientId: CLIENT, values: { name: "결제" } }));
    expect(create.calls[0]).toMatchObject({ fn: "save_project_page", args: { p_project_id: null, p_client_id: CLIENT } });
    expect(r.projectId).toBe(CLIENT);

    const edit = fakeRpc(pageResult);
    await saveProjectPage(edit.client, SaveProjectPageInput.parse({ projectId: U1, clientId: CLIENT, values: {} }));
    expect(edit.calls[0]!.args).not.toHaveProperty("p_client_id");

    const plain = fakeRpc(pageResult);
    await saveProjectPage(plain.client, SaveProjectPageInput.parse({ projectId: null, values: { name: "결제" } }));
    expect(plain.calls[0]!.args).not.toHaveProperty("p_client_id");
  });

  it("S-44 create sends p_client_id; edit doesn't", async () => {
    const create = fakeRpc(deliverableResult);
    await saveProjectDeliverable(create.client, SaveProjectDeliverableInput.parse({ projectDeliverableId: null, projectId: U1, clientId: CLIENT, title: "회고", body: null }));
    expect(create.calls[0]).toMatchObject({ fn: "save_project_deliverable", args: { p_project_deliverable_id: null, p_project_id: U1, p_client_id: CLIENT } });

    const edit = fakeRpc(deliverableResult);
    await saveProjectDeliverable(edit.client, SaveProjectDeliverableInput.parse({ projectDeliverableId: CLIENT, projectId: null, clientId: CLIENT, title: "회고", body: "" }));
    expect(edit.calls[0]!.args).not.toHaveProperty("p_client_id");
  });
});
