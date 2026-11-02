"use client"

/**
 * "새로 만들기" routes (S-09/S-34/S-10/S-35 new): reset the form on each fresh push/replace
 * navigation while keeping state on back/forward (Cache Components keeps pages in
 * <Activity>; otherwise a second "+ 경력" would show the previous draft).
 */
import * as React from "react"
import { useRouter } from "next/navigation"

export function FreshKey({ children }: { children: React.ReactNode }) {
  const { bfcacheId } = useRouter()
  return <React.Fragment key={bfcacheId}>{children}</React.Fragment>
}
