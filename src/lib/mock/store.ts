/**
 * In-memory mock database (server only). One singleton per server process, kept on
 * globalThis so dev HMR and separate module instances (RSC / server actions) share it.
 * Restart the dev server (or call resetMockDb) to get fresh fixtures.
 */
import { connection } from "next/server"
import { createFixtures, defaultMockControls, type MockDb } from "./fixtures"

const KEY = "__resumateMockDb" as const

type GlobalWithDb = typeof globalThis & { [KEY]?: MockDb }

export function getMockDb(): MockDb {
  // Backstop for mock-isolation.test.ts: fixtures must never serve a production request
  if (process.env.NODE_ENV === "production") throw new Error("The mock store is not available in production")
  const g = globalThis as GlobalWithDb
  if (!g[KEY]) g[KEY] = createFixtures()
  // a store created before v5.3 (dev HMR) lacks the mock controls
  g[KEY].mock_controls = { ...defaultMockControls(), ...g[KEY].mock_controls }
  return g[KEY]
}

export function resetMockDb(): void {
  if (process.env.NODE_ENV === "production") throw new Error("The mock store is not available in production")
  ;(globalThis as GlobalWithDb)[KEY] = createFixtures()
}

/** Simulated network latency for reads/writes (ms). Keep small; loading UI shows after 300ms. */
const LATENCY_MS = 120

/**
 * Every data-layer function awaits this first. `connection()` marks the read as
 * request-time under Cache Components (the mock store is mutable, like a real DB).
 */
export async function mockRequest(latencyMs = LATENCY_MS): Promise<MockDb> {
  await connection()
  if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs))
  return getMockDb()
}

/** Deep copy so callers can't mutate the store through returned rows. */
export function clone<T>(value: T): T {
  return structuredClone(value)
}
