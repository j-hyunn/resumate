import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AppError,
  errorResponse,
  fail,
  invalid,
  isAppError,
  isErrorResult,
  ok,
  runAction,
  toErrorBody,
} from "./errors";

describe("AppError", () => {
  it("uses the Korean default message and status for a generic code", () => {
    const err = new AppError("unauthenticated");
    expect(err.code).toBe("unauthenticated");
    expect(err.message).toBe("로그인이 필요합니다.");
    expect(err.status).toBe(401);
    expect(err).toBeInstanceOf(Error);
    expect(isAppError(err)).toBe(true);
  });

  it("keeps a custom message, status, and cause", () => {
    const cause = new Error("pg: raise message_limit_reached");
    const err = new AppError("message_limit_reached", "대화 메시지 한도에 도달했습니다.", { status: 429, cause });
    expect(err.message).toBe("대화 메시지 한도에 도달했습니다.");
    expect(err.status).toBe(429);
    expect(err.cause).toBe(cause);
  });

  it("defaults unknown codes to status 400 and a generic message", () => {
    const err = new AppError("insufficient_data");
    expect(err.status).toBe(400);
    expect(err.message).toBe("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
  });

  it("is not confused with a plain Error", () => {
    expect(isAppError(new Error("x"))).toBe(false);
    expect(isAppError({ code: "not_found", message: "x" })).toBe(false);
  });
});

describe("toErrorBody", () => {
  it("passes through AppError code and message", () => {
    expect(toErrorBody(new AppError("not_found"))).toEqual({
      code: "not_found",
      message: "요청한 항목을 찾을 수 없습니다.",
    });
  });

  it("hides internals of unknown errors", () => {
    const body = toErrorBody(new Error("connection string postgres://user:pw@host"));
    expect(body.code).toBe("internal_error");
    expect(body.message).not.toContain("postgres://");
  });

  it("handles non-Error throwables", () => {
    expect(toErrorBody("boom").code).toBe("internal_error");
    expect(toErrorBody(undefined).code).toBe("internal_error");
  });
});

describe("result helpers", () => {
  it("ok / fail build the two ActionResult shapes", () => {
    expect(ok({ id: 1 })).toEqual({ data: { id: 1 } });
    expect(fail("forbidden")).toEqual({ error: { code: "forbidden", message: "접근 권한이 없습니다." } });
    expect(fail("conflict", "직접 지정한 메시지")).toEqual({
      error: { code: "conflict", message: "직접 지정한 메시지" },
    });
  });

  it("invalid maps a zod failure to invalid_input without leaking field details", () => {
    const parsed = z.object({ title: z.string().min(1) }).safeParse({ title: "" });
    expect(parsed.success).toBe(false);
    const result = invalid(parsed.error);
    expect(result).toEqual({ error: { code: "invalid_input", message: "입력값을 확인해 주세요." } });
  });

  it("isErrorResult narrows ActionResult", () => {
    expect(isErrorResult(ok(1))).toBe(false);
    expect(isErrorResult(fail("not_found"))).toBe(true);
  });
});

describe("runAction", () => {
  it("wraps a resolved value in { data }", async () => {
    await expect(runAction(async () => "saved")).resolves.toEqual({ data: "saved" });
  });

  it("maps a thrown AppError to { error }", async () => {
    const result = await runAction(async () => {
      throw new AppError("limit_reached");
    });
    expect(result).toEqual({ error: { code: "limit_reached", message: "사용 한도에 도달했습니다." } });
  });

  it("maps an unexpected throw to internal_error", async () => {
    const result = await runAction(async () => {
      throw new TypeError("cannot read properties of undefined");
    });
    expect(isErrorResult(result) && result.error.code).toBe("internal_error");
  });
});

describe("errorResponse", () => {
  it("uses the AppError status and JSON error body", async () => {
    const res = errorResponse(new AppError("unauthenticated"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toEqual({ error: { code: "unauthenticated", message: "로그인이 필요합니다." } });
  });

  it("returns 500 for unknown errors", async () => {
    const res = errorResponse(new Error("db down"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: { code: "internal_error" } });
  });
});
