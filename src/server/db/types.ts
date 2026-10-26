import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/** User-session client type. RLS applies as the signed-in user. Next-free so services can import it. */
export type UserSupabaseClient = SupabaseClient<Database>;

/** app_ai_writer client type (DM-13). Same schema, narrower grants. */
export type AiWriterSupabaseClient = SupabaseClient<Database>;
