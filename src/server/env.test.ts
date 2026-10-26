import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvValidationError, getPublicEnv, getServerEnv, parsePublicEnv, parseServerEnv, resetServerEnvCache } from "./env";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_JWT_SECRET: "x".repeat(32),
  ANTHROPIC_API_KEY: "sk-test-value",
  CRON_SECRET: "c".repeat(16),
};

function captureError(fn: () => unknown): EnvValidationError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(EnvValidationError);
    return err as EnvValidationError;
  }
  throw new Error("expected parseServerEnv to throw");
}

describe("parseServerEnv", () => {
  it("returns typed values for a valid source", () => {
    expect(parseServerEnv(valid)).toEqual(valid);
  });

  it("drops keys that are not part of the schema", () => {
    const env = parseServerEnv({ ...valid, UNRELATED_SECRET: "nope" });
    expect(env).not.toHaveProperty("UNRELATED_SECRET");
  });

  it("reports every missing key", () => {
    const err = captureError(() => parseServerEnv({}));
    expect(err.keys.sort()).toEqual(Object.keys(valid).sort());
    expect(err.message).toContain("ANTHROPIC_API_KEY is missing");
  });

  it("treats empty and whitespace-only strings as missing", () => {
    const err = captureError(() => parseServerEnv({ ...valid, ANTHROPIC_API_KEY: "", CRON_SECRET: "   " }));
    expect(err.keys.sort()).toEqual(["ANTHROPIC_API_KEY", "CRON_SECRET"]);
  });

  it("rejects a malformed Supabase URL", () => {
    const err = captureError(() => parseServerEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "not a url" }));
    expect(err.keys).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("rejects a JWT secret shorter than 32 characters", () => {
    const err = captureError(() => parseServerEnv({ ...valid, SUPABASE_JWT_SECRET: "short" }));
    expect(err.keys).toEqual(["SUPABASE_JWT_SECRET"]);
  });

  it("never includes secret values in the error message", () => {
    const secret = "super-secret-but-too-short";
    const err = captureError(() =>
      parseServerEnv({ ...valid, SUPABASE_JWT_SECRET: secret, NEXT_PUBLIC_SUPABASE_URL: "bad-url-value" }),
    );
    expect(err.message).not.toContain(secret);
    expect(err.message).not.toContain("bad-url-value");
  });
});

describe("getServerEnv", () => {
  afterEach(() => {
    resetServerEnvCache();
  });

  it("reads process.env once and caches the result", () => {
    for (const [key, value] of Object.entries(valid)) vi.stubEnv(key, value);
    const first = getServerEnv();
    vi.stubEnv("ANTHROPIC_API_KEY", "changed-after-first-read");
    expect(getServerEnv()).toBe(first);
    expect(getServerEnv().ANTHROPIC_API_KEY).toBe(valid.ANTHROPIC_API_KEY);
  });

  it("throws when process.env is incomplete", () => {
    for (const key of Object.keys(valid)) vi.stubEnv(key, "");
    expect(() => getServerEnv()).toThrow(EnvValidationError);
  });
});

describe("public env (QA-06)", () => {
  afterEach(() => {
    resetServerEnvCache();
  });

  it("parses with only the public Supabase keys", () => {
    const env = parsePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: valid.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: valid.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(valid.NEXT_PUBLIC_SUPABASE_URL);
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("getPublicEnv works when AI and cron secrets are missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", valid.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", valid.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("SUPABASE_JWT_SECRET", "");
    expect(getPublicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe(valid.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    expect(() => getServerEnv()).toThrow(EnvValidationError);
  });

  it("rejects a malformed site URL", () => {
    expect(() =>
      parsePublicEnv({ ...valid, NEXT_PUBLIC_SITE_URL: "not a url" }),
    ).toThrow(EnvValidationError);
  });
});
