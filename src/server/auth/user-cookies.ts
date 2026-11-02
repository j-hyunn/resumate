import "server-only";
import { cookies } from "next/headers";
import { DELETED_ROWS_COOKIE, DELETED_ROWS_MAX_AGE_S, encodeDeletedRows, isDeletedRow } from "@/server/services/career/deleted-rows";
import { PENDING_CAREER_DESCRIPTION_COOKIE } from "@/server/services/drafts/pending-cookie";

/** App cookies that hold one user's state (QA-W5-02, QA-W5-06). Cleared on sign-out and account deletion. */
export const USER_SCOPED_COOKIES = [PENDING_CAREER_DESCRIPTION_COOKIE, DELETED_ROWS_COOKIE] as const;

export async function clearUserScopedCookies(): Promise<void> {
  const jar = await cookies();
  for (const name of USER_SCOPED_COOKIES) if (jar.get(name)) jar.delete(name);
}

/** QA-W5-06: remember a deleted career row id for this browser (Server Action / Route Handler only). */
export async function rememberDeletedRow(userId: string, id: string): Promise<void> {
  const jar = await cookies();
  try {
    jar.set(DELETED_ROWS_COOKIE, encodeDeletedRows(jar.get(DELETED_ROWS_COOKIE)?.value, userId, id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: DELETED_ROWS_MAX_AGE_S,
    });
  } catch {
    // Called while rendering (cookies are read-only there): the delete itself already happened.
  }
}

export async function wasRowDeleted(userId: string, id: string): Promise<boolean> {
  return isDeletedRow((await cookies()).get(DELETED_ROWS_COOKIE)?.value, userId, id);
}
