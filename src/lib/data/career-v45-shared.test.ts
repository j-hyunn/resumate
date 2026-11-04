import { describe, expect, it } from "vitest"
import { blankProjectValues, blocksToMarkdown, bodyHash, isBlank, toProjectFormSnapshot, toProjectPValues } from "./career-v45-shared"
import type { DeliverableDraftBlock } from "@/types/db"

const b = (x: Partial<DeliverableDraftBlock>): DeliverableDraftBlock => ({ block_id: "b", type: "paragraph", basis: "new", source_fact_ids: [], source_body_quotes: [], source_project_fields: [], review: "ok", ...x })

describe("toProjectPValues / toProjectFormSnapshot (DM 2.5.1)", () => {
  it("months as 'YYYY-MM', is_current drops end_month, blanks → null, name trimmed", () => {
    const v = { ...blankProjectValues({ experience_id: "e" }), name: " 이름 ", start_month: "2024-03-01", end_month: "2025-01-01", is_current: true, situation: "  " }
    expect(toProjectPValues(v)).toMatchObject({ name: "이름", start_month: "2024-03", end_month: null, situation: null })
    expect(toProjectFormSnapshot(v)).toMatchObject({ start_month: "2024-03", end_month: null, star: { situation: "  " } })
  })
  it("isBlank normalizes whitespace (C-14)", () => {
    expect(isBlank(" \n\t ")).toBe(true)
    expect(isBlank("a")).toBe(false)
  })
})

describe("blocksToMarkdown (DM 2.5.0 value)", () => {
  it("assembles blocks with a blank line between", () => {
    const md = blocksToMarkdown([
      b({ type: "heading", text: "제목", level: 2 }),
      b({ type: "paragraph", text: "문단" }),
      b({ type: "bullet_list", items: ["가", "나"] }),
      b({ type: "numbered_list", items: ["하나", "둘"] }),
      b({ type: "table", rows: [["a", "b"], ["1", "2"]] }),
    ])
    expect(md).toBe("## 제목\n\n문단\n\n- 가\n- 나\n\n1. 하나\n2. 둘\n\n| a | b |\n| --- | --- |\n| 1 | 2 |")
  })
})

describe("bodyHash", () => {
  it("matches the server's base_body_hash (sha256 of the exact UTF-8 body, no normalization)", async () => {
    const { createHash } = await import("node:crypto")
    const body = "가\r\n나 **굵게**"
    expect(await bodyHash(body)).toBe(`sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`)
    expect(await bodyHash("가\n나")).not.toBe(await bodyHash("가\r\n나"))
  })
})

describe("greetings (UQ-S10-11)", () => {
  const snap = (name: string) => toProjectFormSnapshot({ ...blankProjectValues({ experience_id: "e" }), name })
  it("particle follows the last syllable; empty name doesn't quote a placeholder", async () => {
    const { projectGreeting, deliverableGreeting } = await import("./career-v45-shared")
    expect(projectGreeting(snap("결제 개선"))).toMatch(/^'결제 개선'을 함께/)
    expect(projectGreeting(snap("정산 배치 리팩터"))).toMatch(/^'정산 배치 리팩터'를 함께/)
    expect(projectGreeting(snap(""))).toMatch(/^이 프로젝트를 함께/)
    expect(projectGreeting(snap("x"), { gateFeatureLabel: "인사이트" })).toMatch(/^인사이트를 쓰려면/)
    expect(deliverableGreeting({ title: "", body: "" }, null)).toMatch(/^이 산출물을 함께 써/)
    expect(deliverableGreeting({ title: "SDK 회고", body: "" }, "retrospective", "회고")).toMatch(/^'SDK 회고'를 회고로 정리/)
  })
})
