import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AI_WRITER_TOKEN_TTL_SECONDS, signAiWriterToken } from "./ai-writer";

const secret = "s".repeat(40);
const userId = "11111111-1111-4111-8111-111111111111";
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("signAiWriterToken", () => {
  it("builds an HS256 JWT with role app_ai_writer and sub = user", () => {
    const now = new Date("2026-10-24T00:00:00Z");
    const token = signAiWriterToken(userId, { secret, issuer: "http://127.0.0.1:54321/auth/v1", now });
    const [h, p, sig] = token.split(".");
    expect(decode(h!)).toEqual({ alg: "HS256", typ: "JWT" });
    const claims = decode(p!);
    expect(claims).toMatchObject({
      role: "app_ai_writer",
      sub: userId,
      aud: "authenticated",
      iss: "http://127.0.0.1:54321/auth/v1",
      iat: now.getTime() / 1000,
      exp: now.getTime() / 1000 + AI_WRITER_TOKEN_TTL_SECONDS,
    });
    expect(sig).toBe(createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url"));
  });
  it("caps the lifetime at 5 minutes", () => {
    const token = signAiWriterToken(userId, { secret, issuer: "i", ttlSeconds: 3600 });
    const c = decode(token.split(".")[1]!);
    expect(c.exp - c.iat).toBe(300);
  });
  it("rejects a non-uuid user id", () => {
    expect(() => signAiWriterToken("not-a-uuid", { secret, issuer: "i" })).toThrow();
  });
  it("uses a fresh jti per token", () => {
    const a = decode(signAiWriterToken(userId, { secret, issuer: "i" }).split(".")[1]!);
    const b = decode(signAiWriterToken(userId, { secret, issuer: "i" }).split(".")[1]!);
    expect(a.jti).not.toBe(b.jti);
  });
});
