import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { bodyHash as serverBodyHash } from "@/server/ai/context-pack/deliverable-chat"
import { computeBodyHash, normalizeBodyForHash } from "./body-hash"

const rawHash = (s: string) => `sha256:${createHash("sha256").update(s, "utf8").digest("hex")}`

describe("normalizeBodyForHash (DM 2.5.0, OD-P5)", () => {
  it("1. CRLF and lone CR become LF", () => {
    expect(normalizeBodyForHash("가\r\n나\r다")).toBe("가\n나\n다")
  })

  it("2. trailing spaces and tabs are removed from every line", () => {
    expect(normalizeBodyForHash("가 \t \n나\t\n다  ")).toBe("가\n나\n다")
    // after CRLF → LF, so "가 \r\n" loses its trailing space too
    expect(normalizeBodyForHash("가 \r\n나")).toBe("가\n나")
  })

  it("3. 2+ blank lines collapse to one; a single blank line is kept", () => {
    expect(normalizeBodyForHash("가\n\n\n나")).toBe("가\n\n나")
    expect(normalizeBodyForHash("가\n\n\n\n\n나")).toBe("가\n\n나")
    expect(normalizeBodyForHash("가\n\n나")).toBe("가\n\n나")
    // whitespace-only lines count as blank (step 2 runs before step 3)
    expect(normalizeBodyForHash("가\n  \n\t\n나")).toBe("가\n\n나")
  })

  it("4. trailing newlines at the very end are removed", () => {
    expect(normalizeBodyForHash("가\n")).toBe("가")
    expect(normalizeBodyForHash("가\n\n\n")).toBe("가")
    expect(normalizeBodyForHash("가\r\n  \r\n")).toBe("가")
    expect(normalizeBodyForHash("\n\n")).toBe("")
  })

  it("keeps leading indentation, inner spaces, other whitespace and Unicode form", () => {
    const md = "- 항목\n  - 하위 항목\n\n```\n    code  block\n```"
    expect(normalizeBodyForHash(md)).toBe(md)
    expect(normalizeBodyForHash("가  나\t다")).toBe("가  나\t다")
    expect(normalizeBodyForHash("가 ")).toBe("가 ") // NBSP is not U+0020
    expect(normalizeBodyForHash("가　")).toBe("가　") // full-width space
    const nfd = "가" // decomposed 가
    expect(normalizeBodyForHash(nfd)).toBe(nfd)
    expect(normalizeBodyForHash("\n\n가")).toBe("\n\n가") // leading newlines are not in the rule
  })

  it("is idempotent", () => {
    const s = "가 \r\n\r\n\r\n  나\t\n\n"
    expect(normalizeBodyForHash(normalizeBodyForHash(s))).toBe(normalizeBodyForHash(s))
  })
})

describe("computeBodyHash / server bodyHash parity", () => {
  const cases = ["", "본문", "본문\n", "가\r\n나", "가 \t\n\n\n\n나\n", "- a\n  - b\n", "이모지 😀\n표 | a |", "가"]

  it("step 5: sha256: + lowercase hex of the normalized UTF-8 bytes", async () => {
    for (const c of cases) {
      const h = await computeBodyHash(c)
      expect(h).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(h).toBe(rawHash(normalizeBodyForHash(c)))
    }
  })

  it("browser (Web Crypto) and server (node:crypto) give the same hash", async () => {
    for (const c of cases) expect(await computeBodyHash(c)).toBe(serverBodyHash(c))
  })

  it("whitespace-only differences hash the same; content and indentation differences do not", async () => {
    expect(await computeBodyHash("가\r\n나 \n")).toBe(await computeBodyHash("가\n나"))
    expect(await computeBodyHash("가\n\n\n나")).toBe(await computeBodyHash("가\n\n나"))
    expect(await computeBodyHash("가\n나")).not.toBe(await computeBodyHash("가\n\n나"))
    expect(await computeBodyHash("- a\n  - b")).not.toBe(await computeBodyHash("- a\n- b"))
  })
})
