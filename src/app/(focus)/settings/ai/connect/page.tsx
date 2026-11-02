import type { Metadata } from "next"
import Link from "next/link"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScreenSuspense } from "@/components/common/screen-suspense"
import { ErrorState, FormSkeleton, previewErrorKind } from "@/components/common/state-views"
import { KeyConnectFlow, type KeyConnectPreview } from "@/components/account/key-connect-flow"
import { getAiConnectionOverview } from "@/lib/data/ai-connection"
import { getPreviewState } from "@/lib/preview-state"
import { AI_PROVIDER_ORDER } from "@/lib/mock/ai-providers"
import type { AiProviderName } from "@/types/db"
import { routes } from "@/lib/routes"

/**
 * S-41 키 연결 단계 (F-AI-01·04·05, FL-18 / FL-19 / FL-20) — focus layout outside the shell (Q-5).
 * Query: `provider` (gemini | anthropic | openai; 없으면 공급자 선택부터), `mode` (replace = ③만 /
 * tier = ①②만), `activate=1` (S-40 활성 전환 중 재동의 → 끝나면 활성 지정).
 * ?state= : loading · error · unauth · not-found · step-consent · step-key · reconsent · save-failed(동의 저장 실패) ·
 *           key-format · key-rejected · key-billing · key-model(저장 안 함) · key-limited · key-quota(확인 보류로 저장) ·
 *           success · limited
 */
export const metadata: Metadata = { title: "AI 연결" }

type Props = {
  params: Promise<Record<string, never>>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const PREVIEWS: readonly KeyConnectPreview[] = [
  "step-consent",
  "step-key",
  "reconsent",
  "save-failed",
  "key-format",
  "key-rejected",
  "key-billing",
  "key-model",
  "key-limited",
  "key-quota",
  "success",
  "limited",
]

export default function Page({ params, searchParams }: Props) {
  return (
    <ScreenSuspense>
      <Screen params={params} searchParams={searchParams} />
    </ScreenSuspense>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-4 border-b px-4 md:px-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href={routes.aiConnection()} aria-label="연결 그만두기">
            <X aria-hidden />
          </Link>
        </Button>
        <h1 className="text-lg leading-7 font-semibold">AI 연결</h1>
      </header>
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10 md:px-6">{children}</div>
    </>
  )
}

async function Screen({ params, searchParams }: Props) {
  void params
  const sp = await searchParams
  const state = getPreviewState(sp)
  if (state === "loading")
    return (
      <Frame>
        <FormSkeleton fields={3} />
      </Frame>
    )
  const errorKind = previewErrorKind(state)
  if (errorKind)
    return (
      <Frame>
        <ErrorState kind={errorKind} />
      </Frame>
    )

  const raw = typeof sp.provider === "string" ? sp.provider : undefined
  const provider = AI_PROVIDER_ORDER.includes(raw as AiProviderName) ? (raw as AiProviderName) : null
  const mode = sp.mode === "replace" || sp.mode === "tier" ? sp.mode : null
  const overview = await getAiConnectionOverview()
  const preview = (PREVIEWS as readonly string[]).includes(state ?? "") ? (state as KeyConnectPreview) : null

  return (
    <KeyConnectFlow
      key={`${provider ?? "pick"}-${mode ?? "full"}`}
      providers={overview.providers}
      initialProvider={provider}
      mode={mode}
      activate={sp.activate === "1"}
      preview={preview}
    />
  )
}
