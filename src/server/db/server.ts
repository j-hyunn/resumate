import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/server/env";
import type { Database } from "./database.types";
import type { UserSupabaseClient } from "./types";

export type { UserSupabaseClient };

/**
 * User-session Supabase client for Server Components, Server Actions, and
 * Route Handlers. Create one per request — never share across requests.
 *
 * Server Components can't write cookies; there `setAll` is a no-op and the
 * proxy (src/proxy.ts) keeps the session refreshed instead.
 */
export async function createSupabaseServerClient(): Promise<UserSupabaseClient> {
  const env = getPublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component: cookies are read-only there.
          // The proxy refreshes the session on the next request.
        }
      },
    },
  });
}
