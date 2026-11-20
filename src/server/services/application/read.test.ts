import { describe, expect, it } from "vitest";
import { isFailureBeforeRawTextEdit } from "@/lib/contracts/application";
import type { UserSupabaseClient } from "@/server/db/types";
import { jdRawTextLockedReasonOf } from "./read";

// R17: `resolveExtraction` / `extractionJobToCheck` / `jdRawTextLockOf` are gone with AI-01 and
// `update_failed_jd_raw_text`; the JD view's one lock (an insight job in flight) is covered by the
// integration test.

function countClient(count: number, seen: Array<[string, unknown]>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (k: string, v: unknown) => {
      seen.push([k, v]);
      return chain;
    },
    in: (k: string, v: unknown) => {
      seen.push([k, v]);
      return Promise.resolve({ count, error: null });
    },
  };
  return { from: () => chain } as unknown as UserSupabaseClient;
}

describe("jdRawTextLockedReasonOf (DM 2.6.1 condition 3)", () => {
  it("an insight job queued / running → job_in_progress, none → null", async () => {
    const seen: Array<[string, unknown]> = [];
    await expect(jdRawTextLockedReasonOf(countClient(1, seen), "p")).resolves.toBe("job_in_progress");
    expect(seen).toEqual([
      ["application_project_id", "p"],
      ["job_type", "insight"],
      ["status", ["queued", "running"]],
    ]);
    await expect(jdRawTextLockedReasonOf(countClient(0, []), "p")).resolves.toBeNull();
  });
});

describe("isFailureBeforeRawTextEdit (DM 2.6.1)", () => {
  it("only a job finished strictly before the edit is past; nothing to compare → not past", () => {
    expect(isFailureBeforeRawTextEdit("2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z")).toBe(true);
    expect(isFailureBeforeRawTextEdit("2026-11-02T00:00:00Z", "2026-11-02T00:00:00Z")).toBe(false);
    expect(isFailureBeforeRawTextEdit("2026-11-03T00:00:00Z", "2026-11-02T00:00:00Z")).toBe(false);
    expect(isFailureBeforeRawTextEdit(null, "2026-11-02T00:00:00Z")).toBe(false);
    expect(isFailureBeforeRawTextEdit("2026-11-01T00:00:00Z", null)).toBe(false);
  });
});
