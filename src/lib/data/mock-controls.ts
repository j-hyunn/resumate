/**
 * MOCK ONLY (v5.3): dev controls that make the mock store answer like the real backend does in rare
 * states. Used by the /dev/states gallery. They change the mock store only, never Postgres, so they
 * show on preview requests (any `?state=` URL, `/dev/`). The Server Actions over them are public
 * endpoints, so a plain request (always, in production) is refused before it reaches the store.
 */
import type { MockControls } from "@/lib/mock/fixtures"
import { clone, mockRequest } from "@/lib/mock/store"
import { isPreviewRequest } from "./source"

async function previewStore() {
  if (!(await isPreviewRequest())) throw new Error("mock controls are preview only")
  return mockRequest(0)
}

export async function getMockControls(): Promise<MockControls> {
  return clone((await previewStore()).mock_controls)
}

/**
 * - next_retry_refusal: the next same-row retry answers 409 with that code (once)
 * - account_deletion_failure: the next delete_account fails with busy / incomplete (once)
 * - account_deletion_state: get_account_deletion_state() (deletion_incomplete → S-25 탈퇴 마무리)
 */
export async function setMockControls(patch: Partial<MockControls>): Promise<MockControls> {
  const db = await previewStore()
  Object.assign(db.mock_controls, patch)
  return clone(db.mock_controls)
}
