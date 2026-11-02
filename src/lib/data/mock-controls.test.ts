import { beforeEach, describe, expect, it, vi } from "vitest"

const preview = vi.hoisted(() => ({ on: false }))
const store = vi.hoisted(() => ({ mockRequest: vi.fn() }))
vi.mock("./source", () => ({ isPreviewRequest: async () => preview.on }))
vi.mock("@/lib/mock/store", () => ({ clone: <T,>(v: T) => structuredClone(v), mockRequest: store.mockRequest }))

const { getMockControls, setMockControls } = await import("./mock-controls")

beforeEach(() => {
  preview.on = false
  store.mockRequest.mockReset()
  store.mockRequest.mockResolvedValue({ mock_controls: { account_deletion_state: null } })
})

describe("mock controls", () => {
  it("a plain request is refused before the store is touched", async () => {
    await expect(getMockControls()).rejects.toThrow("preview only")
    await expect(setMockControls({})).rejects.toThrow("preview only")
    expect(store.mockRequest).not.toHaveBeenCalled()
  })

  it("a preview request reads and writes the store", async () => {
    preview.on = true
    await expect(setMockControls({ account_deletion_state: "deletion_incomplete" } as never)).resolves.toMatchObject({ account_deletion_state: "deletion_incomplete" })
    await expect(getMockControls()).resolves.toBeDefined()
    expect(store.mockRequest).toHaveBeenCalled()
  })
})
