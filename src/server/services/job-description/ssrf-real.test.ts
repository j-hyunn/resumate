import { describe, expect, it } from "vitest";
import { fetchJobDescription } from "@/server/services/job-description/fetch";

/**
 * A1 SSRF guard through the **real** resolver and the **default** deps (adopted from backend-qa's
 * smoke test, QA 1라운드).
 *
 * `ssrf.test.ts` and `fetch.test.ts` inject a fake `lookup`, so they check the block list but never
 * the production resolution path — a guard that was wired up wrongly (or a `defaultLookup` that
 * answered in an unexpected shape) would pass them. These cases go through `fetchJobDescription`
 * with no overrides and cover the forms an injected lookup can't: a decimal / octal IPv4
 * (`2130706433`, `0177.0.0.1`), the unspecified addresses (`[::]`, `0.0.0.0`), a trailing-dot
 * host (`LOCALHOST.`) and an IPv4-mapped IPv6 loopback.
 *
 * No case reaches a socket: every one is refused by the guard (or at parse) before any fetch, so
 * there is no outbound traffic and nothing to flake on.
 */
describe("A1 SSRF guard with the real resolver", () => {
  const logs: Array<Record<string, unknown>> = [];
  const call = (url: string) => fetchJobDescription({ url, userId: "qa" }, { rateLimiter: null, log: (event, fields) => void logs.push({ event, ...fields }) });

  it.each([
    ["http://169.254.169.254/latest/meta-data/", "fetch_blocked"],
    ["http://127.0.0.1:54321/rest/v1/", "fetch_blocked"],
    ["http://localhost:54321/", "fetch_blocked"],
    ["http://LOCALHOST./", "fetch_blocked"],
    ["http://[::1]:54321/", "fetch_blocked"],
    ["http://[::]/", "fetch_blocked"],
    ["http://0.0.0.0:54321/", "fetch_blocked"],
    ["http://2130706433/", "fetch_blocked"],
    ["http://0177.0.0.1/", "fetch_blocked"],
    ["http://10.0.0.1/", "fetch_blocked"],
    ["http://[::ffff:127.0.0.1]/", "fetch_blocked"],
    ["file:///etc/passwd", "invalid_source_url"],
    ["gopher://127.0.0.1/", "invalid_source_url"],
    ["http://user:pw@example.com/", "invalid_source_url"],
  ])("%s -> %s", async (url, code) => {
    await expect(call(url)).rejects.toMatchObject({ code });
  }, 20_000);

  it("logs only host / code / bytes / elapsed — never the path or the query", () => {
    const text = JSON.stringify(logs);
    expect(text).not.toContain("meta-data");
    expect(text).not.toContain("rest/v1");
    expect(text).not.toContain("etc/passwd");
    for (const l of logs) expect(Object.keys(l).sort()).toEqual(["bytes", "code", "elapsedMs", "event", "host"]);
  });
});
