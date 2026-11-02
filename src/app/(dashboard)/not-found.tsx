import { ErrorState } from "@/components/common/state-views"

/** S-28 ST-NOTFOUND inside the shell (pages call notFound() when a row is missing or not owned). */
export default function DashboardNotFound() {
  return <ErrorState kind="not-found" />
}
