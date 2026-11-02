/**
 * Page-level Suspense boundary (UQ-3 rule, Cache Components + Partial Prefetching).
 *
 * Rule for every page.tsx:
 *   - the default export is a plain (non-async) function that does NOT await `params` /
 *     `searchParams` and does not call the data layer
 *   - it renders <ScreenSuspense> with an async child that receives the promises,
 *     awaits them and loads data
 * Otherwise Next reports "URL data outside of Suspense" (instant-shell-url-data) in dev.
 */
import { Suspense } from "react"
import { PageSkeleton } from "./state-views"

export function ScreenSuspense({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return <Suspense fallback={fallback ?? <PageSkeleton />}>{children}</Suspense>
}
