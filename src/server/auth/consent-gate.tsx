import "server-only";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { REQUEST_PATH_HEADER } from "@/lib/contracts/preview";
import { ROUTES, safeNextPath } from "@/lib/contracts/routes";
import { isPreviewRequest } from "@/lib/data/source";
import { isAppError } from "@/lib/contracts/errors";
import { requireConsentedUserOrRedirect, requireUser } from "./session";

/**
 * F-COM-02 gate for signed-in screens (leader decision QA-W0-02): `(dashboard)/(gated)` and `(focus)`
 * layouts render this inside `<Suspense>`, so the session read stays out of the static shell (Cache
 * Components) and the page never renders before the gate passes. S-25 `/settings/withdraw` sits
 * outside the group (A7). `?state=` previews run on the mock store and skip it.
 */
export async function ConsentGate({ children }: { children: ReactNode }) {
  if (!(await isPreviewRequest())) {
    const requestHeaders = await headers();
    // Sign-out and account deletion re-render the page in the action's own response, session already
    // gone. The screen decides where to go next (S-01), so don't race it with a redirect to S-02.
    if (requestHeaders.has("next-action")) {
      try {
        await requireUser();
      } catch (err) {
        if (isAppError(err) && err.code === "unauthenticated") return null;
        throw err;
      }
    }
    await requireConsentedUserOrRedirect(safeNextPath(requestHeaders.get(REQUEST_PATH_HEADER), ROUTES.home));
  }
  return <>{children}</>;
}
