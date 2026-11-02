"use client"

import { usePathname } from "next/navigation"
import { ReturnBanner } from "../return-banner"

/** C-10 appears only inside 커리어 (S-04, S-08~S-12, S-34~S-36). */
export function CareerReturnSlot() {
  const pathname = usePathname()
  return pathname.startsWith("/career") ? <ReturnBanner /> : null
}
