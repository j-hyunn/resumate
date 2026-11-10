import "server-only"
/**
 * S-14 ① 미리 보기 원문 대조 — **mock 전용** (R15 계약 정본 2026-11-09).
 *
 * 서버는 `create_application_project(… p_preview_job_id)`에서 **원문 sha256을 다시 계산해 대조**하고
 * 다를 때 `preview_mismatch`로 미리 보기를 버린다(생성은 계속된다). mock에서도 같은 분기를 재현하려면
 * 미리 보기를 만든 원문을 들고 있어야 하므로, 프로세스 안의 Map 하나에 적어 둔다.
 * dev HMR로 비면 `preview_not_found`로 떨어지는데 그것도 서버가 돌려주는 값 가운데 하나다.
 *
 * `cover-letters.ts`(쓰기)와 `applications.ts`(읽기)가 함께 쓰므로 둘 사이의 순환 import를 피해
 * 별도 모듈로 둔다.
 */

/** `create_application_project` 반환의 `preview_skip_reason` (R15) */
export type PreviewSkipReason = "preview_not_found" | "preview_expired" | "preview_mismatch"

const KEY = "__resumateJdPreviews" as const
type GlobalWithPreviews = typeof globalThis & { [KEY]?: Map<string, string> }

function store(): Map<string, string> {
  const g = globalThis as GlobalWithPreviews
  if (!g[KEY]) g[KEY] = new Map()
  return g[KEY]
}

/** 서버의 원문 정규화(`normalizeJdRawText`, decisions 4.23 백엔드 9)를 흉내 낸 mock 지문 */
export function jdRawFingerprint(rawText: string): string {
  return rawText.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim()
}

/** 미리 보기 작업 id ↔ 그 작업이 본 원문 */
export function rememberJdPreview(previewJobId: string, rawText: string): void {
  store().set(previewJobId, jdRawFingerprint(rawText))
}

/** 생성 때 서버가 하는 대조 — 같으면 적용, 다르면 버린다 */
export function checkJdPreview(
  previewJobId: string | null | undefined,
  rawText: string,
): { applied: boolean; skipReason: PreviewSkipReason | null } {
  if (!previewJobId) return { applied: false, skipReason: null }
  const seen = store().get(previewJobId)
  if (seen === undefined) return { applied: false, skipReason: "preview_not_found" }
  if (seen !== jdRawFingerprint(rawText)) return { applied: false, skipReason: "preview_mismatch" }
  return { applied: true, skipReason: null }
}
