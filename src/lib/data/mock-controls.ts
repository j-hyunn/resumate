/**
 * MOCK ONLY (v5.3): dev controls that make the mock server answer like the real backend does in
 * rare states, so every new UI state can be reproduced with real data flow (not only `?state=`).
 * Used by the /dev/states gallery. Production builds ignore them (isPreviewEnabled).
 */
import type { MockControls } from "@/lib/mock/fixtures"
import { clone, mockRequest } from "@/lib/mock/store"
import { isPreviewEnabled } from "@/lib/preview-state"

export async function getMockControls(): Promise<MockControls> {
  const db = await mockRequest(0)
  return clone(db.mock_controls)
}

/**
 * - next_retry_refusal: the next same-row retry answers 409 with that code (once)
 * - account_deletion_failure: the next delete_account fails with busy / incomplete (once)
 * - account_deletion_state: get_account_deletion_state() (deletion_incomplete → S-25 탈퇴 마무리)
 */
export async function setMockControls(patch: Partial<MockControls>): Promise<MockControls> {
  const db = await mockRequest(0)
  if (isPreviewEnabled) Object.assign(db.mock_controls, patch)
  return clone(db.mock_controls)
}
