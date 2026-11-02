import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Test-only: credentials of the local Supabase stack (`supabase start`), read
 * from `supabase status -o json`. Returns null when the stack isn't running so
 * integration tests can skip. Values are never logged.
 */
export type LocalSupabase = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  jwtSecret: string;
  /** Superuser Postgres URL (S9 fixtures via psql). Absent in older CLI output. */
  dbUrl?: string;
};

function candidates(): string[] {
  const local = path.resolve(process.cwd(), "node_modules/.bin/supabase");
  return ["supabase", ...(existsSync(local) ? [local] : [])];
}

export function readLocalSupabase(): LocalSupabase | null {
  if (process.env.SKIP_SUPABASE_INTEGRATION === "1") return null;
  for (const bin of candidates()) {
    try {
      const out = execFileSync(bin, ["status", "-o", "json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 15_000,
      });
      const json = JSON.parse(out.slice(out.indexOf("{"))) as Record<string, string | undefined>;
      if (json.API_URL && json.ANON_KEY && json.SERVICE_ROLE_KEY && json.JWT_SECRET) {
        return {
          url: json.API_URL,
          anonKey: json.ANON_KEY,
          serviceRoleKey: json.SERVICE_ROLE_KEY,
          jwtSecret: json.JWT_SECRET,
          ...(json.DB_URL ? { dbUrl: json.DB_URL } : {}),
        };
      }
    } catch {
      // not installed or stack not running — try the next binary
    }
  }
  return null;
}

/** True when the REST API answers and the S1 tables exist (migrations applied). */
export async function isStackReady(stack: LocalSupabase): Promise<boolean> {
  try {
    const res = await fetch(`${stack.url}/rest/v1/policy_versions?select=id&limit=1`, {
      headers: { apikey: stack.anonKey, Authorization: `Bearer ${stack.anonKey}` },
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** True when a table exists in the local stack (its slice's migrations are applied). Uses the service role key. */
export async function hasTable(stack: LocalSupabase, table: string): Promise<boolean> {
  try {
    const res = await fetch(`${stack.url}/rest/v1/${table}?select=*&limit=0`, {
      headers: { apikey: stack.serviceRoleKey, Authorization: `Bearer ${stack.serviceRoleKey}` },
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** True when `psql` is on PATH (S9 integration fixtures). */
export function hasPsql(): boolean {
  try {
    execFileSync("psql", ["--version"], { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Test-only: runs SQL as the local superuser and returns stdout (`-At`, one row
 * per line, `|`-separated). `vars` become psql variables (`:'name'`).
 */
export function runPsql(dbUrl: string, input: { sql?: string; file?: string }, vars: Record<string, string> = {}): string {
  const args = ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", dbUrl];
  for (const [k, v] of Object.entries(vars)) args.push("-v", `${k}=${v}`);
  if (input.file) args.push("-f", input.file);
  else args.push("-c", input.sql ?? "");
  return execFileSync("psql", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).trim();
}
