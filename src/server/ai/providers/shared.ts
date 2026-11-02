import { ProviderError, signalReason } from "../errors";
import type { AiCallResult, LlmStreamEvent, NormalizedUsage, ProviderId } from "./types";
import { UNAVAILABLE_USAGE } from "./types";

/** Helpers shared by the three adapters. Pure; no SDK imports. */

/** `Retry-After` header: delta-seconds or an HTTP date. Invalid → undefined. */
export function parseRetryAfter(value: string | null | undefined, now: number): Date | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return new Date(now + Math.round(Number(trimmed) * 1000));
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : new Date(at);
}

/** Gemini `RetryInfo.retryDelay` ("34s", "1.5s"). */
export function parseDurationSeconds(value: unknown, now: number): Date | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  return m ? new Date(now + Math.round(Number(m[1]) * 1000)) : undefined;
}

/**
 * Next 00:00 in `timeZone` strictly after `now`, from the tz database
 * (C-11.2 Gemini daily reset: America/Los_Angeles; never a fixed UTC hour).
 */
export function nextMidnightIn(timeZone: string, now: Date): Date {
  const parts = zonedParts(timeZone, now);
  // Local next-day midnight as if it were UTC, then shift by the zone offset at that instant.
  const localMidnightAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 0, 0, 0);
  let guess = localMidnightAsUtc - offsetMs(timeZone, new Date(localMidnightAsUtc));
  // Second pass: the offset at the real instant can differ across a DST switch.
  guess = localMidnightAsUtc - offsetMs(timeZone, new Date(guess));
  return new Date(guess);
}

export const GEMINI_QUOTA_TIME_ZONE = "America/Los_Angeles";

function zonedParts(timeZone: string, at: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const get = (type: string) => Number(fmt.formatToParts(at).find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Zone offset (local − UTC) in ms at `at`. */
function offsetMs(timeZone: string, at: Date): number {
  const p = zonedParts(timeZone, at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Our own abort (cancel or deadline) → canceled / timeout. Checked before any provider mapping. */
export function abortError(provider: ProviderId, signal: AbortSignal | undefined, cause: unknown): ProviderError | null {
  const reason = signalReason(signal);
  return reason ? new ProviderError(reason, { provider, cause }) : null;
}

/** C-11.2 fallback: anything not in the table → provider_unavailable, flagged for the log [가정]. */
export function unclassifiedError(provider: ProviderId, cause: unknown): ProviderError {
  return new ProviderError("provider_unavailable", { provider, unclassified: true, cause });
}

/** `complete()` for every adapter: drain the stream; an `error` event is thrown with its usage. */
export async function drainStream(events: AsyncIterable<LlmStreamEvent>): Promise<AiCallResult> {
  for await (const event of events) {
    if (event.type === "done") return event.result;
    if (event.type === "error") throw event.error.with({ usage: event.usage, beforeFirstToken: true });
  }
  throw new ProviderError("provider_unavailable", { unclassified: true });
}

/** Builds the terminal error event, filling stream position and usage. */
export function errorEvent(error: ProviderError, emitted: boolean, usage: NormalizedUsage | null): LlmStreamEvent {
  const finalUsage = usage ?? error.usage ?? UNAVAILABLE_USAGE;
  return { type: "error", error: error.with({ beforeFirstToken: !emitted, usage: finalUsage }), usage: finalUsage };
}

/** Reads a nested string field from an unknown error body without trusting its shape. */
export function readString(value: unknown, ...path: string[]): string | undefined {
  let node: unknown = value;
  for (const key of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "string" ? node : undefined;
}

export function nonNegative(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}
