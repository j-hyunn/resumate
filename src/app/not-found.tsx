import { ErrorState } from "@/components/common/state-views"

/** S-28 ST-NOTFOUND outside the shell (page center) */
export default function NotFound() {
  return <ErrorState kind="not-found" inShell={false} />
}
