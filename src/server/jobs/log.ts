/** C-7: job metadata only (ids, type, stage, provider, code) — never prompt / output text or a key. */
export function logJobEvent(event: string, fields: Record<string, string | number | boolean | null>): void {
  console.info(JSON.stringify({ event, ...fields }));
}
