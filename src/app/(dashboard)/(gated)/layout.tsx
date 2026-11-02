import { Suspense } from "react"
import { ConsentGate } from "@/server/auth/consent-gate"
import Loading from "../loading"

/**
 * Every shell screen except S-25 (A7: 탈퇴는 약관 동의 게이트 밖). The group adds no URL segment and
 * the L-01 shell stays in the parent layout. Backend wiring W1, leader decision QA-W0-02.
 */
export default function GatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Loading />}>
      <ConsentGate>{children}</ConsentGate>
    </Suspense>
  )
}
