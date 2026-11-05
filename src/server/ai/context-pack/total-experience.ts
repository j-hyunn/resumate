import { AppError } from "@/lib/contracts/errors";
import type { AiWriterSupabaseClient, UserSupabaseClient } from "@/server/db/types";
import { parseMonth, type YearMonth } from "./months";

/**
 * `computed_total_months` (AI spec C-1 "서버가 계산하는 총 경력 개월 수", SD-2;
 * DM 6.2 / R-SD-6). The number is **not** computed here and not stored on a
 * column: one DB function owns the rule so the pack, pgTAP and any later screen
 * cannot drift apart.
 *
 *   private.compute_total_experience_months(p_user_id uuid, p_as_of date)
 *     → (total_months integer, open_ended_experience_count integer, as_of_month date)
 *
 * `p_as_of` has **no default** (DM 6.2, R-SD-23): every caller passes the run's
 * reference date (KST today) so the same input gives the same result.
 *
 * It is `private`, which PostgREST does not expose, so the AI path calls a thin
 * public wrapper of the same name that resolves the user from the JWT
 * (`private.current_uid()`, the pattern used by the other app_ai_writer paths)
 * and delegates. See `_workspace/backend/R13/02_ai_notes.md` ("db 담당 요청").
 */

export const TOTAL_EXPERIENCE_RPC = "compute_total_experience_months" as const;

export type TotalExperience = {
  /** Union of months covered by `complete` experiences, both ends inclusive. */
  totalMonths: number;
  /** Experiences left out of the sum (not ongoing, no end month) — the pack's "기간 미입력 경력 N건". */
  openEndedExperienceCount: number;
  /** Reference month of the sum (`p_as_of`'s month) — the pack's "기준 YYYY-MM". */
  asOfMonth: YearMonth;
};

/** No `complete` experience (and the "커리어 데이터 없음" interview path). */
export function emptyTotalExperience(asOfMonth: YearMonth): TotalExperience {
  return { totalMonths: 0, openEndedExperienceCount: 0, asOfMonth };
}

/** KST calendar date `YYYY-MM-DD` — the `p_as_of` every caller must pass. */
export function kstDateString(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const at = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${at("year")}-${at("month")}-${at("day")}`;
}

type RpcRow = { total_months: number | null; open_ended_experience_count: number | null; as_of_month: string | null };

/**
 * Calls the function for the signed-in user. `asOf` is the run's reference date
 * (`kstDateString()`); pass a fixed date in tests.
 */
export async function loadTotalExperience(db: AiWriterSupabaseClient | UserSupabaseClient, asOf: string): Promise<TotalExperience> {
  const { data, error } = await db.rpc(TOTAL_EXPERIENCE_RPC, { p_as_of: asOf });
  if (error) throw new AppError("internal_error", undefined, { cause: error });
  return parseTotalExperience(data, asOf);
}

/**
 * The function returns one row; PostgREST serializes it as an object for
 * `returns record` and as a one-element array for `returns table(...)`.
 */
export function parseTotalExperience(data: unknown, asOf: string): TotalExperience {
  const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null | undefined;
  const asOfMonth = parseMonth(row?.as_of_month ?? asOf) ?? parseMonth(asOf);
  if (!asOfMonth) throw new AppError("internal_error");
  return {
    totalMonths: Math.max(0, Math.trunc(row?.total_months ?? 0)),
    openEndedExperienceCount: Math.max(0, Math.trunc(row?.open_ended_experience_count ?? 0)),
    asOfMonth,
  };
}
