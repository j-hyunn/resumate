/**
 * Stable fixture IDs (valid UUID v4 shape so zod `uuid()` checks pass).
 * Block 3 encodes the table, the last block the row number.
 */
function uid(table: string, n: number): string {
  return `00000000-0000-4${table.padStart(3, "0").slice(0, 3)}-8000-${String(n).padStart(12, "0")}`
}

export const USER_ID = "11111111-1111-4111-8111-111111111111"

export const IDS = {
  exp: (n: number) => uid("e01", n),
  edu: (n: number) => uid("e02", n),
  prj: (n: number) => uid("e03", n),
  det: (n: number) => uid("e04", n),
  ach: (n: number) => uid("e05", n),
  skl: (n: number) => uid("e06", n),
  wc: (n: number) => uid("c01", n),
  wcm: (n: number) => uid("c02", n),
  ap: (n: number) => uid("a01", n),
  ase: (n: number) => uid("a02", n),
  jd: (n: number) => uid("a03", n),
  req: (n: number) => uid("a04", n),
  ins: (n: number) => uid("a05", n),
  drf: (n: number) => uid("a06", n),
  dsec: (n: number) => uid("a07", n),
  dsrc: (n: number) => uid("a08", n),
  evl: (n: number) => uid("d01", n),
  job: (n: number) => uid("d02", n),
  usage: (n: number) => uid("d03", n),
  con: (n: number) => uid("d04", n),
} as const

/** New mock row id */
export function newId(): string {
  return crypto.randomUUID()
}
