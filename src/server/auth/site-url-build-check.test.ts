import { describe, expect, it } from "vitest";
import { checkSiteUrlForBuild } from "./site-url-build-check";

describe("checkSiteUrlForBuild", () => {
  it("ignores non-production builds", () => {
    expect(() => checkSiteUrlForBuild({})).not.toThrow();
    expect(() => checkSiteUrlForBuild({ VERCEL_ENV: "preview" })).not.toThrow();
    expect(() => checkSiteUrlForBuild({ VERCEL_ENV: "development" })).not.toThrow();
  });

  it("fails a Vercel production build when the value is missing or blank", () => {
    expect(() => checkSiteUrlForBuild({ VERCEL_ENV: "production" })).toThrow(/NEXT_PUBLIC_SITE_URL is required/);
    expect(() => checkSiteUrlForBuild({ VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "  " })).toThrow(
      /NEXT_PUBLIC_SITE_URL is required/,
    );
  });

  it("fails on a relative or non-https value", () => {
    expect(() => checkSiteUrlForBuild({ VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "www.resumate.me" })).toThrow(
      /absolute URL/,
    );
    expect(() => checkSiteUrlForBuild({ VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://www.resumate.me" })).toThrow(
      /https/,
    );
  });

  it("accepts an https origin", () => {
    expect(() =>
      checkSiteUrlForBuild({ VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://www.resumate.me" }),
    ).not.toThrow();
  });
});
