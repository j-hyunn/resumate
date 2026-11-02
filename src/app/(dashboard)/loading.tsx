import { PageSkeleton } from "@/components/common/state-views"

/** ST-LOADING for every dashboard page (also the Suspense boundary for request-time reads). */
export default function Loading() {
  return <PageSkeleton />
}
