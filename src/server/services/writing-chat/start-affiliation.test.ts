import { describe, expect, it } from "vitest";
import type { UserSupabaseClient } from "@/server/db/types";
import { startWritingChatWithAffiliation } from "./chat";

const CHAT = "00000000-0000-4000-8000-0000000000c1";
const EXP = "00000000-0000-4000-8000-0000000000e1";

function stub(opts: { rowVisible: boolean; affiliationFails: boolean }) {
  const rpcs: string[] = [];
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.rowVisible ? { id: EXP } : null, error: null }) }) }) }),
    rpc: async (name: string) => {
      rpcs.push(name);
      if (name === "start_writing_chat") return { data: CHAT, error: null };
      if (name === "set_writing_chat_affiliation") return opts.affiliationFails ? { data: null, error: { code: "P0002", message: "not_found", details: "", hint: "" } } : { data: null, error: null };
      return { data: null, error: null };
    },
  };
  return { client: client as unknown as UserSupabaseClient, rpcs };
}

describe("startWritingChatWithAffiliation (QA-W5-09)", () => {
  it("refuses before creating anything when the affiliation isn't readable", async () => {
    const s = stub({ rowVisible: false, affiliationFails: false });
    await expect(startWritingChatWithAffiliation(s.client, { mode: "new_project" } as never, { type: "experience", id: EXP })).rejects.toMatchObject({ code: "not_found" });
    expect(s.rpcs).toEqual([]);
  });

  it("removes the new chat when setting the affiliation fails in between", async () => {
    const s = stub({ rowVisible: true, affiliationFails: true });
    await expect(startWritingChatWithAffiliation(s.client, { mode: "new_project" } as never, { type: "experience", id: EXP })).rejects.toBeTruthy();
    expect(s.rpcs).toEqual(["start_writing_chat", "set_writing_chat_affiliation", "delete_career_item"]);
  });
});
