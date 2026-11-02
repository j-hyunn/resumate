"use client"

/**
 * S-30 처리방침·약관 열람 (NFR-PRV-10). Tabs per policy_versions.policy_type; the selected
 * tab is mirrored to `?doc=` with history.replaceState so a copied link opens the same tab.
 */
import * as React from "react"
import type { PolicyType, PolicyVersion } from "@/types/db"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDate } from "@/lib/data/labels"
import { POLICY_DOCUMENTS, POLICY_TYPES, POLICY_TYPE_LABELS } from "./policy-content"

export function PoliciesView({ initial, versions }: { initial: PolicyType; versions: Record<PolicyType, PolicyVersion> }) {
  const [doc, setDoc] = React.useState<PolicyType>(initial)

  function change(value: string) {
    const next = value as PolicyType
    setDoc(next)
    const url = new URL(window.location.href)
    url.searchParams.set("doc", next)
    window.history.replaceState(window.history.state, "", url)
  }

  return (
    <Tabs value={doc} onValueChange={change} className="gap-6">
      <TabsList className="w-full sm:w-auto">
        {POLICY_TYPES.map((t) => (
          <TabsTrigger key={t} value={t}>
            {POLICY_TYPE_LABELS[t]}
          </TabsTrigger>
        ))}
      </TabsList>
      {POLICY_TYPES.map((t) => {
        const version = versions[t]
        return (
          <TabsContent key={t} value={t} className="space-y-6">
            <header className="space-y-1">
              <h2 className="text-lg leading-7 font-semibold">{POLICY_TYPE_LABELS[t]}</h2>
              <p className="text-sm leading-5 text-muted-foreground tabular-nums">
                버전 {version.version} · 시행일 {formatDate(version.effective_at)}
              </p>
            </header>
            {POLICY_DOCUMENTS[t].map((section, i) => (
              <section key={section.heading} className="space-y-2">
                <h3 className="text-base leading-6 font-semibold">
                  {i + 1}. {section.heading}
                </h3>
                {section.paragraphs?.map((p) => (
                  <p key={p} className="text-base leading-[1.75]">
                    {p}
                  </p>
                ))}
                {section.items ? (
                  <ul className="list-disc space-y-1 pl-5 text-base leading-[1.75]">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </TabsContent>
        )
      })}
    </Tabs>
  )
}
