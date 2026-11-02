import { describe, expect, it, vi } from "vitest";
import { PENDING_CAREER_DESCRIPTION_COOKIE } from "@/server/services/drafts/pending-cookie";

const state = vi.hoisted(() => ({ deleted: [] as string[], signOutFails: false }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => ({ name, value: "v" }), delete: (name: string) => void state.deleted.push(name) }),
  headers: async () => new Headers(),
}));
vi.mock("@/server/db/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signOut: async () => {
        if (state.signOutFails) throw new Error("network");
        return { error: null };
      },
    },
  }),
}));

const { signOut } = await import("./auth");

describe("signOut action (QA-W5-02)", () => {
  it("clears the pending-generation cookie with the session", async () => {
    state.deleted.length = 0;
    await expect(signOut()).resolves.toEqual({ data: { signedOut: true } });
    expect(state.deleted).toContain(PENDING_CAREER_DESCRIPTION_COOKIE);
  });

  it("clears it even when Auth's sign-out call throws", async () => {
    state.deleted.length = 0;
    state.signOutFails = true;
    await signOut();
    expect(state.deleted).toContain(PENDING_CAREER_DESCRIPTION_COOKIE);
    state.signOutFails = false;
  });
});
