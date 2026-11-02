import { isAppError } from "@/lib/contracts/errors"
import type { RowSaveResult } from "./row-save"

/** Server side of a form save: the codes a form acts on become values; anything else stays a thrown failure ("저장 실패 — 다시 시도"). */
export async function guardRowSave<R>(save: () => Promise<R>, readLatest: () => Promise<R | null>): Promise<RowSaveResult<R>> {
  try {
    return { ok: true, row: await save() }
  } catch (e) {
    if (!isAppError(e)) throw e
    if (e.code === "invalid_input") return { ok: false, reason: "invalid" }
    if (e.code === "not_found") return { ok: false, reason: "gone" }
    if (e.code !== "conflict") throw e
    const latest = await readLatest()
    return latest ? { ok: false, reason: "conflict", latest } : { ok: false, reason: "gone" }
  }
}
