import { describe, expect, it } from "vitest";
import { isProductionDeployment, resolveSiteOrigin } from "./site-url";

const base = { configured: undefined, forwardedHost: null, host: null, forwardedProto: null, nodeEnv: "development", vercelEnv: undefined };

describe("isProductionDeployment", () => {
  it.each([
    ["production", "production", true],
    ["production", "preview", false],
    ["production", undefined, true],
    ["development", undefined, false],
    ["development", "development", false],
  ])("NODE_ENV=%s VERCEL_ENV=%s → %s", (nodeEnv, vercelEnv, expected) => {
    expect(isProductionDeployment(nodeEnv, vercelEnv)).toBe(expected);
  });
});

describe("resolveSiteOrigin (QA-10)", () => {
  it("uses NEXT_PUBLIC_SITE_URL's origin everywhere", () => {
    expect(resolveSiteOrigin({ ...base, configured: "https://resumate.app/some/path", nodeEnv: "production", forwardedHost: "evil.example" })).toBe(
      "https://resumate.app",
    );
  });
  it("fails closed in production without NEXT_PUBLIC_SITE_URL, ignoring Host", () => {
    expect(() => resolveSiteOrigin({ ...base, nodeEnv: "production", vercelEnv: "production", forwardedHost: "evil.example" })).toThrow();
    expect(() => resolveSiteOrigin({ ...base, nodeEnv: "production", host: "evil.example" })).toThrow();
  });
  it("uses the request host in development and Vercel preview", () => {
    expect(resolveSiteOrigin({ ...base, host: "localhost:3000" })).toBe("http://localhost:3000");
    expect(
      resolveSiteOrigin({ ...base, nodeEnv: "production", vercelEnv: "preview", forwardedHost: "resumate-git-x.vercel.app", forwardedProto: "https" }),
    ).toBe("https://resumate-git-x.vercel.app");
    expect(resolveSiteOrigin({ ...base, host: "dev.example" })).toBe("https://dev.example");
  });
});
