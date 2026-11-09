import { beforeEach, describe, expect, it, vi } from "vitest"
import { createFixtures, type MockDb } from "@/lib/mock/fixtures"
import { IDS } from "@/lib/mock/ids"
import type { CoverLetterQuestion } from "@/types/db"

/**
 * UQ-740 (Critical): mock `save_application_document`가 RPC와 같이 **받은 `slot`을 그대로** 쓰는지,
 * 그리고 지운 슬롯의 근거만 지우고 남은 슬롯의 근거는 제 문항에 그대로 두는지 (DM v4.15 2.5.1 ·
 * 2.7.3, RPC `doc_replace_slot_evidence`). 예전 코드는 저장 때 `q_${i + 1}`로 다시 매겨 문항을 지우거나
 * 옮기면 근거·제안이 다른 문항에 붙었다.
 */
const store = vi.hoisted(() => ({ db: null as MockDb | null }))
vi.mock("./source", () => ({
  previewOr: <T,>(preview: () => Promise<T>) => preview(),
  unwrap: <T,>(v: T) => v,
  isPreviewRequest: async () => true,
}))
vi.mock("@/lib/mock/store", () => ({ clone: <T,>(v: T) => structuredClone(v), mockRequest: async () => store.db! }))

const { saveCoverLetterDocument, toDocumentBody } = await import("./cover-letters")
const { SaveApplicationDocumentInput } = await import("@/lib/contracts/application-document")

const AP = IDS.ap(1)
const DOC = IDS.adoc(1)

function stored(db: MockDb) {
  return db.application_documents.find((d) => d.application_project_id === AP)!
}
function slotsOfEvidence(db: MockDb): string[] {
  return db.evidence_links
    .filter((e) => e.owner_type === "application_document" && e.owner_id === DOC)
    .map((e) => e.item_key)
    .sort()
}

beforeEach(() => {
  store.db = createFixtures()
})

describe("mock 자소서 저장은 슬롯을 다시 매기지 않는다 (UQ-740)", () => {
  it("1번 문항을 지우고 저장해도 남은 문항은 q_2·q_3 그대로이고, 지운 q_1의 근거만 사라진다", async () => {
    const db = store.db!
    const before = stored(db).body.questions
    expect(before.map((q) => q.slot)).toEqual(["q_1", "q_2", "q_3"])
    expect(slotsOfEvidence(db)).toEqual(["q_1.blocks.b1", "q_1.sources.1", "q_1.sources.2", "q_2.sources.1"])

    const kept: CoverLetterQuestion[] = before.filter((q) => q.slot !== "q_1")
    const r = await saveCoverLetterDocument({
      application_project_id: AP,
      body: { questions: kept },
      expected_updated_at: stored(db).updated_at,
    })

    expect(r.slotCount).toBe(2)
    const after = stored(db).body.questions
    // 슬롯은 받은 그대로, 순서는 sort_order로만
    expect(after.map((q) => q.slot)).toEqual(["q_2", "q_3"])
    expect(after.map((q) => q.sort_order)).toEqual([1, 2])
    expect(after.map((q) => q.question_id)).toEqual(kept.map((q) => q.question_id))
    // 지운 q_1의 근거만 지워지고 q_2의 근거는 제 문항에 남는다 (옛 코드는 q_2 근거가 사라지고 q_1 근거가 남았다)
    expect(slotsOfEvidence(db)).toEqual(["q_2.sources.1"])
  })

  it("순서를 바꿔 저장해도 슬롯과 근거의 짝이 바뀌지 않는다", async () => {
    const db = store.db!
    const [q1, q2, q3] = stored(db).body.questions
    await saveCoverLetterDocument({
      application_project_id: AP,
      body: { questions: [q3, q2, q1] },
      expected_updated_at: stored(db).updated_at,
    })
    const after = stored(db).body.questions
    expect(after.map((q) => q.slot)).toEqual(["q_3", "q_2", "q_1"])
    expect(after.map((q) => q.sort_order)).toEqual([1, 2, 3])
    // 근거 행은 하나도 움직이지 않는다
    expect(slotsOfEvidence(db)).toEqual(["q_1.blocks.b1", "q_1.sources.1", "q_1.sources.2", "q_2.sources.1"])
  })

  it("빈 번호가 있는 정본(q_1, q_3)도 그대로 저장된다", async () => {
    const db = store.db!
    const [q1, , q3] = stored(db).body.questions
    await saveCoverLetterDocument({ application_project_id: AP, body: { questions: [q1, q3] }, expected_updated_at: stored(db).updated_at })
    expect(stored(db).body.questions.map((q) => q.slot)).toEqual(["q_1", "q_3"])
  })

  it("겹치는 슬롯·형식이 아닌 슬롯은 invalid_slot으로 거부하고 아무것도 바꾸지 않는다", async () => {
    const db = store.db!
    const before = structuredClone(stored(db))
    const [q1, q2] = before.body.questions
    await expect(
      saveCoverLetterDocument({ application_project_id: AP, body: { questions: [q1, { ...q2, slot: "q_1" }] }, expected_updated_at: before.updated_at }),
    ).rejects.toMatchObject({ code: "invalid_slot", details: { field: "q_1" } })
    await expect(
      saveCoverLetterDocument({ application_project_id: AP, body: { questions: [{ ...q1, slot: "" }] }, expected_updated_at: before.updated_at }),
    ).rejects.toMatchObject({ code: "invalid_slot" })
    expect(stored(db).body).toEqual(before.body)
  })

  it("stale_write는 지금 버전을 details.current_updated_at으로 돌려준다 (덮어쓰기에 null을 보내지 않으려고)", async () => {
    const db = store.db!
    const current = stored(db).updated_at
    await expect(
      saveCoverLetterDocument({ application_project_id: AP, body: stored(db).body, expected_updated_at: "2000-01-01T00:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "stale_write", details: { current_updated_at: current } })
  })
})

describe("실제 저장 입력은 계약 모양 그대로다", () => {
  it("`sort_order`를 빼고 `slot`은 그대로 — `SaveApplicationDocumentInput`(strict)을 통과한다", () => {
    const db = store.db!
    const [q1, q2, q3] = stored(db).body.questions
    const body = toDocumentBody({ questions: [{ ...q3, sort_order: 1 }, { ...q1, sort_order: 2 }, { ...q2, sort_order: 3 }] })
    // 순서는 배열 순서로만, 슬롯은 제 문항 그대로
    expect(body.questions.map((q) => q.slot)).toEqual(["q_3", "q_1", "q_2"])
    for (const q of body.questions) expect("sort_order" in q).toBe(false)
    const parsed = SaveApplicationDocumentInput.safeParse({
      applicationProjectId: AP,
      documentKind: "cover_letter",
      body,
      expectedUpdatedAt: stored(db).updated_at,
      appliedProposals: [{ writingChatId: "00000000-0000-4000-8000-000000000001", slot: "q_3", rev: 1 }],
    })
    expect(parsed.success).toBe(true)
  })
})
