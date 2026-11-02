/**
 * S-10 참고 문구 when opened from an S-16 보완점: "관련 요건: {요건 content}" (02 S-10).
 * Server component; the requirement id arrives as `?requirement_id=` (routes.project / projectNew).
 */
import { Info } from "lucide-react"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { getJdRequirement } from "@/lib/data/applications"

export async function RelatedRequirement({ requirementId }: { requirementId: string | undefined }) {
  if (!requirementId) return null
  const req = await getJdRequirement(requirementId)
  if (!req) return null
  return (
    <Alert variant="info" className="mx-auto mb-6 max-w-3xl">
      <Info aria-hidden />
      <AlertTitle className="font-normal">관련 요건: {req.content}</AlertTitle>
    </Alert>
  )
}
