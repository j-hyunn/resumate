import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvValidationError, getPublicEnv, getServerEnv, parsePublicEnv, parseServerEnv, resetServerEnvCache } from "./env";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_JWT_SECRET: "x".repeat(32),
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

  it("accepts a 32-byte base64 KEK and refuses others without echoing the value (B-2)", () => {
    const kek = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256)).toString("base64");
    expect(parseServerEnv({ ...valid, AI_KEY_KEK_BASE64: kek, AI_KEY_KEK_ID: "env-v1" })).toMatchObject({ AI_KEY_KEK_ID: "env-v1" });
    const short = Buffer.alloc(16, 7).toString("base64");
    const err = captureError(() => parseServerEnv({ ...valid, AI_KEY_KEK_BASE64: short }));
    expect(err.keys).toEqual(["AI_KEY_KEK_BASE64"]);
    expect(err.message).not.toContain(short);
    expect(captureError(() => parseServerEnv({ ...valid, AI_KEY_KEK_ID: "bad id with spaces" })).keys).toEqual(["AI_KEY_KEK_ID"]);
  });

  it("refuses the published example KEK and low-entropy KEKs (QA-S3b-04)", () => {
    for (const bad of ["ZHVtbXktZHVtbXktZHVtbXktZHVtbXktZHVtbXktMDA=", Buffer.alloc(32, 7).toString("base64")]) {
      const err = captureError(() => parseServerEnv({ ...valid, AI_KEY_KEK_BASE64: bad, AI_KEY_KEK_ID: "env-v1" }));
      expect(err.keys).toEqual(["AI_KEY_KEK_BASE64"]);
      expect(err.message).not.toContain(bad);
    }
    // The shipped .env.example leaves it empty → treated as missing (optional), so key handling fails closed.
    expect(parseServerEnv({ ...valid, AI_KEY_KEK_BASE64: "", AI_KEY_KEK_ID: "env-v1" }).AI_KEY_KEK_BASE64).toBeUndefined();
  });

  it("drops keys that are not part of the schema", () => {
    const env = parseServerEnv({ ...valid, UNRELATED_SECRET: "nope" });
    expect(env).not.toHaveProperty("UNRELATED_SECRET");
  });

  it("reports every missing key", () => {
    const err = captureError(() => parseServerEnv({}));
    expect(err.keys.sort()).toEqual(Object.keys(valid).sort());
    expect(err.message).toContain("CRON_SECRET is missing");
  });

  it("treats empty and whitespace-only strings as missing", () => {
    const err = captureError(() => parseServerEnv({ ...valid, SUPABASE_JWT_SECRET: "", CRON_SECRET: "   " }));
    expect(err.keys.sort()).toEqual(["CRON_SECRET", "SUPABASE_JWT_SECRET"]);
  });

  it("has no service-wide LLM key (BYOK)", () => {
    const env = parseServerEnv({ ...valid, ANTHROPIC_API_KEY: "sk-should-be-dropped" });
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("accepts the development AI keys outside production", () => {
    const env = parseServerEnv({ ...valid, AI_DEV_PROVIDER: "gemini", AI_DEV_API_KEY: "dev-key", AI_DEV_CONNECTION_TIER: "free" });
    expect(env.AI_DEV_PROVIDER).toBe("gemini");
    expect(env.AI_DEV_CONNECTION_TIER).toBe("free");
  });

  it("ignores the development AI keys in production (even invalid ones)", () => {
    const env = parseServerEnv({ ...valid, NODE_ENV: "production", AI_DEV_PROVIDER: "nope", AI_DEV_API_KEY: "dev-key" });
    expect(env.AI_DEV_PROVIDER).toBeUndefined();
    expect(env.AI_DEV_API_KEY).toBeUndefined();
  });

  it("rejects an unknown development provider outside production", () => {
    const err = captureError(() => parseServerEnv({ ...valid, AI_DEV_PROVIDER: "nope" }));
    expect(err.keys).toEqual(["AI_DEV_PROVIDER"]);
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
    vi.stubEnv("CRON_SECRET", "changed-after-first-read");
    expect(getServerEnv()).toBe(first);
    expect(getServerEnv().CRON_SECRET).toBe(valid.CRON_SECRET);
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
    expect(env).not.toHaveProperty("CRON_SECRET");
  });

  it("getPublicEnv works when AI and cron secrets are missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", valid.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", valid.NEXT_PUBLIC_SUPABASE_ANON_KEY);
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
